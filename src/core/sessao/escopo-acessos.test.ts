import test from "node:test";
import assert from "node:assert/strict";
import { acessosNaOrganizacao } from "./escopo-acessos";

test("sessão não soma o papel de outra organização nem acesso a unidade desativada", () => {
  const valido = {
    organizacaoId: "A",
    papel: { organizacaoId: "A" },
    unidade: { organizacaoId: "A", ativa: true, excluidoEm: null },
  };
  const outros = [
    {
      ...valido,
      organizacaoId: "B",
      papel: { organizacaoId: "B" },
      unidade: null,
    },
    { ...valido, papel: { organizacaoId: "B" } },
    { ...valido, unidade: { ...valido.unidade, organizacaoId: "B" } },
    { ...valido, unidade: { ...valido.unidade, ativa: false } },
    { ...valido, unidade: { ...valido.unidade, excluidoEm: new Date() } },
  ];
  assert.deepEqual(acessosNaOrganizacao([valido, ...outros], "A"), [valido]);
  assert.deepEqual(acessosNaOrganizacao([{ ...valido, unidade: null }], "A"), [
    { ...valido, unidade: null },
  ]);
});
