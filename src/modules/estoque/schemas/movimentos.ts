/**
 * O RAZÃO DO ESTOQUE.
 *
 * Funções puras, sem banco. Respondem duas perguntas que o módulo não sabia
 * responder:
 *
 *   Quanto eu joguei fora este mês, e por quê?
 *   Onde a contagem discordou do sistema, e quanto isso valeu?
 */

export type TipoDeMovimento =
  | "ENTRADA"
  | "PERDA"
  | "QUEBRA"
  | "CONSUMO_INTERNO"
  | "DOACAO"
  | "TRANSFERENCIA"
  | "AJUSTE";

/**
 * O efeito de cada tipo sobre o saldo do LOCAL de origem.
 *
 * A transferência devolve −1 e trata o destino à parte: mercadoria que muda de
 * lugar não some da loja, só muda de prateleira. Tratá-la como saída faria o
 * total da unidade encolher a cada vez que alguém desce caixa do depósito.
 */
export function efeitoNoSaldo(tipo: TipoDeMovimento): -1 | 0 | 1 {
  if (tipo === "ENTRADA") return 1;
  if (tipo === "AJUSTE") return 0; // o ajuste GRAVA um valor, não soma nem subtrai
  return -1;
}

/** Sai do estoque da loja de verdade — é o que conta como perda. */
export function ehSaidaReal(tipo: TipoDeMovimento) {
  return (
    tipo === "PERDA" ||
    tipo === "QUEBRA" ||
    tipo === "CONSUMO_INTERNO" ||
    tipo === "DOACAO"
  );
}

export const ROTULO_MOVIMENTO: Record<TipoDeMovimento, string> = {
  ENTRADA: "Entrada por nota",
  PERDA: "Perda",
  QUEBRA: "Quebra",
  CONSUMO_INTERNO: "Consumo interno",
  DOACAO: "Doação",
  TRANSFERENCIA: "Transferência",
  AJUSTE: "Ajuste de contagem",
};

const arredondar = (v: number) => Math.round(v * 100) / 100;

// ---------------------------------------------------------------------------
// O AJUSTE DA CONTAGEM
// ---------------------------------------------------------------------------

export type ItemDaContagem = {
  insumoId: string;
  nome: string;
  /** O que o sistema achava que havia. */
  esperado: number;
  /** O que a pessoa contou. `null` = não contou. */
  contado: number | null;
  custoUnitario: number;
};

export type Divergencia = {
  insumoId: string;
  nome: string;
  esperado: number;
  contado: number;
  /** contado − esperado. Negativo é sumiço. */
  diferenca: number;
  valor: number;
};

export type ResumoDoAjuste = {
  divergencias: Divergencia[];
  /** O que sumiu, em dinheiro (positivo). */
  valorFaltando: number;
  /** O que apareceu a mais. */
  valorSobrando: number;
  /** Falta menos sobra. Negativo = a loja perdeu. */
  liquido: number;
  naoContados: number;
};

/**
 * Compara o contado com o esperado.
 *
 * Item NÃO CONTADO fica de fora — em branco é "não olhei", não "acabou". Tratar
 * como zero mandaria o estoque inteiro para o ajuste toda vez que alguém
 * contasse só a praça, e o valor faltando viraria um número de terror sem
 * nenhuma relação com a realidade.
 *
 * O custo usado é o congelado na contagem: o sumiço de terça vale o preço de
 * terça.
 */
export function compararContagem(itens: ItemDaContagem[]): ResumoDoAjuste {
  const divergencias: Divergencia[] = [];
  let naoContados = 0;

  for (const item of itens) {
    if (item.contado === null) {
      naoContados += 1;
      continue;
    }

    const diferenca = arredondar(item.contado - item.esperado);
    if (diferenca === 0) continue;

    divergencias.push({
      insumoId: item.insumoId,
      nome: item.nome,
      esperado: item.esperado,
      contado: item.contado,
      diferenca,
      valor: arredondar(diferenca * item.custoUnitario),
    });
  }

  // A maior divergência em DINHEIRO primeiro. Ordenar por quantidade poria
  // "300 guardanapos" acima de "2 kg de picanha", que é o contrário do útil.
  divergencias.sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor));

  const valorFaltando = arredondar(
    divergencias.filter((d) => d.valor < 0).reduce((s, d) => s - d.valor, 0),
  );
  const valorSobrando = arredondar(
    divergencias.filter((d) => d.valor > 0).reduce((s, d) => s + d.valor, 0),
  );

  return {
    divergencias,
    valorFaltando,
    valorSobrando,
    liquido: arredondar(valorSobrando - valorFaltando),
    naoContados,
  };
}

// ---------------------------------------------------------------------------
// O RESUMO DE PERDAS
// ---------------------------------------------------------------------------

export type MovimentoParaResumo = {
  tipo: TipoDeMovimento;
  quantidade: number;
  custoUnitario: number;
  motivo: string | null;
  insumo: string;
  categoria: string | null;
};

export type LinhaDoResumo = {
  chave: string;
  quantidade: number;
  valor: number;
  percentual: number | null;
};

export type ResumoDePerdas = {
  total: number;
  porTipo: LinhaDoResumo[];
  porInsumo: LinhaDoResumo[];
  porMotivo: LinhaDoResumo[];
};

/**
 * Quanto foi para o lixo, e por quê.
 *
 * Só as saídas REAIS entram. Transferência não é perda — mudar de prateleira
 * não custa nada —, e ajuste de contagem tem tela própria: misturá-lo aqui
 * transformaria erro de contagem em desperdício e ninguém saberia mais qual é
 * qual.
 */
export function resumirPerdas(
  movimentos: MovimentoParaResumo[],
): ResumoDePerdas {
  const reais = movimentos.filter((m) => ehSaidaReal(m.tipo));

  const total = arredondar(
    reais.reduce((s, m) => s + m.quantidade * m.custoUnitario, 0),
  );

  const agrupar = (chaveDe: (m: MovimentoParaResumo) => string) => {
    const mapa = new Map<string, { quantidade: number; valor: number }>();

    for (const m of reais) {
      const chave = chaveDe(m);
      const atual = mapa.get(chave) ?? { quantidade: 0, valor: 0 };
      atual.quantidade += m.quantidade;
      atual.valor += m.quantidade * m.custoUnitario;
      mapa.set(chave, atual);
    }

    return [...mapa.entries()]
      .map(([chave, v]) => ({
        chave,
        quantidade: Math.round(v.quantidade * 1000) / 1000,
        valor: arredondar(v.valor),
        percentual:
          total > 0 ? Math.round((v.valor / total) * 1000) / 10 : null,
      }))
      .sort((a, b) => b.valor - a.valor);
  };

  return {
    total,
    porTipo: agrupar((m) => ROTULO_MOVIMENTO[m.tipo]),
    porInsumo: agrupar((m) => m.insumo),
    // Sem motivo escrito, a linha vira "sem motivo" em vez de sumir — e ver o
    // tamanho dessa linha é o que faz alguém passar a escrever o motivo.
    porMotivo: agrupar((m) => (m.motivo ?? "").trim() || "sem motivo"),
  };
}
