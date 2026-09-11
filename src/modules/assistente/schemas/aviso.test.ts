import assert from "node:assert/strict";
import { test } from "node:test";

import {
  esperaAntesDaTentativa,
  estadoPeloStatusDoProvedor,
  gerarReferencia,
  GRUPOS_DE_AVISO,
  montarCorpo,
  podeTransitar,
  type StatusAviso,
} from "./aviso";

/**
 * O CAMINHO DE UM AVISO só anda para a frente, e cada passo precisa de um
 * motivo: uma pessoa confirmou, o provedor respondeu, o WhatsApp avisou que
 * entregou. Estes testes são a lista do que NÃO pode acontecer.
 */

test("rascunho só vira confirmado ou descartado", () => {
  assert.equal(podeTransitar("RASCUNHO", "CONFIRMADO"), true);
  assert.equal(podeTransitar("RASCUNHO", "DESCARTADO"), true);
  // Pular a confirmação é exatamente o envio automático que o dono proibiu.
  assert.equal(podeTransitar("RASCUNHO", "NA_FILA"), false);
  assert.equal(podeTransitar("RASCUNHO", "ACEITO"), false);
});

test("o que foi lido ou descartado não volta a lugar nenhum", () => {
  const todos: StatusAviso[] = [
    "RASCUNHO",
    "CONFIRMADO",
    "NA_FILA",
    "ACEITO",
    "ENTREGUE",
    "LIDO",
    "INCERTO",
    "FALHOU",
    "DESCARTADO",
  ];
  for (const para of todos) {
    assert.equal(podeTransitar("LIDO", para), false, `LIDO → ${para}`);
    assert.equal(
      podeTransitar("DESCARTADO", para),
      false,
      `DESCARTADO → ${para}`,
    );
  }
});

/**
 * O INCERTO não volta para a fila sozinho: quem o tira de lá é a consulta ao
 * provedor (achou → aceito) ou uma pessoa (reenviar, descartar).
 */
test("o incerto sai por prova ou por decisão humana", () => {
  assert.equal(podeTransitar("INCERTO", "ACEITO"), true);
  assert.equal(podeTransitar("INCERTO", "CONFIRMADO"), true);
  assert.equal(podeTransitar("INCERTO", "DESCARTADO"), true);
  assert.equal(podeTransitar("INCERTO", "NA_FILA"), false);
});

test("o status do provedor nunca faz o aviso andar para trás", () => {
  assert.equal(
    estadoPeloStatusDoProvedor("ACEITO", "DELIVERY_ACK"),
    "ENTREGUE",
  );
  assert.equal(estadoPeloStatusDoProvedor("ENTREGUE", "READ"), "LIDO");
  assert.equal(estadoPeloStatusDoProvedor("ACEITO", "READ"), "LIDO");
  // O "entregue" que chega atrasado depois do "lido" não desfaz a leitura.
  assert.equal(estadoPeloStatusDoProvedor("LIDO", "DELIVERY_ACK"), null);
  assert.equal(estadoPeloStatusDoProvedor("ENTREGUE", "SERVER_ACK"), null);
  assert.equal(estadoPeloStatusDoProvedor("ACEITO", "SERVER_ACK"), null);
});

test("erro do WhatsApp depois do aceite vira falha; depois da leitura, não", () => {
  assert.equal(estadoPeloStatusDoProvedor("ACEITO", "ERROR"), "FALHOU");
  assert.equal(estadoPeloStatusDoProvedor("LIDO", "ERROR"), null);
});

test("status para aviso descartado ou em rascunho é ignorado", () => {
  assert.equal(estadoPeloStatusDoProvedor("DESCARTADO", "READ"), null);
  assert.equal(estadoPeloStatusDoProvedor("RASCUNHO", "DELIVERY_ACK"), null);
});

test("o corpo: título em negrito, linhas, link e a referência no fim", () => {
  assert.equal(
    montarCorpo({
      titulo: "Fechamento pronto para revisão",
      linhas: [
        "Loja: Loja Centro (ensaio)",
        "Nota: 92% · 2 itens fora do padrão",
      ],
      link: "http://localhost:3001/checklists/abc",
      referencia: "AV-7K2PQX",
    }),
    [
      "*Fechamento pronto para revisão*",
      "Loja: Loja Centro (ensaio)",
      "Nota: 92% · 2 itens fora do padrão",
      "",
      "Revise: http://localhost:3001/checklists/abc",
      "Ref. AV-7K2PQX",
    ].join("\n"),
  );
});

test("sem link, a linha de revisão some — e o título não quebra o negrito", () => {
  assert.equal(
    montarCorpo({
      titulo: "Teste *importante*",
      linhas: ["  uma linha  ", ""],
      link: null,
      referencia: "AV-222222",
    }),
    ["*Teste importante*", "uma linha", "", "Ref. AV-222222"].join("\n"),
  );
});

/**
 * A referência vai no texto que o gerente lê, e alguém vai ditá-la por
 * telefone um dia. Sem 0/O e 1/I, que se confundem.
 */
test("a referência usa um alfabeto sem letras ambíguas", () => {
  assert.equal(
    gerarReferencia(() => 0),
    "AV-222222",
  );
  for (let i = 0; i < 200; i++) {
    assert.match(gerarReferencia(), /^AV-[2-9A-HJ-NP-Z]{6}$/);
  }
});

test("a espera entre tentativas cresce: 1, 4, 9 minutos", () => {
  assert.equal(esperaAntesDaTentativa(1), 60_000);
  assert.equal(esperaAntesDaTentativa(2), 240_000);
  assert.equal(esperaAntesDaTentativa(3), 540_000);
});

test("os grupos da tela cobrem todo status, sem repetir", () => {
  const vistos = Object.values(GRUPOS_DE_AVISO).flat();
  assert.equal(new Set(vistos).size, vistos.length);
  assert.equal(vistos.length, 9);
});
