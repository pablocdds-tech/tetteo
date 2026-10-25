export function dataValida(valor: string) {
  const data = new Date(valor + "T12:00:00Z");
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(valor) &&
    Number.isFinite(data.getTime()) &&
    data.toISOString().slice(0, 10) === valor
  );
}
export function periodoVendas(de: string, ate: string) {
  if (
    !dataValida(de) ||
    !dataValida(ate) ||
    de > ate ||
    Date.parse(ate) - Date.parse(de) > 366 * 86400000
  )
    throw new Error("Informe datas válidas, em ordem, com até 366 dias.");
  return { de, ate };
}
export function escopoVendas(contexto: {
  organizacao: { id: string };
  unidadeAtiva: { id: string } | null;
  unidadesVisiveis: { id: string }[];
  podeVerRedeInteira: boolean;
}) {
  const ids = contexto.unidadeAtiva
    ? contexto.unidadesVisiveis.some((u) => u.id === contexto.unidadeAtiva!.id)
      ? [contexto.unidadeAtiva.id]
      : []
    : contexto.podeVerRedeInteira
      ? contexto.unidadesVisiveis.map((u) => u.id)
      : [];
  return { organizacaoId: contexto.organizacao.id, unidadeId: { in: ids } };
}
export function resumirDias(
  linhas: {
    dataTurno: string;
    cancelada: boolean;
    _count: { _all: number };
    _sum: { totalCentavos: number | null };
  }[],
) {
  const dias = new Map<
    string,
    { data: string; quantidade: number; canceladas: number; centavos: number }
  >();
  for (const linha of linhas) {
    const dia = dias.get(linha.dataTurno) ?? {
      data: linha.dataTurno,
      quantidade: 0,
      canceladas: 0,
      centavos: 0,
    };
    if (linha.cancelada) dia.canceladas += linha._count._all;
    else {
      dia.quantidade += linha._count._all;
      dia.centavos += linha._sum.totalCentavos ?? 0;
    }
    dias.set(linha.dataTurno, dia);
  }
  const lista = [...dias.values()].sort((a, b) => a.data.localeCompare(b.data));
  return {
    dias: lista,
    quantidade: lista.reduce((s, d) => s + d.quantidade, 0),
    canceladas: lista.reduce((s, d) => s + d.canceladas, 0),
    centavos: lista.reduce((s, d) => s + d.centavos, 0),
  };
}
