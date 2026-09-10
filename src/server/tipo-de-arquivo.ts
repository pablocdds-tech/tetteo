/**
 * O TIPO DE ARQUIVO, pela assinatura do conteúdo — regra pura, sem banco.
 *
 * A extensão diz o que o arquivo AFIRMA ser; os primeiros bytes dizem o que
 * ele É. Um ".jpg" que é um executável renomeado não passa por aqui.
 */

export const LIMITE_BYTES = 5 * 1024 * 1024;

export type TipoAceito = "image/jpeg" | "image/png" | "image/webp";

export const EXTENSAO: Record<TipoAceito, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function tipoPelaAssinatura(b: Uint8Array): TipoAceito | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return "image/jpeg";
  }
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length >= 8 && png.every((v, i) => b[i] === v)) return "image/png";
  const ascii = (de: number, ate: number) =>
    String.fromCharCode(...b.subarray(de, ate));
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") {
    return "image/webp";
  }
  return null;
}
