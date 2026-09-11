import { createHash } from "node:crypto";

import type { ConsultaDeVendas, FonteDeVendas } from "./tipos.js";

/**
 * A FONTE DE ENSAIO.
 *
 * Existe para testar o contrato antes de haver venda real no Tetteo. É
 * DETERMINÍSTICA: a mesma loja e a mesma data geram sempre os mesmos pedidos.
 * É isso que permite conferir a resposta da ferramenta contra "a fonte
 * original" — recalcular por fora, a partir da mesma lista, e comparar.
 *
 * Os números são plausíveis de propósito (mais pedidos de sexta a domingo),
 * mas cada resposta sai marcada como fictícia pela ferramenta.
 */

export type PedidoFicticio = { numero: number; valorCentavos: number };

/** mulberry32: pequeno, rápido e repetível a partir de uma semente. */
function gerador(semente: Buffer): () => number {
  let estado = semente.readUInt32LE(0);
  return () => {
    estado = (estado + 0x6d2b79f5) | 0;
    let t = Math.imul(estado ^ (estado >>> 15), 1 | estado);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pedidosFicticios({
  unidadeId,
  data,
}: ConsultaDeVendas): PedidoFicticio[] {
  const aleatorio = gerador(
    createHash("sha256").update(`${unidadeId}|${data}`).digest(),
  );
  const diaDaSemana = new Date(`${data}T12:00:00Z`).getUTCDay();
  const movimentado = diaDaSemana === 0 || diaDaSemana >= 5;
  const quantidade = (movimentado ? 90 : 45) + Math.floor(aleatorio() * 50);

  return Array.from({ length: quantidade }, (_, indice) => ({
    numero: indice + 1,
    valorCentavos: 3500 + Math.floor(aleatorio() * 12500),
  }));
}

export function criarFonteFicticia(): FonteDeVendas {
  return {
    nome: "ficticia",
    ehFicticia: true,
    async vendasDoDia(consulta, sinal) {
      sinal.throwIfAborted();
      const pedidos = pedidosFicticios(consulta);
      return {
        quantidade: pedidos.length,
        totalCentavos: pedidos.reduce(
          (soma, pedido) => soma + pedido.valorCentavos,
          0,
        ),
      };
    },
  };
}
