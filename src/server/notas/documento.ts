import { tipoPelaAssinatura } from "@/server/tipo-de-arquivo";
export const LIMITE_DOCUMENTO_NOTA = 20 * 1024 * 1024;
export type TipoDocumentoNota =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "application/pdf"
  | "application/xml";
export class LeituraNotaRecusada extends Error {
  constructor(
    public readonly codigo: string,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "LeituraNotaRecusada";
  }
}
export function textoXml(bytes: Uint8Array): string {
  const inicio = Buffer.from(bytes.subarray(0, 160)).toString("ascii");
  return new TextDecoder(
    /encoding\s*=\s*["'](?:ISO-8859-1|windows-1252)["']/i.test(inicio)
      ? "windows-1252"
      : "utf-8",
    { fatal: true },
  )
    .decode(bytes)
    .replace(/^\uFEFF/, "");
}
export function tipoDocumentoNota(bytes: Uint8Array): TipoDocumentoNota | null {
  if (!bytes.length || bytes.length > LIMITE_DOCUMENTO_NOTA) return null;
  const imagem = tipoPelaAssinatura(bytes);
  if (imagem) return imagem;
  if (Buffer.from(bytes.subarray(0, 5)).toString("ascii") === "%PDF-")
    return "application/pdf";
  try {
    const t = textoXml(bytes).trimStart();
    if (
      /^<\?xml\b|^<(?:[\w-]+:)?(?:nfeProc|NFe)\b/.test(t) &&
      !/<\?xml-stylesheet|<!DOCTYPE|<!ENTITY/i.test(t)
    )
      return "application/xml";
  } catch {}
  return null;
}
