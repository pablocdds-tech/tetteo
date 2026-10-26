import test from "node:test";
import assert from "node:assert/strict";
import {
  centavos,
  reais,
  dataBancaria,
  inicioNoFuso,
  diaNoFuso,
  cnpjValido,
  esquemaTransferencia,
  esquemaContaBancaria,
  validarParTransferencia,
  identidadeBancaria,
} from "./bancos";

test("centavos exatos, sinais e limite de leitura", () => {
  assert.equal(centavos("0.1") + centavos("0.2"), 30n);
  assert.equal(reais(-12345678901234n), "-123456789012.34");
  assert.equal(centavos("999999999999.99"), 99999999999999n);
  assert.throws(() => centavos("1.001"), /inválido/);
  assert.throws(() => centavos("1e3"), /inválido/);
});
test("identidade bancária reconhece marcas, separadores e zeros de preenchimento", () => {
  assert.equal(
    identidadeBancaria("Banco Santander", "0001", "000123-0"),
    identidadeBancaria("Santander", "1", "1230"),
  );
  assert.equal(
    identidadeBancaria("PagSeguro", "", "100-X"),
    identidadeBancaria("PagBank", "", "100x"),
  );
  assert.notEqual(
    identidadeBancaria("Cappta", "1", "1234"),
    identidadeBancaria("Santander", "1", "1234"),
  );
});
test("validação monetária mantém decimal com ponto e vírgula sem multiplicar a edição", () => {
  const base = {
    origemId: "a",
    destinoId: "b",
    valor: "1.234,56",
    data: "2026-10-01",
    descricao: "Repasse",
    chave: "a1b2c3d4-1234-4567-8901-123456789012",
  };
  assert.equal(esquemaTransferencia.parse(base).valor, "1234.56");
  assert.equal(
    esquemaTransferencia.parse({ ...base, valor: "1234.56" }).valor,
    "1234.56",
  );
  for (const valor of ["1.234", "0", "-1,00", "1e3", "1,000", "1..2,00"])
    assert.equal(
      esquemaTransferencia.safeParse({ ...base, valor }).success,
      false,
      valor,
    );
});
test("datas inexistentes recusadas e hoje calculado no fuso da operação", () => {
  for (const dia of ["2026-02-30", "2026-13-01", "2026-2-01", "1999-01-01"])
    assert.throws(() => dataBancaria(dia));
  assert.equal(
    dataBancaria("2024-02-29").toISOString(),
    "2024-02-29T00:00:00.000Z",
  );
  assert.equal(
    diaNoFuso(new Date("2026-10-27T01:30:00Z"), "America/Sao_Paulo"),
    "2026-10-26",
  );
  assert.equal(
    inicioNoFuso("2026-10-26", "America/Sao_Paulo").toISOString(),
    "2026-10-26T03:00:00.000Z",
  );
});
test("CNPJ tem dígitos verificadores e rejeita repetidos", () => {
  assert.equal(cnpjValido("11222333000181"), true);
  assert.equal(cnpjValido("11222333000180"), false);
  assert.equal(cnpjValido("00000000000000"), false);
});
test("compensação é PJ, não bancarizada, com abertura zero", () => {
  const conta = {
    nome: "Compensação",
    empresaId: "empresa",
    modalidade: "OUTRO",
    banco: "",
    agencia: "",
    numero: "",
    titularidade: "PJ",
    nomeTitular: "Empresa",
    saldoInicial: "0,00",
    dataInicial: "2026-10-01",
    cor: "#0066cc",
    ativa: true,
    compensacao: true,
  };
  assert.equal(esquemaContaBancaria.safeParse(conta).success, true);
  for (const delta of [
    { saldoInicial: "1,00" },
    { titularidade: "PF" },
    { numero: "123" },
    { modalidade: "CORRENTE" },
    { saldoInicial: "abc" },
  ])
    assert.equal(
      esquemaContaBancaria.safeParse({ ...conta, ...delta }).success,
      false,
    );
});
test("transferências isolam CNPJ, corte, situação e data; estorno conserva histórico inativo", () => {
  const a = {
    id: "a",
    empresaId: "empresa1",
    ativa: true,
    empresaAtiva: true,
    dataInicial: "2026-10-01",
  };
  const b = { ...a, id: "b" };
  assert.doesNotThrow(() =>
    validarParTransferencia(a, b, "2026-10-02", "2026-10-26"),
  );
  assert.throws(
    () =>
      validarParTransferencia(
        a,
        { ...b, empresaId: "empresa2" },
        "2026-10-02",
        "2026-10-26",
      ),
    /CNPJs/,
  );
  assert.throws(
    () =>
      validarParTransferencia(
        a,
        { ...b, empresaId: null },
        "2026-10-02",
        "2026-10-26",
      ),
    /CNPJ/,
  );
  assert.throws(
    () => validarParTransferencia(a, b, "2026-09-30", "2026-10-26"),
    /saldo inicial/,
  );
  assert.throws(
    () => validarParTransferencia(a, b, "2026-10-27", "2026-10-26"),
    /futuro/,
  );
  assert.throws(
    () =>
      validarParTransferencia(
        a,
        { ...b, ativa: false },
        "2026-10-02",
        "2026-10-26",
      ),
    /ativas/,
  );
  assert.doesNotThrow(() =>
    validarParTransferencia(
      a,
      { ...b, ativa: false },
      "2026-10-02",
      "2026-10-26",
      true,
    ),
  );
});
