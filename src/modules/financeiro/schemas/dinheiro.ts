/**
 * A MATEMÁTICA DO DINHEIRO.
 *
 * Funções puras, sem banco. Trabalham em CENTAVOS inteiros de propósito.
 *
 * ---------------------------------------------------------------------------
 * POR QUE CENTAVOS INTEIROS.
 *
 * R$ 100 em três parcelas dá 33,3333. Arredondando cada uma para 33,33, as
 * três somam 99,99 — e o centavo que sumiu vira divergência com o boleto do
 * fornecedor, todo mês, para sempre. Quem confere planilha encontra; quem não
 * confere descobre no cartório.
 *
 * A regra aqui é: divide em inteiros, e o resto vai para as PRIMEIRAS
 * parcelas. 100,00 em três vira 33,34 + 33,33 + 33,33. É o que o banco faz,
 * e é o que a pessoa espera ver na primeira linha.
 * ---------------------------------------------------------------------------
 */

/** Reais → centavos, sem erro de ponto flutuante. */
export function emCentavos(reais: number) {
  return Math.round(reais * 100);
}

export function emReais(centavos: number) {
  return centavos / 100;
}

/**
 * Divide um valor em N parcelas somando EXATAMENTE o original.
 *
 * O resto é distribuído nas primeiras, um centavo em cada — nunca jogado fora
 * nem empilhado todo na última, que produziria uma parcela final visivelmente
 * diferente das outras.
 */
export function dividirEmParcelas(valor: number, vezes: number): number[] {
  if (vezes < 1) return [];

  const total = emCentavos(valor);
  const base = Math.floor(Math.abs(total) / vezes);
  const resto = Math.abs(total) - base * vezes;
  const sinal = total < 0 ? -1 : 1;

  return Array.from({ length: vezes }, (_, i) =>
    emReais(sinal * (base + (i < resto ? 1 : 0))),
  );
}

/**
 * As datas de vencimento das parcelas, de mês em mês.
 *
 * Dia 31 não existe em fevereiro. Em vez de pular para 3 de março — que
 * atrasaria o aluguel — a data cai no último dia do mês. É o que todo contrato
 * de aluguel faz na prática.
 */
export function vencimentosMensais(primeiro: Date, vezes: number): Date[] {
  const dia = primeiro.getDate();

  return Array.from({ length: vezes }, (_, i) => {
    const alvo = new Date(
      primeiro.getFullYear(),
      primeiro.getMonth() + i,
      1,
      primeiro.getHours(),
      primeiro.getMinutes(),
    );
    const ultimoDia = new Date(
      alvo.getFullYear(),
      alvo.getMonth() + 1,
      0,
    ).getDate();
    alvo.setDate(Math.min(dia, ultimoDia));
    return alvo;
  });
}

// ---------------------------------------------------------------------------
// O FLUXO
// ---------------------------------------------------------------------------

export type LancamentoParaFluxo = {
  id: string;
  direcao: "PAGAR" | "RECEBER";
  status: "ABERTO" | "QUITADO" | "CANCELADO";
  valor: number;
  vencimento: Date;
  quitadoEm: Date | null;
  valorQuitado: number | null;
};

export type Faixa = "vencido" | "hoje" | "semana" | "depois";

export type ResumoDoFluxo = {
  aPagar: Record<Faixa, number>;
  aReceber: Record<Faixa, number>;
  /** Total em aberto, dos dois lados. */
  totalAPagar: number;
  totalAReceber: number;
  /** O que sobra se tudo em aberto for liquidado. */
  saldoDoPeriodo: number;
  contasVencidas: number;
};

function soData(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function arredondar(v: number) {
  return Math.round(v * 100) / 100;
}

/**
 * Onde cada conta cai em relação a hoje.
 *
 * Vencido primeiro, sempre. A pergunta do dia 5 não é "quanto devo no mês" —
 * é "o que já venceu e eu não vi".
 */
export function faixaDoVencimento(vencimento: Date, hoje: Date): Faixa {
  const v = soData(vencimento);
  const h = soData(hoje);

  if (v < h) return "vencido";
  if (v.getTime() === h.getTime()) return "hoje";

  const emSeteDias = new Date(h);
  emSeteDias.setDate(emSeteDias.getDate() + 7);
  if (v <= emSeteDias) return "semana";

  return "depois";
}

export function resumirFluxo(
  lancamentos: LancamentoParaFluxo[],
  hoje: Date,
): ResumoDoFluxo {
  const vazio = (): Record<Faixa, number> => ({
    vencido: 0,
    hoje: 0,
    semana: 0,
    depois: 0,
  });

  const aPagar = vazio();
  const aReceber = vazio();
  let contasVencidas = 0;

  // Só o que está ABERTO. Quitado saiu da fila; cancelado nunca esteve nela —
  // somar qualquer um dos dois faria o "a pagar" nunca diminuir.
  for (const l of lancamentos.filter((x) => x.status === "ABERTO")) {
    const faixa = faixaDoVencimento(l.vencimento, hoje);
    const alvo = l.direcao === "PAGAR" ? aPagar : aReceber;
    alvo[faixa] = arredondar(alvo[faixa] + l.valor);
    if (faixa === "vencido" && l.direcao === "PAGAR") contasVencidas += 1;
  }

  const totalAPagar = arredondar(
    Object.values(aPagar).reduce((s, v) => s + v, 0),
  );
  const totalAReceber = arredondar(
    Object.values(aReceber).reduce((s, v) => s + v, 0),
  );

  return {
    aPagar,
    aReceber,
    totalAPagar,
    totalAReceber,
    saldoDoPeriodo: arredondar(totalAReceber - totalAPagar),
    contasVencidas,
  };
}

export type DiaDoFluxo = {
  data: Date;
  entradas: number;
  saidas: number;
  saldo: number;
};

/**
 * O saldo dia a dia, projetando o que está em aberto.
 *
 * Começa no saldo REAL das contas e caminha para a frente. É a única tela que
 * responde "em que dia o dinheiro acaba?" — e a resposta muda decisão de
 * compra hoje, não no fim do mês.
 *
 * Contas vencidas e ainda abertas entram no PRIMEIRO dia: elas já deveriam ter
 * saído, e empurrá-las para a data original faria o saldo do passado parecer
 * pior e o de hoje parecer melhor do que é.
 */
export function projetarSaldo(
  saldoAtual: number,
  lancamentos: LancamentoParaFluxo[],
  hoje: Date,
  dias: number,
): DiaDoFluxo[] {
  const inicio = soData(hoje);
  const fim = new Date(inicio);
  fim.setDate(fim.getDate() + dias - 1);

  const porDia = new Map<number, { entradas: number; saidas: number }>();

  for (const l of lancamentos.filter((x) => x.status === "ABERTO")) {
    const v = soData(l.vencimento);
    const chave = (v < inicio ? inicio : v).getTime();
    if (chave > fim.getTime()) continue;

    const atual = porDia.get(chave) ?? { entradas: 0, saidas: 0 };
    if (l.direcao === "RECEBER") atual.entradas += l.valor;
    else atual.saidas += l.valor;
    porDia.set(chave, atual);
  }

  const linhas: DiaDoFluxo[] = [];
  let saldo = saldoAtual;

  for (let i = 0; i < dias; i += 1) {
    const dia = new Date(inicio);
    dia.setDate(dia.getDate() + i);

    const movimento = porDia.get(dia.getTime()) ?? { entradas: 0, saidas: 0 };
    saldo = arredondar(saldo + movimento.entradas - movimento.saidas);

    linhas.push({
      data: dia,
      entradas: arredondar(movimento.entradas),
      saidas: arredondar(movimento.saidas),
      saldo,
    });
  }

  return linhas;
}

export type LinhaDoResultado = {
  categoria: string;
  grupo: string | null;
  tipo: "RECEITA" | "DESPESA";
  valor: number;
  /** Quanto esta linha representa da receita total. */
  percentual: number | null;
};

export type Resultado = {
  receitas: LinhaDoResultado[];
  despesas: LinhaDoResultado[];
  totalReceitas: number;
  totalDespesas: number;
  sobra: number;
  margem: number | null;
  semCategoria: number;
};

/**
 * O resultado do período, POR CAIXA.
 *
 * Soma o que foi efetivamente quitado, na data em que foi quitado. Não é DRE
 * por competência e a tela diz isso: mercadoria comprada em julho e consumida
 * em agosto é custo de agosto, e quem responde essa pergunta é o CMV do
 * Estoque, com a contagem na mão.
 *
 * O valor usado é o QUITADO, não o original. Desconto por antecipação e juro
 * por atraso são dinheiro real que entrou ou saiu.
 */
export function calcularResultado(
  quitados: {
    direcao: "PAGAR" | "RECEBER";
    valor: number;
    valorQuitado: number | null;
    categoria: { nome: string; grupo: string | null } | null;
  }[],
): Resultado {
  const acumular = new Map<string, LinhaDoResultado>();
  let semCategoria = 0;

  for (const l of quitados) {
    const valor = l.valorQuitado ?? l.valor;

    if (!l.categoria) {
      semCategoria = arredondar(semCategoria + valor);
      continue;
    }

    const tipo = l.direcao === "RECEBER" ? "RECEITA" : "DESPESA";
    const chave = `${tipo}:${l.categoria.nome}`;
    const atual = acumular.get(chave);

    if (atual) atual.valor = arredondar(atual.valor + valor);
    else {
      acumular.set(chave, {
        categoria: l.categoria.nome,
        grupo: l.categoria.grupo,
        tipo,
        valor: arredondar(valor),
        percentual: null,
      });
    }
  }

  const linhas = [...acumular.values()];
  const receitas = linhas.filter((l) => l.tipo === "RECEITA");
  const despesas = linhas.filter((l) => l.tipo === "DESPESA");

  const totalReceitas = arredondar(receitas.reduce((s, l) => s + l.valor, 0));
  const totalDespesas = arredondar(despesas.reduce((s, l) => s + l.valor, 0));

  // O percentual é sempre sobre a RECEITA — é assim que se lê custo de
  // restaurante ("a folha é 28% do faturamento"). Sobre o total de despesas
  // daria um número que não se compara com nada do mercado.
  for (const linha of linhas) {
    linha.percentual =
      totalReceitas > 0
        ? Math.round((linha.valor / totalReceitas) * 1000) / 10
        : null;
  }

  const ordenar = (a: LinhaDoResultado, b: LinhaDoResultado) =>
    b.valor - a.valor;

  return {
    receitas: receitas.sort(ordenar),
    despesas: despesas.sort(ordenar),
    totalReceitas,
    totalDespesas,
    sobra: arredondar(totalReceitas - totalDespesas),
    margem:
      totalReceitas > 0
        ? Math.round(((totalReceitas - totalDespesas) / totalReceitas) * 1000) /
          10
        : null,
    semCategoria,
  };
}
