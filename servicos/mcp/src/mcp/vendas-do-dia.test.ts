import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, type AuthInfo } from "@modelcontextprotocol/server";

import { criarFonteFicticia, pedidosFicticios } from "../fontes/ficticia.js";
import type { FonteDeVendas } from "../fontes/tipos.js";
import { registroSilencioso } from "../registro.js";
import { criarServidorMcp, lerExtra } from "./servidor-mcp.js";
import { AVISO_FICTICIO, type ChamadaRegistrada } from "./vendas-do-dia.js";

const authInfo: AuthInfo = {
  token: "tmcp_ensaio",
  clientId: "https://claude.ai/oauth/ensaio",
  scopes: ["vendas:ler"],
  expiresAt: Math.floor(Date.now() / 1000) + 3600,
  extra: {
    conexaoId: "cx_1",
    usuarioId: "usr_gerente",
    unidadeId: "uni_centro",
    unidadeNome: "Vitaliano Centro",
  },
};

async function conectar(
  opcoes: {
    fonte?: FonteDeVendas;
    tempoMaximoMs?: number;
    registrarChamada?: (chamada: ChamadaRegistrada) => Promise<void>;
  } = {},
) {
  const chamadas: ChamadaRegistrada[] = [];
  const servidor = criarServidorMcp(authInfo, {
    fonte: opcoes.fonte ?? criarFonteFicticia(),
    registro: registroSilencioso,
    registrarChamada:
      opcoes.registrarChamada ??
      (async (chamada) => {
        chamadas.push(chamada);
      }),
    agora: () => new Date("2026-09-11T15:00:00Z"),
    tempoMaximoMs: opcoes.tempoMaximoMs,
  });
  const [ladoCliente, ladoServidor] = InMemoryTransport.createLinkedPair();
  await servidor.connect(ladoServidor);
  const cliente = new Client({ name: "ensaio", version: "1.0.0" });
  await cliente.connect(ladoCliente);
  return {
    cliente,
    chamadas,
    async fechar() {
      await cliente.close();
      await servidor.close();
    },
  };
}

function textoDe(resultado: { content?: unknown }): string {
  const blocos = (resultado.content ?? []) as { type: string; text?: string }[];
  return blocos.map((bloco) => bloco.text ?? "").join(" ");
}

describe("vendas_do_dia", () => {
  it("aparece na lista como somente leitura, pedindo só a data", async () => {
    const { cliente, fechar } = await conectar();
    const { tools } = await cliente.listTools();
    await fechar();

    const ferramenta = tools.find((t) => t.name === "vendas_do_dia");
    assert.ok(ferramenta);
    assert.equal(ferramenta.annotations?.readOnlyHint, true);
    assert.equal(ferramenta.annotations?.destructiveHint, false);
    assert.deepEqual(Object.keys(ferramenta.inputSchema.properties ?? {}), [
      "data",
    ]);
  });

  it("devolve quantidade e total iguais ao cálculo independente da fonte", async () => {
    const { cliente, chamadas, fechar } = await conectar();
    const resultado = await cliente.callTool({
      name: "vendas_do_dia",
      arguments: { data: "2026-09-10" },
    });
    await fechar();

    const pedidos = pedidosFicticios({
      unidadeId: "uni_centro",
      data: "2026-09-10",
    });
    const esperado = pedidos.reduce((s, p) => s + p.valorCentavos, 0);
    const dados = resultado.structuredContent as Record<string, unknown>;

    assert.equal(resultado.isError, undefined);
    assert.equal(dados.quantidade_vendas, pedidos.length);
    assert.equal(dados.total_centavos, esperado);
    assert.equal(dados.total, esperado / 100);
    assert.equal(dados.unidade, "Vitaliano Centro");
    assert.equal(dados.fonte, "ficticia");
    assert.equal(dados.aviso, AVISO_FICTICIO);
    assert.ok(textoDe(resultado).startsWith("DADOS FICTÍCIOS"));
    assert.equal(chamadas.length, 1);
    assert.equal(chamadas[0]?.resultado, "ok");
    assert.deepEqual(chamadas[0]?.argumentos, { data: "2026-09-10" });
    assert.equal(chamadas[0]?.conexaoId, "cx_1");
  });

  it("recusa data em formato errado como erro de ferramenta", async () => {
    const { cliente, fechar } = await conectar();
    const resultado = await cliente.callTool({
      name: "vendas_do_dia",
      arguments: { data: "10/09/2026" },
    });
    await fechar();

    assert.equal(resultado.isError, true);
    assert.match(textoDe(resultado), /AAAA-MM-DD/);
  });

  it("transforma falha da fonte em isError sem vazar o detalhe interno", async () => {
    const quebrada: FonteDeVendas = {
      nome: "ficticia",
      ehFicticia: true,
      async vendasDoDia() {
        throw new Error("senha do banco: xyz123");
      },
    };
    const { cliente, chamadas, fechar } = await conectar({ fonte: quebrada });
    const resultado = await cliente.callTool({
      name: "vendas_do_dia",
      arguments: { data: "2026-09-10" },
    });
    await fechar();

    assert.equal(resultado.isError, true);
    assert.ok(!textoDe(resultado).includes("xyz123"));
    assert.equal(chamadas[0]?.resultado, "erro");
  });

  it("interrompe a fonte que demora demais", async () => {
    const lenta: FonteDeVendas = {
      nome: "ficticia",
      ehFicticia: true,
      vendasDoDia: () => new Promise(() => {}),
    };
    const { cliente, fechar } = await conectar({
      fonte: lenta,
      tempoMaximoMs: 50,
    });
    const resultado = await cliente.callTool({
      name: "vendas_do_dia",
      arguments: { data: "2026-09-10" },
    });
    await fechar();

    assert.equal(resultado.isError, true);
    assert.match(textoDe(resultado), /demorou/);
  });

  it("responde mesmo quando o registro da chamada falha", async () => {
    const { cliente, fechar } = await conectar({
      registrarChamada: async () => {
        throw new Error("banco fora");
      },
    });
    const resultado = await cliente.callTool({
      name: "vendas_do_dia",
      arguments: { data: "2026-09-10" },
    });
    await fechar();

    assert.equal(resultado.isError, undefined);
  });

  it("só aceita o extra completo da chave", () => {
    assert.equal(lerExtra(undefined), null);
    assert.equal(lerExtra({ ...authInfo, extra: { conexaoId: 1 } }), null);
    assert.deepEqual(lerExtra(authInfo), authInfo.extra);
  });
});
