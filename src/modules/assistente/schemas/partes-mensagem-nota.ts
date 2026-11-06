export const LIMITE_MENSAGEM_NOTA = 3500;

/** Prefere quebras de linha e conserva todo o texto, inclusive em linhas extensas. */
export function dividirMensagemNota(texto: string): string[] {
  if (texto.length <= LIMITE_MENSAGEM_NOTA) return [texto];
  const limite = LIMITE_MENSAGEM_NOTA - 40; // Reserva para a numeração.
  const partes: string[] = [];
  let restante = texto;
  while (restante.length > limite) {
    let corte = restante.lastIndexOf("\n", limite);
    if (corte <= 0) corte = limite;
    else corte++; // Conserva a quebra na parte anterior.
    const codigo = restante.charCodeAt(corte - 1);
    if (codigo >= 0xd800 && codigo <= 0xdbff) corte--;
    partes.push(restante.slice(0, corte));
    restante = restante.slice(corte);
  }
  if (restante) partes.push(restante);
  return partes.map((p, n) => `*Parte ${n + 1}/${partes.length}*\n${p}`);
}

/** A última parte conserva a identidade histórica da resposta/resumo. */
export const idDaParte = (base: string, indice: number, total: number) =>
  indice === total - 1
    ? base
    : `${base}:parte:${String(indice + 1).padStart(4, "0")}`;
export const baseDaParte = (id: string) => id.replace(/:parte:\d{4}$/, "");
