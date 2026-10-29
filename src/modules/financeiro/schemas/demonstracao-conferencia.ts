import {
  conciliar,
  type Cobertura,
  type Contrato,
  type LinhaMotor,
} from "./conferencia";

// Dados exclusivamente fictícios. O exemplo usa o mesmo motor da conferência real.
export const cenariosConferencia = {
  taxa: "Conferir a taxa",
  parcial: "Fonte parcial",
  semBanco: "Sem crédito no banco",
  duplicado: "NSU repetido",
  lote: "Crédito agregado",
} as const;
export type CenarioConferencia = keyof typeof cenariosConferencia;

export function demonstrarConferencia(cenario: CenarioConferencia) {
  const escopo = { organizacaoId: "demo", unidadeId: "demo-centro" };
  const comum = {
    ...escopo,
    provider: "DEMO",
    merchantRef: "merchant-demo",
    accountRef: "account-demo",
    businessDay: "2026-10-19",
    nsu: "DEMO-1001",
    method: "CREDIT",
    brand: "VISA",
    installments: 1,
    adjustmentCents: 0,
  };
  const linhas: LinhaMotor[] = [
    {
      ...comum,
      id: "sale-1",
      fonte: "VENDA",
      grossCents: 125000,
      status: "COMPLETED",
    },
    {
      ...comum,
      id: "acq-1",
      fonte: "ADQUIRENTE",
      grossCents: 125000,
      feeCents: 4375,
      netCents: 120625,
      status: "SETTLED",
      payoutRef: "payout-1",
      expectedSettlementDay: "2026-10-20",
    },
    {
      ...comum,
      id: "bank-1",
      fonte: "BANCO",
      businessDay: "2026-10-20",
      amountCents: 120625,
      direction: "CREDIT",
      status: "SETTLED",
      payoutRef: "payout-1",
    },
  ];
  const contratos: Contrato[] = [
    {
      id: "contrato-demo",
      versao: 1,
      provedor: "DEMO",
      estabelecimento: "merchant-demo",
      bandeira: "VISA",
      metodo: "CREDIT",
      parcelasDe: 1,
      parcelasAte: 1,
      de: "2026-01-01",
      ate: null,
      taxaBps: 300,
      fixaCentavos: 0,
      toleranciaCentavos: 0,
    },
  ];
  const cobertura: Cobertura = {
    VENDA: {
      completa: true,
      de: "2026-10-19",
      ate: "2026-10-20",
      importacoes: ["venda-demo"],
    },
    ADQUIRENTE: {
      completa: true,
      de: "2026-10-19",
      ate: "2026-10-20",
      importacoes: ["adquirente-demo"],
    },
    BANCO: {
      completa: true,
      de: "2026-10-19",
      ate: "2026-10-20",
      importacoes: ["banco-demo"],
    },
  };
  if (cenario === "parcial") cobertura.BANCO.completa = false;
  if (cenario === "semBanco") linhas.splice(2, 1);
  if (cenario === "duplicado")
    linhas.push({ ...linhas[1], id: "acq-duplicada" });
  if (cenario === "lote") {
    linhas.push({
      ...linhas[0],
      id: "sale-2",
      nsu: "DEMO-1002",
      grossCents: 50000,
    });
    linhas.push({
      ...linhas[1],
      id: "acq-2",
      nsu: "DEMO-1002",
      grossCents: 50000,
      feeCents: 1500,
      netCents: 48500,
    });
    linhas[2].amountCents = 169125;
  }
  return {
    ...conciliar({ ...escopo, linhas, contratos, cobertura }),
    cobertura,
    linhas,
  };
}
