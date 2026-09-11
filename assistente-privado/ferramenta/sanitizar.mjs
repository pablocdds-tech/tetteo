/**
 * CONTEÚDO É DADO, NUNCA ORDEM.
 *
 * Texto livre que veio de arquivo (a observação do CSV) nunca volta ao modelo
 * como veio. Se tem forma de instrução — ignorar regra, revelar senha,
 * instalar, transferir, link — vira um marcador. O conteúdo não é repetido em
 * lugar nenhum: nem no resultado, nem no log, nem no relatório.
 *
 * A lista é conservadora de propósito: um falso positivo custa uma observação
 * omitida; um falso negativo pode ser uma ordem lida pelo modelo.
 */

export const MARCADOR =
  "[conteúdo omitido: parece instrução — tratado como dado]";

const LIMITE = 160;

const PADROES = [
  /\bignor(e|a|ar|em)\b/i,
  /\binstru[cç]/i,
  /\brevel(e|a|ar)\b/i,
  /\b(senha|password|token|segredo|secret|credencia)/i,
  /\bapi[_ -]?key\b/i,
  /\binstal(e|a|ar|l)\b/i,
  /\btransf(ira|ere|erir|erência|erencia)/i,
  /\bexecut(e|a|ar)\b/i,
  /\b(prompt|system prompt)\b/i,
  /https?:\/\/|www\./i,
  /\b(esque[cç]a|forget|desconsidere|disregard)\b/i,
  /<\/?[a-z][^>]*>/i,
];

export function limparTexto(texto) {
  const bruto = String(texto ?? "");
  if (PADROES.some((p) => p.test(bruto)))
    return { texto: MARCADOR, suspeito: true };
  const limpo = bruto
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return {
    texto: limpo.length > LIMITE ? `${limpo.slice(0, LIMITE)}…` : limpo,
    suspeito: false,
  };
}
