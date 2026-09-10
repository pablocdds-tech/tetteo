import { sigla } from "@/lib/unidades";

/**
 * A CONTA EXATA.
 *
 * Dinheiro e quantidade de Compras nunca passam por ponto flutuante. Em
 * binário, 0,1 + 0,2 não dá 0,3 — e numa cotação que multiplica caixa por
 * preço e soma vinte linhas, o centavo que some ou aparece é justamente o que
 * faz o total do pedido não bater com a nota do fornecedor.
 *
 * Tudo vira INTEIRO numa escala fixa, e as contas são feitas com `BigInt`:
 *
 *   Centavos      R$ 1,00        = 100n
 *   Milesimos     1 kg (ou 1 un) = 1000n      — quantidade na unidade de estoque
 *   DezMilesimos  fator 10,8     = 108000n    — quantas unidades cabem na embalagem
 *   Micros        R$ 1,00        = 1000000n   — preço por unidade, só para comparar
 *
 * A REGRA DE ARREDONDAMENTO (escrita também no desenho, §5):
 *   - arredonda-se UMA vez, no total de cada linha, para o centavo, meio para
 *     cima (0,005 → 0,01);
 *   - comprando embalagem inteira a conta é exata (embalagens × preço da
 *     embalagem) e nada é arredondado;
 *   - o total do pedido é a soma das linhas já arredondadas mais o frete;
 *   - o preço por unidade serve para comparar e nunca é multiplicado para
 *     formar total — senão o arredondamento dele entraria duas vezes.
 */

export type Centavos = bigint;
export type Milesimos = bigint;
export type DezMilesimos = bigint;
export type Micros = bigint;

export const CASAS = {
  centavos: 2,
  milesimos: 3,
  dezMilesimos: 4,
  micros: 6,
} as const;

export class NumeroInvalido extends Error {
  constructor(
    public readonly motivo: "invalido" | "ambiguo" | "casas" | "negativo",
    texto: string,
    casas?: number,
  ) {
    super(
      motivo === "ambiguo"
        ? `Não deu para entender "${texto}": use vírgula para os decimais (1.200,00) ou escreva sem ponto (1200).`
        : motivo === "casas"
          ? `"${texto}" tem casas decimais demais — use no máximo ${casas}.`
          : motivo === "negativo"
            ? `"${texto}" é negativo. Aqui só valem números a partir de zero.`
            : `"${texto}" não é um número.`,
    );
    this.name = "NumeroInvalido";
  }
}

/** Um texto canônico ("-12.5") vira inteiro na escala, meio para cima. */
function escalar(canonico: string, casas: number): bigint {
  const negativo = canonico.startsWith("-");
  const [inteira, fracao = ""] = (
    negativo ? canonico.slice(1) : canonico
  ).split(".");
  const completa = fracao.padEnd(casas + 1, "0");
  let valor = BigInt(inteira + completa.slice(0, casas));
  if (Number(completa[casas]) >= 5) valor += 1n;
  return negativo ? -valor : valor;
}

/**
 * O que vem do banco: `Prisma.Decimal`, texto com PONTO decimal ou número.
 *
 * Separado da leitura do que a pessoa digita porque as regras são opostas: o
 * banco escreve "1.234" querendo dizer um vírgula dois três quatro, e quem
 * digita "1.234" quase sempre quis dizer mil duzentos e trinta e quatro.
 */
export function doBanco(
  valor: { toString(): string } | string | number,
  casas: number,
): bigint {
  if (typeof valor === "number") {
    if (!Number.isFinite(valor))
      throw new NumeroInvalido("invalido", String(valor));
    return escalar(valor.toFixed(casas + 3), casas);
  }
  const texto = valor.toString().trim();
  if (!/^-?\d+(\.\d+)?$/.test(texto)) {
    throw new NumeroInvalido("invalido", texto);
  }
  return escalar(texto, casas);
}

/**
 * O que a pessoa digitou, do jeito que o Brasil digita — a mesma regra de
 * `lib/numero`: vírgula é decimal; ponto sozinho com 1, 2 ou 4+ casas é
 * decimal; ponto com exatamente 3 casas é ambíguo e é RECUSADO.
 *
 * Vazio devolve `null`. Casas a mais são recusadas em vez de arredondadas: um
 * preço "12,555" é um erro de digitação, não um pedido de arredondamento.
 */
export function digitado(
  bruto: string,
  casas: number,
  opcoes: { permitirNegativo?: boolean } = {},
): bigint | null {
  const texto = bruto.trim().replace(/\s/g, "").replace(/^R\$/i, "");
  if (texto === "") return null;

  let canonico: string;
  if (texto.includes(",")) {
    canonico = texto.replace(/\./g, "").replace(",", ".");
  } else if (texto.includes(".")) {
    const partes = texto.split(".");
    if (partes.length > 2) canonico = partes.join("");
    else if (partes[1].length === 3) throw new NumeroInvalido("ambiguo", bruto);
    else canonico = texto;
  } else {
    canonico = texto;
  }

  if (!/^-?\d+(\.\d+)?$/.test(canonico)) {
    throw new NumeroInvalido("invalido", bruto);
  }
  if (canonico.startsWith("-") && !opcoes.permitirNegativo) {
    throw new NumeroInvalido("negativo", bruto);
  }
  const fracao = canonico.split(".")[1] ?? "";
  if (fracao.replace(/0+$/, "").length > casas) {
    throw new NumeroInvalido("casas", bruto, casas);
  }
  return escalar(canonico, casas);
}

/** Inteiro na escala → texto com ponto, do jeito que o Prisma grava. */
export function paraDecimal(valor: bigint, casas: number): string {
  const negativo = valor < 0n;
  const absoluto = (negativo ? -valor : valor)
    .toString()
    .padStart(casas + 1, "0");
  const inteira = absoluto.slice(0, absoluto.length - casas);
  const fracao = absoluto.slice(absoluto.length - casas);
  return `${negativo ? "-" : ""}${inteira}${casas > 0 ? `.${fracao}` : ""}`;
}

// Atalhos com a escala embutida — a maioria das chamadas usa um destes.
export const centavosDoBanco = (v: { toString(): string } | string | number) =>
  doBanco(v, CASAS.centavos);
export const milesimosDoBanco = (v: { toString(): string } | string | number) =>
  doBanco(v, CASAS.milesimos);
export const fatorDoBanco = (v: { toString(): string } | string | number) =>
  doBanco(v, CASAS.dezMilesimos);
export const centavosDigitados = (t: string) => digitado(t, CASAS.centavos);
export const milesimosDigitados = (t: string) => digitado(t, CASAS.milesimos);
export const fatorDigitado = (t: string) => digitado(t, CASAS.dezMilesimos);

/** Divisão inteira com arredondamento meio para cima (longe do zero). */
export function dividirArredondando(
  numerador: bigint,
  denominador: bigint,
): bigint {
  if (denominador === 0n) throw new RangeError("Divisão por zero.");
  const negativo = numerador < 0n !== denominador < 0n;
  const a = numerador < 0n ? -numerador : numerador;
  const b = denominador < 0n ? -denominador : denominador;
  const q = (2n * a + b) / (2n * b);
  return negativo ? -q : q;
}

/** Divisão inteira para cima. Só para positivos — é a das embalagens. */
export function dividirParaCima(
  numerador: bigint,
  denominador: bigint,
): bigint {
  if (denominador <= 0n)
    throw new RangeError("Denominador precisa ser positivo.");
  if (numerador <= 0n) return 0n;
  return (numerador + denominador - 1n) / denominador;
}

/** Quantas embalagens inteiras cobrem a quantidade: ⌈q ÷ fator⌉. */
export function embalagensNecessarias(
  q: Milesimos,
  fator: DezMilesimos,
): bigint {
  return dividirParaCima(q * 10n, fator);
}

/** Quanto vem em N embalagens, na unidade de estoque. */
export function quantidadeDeEmbalagens(
  n: bigint,
  fator: DezMilesimos,
): Milesimos {
  return dividirArredondando(n * fator, 10n);
}

/** Comprando embalagem inteira: exato, sem arredondar nada. */
export function totalPorEmbalagens(
  n: bigint,
  precoEmbalagem: Centavos,
): Centavos {
  return n * precoEmbalagem;
}

/**
 * Comprando a quantidade exata (a granel): q × preço ÷ fator, arredondado uma
 * vez para o centavo, meio para cima.
 */
export function totalFracionado(
  q: Milesimos,
  precoEmbalagem: Centavos,
  fator: DezMilesimos,
): Centavos {
  return dividirArredondando(q * precoEmbalagem * 10n, fator);
}

/** O preço por unidade de estoque — só para comparar, nunca para totalizar. */
export function precoPorUnidade(
  precoEmbalagem: Centavos,
  fator: DezMilesimos,
): Micros {
  return dividirArredondando(precoEmbalagem * 100_000_000n, fator);
}

export function somar(valores: Iterable<bigint>): bigint {
  let total = 0n;
  for (const v of valores) total += v;
  return total;
}

// --------------------------------------------------------------- FORMATAÇÃO

/**
 * Inteiro na escala → número brasileiro, sem passar por `Number`.
 * `minCasas` fixa as casas mostradas mesmo quando são zero (dinheiro).
 */
export function numeroBrDe(
  valor: bigint,
  casas: number,
  {
    minCasas = 0,
    maxCasas = casas,
  }: { minCasas?: number; maxCasas?: number } = {},
): string {
  const arredondado =
    maxCasas < casas
      ? dividirArredondando(valor, 10n ** BigInt(casas - maxCasas))
      : valor;
  const efetivas = Math.min(casas, maxCasas);
  const negativo = arredondado < 0n;
  const absoluto = (negativo ? -arredondado : arredondado)
    .toString()
    .padStart(efetivas + 1, "0");
  const inteira = absoluto.slice(0, absoluto.length - efetivas);
  let fracao = absoluto.slice(absoluto.length - efetivas);
  while (fracao.length > minCasas && fracao.endsWith("0"))
    fracao = fracao.slice(0, -1);
  const comMilhar = inteira.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negativo ? "-" : ""}${comMilhar}${fracao ? `,${fracao}` : ""}`;
}

/** "R$ 1.234,56" */
export function reais(c: Centavos): string {
  return `R$ ${numeroBrDe(c, CASAS.centavos, { minCasas: 2 })}`;
}

/** "R$ 30,00/kg" — com 4 casas quando o preço por unidade é de centavos. */
export function reaisPorUnidade(m: Micros, unidade: string): string {
  const casas = m < 100_000n ? 4 : 2;
  return `R$ ${numeroBrDe(m, CASAS.micros, { minCasas: 2, maxCasas: casas })}/${sigla(unidade)}`;
}

/** "10,8 kg" */
export function quantidadeBr(q: Milesimos, unidade: string): string {
  return `${numeroBrDe(q, CASAS.milesimos)} ${sigla(unidade)}`;
}
