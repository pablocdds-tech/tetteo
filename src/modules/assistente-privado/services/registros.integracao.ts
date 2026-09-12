import assert from "node:assert/strict";
import { after, beforeEach, describe, test } from "node:test";

import { db } from "@/server/db";

import { contexto, criarCenario, limparBanco } from "../integracao/cenario";
import { corpoDoRegistro, type CorpoDoRegistro } from "../schemas/registro";
import {
  UnidadeNaoConfigurada,
  cartaoDoAssistente,
  gravarRegistro,
} from "./registros";

let c: Awaited<ReturnType<typeof criarCenario>>;

beforeEach(async () => {
  await limparBanco();
  c = await criarCenario();
});

after(async () => {
  await db.$disconnect();
});

function corpo(dados: Record<string, unknown> = {}): CorpoDoRegistro {
  return corpoDoRegistro.parse({
    tipo: "execucao",
    chave: "3f9a1c2e4b5d6e7f",
    estado: "calculado",
    ocorridoEm: "2026-09-11T15:00:00.000Z",
    demonstracao: true,
    periodo: { de: "2026-08-12", ate: "2026-09-10" },
    fonte: "vendas-30-dias.csv",
    ...dados,
  });
}

describe("os recados do assistente", () => {
  test("a mesma chave duas vezes é uma linha, com o estado mais novo", async () => {
    await gravarRegistro(c.centro.id, corpo());
    await gravarRegistro(
      c.centro.id,
      corpo({ estado: "concluido", ocorridoEm: "2026-09-11T15:05:00.000Z" }),
    );
    const linhas = await db.registroDoAssistente.findMany();
    assert.equal(linhas.length, 1);
    assert.equal(linhas[0].estado, "concluido");
    assert.equal(linhas[0].organizacaoId, c.org.id);
  });

  test("recado mais antigo não passa por cima do mais novo", async () => {
    await gravarRegistro(
      c.centro.id,
      corpo({ estado: "concluido", ocorridoEm: "2026-09-11T15:05:00.000Z" }),
    );
    const r = await gravarRegistro(
      c.centro.id,
      corpo({ ocorridoEm: "2026-09-11T15:00:00.000Z" }),
    );
    assert.equal(r.gravado, false);
    assert.equal(
      (await db.registroDoAssistente.findFirstOrThrow()).estado,
      "concluido",
    );
  });

  test("concluído não volta a calculado, nem com horário mais novo", async () => {
    await gravarRegistro(
      c.centro.id,
      corpo({ estado: "concluido", ocorridoEm: "2026-09-11T15:05:00.000Z" }),
    );
    await gravarRegistro(
      c.centro.id,
      corpo({ ocorridoEm: "2026-09-11T15:10:00.000Z" }),
    );
    assert.equal(
      (await db.registroDoAssistente.findFirstOrThrow()).estado,
      "concluido",
    );
  });

  test("unidade que não existe é recusada", async () => {
    await assert.rejects(
      gravarRegistro("nao-existe", corpo()),
      UnidadeNaoConfigurada,
    );
  });

  test("uma 'proposta de compra' vira rascunho, nunca pedido", async () => {
    const antes = await db.pedido.count();
    await gravarRegistro(
      c.centro.id,
      corpo({
        chave: "rascunho:aaaaaaaaaaaaaaaa",
        estado: "preparado",
        periodo: null,
        fonte: null,
        detalhe: "Proposta de compra de farinha",
        pendencias: [
          "Rascunho esperando decisão: Proposta de compra de farinha",
        ],
      }),
    );
    assert.equal(await db.pedido.count(), antes);
  });

  test("a escrita é auditada sem usuário: quem escreveu foi a máquina", async () => {
    await gravarRegistro(c.centro.id, corpo());
    const a = await db.auditoria.findFirstOrThrow({
      where: { entidade: "RegistroDoAssistente" },
    });
    assert.deepEqual(
      [a.acao, a.usuarioId, a.unidadeId],
      ["CRIOU", null, c.centro.id],
    );
  });

  test("o cartão não mente: 21 rascunhos mais novos não escondem o fechamento de verdade", async () => {
    await gravarRegistro(
      c.centro.id,
      corpo({ estado: "concluido", ocorridoEm: "2026-09-11T15:00:00.000Z" }),
    );
    for (let i = 0; i < 21; i++) {
      await gravarRegistro(
        c.centro.id,
        corpo({
          chave: `rascunho:${i.toString().padStart(16, "0")}`,
          estado: "preparado",
          periodo: null,
          fonte: null,
          ocorridoEm: `2026-09-11T15:${(i + 1).toString().padStart(2, "0")}:00.000Z`,
          detalhe: "Proposta de compra de farinha",
          pendencias: [
            "Rascunho esperando decisão: Proposta de compra de farinha",
          ],
        }),
      );
    }
    const agora = new Date("2026-09-11T15:30:00.000Z");
    const cartao = await cartaoDoAssistente(
      await contexto(c.diretor.id, c.centro.id),
      agora,
    );
    assert.equal(cartao?.ultimaExecucao.texto, "Concluído");
  });

  test("o cartão: a Diretora vê a unidade dela; a outra unidade não enxerga; sem permissão, nada", async () => {
    await gravarRegistro(c.centro.id, corpo({ estado: "concluido" }));
    const agora = new Date("2026-09-11T15:10:00.000Z");
    const noCentro = await cartaoDoAssistente(
      await contexto(c.diretor.id, c.centro.id),
      agora,
    );
    assert.equal(noCentro?.ultimaExecucao.texto, "Concluído");
    const noSul = await cartaoDoAssistente(
      await contexto(c.diretor.id, c.sul.id),
      agora,
    );
    assert.equal(noSul?.ultimaExecucao.texto, "Nenhuma execução ainda");
    assert.equal(
      await cartaoDoAssistente(await contexto(c.caixa.id, c.centro.id), agora),
      null,
    );
  });
});
