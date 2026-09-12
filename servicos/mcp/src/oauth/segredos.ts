import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * AS CHAVES QUE ESTE SERVIDOR ENTREGA.
 *
 * Aleatórias, 256 bits, com um prefixo que diz o que são: `tmcp_` acesso,
 * `tmcr_` renovação, `tmcc_` código de autorização, `tmcq_` pedido em
 * andamento. Se uma delas aparecer onde não devia, o prefixo diz de onde veio.
 *
 * No banco vai só a impressão digital (SHA-256). Quem ler a tabela não
 * consegue usar nenhuma chave. SHA-256 simples, sem sal nem bcrypt, é o certo
 * aqui: com 256 bits aleatórios não há dicionário a testar — sal só protege
 * segredo fraco, e estes não são.
 */

const PREFIXOS = {
  acesso: "tmcp_",
  renovacao: "tmcr_",
  codigo: "tmcc_",
  pedido: "tmcq_",
} as const;

export type TipoDeSegredo = keyof typeof PREFIXOS;

/** 32 bytes em base64url dão exatamente 43 caracteres. */
const TAMANHO = 43;

export function gerarSegredo(tipo: TipoDeSegredo): string {
  return PREFIXOS[tipo] + randomBytes(32).toString("base64url");
}

export function ehDoTipo(segredo: string, tipo: TipoDeSegredo): boolean {
  return (
    segredo.startsWith(PREFIXOS[tipo]) &&
    segredo.length === PREFIXOS[tipo].length + TAMANHO
  );
}

export function impressaoDigital(texto: string): string {
  return createHash("sha256").update(texto, "utf8").digest("hex");
}

// PKCE (RFC 7636), só o método S256. "plain" não protege nada.
const VERIFICADOR = /^[A-Za-z0-9\-._~]{43,128}$/;
const DESAFIO = /^[A-Za-z0-9_-]{43}$/;

export function desafioValido(desafio: string): boolean {
  return DESAFIO.test(desafio);
}

export function desafioDe(verificador: string): string {
  return createHash("sha256").update(verificador, "ascii").digest("base64url");
}

export function pkceConfere(verificador: string, desafio: string): boolean {
  if (!VERIFICADOR.test(verificador) || !DESAFIO.test(desafio)) return false;
  const calculado = Buffer.from(desafioDe(verificador));
  const esperado = Buffer.from(desafio);
  return (
    calculado.length === esperado.length && timingSafeEqual(calculado, esperado)
  );
}
