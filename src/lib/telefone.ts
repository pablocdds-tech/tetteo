/**
 * TELEFONE — uma forma só para o mesmo número.
 *
 * O vínculo da Severina compara telefone com telefone. Se "84 98133-6549" e
 * "+5584981336549" virarem chaves diferentes, o mesmo colaborador tem dois
 * cadastros e a Severina responde a um só — sem erro em lugar nenhum, o que é
 * a pior forma de quebrar.
 *
 * Mora em `lib/` porque não é vocabulário de negócio: Pessoas e CRM vão
 * precisar da mesma normalização, e duas cópias da regra é uma cópia
 * esperando para divergir.
 */

/** DDD brasileiro nunca tem zero. */
const DDD_VALIDO = /^[1-9][1-9]$/;

/**
 * Devolve o número em E.164 sem o "+", ou `null` quando não dá para
 * normalizar com segurança.
 *
 * Recusar é melhor do que adivinhar: um telefone inventado vira mensagem para
 * um estranho.
 */
export function normalizarTelefone(bruto: string): string | null {
  const digitos = (bruto ?? "").replace(/\D/g, "");
  if (digitos.length < 8) return null;

  // Sem código de país e com cara de número brasileiro: assume 55. É o caso
  // de quem digita "84 98133-6549" no cadastro, que é todo mundo.
  let numero = digitos;
  if (
    !numero.startsWith("55") &&
    (numero.length === 10 || numero.length === 11)
  ) {
    numero = `55${numero}`;
  }

  if (numero.startsWith("55")) {
    const ddd = numero.slice(2, 4);
    const resto = numero.slice(4);
    if (!DDD_VALIDO.test(ddd)) return null;

    // O NONO DÍGITO. Celular antigo chega com 8 dígitos começando em 6..9.
    // Fixo também tem 8, mas começa em 2..5 — e fixo não leva o 9.
    if (resto.length === 8 && /^[6-9]/.test(resto)) {
      return `55${ddd}9${resto}`;
    }
    if (resto.length === 8 || resto.length === 9) return `55${ddd}${resto}`;
    return null;
  }

  // Estrangeiro: devolve como veio, só sem símbolo. Não temos regra de nono
  // dígito para inventar, e inventar aqui seria pior do que não normalizar.
  return numero.length >= 10 ? numero : null;
}

/**
 * O número para mostrar em tela: DDD e os quatro últimos.
 *
 * "5511900000012" → "(11) •••••-0012". Basta para reconhecer "é o número da
 * loja"; não basta para ninguém ligar para ele. A tela do WhatsApp aparece em
 * print de grupo e em demonstração — o número inteiro não precisa estar lá.
 */
export function mascararTelefone(e164: string | null | undefined): string {
  const digitos = (e164 ?? "").replace(/\D/g, "");
  if (digitos.length < 8) return "—";

  const ultimos = digitos.slice(-4);
  const brasileiro = /^55(\d{2})(\d{8,9})$/.exec(digitos);
  if (brasileiro) {
    const escondidos = "•".repeat(brasileiro[2].length - 4);
    return `(${brasileiro[1]}) ${escondidos}-${ultimos}`;
  }

  // Estrangeiro: sem regra de DDD para inventar.
  return `•••• ${ultimos}`;
}

/** Conversa de grupo. A Severina nunca age numa. */
export function ehGrupo(remoteJid: string): boolean {
  return (remoteJid ?? "").endsWith("@g.us");
}

/**
 * Extrai o telefone de um identificador da Evolution.
 *
 * Devolve `null` para "@lid" — e não é falha: o LID é o endereçamento novo do
 * WhatsApp, feito justamente para ESCONDER o telefone de quem escreve. Não há
 * o que extrair. Quem chega por LID só é reconhecido pela tabela de vínculo.
 */
export function telefoneDoJid(remoteJid: string): string | null {
  if (!(remoteJid ?? "").endsWith("@s.whatsapp.net")) return null;
  return normalizarTelefone(remoteJid.split("@")[0]);
}
