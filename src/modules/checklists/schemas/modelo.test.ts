import assert from "node:assert/strict";
import { test } from "node:test";

import {
  esquemaItemModelo,
  esquemaLeituraNumero,
  esquemaPrazoResposta,
  esquemaValorItem,
} from "./modelo";

test("seleção precisa de opções distintas e aceita uma opção por linha já normalizada", () => {
  const base = {
    texto: "Estado da bancada",
    tipo: "SELECAO_UNICA",
    opcoes: ["Limpa", "Suja"],
  };
  assert.equal(esquemaItemModelo.safeParse(base).success, true);
  assert.equal(
    esquemaItemModelo.safeParse({ ...base, opcoes: ["Limpa"] }).success,
    false,
  );
  assert.equal(
    esquemaItemModelo.safeParse({ ...base, opcoes: ["Limpa", " Limpa "] })
      .success,
    false,
  );
  assert.equal(
    esquemaItemModelo.safeParse({
      ...base,
      opcoes: Array.from({ length: 31 }, (_, i) => String(i)),
    }).success,
    false,
  );
});

test("conferência IA exige critério escrito pelo gestor", () => {
  const base = {
    texto: "Bancada higienizada?",
    tipo: "SIM_NAO",
    analisarIA: true,
  };
  assert.equal(esquemaItemModelo.safeParse(base).success, false);
  assert.equal(
    esquemaItemModelo.safeParse({
      ...base,
      criterioIA: "Verificar sujeira visível na bancada.",
    }).success,
    true,
  );
});

test("leituras de freezer continuam negativas; infinito e valores fora do banco são recusados", () => {
  assert.equal(esquemaLeituraNumero.parse("-18,5"), -18.5);
  for (const numero of ["Infinity", "1e999", "100000000000"])
    assert.equal(esquemaLeituraNumero.safeParse(numero).success, false);
  for (const valorNumero of [NaN, Infinity, -Infinity])
    assert.equal(esquemaValorItem.safeParse({ valorNumero }).success, false);
});

test("resposta não aceita campos extras, texto ilimitado ou seleções excessivas", () => {
  assert.equal(
    esquemaValorItem.safeParse({ resultadoIA: "APROVADO" }).success,
    false,
  );
  assert.equal(
    esquemaValorItem.safeParse({ valorTexto: "a".repeat(5001) }).success,
    false,
  );
  assert.equal(
    esquemaValorItem.safeParse({ valorSelecao: Array(31).fill("opção") })
      .success,
    false,
  );
});

test("prazo compartilhado exige fuso e uma data possível", () => {
  assert.equal(
    esquemaPrazoResposta.safeParse("2026-11-04T18:30:00-03:00").success,
    true,
  );
  assert.equal(
    esquemaPrazoResposta.safeParse("2026-11-04T21:30:00.000Z").success,
    true,
  );
  assert.equal(
    esquemaPrazoResposta.safeParse("2026-11-04T18:30").success,
    false,
  );
  assert.equal(
    esquemaPrazoResposta.safeParse("2026-02-31T18:30:00-03:00").success,
    false,
  );
});
