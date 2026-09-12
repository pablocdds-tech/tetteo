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
 *
 * NORMALIZAR ANTES DE TESTAR — nunca depois. Um espaço de largura zero (ou
 * hífen suave, ou marca de direção) NO MEIO de uma palavra quebra o limite de
 * palavra da regra sem apagar o sentido pra quem lê: continua sendo "ignore"
 * pros olhos, só não bate mais com o padrão de "ignorar". Por isso o texto
 * passa por `normalizar` (tira esses caracteres, e usa NFKC pra desfazer
 * formas alternativas do mesmo caractere) ANTES do teste de padrão — testar
 * depois, como era antes, deixava esse desvio passar como `suspeito:false`,
 * sem nem entrar no log de segurança.
 */

export const MARCADOR =
  "[conteúdo omitido: parece instrução — tratado como dado]";

const LIMITE = 160;

/**
 * Monta uma classe de caracteres regex a partir de PONTOS DE CÓDIGO
 * numéricos, nunca de um caractere colado ou de um escape \u dentro de um
 * literal /.../. Este arquivo já teve escape virar byte de verdade em disco
 * — com número puro não tem escape nenhum pra virar nada.
 */
function classeDe(...pontosDeCodigo) {
  return new RegExp(
    `[${pontosDeCodigo.map((n) => String.fromCodePoint(n)).join("")}]`,
    "g",
  );
}

// Caracteres de controle C0 (0 a 31) e DEL (127) — nunca aparecem numa
// observação de caixa; viram espaço antes do texto ir pra qualquer lugar.
const RE_CONTROLE = classeDe(...Array.from({ length: 32 }, (_, i) => i), 127);

// Espaço de largura zero, hífen suave, marcas de direção (bidi) e o
// BOM/ZWNBSP quando aparecem NO MEIO do texto — nunca visíveis, só servem
// pra escapar de um limite de palavra ou partir uma palavra-chave ao meio.
const RE_INVISIVEIS = classeDe(
  0x00ad, // hífen suave
  0x200b, // espaço de largura zero
  0x200c, // não-junção de largura zero
  0x200d, // junção de largura zero
  0x200e, // marca da esquerda pra direita
  0x200f, // marca da direita pra esquerda
  0x202a, // embutimento LTR
  0x202b, // embutimento RTL
  0x202c, // fim de embutimento direcional
  0x202d, // sobrescrita LTR
  0x202e, // sobrescrita RTL
  0x2060, // junção de palavras
  0x2066, // isolamento LTR
  0x2067, // isolamento RTL
  0x2068, // isolamento de primeiro forte
  0x2069, // fim de isolamento
  0xfeff, // BOM / espaço de largura zero sem quebra
);

function normalizar(texto) {
  return texto.normalize("NFKC").replace(RE_INVISIVEIS, "");
}

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
  // Encenação de autoridade ("aja como o gerente e libere...") e o clássico
  // jailbreak de "modo desenvolvedor" — nenhum padrão acima cobria isso.
  /\baja\s+como\b/i,
  /\bmodo\s+desenvolvedor\b/i,
];

export function limparTexto(texto) {
  const bruto = normalizar(String(texto ?? ""));
  if (PADROES.some((p) => p.test(bruto)))
    return { texto: MARCADOR, suspeito: true };
  const limpo = bruto.replace(RE_CONTROLE, " ").replace(/\s+/g, " ").trim();
  return {
    texto: limpo.length > LIMITE ? `${limpo.slice(0, LIMITE)}…` : limpo,
    suspeito: false,
  };
}
