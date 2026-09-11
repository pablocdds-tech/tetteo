import { provedorPara } from "@/connectors/whatsapp";
import type { ResultadoEnvio } from "@/connectors/whatsapp/tipos";
import { INTERVALO_MS } from "@/modules/assistente/schemas/ritmo";
import {
  candidatosParaEntrega,
  destinoDoAviso,
  pegarParaEnvio,
  recusarDestino,
  registrarResultado,
} from "@/modules/assistente/services/avisos";
import { marcarEnvio } from "@/modules/assistente/services/conexao";

/**
 * A ENTREGA — onde um aviso confirmado vira mensagem.
 *
 * Roda logo depois da confirmação (no `after()` da ação) e a cada batida do
 * relógio, como reserva. Os dois podem se cruzar, e está tudo bem: o aviso
 * só sai por quem conseguir PEGÁ-LO (`CONFIRMADO → NA_FILA`, condicional).
 * O outro encontra o aviso já pego e segue em frente.
 *
 * O resultado volta do conector em quatro formas, e cada uma tem destino:
 * aceito, não chegou (tenta de novo mais tarde), incerto (não repete — a
 * verificação consulta o provedor) e recusado (falhou de vez).
 */

type Ambiente = Record<string, string | undefined>;

const dormir = (ms: number) =>
  new Promise<void>((pronto) => setTimeout(pronto, ms));

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
}: {
  agora: Date;
  limite: number;
  apenasId?: string;
  env?: Ambiente;
  esperar?: (ms: number) => Promise<void>;
}): Promise<ResumoDaEntrega> {
  const resumo: ResumoDaEntrega = {
    enviados: 0,
    incertos: 0,
    falhas: 0,
    adiados: 0,
  };
  const candidatos = await candidatosParaEntrega(agora, limite, apenasId);
  const ultimoEnvio = new Map<string, number>();

  for (const aviso of candidatos) {
    // O destinatário é conferido de novo AGORA: quem perdeu a autorização
    // entre a confirmação e o envio não recebe.
    const destino = await destinoDoAviso(aviso);
    if ("recusa" in destino) {
      await recusarDestino(aviso.id, destino.recusa, new Date());
      resumo.falhas++;
      continue;
    }

    // O ritmo é do NÚMERO, não da fila: vale entre os avisos desta rodada e
    // entre esta rodada e o último envio gravado.
    const ultimo =
      ultimoEnvio.get(aviso.instanciaId) ??
      aviso.instancia.ultimoEnvioEm?.getTime() ??
      0;
    const falta = ultimo + INTERVALO_MS - Date.now();
    if (falta > 0) await esperar(falta);

    if (!(await pegarParaEnvio(aviso.id, new Date()))) continue;

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

    if (resultado.tipo !== "nao-chegou" && resultado.tipo !== "recusado") {
      // Aceito ou incerto: pode ter saído, e o respiro vale.
      ultimoEnvio.set(aviso.instanciaId, Date.now());
    }

    let status;
    try {
      status = await registrarResultado(aviso.id, resultado, new Date());
      if (resultado.tipo === "aceito") {
        await marcarEnvio(aviso.instanciaId, new Date());
      }
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

    if (resultado.tipo === "aceito") {
      resumo.enviados++;
    } else if (resultado.tipo === "incerto") {
      resumo.incertos++;
    } else if (status === "CONFIRMADO") {
      resumo.adiados++;
    } else {
      resumo.falhas++;
    }
  }

  return resumo;
}
