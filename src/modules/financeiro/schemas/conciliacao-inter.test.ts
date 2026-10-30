import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  encontrarCandidatos,
  valorLiquido,
  type CandidatoInter,
} from "./conciliacao-inter";
import type { TransacaoBancaria } from "@/lib/extrato-bancario";
const t: TransacaoBancaria = {
  id: "t",
  data: "2026-11-10",
  direcao: "PAGAR",
  valor: "500.00",
  tipo: "PIX",
  titulo: "",
  descricao: "",
  documento: "11222333000181",
  nome: "Fornecedor",
};
const c: CandidatoInter = {
  id: "a",
  empresaId: "empresa",
  direcao: "PAGAR",
  saldo: "500.00",
  vencimento: new Date("2026-11-10T00:00:00Z"),
  documento: t.documento,
};
test("conciliação exige mesma empresa, direção, valor e janela de cinco dias", () => {
  const invalidos: CandidatoInter[] = [
    { ...c, id: "outra-empresa", empresaId: "outra" },
    { ...c, id: "outra-direcao", direcao: "RECEBER" },
    { ...c, id: "outro-valor", saldo: "499.99" },
    { ...c, id: "data-distante", vencimento: new Date("2026-11-16T00:00:00Z") },
    { ...c, id: "sem-empresa", empresaId: null },
  ];
  assert.deepEqual(
    encontrarCandidatos(t, [...invalidos, c], "empresa").map((x) => x.id),
    ["a"],
  );
});
test("documento desempata fornecedores de mesmo valor", () =>
  assert.deepEqual(
    encontrarCandidatos(
      t,
      [{ ...c, id: "b", documento: "99999999999" }, c],
      "empresa",
    ).map((x) => x.id),
    ["a"],
  ));
test("documento divergente conhecido não baixa por coincidência de valor", () =>
  assert.equal(
    encontrarCandidatos({ ...t, documento: "99999999999" }, [c], "empresa")
      .length,
    0,
  ));
test("data exata desempata e ambiguidade verdadeira é preservada", () => {
  const futuro = {
    ...c,
    id: "b",
    vencimento: new Date("2026-11-15T00:00:00Z"),
  };
  assert.deepEqual(
    encontrarCandidatos(t, [futuro, c], "empresa").map((x) => x.id),
    ["a"],
  );
  assert.equal(
    encontrarCandidatos(t, [c, { ...c, id: "b" }], "empresa").length,
    2,
  );
});
test("sem documento usa valor, direção e data; saldo é comparado em centavos", () => {
  assert.equal(
    encontrarCandidatos({ ...t, documento: null }, [c], "empresa").length,
    1,
  );
  assert.equal(
    valorLiquido({
      valor: "100.00",
      desconto: "10.00",
      multa: "2.00",
      juros: "0.01",
    }),
    9201n,
  );
});
