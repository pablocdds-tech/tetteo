import { createHash } from "node:crypto";

import { z } from "zod";

import { ehGrupo, normalizarTelefone } from "@/lib/telefone";

/**
 * O WEBHOOK DA EVOLUTION 2.3.7, traduzido.
 *
 * Recebe o texto cru do corpo e devolve um evento no vocabulário do Tetteo —
 * só com o que a Severina precisa, e sem nada que não possa ser guardado. O
 * texto de mensagem vira hash; o `remoteJid` de quem escreve só atravessa
 * (para achar o vínculo) e não é devolvido para gravação em nenhum outro tipo.
 *
 * O formato vem do código da 2.3.7, não da documentação — as duas divergem
 * (ver o desenho, §3). O envelope é conferido de forma ESTRITA: campo a mais
 * no envelope é recusado. Dentro de `data` só se exige o que se lê, porque ali
 * a Evolution manda dezenas de campos que não nos dizem respeito.
 *
 *   400  não é JSON, envelope fora do formato, dados sem o que se precisa
 *   422  tipo de evento que o Tetteo não assina — o QR Code inclusive
 */

export const TIPOS_ACEITOS = [
  "connection.update",
  "messages.update",
  "send.message",
  "messages.upsert",
] as const;
export type TipoAceito = (typeof TIPOS_ACEITOS)[number];

/** `renderStatus.ts` da 2.3.7. Desconhecido lá vira SERVER_ACK. */
export const STATUS_DO_PROVEDOR = [
  "ERROR",
  "PENDING",
  "SERVER_ACK",
  "DELIVERY_ACK",
  "READ",
  "PLAYED",
  "DELETED",
] as const;
export type StatusDoProvedor = (typeof STATUS_DO_PROVEDOR)[number];

/** Nenhum dos quatro tipos chega perto disto sem mídia em base64. */
export const LIMITE_DO_CORPO = 256 * 1024;

export type EventoDaEvolution =
  | {
      tipo: "connection.update";
      instancia: string;
      idExterno: string;
      estado: "open" | "connecting" | "close" | "refused";
      codigo: number | null;
      /** O número do PRÓPRIO aparelho conectado, em E.164. */
      numero: string | null;
    }
  | {
      tipo: "messages.update";
      instancia: string;
      idExterno: string;
      idMensagem: string;
      status: StatusDoProvedor;
      deMim: boolean;
    }
  | {
      tipo: "send.message";
      instancia: string;
      idExterno: string;
      idMensagem: string;
      /** SHA-256 do texto enviado — casa um aviso INCERTO sem guardar texto. */
      hashTexto: string | null;
      enviadaEm: Date | null;
    }
  | {
      tipo: "messages.upsert";
      instancia: string;
      idExterno: string;
      idMensagem: string;
      deMim: boolean;
      grupo: boolean;
      /** TRANSITÓRIO: só para achar o vínculo. Nunca é gravado. */
      remetente: string;
    };

export type Interpretacao =
  | { ok: true; evento: EventoDaEvolution }
  | { ok: false; status: 400 | 422; motivo: string };

const envelope = z
  .object({
    event: z.string(),
    instance: z.string().trim().min(1).max(100),
    data: z.record(z.string(), z.unknown()),
    destination: z.string().max(2000).optional(),
    date_time: z.string().max(100).optional(),
    sender: z.string().max(200).nullable().optional(),
    server_url: z.string().max(2000).optional(),
    apikey: z.string().max(500).nullable().optional(),
  })
  .strict();

const idDeMensagem = z.string().trim().min(1).max(200);

const dadosDeConexao = z.object({
  state: z.enum(["open", "connecting", "close", "refused"]),
  statusReason: z.number().int().nullable().optional(),
  wuid: z.string().max(200).optional(),
});

const dadosDeStatus = z.object({
  keyId: idDeMensagem,
  status: z.enum(STATUS_DO_PROVEDOR),
  fromMe: z.boolean().optional(),
});

const conteudo = z
  .object({
    conversation: z.string().optional(),
    extendedTextMessage: z.object({ text: z.string().optional() }).optional(),
  })
  .optional();

const dadosDeEnvio = z.object({
  key: z.object({ id: idDeMensagem, fromMe: z.boolean().optional() }),
  message: conteudo,
  messageTimestamp: z.unknown().optional(),
});

const dadosDeEntrada = z.object({
  key: z.object({
    id: idDeMensagem,
    remoteJid: z.string().max(200),
    fromMe: z.boolean(),
  }),
});

function sha256(texto: string): string {
  return createHash("sha256").update(texto).digest("hex");
}

/** Baileys entrega o carimbo em segundos, às vezes como `Long` do protobuf. */
function paraData(carimbo: unknown): Date | null {
  let valor: number | null = null;
  if (typeof carimbo === "number") valor = carimbo;
  else if (typeof carimbo === "string" && /^\d+$/.test(carimbo))
    valor = Number(carimbo);
  else if (
    carimbo &&
    typeof carimbo === "object" &&
    typeof (carimbo as { low?: unknown }).low === "number"
  ) {
    valor = (carimbo as { low: number }).low;
  }
  if (valor === null || !Number.isFinite(valor) || valor <= 0) return null;
  return new Date(valor < 1e12 ? valor * 1000 : valor);
}

function recusa(status: 400 | 422, motivo: string): Interpretacao {
  return { ok: false, status, motivo };
}

export function interpretarWebhook(texto: string): Interpretacao {
  let bruto: unknown;
  try {
    bruto = JSON.parse(texto);
  } catch {
    return recusa(400, "o corpo não é JSON");
  }
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) {
    return recusa(400, "o corpo não é um objeto");
  }

  const tipo = (bruto as { event?: unknown }).event;
  if (typeof tipo !== "string") return recusa(400, "evento sem tipo");
  if (!(TIPOS_ACEITOS as readonly string[]).includes(tipo)) {
    return recusa(422, "tipo de evento não assinado pelo Tetteo");
  }

  const lido = envelope.safeParse(bruto);
  if (!lido.success) return recusa(400, "envelope fora do formato da 2.3.7");
  const { instance: instancia, data } = lido.data;

  switch (tipo as TipoAceito) {
    case "connection.update": {
      const d = dadosDeConexao.safeParse(data);
      if (!d.success) return recusa(400, "connection.update fora do formato");
      return {
        ok: true,
        evento: {
          tipo: "connection.update",
          instancia,
          // Sem id próprio: a Evolution reenvia o corpo IDÊNTICO quando não
          // tem certeza de que chegou, e o `date_time` muda de um evento de
          // verdade para o outro. O hash do corpo separa os dois casos.
          idExterno: `conexao:${sha256(texto)}`,
          estado: d.data.state,
          codigo: d.data.statusReason ?? null,
          numero: d.data.wuid
            ? normalizarTelefone(d.data.wuid.split("@")[0])
            : null,
        },
      };
    }

    case "messages.update": {
      const d = dadosDeStatus.safeParse(data);
      if (!d.success) return recusa(400, "messages.update fora do formato");
      return {
        ok: true,
        evento: {
          tipo: "messages.update",
          instancia,
          // A mesma mensagem tem "entregue" E "lida": o status entra na chave.
          idExterno: `status:${d.data.keyId}:${d.data.status}`,
          idMensagem: d.data.keyId,
          status: d.data.status,
          deMim: d.data.fromMe ?? false,
        },
      };
    }

    case "send.message": {
      const d = dadosDeEnvio.safeParse(data);
      if (!d.success) return recusa(400, "send.message fora do formato");
      const enviado =
        d.data.message?.conversation ??
        d.data.message?.extendedTextMessage?.text;
      return {
        ok: true,
        evento: {
          tipo: "send.message",
          instancia,
          idExterno: `envio:${d.data.key.id}`,
          idMensagem: d.data.key.id,
          hashTexto: enviado ? sha256(enviado) : null,
          enviadaEm: paraData(d.data.messageTimestamp),
        },
      };
    }

    case "messages.upsert": {
      const d = dadosDeEntrada.safeParse(data);
      if (!d.success) return recusa(400, "messages.upsert fora do formato");
      return {
        ok: true,
        evento: {
          tipo: "messages.upsert",
          instancia,
          idExterno: `entrada:${d.data.key.id}`,
          idMensagem: d.data.key.id,
          deMim: d.data.key.fromMe,
          grupo: ehGrupo(d.data.key.remoteJid),
          remetente: d.data.key.remoteJid,
        },
      };
    }
  }
}

/** O mesmo hash que `send.message` usa — para casar com o texto de um aviso. */
export function hashDoTexto(texto: string): string {
  return sha256(texto);
}
