import assert from "node:assert/strict";
import { test } from "node:test";

import { lerCsv } from "./csv.mjs";

test("ponto e vírgula, data brasileira, dinheiro com milhar", () => {
  const r = lerCsv(
    "data;loja;pedidos;valor_total;observacao\n" +
      "01/09/2026;Loja Centro;40;1.620,00;\n" +
      "02/09/2026;Loja Centro;38;1540,5;chuva\n",
  );
  assert.equal(r.ok, true);
  assert.equal(r.separador, ";");
  assert.deepEqual(
    r.linhas.map((l) => [l.linha, l.data, l.pedidos, l.centavos, l.observacao]),
    [
      [2, "2026-09-01", 40, 162000, ""],
      [3, "2026-09-02", 38, 154050, "chuva"],
    ],
  );
  assert.equal(r.linhasLidas, 2);
});

test("vírgula com aspas, aspas dobradas e BOM", () => {
  const r = lerCsv(
    '\uFEFFdata,loja,pedidos,valor_total,observacao\r\n2026-09-01,Loja Centro,40,"1.620,00","disse ""oi"""\r\n',
  );
  assert.equal(r.ok, true);
  assert.equal(r.separador, ",");
  assert.equal(r.linhas[0].centavos, 162000);
  assert.equal(r.linhas[0].observacao, 'disse "oi"');
});

test("descarta com motivo e número da linha", () => {
  const r = lerCsv(
    [
      "data;loja;pedidos;valor_total",
      "01/09/2026;Loja Centro;40",
      "31/02/2026;Loja Centro;40;10,00",
      "02/09/2026;;40;10,00",
      "03/09/2026;Loja Centro;quarenta;10,00",
      "04/09/2026;Loja Centro;40;dez",
      '05/09/2026;"Loja Centro;40;10,00',
    ].join("\n"),
  );
  assert.equal(r.ok, true);
  assert.deepEqual(r.descartadas, [
    { linha: 2, motivo: "linha incompleta" },
    { linha: 3, motivo: "data inválida" },
    { linha: 4, motivo: "loja vazia" },
    { linha: 5, motivo: "pedidos inválido" },
    { linha: 6, motivo: "valor inválido" },
    { linha: 7, motivo: "aspas sem fechar" },
  ]);
  assert.equal(r.linhas.length, 0);
  assert.equal(r.linhasLidas, 6);
});

test("só o cabeçalho é um arquivo válido, sem linhas", () => {
  const r = lerCsv("data;loja;pedidos;valor_total\n");
  assert.equal(r.ok, true);
  assert.equal(r.linhas.length, 0);
  assert.equal(r.linhasLidas, 0);
});

test("arquivo inválido diz o motivo", () => {
  assert.deepEqual(lerCsv(""), {
    ok: false,
    motivo: "o arquivo está vazio, sem cabeçalho",
    linha: null,
  });
  assert.deepEqual(lerCsv("dia;unidade;total\n1;2;3"), {
    ok: false,
    motivo: "faltam colunas no cabeçalho: data, loja, pedidos, valor_total",
    linha: 1,
  });
  assert.equal(lerCsv("data;loja\u0000").ok, false);
});

// CRÍTICO: uma linha digitada com o mês/ano errado (20/11/2026 em vez de
// 20/09/2026) não pode virar a "última data" do arquivo — ela é descartada
// como qualquer outra linha ruim, com motivo e número, e contada no total.
test("descarta linha com data no futuro (relativa a 'hoje'), contada como as demais", () => {
  const r = lerCsv(
    [
      "data;loja;pedidos;valor_total",
      "10/09/2026;Loja Centro;40;100,00",
      "11/09/2026;Loja Centro;40;100,00",
      "20/11/2026;Loja Centro;40;100,00",
    ].join("\n"),
    { hoje: "2026-09-12" },
  );
  assert.equal(r.ok, true);
  assert.deepEqual(r.descartadas, [{ linha: 4, motivo: "data no futuro" }]);
  assert.deepEqual(
    r.linhas.map((l) => l.data),
    ["2026-09-10", "2026-09-11"],
  );
  assert.equal(r.linhasLidas, 3);
});

test("uma data igual a 'hoje' não é descartada — só o que vem DEPOIS", () => {
  const r = lerCsv(
    ["data;loja;pedidos;valor_total", "12/09/2026;Loja Centro;40;100,00"].join(
      "\n",
    ),
    { hoje: "2026-09-12" },
  );
  assert.equal(r.linhas.length, 1);
  assert.equal(r.descartadas.length, 0);
});

test("sem 'hoje' informado, nenhuma linha é descartada por data (compatibilidade)", () => {
  const r = lerCsv(
    ["data;loja;pedidos;valor_total", "20/11/2099;Loja Centro;40;100,00"].join(
      "\n",
    ),
  );
  assert.equal(r.linhas.length, 1);
  assert.equal(r.descartadas.length, 0);
});
