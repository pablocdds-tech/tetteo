import { quantidadeBr, type Milesimos } from "./aritmetica";

/**
 * A SUGESTÃO DE COMPRA.
 *
 *     sugestão = mínimo – disponível – já em pedido aberto
 *
 * Três regras, e as três existem por um erro que custa dinheiro:
 *
 *   A CONTA VAI ESCRITA. "6,5 kg" sozinho não diz se saiu do mínimo ou do
 *   dedo de alguém. A fórmula é gravada com o item da requisição.
 *
 *   DADO FALTANDO É ALERTA, NUNCA ZERO. Sem mínimo cadastrado, ou sem nenhuma
 *   contagem nesta loja, o sistema NÃO sugere — e diz por quê. Zero seria
 *   afirmar "não precisa comprar", e ninguém sabe disso.
 *
 *   PEDIDO EM ABERTO CONTA. A mussarela que já está no caminhão não pode ser
 *   pedida de novo só porque ainda não chegou.
 *
 * A sugestão não compra nada: vira requisição, que vira cotação, que vira
 * pedido, que só sai com aprovação.
 *
 * O sinal é o travessão "–" (en dash), e não o menos tipográfico: a fórmula é
 * gravada no banco, e o menos (U+2212) não existe em WIN1252 — já derrubou uma
 * gravação num banco local assim.
 */

export const DIAS_PARA_SALDO_VELHO = 7;

export type EntradaDaSugestao = {
  minimo: Milesimos | null;
  /** `null` = nunca teve posição nesta loja. Não é zero. */
  disponivel: Milesimos | null;
  emPedidoAberto: Milesimos;
  /** Quando o saldo mudou pela última vez (contagem ou entrada). */
  ultimaAtualizacao: Date | null;
  agora: Date;
  unidade: string;
};

export type Sugestao = {
  /** Nunca `0n`: quando a conta não pede compra, é `null`. */
  quantidade: Milesimos | null;
  formula: string | null;
  alertas: string[];
};

export function sugerirCompra(e: EntradaDaSugestao): Sugestao {
  const alertas: string[] = [];
  const u = e.unidade;

  if (e.disponivel === null) {
    alertas.push(
      "Nunca contado nesta loja: o saldo é desconhecido, não zero. Informe quanto comprar.",
    );
  } else if (e.ultimaAtualizacao) {
    const dias = Math.floor(
      (e.agora.getTime() - e.ultimaAtualizacao.getTime()) / 86_400_000,
    );
    if (dias > DIAS_PARA_SALDO_VELHO) {
      alertas.push(`Saldo de ${dias} dias atrás: confira antes de pedir.`);
    }
  }

  if (e.minimo === null) {
    alertas.push(
      "Sem estoque mínimo cadastrado: o sistema não tem base para sugerir.",
    );
  }

  if (e.minimo === null || e.disponivel === null) {
    return { quantidade: null, formula: null, alertas };
  }

  const partes = [
    `mínimo ${quantidadeBr(e.minimo, u)}`,
    `disponível ${quantidadeBr(e.disponivel, u)}`,
  ];
  if (e.emPedidoAberto > 0n) {
    partes.push(`em pedido ${quantidadeBr(e.emPedidoAberto, u)}`);
  }
  const conta = partes.join(" – ");
  const resultado = e.minimo - e.disponivel - e.emPedidoAberto;

  if (resultado <= 0n) {
    return {
      quantidade: null,
      formula:
        resultado === 0n
          ? `${conta}: pela conta, não precisa`
          : `${conta}: pela conta, não precisa (sobram ${quantidadeBr(-resultado, u)})`,
      alertas,
    };
  }

  return {
    quantidade: resultado,
    formula: `${conta} = ${quantidadeBr(resultado, u)}`,
    alertas,
  };
}
