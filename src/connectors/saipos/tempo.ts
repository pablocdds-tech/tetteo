export const FUSO = "America/Sao_Paulo";
export function horarioBrasilia(agora = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: FUSO,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  })
    .format(agora)
    .replace(" ", "T");
}
export function diaDeslocado(data: string, dias: number) {
  return new Date(Date.parse(data + "T12:00:00Z") + dias * 86400000)
    .toISOString()
    .slice(0, 10);
}
/** Periodicidade de importação independente da atualização visual. */
export function deveAtualizarPainel(
  agora: Date,
  tentativa: Date | null,
  erro: string | null,
) {
  if (
    erro &&
    /Token inválido|sem permissão|Formato .*mudou|não é JSON|recusou os parâmetros|primeira carga não retornou/i.test(
      erro,
    )
  )
    return false;
  if (!tentativa) return true;
  return agora.getTime() - tentativa.getTime() >= (erro ? 30 : 15) * 60000;
}
