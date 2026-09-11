/**
 * O último recorte (a parte depois do "?") de cada lista de Compras, guardado
 * na aba. O navegador pode recusar o armazenamento (aba anônima, bloqueio de
 * dados do site) — aí o voltar só não lembra o filtro; nada quebra.
 */

const chave = (caminho: string) => `compras:filtros:${caminho}`;

export function lerRecorte(caminho: string): string {
  try {
    return sessionStorage.getItem(chave(caminho)) ?? "";
  } catch {
    return "";
  }
}

export function guardarRecorte(caminho: string, recorte: string): void {
  try {
    if (recorte) sessionStorage.setItem(chave(caminho), recorte);
    else sessionStorage.removeItem(chave(caminho));
  } catch {
    // Sem armazenamento, sem memória do filtro. A lista funciona igual.
  }
}
