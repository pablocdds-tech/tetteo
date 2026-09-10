/**
 * O RITMO DO ENVIO AO FORNECEDOR, e o formato do que o canal responde.
 *
 * O formato mora AQUI, e não no conector, porque módulo não importa conector
 * (nem o contrário). O conector em `src/connectors/fornecedores/` devolve um
 * objeto com esta mesma forma, e o relógio — a única camada que enxerga os
 * dois — passa um para o outro. O TypeScript confere que as formas batem.
 */

/** O que o canal disse sobre um envio. */
export type ResultadoDoEnvio =
  /** Aceitou, e deu um id. NÃO quer dizer entregue. */
  | { tipo: "aceita"; idProvedor: string }
  /** Recusou ANTES de mandar — é seguro tentar de novo, se `tentarDeNovo`. */
  | { tipo: "recusada-antes"; erro: string; tentarDeNovo: boolean }
  /** Não se sabe se saiu (tempo esgotado, conexão caiu no meio). */
  | { tipo: "incerta"; erro: string };

/** O que o canal diz quando se pergunta por uma mensagem incerta. */
export type ConsultaDoEnvio = "aceita" | "nao-encontrada" | "desconhecido";

/** Mensagens por batida do relógio. */
export const LOTE = 8;

/** Respiro entre uma mensagem e a seguinte — rajada é o que bloqueia número. */
export const INTERVALO_MS = 4000;

/**
 * Por quanto tempo a mensagem fica "com" quem a pegou. Se o processo morrer
 * no meio, depois disto ela vira INCERTA — nunca volta sozinha para a fila,
 * porque pode ter saído.
 */
export const LEASE_MS = 120_000;

export const MAX_TENTATIVAS = 5;

export function desistiu(tentativas: number): boolean {
  return tentativas >= MAX_TENTATIVAS;
}

/** Espera crescente: 1, 4, 9, 16 minutos. */
export function proximaTentativa(tentativas: number, agora: Date): Date {
  return new Date(agora.getTime() + tentativas * tentativas * 60_000);
}
