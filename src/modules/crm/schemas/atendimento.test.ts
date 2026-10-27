import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  esquemaAlterarEnderecoAtendimento,
  esquemaCriarClienteAtendimento,
  esquemaEnderecoAtendimento,
  esquemaListaClientesAtendimento,
} from "./atendimento";

const endereco = {
  logradouro: " Rua das Flores ",
  numero: "10",
  complemento: "",
  bairro: "Centro",
  cidade: "São Paulo",
  uf: " sp ",
  cep: "01001-000",
  referencia: "",
};
test("atendimento normaliza telefone e endereço sem consentimento implícito", () => {
  const entrada = {
    storeId: randomUUID(),
    chaveUUID: randomUUID(),
    nome: " Maria ",
    telefone: "(11) 98765-4321",
  };
  const cliente = esquemaCriarClienteAtendimento.parse(entrada);
  assert.equal(cliente.telefone, "5511987654321");
  assert.equal(cliente.nome, "Maria");
  assert.equal(
    esquemaCriarClienteAtendimento.safeParse({
      ...entrada,
      marketingOptIn: true,
    }).success,
    false,
  );
  const parsed = esquemaEnderecoAtendimento.parse(endereco);
  assert.equal(parsed.uf, "SP");
  assert.equal(parsed.cep, "01001000");
  assert.equal(parsed.logradouro, "Rua das Flores");
});
test("endereço rejeita UF inventada, CEP incompleto e principal inativo", () => {
  assert.equal(
    esquemaEnderecoAtendimento.safeParse({ ...endereco, uf: "XX" }).success,
    false,
  );
  assert.equal(
    esquemaEnderecoAtendimento.safeParse({ ...endereco, cep: "123" }).success,
    false,
  );
  const dados = {
    storeId: randomUUID(),
    chaveUUID: randomUUID(),
    rotulo: "Casa",
    principal: true,
    ativo: false,
    versao: 1,
    endereco,
  };
  assert.equal(
    esquemaAlterarEnderecoAtendimento.safeParse(dados).success,
    false,
  );
  assert.equal(
    esquemaAlterarEnderecoAtendimento.safeParse({
      ...dados,
      principal: false,
      versao: 0,
    }).success,
    false,
  );
  assert.equal(
    esquemaAlterarEnderecoAtendimento.safeParse({ ...dados, principal: false })
      .success,
    true,
  );
});
test("busca limita entrada e paginação sem aceitar campos de outro escopo", () => {
  const dados = { storeId: randomUUID() };
  assert.equal(esquemaListaClientesAtendimento.parse(dados).pagina, 1);
  assert.equal(
    esquemaListaClientesAtendimento.parse({ ...dados, pagina: "26" }).pagina,
    26,
  );
  for (const extra of [
    { pagina: "0" },
    { pagina: "1.5" },
    { busca: "x".repeat(101) },
    { organizacaoId: randomUUID() },
  ])
    assert.equal(
      esquemaListaClientesAtendimento.safeParse({ ...dados, ...extra }).success,
      false,
    );
});
