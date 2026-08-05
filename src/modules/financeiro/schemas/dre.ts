/**
 * O DRE.
 *
 * Função pura, sem banco. Monta a demonstração de resultado na ordem que o
 * mercado lê, e é essa ordem que permite comparar a casa com qualquer outra:
 *
 *     RECEITA BRUTA
 *   − Deduções                imposto sobre venda, taxa de cartão e de app
 *   = RECEITA LÍQUIDA
 *   − CMV                     vem do ESTOQUE, não das compras
 *   = LUCRO BRUTO
 *   − Pessoal
 *   − Ocupação
 *   − Operacional
 *   = RESULTADO OPERACIONAL
 *   − Financeiras
 *   = RESULTADO DO PERÍODO
 *
 * ---------------------------------------------------------------------------
 * A ARMADILHA QUE ESTA FUNÇÃO EXISTE PARA NÃO CAIR.
 *
 * O caminho fácil seria somar as compras de insumo como custo. Está errado por
 * dois motivos ao mesmo tempo: mercadoria comprada em julho e consumida em
 * agosto é custo de AGOSTO; e o custo do que foi consumido já é calculado no
 * Estoque, pela contagem. Usar os dois contaria o queijo duas vezes.
 *
 * Então o CMV entra por FORA, calculado onde ele nasce, e as categorias
 * marcadas como MERCADORIA são deliberadamente ignoradas aqui. O total delas é
 * devolvido em `comprasIgnoradas` para a tela poder mostrar a diferença entre
 * o que foi COMPRADO e o que foi CONSUMIDO no período — que é uma informação
 * boa, e não a mesma coisa.
 * ---------------------------------------------------------------------------
 */

export type GrupoDre =
  | "RECEITA"
  | "DEDUCAO"
  | "MERCADORIA"
  | "PESSOAL"
  | "OCUPACAO"
  | "OPERACIONAL"
  | "FINANCEIRA"
  | "INVESTIMENTO";

export type MovimentoDre = {
  valor: number;
  categoria: { nome: string; grupoDre: GrupoDre | null } | null;
};

export type LinhaDeCategoria = {
  categoria: string;
  valor: number;
  /** Sobre a receita bruta — é assim que custo de restaurante se lê. */
  percentual: number | null;
};

export type BlocoDoDre = {
  grupo: GrupoDre;
  rotulo: string;
  total: number;
  percentual: number | null;
  linhas: LinhaDeCategoria[];
};

export type Dre = {
  receitaBruta: number;
  deducoes: number;
  receitaLiquida: number;
  cmv: number;
  lucroBruto: number;
  /** Pessoal, Ocupação e Operacional detalhados. */
  despesas: BlocoDoDre[];
  totalDespesas: number;
  resultadoOperacional: number;
  financeiras: number;
  resultado: number;

  /** Percentuais sobre a receita bruta, na ordem em que se lê. */
  percentuais: {
    deducoes: number | null;
    cmv: number | null;
    lucroBruto: number | null;
    despesas: number | null;
    resultado: number | null;
  };

  blocoReceita: BlocoDoDre;
  blocoDeducoes: BlocoDoDre;

  /**
   * Compras de insumo do período. NÃO entram no resultado — o CMV já responde
   * por elas. Aparecem para comparar comprado × consumido.
   */
  comprasIgnoradas: number;
  /** Saiu do caixa, não do lucro: forno, reforma, móvel. */
  investimentos: number;
  /** Movimentado sem categoria de DRE — o buraco da demonstração. */
  semClassificacao: number;
};

const ROTULOS: Record<GrupoDre, string> = {
  RECEITA: "Receita bruta",
  DEDUCAO: "Deduções sobre a venda",
  MERCADORIA: "Compras de mercadoria",
  PESSOAL: "Pessoal",
  OCUPACAO: "Ocupação",
  OPERACIONAL: "Operacional",
  FINANCEIRA: "Financeiras",
  INVESTIMENTO: "Investimentos",
};

const arredondar = (v: number) => Math.round(v * 100) / 100;

function montarBloco(
  grupo: GrupoDre,
  movimentos: MovimentoDre[],
  receitaBruta: number,
): BlocoDoDre {
  const porCategoria = new Map<string, number>();

  for (const m of movimentos) {
    if (m.categoria?.grupoDre !== grupo) continue;
    const nome = m.categoria.nome;
    porCategoria.set(nome, arredondar((porCategoria.get(nome) ?? 0) + m.valor));
  }

  const linhas = [...porCategoria.entries()]
    .map(([categoria, valor]) => ({
      categoria,
      valor,
      percentual:
        receitaBruta > 0
          ? Math.round((valor / receitaBruta) * 1000) / 10
          : null,
    }))
    .sort((a, b) => b.valor - a.valor);

  const total = arredondar(linhas.reduce((s, l) => s + l.valor, 0));

  return {
    grupo,
    rotulo: ROTULOS[grupo],
    total,
    percentual:
      receitaBruta > 0 ? Math.round((total / receitaBruta) * 1000) / 10 : null,
    linhas,
  };
}

/**
 * @param movimentos lançamentos do período, já filtrados por data
 * @param cmv        o custo da mercadoria vendida, vindo do Estoque
 */
export function montarDre(movimentos: MovimentoDre[], cmv: number): Dre {
  const blocoReceita = montarBloco("RECEITA", movimentos, 0);
  const receitaBruta = blocoReceita.total;

  // Refeito com a receita conhecida, para os percentuais saírem certos.
  const receita = montarBloco("RECEITA", movimentos, receitaBruta);
  const deducoes = montarBloco("DEDUCAO", movimentos, receitaBruta);

  const receitaLiquida = arredondar(receitaBruta - deducoes.total);
  const lucroBruto = arredondar(receitaLiquida - cmv);

  const despesas = (["PESSOAL", "OCUPACAO", "OPERACIONAL"] as const).map((g) =>
    montarBloco(g, movimentos, receitaBruta),
  );
  const totalDespesas = arredondar(despesas.reduce((s, b) => s + b.total, 0));

  const resultadoOperacional = arredondar(lucroBruto - totalDespesas);
  const financeiras = montarBloco("FINANCEIRA", movimentos, receitaBruta).total;
  const resultado = arredondar(resultadoOperacional - financeiras);

  const somaDoGrupo = (g: GrupoDre) =>
    arredondar(
      movimentos
        .filter((m) => m.categoria?.grupoDre === g)
        .reduce((s, m) => s + m.valor, 0),
    );

  const percentual = (v: number) =>
    receitaBruta > 0 ? Math.round((v / receitaBruta) * 1000) / 10 : null;

  return {
    receitaBruta,
    deducoes: deducoes.total,
    receitaLiquida,
    cmv: arredondar(cmv),
    lucroBruto,
    despesas,
    totalDespesas,
    resultadoOperacional,
    financeiras,
    resultado,
    percentuais: {
      deducoes: percentual(deducoes.total),
      cmv: percentual(cmv),
      lucroBruto: percentual(lucroBruto),
      despesas: percentual(totalDespesas),
      resultado: percentual(resultado),
    },
    blocoReceita: receita,
    blocoDeducoes: deducoes,
    comprasIgnoradas: somaDoGrupo("MERCADORIA"),
    investimentos: somaDoGrupo("INVESTIMENTO"),
    semClassificacao: arredondar(
      movimentos
        .filter((m) => !m.categoria || m.categoria.grupoDre === null)
        .reduce((s, m) => s + m.valor, 0),
    ),
  };
}
