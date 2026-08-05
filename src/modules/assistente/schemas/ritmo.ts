/**
 * O RITMO — o que protege o número de ser banido.
 *
 * A fila da Severina existe por causa de uma trava do linter: módulo não pode
 * importar conector, então ela grava a mensagem e o relógio entrega. O efeito
 * colateral virou a peça mais importante — como o envio passa por um lugar só,
 * existe onde segurar a mão.
 *
 * O número é uma conta PESSOAL, com mais de mil contatos. Rajada é o
 * comportamento que a Meta bloqueia, e o bloqueio levaria junto o histórico
 * pessoal de quem é dono da linha. Nenhum dos números abaixo é otimização
 * pendente: cada um é uma escolha de não correr risco.
 */

/** Mensagens por batida do relógio. O relógio bate a cada minuto. */
export const MAX_POR_RODADA = 8;

/** Respiro entre uma mensagem e a seguinte, dentro da mesma rodada. */
export const INTERVALO_MS = 4000;

/**
 * Depois disso a mensagem é dada como perdida e aparece como FALHOU na tela.
 * Fila que tenta para sempre vira fila que esconde o problema.
 */
const MAX_TENTATIVAS = 5;

export function desistiu(tentativas: number): boolean {
  return tentativas >= MAX_TENTATIVAS;
}

/**
 * Espera crescente: 1min, 4min, 9min, 16min.
 *
 * Quadrática em vez de dobrando, porque o caso comum aqui é a Evolution
 * reiniciando — volta em segundos, não em horas. Uma curva agressiva demais
 * atrasaria a cobrança do dia por causa de um soluço.
 */
export function proximaTentativa(
  tentativas: number,
  ultimaFalhaEm: Date,
): Date {
  const minutos = tentativas * tentativas;
  return new Date(ultimaFalhaEm.getTime() + minutos * 60_000);
}
