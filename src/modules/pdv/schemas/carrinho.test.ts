import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { ConteudoCarrinho } from "../carrinho-types";
import type { ProdutoPdv } from "../types";
import { atualizarConteudoCarrinho, esquemaSalvarCarrinho } from "./carrinho";
import { esquemaFinalizar } from "./venda";

const conteudo: ConteudoCarrinho = {
  modalidade: "BALCAO",
  observacao: "Sem gelo",
  itens: [{ produtoId: "bebida", quantidade: 2, opcoes: [], observacao: "" }],
};
const produto: ProdutoPdv = {
  id: "bebida",
  nome: "Bebida",
  categoria: "Bebidas",
  codigo: "1",
  precoCentavos: 900,
  grupos: [],
};
test("rascunho recusa pagamentos e preços em vez de persistir dados de cobrança", () => {
  const base = { id: randomUUID(), versao: 0, nome: "Balcão", conteudo };
  assert.equal(esquemaSalvarCarrinho.safeParse(base).success, true);
  assert.equal(
    esquemaSalvarCarrinho.safeParse({
      ...base,
      pagamentos: [{ forma: "PIX", valorCentavos: 1800 }],
    }).success,
    false,
  );
  assert.equal(
    esquemaSalvarCarrinho.safeParse({
      ...base,
      conteudo: { ...conteudo, totalCentavos: 1800 },
    }).success,
    false,
  );
  assert.equal(
    esquemaSalvarCarrinho.safeParse({
      ...base,
      conteudo: {
        ...conteudo,
        itens: [{ ...conteudo.itens[0], precoCentavos: 900 }],
      },
    }).success,
    false,
  );
});
test("retomada mantém referências e usa somente catálogo atual, sem alterar rascunho", () => {
  const antes = structuredClone(conteudo);
  const atual = atualizarConteudoCarrinho(conteudo, [produto]);
  assert.deepEqual(atual.conteudo, antes);
  assert.match(atual.avisos[0], /Preços atualizados/);
  assert.equal("precoCentavos" in atual.conteudo.itens[0], false);
});
test("produto ou opção removidos recusam retomada sem apagar escolhas", () => {
  const antes = structuredClone(conteudo);
  assert.throws(() => atualizarConteudoCarrinho(conteudo, []), /preservado/);
  assert.deepEqual(conteudo, antes);
  const comOpcao = {
    ...conteudo,
    itens: [{ ...conteudo.itens[0], opcoes: ["indisponivel"] }],
  };
  assert.throws(() => atualizarConteudoCarrinho(comOpcao, [produto]), /opções/);
  assert.deepEqual(comOpcao.itens[0].opcoes, ["indisponivel"]);
});
test("conclusão exige carrinho e versão juntos", () => {
  const base = {
    chave: randomUUID(),
    caixaId: "caixa",
    modalidade: "BALCAO",
    observacao: "",
    itens: conteudo.itens,
    descontoCentavos: 0,
    taxaCentavos: 0,
    pagamentos: [{ forma: "PIX", valorCentavos: 100 }],
  };
  assert.equal(
    esquemaFinalizar.safeParse({ ...base, carrinhoId: randomUUID() }).success,
    false,
  );
  assert.equal(
    esquemaFinalizar.safeParse({ ...base, versaoCarrinho: 1 }).success,
    false,
  );
  assert.equal(
    esquemaFinalizar.safeParse({
      ...base,
      carrinhoId: randomUUID(),
      versaoCarrinho: 1,
    }).success,
    true,
  );
});
