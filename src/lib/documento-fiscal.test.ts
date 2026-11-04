import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cnpjValido,
  cpfValido,
  digitoChaveFiscal,
  chaveFiscalValida,
  dadosDaChave,
  eanValido,
} from "./documento-fiscal";

const base = "3526111122233300018155001000000123112345678";
test("documentos e chave fiscal verificam dígitos, modelo e componentes", () => {
  assert.equal(cnpjValido("11222333000181"), true);
  assert.equal(cnpjValido("11222333000180"), false);
  assert.equal(cpfValido("52998224725"), true);
  assert.equal(cpfValido("11111111111"), false);
  const chave = base + digitoChaveFiscal(base);
  assert.equal(chaveFiscalValida(chave), true);
  assert.equal(
    chaveFiscalValida(chave.slice(0, -1) + (chave.endsWith("0") ? "1" : "0")),
    false,
  );
  assert.equal(chaveFiscalValida("1".repeat(44)), false);
  assert.deepEqual(dadosDaChave(chave), {
    cnpj: "11222333000181",
    modelo: "55",
    serie: "001",
    numero: "000000123",
    anoMes: "2611",
  });
  assert.equal(eanValido("7894900011517"), true);
  assert.equal(eanValido("7894900011518"), false);
});
