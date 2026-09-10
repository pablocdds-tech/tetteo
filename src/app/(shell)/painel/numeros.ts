/**
 * OS NÚMEROS DO PAINEL.
 *
 * Função pura, sem banco: recebe as contas já carregadas e devolve os quatro
 * indicadores. Separada da tela para poder ser TESTADA — indicador errado num
 * painel não dá erro, não quebra nada e não aparece. Ele só faz alguém decidir
 * errado, meses depois, sem nunca desconfiar do número.
 *
 * Duas regras que valem mais que a soma:
 *
 * 1. A MESMA POPULAÇÃO. "Vencido" e "a pagar no período" saem da mesma lista,
 *    com o mesmo recorte de unidade e de período que a tabela mostra. Se o
 *    indicador contasse uma coisa e a tabela outra, o gestor clicaria para
 *    conferir e encontraria um total diferente — e a partir daí não confiaria
 *    em nenhum dos dois.
 *
 * 2. CANCELADO NÃO EXISTE. Ele nunca esteve na fila. Somá-lo faria o "a pagar"
 *    nunca diminuir. Quitado saiu da fila e também não entra no que falta
 *    pagar — mas continua na tabela, porque "o que eu já paguei este mês" é
 *    outra pergunta legítima.
 *
 * O arredondamento é o mesmo do resto do Financeiro: soma em reais e arredonda
 * no fim, ao centavo.
 */

export type ContaParaContar = {
  direcao: "PAGAR" | "RECEBER";
  status: "ABERTO" | "QUITADO" | "CANCELADO";
  valor: number;
  atrasado: boolean;
};

export type NumerosDoPainel = {
  /** Contas a pagar que passaram do prazo e continuam abertas. */
  vencidoAPagar: number;
  contasVencidas: number;
  /** A pagar em aberto que ainda não venceu, dentro do período. */
  aPagarNoPeriodo: number;
  contasAPagar: number;
  /** A receber em aberto dentro do período, vencido ou não. */
  aReceberNoPeriodo: number;
  contasAReceber: number;
};

function arredondar(valor: number) {
  return Math.round(valor * 100) / 100;
}

export function numerosDoPainel(contas: ContaParaContar[]): NumerosDoPainel {
  const abertas = contas.filter((c) => c.status === "ABERTO");

  const vencidas = abertas.filter((c) => c.direcao === "PAGAR" && c.atrasado);
  const aPagar = abertas.filter((c) => c.direcao === "PAGAR" && !c.atrasado);
  const aReceber = abertas.filter((c) => c.direcao === "RECEBER");

  const somar = (lista: ContaParaContar[]) =>
    arredondar(lista.reduce((total, c) => total + c.valor, 0));

  return {
    vencidoAPagar: somar(vencidas),
    contasVencidas: vencidas.length,
    aPagarNoPeriodo: somar(aPagar),
    contasAPagar: aPagar.length,
    aReceberNoPeriodo: somar(aReceber),
    contasAReceber: aReceber.length,
  };
}
