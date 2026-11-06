import {
  LIMITE_DOCUMENTO_NOTA as LIMITE_BYTES,
  tipoDocumentoNota as tipoPelaAssinatura,
  type TipoDocumentoNota,
} from "@/server/notas/documento";

import { configuracaoEvolution } from "./configuracao";

const LIMITE_JSON = Math.ceil(LIMITE_BYTES / 3) * 4 + 64 * 1024;

/**
 * Evolution 2.3.7, whatsapp.baileys.service.ts, getBase64FromMediaMessage:
 * `message.key.id` consulta a mensagem guardada pela própria instância.
 * Nunca aceitamos uma URL, directPath ou chave de mídia do remetente.
 * https://github.com/EvolutionAPI/evolution-api/blob/2.3.7/src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts
 */
export async function baixarFotoNota(
  idMensagem: string,
  env: Record<string, string | undefined> = process.env,
): Promise<{ bytes: Uint8Array; tipo: TipoDocumentoNota }> {
  if (!/^[\w-]{1,200}$/.test(idMensagem))
    throw new Error("Identificador da foto inválido.");
  const config = configuracaoEvolution(env);
  if (config.tipo !== "ok")
    throw new Error("A conexão do WhatsApp precisa ser configurada.");
  let url: URL;
  try {
    url = new URL(config.url);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error();
  } catch {
    throw new Error("O endereço do WhatsApp precisa ser configurado.");
  }
  const falha = () =>
    new Error(
      "Não consegui baixar o arquivo. Envie XML, PDF, JPG, PNG ou WebP de até 20 MB. Para fotos, prefira enviar como documento, sem compressão.",
    );
  try {
    const resposta = await fetch(
      `${config.url}/chat/getBase64FromMediaMessage/${encodeURIComponent(config.instancia)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: config.chave },
        body: JSON.stringify({
          message: { key: { id: idMensagem } },
          convertToMp4: false,
        }),
        signal: AbortSignal.timeout(15_000),
        redirect: "error",
      },
    );
    if (
      !resposta.ok ||
      !resposta.body ||
      Number(resposta.headers.get("content-length")) > LIMITE_JSON
    )
      throw falha();
    const leitor = resposta.body.getReader();
    const partes: Uint8Array[] = [];
    let tamanho = 0;
    for (;;) {
      const { value, done } = await leitor.read();
      if (done) break;
      tamanho += value.byteLength;
      if (tamanho > LIMITE_JSON) {
        await leitor.cancel();
        throw falha();
      }
      partes.push(value);
    }
    const bruto = JSON.parse(Buffer.concat(partes).toString("utf8")) as {
      base64?: unknown;
      mimetype?: unknown;
    };
    if (
      typeof bruto?.base64 !== "string" ||
      !bruto.base64 ||
      bruto.base64.length > Math.ceil(LIMITE_BYTES / 3) * 4 ||
      bruto.base64.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(bruto.base64)
    )
      throw falha();
    const bytes = Buffer.from(bruto.base64, "base64");
    const tipo = tipoPelaAssinatura(bytes);
    if (
      !tipo ||
      bytes.length === 0 ||
      bytes.length > LIMITE_BYTES ||
      bytes.toString("base64") !== bruto.base64 ||
      (bruto.mimetype !== undefined &&
        bruto.mimetype !== tipo &&
        bruto.mimetype !== "application/octet-stream" &&
        !(tipo === "application/xml" && bruto.mimetype === "text/xml"))
    )
      throw falha();
    return { bytes, tipo };
  } catch {
    // O provedor pode ecoar credenciais e URLs assinadas em qualquer erro.
    throw falha();
  }
}
