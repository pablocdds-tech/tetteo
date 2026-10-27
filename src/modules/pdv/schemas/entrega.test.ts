import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { AreaEntrega, EntregaEntrada } from "../entrega-types";
import {
  conferirAreaEntrega,
  esquemaAreaEntrega,
  esquemaEnderecoEntrega,
  esquemaEntregaEntrada,
  esquemaEntregaSnapshot,
  esquemaTelefoneEntrega,
  normalizarEntrega,
  UFS_ENTREGA,
} from "./entrega";

const entrada: EntregaEntrada = {
  destinatario: "Pessoa fictícia",
  telefone: "",
  endereco: {
    logradouro: "Rua fictícia",
    numero: "10",
    complemento: "",
    bairro: "Nova Betânia",
    cidade: "Mossoró",
    uf: "RN",
    cep: "",
    referencia: "",
  },
  freteCentavos: 500,
  prazoMinutos: 40,
  motivoFreteManual: "Frete combinado",
};
test("endereço exige dados mínimos e aceita somente UFs e CEP brasileiros", () => {
  assert.equal(
    esquemaEnderecoEntrega.safeParse(entrada.endereco).success,
    true,
  );
  assert.equal(UFS_ENTREGA.length, 27);
  assert.equal(
    esquemaEnderecoEntrega.safeParse({ ...entrada.endereco, logradouro: "" })
      .success,
    false,
  );
  assert.equal(
    esquemaEnderecoEntrega.safeParse({ ...entrada.endereco, uf: "XX" }).success,
    false,
  );
  assert.equal(
    esquemaEnderecoEntrega.safeParse({ ...entrada.endereco, cep: "letras" })
      .success,
    false,
  );
  assert.equal(
    esquemaEnderecoEntrega.parse({
      ...entrada.endereco,
      cep: "59600-000",
      uf: "rn",
    }).cep,
    "59600000",
  );
});
test("telefone opcional aceita dígitos brasileiros e normaliza DDI e máscara", () => {
  assert.equal(esquemaTelefoneEntrega.parse(""), "");
  assert.equal(
    esquemaTelefoneEntrega.parse("+55 (84) 99999-1234"),
    "84999991234",
  );
  assert.equal(esquemaTelefoneEntrega.safeParse("abc").success, false);
  assert.equal(esquemaTelefoneEntrega.safeParse("+").success, false);
  assert.equal(esquemaTelefoneEntrega.safeParse("123").success, false);
});
test("frete manual precisa de motivo, área precisa de versão e valores inteiros", () => {
  assert.equal(esquemaEntregaEntrada.safeParse(entrada).success, true);
  assert.equal(
    esquemaEntregaEntrada.safeParse({ ...entrada, motivoFreteManual: "" })
      .success,
    false,
  );
  assert.equal(
    esquemaEntregaEntrada.safeParse({ ...entrada, areaId: randomUUID() })
      .success,
    false,
  );
  assert.equal(
    esquemaEntregaEntrada.safeParse({ ...entrada, freteCentavos: 1.5 }).success,
    false,
  );
  assert.equal(
    esquemaEntregaEntrada.safeParse({ ...entrada, usuarioId: "intruso" })
      .success,
    false,
  );
});
test("cobertura normaliza acentos e espaços, sem ignorar cidade/UF ou versão da cotação", () => {
  const area: AreaEntrega = {
    id: randomUUID(),
    versao: 2,
    nome: "Nova Betânia",
    cidade: "Mossoró",
    uf: "RN",
    bairros: ["Nova Betânia"],
    freteCentavos: 500,
    prazoMinutos: 40,
    ativa: true,
    atualizadoEm: new Date().toISOString(),
  };
  const cotada = {
    ...entrada,
    areaId: area.id,
    versaoArea: 2,
    endereco: {
      ...entrada.endereco,
      bairro: "  nova  betania  ",
      cidade: "mossoro",
    },
  };
  assert.doesNotThrow(() => conferirAreaEntrega(area, cotada));
  assert.equal(normalizarEntrega("  NOVA  BETÂNIA "), "nova betania");
  assert.throws(
    () => conferirAreaEntrega(area, { ...cotada, freteCentavos: 0 }),
    /mudou/,
  );
  assert.throws(
    () => conferirAreaEntrega(area, { ...cotada, versaoArea: 1 }),
    /mudou/,
  );
  assert.throws(
    () =>
      conferirAreaEntrega(area, {
        ...cotada,
        endereco: { ...cotada.endereco, uf: "CE" },
      }),
    /estado/,
  );
  assert.throws(
    () =>
      conferirAreaEntrega(area, {
        ...cotada,
        endereco: { ...cotada.endereco, bairro: "Outro bairro" },
      }),
    /bairro/,
  );
  assert.doesNotThrow(() =>
    conferirAreaEntrega({ ...area, bairros: [] }, cotada),
  );
  assert.throws(
    () => conferirAreaEntrega({ ...area, ativa: false }, cotada),
    /inativa/,
  );
});
test("cadastro recusa bairros repetidos por acento e snapshot exige prazo ISO", () => {
  assert.equal(
    esquemaAreaEntrega.safeParse({
      id: randomUUID(),
      versao: 0,
      nome: "Centro",
      cidade: "Mossoró",
      uf: "RN",
      bairros: ["Betânia", "Betania"],
      freteCentavos: 0,
      prazoMinutos: 30,
      ativa: true,
    }).success,
    false,
  );
  assert.equal(
    esquemaEntregaSnapshot.safeParse({
      ...entrada,
      areaNome: null,
      previstoEm: "2026-10-27T19:00:00.000Z",
    }).success,
    true,
  );
  assert.equal(
    esquemaEntregaSnapshot.safeParse({
      ...entrada,
      areaNome: null,
      previstoEm: "amanhã",
    }).success,
    false,
  );
});
