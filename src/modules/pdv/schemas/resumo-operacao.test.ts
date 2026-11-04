import assert from "node:assert/strict";
import test from "node:test";
import { filtrosDaOperacao, janelaDaOperacao } from "./resumo-operacao";

test("painel usa sete dias de Brasília incluindo hoje e respeita a virada do mês", () => {
  const janela = janelaDaOperacao(new Date("2026-11-01T02:59:59Z"));
  assert.equal(janela.hoje, "2026-10-31");
  assert.equal(janela.de, "2026-10-25");
  assert.equal(janela.inicioHoje.toISOString(), "2026-10-31T03:00:00.000Z");
  assert.equal(janela.inicioSemana.toISOString(), "2026-10-25T03:00:00.000Z");
  assert.equal(janela.ate.toISOString(), "2026-11-01T02:59:59.000Z");
  const seguinte = janelaDaOperacao(new Date("2026-11-01T03:00:00Z"));
  assert.equal(seguinte.hoje, "2026-11-01");
  assert.equal(seguinte.de, "2026-10-26");
});

test("resumo conserva organização e unidade em toda consulta e exclui receita pendente ou cancelada", () => {
  const escopo = { organizacaoId: "organizacao-a", unidadeId: "unidade-a" };
  const filtros = filtrosDaOperacao(escopo, new Date("2026-11-04T18:00:00Z"));
  for (const filtro of [
    filtros.vendasHoje,
    filtros.vendasSemana,
    filtros.pedidosSemana,
    filtros.aoVivo,
  ]) {
    assert.equal(filtro.organizacaoId, escopo.organizacaoId);
    assert.equal(filtro.unidadeId, escopo.unidadeId);
  }
  assert.equal(filtros.vendasHoje.status, "CONCLUIDA");
  assert.equal(filtros.vendasSemana.status, "CONCLUIDA");
  assert.deepEqual(filtros.pedidosSemana.status, { not: "CANCELADO" });
  assert.deepEqual(filtros.pedidosSemana.OR, [
    {
      venda: {
        criadaEm: {
          gte: filtros.janela.inicioSemana,
          lte: filtros.janela.ate,
        },
      },
    },
    {
      vendaId: null,
      recebido: {
        criadoNaOrigemEm: {
          gte: filtros.janela.inicioSemana,
          lte: filtros.janela.ate,
        },
      },
    },
  ]);
  assert.deepEqual(filtros.aoVivo.status.in, [
    "COZINHA",
    "AGUARDANDO_COLETA",
    "SAIU_ENTREGA",
  ]);
  assert.equal(
    filtros.vendasSemana.criadaEm.lte.toISOString(),
    "2026-11-04T18:00:00.000Z",
  );
});
