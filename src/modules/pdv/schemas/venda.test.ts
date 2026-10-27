import assert from "node:assert/strict";
import test from "node:test";
import type { ProdutoPdv } from "../types";
import {
  calcularPrecoItem,
  calcularVenda,
  esquemaComplementos,
  esquemaFinalizar,
} from "./venda";
import { calcularConsumo, type ReceitaPdv } from "./consumo";

const pizza: ProdutoPdv = {
  id: "pizza",
  nome: "Pizza grande",
  categoria: "Pizzas",
  codigo: "1",
  precoCentavos: 0,
  grupos: [
    {
      id: "sabores",
      nome: "Sabores",
      minimo: 1,
      maximo: 2,
      calculo: "MEDIA",
      opcoes: [
        { id: "calabresa", nome: "Calabresa", precoCentavos: 4800 },
        { id: "file", nome: "Filé", precoCentavos: 6600 },
      ],
    },
    {
      id: "borda",
      nome: "Borda",
      minimo: 1,
      maximo: 1,
      calculo: "SOMA",
      opcoes: [
        { id: "tradicional", nome: "Tradicional", precoCentavos: 0 },
        { id: "catupiry", nome: "Catupiry", precoCentavos: 1200 },
      ],
    },
  ],
};
test("dois sabores usam a média com adicional de borda", () =>
  assert.equal(
    calcularPrecoItem(pizza, ["calabresa", "file", "catupiry"]),
    6900,
  ));
test("complementos ausentes, desconhecidos ou repetidos são recusados", () => {
  assert.throws(() => calcularPrecoItem(pizza, ["calabresa"]), /Borda/);
  assert.throws(
    () => calcularPrecoItem(pizza, ["calabresa", "tradicional", "intruso"]),
    /indisponível/,
  );
  assert.throws(
    () => calcularPrecoItem(pizza, ["calabresa", "calabresa", "tradicional"]),
    /repetidos/,
  );
});
test("pagamento dividido com desconto e troco em dinheiro", () => {
  const r = calcularVenda(
    [pizza],
    [
      {
        produtoId: "pizza",
        quantidade: 2,
        opcoes: ["calabresa", "tradicional"],
        observacao: "",
      },
    ],
    600,
    100,
    [
      { forma: "PIX", valorCentavos: 5000 },
      { forma: "DINHEIRO", valorCentavos: 5000 },
    ],
  );
  assert.equal(r.totalCentavos, 9100);
  assert.equal(r.trocoCentavos, 900);
  assert.equal(r.itens[0].precoUnitarioCentavos, 4800);
});
test("troco em cartão, pagamento insuficiente, desconto excessivo não passam", () => {
  const itens = [
    {
      produtoId: "pizza",
      quantidade: 1,
      opcoes: ["calabresa", "tradicional"],
      observacao: "",
    },
  ];
  assert.throws(
    () =>
      calcularVenda([pizza], itens, 0, 0, [
        { forma: "CREDITO", valorCentavos: 5000 },
      ]),
    /Troco/,
  );
  assert.throws(
    () =>
      calcularVenda([pizza], itens, 0, 0, [
        { forma: "PIX", valorCentavos: 1000 },
      ]),
    /falta/,
  );
  assert.throws(
    () =>
      calcularVenda([pizza], itens, 5000, 0, [
        { forma: "DINHEIRO", valorCentavos: 1000 },
      ]),
    /desconto/,
  );
});
test("validação limita quantidades, dinheiro fracionado e grupos duplicados", () => {
  assert.equal(
    esquemaFinalizar.safeParse({
      chave: crypto.randomUUID(),
      caixaId: "c",
      modalidade: "BALCAO",
      observacao: "",
      itens: [{ produtoId: "p", quantidade: -1, opcoes: [], observacao: "" }],
      descontoCentavos: 0,
      taxaCentavos: 0,
      pagamentos: [{ forma: "PIX", valorCentavos: 1.5 }],
    }).success,
    false,
  );
  assert.equal(
    esquemaComplementos.safeParse({
      produtoId: "p",
      codigo: "",
      grupos: [pizza.grupos[0], pizza.grupos[0]],
    }).success,
    false,
  );
});
test("estoque considera sub-receita, conversão, rendimento e perda antes de arredondar", () => {
  const receitas: ReceitaPdv[] = [
    {
      id: "prato",
      nome: "Prato",
      rendimento: 2,
      unidadeRendimento: "UN",
      itens: [
        {
          insumoId: null,
          subFichaId: "molho",
          quantidade: 500,
          unidade: "G",
          perdaPercentual: 0,
        },
      ],
    },
    {
      id: "molho",
      nome: "Molho",
      rendimento: 1,
      unidadeRendimento: "KG",
      itens: [
        {
          insumoId: "tomate",
          subFichaId: null,
          quantidade: 800,
          unidade: "G",
          perdaPercentual: 20,
        },
      ],
    },
  ];
  assert.deepEqual(
    calcularConsumo([{ fichaId: "prato", quantidade: 2 }], receitas, [
      { id: "tomate", nome: "Tomate", unidadeMedida: "KG", custoUnitario: "5" },
    ]),
    [
      {
        insumoId: "tomate",
        nome: "Tomate",
        quantidade: "0.500",
        custoUnitario: "5",
      },
    ],
  );
});
test("estoque rejeita ciclo e unidades incompatíveis", () => {
  const receita: ReceitaPdv = {
    id: "p",
    nome: "P",
    rendimento: 1,
    unidadeRendimento: "UN",
    itens: [
      {
        insumoId: null,
        subFichaId: "p",
        quantidade: 1,
        unidade: "UN",
        perdaPercentual: 0,
      },
    ],
  };
  assert.throws(
    () => calcularConsumo([{ fichaId: "p", quantidade: 1 }], [receita], []),
    /ciclo/,
  );
  receita.itens = [
    {
      insumoId: "i",
      subFichaId: null,
      quantidade: 1,
      unidade: "KG",
      perdaPercentual: 0,
    },
  ];
  assert.throws(
    () =>
      calcularConsumo(
        [{ fichaId: "p", quantidade: 1 }],
        [receita],
        [{ id: "i", nome: "I", unidadeMedida: "UN", custoUnitario: "1" }],
      ),
    /unidades/,
  );
});
