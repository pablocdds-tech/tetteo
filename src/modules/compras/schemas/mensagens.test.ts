import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MARCADOR_DO_LINK,
  referenciaDoPedido,
  textoDaAlteracao,
  textoDoAdendo,
  textoDoConvite,
  textoDoPedido,
} from "./mensagens";
import { desistiu, proximaTentativa } from "./ritmo-envio";

const cabecalho = {
  organizacao: "Rede Exemplo",
  fornecedor: "Distribuidora Exemplo A",
  contato: "Carla",
  loja: "Loja Exemplo Centro",
  endereco: "Rua Exemplo, 100",
  entrega: "12/09 a 13/09",
  condicaoPagamento: "28 dias",
};

const linha = {
  nome: "Molho de tomate",
  quanto: "2 × Caixa (12 × 900 g)",
  quantidade: "21,6 kg",
  preco: "R$ 95,40 a caixa",
  total: "R$ 190,80",
};

test("a referência tem número e sequência", () => {
  assert.equal(referenciaDoPedido(104, 1), "PC-0104/1");
  assert.equal(referenciaDoPedido(12345, 3), "PC-12345/3");
});

test("o pedido leva itens, total e a referência no fim", () => {
  const t = textoDoPedido({
    ...cabecalho,
    referencia: "PC-0104/1",
    itens: [linha],
    subtotal: "R$ 190,80",
    frete: "R$ 25,00",
    total: "R$ 215,80",
    observacao: null,
  });
  assert.match(t, /\*Pedido PC-0104\/1 — Rede Exemplo\*/);
  assert.match(t, /Molho de tomate: 2 × Caixa \(12 × 900 g\) = 21,6 kg/);
  assert.match(t, /\*Total: R\$ 215,80\*/);
  assert.ok(t.trimEnd().endsWith("Ref. PC-0104/1"));
});

test("o adendo diz que o original continua valendo", () => {
  const t = textoDoAdendo({
    ...cabecalho,
    referencia: "PC-0104/2",
    pedidoOriginal: "PC-0104/1",
    itens: [linha],
    total: "R$ 190,80",
  });
  assert.match(t, /O pedido original continua valendo/);
  assert.ok(t.trimEnd().endsWith("Ref. PC-0104/2"));
});

test("a alteração mostra antes e depois, e pede concordância", () => {
  const t = textoDaAlteracao({
    referencia: "PC-0104/3",
    pedidoOriginal: "PC-0104/1",
    organizacao: "Rede Exemplo",
    fornecedor: "Distribuidora Exemplo A",
    cancelamento: false,
    mudancas: [
      { nome: "Molho de tomate", antes: "2 caixas", depois: "1 caixa" },
    ],
    motivo: "Chegou doação de outra loja",
  });
  assert.match(t, /de 2 caixas para 1 caixa/);
  assert.match(t, /de acordo/);
});

test("o convite leva o marcador do link, nunca o código", () => {
  const t = textoDoConvite({
    organizacao: "Rede Exemplo",
    fornecedor: "Distribuidora Exemplo A",
    contato: null,
    rodada: "Rodada 12",
    prazo: "12/09 às 10:00",
    itens: [{ nome: "Molho de tomate", quantidade: "14,5 kg" }],
  });
  assert.ok(t.includes(MARCADOR_DO_LINK));
  assert.doesNotMatch(t, /R\$/); // nenhum preço — nem de referência
});

test("novas tentativas: 1, 4, 9, 16 minutos, e desiste na quinta", () => {
  const agora = new Date("2026-09-10T12:00:00Z");
  assert.equal(
    proximaTentativa(1, agora).toISOString(),
    "2026-09-10T12:01:00.000Z",
  );
  assert.equal(
    proximaTentativa(4, agora).toISOString(),
    "2026-09-10T12:16:00.000Z",
  );
  assert.equal(desistiu(4), false);
  assert.equal(desistiu(5), true);
});
