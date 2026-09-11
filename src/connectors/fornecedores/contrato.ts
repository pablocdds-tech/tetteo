/**
 * O CONTRATO DE UM CANAL DE MENSAGEM PARA FORNECEDOR.
 *
 * Qualquer canal — o simulador de hoje, o WhatsApp de amanhã, e-mail um dia —
 * implementa isto e nada mais. A forma do resultado é a MESMA que
 * `modules/compras/schemas/ritmo-envio.ts` espera; o relógio, que enxerga os
 * dois lados, liga um no outro e o TypeScript confere que batem.
 *
 * As três respostas de `enviar` não são detalhe:
 *
 *   aceita          o canal recebeu e deu um id. NÃO é "entregue", e muito
 *                   menos "o fornecedor confirmou".
 *   recusada-antes  o canal recusou ANTES de mandar. Seguro tentar de novo
 *                   quando `tentarDeNovo` (fora do ar, limite de ritmo).
 *   incerta         não se sabe se saiu: tempo esgotado, conexão caída no
 *                   meio. NUNCA se reenvia às cegas.
 */

export type ResultadoDoCanal =
  | { tipo: "aceita"; idProvedor: string }
  | { tipo: "recusada-antes"; erro: string; tentarDeNovo: boolean }
  | { tipo: "incerta"; erro: string };

/** Resposta à pergunta "esta mensagem saiu?". */
export type ConsultaDoCanal = "aceita" | "nao-encontrada" | "desconhecido";

export interface CanalDeFornecedor {
  nome: "simulador" | "whatsapp";
  /** Quando `true`, nada sai para fora — e a tela diz isso em voz alta. */
  simulado: boolean;
  enviar(m: {
    destino: string;
    texto: string;
    chave: string;
  }): Promise<ResultadoDoCanal>;
  consultar(m: {
    chave: string;
    idProvedor: string | null;
  }): Promise<ConsultaDoCanal>;
}
