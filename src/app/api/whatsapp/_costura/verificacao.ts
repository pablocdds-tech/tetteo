import { provedorPara } from "@/connectors/whatsapp";
import {
  incertosParaVerificar,
  marcarInterrompidos,
  registrarVerificacao,
} from "@/modules/assistente/services/avisos";

/**
 * A VERIFICAÇÃO — o que acontece depois de um "não sei se saiu".
 *
 * A Evolution 2.3.7 não aceita chave de idempotência. Se o envio esgotou o
 * tempo, repetir pode mandar a mesma mensagem duas vezes. Então, antes de
 * qualquer pessoa pensar em reenviar, o Tetteo PERGUNTA: existe, desde o
 * início da tentativa, uma mensagem enviada por este número com exatamente
 * este texto? A referência `AV-…` no fim torna o texto único.
 *
 * Achou → o aviso vira ACEITO, com o id e o horário do provedor.
 * Não achou → tenta de novo a cada minuto, até cinco vezes, e para. Não achar
 * não prova que não saiu (a Evolution pode não guardar mensagens) — quem
 * decide reenviar é uma pessoa, na tela.
 */

type Ambiente = Record<string, string | undefined>;

/** A consulta olha um minuto antes da tentativa: relógios não batem. */
const FOLGA_MS = 60_000;

export async function verificarIncertos({
  agora,
  env = process.env,
}: {
  agora: Date;
  env?: Ambiente;
}): Promise<{ interrompidos: number; achados: number; naoAchados: number }> {
  const interrompidos = await marcarInterrompidos(agora);
  let achados = 0;
  let naoAchados = 0;

  for (const aviso of await incertosParaVerificar(agora)) {
    const desde = new Date(
      (aviso.tentativaIniciadaEm ?? agora).getTime() - FOLGA_MS,
    );
    const r = await provedorPara(aviso.instancia, env).consultarMensagem({
      texto: aviso.corpo,
      desde,
    });

    if (r.ok && r.valor) {
      await registrarVerificacao(
        aviso.id,
        {
          tipo: "achou",
          idMensagem: r.valor.idMensagem,
          enviadaEm: r.valor.enviadaEm,
        },
        new Date(),
      );
      achados++;
    } else {
      await registrarVerificacao(
        aviso.id,
        r.ok ? { tipo: "nao-achou" } : { tipo: "falhou", motivo: r.motivo },
        new Date(),
      );
      naoAchados++;
    }
  }

  return { interrompidos, achados, naoAchados };
}
