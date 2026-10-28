import type { FormaCaixa, TotaisCaixa } from "../caixa-types";
import type { PagamentoPdv } from "../types";

export function totaisVazios(): TotaisCaixa {
  return {
    pagamentos: { DINHEIRO: 0, PIX: 0, CREDITO: 0, DEBITO: 0 },
    subtotalCentavos: 0,
    descontoCentavos: 0,
    taxaCentavos: 0,
    freteCentavos: 0,
    totalCentavos: 0,
  };
}

/** Agrupa pagamentos divididos e desconta o troco uma única vez do dinheiro. */
export function pagamentosLiquidos(
  pagamentos: PagamentoPdv[],
  trocoCentavos: number,
): Record<FormaCaixa, number> {
  const resultado = totaisVazios().pagamentos;
  for (const p of pagamentos) resultado[p.forma] += p.valorCentavos;
  resultado.DINHEIRO -= trocoCentavos;
  return resultado;
}

export function acumularVenda(
  totais: TotaisCaixa,
  venda: Omit<TotaisCaixa, "pagamentos">,
  pagamentos: Record<FormaCaixa, number>,
) {
  for (const forma of Object.keys(pagamentos) as FormaCaixa[])
    totais.pagamentos[forma] += pagamentos[forma];
  totais.subtotalCentavos += venda.subtotalCentavos;
  totais.descontoCentavos += venda.descontoCentavos;
  totais.taxaCentavos += venda.taxaCentavos;
  totais.freteCentavos += venda.freteCentavos;
  totais.totalCentavos += venda.totalCentavos;
}
