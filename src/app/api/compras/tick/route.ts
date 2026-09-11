import { randomUUID, timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { canalAtivo } from "@/connectors/fornecedores";

import { rodarRelogio } from "./relogio";

/**
 * POST /api/compras/tick — batido por uma tarefa agendada a cada minuto.
 *
 * Sem `COMPRAS_TICK_SEGREDO` configurado a rota fica FECHADA: um endereço que
 * dispara mensagem para fornecedor não pode estar aberto por omissão. A
 * comparação do segredo é de tempo constante.
 *
 * Disparável à mão de propósito: no dia em que um pedido não sair, você quer
 * rodar e ver o resultado — não adivinhar.
 */

function segredoConfere(recebido: string | null): boolean {
  const esperado = process.env.COMPRAS_TICK_SEGREDO ?? "";
  if (!esperado || !recebido) return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!segredoConfere(request.headers.get("x-compras-segredo"))) {
    return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  }
  const canal = canalAtivo();
  const resultado = await rodarRelogio(canal, { dono: `tick-${randomUUID()}` });
  return NextResponse.json({
    canal: canal.nome,
    simulado: canal.simulado,
    ...resultado,
  });
}
