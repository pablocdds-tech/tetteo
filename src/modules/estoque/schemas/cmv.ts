/**
 * O CÁLCULO DO CMV.
 *
 * Função pura, sem banco: recebe as duas pontas e as compras do meio, devolve
 * o número e o detalhe. É o cálculo que decide preço de cardápio, então
 * precisa ser lido, conferido e testado sem depender de dado real.
 *
 *     CMV = estoque inicial + compras do período − estoque final
 *
 * A fórmula não pergunta o que foi vendido. Tudo que saiu — vendido, quebrado,
 * vencido, comido — simplesmente não está na contagem final. O número já sai
 * líquido, e é por isso que ele funciona antes de existir ficha técnica ou
 * integração com o PDV.
 *
 * A REGRA QUE MAIS IMPORTA: só entram no cálculo os insumos contados NAS DUAS
 * pontas. Um item contado só no fim apareceria como consumo negativo; contado
 * só no começo, sumiria como se tivesse sido todo consumido. Os dois casos
 * mentem, e mentem alto. O que fica de fora é contado e mostrado, nunca
 * escondido.
 */

export type ItemContado = {
  insumoId: string;
  nome: string;
  categoria: string | null;
  unidade: string;
  /** Nulo quando ninguém contou este item nesta ponta. */
  quantidade: number | null;
  /** Custo congelado no fechamento daquela contagem. */
  custoUnitario: number;
};

export type CompraDoPeriodo = {
  insumoId: string;
  quantidade: number;
  valor: number;
};

export type LinhaDoCmv = {
  insumoId: string;
  nome: string;
  categoria: string | null;
  unidade: string;
  inicial: number;
  valorInicial: number;
  comprado: number;
  valorComprado: number;
  final: number;
  valorFinal: number;
  /** Quanto saiu, em quantidade. Negativo é sinal de erro de contagem. */
  consumo: number;
  /** Quanto custou o que saiu. É a linha do CMV. */
  cmv: number;
};

export type ResultadoCmv = {
  linhas: LinhaDoCmv[];
  valorInicial: number;
  valorComprado: number;
  valorFinal: number;
  cmv: number;
  /** Itens que só apareceram numa das pontas — ficam de fora, com nome. */
  foraDoCalculo: { nome: string; motivo: string }[];
  /** Linhas com consumo negativo: comprou/tinha menos do que sobrou. */
  suspeitas: LinhaDoCmv[];
};

const centavos = (n: number) => Math.round(n * 100) / 100;

export function calcularCmv(
  inicial: ItemContado[],
  final: ItemContado[],
  compras: CompraDoPeriodo[],
): ResultadoCmv {
  const porInsumoInicial = new Map(inicial.map((i) => [i.insumoId, i]));
  const porInsumoFinal = new Map(final.map((i) => [i.insumoId, i]));

  const compradoPorInsumo = new Map<
    string,
    { quantidade: number; valor: number }
  >();
  for (const c of compras) {
    const atual = compradoPorInsumo.get(c.insumoId) ?? {
      quantidade: 0,
      valor: 0,
    };
    atual.quantidade += c.quantidade;
    atual.valor += c.valor;
    compradoPorInsumo.set(c.insumoId, atual);
  }

  const linhas: LinhaDoCmv[] = [];
  const foraDoCalculo: { nome: string; motivo: string }[] = [];

  // Percorre a união das duas pontas: assim um item que existe só num lado
  // aparece no relatório de exclusão em vez de desaparecer calado.
  const todos = new Map<string, ItemContado>();
  for (const i of inicial) todos.set(i.insumoId, i);
  for (const i of final) if (!todos.has(i.insumoId)) todos.set(i.insumoId, i);

  for (const [insumoId, referencia] of todos) {
    const naInicial = porInsumoInicial.get(insumoId);
    const naFinal = porInsumoFinal.get(insumoId);

    const contouInicial = naInicial?.quantidade != null;
    const contouFinal = naFinal?.quantidade != null;

    if (!contouInicial || !contouFinal) {
      foraDoCalculo.push({
        nome: referencia.nome,
        motivo: !contouInicial
          ? "não foi contado na contagem inicial"
          : "não foi contado na contagem final",
      });
      continue;
    }

    const qtdInicial = naInicial!.quantidade!;
    const qtdFinal = naFinal!.quantidade!;
    const compra = compradoPorInsumo.get(insumoId) ?? {
      quantidade: 0,
      valor: 0,
    };

    // Cada ponta é valorizada pelo custo congelado NA SUA contagem. Usar um
    // custo só para as duas faria a variação de preço virar consumo.
    const valorInicial = centavos(qtdInicial * naInicial!.custoUnitario);
    const valorFinal = centavos(qtdFinal * naFinal!.custoUnitario);
    const valorComprado = centavos(compra.valor);

    linhas.push({
      insumoId,
      nome: referencia.nome,
      categoria: referencia.categoria,
      unidade: referencia.unidade,
      inicial: qtdInicial,
      valorInicial,
      comprado: compra.quantidade,
      valorComprado,
      final: qtdFinal,
      valorFinal,
      consumo: qtdInicial + compra.quantidade - qtdFinal,
      cmv: centavos(valorInicial + valorComprado - valorFinal),
    });
  }

  linhas.sort((a, b) => b.cmv - a.cmv);

  return {
    linhas,
    // Somar os valores JÁ ARREDONDADOS de cada linha: quem confere na
    // calculadora precisa chegar no mesmo total que a tela mostra.
    valorInicial: centavos(linhas.reduce((s, l) => s + l.valorInicial, 0)),
    valorComprado: centavos(linhas.reduce((s, l) => s + l.valorComprado, 0)),
    valorFinal: centavos(linhas.reduce((s, l) => s + l.valorFinal, 0)),
    cmv: centavos(linhas.reduce((s, l) => s + l.cmv, 0)),
    foraDoCalculo,
    // Consumo negativo significa que sobrou mais do que existia: erro de
    // contagem, de conversão de embalagem, ou nota faltando. Vale destacar em
    // vez de deixar poluir o total em silêncio.
    suspeitas: linhas.filter((l) => l.consumo < 0),
  };
}

/** O CMV como porcentagem do faturamento — o número que se compara com o mês. */
export function percentualDoCmv(cmv: number, faturamento: number) {
  if (!faturamento || faturamento <= 0) return null;
  return (cmv / faturamento) * 100;
}
