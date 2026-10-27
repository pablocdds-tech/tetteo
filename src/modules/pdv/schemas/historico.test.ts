import assert from "node:assert/strict";
import test from "node:test";
import {
  analisarHistorico,
  buscaLiteral,
  celulaCsvHistorico,
  numeroBuscado,
} from "./historico";

test("histórico usa hoje São Paulo e valida datas e ordem do período", () => {
  const filtros = analisarHistorico({}, new Date("2026-10-27T01:30:00Z"));
  assert.equal(filtros.de, "2026-10-26");
  assert.equal(filtros.ate, "2026-10-26");
  assert.equal(filtros.pagina, 1);
  assert.throws(
    () => analisarHistorico({ de: "2026-02-30", ate: "2026-03-01" }),
    /data válida/,
  );
  assert.throws(
    () => analisarHistorico({ de: "2026-10-28", ate: "2026-10-27" }),
    /posterior/,
  );
});
test("filtros recusam canal inventado, página inválida e busca longa", () => {
  assert.throws(() => analisarHistorico({ canal: "IFOOD" }));
  assert.throws(() => analisarHistorico({ pagina: 0 }));
  assert.throws(() => analisarHistorico({ pagina: 1.5 }));
  assert.throws(() => analisarHistorico({ busca: "a".repeat(101) }));
  assert.equal(analisarHistorico({ pagina: "2" }).pagina, 2);
});
test("número é exato e busca trata curingas como caracteres literais", () => {
  assert.equal(numeroBuscado("#123"), 123);
  assert.equal(numeroBuscado("00123"), 123);
  assert.equal(numeroBuscado("2147483648"), null);
  assert.equal(numeroBuscado("12x"), null);
  assert.equal(buscaLiteral("100%_\\"), "100\\%\\_\\\\");
});
test("CSV escapa aspas, separadores e neutraliza fórmulas após espaços e controles", () => {
  assert.equal(celulaCsvHistorico('nome; "especial"'), '"nome; ""especial"""');
  for (const valor of [
    "=1+1",
    "+formula",
    "-formula",
    "@SUM(1)",
    " \t=1+1",
    "\r\n@formula",
  ])
    assert.ok(celulaCsvHistorico(valor).startsWith("\"'"));
  assert.equal(celulaCsvHistorico("nome normal"), '"nome normal"');
});
