import type { CanalDeFornecedor } from "./contrato";
import { criarSimulador } from "./simulador";
import { criarWhatsapp } from "./whatsapp";

export type { CanalDeFornecedor } from "./contrato";
export { criarSimulador } from "./simulador";

/**
 * Qual canal está valendo.
 *
 * O padrão é o SIMULADOR (decisão do Pablo, 10/09/2026). O WhatsApp só liga
 * com `COMPRAS_CANAL=whatsapp` — e nunca em teste, mesmo que alguém esqueça a
 * variável ligada: nenhuma mensagem real sai de um teste.
 */
const simuladorDoProcesso = criarSimulador();

export function canalAtivo(): CanalDeFornecedor {
  if (process.env.NODE_ENV === "test") return simuladorDoProcesso;
  if (process.env.COMPRAS_CANAL === "whatsapp") return criarWhatsapp();
  return simuladorDoProcesso;
}
