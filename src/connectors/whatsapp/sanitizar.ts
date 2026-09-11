/**
 * O ERRO LIMPO.
 *
 * Toda mensagem de erro que sai deste conector passa por aqui antes de ir
 * para o banco, para a tela ou para o log. O motivo é concreto: a Evolution
 * devolve o pedido inteiro dentro do erro — cabeçalho com a chave, número de
 * telefone, às vezes a imagem do QR Code em base64. Gravado cru, o segredo vai
 * parar numa coluna que o gerente vê e num print que vai para o grupo.
 *
 * A regra é tirar demais em vez de tirar de menos. Um carimbo de horário
 * confundido com telefone vira "[telefone oculto]" — e isso não custa nada.
 */

const LIMITE = 300;

/** `apikey: x`, `"token":"x"`, `Authorization: Bearer x`, `senha=x`… */
const CHAVE_E_VALOR =
  /((?:api[_-]?key|token|jwt_key|authorization|password|senha|secret)["']?\s*[:=]\s*["']?)(?:bearer\s+)?[^\s"',;}]+/gi;
const BEARER = /\bbearer\s+[^\s"',;}]+/gi;
const JWT = /eyJ[\w-]+\.[\w-]+\.[\w-]*/g;
const IMAGEM_BASE64 = /data:[\w/+.-]+;base64,[A-Za-z0-9+/=]+/g;
const BASE64_LONGO = /[A-Za-z0-9+/]{120,}={0,2}/g;
const IDENTIFICADOR_WHATSAPP =
  /\b\d{6,20}@(?:s\.whatsapp\.net|lid|g\.us|c\.us)\b/g;
const TELEFONE = /\b\d{10,15}\b/g;

export function limparTexto(texto: string, segredos: string[] = []): string {
  let limpo = String(texto ?? "");

  // Primeiro os valores exatos: pegam o segredo mesmo onde nenhum padrão
  // abaixo reconheceria. Valor curto demais é ignorado — trocar "a" por
  // "[oculto]" destruiria o texto sem proteger nada.
  for (const segredo of segredos) {
    const valor = (segredo ?? "").trim();
    if (valor.length < 6) continue;
    limpo = limpo.split(valor).join("[oculto]");
  }

  limpo = limpo
    .replace(IMAGEM_BASE64, "[imagem oculta]")
    .replace(CHAVE_E_VALOR, "$1[oculto]")
    .replace(BEARER, "Bearer [oculto]")
    .replace(JWT, "[passe oculto]")
    .replace(BASE64_LONGO, "[base64 oculto]")
    .replace(IDENTIFICADOR_WHATSAPP, "[contato oculto]")
    .replace(TELEFONE, "[telefone oculto]");

  return limpo.length > LIMITE ? `${limpo.slice(0, LIMITE)}…` : limpo;
}
