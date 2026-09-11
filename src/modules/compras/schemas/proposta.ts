import { z } from "zod";

import { lerDataLocal } from "@/lib/data";
import type { Unidade } from "@/lib/unidades";

import {
  CASAS,
  NumeroInvalido,
  digitado,
  type Centavos,
  type DezMilesimos,
  type Milesimos,
} from "./aritmetica";

/**
 * A RESPOSTA DO FORNECEDOR — validação.
 *
 * Chega pelo link público (onde cada campo é hostil até prova em contrário) ou
 * digitada pelo comprador. A MESMA regra vale nos dois caminhos, com uma
 * diferença só: preço zero.
 *
 *   SEM RESPOSTA   a linha não é gravada. É o padrão de todo item.
 *   INDISPONÍVEL   "não trabalho com isso" — gravado, com situação própria.
 *   ZERO           bonificação. NUNCA pelo link: lá, campo vazio é "não
 *                  cotei", e um zero digitado por engano viraria o preço mais
 *                  barato da grade. Pelo comprador, só com autorização
 *                  explícita (`permitirZero`), gravada com motivo.
 *
 * O fator da embalagem NÃO é calculado aqui: depende da unidade do insumo, que
 * está no banco. Aqui só se garante que as partes vieram inteiras.
 */

const UNIDADES = ["KG", "G", "L", "ML", "UN"] as const;

const texto = (max: number) => z.string().trim().max(max).default("");

const esquemaItem = z.object({
  itemDaSolicitacaoId: z.string().trim().min(1).max(40),
  situacao: z.enum(["COTADO", "INDISPONIVEL", "SEM_RESPOSTA"]),
  nomeEmbalagem: texto(40),
  pecas: texto(6),
  conteudo: texto(14),
  unidadeConteudo: z.enum(["", ...UNIDADES]).default(""),
  fracionavel: z.boolean().default(false),
  precoEmbalagem: texto(20),
  disponivel: texto(20),
  observacao: texto(300),
});

const esquemaResposta = z.object({
  frete: texto(20),
  pedidoMinimo: texto(20),
  prazoEntregaDias: texto(4),
  validaAte: texto(10),
  observacao: texto(500),
  itens: z.array(esquemaItem).max(500),
});

export type RespostaBruta = z.input<typeof esquemaResposta>;

export type OfertaValidada = {
  itemDaSolicitacaoId: string;
  situacao: "COTADO" | "INDISPONIVEL";
  nomeEmbalagem: string | null;
  pecas: number;
  conteudo: DezMilesimos | null;
  unidadeConteudo: Unidade | null;
  fracionavel: boolean;
  precoEmbalagem: Centavos | null;
  disponivel: Milesimos | null;
  observacao: string | null;
};

export type RespostaValidada = {
  frete: Centavos | null;
  pedidoMinimo: Centavos | null;
  prazoEntregaDias: number | null;
  validaAte: Date | null;
  observacao: string | null;
  ofertas: OfertaValidada[];
};

export type ResultadoDaValidacao =
  | { ok: true; resposta: RespostaValidada }
  | { ok: false; erros: Record<string, string> };

/** Número digitado; o erro vira frase no campo em vez de exceção. */
function numero(
  valor: string,
  casas: number,
  campo: string,
  erros: Record<string, string>,
): bigint | null {
  try {
    return digitado(valor, casas);
  } catch (erro) {
    if (erro instanceof NumeroInvalido) {
      erros[campo] = erro.message;
      return null;
    }
    throw erro;
  }
}

export function validarResposta(
  bruto: unknown,
  opcoes: { permitirZero: boolean },
): ResultadoDaValidacao {
  const analise = esquemaResposta.safeParse(bruto);
  if (!analise.success) {
    return {
      ok: false,
      erros: {
        geral: "A resposta chegou num formato que o sistema não entende.",
      },
    };
  }
  const d = analise.data;
  const erros: Record<string, string> = {};

  const frete = numero(d.frete, CASAS.centavos, "frete", erros);
  const pedidoMinimo = numero(
    d.pedidoMinimo,
    CASAS.centavos,
    "pedidoMinimo",
    erros,
  );

  let prazoEntregaDias: number | null = null;
  if (d.prazoEntregaDias) {
    const p = Number(d.prazoEntregaDias);
    if (!Number.isInteger(p) || p < 0 || p > 365) {
      erros.prazoEntregaDias = "Informe o prazo em dias, de 0 a 365.";
    } else {
      prazoEntregaDias = p;
    }
  }

  let validaAte: Date | null = null;
  if (d.validaAte) {
    validaAte = lerDataLocal(d.validaAte);
    if (!validaAte) erros.validaAte = "Data inválida.";
  }

  const vistos = new Set<string>();
  const ofertas: OfertaValidada[] = [];

  for (const item of d.itens) {
    const id = item.itemDaSolicitacaoId;
    if (vistos.has(id)) {
      erros[`item:${id}`] = "Este item apareceu duas vezes na resposta.";
      continue;
    }
    vistos.add(id);

    if (item.situacao === "SEM_RESPOSTA") continue;

    const observacao = item.observacao || null;

    if (item.situacao === "INDISPONIVEL") {
      ofertas.push({
        itemDaSolicitacaoId: id,
        situacao: "INDISPONIVEL",
        nomeEmbalagem: null,
        pecas: 1,
        conteudo: null,
        unidadeConteudo: null,
        fracionavel: false,
        precoEmbalagem: null,
        disponivel: null,
        observacao,
      });
      continue;
    }

    const preco = numero(
      item.precoEmbalagem,
      CASAS.centavos,
      `preco:${id}`,
      erros,
    );
    if (item.precoEmbalagem === "") {
      erros[`preco:${id}`] =
        "Informe o preço da embalagem, ou marque que não tem este item.";
    } else if (preco === 0n && !opcoes.permitirZero) {
      erros[`preco:${id}`] =
        "Preço zero não é aceito aqui. Deixe sem resposta, ou marque que não tem o item.";
    }

    const pecas = item.pecas === "" ? 1 : Number(item.pecas);
    if (!Number.isInteger(pecas) || pecas < 1 || pecas > 100_000) {
      erros[`pecas:${id}`] =
        "Informe quantas peças vêm na embalagem (1 ou mais).";
    }

    const conteudo = numero(
      item.conteudo,
      CASAS.dezMilesimos,
      `conteudo:${id}`,
      erros,
    );
    const unidadeConteudo = item.unidadeConteudo || null;
    if (conteudo !== null && conteudo <= 0n) {
      erros[`conteudo:${id}`] = "O conteúdo precisa ser maior que zero.";
    }
    if (conteudo !== null && !unidadeConteudo) {
      erros[`conteudo:${id}`] =
        "Diga a unidade do conteúdo (kg, g, L, ml ou un).";
    }

    const disponivel = numero(
      item.disponivel,
      CASAS.milesimos,
      `disponivel:${id}`,
      erros,
    );

    ofertas.push({
      itemDaSolicitacaoId: id,
      situacao: "COTADO",
      nomeEmbalagem: item.nomeEmbalagem || null,
      pecas,
      conteudo,
      unidadeConteudo: unidadeConteudo as Unidade | null,
      fracionavel: item.fracionavel,
      precoEmbalagem: preco,
      disponivel,
      observacao,
    });
  }

  if (Object.keys(erros).length > 0) return { ok: false, erros };

  return {
    ok: true,
    resposta: {
      frete,
      pedidoMinimo,
      prazoEntregaDias,
      validaAte,
      observacao: d.observacao || null,
      ofertas,
    },
  };
}
