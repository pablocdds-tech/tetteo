import assert from "node:assert/strict";
import { after, beforeEach, describe, test } from "node:test";

import {
  criarCenario,
  limparBanco,
} from "@/modules/assistente-privado/integracao/cenario";
import { db } from "@/server/db";

import { receberRegistro } from "./receber";

const SEGREDO = "s".repeat(48);
let c: Awaited<ReturnType<typeof criarCenario>>;

beforeEach(async () => {
  await limparBanco();
  c = await criarCenario();
  process.env.ASSISTENTE_PRIVADO_SEGREDO = SEGREDO;
  process.env.ASSISTENTE_PRIVADO_UNIDADE_ID = c.centro.id;
});

after(async () => {
  await db.$disconnect();
});

const valido = {
  tipo: "execucao",
  chave: "3f9a1c2e4b5d6e7f",
  estado: "calculado",
  ocorridoEm: "2026-09-11T15:00:00.000Z",
  demonstracao: true,
  avisos: [],
  pendencias: [],
};

function pedir(corpo: unknown, segredo: string | null = SEGREDO) {
  const headers = new Headers({ "content-type": "application/json" });
  if (segredo !== null) headers.set("x-assistente-segredo", segredo);
  return receberRegistro(
    new Request("http://localhost/api/assistente-privado/registros", {
      method: "POST",
      headers,
      body: typeof corpo === "string" ? corpo : JSON.stringify(corpo),
    }),
  );
}

describe("a porta dos recados", () => {
  test("sem segredo no servidor, ou curto demais, a porta fica fechada", async () => {
    process.env.ASSISTENTE_PRIVADO_SEGREDO = "";
    assert.equal((await pedir(valido)).status, 401);
    process.env.ASSISTENTE_PRIVADO_SEGREDO = "curto";
    assert.equal((await pedir(valido, "curto")).status, 401);
  });

  test("sem cabeçalho ou com segredo errado: 401, e nada gravado", async () => {
    assert.equal((await pedir(valido, null)).status, 401);
    assert.equal((await pedir(valido, "x".repeat(48))).status, 401);
    assert.equal(await db.registroDoAssistente.count(), 0);
  });

  test("unidade não configurada: 503", async () => {
    process.env.ASSISTENTE_PRIVADO_UNIDADE_ID = "";
    assert.equal((await pedir(valido)).status, 503);
  });

  test("unidade configurada mas que não existe: 503", async () => {
    process.env.ASSISTENTE_PRIVADO_UNIDADE_ID = "unidade-que-nao-existe";
    assert.equal((await pedir(valido)).status, 503);
  });

  test("não é JSON, campo a mais, grande demais: recusado, e nada gravado", async () => {
    assert.equal((await pedir("{")).status, 400);
    assert.equal(
      (await pedir({ ...valido, pedido: { itens: [] } })).status,
      400,
    );
    assert.equal(
      (await pedir({ ...valido, detalhe: "x".repeat(20_000) })).status,
      413,
    );
    assert.equal(await db.registroDoAssistente.count(), 0);
  });

  test("válido grava; o mesmo de novo não duplica", async () => {
    const primeiro = await pedir(valido);
    assert.equal(primeiro.status, 200);
    assert.equal((await primeiro.json()).ok, true);
    assert.equal((await pedir(valido)).status, 200);
    assert.equal(await db.registroDoAssistente.count(), 1);
  });

  test("recado mais antigo com a mesma chave: 200, mas gravado:false, sem sobrescrever", async () => {
    const primeiro = await pedir(valido);
    assert.equal(primeiro.status, 200);

    const maisAntigo = {
      ...valido,
      estado: "sem_dados",
      ocorridoEm: "2026-09-10T15:00:00.000Z",
    };
    const resposta = await pedir(maisAntigo);
    assert.equal(resposta.status, 200);
    assert.equal((await resposta.json()).gravado, false);

    const linha = await db.registroDoAssistente.findFirstOrThrow({
      where: { unidadeId: c.centro.id, chave: valido.chave },
    });
    assert.equal(linha.estado, "calculado");
    assert.equal(linha.ocorridoEm.toISOString(), valido.ocorridoEm);
  });
});
