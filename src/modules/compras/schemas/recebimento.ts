import type { Unidade } from "@/lib/unidades";

import {
  dividirArredondando,
  quantidadeBr,
  totalFracionado,
  type Centavos,
  type DezMilesimos,
  type Milesimos,
} from "./aritmetica";

/**
 * A CONFERÊNCIA DO RECEBIMENTO — regra pura.
 *
 * A pessoa conta como o caminhão entrega: "2 caixas". O sistema converte pelo
 * FATOR DO PEDIDO (o que foi combinado), e só o que chegou BOM entra no
 * estoque. As regras, uma por armadilha:
 *
 *   PARCIAL       chegou menos: entra o que chegou, o resto fica pendente.
 *   EXCEDENTE     chegou mais: sem decisão registrada não passa. ACEITAR põe
 *                 tudo para dentro (e abre divergência); RECUSAR devolve o
 *                 excesso na porta.
 *   AVARIA        avariado não entra como disponível — fica no recebimento e
 *                 abre divergência.
 *   SUBSTITUIÇÃO  veio outra coisa: sem decisão não passa. Aceita, entra como
 *                 o insumo que VEIO; recusada, nada entra.
 *
 * Para o saldo do pedido, conta o que entrou BOM. Avariado não cumpre o
 * pedido: ou vem reposição, ou alguém encerra o saldo com motivo.
 */

export type LinhaParaConferir = {
  itemDePedidoId: string;
  insumoId: string;
  nome: string;
  unidade: Unidade;
  fator: DezMilesimos;
  fracionavel: boolean;
  /** O pedido EFETIVO, na unidade de estoque: pedido menos o cancelado. */
  pedido: Milesimos;
  /** O que já entrou BOM em recebimentos anteriores. */
  recebidoAntes: Milesimos;
  precoEmbalagem: Centavos;
};

export type Decisao = "ACEITAR" | "RECUSAR";

export type Informado = {
  itemDePedidoId: string;
  /**
   * Na unidade de COMPRA, em milésimos: 2 caixas = 2000n. A granel, já é a
   * unidade de estoque (6,5 kg = 6500n).
   */
  boas: Milesimos;
  avariadas: Milesimos;
  decisaoExcedente: Decisao | null;
  substitutoInsumoId: string | null;
  decisaoSubstituicao: Decisao | null;
  lote: string | null;
  validade: Date | null;
  observacao: string | null;
  fotoIds: string[];
};

export type Entrada = {
  itemDePedidoId: string;
  /** O insumo que ENTRA — o substituto, quando a substituição foi aceita. */
  insumoId: string;
  embalagensBoas: Milesimos;
  embalagensAvariadas: Milesimos;
  quantidadeBoa: Milesimos;
  quantidadeAvariada: Milesimos;
  quantidadeRecusada: Milesimos;
  valorTotal: Centavos;
  decisaoExcedente: Decisao | null;
  substituicao: boolean;
  decisaoSubstituicao: Decisao | null;
  lote: string | null;
  validade: Date | null;
  observacao: string | null;
  fotoIds: string[];
};

export type DivergenciaNova = {
  tipo: "EXCEDENTE" | "AVARIA" | "SUBSTITUICAO";
  itemDePedidoId: string;
  quantidade: Milesimos;
  impacto: Centavos;
  detalhe: string;
};

export type ResultadoDaConferencia =
  | {
      ok: true;
      entradas: Entrada[];
      divergencias: DivergenciaNova[];
      /** Depois desta entrega, todas as linhas estão cumpridas. */
      completo: boolean;
      valorTotal: Centavos;
    }
  | { ok: false; erros: { itemDePedidoId: string; mensagem: string }[] };

/** Da unidade de compra para a de estoque, pelo fator do pedido. */
export function paraEstoque(l: LinhaParaConferir, emCompra: Milesimos): Milesimos {
  return l.fracionavel ? emCompra : dividirArredondando(emCompra * l.fator, 10_000n);
}

export function conferir(
  linhas: LinhaParaConferir[],
  informados: Informado[],
): ResultadoDaConferencia {
  const erros: { itemDePedidoId: string; mensagem: string }[] = [];
  const entradas: Entrada[] = [];
  const divergencias: DivergenciaNova[] = [];
  const agoraPorLinha = new Map<string, Milesimos>();
  const vistos = new Set<string>();

  for (const inf of informados) {
    const linha = linhas.find((l) => l.itemDePedidoId === inf.itemDePedidoId);
    if (!linha) {
      erros.push({ itemDePedidoId: inf.itemDePedidoId, mensagem: "Item não pertence a este pedido." });
      continue;
    }
    if (vistos.has(inf.itemDePedidoId)) {
      erros.push({ itemDePedidoId: inf.itemDePedidoId, mensagem: "Item repetido na conferência." });
      continue;
    }
    vistos.add(inf.itemDePedidoId);
    if (inf.boas < 0n || inf.avariadas < 0n) {
      erros.push({ itemDePedidoId: linha.itemDePedidoId, mensagem: "Quantidade negativa." });
      continue;
    }
    if (inf.boas === 0n && inf.avariadas === 0n) continue;

    const u = linha.unidade;
    const boa = paraEstoque(linha, inf.boas);
    const avariada = paraEstoque(linha, inf.avariadas);
    const preco = (q: Milesimos) => totalFracionado(q, linha.precoEmbalagem, linha.fator);

    // ---- substituição
    const substituiu = inf.substitutoInsumoId !== null && inf.substitutoInsumoId !== linha.insumoId;
    if (substituiu && !inf.decisaoSubstituicao) {
      erros.push({
        itemDePedidoId: linha.itemDePedidoId,
        mensagem: `${linha.nome}: veio outro produto. Decida se aceita ou recusa.`,
      });
      continue;
    }
    const substituicaoRecusada = substituiu && inf.decisaoSubstituicao === "RECUSAR";

    // ---- excedente (só o que é bom conta para o pedido)
    const aindaFalta = linha.pedido - linha.recebidoAntes;
    const excedente = substituicaoRecusada ? 0n : boa - (aindaFalta > 0n ? aindaFalta : 0n);
    if (excedente > 0n && !inf.decisaoExcedente) {
      erros.push({
        itemDePedidoId: linha.itemDePedidoId,
        mensagem: `${linha.nome}: chegou ${quantidadeBr(excedente, u)} a mais que o pedido. Decida se aceita ou recusa o excesso.`,
      });
      continue;
    }

    let entra = boa;
    let recusada = 0n;
    if (substituicaoRecusada) {
      entra = 0n;
      recusada = boa;
    } else if (excedente > 0n && inf.decisaoExcedente === "RECUSAR") {
      entra = boa - excedente;
      recusada = excedente;
    }

    entradas.push({
      itemDePedidoId: linha.itemDePedidoId,
      insumoId: substituiu && !substituicaoRecusada ? inf.substitutoInsumoId! : linha.insumoId,
      embalagensBoas: inf.boas,
      embalagensAvariadas: inf.avariadas,
      quantidadeBoa: entra,
      quantidadeAvariada: avariada,
      quantidadeRecusada: recusada,
      valorTotal: preco(entra),
      decisaoExcedente: excedente > 0n ? inf.decisaoExcedente : null,
      substituicao: substituiu,
      decisaoSubstituicao: substituiu ? inf.decisaoSubstituicao : null,
      lote: inf.lote,
      validade: inf.validade,
      observacao: inf.observacao,
      fotoIds: inf.fotoIds,
    });
    agoraPorLinha.set(linha.itemDePedidoId, entra);

    if (excedente > 0n) {
      divergencias.push({
        tipo: "EXCEDENTE",
        itemDePedidoId: linha.itemDePedidoId,
        quantidade: excedente,
        impacto: inf.decisaoExcedente === "ACEITAR" ? preco(excedente) : 0n,
        detalhe:
          inf.decisaoExcedente === "ACEITAR"
            ? `${linha.nome}: ${quantidadeBr(excedente, u)} a mais, ACEITOS.`
            : `${linha.nome}: ${quantidadeBr(excedente, u)} a mais, recusados na porta.`,
      });
    }
    if (avariada > 0n) {
      divergencias.push({
        tipo: "AVARIA",
        itemDePedidoId: linha.itemDePedidoId,
        quantidade: avariada,
        impacto: preco(avariada),
        detalhe: `${linha.nome}: ${quantidadeBr(avariada, u)} avariados — não entraram no estoque.`,
      });
    }
    if (substituiu) {
      divergencias.push({
        tipo: "SUBSTITUICAO",
        itemDePedidoId: linha.itemDePedidoId,
        quantidade: boa,
        impacto: 0n,
        detalhe: substituicaoRecusada
          ? `${linha.nome}: veio outro produto, recusado.`
          : `${linha.nome}: veio outro produto, aceito no lugar.`,
      });
    }
  }

  if (erros.length > 0) return { ok: false, erros };
  if (entradas.length === 0) {
    return {
      ok: false,
      erros: [{ itemDePedidoId: "", mensagem: "Nada foi informado. Conte ao menos um item." }],
    };
  }

  const completo = linhas.every(
    (l) => l.recebidoAntes + (agoraPorLinha.get(l.itemDePedidoId) ?? 0n) >= l.pedido,
  );

  return {
    ok: true,
    entradas,
    divergencias,
    completo,
    valorTotal: entradas.reduce((s, e) => s + e.valorTotal, 0n),
  };
}
