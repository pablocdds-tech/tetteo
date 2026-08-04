import { converter, sigla, type Unidade } from "@/lib/unidades";

/**
 * O CUSTO DA FICHA TÉCNICA.
 *
 * Funções puras, sem banco. É o cálculo mais perigoso do sistema até aqui, por
 * três motivos que não são óbvios:
 *
 *   CONVERSÃO. A mussarela é comprada em KG a R$ 32 e a receita pede 200 G.
 *   Multiplicar direto daria R$ 6.400 de queijo numa pizza. O erro é tão
 *   grande que seria pego — mas o inverso (KG numa receita que fala em G)
 *   erra por mil PARA MENOS, e um custo baixo demais ninguém questiona.
 *
 *   RECURSÃO. A pizza usa massa, a massa usa fermento. Se alguém escrever que
 *   a massa usa a pizza, o cálculo roda para sempre e derruba a página. O
 *   ciclo é detectado e vira aviso, não travamento.
 *
 *   SILÊNCIO. Quando um dado falta — insumo apagado, unidade incompatível,
 *   perda de 100% — a saída é um AVISO na linha, nunca um zero discreto. Um
 *   custo que some sem avisar é como o sistema afirma que a pizza é mais
 *   lucrativa do que ela é.
 */

export type UnidadeMedida = Unidade;

export type InsumoParaCusto = {
  id: string;
  nome: string;
  unidadeMedida: UnidadeMedida;
  /// Já em número: quem chama converte o Decimal do banco.
  custo: number;
};

export type ItemParaCusto = {
  insumoId: string | null;
  subFichaId: string | null;
  quantidade: number;
  unidade: UnidadeMedida;
  perdaPercentual: number;
  observacao: string | null;
};

export type FichaParaCusto = {
  id: string;
  nome: string;
  rendimento: number;
  unidadeRendimento: UnidadeMedida;
  itens: ItemParaCusto[];
};

export type LinhaDeCusto = {
  nome: string;
  ehSubFicha: boolean;
  /// O que vai no prato.
  quantidade: number;
  unidade: UnidadeMedida;
  /// O que precisa sair do estoque, já com a perda embutida.
  quantidadeBruta: number;
  custo: number;
  observacao: string | null;
  /// Preenchido quando a linha não pôde ser custeada. Custo vai a zero, mas a
  /// tela mostra o porquê em vez de fingir que está tudo certo.
  problema: string | null;
};

export type CustoDaFicha = {
  linhas: LinhaDeCusto[];
  /// O custo da receita INTEIRA, como ela está escrita.
  custoTotal: number;
  /// O custo de UMA unidade do rendimento — a porção, o disco, o quilo.
  custoUnitario: number;
  /// Quantas linhas não puderam ser custeadas.
  linhasComProblema: number;
};

/** Até onde a recursão desce antes de desistir. Receita real não passa de 3. */
const PROFUNDIDADE_MAXIMA = 10;

/**
 * Arredonda para quatro casas.
 *
 * Duas, aqui, seria errado: cinco gramas de manjericão custam R$ 0,004, e
 * arredondar a linha para R$ 0,00 sumiria com o custo de todo tempero da
 * cozinha. O total é que aparece com dois — e ele soma as linhas já
 * arredondadas, para que a conferência na calculadora bata.
 */
function arredondar(valor: number) {
  return Math.round(valor * 10_000) / 10_000;
}

function custeiaLinha(
  item: ItemParaCusto,
  fichas: Map<string, FichaParaCusto>,
  insumos: Map<string, InsumoParaCusto>,
  caminho: string[],
): LinhaDeCusto {
  const base: Omit<LinhaDeCusto, "nome" | "ehSubFicha"> = {
    quantidade: item.quantidade,
    unidade: item.unidade,
    quantidadeBruta: item.quantidade,
    custo: 0,
    observacao: item.observacao,
    problema: null,
  };

  /**
   * A perda é sobre o BRUTO, não sobre o líquido.
   *
   * Um tomate que perde 20% ao ser limpo não vira "1 kg + 20%": vira
   * 1 ÷ 0,8 = 1,25 kg. A diferença entre 1,2 e 1,25 parece pequena e é 4% do
   * custo do item — num molho que roda todo dia, o ano inteiro.
   */
  if (item.perdaPercentual >= 100) {
    return {
      ...base,
      nome: "—",
      ehSubFicha: false,
      problema:
        "A perda não pode ser 100% ou mais — não sobraria nada para o prato.",
    };
  }

  const quantidadeBruta = arredondar(
    item.quantidade / (1 - item.perdaPercentual / 100),
  );

  // --- INSUMO -------------------------------------------------------------
  if (item.insumoId) {
    const insumo = insumos.get(item.insumoId);
    if (!insumo) {
      return {
        ...base,
        quantidadeBruta,
        nome: "Insumo removido",
        ehSubFicha: false,
        problema:
          "Este insumo não existe mais no cadastro. Troque a linha ou apague.",
      };
    }

    const naUnidadeDoInsumo = converter(
      quantidadeBruta,
      item.unidade,
      insumo.unidadeMedida,
    );

    if (naUnidadeDoInsumo === null) {
      return {
        ...base,
        quantidadeBruta,
        nome: insumo.nome,
        ehSubFicha: false,
        problema: `A receita fala em ${sigla(item.unidade)} e ${insumo.nome} é medido em ${sigla(insumo.unidadeMedida)} — não dá para converter. Ajuste a unidade da linha ou a do insumo.`,
      };
    }

    return {
      ...base,
      quantidadeBruta,
      nome: insumo.nome,
      ehSubFicha: false,
      custo: arredondar(naUnidadeDoInsumo * insumo.custo),
    };
  }

  // --- SUB-FICHA ----------------------------------------------------------
  if (item.subFichaId) {
    const sub = fichas.get(item.subFichaId);
    if (!sub) {
      return {
        ...base,
        quantidadeBruta,
        nome: "Preparo removido",
        ehSubFicha: true,
        problema: "Este preparo não existe mais. Troque a linha ou apague.",
      };
    }

    if (caminho.includes(sub.id)) {
      // O ciclo é o único erro aqui que travaria a página em vez de dar um
      // número errado. Ele para na hora e diz o caminho inteiro.
      const volta = [...caminho, sub.id]
        .map((id) => fichas.get(id)?.nome ?? "?")
        .join(" → ");
      return {
        ...base,
        quantidadeBruta,
        nome: sub.nome,
        ehSubFicha: true,
        problema: `Receita circular: ${volta}. Uma ficha não pode usar a si mesma, nem direta nem indiretamente.`,
      };
    }

    if (caminho.length >= PROFUNDIDADE_MAXIMA) {
      return {
        ...base,
        quantidadeBruta,
        nome: sub.nome,
        ehSubFicha: true,
        problema:
          "Receita aninhada fundo demais. Simplifique: preparo dentro de preparo dentro de preparo vira impossível de conferir.",
      };
    }

    const custoDaSub = calcularCusto(sub.id, fichas, insumos, caminho);

    if (sub.rendimento <= 0) {
      return {
        ...base,
        quantidadeBruta,
        nome: sub.nome,
        ehSubFicha: true,
        problema: `${sub.nome} não diz quanto rende. Sem rendimento não existe custo por unidade.`,
      };
    }

    const naUnidadeDoRendimento = converter(
      quantidadeBruta,
      item.unidade,
      sub.unidadeRendimento,
    );

    if (naUnidadeDoRendimento === null) {
      return {
        ...base,
        quantidadeBruta,
        nome: sub.nome,
        ehSubFicha: true,
        problema: `A receita pede ${sigla(item.unidade)} e ${sub.nome} rende em ${sigla(sub.unidadeRendimento)} — não dá para converter.`,
      };
    }

    /**
     * O problema de dentro sobe INTEIRO, não como contagem.
     *
     * "massa tem 1 linha sem custo" obriga a pessoa a abrir a massa para
     * descobrir o quê. Pior: quando o problema é receita circular — o erro
     * mais confuso que existe aqui — a mensagem que importa ficaria escondida
     * um nível abaixo, e quem olha a pizza nunca entenderia por que o número
     * está errado.
     */
    const deDentro =
      custoDaSub.linhas.find((l) => l.problema)?.problema ?? null;
    const restantes = custoDaSub.linhasComProblema - 1;

    return {
      ...base,
      quantidadeBruta,
      nome: sub.nome,
      ehSubFicha: true,
      custo: arredondar(naUnidadeDoRendimento * custoDaSub.custoUnitario),
      problema: deDentro
        ? `${sub.nome}: ${deDentro}${restantes > 0 ? ` (e mais ${restantes})` : ""}`
        : null,
    };
  }

  return {
    ...base,
    quantidadeBruta,
    nome: "—",
    ehSubFicha: false,
    problema: "Linha sem insumo nem preparo escolhido.",
  };
}

/**
 * O custo de uma ficha, descendo pelas sub-receitas.
 *
 * `caminho` carrega as fichas já visitadas nesta descida — é o que detecta o
 * ciclo. Quem chama de fora não passa nada.
 */
export function calcularCusto(
  fichaId: string,
  fichas: Map<string, FichaParaCusto>,
  insumos: Map<string, InsumoParaCusto>,
  caminho: string[] = [],
): CustoDaFicha {
  const ficha = fichas.get(fichaId);
  if (!ficha) {
    return {
      linhas: [],
      custoTotal: 0,
      custoUnitario: 0,
      linhasComProblema: 0,
    };
  }

  const proximoCaminho = [...caminho, fichaId];

  const linhas = ficha.itens.map((item) =>
    custeiaLinha(item, fichas, insumos, proximoCaminho),
  );

  // Soma as linhas JÁ arredondadas: é o que faz a conferência na calculadora
  // bater com o que está na tela, linha por linha.
  const custoTotal = arredondar(
    linhas.reduce((total, linha) => total + linha.custo, 0),
  );

  const rendimento = ficha.rendimento > 0 ? ficha.rendimento : 1;

  return {
    linhas,
    custoTotal,
    custoUnitario: arredondar(custoTotal / rendimento),
    linhasComProblema: linhas.filter((l) => l.problema !== null).length,
  };
}

export type Margem = {
  /// Quanto do preço de venda é ingrediente. É o CMV teórico do prato.
  cmvPercentual: number;
  /// O que sobra do preço depois do ingrediente — antes de tudo o mais.
  lucroBruto: number;
};

/**
 * A margem do prato.
 *
 * O número que a ficha existe para dar. Não é lucro: é o que sobra depois do
 * ingrediente, e ainda tem embalagem, gás, luz, imposto e gente pela frente.
 * A tela diz isso em voz alta para ninguém confundir 70% de margem bruta com
 * 70% de lucro.
 */
export function calcularMargem(
  custo: number,
  precoVenda: number | null,
): Margem | null {
  if (precoVenda === null || precoVenda <= 0) return null;

  return {
    cmvPercentual: Math.round((custo / precoVenda) * 1000) / 10,
    lucroBruto: Math.round((precoVenda - custo) * 100) / 100,
  };
}

/**
 * O preço que atingiria um CMV alvo.
 *
 * A pergunta que sempre vem depois de ver a margem: "por quanto eu teria que
 * vender para o queijo ser 30% do preço?". Sem isto, a resposta é feita na
 * calculadora do celular e quase sempre errada — a conta que as pessoas fazem
 * é custo × 1,3, que dá 77% de CMV, não 30%.
 */
export function precoParaCmvAlvo(custo: number, alvoPercentual: number) {
  if (alvoPercentual <= 0 || alvoPercentual >= 100) return null;
  return Math.round((custo / (alvoPercentual / 100)) * 100) / 100;
}
