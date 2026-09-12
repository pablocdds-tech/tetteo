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
 *
 * O MESMO VALE PRA MARCA COMBINANTE E HOMÓGLIFO. Um acento separado da letra
 * (forma NFD) ou uma letra cirílica/grega parecida com a latina também
 * driblam `\bignore\b` sem mudar o que os olhos leem. Por isso existe
 * `paraDeteccao`, uma SEGUNDA normalização — mais agressiva, só pro teste de
 * padrão, nunca aplicada ao texto que volta pro dono (que continua saindo de
 * `normalizar`, com os acentos de verdade). Nenhuma das duas é solução
 * geral: é uma corrida sem linha de chegada, coberta até onde os casos
 * encontrados chegaram — ver limite documentado em
 * docs/assistente-privado/versoes-e-fontes.md.
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

/**
 * Marca combinante (categoria Unicode "M") — o acento que, na forma
 * decomposta (NFD), vira um caractere separado grudado visualmente na letra
 * anterior em vez de fazer parte de um unico caractere acentuado. Exemplo:
 * a letra "g" seguida do acento agudo combinante aparece pros olhos como
 * "g com acento", mas pro regex sao dois caracteres — "g" e a marca — entao
 * "ignore" com esse acento colado no meio do "g" nao bate mais com
 * \bignore\b. Descontar essa marca (so na copia usada pra TESTAR, nunca na
 * que o dono ve) fecha esse desvio sem apagar acento nenhum do texto
 * visivel — essa etapa entra so em `paraDeteccao`, nunca em `normalizar`.
 *
 * `\p{M}` e sintaxe de propriedade Unicode do proprio regex (texto ASCII
 * puro no arquivo-fonte, sem `\u` escapando codigo nenhum e sem nenhum
 * caractere de marca colado aqui) — nao uma lista de pontos de codigo,
 * porque marca combinante e uma categoria inteira do Unicode, nao um
 * punhado de caracteres pra enumerar.
 */
const RE_MARCA_COMBINANTE = /\p{M}/gu;

/**
 * Homóglifos: letras cirílicas e gregas que os olhos leem como latinas mas
 * que, por baixo, são outro caractere — escapam de `\bignore\b` do mesmo
 * jeito que um caractere invisível escapava, só que sem nada invisível.
 * Tabela pequena e explícita de propósito (não é solução geral de
 * confundíveis Unicode — ver limite documentado em
 * docs/assistente-privado/versoes-e-fontes.md): cobre o cirílico
 * а е о р с х у і ѕ ј (minúsculo e maiúsculo) e o conjunto grego mais óbvio
 * — as maiúsculas que a maioria das fontes desenha idênticas à latina, mais
 * o ómicron e o alfa minúsculos, os dois mais usados em phishing.
 */
const HOMOGLIFOS_PARES = [
  [0x0430, 0x0061], // а -> a
  [0x0410, 0x0061], // А -> a
  [0x0435, 0x0065], // е -> e
  [0x0415, 0x0065], // Е -> e
  [0x043e, 0x006f], // о -> o
  [0x041e, 0x006f], // О -> o
  [0x0440, 0x0070], // р -> p
  [0x0420, 0x0070], // Р -> p
  [0x0441, 0x0063], // с -> c
  [0x0421, 0x0063], // С -> c
  [0x0445, 0x0078], // х -> x
  [0x0425, 0x0078], // Х -> x
  [0x0443, 0x0079], // у -> y
  [0x0423, 0x0079], // У -> y
  [0x0456, 0x0069], // і -> i
  [0x0406, 0x0069], // І -> i
  [0x0455, 0x0073], // ѕ -> s
  [0x0405, 0x0073], // Ѕ -> s
  [0x0458, 0x006a], // ј -> j
  [0x0408, 0x006a], // Ј -> j
  [0x0391, 0x0061], // Α -> a
  [0x0392, 0x0062], // Β -> b
  [0x0395, 0x0065], // Ε -> e
  [0x0396, 0x007a], // Ζ -> z
  [0x0397, 0x0068], // Η -> h
  [0x0399, 0x0069], // Ι -> i
  [0x039a, 0x006b], // Κ -> k
  [0x039c, 0x006d], // Μ -> m
  [0x039d, 0x006e], // Ν -> n
  [0x039f, 0x006f], // Ο -> o
  [0x03a1, 0x0070], // Ρ -> p
  [0x03a4, 0x0074], // Τ -> t
  [0x03a5, 0x0079], // Υ -> y
  [0x03a7, 0x0078], // Χ -> x
  [0x03bf, 0x006f], // ο -> o
  [0x03b1, 0x0061], // α -> a
];

const RE_HOMOGLIFOS = classeDe(...HOMOGLIFOS_PARES.map(([origem]) => origem));

const MAPA_HOMOGLIFOS = new Map(
  HOMOGLIFOS_PARES.map(([origem, destino]) => [
    String.fromCodePoint(origem),
    String.fromCodePoint(destino),
  ]),
);

function trocarHomoglifos(texto) {
  return texto.replace(RE_HOMOGLIFOS, (c) => MAPA_HOMOGLIFOS.get(c));
}

/**
 * Cópia usada só pra TESTAR contra os padrões — nunca é o texto que volta
 * pro dono. Decompõe (NFD), tira marca combinante, recompõe (NFC) e troca
 * homóglifo por latino, nessa ordem, antes de qualquer padrão rodar.
 */
function paraDeteccao(texto) {
  const semMarca = texto
    .normalize("NFD")
    .replace(RE_MARCA_COMBINANTE, "")
    .normalize("NFC");
  return trocarHomoglifos(semMarca);
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
  const testado = paraDeteccao(bruto);
  if (PADROES.some((p) => p.test(testado)))
    return { texto: MARCADOR, suspeito: true };
  const limpo = bruto.replace(RE_CONTROLE, " ").replace(/\s+/g, " ").trim();
  return {
    texto: limpo.length > LIMITE ? `${limpo.slice(0, LIMITE)}…` : limpo,
    suspeito: false,
  };
}
