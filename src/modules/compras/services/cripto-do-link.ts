import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
} from "node:crypto";

/**
 * O CÓDIGO DO LINK DO FORNECEDOR.
 *
 * 32 bytes aleatórios — 256 bits: adivinhar um código válido não é uma
 * questão de tentar muito, é impossível. O código em texto puro NUNCA é
 * gravado:
 *
 *   hash (SHA-256)          para ACHAR a solicitação quando o link é aberto
 *   cifrado (AES-256-GCM)   para quem tem permissão COPIAR o link de novo
 *
 * A chave da cifra sai do `AUTH_SECRET` por HKDF, com um rótulo só deste uso —
 * o mesmo segredo que já protege a sessão, sem configuração nova, e sem que
 * uma chave sirva para as duas coisas.
 */

function chave(): Buffer {
  const segredo = process.env.AUTH_SECRET;
  if (!segredo) {
    throw new Error(
      "AUTH_SECRET não está configurado: sem ele não há como proteger os links de cotação.",
    );
  }
  return Buffer.from(hkdfSync("sha256", segredo, "tetteo", "compras-link", 32));
}

export function hashDoCodigo(codigo: string): string {
  return createHash("sha256").update(codigo, "utf8").digest("hex");
}

function cifrar(texto: string): string {
  const iv = randomBytes(12);
  const cifra = createCipheriv("aes-256-gcm", chave(), iv);
  const conteudo = Buffer.concat([cifra.update(texto, "utf8"), cifra.final()]);
  const etiqueta = cifra.getAuthTag();
  return [
    "v1",
    iv.toString("base64url"),
    etiqueta.toString("base64url"),
    conteudo.toString("base64url"),
  ].join(".");
}

export function decifrar(cifrado: string): string {
  const [versao, iv, etiqueta, conteudo] = cifrado.split(".");
  if (versao !== "v1" || !iv || !etiqueta || !conteudo) {
    throw new Error("Código do link em formato desconhecido.");
  }
  const decifra = createDecipheriv(
    "aes-256-gcm",
    chave(),
    Buffer.from(iv, "base64url"),
  );
  decifra.setAuthTag(Buffer.from(etiqueta, "base64url"));
  return Buffer.concat([
    decifra.update(Buffer.from(conteudo, "base64url")),
    decifra.final(),
  ]).toString("utf8");
}

export function novoCodigo(): {
  codigo: string;
  hash: string;
  cifrado: string;
} {
  const codigo = randomBytes(32).toString("base64url");
  return { codigo, hash: hashDoCodigo(codigo), cifrado: cifrar(codigo) };
}

/** Só o formato: base64url de 32 bytes. Filtra lixo antes de ir ao banco. */
export function pareceCodigo(texto: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(texto);
}
