import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, beforeEach, test } from "node:test";

import type { Prisma } from "@prisma/client";

import { contextoDeFundo, type ContextoSessao } from "@/core/sessao/nucleo";
import { db } from "@/server/db";

import {
  assistenteDosChecklists,
  listarAvisosDosChecklists,
} from "../assistente";
import { esquemaItemModelo } from "../schemas/modelo";

import { atualizarItemModelo } from "./modelos";

import {
  abrirResposta,
  atribuirResposta,
  executarRotina,
  fecharResposta,
  obterResposta,
  salvarItem,
} from "./respostas";

async function criarCenario() {
  const sufixo = randomUUID();
  const org = await db.organizacao.create({
    data: { nome: "Rede checklist ensaio", slug: `checklist-${sufixo}` },
  });
  const outraOrg = await db.organizacao.create({
    data: { nome: "Outra rede de ensaio", slug: `checklist-outra-${sufixo}` },
  });
  const centro = await db.unidade.create({
    data: { organizacaoId: org.id, nome: "Centro de ensaio", codigo: "CEN" },
  });
  const sul = await db.unidade.create({
    data: { organizacaoId: org.id, nome: "Sul de ensaio", codigo: "SUL" },
  });
  const fora = await db.unidade.create({
    data: {
      organizacaoId: outraOrg.id,
      nome: "Loja externa de ensaio",
      codigo: "EXT",
    },
  });

  async function pessoa(
    nome: string,
    organizacaoId: string,
    unidadeId: string | null,
    permissoes: string[],
  ) {
    const papel = await db.papel.create({
      data: {
        organizacaoId,
        nome,
        permissoes: { create: permissoes.map((chave) => ({ chave })) },
      },
    });
    const usuario = await db.usuario.create({
      data: {
        nome,
        email: `${randomUUID()}@checklist.exemplo.test`,
        status: "ATIVO",
      },
    });
    await db.acesso.create({
      data: {
        usuarioId: usuario.id,
        organizacaoId,
        unidadeId,
        papelId: papel.id,
      },
    });
    return usuario;
  }

  const gestor = await pessoa("Gestor de ensaio", org.id, null, ["*"]);
  const ana = await pessoa("Funcionária de ensaio", org.id, centro.id, [
    "checklists.ver",
    "checklists.responder",
  ]);
  const bia = await pessoa("Colega de ensaio", org.id, centro.id, [
    "checklists.ver",
    "checklists.responder",
  ]);
  const externo = await pessoa(
    "Pessoa externa de ensaio",
    outraOrg.id,
    fora.id,
    ["*"],
  );

  async function contexto(
    usuarioId: string,
    unidadeId = centro.id,
  ): Promise<ContextoSessao> {
    const ctx = await contextoDeFundo(usuarioId, unidadeId);
    assert.ok(ctx);
    return ctx;
  }

  const [gestao, operacao, colega, outraUnidade, outraRede] = await Promise.all(
    [
      contexto(gestor.id),
      contexto(ana.id),
      contexto(bia.id),
      contexto(gestor.id, sul.id),
      contexto(externo.id, fora.id),
    ],
  );

  async function modelo(itens: Prisma.ItemDeModeloCreateWithoutModeloInput[]) {
    return db.modeloDeChecklist.create({
      data: {
        organizacaoId: org.id,
        nome: `Modelo de ensaio ${randomUUID()}`,
        itens: { create: itens },
      },
      include: { itens: { orderBy: { ordem: "asc" } } },
    });
  }
  return {
    org,
    outraOrg,
    centro,
    sul,
    fora,
    gestor,
    ana,
    bia,
    gestao,
    operacao,
    colega,
    outraUnidade,
    outraRede,
    modelo,
  };
}

let c: Awaited<ReturnType<typeof criarCenario>>;

beforeEach(async () => {
  const [{ banco }] = await db.$queryRaw<
    { banco: string }[]
  >`SELECT current_database() AS banco`;
  assert.match(banco, /_test/);
  c = await criarCenario();
});

after(async () => {
  await db.$disconnect();
});

test("a abertura congela regras e o salvamento registra o ator real", async () => {
  const modelo = await c.modelo([
    {
      texto: "Temperatura de ensaio",
      tipo: "NUMERO",
      minimo: -20,
      maximo: -12,
      exigeFoto: true,
    },
  ]);
  const resposta = await abrirResposta(c.operacao, {
    modeloId: modelo.id,
    referencia: new Date(),
  });
  await atualizarItemModelo(
    c.gestao,
    modelo.id,
    modelo.itens[0].id,
    esquemaItemModelo.parse({
      texto: "Pergunta editada",
      tipo: "NUMERO",
      obrigatorio: false,
      exigeFoto: false,
      minimo: "0",
      maximo: "100",
    }),
  );
  await salvarItem(
    c.operacao,
    resposta.id,
    modelo.itens[0].id,
    { valorNumero: -18 },
    0,
  );
  const completa = await obterResposta(c.operacao, resposta.id);
  assert.ok(completa);
  const item = completa.itens[0];
  assert.equal(item.textoItem, "Temperatura de ensaio");
  assert.equal(item.obrigatorio, true);
  assert.equal(item.exigeFoto, true);
  assert.equal(Number(item.minimo), -20);
  assert.equal(Number(item.maximo), -12);
  assert.equal(item.respondidoPorId, c.ana.id);
  assert.equal(Number(item.valorNumero), -18);
  const auditoria = await db.auditoria.findFirstOrThrow({
    where: { entidadeId: resposta.id, acao: "ALTEROU" },
  });
  assert.equal(auditoria.usuarioId, c.ana.id);
  assert.equal(auditoria.unidadeId, c.centro.id);
});

test("outra unidade e organização não leem nem alteram a execução; colega não se passa pelo responsável", async () => {
  const modelo = await c.modelo([{ texto: "Bancada limpa de ensaio" }]);
  const resposta = await abrirResposta(c.operacao, {
    modeloId: modelo.id,
    referencia: new Date(),
  });
  assert.equal(await obterResposta(c.outraUnidade, resposta.id), null);
  assert.equal(await obterResposta(c.outraRede, resposta.id), null);
  for (const contexto of [c.outraUnidade, c.outraRede, c.colega]) {
    await assert.rejects(
      salvarItem(
        contexto,
        resposta.id,
        modelo.itens[0].id,
        { conforme: true },
        0,
      ),
    );
  }
  const item = await db.respostaItem.findFirstOrThrow({
    where: { respostaId: resposta.id },
  });
  assert.equal(item.respondidoEm, null);
  assert.equal(item.versao, 0);
});

test("atribuição exige gestão, permissão de responder e acesso válido da pessoa", async () => {
  const modelo = await c.modelo([{ texto: "Atribuição de ensaio" }]);
  const resposta = await abrirResposta(c.operacao, {
    modeloId: modelo.id,
    referencia: new Date(),
  });
  await assert.rejects(
    atribuirResposta(c.operacao, resposta.id, {
      responsavelId: c.bia.id,
      prazoEm: null,
    }),
  );
  await assert.rejects(
    atribuirResposta(c.gestao, resposta.id, {
      responsavelId: c.outraRede.usuario.id,
      prazoEm: null,
    }),
  );
  await assert.rejects(
    atribuirResposta(
      {
        ...c.gestao,
        permissoes: new Set(["checklists.ver", "checklists.editar"]),
      },
      resposta.id,
      { responsavelId: c.bia.id, prazoEm: null },
    ),
  );
  await atribuirResposta(c.gestao, resposta.id, {
    responsavelId: c.bia.id,
    prazoEm: new Date("2026-11-04T10:00:00Z"),
  });
  await assert.rejects(
    salvarItem(
      c.operacao,
      resposta.id,
      modelo.itens[0].id,
      { conforme: true },
      0,
    ),
  );
  await salvarItem(
    c.colega,
    resposta.id,
    modelo.itens[0].id,
    { conforme: true },
    0,
  );
  assert.equal(
    (
      await db.respostaItem.findFirstOrThrow({
        where: { respostaId: resposta.id },
      })
    ).respondidoPorId,
    c.bia.id,
  );
});

test("opções adulteradas, seleção duplicada e valor de outro tipo são recusados", async () => {
  const modelo = await c.modelo([
    {
      texto: "Produtos conferidos de ensaio",
      tipo: "MULTIPLA_ESCOLHA",
      opcoes: ["Farinha", "Queijo"],
    },
  ]);
  const resposta = await abrirResposta(c.operacao, {
    modeloId: modelo.id,
    referencia: new Date(),
  });
  for (const valor of [
    { valorSelecao: ["Produto inexistente"] },
    { valorSelecao: ["Farinha", "Farinha"] },
    { valorNumero: 10 },
    { conforme: true },
  ]) {
    await assert.rejects(
      salvarItem(c.operacao, resposta.id, modelo.itens[0].id, valor, 0),
    );
  }
  const salva = await salvarItem(
    c.operacao,
    resposta.id,
    modelo.itens[0].id,
    { valorSelecao: ["Farinha", "Queijo"] },
    0,
  );
  assert.equal(salva.versao, 1);
  assert.deepEqual(
    (
      await db.respostaItem.findFirstOrThrow({
        where: { respostaId: resposta.id },
      })
    ).valorSelecao,
    ["Farinha", "Queijo"],
  );
});

test("foto e vídeo obrigatórios bloqueiam fechamento inclusive em N/A justificado", async () => {
  const modelo = await c.modelo([
    { texto: "Equipamento de ensaio", exigeFoto: true, exigeVideo: true },
  ]);
  const resposta = await abrirResposta(c.operacao, {
    modeloId: modelo.id,
    referencia: new Date(),
  });
  await salvarItem(
    c.operacao,
    resposta.id,
    modelo.itens[0].id,
    { conforme: true },
    0,
  );
  await assert.rejects(fecharResposta(c.operacao, resposta.id), /foto|vídeo/i);
  await salvarItem(
    c.operacao,
    resposta.id,
    modelo.itens[0].id,
    {
      naoSeAplica: true,
      observacao: "Equipamento desligado para manutenção de ensaio.",
    },
    1,
  );
  await assert.rejects(fecharResposta(c.operacao, resposta.id), /foto|vídeo/i);
  assert.equal(
    (
      await db.respostaDeChecklist.findUniqueOrThrow({
        where: { id: resposta.id },
      })
    ).status,
    "ABERTA",
  );
});

test("escrita concorrente com mesma versão não sobrescreve uma resposta confirmada", async () => {
  const modelo = await c.modelo([{ texto: "Relato de ensaio", tipo: "TEXTO" }]);
  const resposta = await abrirResposta(c.operacao, {
    modeloId: modelo.id,
    referencia: new Date(),
  });
  const resultados = await Promise.allSettled([
    salvarItem(
      c.operacao,
      resposta.id,
      modelo.itens[0].id,
      { valorTexto: "Relato da primeira aba." },
      0,
    ),
    salvarItem(
      c.operacao,
      resposta.id,
      modelo.itens[0].id,
      { valorTexto: "Relato da segunda aba." },
      0,
    ),
  ]);
  assert.equal(resultados.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(resultados.filter((r) => r.status === "rejected").length, 1);
  const item = await db.respostaItem.findFirstOrThrow({
    where: { respostaId: resposta.id },
  });
  assert.equal(item.versao, 1);
  assert.ok(
    ["Relato da primeira aba.", "Relato da segunda aba."].includes(
      item.valorTexto!,
    ),
  );
});

test("conclusão concorrente cria uma pendência e a folha fechada não muda", async () => {
  const modelo = await c.modelo([{ texto: "Coifa limpa de ensaio" }]);
  const resposta = await abrirResposta(c.operacao, {
    modeloId: modelo.id,
    referencia: new Date(),
  });
  await salvarItem(
    c.operacao,
    resposta.id,
    modelo.itens[0].id,
    {
      conforme: false,
      observacao: "Precisa de limpeza após manutenção de ensaio.",
    },
    0,
  );
  await Promise.all([
    fecharResposta(c.operacao, resposta.id),
    fecharResposta(c.operacao, resposta.id),
  ]);
  assert.equal(
    await db.pendencia.count({ where: { respostaId: resposta.id } }),
    1,
  );
  assert.equal(
    Number(
      (
        await db.respostaDeChecklist.findUniqueOrThrow({
          where: { id: resposta.id },
        })
      ).pontuacao,
    ),
    0,
  );
  await assert.rejects(
    salvarItem(
      c.operacao,
      resposta.id,
      modelo.itens[0].id,
      { conforme: true },
      1,
    ),
  );
});

test("abrir a mesma rotina em concorrência retoma a mesma execução", async () => {
  const modelo = await c.modelo([{ texto: "Rotina concorrente de ensaio" }]);
  const rotina = await db.rotinaDeChecklist.create({
    data: {
      unidadeId: c.centro.id,
      modeloId: modelo.id,
      recorrencia: "DIARIA",
      responsavelId: c.ana.id,
    },
  });
  const [a, b] = await Promise.all([
    executarRotina(c.operacao, rotina.id),
    executarRotina(c.operacao, rotina.id),
  ]);
  assert.equal(a.id, b.id);
  assert.equal(
    await db.respostaDeChecklist.count({ where: { rotinaId: rotina.id } }),
    1,
  );
});

test("avisos de prazo respeitam responsável, unidade, organização e permissão", async () => {
  const modelo = await c.modelo([{ texto: "Prazo de ensaio" }]);
  const resposta = await abrirResposta(c.operacao, {
    modeloId: modelo.id,
    referencia: new Date(),
  });
  await atribuirResposta(c.gestao, resposta.id, {
    responsavelId: c.ana.id,
    prazoEm: new Date("2026-11-03T10:00:00Z"),
  });
  const agora = new Date("2026-11-04T10:00:00Z");
  assert.ok(
    (await listarAvisosDosChecklists(c.operacao, agora)).some(
      (a) => a.referenciaId === resposta.id,
    ),
  );
  assert.ok(
    (await listarAvisosDosChecklists(c.gestao, agora)).some(
      (a) => a.referenciaId === resposta.id,
    ),
  );
  for (const ctx of [
    c.colega,
    c.outraUnidade,
    c.outraRede,
    { ...c.gestao, permissoes: new Set<string>() },
  ]) {
    assert.equal(
      (await listarAvisosDosChecklists(ctx, agora)).some(
        (a) => a.referenciaId === resposta.id,
      ),
      false,
    );
  }
});

test("conclusão de modelo comum gera fato; N/A justificado não cobra análise de IA", async () => {
  const modelo = await c.modelo([
    {
      texto: "Observação da operação de ensaio",
      tipo: "TEXTO",
      analisarIA: true,
      criterioIA: "O relato deve explicar o estado do equipamento de ensaio.",
    },
  ]);
  const desde = new Date();
  const resposta = await abrirResposta(c.operacao, {
    modeloId: modelo.id,
    referencia: desde,
  });
  await salvarItem(
    c.operacao,
    resposta.id,
    modelo.itens[0].id,
    {
      naoSeAplica: true,
      observacao: "Equipamento ausente nesta unidade de ensaio.",
    },
    0,
  );
  await fecharResposta(c.operacao, resposta.id);
  const fatos = await assistenteDosChecklists.eventos(
    { organizacaoId: c.org.id, unidadeIds: [c.centro.id] },
    desde,
  );
  assert.ok(
    fatos.some(
      (fato) =>
        fato.referenciaId === resposta.id &&
        fato.tipo === "checklists.conclusao",
    ),
  );
  const deOutraRede = await assistenteDosChecklists.eventos(
    { organizacaoId: c.outraOrg.id, unidadeIds: [c.centro.id] },
    desde,
  );
  assert.equal(
    deOutraRede.some((fato) => fato.referenciaId === resposta.id),
    false,
  );
  const avisos = await listarAvisosDosChecklists(c.gestao, new Date());
  assert.equal(
    avisos.some(
      (aviso) =>
        aviso.referenciaId === resposta.id &&
        aviso.chave.startsWith("checklists:conferencia:"),
    ),
    false,
  );
  assert.ok(
    avisos.some(
      (aviso) => aviso.chave === `checklists:concluida:${resposta.id}`,
    ),
  );
  assert.ok(
    (await listarAvisosDosChecklists(c.operacao, new Date())).some(
      (aviso) => aviso.chave === `checklists:concluida:${resposta.id}`,
    ),
  );
  for (const contexto of [c.colega, c.outraUnidade, c.outraRede]) {
    assert.equal(
      (await listarAvisosDosChecklists(contexto, new Date())).some(
        (aviso) => aviso.chave === `checklists:concluida:${resposta.id}`,
      ),
      false,
    );
  }
});
