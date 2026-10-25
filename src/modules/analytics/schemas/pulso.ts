const formatarHora = new Intl.DateTimeFormat("en-GB", {
  timeZone: "America/Sao_Paulo",
  hour: "2-digit",
  hourCycle: "h23",
});
export function deslocarDia(data: string, dias: number) {
  return new Date(Date.parse(data + "T12:00:00Z") + dias * 86400000)
    .toISOString()
    .slice(0, 10);
}
export function resumirHoras(
  linhas: {
    criadaNoSaiposEm: Date;
    totalCentavos: number;
    cancelada: boolean;
  }[],
) {
  const horas = Array.from({ length: 24 }, (_, hora) => ({
    hora,
    centavos: 0,
    quantidade: 0,
  }));
  for (const linha of linhas) {
    if (linha.cancelada) continue;
    const hora = Number(formatarHora.format(linha.criadaNoSaiposEm));
    horas[hora].centavos += linha.totalCentavos;
    horas[hora].quantidade++;
  }
  return horas;
}
export function variacao(atual: number, anterior: number): number | null {
  return anterior > 0 ? ((atual - anterior) / anterior) * 100 : null;
}
