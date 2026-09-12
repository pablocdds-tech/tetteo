import { receberRegistro } from "./receber";

/**
 * POST /api/assistente-privado/registros — o recado do OpenClaw na VPS.
 *
 * Máquina, não gente: fica fora do login (`proxy.ts`) e se autentica pelo
 * cabeçalho `x-assistente-segredo`. As travas moram em `receber.ts`.
 */
export async function POST(request: Request) {
  return receberRegistro(request);
}
