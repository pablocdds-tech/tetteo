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
export function deveRodar(
  agora: Date,
  tentativa: Date | null,
  primeiraCarga: boolean,
) {
  const local = horarioBrasilia(agora);
  if (
    tentativa &&
    horarioBrasilia(tentativa).slice(0, 10) >= local.slice(0, 10)
  )
    return false;
  return (primeiraCarga && !tentativa) || local.slice(11) >= "05:15:00";
}
