import { dataBr, diasDoPeriodo, diasEntre } from "./datas.mjs";
import { reais } from "./dinheiro.mjs";
import { limparTexto } from "./sanitizar.mjs";

/**
 * A CONTA DO FECHAMENTO.
 *
 * Pura: recebe as linhas já lidas, devolve os números. Não lê arquivo, não
 * sabe de rede. É o que o modelo NUNCA faz sozinho — ele só redige em cima
 * deste resultado.
 *
 * "Fora do comum" tem régua fixa, escrita aqui e no relatório: o dia vendeu
 * o dobro da mediana, ou menos da metade. Só vale com 7 dias ou mais para
 * comparar — com três dias, qualquer coisa parece fora do comum.
 */

export const FATOR_FORA_DO_COMUM = 2;
export const MINIMO_DE_DIAS_PARA_COMPARAR = 7;

/**
 * A ORDEM DE SEVERIDADE — do mais grave para o mais brando.
 *
 * O relatório e o registro cortam a lista em 30 (MAXIMO_DE_ANOMALIAS, em
 * ferramentas.mjs) para não virar um arquivo de milhares de linhas. Esse
 * corte tem que sobrar com os outliers de verdade, não com os "dia sem
 * linha" — que em um período longo contra um arquivo curto podem ser
 * centenas, e são o tipo mais brando (falta de dado, não dado ruim).
 */
const ORDEM_DE_SEVERIDADE = {
  fora_do_comum: 0,
  valor_negativo: 1,
  data_repetida: 2,
  venda_zero: 3,
  dia_sem_linha: 4,
};

export function mesmaLoja(a, b) {
  const normal = (s) =>
    String(s).normalize("NFC").trim().toLocaleLowerCase("pt-BR");
  return normal(a) === normal(b);
}

function mediana(valores) {
  const v = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(v.length / 2);
  return v.length % 2 ? v[meio] : Math.round((v[meio - 1] + v[meio]) / 2);
}

function avisosDe(base, suspeitas, semTicket) {
  const avisos = [];
  if (base.desatualizado) {
    avisos.push(
      `Arquivo desatualizado: a última informação é de ${dataBr(base.ultimaData)}, há ${base.diasSemAtualizacao} dias.`,
    );
  }
  if (base.linhasDescartadas) {
    avisos.push(
      `${base.linhasDescartadas} linha(s) descartada(s) por erro no arquivo.`,
    );
  }
  if (suspeitas) {
    avisos.push(
      `${suspeitas} campo(s) de observação com forma de instrução foram omitidos e tratados como dado.`,
    );
  }
  if (semTicket)
    avisos.push("Sem pedidos no período: o ticket médio não foi calculado.");
  return avisos;
}

export function calcularFechamento({
  linhas,
  descartadas = [],
  linhasLidas = linhas.length,
  loja,
  de = null,
  ate = null,
  hoje,
  diasParaDesatualizado = 2,
}) {
  const daLoja = linhas.filter((l) => mesmaLoja(l.loja, loja));
  const datas = daLoja.map((l) => l.data).sort();
  const ultimaData = datas.at(-1) ?? null;
  const inicio = de ?? datas[0] ?? null;
  const fim = ate ?? ultimaData;
  const diasSemAtualizacao = ultimaData ? diasEntre(ultimaData, hoje) : null;

  const base = {
    loja,
    periodo: inicio && fim ? { de: inicio, ate: fim } : null,
    linhasLidas,
    linhasDescartadas: descartadas.length,
    descartadas: descartadas.slice(0, 20),
    linhasDeOutraLoja: linhas.length - daLoja.length,
    ultimaData,
    diasSemAtualizacao,
    desatualizado:
      diasSemAtualizacao !== null && diasSemAtualizacao > diasParaDesatualizado,
  };

  const noPeriodo = base.periodo
    ? daLoja.filter((l) => l.data >= inicio && l.data <= fim)
    : [];

  if (noPeriodo.length === 0) {
    return {
      ...base,
      estado: "sem_dados",
      totalCentavos: 0,
      pedidos: 0,
      ticketCentavos: null,
      diasNoPeriodo: base.periodo ? diasDoPeriodo(inicio, fim).length : 0,
      diasComVenda: 0,
      anomalias: [],
      observacoes: [],
      avisos: avisosDe(base, 0, false),
    };
  }

  const porDia = new Map();
  for (const l of noPeriodo) {
    const dia = porDia.get(l.data) ?? { centavos: 0, pedidos: 0, linhas: [] };
    dia.centavos += l.centavos;
    dia.pedidos += l.pedidos;
    dia.linhas.push(l.linha);
    porDia.set(l.data, dia);
  }

  const totalCentavos = noPeriodo.reduce((s, l) => s + l.centavos, 0);
  const pedidos = noPeriodo.reduce((s, l) => s + l.pedidos, 0);
  const ticketCentavos =
    pedidos > 0 ? Math.round(totalCentavos / pedidos) : null;
  const dias = diasDoPeriodo(inicio, fim);

  const anomalias = [];
  for (const d of dias) {
    if (!porDia.has(d)) {
      anomalias.push({
        tipo: "dia_sem_linha",
        data: d,
        texto: `${dataBr(d)} não tem linha no arquivo.`,
      });
    }
  }
  for (const [d, dia] of porDia) {
    if (dia.linhas.length > 1) {
      anomalias.push({
        tipo: "data_repetida",
        data: d,
        texto: `${dataBr(d)} aparece ${dia.linhas.length} vezes (linhas ${dia.linhas.join(", ")}); todas entraram na soma.`,
      });
    }
    if (dia.centavos === 0) {
      anomalias.push({
        tipo: "venda_zero",
        data: d,
        texto: `${dataBr(d)} tem venda zero.`,
      });
    }
  }
  for (const l of noPeriodo) {
    if (l.centavos < 0) {
      anomalias.push({
        tipo: "valor_negativo",
        data: l.data,
        texto: `Linha ${l.linha} (${dataBr(l.data)}) tem valor negativo: ${reais(l.centavos)}.`,
      });
    }
  }

  const positivos = [...porDia.values()]
    .map((d) => d.centavos)
    .filter((c) => c > 0);
  if (positivos.length >= MINIMO_DE_DIAS_PARA_COMPARAR) {
    const med = mediana(positivos);
    for (const [d, dia] of porDia) {
      if (dia.centavos <= 0 || med <= 0) continue;
      const razao = dia.centavos / med;
      if (razao >= FATOR_FORA_DO_COMUM || razao <= 1 / FATOR_FORA_DO_COMUM) {
        // Dígitos SIGNIFICATIVOS, não casas decimais fixas: um dia fraco
        // (R$ 50 contra uma mediana de R$ 1.200, razão 0,0417) com
        // maximumFractionDigits:1 virava "0× a mediana" — uma frase falsa,
        // porque o dia vendeu, só que pouco.
        const vezes = razao.toLocaleString("pt-BR", {
          maximumSignificantDigits: 2,
        });
        anomalias.push({
          tipo: "fora_do_comum",
          data: d,
          texto: `${dataBr(d)} vendeu ${reais(dia.centavos)}, ${vezes}× a mediana dos dias (${reais(med)}).`,
        });
      }
    }
  }
  anomalias.sort(
    (a, b) =>
      ORDEM_DE_SEVERIDADE[a.tipo] - ORDEM_DE_SEVERIDADE[b.tipo] ||
      a.data.localeCompare(b.data),
  );

  const observacoes = [];
  let suspeitas = 0;
  for (const l of noPeriodo) {
    if (!String(l.observacao ?? "").trim()) continue;
    const limpo = limparTexto(l.observacao);
    if (limpo.suspeito) suspeitas++;
    observacoes.push({
      data: l.data,
      linha: l.linha,
      texto: limpo.texto,
      suspeita: limpo.suspeito,
    });
  }

  return {
    ...base,
    estado: "calculado",
    totalCentavos,
    pedidos,
    ticketCentavos,
    diasNoPeriodo: dias.length,
    diasComVenda: [...porDia.values()].filter((d) => d.centavos > 0).length,
    anomalias,
    observacoes: observacoes.slice(0, 20),
    avisos: avisosDe(base, suspeitas, ticketCentavos === null),
  };
}
