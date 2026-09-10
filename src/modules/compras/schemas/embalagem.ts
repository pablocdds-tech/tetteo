import { sigla, type Unidade } from "@/lib/unidades";

import {
  CASAS,
  dividirArredondando,
  numeroBrDe,
  type DezMilesimos,
} from "./aritmetica";

/**
 * O FATOR DA EMBALAGEM — calculado, nunca digitado.
 *
 * "Caixa com 12 de 900 g" num insumo medido em quilo são 10,8 kg, não 12. É o
 * erro que acontece quando alguém digita o fator de cabeça: lê "12" na caixa e
 * escreve 12. A embalagem aqui é descrita pelas PARTES que estão impressas nela
 * — peças, conteúdo de cada uma, unidade do conteúdo — e o sistema faz a conta.
 *
 * A conta respeita a DIMENSÃO:
 *
 *   massa com massa, volume com volume   → converte (900 g = 0,9 kg)
 *   insumo contado em peças              → vale o número de peças; o peso de
 *                                          cada uma é descrição, não conversão
 *   massa pedida, só peças informadas    → DESCONHECIDO: "12 peças" não vira kg
 *   volume pedido em massa (ou o inverso)→ INCOMPATÍVEL: litro não vira quilo
 *                                          sem a densidade do produto
 *
 * Desconhecido e incompatível não viram um número: bloqueiam a comparação
 * automática daquele item e pedem para alguém conferir. Chutar um fator
 * transformaria uma compra em outra.
 */

type Familia = "massa" | "volume" | "contagem";

/** Quantas unidades-mínimas cabem em cada unidade da família (g, ml, un). */
const FAMILIA: Record<Unidade, { familia: Familia; base: bigint }> = {
  KG: { familia: "massa", base: 1000n },
  G: { familia: "massa", base: 1n },
  L: { familia: "volume", base: 1000n },
  ML: { familia: "volume", base: 1n },
  UN: { familia: "contagem", base: 1n },
};

export type Embalagem = {
  /** Quantas peças vêm na embalagem. 1 para saco, fardo fechado, peça única. */
  pecas: number;
  /** O conteúdo de CADA peça, em décimos de milésimo (900 g → 9_000_000n). */
  conteudo: DezMilesimos | null;
  unidadeConteudo: Unidade | null;
  /** A granel: compra-se a quantidade exata, sem arredondar para embalagem. */
  fracionavel: boolean;
};

export type ResultadoDoFator =
  | { ok: true; fator: DezMilesimos; descricao: string }
  | {
      ok: false;
      motivo: "incompativel" | "desconhecido" | "invalido";
      mensagem: string;
    };

const UM: DezMilesimos = 10n ** BigInt(CASAS.dezMilesimos);

export function descreverEmbalagem(e: Embalagem, base: Unidade): string {
  if (e.fracionavel && e.pecas === 1 && e.conteudo === null) {
    return `a granel (${sigla(base)})`;
  }
  const conteudo =
    e.conteudo !== null && e.unidadeConteudo !== null
      ? `${numeroBrDe(e.conteudo, CASAS.dezMilesimos)} ${sigla(e.unidadeConteudo)}`
      : null;
  if (conteudo === null) {
    return `${e.pecas} ${e.pecas === 1 ? "peça" : "peças"}`;
  }
  return e.pecas === 1 ? conteudo : `${e.pecas} × ${conteudo}`;
}

export function fatorDaEmbalagem(
  base: Unidade,
  e: Embalagem,
): ResultadoDoFator {
  if (!Number.isInteger(e.pecas) || e.pecas < 1) {
    return {
      ok: false,
      motivo: "invalido",
      mensagem: "Informe quantas peças vêm na embalagem — 1 ou mais.",
    };
  }
  if (e.conteudo !== null && e.conteudo <= 0n) {
    return {
      ok: false,
      motivo: "invalido",
      mensagem: "O conteúdo de cada peça precisa ser maior que zero.",
    };
  }

  const pecas = BigInt(e.pecas);
  const destino = FAMILIA[base];
  const descricaoBase = descreverEmbalagem(e, base);
  const pronto = (fator: DezMilesimos): ResultadoDoFator => ({
    ok: true,
    fator,
    descricao: `${descricaoBase} = ${numeroBrDe(fator, CASAS.dezMilesimos)} ${sigla(base)}`,
  });

  // A granel, sem conteúdo: o preço é da própria unidade de estoque.
  if (e.fracionavel && e.pecas === 1 && e.conteudo === null) {
    return pronto(UM);
  }

  const origem = e.unidadeConteudo ? FAMILIA[e.unidadeConteudo] : null;

  if (destino.familia === "contagem") {
    // "10 pacotes × 50 un" num insumo contado em un são 500. Mas "12 × 900 g"
    // num insumo contado em un são 12 — cada peça é uma unidade, e o peso é
    // só o que está escrito nela.
    if (origem?.familia === "contagem" && e.conteudo !== null) {
      return pronto(dividirArredondando(pecas * e.conteudo, 1n));
    }
    return pronto(pecas * UM);
  }

  if (e.conteudo === null || origem === null || origem.familia === "contagem") {
    return {
      ok: false,
      motivo: "desconhecido",
      mensagem: `Falta quanto ${destino.familia === "massa" ? "pesa" : "mede"} cada peça. Sem isso, "${descricaoBase}" não vira ${sigla(base)}.`,
    };
  }

  if (origem.familia !== destino.familia) {
    return {
      ok: false,
      motivo: "incompativel",
      mensagem: `${sigla(e.unidadeConteudo!)} não vira ${sigla(base)} sem a densidade do produto. Confira a embalagem com o fornecedor.`,
    };
  }

  const fator = dividirArredondando(
    pecas * e.conteudo * origem.base,
    destino.base,
  );
  if (fator <= 0n) {
    return {
      ok: false,
      motivo: "invalido",
      mensagem: `A embalagem é pequena demais para ser medida em ${sigla(base)}.`,
    };
  }
  return pronto(fator);
}
