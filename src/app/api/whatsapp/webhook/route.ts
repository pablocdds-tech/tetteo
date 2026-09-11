import { after } from "next/server";

import { receberWebhook } from "../_costura/receber";

/**
 * A PORTA DE ENTRADA DA EVOLUTION.
 *
 * Esta rota não decide nada: entrega o pedido às travas de `receberWebhook`
 * e empresta o `after()` do Next para que o processamento aconteça DEPOIS da
 * resposta. A Evolution espera até 30 s e repete o que demora — responder
 * rápido é o que evita duplicata na origem.
 *
 * Fica fora do login (`proxy.ts`): quem chama é máquina. A autenticação é o
 * passe HS256 que a Evolution 2.3.7 assina com a senha do servidor.
 */
export async function POST(request: Request) {
  return receberWebhook(request, { agendar: (tarefa) => after(tarefa) });
}
