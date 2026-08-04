import assert from "node:assert/strict";
import { test } from "node:test";

import {
  compararPropostas,
  precoUnitario,
  type ItemDaCotacao,
  type PropostaParaComparar,
} from "./comparacao";

/**
 * Cada caso abaixo é uma forma de escolher o fornecedor errado — e escolher
 * errado numa cotação de pizzaria custa alguns por cento do custo de comida,
 * toda semana, o ano inteiro.
 */

const MUSSARELA: ItemDaCotacao = {
  id: "mussarela",
  nome: "Mussarela",
  quantidade: 40,
  unidade: "KG",
};
const OREGANO: ItemDaCotacao = {
  id: "oregano",
  nome: "Orégano",
  quantidade: 0.2,
  unidade: "KG",
};

function proposta(
  id: string,
  precos: { itemId: string; precoUnitario: number; naoAtende?: boolean }[],
  extra: Partial<PropostaParaComparar> = {},
): PropostaParaComparar {
  return {
    fornecedorId: id,
    fornecedorNome: id,
    status: "RESPONDIDA",
    frete: 0,
    pedidoMinimo: null,
    precos: precos.map((p) => ({
      itemId: p.itemId,
      precoUnitario: p.precoUnitario,
      embalagem: null,
      naoAtende: p.naoAtende ?? false,
    })),
    ...extra,
  };
}

test("a caixa de 10 kg por R$ 300 é R$ 30 o quilo — e ganha do quilo a R$ 31", () => {
  // A conta que se erra de cabeça: R$ 300 parece dez vezes pior que R$ 31.
  assert.equal(precoUnitario(300, 10), 30);
  assert.equal(precoUnitario(31, 1), 31);
  assert.equal(precoUnitario(300, 0), null);
});

test("o vencedor de cada item é o menor preço unitário", () => {
  const c = compararPropostas(
    [MUSSARELA],
    [
      proposta("A", [{ itemId: "mussarela", precoUnitario: 31 }]),
      proposta("B", [{ itemId: "mussarela", precoUnitario: 30 }]),
    ],
  );

  assert.equal(c.grade[0].vencedorId, "B");
  assert.equal(c.grade[0].melhorTotal, 1200);
});

test("a QUANTIDADE decide: barato no que se compra pouco não compensa", () => {
  // A é 3% mais caro na mussarela (40 kg) e metade do preço no orégano (200 g).
  // Comparando preço unitário item a item, A "ganha" um de dois. No total, ele
  // perde por R$ 36 — e é o total que sai do caixa.
  const c = compararPropostas(
    [MUSSARELA, OREGANO],
    [
      proposta("A", [
        { itemId: "mussarela", precoUnitario: 31 },
        { itemId: "oregano", precoUnitario: 40 },
      ]),
      proposta("B", [
        { itemId: "mussarela", precoUnitario: 30 },
        { itemId: "oregano", precoUnitario: 80 },
      ]),
    ],
  );

  const a = c.totais.find((t) => t.fornecedorId === "A")!;
  const b = c.totais.find((t) => t.fornecedorId === "B")!;

  assert.equal(a.total, 1248); // 40×31 + 0,2×40
  assert.equal(b.total, 1216); // 40×30 + 0,2×80
  assert.equal(c.melhorFornecedorUnico?.fornecedorId, "B");
});

test("o frete entra no total — 2% mais barato com R$ 80 de entrega não é mais barato", () => {
  const c = compararPropostas(
    [MUSSARELA],
    [
      proposta("A", [{ itemId: "mussarela", precoUnitario: 31 }]),
      proposta("B", [{ itemId: "mussarela", precoUnitario: 30 }], {
        frete: 80,
      }),
    ],
  );

  assert.equal(c.totais[0].fornecedorId, "A"); // 1240 contra 1280
  assert.equal(c.melhorFornecedorUnico?.fornecedorId, "A");
});

test("quem não atinge o pedido mínimo sai da disputa do fornecedor único", () => {
  const c = compararPropostas(
    [OREGANO],
    [
      proposta("A", [{ itemId: "oregano", precoUnitario: 40 }], {
        pedidoMinimo: 500,
      }),
      proposta("B", [{ itemId: "oregano", precoUnitario: 80 }]),
    ],
  );

  assert.equal(
    c.totais.find((t) => t.fornecedorId === "A")!.abaixoDoMinimo,
    true,
  );
  assert.equal(c.melhorFornecedorUnico?.fornecedorId, "B");
});

test("quem cotou parte não é comparado pelo total como se cotasse tudo", () => {
  // Senão o incompleto ganharia sempre — ele soma menos linhas.
  const c = compararPropostas(
    [MUSSARELA, OREGANO],
    [
      proposta("A", [{ itemId: "mussarela", precoUnitario: 20 }]),
      proposta("B", [
        { itemId: "mussarela", precoUnitario: 30 },
        { itemId: "oregano", precoUnitario: 80 },
      ]),
    ],
  );

  const a = c.totais.find((t) => t.fornecedorId === "A")!;
  assert.equal(a.completo, false);
  assert.equal(a.itensCotados, 1);
  assert.equal(c.melhorFornecedorUnico?.fornecedorId, "B");
});

test('"não atende" é diferente de não ter respondido, e nenhum dos dois é grátis', () => {
  const c = compararPropostas(
    [MUSSARELA, OREGANO],
    [
      proposta("A", [
        { itemId: "mussarela", precoUnitario: 30 },
        { itemId: "oregano", precoUnitario: 0, naoAtende: true },
      ]),
    ],
  );

  const celula = c.grade[1].celulas[0];
  assert.equal(celula.naoAtende, true);
  assert.equal(celula.total, null);
  assert.equal(c.totais[0].completo, false);
});

test("proposta ainda não respondida não entra na comparação", () => {
  // Um AGUARDANDO somaria zeros e apareceria como o mais barato de todos.
  const c = compararPropostas(
    [MUSSARELA],
    [
      proposta("A", [{ itemId: "mussarela", precoUnitario: 30 }]),
      proposta("B", [], { status: "AGUARDANDO" }),
    ],
  );

  assert.equal(c.totais.length, 1);
  assert.equal(c.grade[0].celulas.length, 1);
});

test("o cenário dividido soma o frete de CADA fornecedor envolvido", () => {
  // Três entregas custam três fretes. Somar um só faria o dividido ganhar
  // sempre, e a diferença apareceria quando as notas chegassem.
  const c = compararPropostas(
    [MUSSARELA, OREGANO],
    [
      proposta(
        "A",
        [
          { itemId: "mussarela", precoUnitario: 30 },
          { itemId: "oregano", precoUnitario: 100 },
        ],
        { frete: 50 },
      ),
      proposta(
        "B",
        [
          { itemId: "mussarela", precoUnitario: 32 },
          { itemId: "oregano", precoUnitario: 40 },
        ],
        { frete: 60 },
      ),
    ],
  );

  // mercadoria: 40×30 (A) + 0,2×40 (B) = 1208; fretes 50 + 60 = 110
  assert.equal(c.divididoTotal, 1318);
  assert.equal(c.divididoFornecedores, 2);
  // A sozinho: 1200 + 20 + 50 = 1270 → dividido é PIOR por causa do frete.
  assert.equal(c.melhorFornecedorUnico?.total, 1270);
  assert.equal(c.economiaDoDividido, -48);
});

test("quando o dividido compensa, a economia aparece positiva", () => {
  const c = compararPropostas(
    [MUSSARELA, OREGANO],
    [
      proposta("A", [
        { itemId: "mussarela", precoUnitario: 30 },
        { itemId: "oregano", precoUnitario: 200 },
      ]),
      proposta("B", [
        { itemId: "mussarela", precoUnitario: 34 },
        { itemId: "oregano", precoUnitario: 40 },
      ]),
    ],
  );

  // A sozinho: 1200 + 40 = 1240. Dividido: 1200 (A) + 8 (B) = 1208.
  assert.equal(c.melhorFornecedorUnico?.total, 1240);
  assert.equal(c.divididoTotal, 1208);
  assert.equal(c.economiaDoDividido, 32);
});

test("item que ninguém cotou é apontado, e some do cenário dividido", () => {
  const c = compararPropostas(
    [MUSSARELA, OREGANO],
    [proposta("A", [{ itemId: "mussarela", precoUnitario: 30 }])],
  );

  assert.deepEqual(c.itensSemPreco, ["Orégano"]);
  assert.equal(c.divididoTotal, null);
  assert.equal(c.melhorFornecedorUnico, null);
});

test("o quanto cada um está acima do vencedor sai em porcentagem", () => {
  const c = compararPropostas(
    [MUSSARELA],
    [
      proposta("A", [{ itemId: "mussarela", precoUnitario: 30 }]),
      proposta("B", [{ itemId: "mussarela", precoUnitario: 33 }]),
    ],
  );

  assert.equal(c.grade[0].celulas[0].acimaDoVencedor, 0);
  assert.equal(c.grade[0].celulas[1].acimaDoVencedor, 10);
});

test("empate elege um só vencedor — não dois", () => {
  const c = compararPropostas(
    [MUSSARELA],
    [
      proposta("A", [{ itemId: "mussarela", precoUnitario: 30 }]),
      proposta("B", [{ itemId: "mussarela", precoUnitario: 30 }]),
    ],
  );

  assert.equal(c.grade[0].celulas.filter((x) => x.vencedor).length, 1);
});

test("cotação sem nenhuma resposta não inventa vencedor", () => {
  const c = compararPropostas([MUSSARELA], []);
  assert.equal(c.melhorFornecedorUnico, null);
  assert.equal(c.divididoTotal, null);
  assert.deepEqual(c.itensSemPreco, ["Mussarela"]);
});
