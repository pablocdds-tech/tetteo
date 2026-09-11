import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { alcadaQueAprova, limiteDaPessoa, type Alcada } from "./alcada";
import {
  conferirTotal,
  montarLinha,
  montarPedido,
  type EntradaDaLinha,
} from "./pedido";

const entrada = (resto: Partial<EntradaDaLinha> = {}): EntradaDaLinha => ({
  insumoId: "molho",
  nome: "Molho de tomate",
  unidade: "KG",
  necessario: 20_000n,
  nomeEmbalagem: "Caixa",
  pecas: 12,
  conteudo: 9_000_000n,
  unidadeConteudo: "G",
  fracionavel: false,
  fator: 108_000n,
  precoEmbalagem: 9540n,
  origemPreco: "Proposta v1 · Distribuidora Exemplo A",
  itemDePropostaId: "oferta",
  itemDeRequisicaoId: "req",
  ...resto,
});

describe("linhas do pedido", () => {
  test("embalagem inteira: exata, com o adicional à vista", () => {
    const l = montarLinha(entrada());
    assert.equal(l.embalagensMil, 2000n);
    assert.equal(l.comprado, 21_600n);
    assert.equal(l.adicional, 1_600n);
    assert.equal(l.total, 19_080n);
  });

  test("a granel: arredonda uma vez, meio para cima", () => {
    const l = montarLinha(
      entrada({
        necessario: 6_537n,
        fator: 10_000n,
        fracionavel: true,
        precoEmbalagem: 3190n,
      }),
    );
    assert.equal(l.adicional, 0n);
    assert.equal(l.total, 20_853n);
    assert.equal(l.embalagensMil, 6_537n);
  });

  test("o total é a soma das linhas mais o frete, conferida ao centavo", () => {
    const p = montarPedido(
      [
        entrada(),
        entrada({
          insumoId: "q",
          necessario: 6_537n,
          fator: 10_000n,
          fracionavel: true,
          precoEmbalagem: 3190n,
        }),
      ],
      2500n,
    );
    assert.equal(p.subtotal, 19_080n + 20_853n);
    assert.equal(p.total, p.subtotal + 2500n);
    assert.ok(conferirTotal(p.linhas, 2500n, p.total));
    assert.equal(conferirTotal(p.linhas, 2500n, p.total + 1n), false);
  });

  test("quantidade zero não vira linha", () => {
    assert.throws(
      () => montarLinha(entrada({ necessario: 0n })),
      /maior que zero/,
    );
  });
});

describe("alçada", () => {
  const alcadas: Alcada[] = [
    { id: "d", papelId: "diretor", limite: null, versao: 1 },
    { id: "g", papelId: "gerente", limite: 100_000n, versao: 3 },
  ];

  test("sem limite aprova qualquer valor", () => {
    assert.equal(alcadaQueAprova(alcadas, ["diretor"], 99_999_999n)?.id, "d");
  });

  test("R$ 1.000 aprova R$ 1.000,00 e não aprova R$ 1.000,01", () => {
    assert.equal(alcadaQueAprova(alcadas, ["gerente"], 100_000n)?.id, "g");
    assert.equal(alcadaQueAprova(alcadas, ["gerente"], 100_001n), null);
  });

  test("papel sem alçada não aprova nada", () => {
    assert.equal(alcadaQueAprova(alcadas, ["cozinha"], 1n), null);
    assert.equal(limiteDaPessoa(alcadas, ["cozinha"]), undefined);
  });

  test("duas alçadas: vale a maior", () => {
    assert.equal(alcadaQueAprova(alcadas, ["gerente", "diretor"], 1n)?.id, "d");
    assert.equal(limiteDaPessoa(alcadas, ["gerente", "diretor"]), null);
    assert.equal(limiteDaPessoa(alcadas, ["gerente"]), 100_000n);
  });
});
