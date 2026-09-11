import { provedorPara } from "@/connectors/whatsapp";
import type { ResultadoEnvio } from "@/connectors/whatsapp/tipos";
import {
  candidatosParaEntrega,
  destinoDoAviso,
  pegarParaEnvio,
  recusarDestino,
  registrarResultado,
} from "@/modules/assistente/services/avisos";

/**
 * A ENTREGA — onde um aviso confirmado vira mensagem.
 *
 * Roda logo depois da confirmação (no `after()` da ação) e a cada batida do
 * relógio, como reserva. Os dois podem se cruzar, e está tudo bem: o aviso
 * só sai por quem conseguir PEGÁ-LO (`CONFIRMADO → NA_FILA`, condicional), e
 * a pegada carrega o ritmo do número — quem chega cedo demais ouve quanto
 * falta e espera. O outro encontra o aviso já pego e segue em frente.
 *
 * O resultado volta do conector em quatro formas, e cada uma tem destino:
 * aceito, não chegou (tenta de novo mais tarde), incerto (não repete — a
 * verificação consulta o provedor) e recusado (falhou de vez).
 *
 * `esperar` e `relogio` existem para o ensaio simular o tempo em vez de
 * dormir de verdade. Em produção são o `setTimeout` e o `new Date()`.
 */

type Ambiente = Record<string, string | undefined>;

const dormir = (ms: number) =>
  new Promise<void>((pronto) => setTimeout(pronto, ms));

/** Se a pegada continuar dizendo "espere" além disso, algo está errado. */
const MAX_ESPERAS_POR_AVISO = 5;

export type ResumoDaEntrega = {
  enviados: number;
  incertos: number;
  falhas: number;
  adiados: number;
};

export async function entregarAvisos({
  agora,
  limite,
  apenasId,
  env = process.env,
  esperar = dormir,
  relogio = () => new Date(),
}: {
  agora: Date;
  limite: number;
  apenasId?: string;
  env?: Ambiente;
  esperar?: (ms: number) => Promise<void>;
  relogio?: () => Date;
}): Promise<ResumoDaEntrega> {
  const resumo: ResumoDaEntrega = {
    enviados: 0,
    incertos: 0,
    falhas: 0,
    adiados: 0,
  };
  const candidatos = await candidatosParaEntrega(agora, limite, apenasId);

  for (const aviso of candidatos) {
    // O destinatário é conferido de novo AGORA: quem perdeu a autorização
    // entre a confirmação e o envio não recebe.
    const destino = await destinoDoAviso(aviso);
    if ("recusa" in destino) {
      await recusarDestino(aviso.id, destino.recusa, relogio());
      resumo.falhas++;
      continue;
    }

    // A pegada é atômica com o ritmo: 4 s entre mensagens do mesmo número,
    // valendo entre este processo e qualquer outro.
    let pegada = await pegarParaEnvio(aviso.id, relogio());
    for (
      let esperas = 0;
      !pegada.pego &&
      pegada.motivo === "ritmo" &&
      esperas < MAX_ESPERAS_POR_AVISO;
      esperas++
    ) {
      await esperar(pegada.esperarMs);
      pegada = await pegarParaEnvio(aviso.id, relogio());
    }
    if (!pegada.pego) {
      if (pegada.motivo === "ritmo") resumo.adiados++;
      continue;
    }

    let resultado: ResultadoEnvio;
    try {
      resultado = await provedorPara(aviso.instancia, env).enviarMensagem({
        para: destino.telefone,
        texto: aviso.corpo,
      });
    } catch {
      // O conector não joga erro; se jogou, não se sabe o que houve.
      resultado = {
        tipo: "incerto",
        motivo:
          "Falha inesperada ao falar com o provedor. A mensagem pode ter saído.",
      };
    }

    let status;
    try {
      status = await registrarResultado(aviso.id, resultado, relogio());
    } catch (erro) {
      // Um aviso que não se deixa gravar não pode parar a entrega dos
      // outros. Ele fica em NA_FILA, vira "resultado desconhecido" em dois
      // minutos, e a verificação decide — nunca um reenvio automático.
      console.error(
        `[whatsapp] entrega: resultado do aviso ${aviso.id} não gravou (${
          erro instanceof Error ? erro.name : "erro"
        })`,
      );
      resumo.incertos++;
      continue;
    }

    if (status === "ACEITO") {
      resumo.enviados++;
    } else if (status === "INCERTO") {
      resumo.incertos++;
    } else if (status === "CONFIRMADO") {
      resumo.adiados++;
    } else {
      resumo.falhas++;
    }
  }

  return resumo;
}
