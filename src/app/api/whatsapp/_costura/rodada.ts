import { coletarRascunhos } from "@/modules/assistente/services/rascunhos";
import {
  eventosParados,
  limparIgnorados,
  processarEvento,
} from "@/modules/assistente/services/eventos";

import { entregarAvisos, type ResumoDaEntrega } from "./entrega";
import { atualizarSaude } from "./saude";
import { verificarIncertos } from "./verificacao";

/**
 * UMA BATIDA DO RELÓGIO, do lado do WhatsApp. A ordem importa:
 *
 *   1. saúde        — o número está no ar? (entrega não tenta em número caído)
 *   2. rascunhos    — o que aconteceu vira rascunho. Nunca mensagem.
 *   3. eventos      — o que o `after()` deixou para trás
 *   4. verificação  — antes de qualquer envio, resolver os "não sei se saiu"
 *   5. entrega      — os avisos que uma pessoa confirmou
 *   6. limpeza      — eventos ignorados com mais de 30 dias
 *
 * Um passo que quebra não cala os outros: cada um tem o seu `try`, e o erro
 * aparece no resumo que o relógio devolve.
 */

type Ambiente = Record<string, string | undefined>;

export type ResumoDaRodada = {
  conexoesConsultadas: number;
  rascunhosCriados: number;
  eventosReprocessados: number;
  verificacao: { interrompidos: number; achados: number; naoAchados: number };
  entrega: ResumoDaEntrega;
  ignoradosApagados: number;
  falhas: string[];
};

export async function rodadaWhatsapp({
  agora,
  limite,
  env = process.env,
}: {
  agora: Date;
  limite: number;
  env?: Ambiente;
}): Promise<ResumoDaRodada> {
  const resumo: ResumoDaRodada = {
    conexoesConsultadas: 0,
    rascunhosCriados: 0,
    eventosReprocessados: 0,
    verificacao: { interrompidos: 0, achados: 0, naoAchados: 0 },
    entrega: { enviados: 0, incertos: 0, falhas: 0, adiados: 0 },
    ignoradosApagados: 0,
    falhas: [],
  };

  const passo = async (nome: string, fazer: () => Promise<void>) => {
    try {
      await fazer();
    } catch (erro) {
      const texto = erro instanceof Error ? erro.message : String(erro);
      resumo.falhas.push(`${nome}: ${texto.slice(0, 200)}`);
      console.error(`[whatsapp] rodada: ${nome} falhou`);
    }
  };

  await passo("saúde", async () => {
    resumo.conexoesConsultadas = await atualizarSaude({ agora, env });
  });
  await passo("rascunhos", async () => {
    resumo.rascunhosCriados = await coletarRascunhos(
      agora,
      env.APP_URL?.trim() || null,
    );
  });
  await passo("eventos", async () => {
    for (const id of await eventosParados(agora)) {
      await processarEvento(id, agora);
      resumo.eventosReprocessados++;
    }
  });
  await passo("verificação", async () => {
    resumo.verificacao = await verificarIncertos({ agora, env });
  });
  await passo("entrega", async () => {
    resumo.entrega = await entregarAvisos({ agora, limite, env });
  });
  await passo("limpeza", async () => {
    resumo.ignoradosApagados = await limparIgnorados(agora);
  });

  return resumo;
}
