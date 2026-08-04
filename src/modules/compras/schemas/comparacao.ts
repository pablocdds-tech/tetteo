/**
 * A COMPARAÇÃO DA COTAÇÃO.
 *
 * Funções puras, sem banco. Respondem a única pergunta que a cotação existe
 * para responder: **de quem comprar?**
 *
 * ---------------------------------------------------------------------------
 * POR QUE ISTO NÃO É "ACHAR O MENOR NÚMERO".
 *
 * Quatro coisas quebram a comparação ingênua, e todas acontecem toda semana
 * numa pizzaria:
 *
 *   EMBALAGEM. Um vende a caixa de 10 kg por R$ 300, o outro vende o quilo por
 *   R$ 31. R$ 300 parece dez vezes pior e é 3% melhor. Esta é a conta que se
 *   erra de cabeça, no WhatsApp, às seis da manhã — e o preço unitário existe
 *   justamente para ninguém mais precisar fazê-la.
 *
 *   QUANTIDADE. Ser barato no que você compra 200 g por semana não compensa
 *   ser caro no que você compra 40 kg. Comparar preço unitário item a item
 *   sem multiplicar pela quantidade elege o fornecedor errado com frequência.
 *
 *   FRETE E PEDIDO MÍNIMO. Um fornecedor 2% mais barato que cobra R$ 80 de
 *   entrega não é mais barato. E o mais barato que só entrega acima de R$ 500
 *   não é uma opção quando o pedido dá R$ 300.
 *
 *   COBERTURA. Quem não cota tudo não pode ser comparado pelo total como se
 *   cotasse. O sistema separa os dois cenários em vez de misturá-los:
 *   comprar tudo de um só, e comprar cada item de quem está mais barato.
 * ---------------------------------------------------------------------------
 */

export type ItemDaCotacao = {
  id: string;
  nome: string;
  /** Na unidade base do insumo. */
  quantidade: number;
  unidade: string;
};

export type PrecoDeProposta = {
  itemId: string;
  /** Por unidade BASE, já dividido pelo fator da embalagem. */
  precoUnitario: number;
  embalagem: string | null;
  naoAtende: boolean;
};

export type PropostaParaComparar = {
  fornecedorId: string;
  fornecedorNome: string;
  status: "AGUARDANDO" | "RESPONDIDA" | "RECUSADA";
  frete: number;
  pedidoMinimo: number | null;
  precos: PrecoDeProposta[];
};

export type CelulaDaGrade = {
  fornecedorId: string;
  precoUnitario: number | null;
  total: number | null;
  embalagem: string | null;
  naoAtende: boolean;
  /** O mais barato entre quem cotou este item. */
  vencedor: boolean;
  /** Quanto acima do vencedor, em %. Para enxergar quem está fora do páreo. */
  acimaDoVencedor: number | null;
};

export type LinhaDaGrade = {
  item: ItemDaCotacao;
  celulas: CelulaDaGrade[];
  /** `null` quando ninguém cotou. */
  vencedorId: string | null;
  melhorTotal: number | null;
};

export type TotalDoFornecedor = {
  fornecedorId: string;
  fornecedorNome: string;
  /** Quantos itens ele cotou, de quantos existem. */
  itensCotados: number;
  itensTotais: number;
  /** Só quem cotou TUDO pode ser comparado pelo total. */
  completo: boolean;
  subtotal: number;
  frete: number;
  total: number;
  /** Não atinge o pedido mínimo dele. */
  abaixoDoMinimo: boolean;
  /** Quantos itens ele está mais barato. */
  itensVencidos: number;
};

export type Comparacao = {
  grade: LinhaDaGrade[];
  totais: TotalDoFornecedor[];
  /**
   * Comprar TUDO do mesmo fornecedor — o cenário simples, uma entrega, uma
   * conta a pagar. `null` quando ninguém cotou a lista inteira.
   */
  melhorFornecedorUnico: TotalDoFornecedor | null;
  /**
   * Comprar cada item de quem está mais barato. Some o frete de TODOS os
   * fornecedores envolvidos: três entregas custam três fretes, e ignorar isso
   * faria o cenário dividido parecer melhor do que é.
   */
  divididoTotal: number | null;
  divididoFornecedores: number;
  /** Quanto o dividido economiza sobre o melhor fornecedor único. */
  economiaDoDividido: number | null;
  /** Itens que ninguém cotou — o buraco da cotação. */
  itensSemPreco: string[];
};

function arredondar(valor: number) {
  return Math.round(valor * 100) / 100;
}

export function compararPropostas(
  itens: ItemDaCotacao[],
  propostas: PropostaParaComparar[],
): Comparacao {
  // Só quem respondeu entra na comparação. Quem foi recusado ou ainda não
  // respondeu apareceria como "grátis" numa soma de zeros.
  const respondidas = propostas.filter((p) => p.status === "RESPONDIDA");

  const grade: LinhaDaGrade[] = itens.map((item) => {
    const brutas = respondidas.map((proposta) => {
      const preco = proposta.precos.find((p) => p.itemId === item.id);
      const cotou = preco !== undefined && !preco.naoAtende;

      return {
        fornecedorId: proposta.fornecedorId,
        precoUnitario: cotou ? preco.precoUnitario : null,
        total: cotou ? arredondar(preco.precoUnitario * item.quantidade) : null,
        embalagem: preco?.embalagem ?? null,
        naoAtende: preco?.naoAtende ?? false,
      };
    });

    const comPreco = brutas.filter((c) => c.precoUnitario !== null);
    const menor =
      comPreco.length > 0
        ? Math.min(...comPreco.map((c) => c.precoUnitario!))
        : null;

    // Empate elege o primeiro, e é o comportamento certo: dois fornecedores
    // no mesmo preço não têm desempate objetivo, e inventar um (o mais antigo,
    // o alfabético) seria fingir um critério que não existe.
    let jaMarcou = false;
    const celulas: CelulaDaGrade[] = brutas.map((c) => {
      const vencedor =
        !jaMarcou && c.precoUnitario !== null && c.precoUnitario === menor;
      if (vencedor) jaMarcou = true;

      return {
        ...c,
        vencedor,
        acimaDoVencedor:
          c.precoUnitario !== null && menor !== null && menor > 0
            ? Math.round(((c.precoUnitario - menor) / menor) * 1000) / 10
            : null,
      };
    });

    return {
      item,
      celulas,
      vencedorId: celulas.find((c) => c.vencedor)?.fornecedorId ?? null,
      melhorTotal: menor === null ? null : arredondar(menor * item.quantidade),
    };
  });

  const totais: TotalDoFornecedor[] = respondidas.map((proposta) => {
    const minhas = grade
      .map((l) =>
        l.celulas.find((c) => c.fornecedorId === proposta.fornecedorId),
      )
      .filter((c): c is CelulaDaGrade => c !== undefined);

    const cotados = minhas.filter((c) => c.total !== null);
    const subtotal = arredondar(cotados.reduce((s, c) => s + c.total!, 0));
    const total = arredondar(subtotal + proposta.frete);

    return {
      fornecedorId: proposta.fornecedorId,
      fornecedorNome: proposta.fornecedorNome,
      itensCotados: cotados.length,
      itensTotais: itens.length,
      completo: cotados.length === itens.length && itens.length > 0,
      subtotal,
      frete: proposta.frete,
      total,
      abaixoDoMinimo:
        proposta.pedidoMinimo !== null && subtotal < proposta.pedidoMinimo,
      itensVencidos: minhas.filter((c) => c.vencedor).length,
    };
  });

  /**
   * O fornecedor único precisa de duas coisas: ter cotado TUDO e aceitar o
   * tamanho do pedido. Um "mais barato" que não entrega o pedido inteiro não
   * é comparável — quem escolher ele vai acabar comprando de dois de qualquer
   * jeito, com dois fretes que a comparação não previu.
   */
  const elegiveis = totais.filter((t) => t.completo && !t.abaixoDoMinimo);
  const melhorFornecedorUnico =
    elegiveis.length > 0
      ? elegiveis.reduce((a, b) => (b.total < a.total ? b : a))
      : null;

  const linhasComVencedor = grade.filter((l) => l.vencedorId !== null);
  const todosTemPreco =
    itens.length > 0 && linhasComVencedor.length === itens.length;

  let divididoTotal: number | null = null;
  let divididoFornecedores = 0;

  if (todosTemPreco) {
    const vencedores = new Set(linhasComVencedor.map((l) => l.vencedorId!));
    divididoFornecedores = vencedores.size;

    const mercadoria = linhasComVencedor.reduce(
      (s, l) => s + (l.melhorTotal ?? 0),
      0,
    );
    // Cada fornecedor envolvido cobra o frete dele. Somar um frete só, ou
    // nenhum, faria o cenário dividido ganhar sempre — e a pessoa descobriria
    // a diferença só quando as três notas chegassem.
    const fretes = totais
      .filter((t) => vencedores.has(t.fornecedorId))
      .reduce((s, t) => s + t.frete, 0);

    divididoTotal = arredondar(mercadoria + fretes);
  }

  return {
    grade,
    totais: [...totais].sort((a, b) => {
      // Completos primeiro, depois pelo total. Um incompleto barato no topo
      // seria uma armadilha visual.
      if (a.completo !== b.completo) return a.completo ? -1 : 1;
      return a.total - b.total;
    }),
    melhorFornecedorUnico,
    divididoTotal,
    divididoFornecedores,
    economiaDoDividido:
      divididoTotal !== null && melhorFornecedorUnico !== null
        ? arredondar(melhorFornecedorUnico.total - divididoTotal)
        : null,
    itensSemPreco: grade
      .filter((l) => l.vencedorId === null)
      .map((l) => l.item.nome),
  };
}

/**
 * O preço por unidade base, a partir do que o fornecedor falou.
 *
 * "A caixa de 10 kg sai por 300" vira R$ 30,00/kg. Fator zero ou negativo
 * devolve `null` em vez de estourar — quem chama transforma isso em erro de
 * formulário.
 */
export function precoUnitario(
  precoEmbalagem: number,
  fatorConversao: number,
): number | null {
  if (fatorConversao <= 0) return null;
  return Math.round((precoEmbalagem / fatorConversao) * 10_000) / 10_000;
}
