import { NextResponse } from "next/server";

import { rodadaWhatsapp } from "@/app/api/whatsapp/_costura/rodada";
import { enviarTexto } from "@/connectors/whatsapp/evolution";
import {
  INTERVALO_MS,
  MAX_POR_RODADA,
} from "@/modules/assistente/schemas/ritmo";
import { dispararAgentes } from "@/modules/assistente/services/disparo";
import {
  marcarEnviada,
  marcarFalha,
  pendentes,
} from "@/modules/assistente/services/fila";

/**
 * O RELÓGIO DA SEVERINA.
 *
 * Uma tarefa agendada bate aqui a cada minuto. Faz duas coisas, nesta ordem:
 * pergunta quem venceu e enfileira, depois esvazia a fila com ritmo.
 *
 * É a ÚNICA costura entre módulo e conector no sistema inteiro — a camada
 * `app/` é a única que alcança os dois. Por isso o envio mora aqui e não
 * dentro da Severina, e por isso este arquivo é curto: ele não decide nada,
 * só liga uma ponta na outra.
 *
 * Disparável à mão de propósito. No dia em que o aviso das 7h não sair, você
 * quer poder rodar e ver o erro — não adivinhar.
 */

const SEGREDO = process.env.SEVERINA_TICK_SEGREDO ?? "";

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(request: Request) {
  // Sem segredo configurado a rota fica FECHADA, não aberta. Um endereço que
  // dispara WhatsApp exposto na internet é problema, não conveniência — e o
  // padrão inseguro seria justamente o que ninguém percebe.
  if (!SEGREDO || request.headers.get("x-severina-segredo") !== SEGREDO) {
    return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  }

  const agora = new Date();

  // Primeiro o WhatsApp: saúde do número, rascunhos, eventos parados,
  // verificações e os avisos que uma pessoa confirmou.
  const whatsapp = await rodadaWhatsapp({ agora, limite: MAX_POR_RODADA });

  const enfileiradas = await dispararAgentes(agora);

  let enviadas = 0;
  let falhas = 0;

  // O teto é do NÚMERO: o que os avisos já gastaram nesta rodada sai da
  // conta da fila dos agentes.
  const usadas = whatsapp.entrega.enviados + whatsapp.entrega.incertos;
  const fila = await pendentes(Math.max(0, MAX_POR_RODADA - usadas));

  for (const [indice, mensagem] of fila.entries()) {
    // Uma de cada vez, com respiro. Rajada é o comportamento que faz a Meta
    // bloquear o número — e o número é uma conta pessoal com mil contatos.
    if (indice > 0) await espera(INTERVALO_MS);

    const resultado = await enviarTexto(mensagem.telefone, mensagem.texto);

    if (resultado.ok) {
      await marcarEnviada(mensagem.id, resultado.idExterno);
      enviadas++;
    } else {
      await marcarFalha(mensagem.id, resultado.erro, mensagem.tentativas + 1);
      falhas++;
    }
  }

  return NextResponse.json({ whatsapp, enfileiradas, enviadas, falhas });
}
