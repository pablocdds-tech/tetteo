import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import type { ContextoSessao } from "@/core/sessao/nucleo";
import { db } from "@/server/db";

import { conferirResposta, revisarItemChecklist } from "./conferencia";
import { gravarEvidencia, lerEvidencia, removerEvidencia } from "./evidencias";
import { abrirResposta } from "./respostas";

const banco = new URL(process.env.DATABASE_URL ?? "");
if (
  process.env.NODE_ENV !== "test" ||
  !["localhost", "127.0.0.1"].includes(banco.hostname) ||
  !banco.pathname.includes("_test")
) {
  throw new Error(
    "Teste de evidências exige banco local dedicado com _test no nome.",
  );
}
after(async () => {
  await db.$disconnect();
});

test(
  "evidências isoladas, versão concorrente, exclusão lógica e IA antiga após revisão humana",
  { timeout: 30_000 },
  async () => {
    const org = await db.organizacao.create({
      data: {
        nome: "Rede sintética de evidências",
        slug: `evidencias-${randomUUID()}`,
      },
    });
    const outraOrg = await db.organizacao.create({
      data: {
        nome: "Outra rede sintética",
        slug: `evidencias-${randomUUID()}`,
      },
    });
    const unidade = await db.unidade.create({
      data: { organizacaoId: org.id, nome: "Unidade sintética", codigo: "E" },
    });
    const outraUnidade = await db.unidade.create({
      data: {
        organizacaoId: outraOrg.id,
        nome: "Unidade inacessível",
        codigo: "E",
      },
    });
    const usuario = await db.usuario.create({
      data: {
        nome: "Pessoa sintética",
        email: `${randomUUID()}@example.invalid`,
        status: "ATIVO",
      },
    });
    const papel = await db.papel.create({
      data: {
        organizacaoId: org.id,
        nome: "Gestor sintético de evidências",
        permissoes: {
          create: [
            "checklists.ver",
            "checklists.responder",
            "checklists.editar",
          ].map((chave) => ({ chave })),
        },
      },
    });
    await db.acesso.create({
      data: {
        usuarioId: usuario.id,
        organizacaoId: org.id,
        unidadeId: unidade.id,
        papelId: papel.id,
        status: "ATIVO",
      },
    });
    const ctx: ContextoSessao = {
      usuario: {
        id: usuario.id,
        nome: usuario.nome,
        email: usuario.email,
        avatarUrl: null,
      },
      organizacao: org,
      unidadeAtiva: unidade,
      unidadesVisiveis: [unidade],
      podeVerRedeInteira: false,
      permissoes: new Set([
        "checklists.ver",
        "checklists.responder",
        "checklists.editar",
      ]),
      ehDiretor: false,
    };
    const outroCtx = {
      ...ctx,
      organizacao: outraOrg,
      unidadeAtiva: outraUnidade,
      unidadesVisiveis: [outraUnidade],
    };
    const modelo = await db.modeloDeChecklist.create({
      data: {
        organizacaoId: org.id,
        nome: `Bancada ${randomUUID()}`,
        itens: {
          create: {
            texto: "A bancada está limpa?",
            analisarIA: true,
            criterioIA: "Sem resíduos visíveis na bancada.",
            exigeObservacaoSeNao: false,
          },
        },
      },
    });
    const resposta = await abrirResposta(ctx, {
      modeloId: modelo.id,
      referencia: new Date(),
    });
    const linha = await db.respostaItem.findFirstOrThrow({
      where: { respostaId: resposta.id },
    });
    const pastaAnterior = process.env.ARQUIVOS_DIR;
    process.env.ARQUIVOS_DIR = await mkdtemp(
      path.join(os.tmpdir(), "tetteo-checklist-evidencias-test-"),
    );
    const foto = new Uint8Array([255, 216, 255, 1]);
    try {
      const concorrentes = await Promise.allSettled(
        [1, 2].map(() =>
          gravarEvidencia(ctx, resposta.id, {
            itemId: linha.id,
            versaoEsperada: 0,
            bytes: foto,
            nome: "foto.jpg",
          }),
        ),
      );
      assert.equal(
        concorrentes.filter((r) => r.status === "fulfilled").length,
        1,
      );
      const primeira = concorrentes.find(
        (
          r,
        ): r is PromiseFulfilledResult<
          Awaited<ReturnType<typeof gravarEvidencia>>
        > => r.status === "fulfilled",
      )!.value;
      assert.equal(primeira.versao, 1);
      const repetida = await gravarEvidencia(ctx, resposta.id, {
        itemId: linha.id,
        versaoEsperada: 1,
        bytes: foto,
        nome: "repetida.jpg",
      });
      assert.equal(repetida.evidencia.id, primeira.evidencia.id);
      assert.equal(repetida.versao, 1);
      assert.ok(await lerEvidencia(ctx, resposta.id, primeira.evidencia.id));
      assert.equal(
        await lerEvidencia(outroCtx, resposta.id, primeira.evidencia.id),
        null,
      );
      await assert.rejects(
        gravarEvidencia(outroCtx, resposta.id, {
          itemId: linha.id,
          versaoEsperada: 1,
          bytes: foto,
          nome: "foto.jpg",
        }),
        /não encontrado/,
      );
      await assert.rejects(
        removerEvidencia(ctx, resposta.id, primeira.evidencia.id, 0),
        /mudou/,
      );
      assert.deepEqual(
        await removerEvidencia(ctx, resposta.id, primeira.evidencia.id, 1),
        { versao: 2 },
      );
      assert.equal(
        await lerEvidencia(ctx, resposta.id, primeira.evidencia.id),
        null,
      );
      const removida = await db.checklistEvidencia.findUniqueOrThrow({
        where: { id: primeira.evidencia.id },
        include: { arquivo: true },
      });
      assert.ok(removida.excluidoEm);
      assert.ok(removida.arquivo.excluidoEm);
      const nova = await gravarEvidencia(ctx, resposta.id, {
        itemId: linha.id,
        versaoEsperada: 2,
        bytes: foto,
        nome: "nova.jpg",
      });
      const fetchAnterior = globalThis.fetch;
      const keyAnterior = process.env.GEMINI_API_KEYS;
      const modeloAnterior = process.env.GEMINI_MODELO;
      process.env.GEMINI_API_KEYS = "ficticia-exclusiva-teste";
      process.env.GEMINI_MODELO = "modelo-ficticio-teste";
      let sinalizar!: () => void;
      let liberar!: () => void;
      const chegou = new Promise<void>((r) => {
        sinalizar = r;
      });
      const continuar = new Promise<void>((r) => {
        liberar = r;
      });
      globalThis.fetch = async () => {
        sinalizar();
        await continuar;
        return Response.json({
          candidates: [
            {
              finishReason: "STOP",
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      resultado: "APROVADO",
                      motivo: "Imagem de bancada sem resíduos.",
                      confianca: 0.95,
                      evidencias: [
                        {
                          id: nova.evidencia.id,
                          resultado: "APROVADO",
                          motivo: "Sem resíduos visíveis.",
                          confianca: 0.95,
                        },
                      ],
                    }),
                  },
                ],
              },
            },
          ],
        });
      };
      try {
        const pendente = conferirResposta(ctx, resposta.id);
        await chegou;
        const revisao = await revisarItemChecklist(ctx, resposta.id, {
          itemId: linha.id,
          resultado: "REPROVADO",
          motivo: "A conferência humana identificou resíduos.",
          versaoEsperada: 3,
        });
        assert.equal(revisao.versao, 4);
        liberar();
        assert.equal((await pendente).descartados, 1);
        const atual = await db.respostaItem.findUniqueOrThrow({
          where: { id: linha.id },
        });
        assert.equal(atual.resultadoIA, "REPROVADO");
        assert.equal(atual.revisadoPorId, usuario.id);
        assert.equal(atual.versao, 4);
      } finally {
        liberar();
        globalThis.fetch = fetchAnterior;
        if (keyAnterior === undefined) delete process.env.GEMINI_API_KEYS;
        else process.env.GEMINI_API_KEYS = keyAnterior;
        if (modeloAnterior === undefined) delete process.env.GEMINI_MODELO;
        else process.env.GEMINI_MODELO = modeloAnterior;
      }
    } finally {
      if (pastaAnterior === undefined) delete process.env.ARQUIVOS_DIR;
      else process.env.ARQUIVOS_DIR = pastaAnterior;
    }
  },
);
