import { z } from "zod";

import { tipoPelaAssinatura } from "@/server/tipo-de-arquivo";

export const LIMITE_FOTO_CHECKLIST = 5 * 1024 * 1024;
export const LIMITE_VIDEO_CHECKLIST = 20 * 1024 * 1024;
export const LIMITE_ENVIO_CHECKLIST = LIMITE_VIDEO_CHECKLIST + 64 * 1024;
export const MAX_EVIDENCIAS_POR_ITEM = 5;

export type TipoEvidencia =
  "image/jpeg" | "image/png" | "image/webp" | "video/mp4" | "video/webm";

/** Uma faixa de leitura do vídeo; múltiplas faixas são recusadas. */
export function faixaDaEvidencia(faixa: string, tamanho: number) {
  const partes = /^bytes=(\d*)-(\d*)$/.exec(faixa);
  const inicio = partes?.[1]
    ? Number(partes[1])
    : partes?.[2]
      ? Math.max(0, tamanho - Number(partes[2]))
      : NaN;
  const fim =
    partes?.[1] && partes[2]
      ? Math.min(Number(partes[2]), tamanho - 1)
      : tamanho - 1;
  if (
    !Number.isSafeInteger(inicio) ||
    !Number.isSafeInteger(fim) ||
    inicio < 0 ||
    inicio > fim ||
    inicio >= tamanho
  )
    return null;
  return { inicio, fim };
}

export class ErroEvidencia extends Error {
  constructor(
    mensagem: string,
    readonly status = 400,
  ) {
    super(mensagem);
    this.name = "ErroEvidencia";
  }
}

/** A extensão e o MIME do navegador não decidem o formato aceito. */
export function tipoDaEvidencia(bytes: Uint8Array): TipoEvidencia | null {
  const foto = tipoPelaAssinatura(bytes);
  if (foto) return foto;
  const ascii = (inicio: number, fim: number) =>
    String.fromCharCode(...bytes.subarray(inicio, fim));
  if (bytes.length >= 16 && ascii(4, 8) === "ftyp") {
    const tamanho = new DataView(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength,
    ).getUint32(0);
    const marcas = new Set([
      "isom",
      "iso2",
      "iso3",
      "iso4",
      "iso5",
      "iso6",
      "mp41",
      "mp42",
      "avc1",
      "dash",
      "M4V ",
      "MSNV",
    ]);
    if (tamanho >= 16 && tamanho <= bytes.length) {
      for (let i = 8; i + 4 <= Math.min(tamanho, 128); i += 4) {
        // Bytes 12–15 são a versão, não uma marca compatível.
        if (i !== 12 && marcas.has(ascii(i, i + 4))) return "video/mp4";
      }
    }
  }
  const ebml = [0x1a, 0x45, 0xdf, 0xa3];
  if (
    bytes.length >= 16 &&
    ebml.every((b, i) => bytes[i] === b) &&
    ascii(0, Math.min(bytes.length, 4096)).includes("webm")
  )
    return "video/webm";
  return null;
}

export function validarEvidencia(bytes: Uint8Array): TipoEvidencia {
  if (bytes.length === 0) throw new ErroEvidencia("O arquivo está vazio.");
  if (bytes.length > LIMITE_VIDEO_CHECKLIST) {
    throw new ErroEvidencia("O vídeo passa de 20 MB.", 413);
  }
  const tipo = tipoDaEvidencia(bytes);
  if (!tipo) {
    throw new ErroEvidencia(
      "Envie foto JPG, PNG ou WebP, ou vídeo MP4 ou WebM.",
    );
  }
  if (tipo.startsWith("image/") && bytes.length > LIMITE_FOTO_CHECKLIST) {
    throw new ErroEvidencia("A foto passa de 5 MB.", 413);
  }
  return tipo;
}

/** Limita o fluxo ANTES do parser multipart, inclusive sem Content-Length. */
export async function lerCorpoLimitado(
  request: Request,
  limite: number,
): Promise<Uint8Array> {
  const declarado = request.headers.get("content-length");
  if (
    declarado !== null &&
    (!/^\d+$/.test(declarado) || Number(declarado) > limite)
  ) {
    throw new ErroEvidencia("O envio ultrapassa o tamanho permitido.", 413);
  }
  if (!request.body) throw new ErroEvidencia("O envio está vazio.");
  const leitor = request.body.getReader();
  const partes: Uint8Array[] = [];
  let tamanho = 0;
  try {
    while (true) {
      const parte = await leitor.read();
      if (parte.done) break;
      tamanho += parte.value.length;
      if (tamanho > limite) {
        await leitor.cancel();
        throw new ErroEvidencia("O envio ultrapassa o tamanho permitido.", 413);
      }
      partes.push(parte.value);
    }
  } finally {
    leitor.releaseLock();
  }
  const bytes = new Uint8Array(tamanho);
  let posicao = 0;
  for (const parte of partes) {
    bytes.set(parte, posicao);
    posicao += parte.length;
  }
  return bytes;
}

export async function lerFormularioEvidencia(request: Request) {
  const tipo = request.headers.get("content-type") ?? "";
  if (!tipo.startsWith("multipart/form-data;")) {
    throw new ErroEvidencia("Envie o arquivo pelo formulário.");
  }
  const bytes = await lerCorpoLimitado(request, LIMITE_ENVIO_CHECKLIST);
  try {
    return await new Response(new Uint8Array(bytes), {
      headers: { "content-type": tipo },
    }).formData();
  } catch {
    throw new ErroEvidencia("Não foi possível ler o arquivo enviado.");
  }
}

export const esquemaEnvioEvidencia = z.object({
  itemId: z.string().trim().min(1).max(100),
  versaoEsperada: z
    .union([
      z.number(),
      z
        .string()
        .trim()
        .regex(/^\d+$/, "Informe a versão atual do item.")
        .transform(Number),
    ])
    .pipe(z.number().int().min(0).max(2_147_483_646)),
});

export const esquemaRevisaoChecklist = esquemaEnvioEvidencia.extend({
  resultado: z.enum(["APROVADO", "REPROVADO", "INCONCLUSIVO"]),
  motivo: z
    .string()
    .trim()
    .min(8, "Explique a conferência com pelo menos 8 caracteres.")
    .max(1000),
});
