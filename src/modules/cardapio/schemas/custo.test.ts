import assert from "node:assert/strict";
import { test } from "node:test";

import {
  calcularCusto,
  calcularMargem,
  precoParaCmvAlvo,
  type FichaParaCusto,
  type InsumoParaCusto,
  type ItemParaCusto,
} from "./custo";

/**
 * Cada caso abaixo é uma forma de a ficha mentir sobre quanto o prato custa —
 * e um custo errado aqui vira preço errado no cardápio, todo dia, para sempre.
 */

const INSUMOS = new Map<string, InsumoParaCusto>([
  [
    "mussarela",
    { id: "mussarela", nome: "Mussarela", unidadeMedida: "KG", custo: 32 },
  ],
  [
    "farinha",
    { id: "farinha", nome: "Farinha", unidadeMedida: "KG", custo: 4 },
  ],
  [
    "manjericao",
    { id: "manjericao", nome: "Manjericão", unidadeMedida: "KG", custo: 80 },
  ],
  ["tomate", { id: "tomate", nome: "Tomate", unidadeMedida: "KG", custo: 6 }],
  [
    "caixa",
    { id: "caixa", nome: "Caixa de pizza", unidadeMedida: "UN", custo: 1.2 },
  ],
  ["azeite", { id: "azeite", nome: "Azeite", unidadeMedida: "L", custo: 40 }],
]);

function item(parcial: Partial<ItemParaCusto> = {}): ItemParaCusto {
  return {
    insumoId: null,
    subFichaId: null,
    quantidade: 1,
    unidade: "UN",
    perdaPercentual: 0,
    observacao: null,
    ...parcial,
  };
}

function ficha(
  id: string,
  itens: ItemParaCusto[],
  parcial: Partial<FichaParaCusto> = {},
): FichaParaCusto {
  return {
    id,
    nome: id,
    rendimento: 1,
    unidadeRendimento: "UN",
    itens,
    ...parcial,
  };
}

test("200 g de um insumo comprado em kg custa 200 g, não 200 kg", () => {
  // Sem conversão a pizza sairia com R$ 6.400 de queijo.
  const fichas = new Map([
    [
      "pizza",
      ficha("pizza", [
        item({ insumoId: "mussarela", quantidade: 200, unidade: "G" }),
      ]),
    ],
  ]);

  const custo = calcularCusto("pizza", fichas, INSUMOS);
  assert.equal(custo.custoTotal, 6.4);
});

test("o erro para MENOS também é pego: kg numa receita que fala em g", () => {
  const fichas = new Map([
    [
      "molho",
      ficha("molho", [
        item({ insumoId: "tomate", quantidade: 2, unidade: "KG" }),
      ]),
    ],
  ]);

  assert.equal(calcularCusto("molho", fichas, INSUMOS).custoTotal, 12);
});

test("litro e mililitro convertem; unidade não converte com peso", () => {
  const fichas = new Map([
    [
      "regada",
      ficha("regada", [
        item({ insumoId: "azeite", quantidade: 15, unidade: "ML" }),
        item({ insumoId: "caixa", quantidade: 1, unidade: "UN" }),
      ]),
    ],
  ]);

  const custo = calcularCusto("regada", fichas, INSUMOS);
  assert.equal(custo.linhas[0].custo, 0.6);
  assert.equal(custo.linhas[1].custo, 1.2);
});

test("unidade incompatível vira AVISO, não um zero silencioso", () => {
  // Zerar em silêncio faria a pizza parecer mais lucrativa do que é.
  const fichas = new Map([
    [
      "pizza",
      ficha("pizza", [
        item({ insumoId: "caixa", quantidade: 300, unidade: "G" }),
      ]),
    ],
  ]);

  const custo = calcularCusto("pizza", fichas, INSUMOS);
  assert.equal(custo.linhas[0].custo, 0);
  assert.match(custo.linhas[0].problema ?? "", /não dá para converter/);
  assert.equal(custo.linhasComProblema, 1);
});

test("tempero de centavos não some no arredondamento", () => {
  // 5 g de manjericão a R$ 80/kg = R$ 0,40. Arredondar a linha para dois
  // decimais sumiria com o custo de tempero da cozinha inteira.
  const fichas = new Map([
    [
      "pizza",
      ficha("pizza", [
        item({ insumoId: "manjericao", quantidade: 5, unidade: "G" }),
      ]),
    ],
  ]);

  assert.equal(calcularCusto("pizza", fichas, INSUMOS).custoTotal, 0.4);
});

test("perda é divisão, não acréscimo: 20% de perda pede 1,25 kg", () => {
  // O erro comum é somar 20% e comprar 1,2 kg — 4% a menos de custo, todo dia.
  const fichas = new Map([
    [
      "molho",
      ficha("molho", [
        item({
          insumoId: "tomate",
          quantidade: 1,
          unidade: "KG",
          perdaPercentual: 20,
        }),
      ]),
    ],
  ]);

  const custo = calcularCusto("molho", fichas, INSUMOS);
  assert.equal(custo.linhas[0].quantidadeBruta, 1.25);
  assert.equal(custo.custoTotal, 7.5);
});

test("perda de 100% é recusada em vez de dividir por zero", () => {
  const fichas = new Map([
    [
      "molho",
      ficha("molho", [
        item({ insumoId: "tomate", quantidade: 1, perdaPercentual: 100 }),
      ]),
    ],
  ]);

  assert.match(
    calcularCusto("molho", fichas, INSUMOS).linhas[0].problema ?? "",
    /não pode ser 100%/,
  );
});

test("o rendimento divide: massa de R$ 16 que rende 8 discos dá R$ 2 o disco", () => {
  const fichas = new Map([
    [
      "massa",
      ficha(
        "massa",
        [item({ insumoId: "farinha", quantidade: 4, unidade: "KG" })],
        { rendimento: 8, unidadeRendimento: "UN" },
      ),
    ],
  ]);

  const custo = calcularCusto("massa", fichas, INSUMOS);
  assert.equal(custo.custoTotal, 16);
  assert.equal(custo.custoUnitario, 2);
});

test("a sub-receita entra pelo custo unitário dela", () => {
  const fichas = new Map([
    [
      "massa",
      ficha(
        "massa",
        [item({ insumoId: "farinha", quantidade: 4, unidade: "KG" })],
        { rendimento: 8, unidadeRendimento: "UN" },
      ),
    ],
    [
      "pizza",
      ficha("pizza", [
        item({ subFichaId: "massa", quantidade: 1, unidade: "UN" }),
        item({ insumoId: "mussarela", quantidade: 200, unidade: "G" }),
      ]),
    ],
  ]);

  const custo = calcularCusto("pizza", fichas, INSUMOS);
  assert.equal(custo.linhas[0].custo, 2);
  assert.equal(custo.custoTotal, 8.4);
});

test("sub-receita rendida em peso converte igual a insumo", () => {
  // Massa que rende 5 kg e custa R$ 20 sai a R$ 4/kg; 350 g custam R$ 1,40.
  const fichas = new Map([
    [
      "massa",
      ficha(
        "massa",
        [item({ insumoId: "farinha", quantidade: 5, unidade: "KG" })],
        { rendimento: 5, unidadeRendimento: "KG" },
      ),
    ],
    [
      "pizza",
      ficha("pizza", [
        item({ subFichaId: "massa", quantidade: 350, unidade: "G" }),
      ]),
    ],
  ]);

  assert.equal(calcularCusto("pizza", fichas, INSUMOS).custoTotal, 1.4);
});

test("o problema da sub-receita sobe INTEIRO, não como contagem", () => {
  // Senão a pizza mostra um custo redondinho, ou um "1 linha sem custo" que
  // obriga a abrir a massa para descobrir o quê.
  const fichas = new Map([
    [
      "massa",
      ficha(
        "massa",
        [item({ insumoId: "caixa", quantidade: 300, unidade: "G" })],
        { rendimento: 8 },
      ),
    ],
    ["pizza", ficha("pizza", [item({ subFichaId: "massa", quantidade: 1 })])],
  ]);

  const problema =
    calcularCusto("pizza", fichas, INSUMOS).linhas[0].problema ?? "";
  assert.match(problema, /^massa: /);
  assert.match(problema, /não dá para converter/);
});

test("receita circular não trava a página — vira aviso com o caminho", () => {
  const fichas = new Map([
    ["a", ficha("a", [item({ subFichaId: "b" })])],
    ["b", ficha("b", [item({ subFichaId: "a" })])],
  ]);

  const custo = calcularCusto("a", fichas, INSUMOS);
  const problema = custo.linhas[0].problema ?? "";
  assert.match(problema, /circular/);
  assert.match(problema, /a → b → a/);
});

test("ficha que usa a si mesma direto também é pega", () => {
  const fichas = new Map([["a", ficha("a", [item({ subFichaId: "a" })])]]);
  assert.match(
    calcularCusto("a", fichas, INSUMOS).linhas[0].problema ?? "",
    /circular/,
  );
});

test("insumo apagado do cadastro não zera calado", () => {
  const fichas = new Map([
    ["pizza", ficha("pizza", [item({ insumoId: "sumiu", quantidade: 1 })])],
  ]);

  assert.match(
    calcularCusto("pizza", fichas, INSUMOS).linhas[0].problema ?? "",
    /não existe mais/,
  );
});

test("linha vazia é apontada em vez de contar como grátis", () => {
  const fichas = new Map([["pizza", ficha("pizza", [item()])]]);
  assert.match(
    calcularCusto("pizza", fichas, INSUMOS).linhas[0].problema ?? "",
    /sem insumo nem preparo/,
  );
});

test("margem: R$ 12,40 de custo num prato de R$ 55 dá 22,5% de CMV", () => {
  const margem = calcularMargem(12.4, 55);
  assert.equal(margem?.cmvPercentual, 22.5);
  assert.equal(margem?.lucroBruto, 42.6);
});

test("sem preço de venda não existe margem — e não se inventa uma", () => {
  assert.equal(calcularMargem(12.4, null), null);
  assert.equal(calcularMargem(12.4, 0), null);
});

test("o preço para um CMV alvo é divisão, não acréscimo", () => {
  // A conta que se faz de cabeça — custo × 1,3 — daria R$ 16,12 e 77% de CMV.
  assert.equal(precoParaCmvAlvo(12.4, 30), 41.33);
  assert.equal(precoParaCmvAlvo(12.4, 0), null);
  assert.equal(precoParaCmvAlvo(12.4, 100), null);
});

test("a margherita inteira, conferida na mão", () => {
  /**
   * O caso completo, com sub-receita, perda, conversão de peso e de volume.
   * Os números foram fechados na calculadora antes de virarem código:
   *
   *   massa      5 kg de farinha × R$ 4         = R$ 20,00 ÷ 20 discos = R$ 1,00
   *   molho      3 kg de tomate ÷ 0,8 = 3,75 kg × R$ 6 = R$ 22,50 ÷ 2,5 L = R$ 9,00/L
   *
   *   1 disco                                     R$  1,00
   *   120 ml de molho    0,12 × 9,00              R$  1,08
   *   200 g mussarela    0,2 × 32,00              R$  6,40
   *   5 g manjericão     0,005 × 80,00            R$  0,40
   *   10 ml azeite       0,01 × 40,00             R$  0,40
   *   1 caixa                                     R$  1,20
   *                                               ---------
   *                                               R$ 10,48
   *
   *   CMV = 10,48 ÷ 55,00 = 19,1%
   */
  const fichas = new Map([
    [
      "massa",
      ficha(
        "massa",
        [item({ insumoId: "farinha", quantidade: 5, unidade: "KG" })],
        { rendimento: 20, unidadeRendimento: "UN" },
      ),
    ],
    [
      "molho",
      ficha(
        "molho",
        [
          item({
            insumoId: "tomate",
            quantidade: 3,
            unidade: "KG",
            perdaPercentual: 20,
          }),
        ],
        { rendimento: 2.5, unidadeRendimento: "L" },
      ),
    ],
    [
      "margherita",
      ficha("margherita", [
        item({ subFichaId: "massa", quantidade: 1, unidade: "UN" }),
        item({ subFichaId: "molho", quantidade: 120, unidade: "ML" }),
        item({ insumoId: "mussarela", quantidade: 200, unidade: "G" }),
        item({ insumoId: "manjericao", quantidade: 5, unidade: "G" }),
        item({ insumoId: "azeite", quantidade: 10, unidade: "ML" }),
        item({ insumoId: "caixa", quantidade: 1, unidade: "UN" }),
      ]),
    ],
  ]);

  const custo = calcularCusto("margherita", fichas, INSUMOS);

  assert.deepEqual(
    custo.linhas.map((l) => l.custo),
    [1, 1.08, 6.4, 0.4, 0.4, 1.2],
  );
  assert.equal(custo.custoTotal, 10.48);
  assert.equal(custo.linhasComProblema, 0);

  const margem = calcularMargem(custo.custoUnitario, 55);
  assert.equal(margem?.cmvPercentual, 19.1);
  assert.equal(margem?.lucroBruto, 44.52);
});
