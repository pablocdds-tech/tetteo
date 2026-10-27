import assert from "node:assert/strict";
import test from "node:test";
import type { InsumoPdv, ReceitaPdv } from "./consumo";
import {
  diagnosticarProdutoPreparacao,
  type FichaPreparacao,
} from "./preparacao";

const insumos: InsumoPdv[] = [
  { id: "i", nome: "Mussarela", unidadeMedida: "KG", custoUnitario: "30" },
];
const base: FichaPreparacao = {
  id: "p",
  nome: "Pizza",
  ativo: true,
  categoria: "Pizzas",
  precoCentavos: 4800,
  rendimento: 1,
  unidadeRendimento: "UN",
  itens: [
    {
      insumoId: "i",
      subFichaId: null,
      quantidade: 200,
      unidade: "G",
      perdaPercentual: 0,
    },
  ],
};
const diagnosticar = (
  ficha = base,
  grupos: unknown = [],
  receitas: ReceitaPdv[] = [ficha],
  saldos: Map<string, number> | null = new Map([["i", 1]]),
) =>
  diagnosticarProdutoPreparacao(
    ficha,
    { codigo: "", grupos },
    receitas,
    insumos,
    saldos,
  );

test("código ausente é aviso, conversão da base e saldo são explícitos", () => {
  const resultado = diagnosticar();
  assert.equal(resultado.pronto, true);
  assert.equal(resultado.pendencias[0].codigo, "codigo_ausente");
  assert.deepEqual(resultado.estoque, [
    {
      insumoId: "i",
      nome: "Mussarela",
      unidade: "KG",
      necessarioBase: 0.2,
      disponivel: 1,
    },
  ]);
});

test("produto inativo e preço ausente aparecem como bloqueios de cadastro", () => {
  const resultado = diagnosticar({
    ...base,
    ativo: false,
    precoCentavos: null,
  });
  assert.equal(resultado.pronto, false);
  assert.ok(resultado.pendencias.some((p) => p.codigo === "produto_inativo"));
  assert.ok(resultado.pendencias.some((p) => p.codigo === "preco_ausente"));
});

test("grupos corrompidos não derrubam o diagnóstico de outro produto", () => {
  assert.equal(diagnosticar(base, null).pronto, false);
  assert.ok(
    diagnosticar(base, { invalido: true }).pendencias.some(
      (p) => p.codigo === "complementos_invalidos",
    ),
  );
  assert.equal(diagnosticar().pronto, true);
});

test("pizza sem ingredientes na base pode consumir receitas dos sabores obrigatórios", () => {
  const pizza = { ...base, itens: [], precoCentavos: 0 };
  const sabor = { ...base, id: "sabor" };
  const grupos = [
    {
      id: "g",
      nome: "Sabores",
      minimo: 1,
      maximo: 1,
      calculo: "MEDIA",
      opcoes: [
        { id: "o", nome: "Mussarela", precoCentavos: 4800, fichaId: "sabor" },
      ],
    },
  ];
  const resultado = diagnosticar(pizza, grupos, [pizza, sabor]);
  assert.equal(resultado.pronto, true);
  assert.equal(resultado.estoque[0].necessarioBase, 0);
  assert.ok(
    !resultado.pendencias.some(
      (p) =>
        p.codigo === "consumo_ausente" || p.codigo === "consumo_condicional",
    ),
  );
});

test("complemento sem ficha só avisa e saldo insuficiente não vira bloqueio de cadastro", () => {
  const grupos = [
    {
      id: "g",
      nome: "Borda",
      minimo: 1,
      maximo: 1,
      calculo: "SOMA",
      opcoes: [{ id: "o", nome: "Tradicional", precoCentavos: 0 }],
    },
  ];
  const resultado = diagnosticar(base, grupos, [base], new Map());
  assert.equal(resultado.pronto, true);
  assert.ok(resultado.pendencias.some((p) => p.nivel === "ESTOQUE"));
  assert.ok(
    resultado.pendencias.some((p) => p.codigo === "complemento_sem_ficha_o"),
  );
  const semLocal = diagnosticar(base, grupos, [base], null);
  assert.equal(semLocal.estoque[0].disponivel, null);
  assert.ok(!semLocal.pendencias.some((p) => p.nivel === "ESTOQUE"));
});

test("ciclos, conversões incompatíveis e receita inativa recebem diagnóstico", () => {
  const ciclo = {
    ...base,
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
  assert.ok(
    diagnosticar(ciclo).pendencias.some(
      (p) => p.codigo === "receita_invalida" && p.mensagem.includes("ciclo"),
    ),
  );
  const unidadeInvalida = {
    ...base,
    itens: [{ ...base.itens[0], unidade: "UN" }],
  };
  assert.ok(
    diagnosticar(unidadeInvalida).pendencias.some(
      (p) => p.codigo === "receita_invalida" && p.mensagem.includes("unidades"),
    ),
  );
  assert.ok(
    diagnosticar(base, [], []).pendencias.some(
      (p) => p.codigo === "receita_invalida",
    ),
  );
});

test("combinações sem consumo são avisadas sem declarar todas impossíveis", () => {
  const pizza = { ...base, itens: [], precoCentavos: 0 };
  const sabor = { ...base, id: "sabor" };
  const grupos = [
    {
      id: "g",
      nome: "Sabores",
      minimo: 0,
      maximo: 1,
      calculo: "MEDIA",
      opcoes: [
        { id: "o", nome: "Mussarela", precoCentavos: 4800, fichaId: "sabor" },
      ],
    },
  ];
  const resultado = diagnosticar(pizza, grupos, [pizza, sabor]);
  assert.equal(resultado.pronto, true);
  assert.ok(
    resultado.pendencias.some((p) => p.codigo === "consumo_condicional"),
  );
  assert.ok(resultado.pendencias.some((p) => p.codigo === "preco_condicional"));
});
