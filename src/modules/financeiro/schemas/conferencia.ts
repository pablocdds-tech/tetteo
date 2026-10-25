import { z } from "zod";

export const PARSER_VERSAO = "csv-json-1.0.0";
export const REGRAS_VERSAO = "conservadora-lotes-1.0.0";
export const LIMITE_ARQUIVO = 2 * 1024 * 1024;
export const LIMITE_LINHAS = 5000;
export const fontes = ["VENDA", "ADQUIRENTE", "BANCO"] as const;
export type Fonte = (typeof fontes)[number];
export const rotuloFonte: Record<Fonte, string> = {
  VENDA: "Vendas do PDV",
  ADQUIRENTE: "Adquirente",
  BANCO: "Extrato bancário",
};

export function diaValido(valor: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(valor) &&
    Number.isFinite(Date.parse(valor)) &&
    new Date(valor + "T12:00:00Z").toISOString().slice(0, 10) === valor
  );
}
export const diaSchema = z
  .string()
  .refine(diaValido, "Data inválida. Use AAAA-MM-DD.");
export const periodoSchema = z
  .object({ de: diaSchema, ate: diaSchema })
  .refine(
    (p) =>
      p.de <= p.ate && Date.parse(p.ate) - Date.parse(p.de) <= 366 * 86400000,
    "Escolha um período em ordem, de até 366 dias.",
  );
const texto = z.string().trim().min(1).max(120);
const centavos = z.number().int().min(0).max(2_000_000_000);
export const configuracaoSchema = z
  .object({
    fonte: z.enum(fontes),
    contaRef: texto,
    de: diaSchema,
    ate: diaSchema,
    separador: z.enum([";", ",", "\t"]).default(";"),
    moeda: z.literal("BRL").default("BRL"),
    formatoData: z.enum(["ISO", "BR"]).default("ISO"),
  })
  .strict()
  .refine(
    (p) =>
      p.de <= p.ate && Date.parse(p.ate) - Date.parse(p.de) <= 366 * 86400000,
    "Período inválido.",
  );
export type Configuracao = z.infer<typeof configuracaoSchema>;

// Formato canônico dos adapters locais. Campos monetários são sempre centavos.
export const linhaSchema = z
  .object({
    provider: texto,
    merchantRef: texto,
    accountRef: texto,
    externalId: texto.optional(),
    saleExternalId: texto.optional(),
    nsu: texto.optional(),
    terminalRef: texto.optional(),
    authorizationCode: texto.optional(),
    businessDay: diaSchema,
    occurredAt: z.string().max(80).optional(),
    grossCents: centavos.optional(),
    feeCents: centavos.optional(),
    netCents: centavos.optional(),
    adjustmentCents: z
      .number()
      .int()
      .min(-2_000_000_000)
      .max(2_000_000_000)
      .default(0),
    adjustmentReason: z.string().max(300).optional(),
    amountCents: centavos.optional(),
    direction: z.enum(["CREDIT", "DEBIT"]).optional(),
    method: texto.default("UNKNOWN"),
    brand: texto.default("UNKNOWN"),
    installments: z.number().int().min(1).max(48).default(1),
    installmentNumber: z.number().int().min(1).max(48).optional(),
    status: z.enum([
      "COMPLETED",
      "CANCELLED",
      "PENDING",
      "SETTLED",
      "CHARGEBACK",
    ]),
    payoutRef: texto.optional(),
    expectedSettlementDay: diaSchema.optional(),
    description: z.string().max(500).optional(),
  })
  .strict();
export type Linha = z.infer<typeof linhaSchema>;
export type LinhaMotor = Linha & {
  id: string;
  fonte: Fonte;
  organizacaoId: string;
  unidadeId: string;
};

export const contratoSchema = z
  .object({
    substituiId: z.string().min(1).max(128).optional(),
    provedor: texto,
    estabelecimento: texto,
    bandeira: texto,
    metodo: texto,
    parcelasDe: z.number().int().min(1).max(48),
    parcelasAte: z.number().int().min(1).max(48),
    de: diaSchema,
    ate: diaSchema.nullable(),
    taxaBps: z.number().int().min(0).max(10000),
    fixaCentavos: centavos,
    toleranciaCentavos: z.number().int().min(0).max(10000),
  })
  .strict()
  .refine(
    (c) => c.parcelasDe <= c.parcelasAte && (!c.ate || c.de <= c.ate),
    "Vigência ou parcelas inválidas.",
  );
export type Contrato = Omit<z.infer<typeof contratoSchema>, "substituiId"> & {
  id: string;
  versao: number;
};

export const estados: Record<string, string> = {
  RECONCILED: "Conferido",
  FEE_DIFFERENCE: "Taxa divergente",
  GROSS_DIFFERENCE: "Bruto divergente",
  BANK_DIFFERENCE: "Crédito divergente",
  WAITING_ACQUIRER: "Aguardando adquirente",
  WAITING_SETTLEMENT: "Aguardando liquidação",
  WAITING_BANK: "Aguardando banco",
  WAITING_BANK_EVIDENCE: "Falta referência bancária",
  AMBIGUOUS: "Correspondência ambígua",
  POSSIBLE_MATCH: "Correspondência provável",
  AMBIGUOUS_BANK: "Crédito ambíguo",
  SOURCE_PARTIAL: "Cobertura parcial",
  FEE_UNKNOWN: "Contrato de taxa desconhecido",
  CHARGEBACK: "Chargeback",
  CANCELLED: "Venda cancelada",
  UNMATCHED: "Sem venda vinculada",
  ADJUSTMENT_REVIEW: "Ajuste para revisão",
  REVIEW_REQUIRED: "Revisão adicional",
};
export type Cobertura = Record<
  Fonte,
  { completa: boolean; de: string; ate: string; importacoes: string[] }
>;
export type Resultado = {
  chave: string;
  vendaId: string | null;
  adquirenteIds: string[];
  bancoIds: string[];
  estado: string;
  estadoCalculado?: string;
  categoria: "EXATA" | "PROVAVEL" | "AMBIGUA" | "AUSENTE";
  brutoCentavos: number;
  previstoCentavos: number | null;
  liquidadoCentavos: number;
  creditoAlocadoCentavos: number;
  taxaPrevistaCentavos: number | null;
  taxaCobradaCentavos: number;
  diferencaTaxaCentavos: number | null;
  diferencaBrutoCentavos: number;
  diferencaBancoCentavos: number;
  toleranciaCentavos: number;
  contratoIds: string[];
  candidatos: string[];
  notas: string[];
};
export type LoteMotor = {
  chave: string;
  componentes: string[];
  liquidoCentavos: number;
  bancoId: string | null;
  estado: string;
};

export function somar(valores: number[]): number {
  const total = valores.reduce((a, b) => a + b, 0);
  if (!Number.isSafeInteger(total))
    throw new Error("Total fora do limite de cálculo.");
  return total;
}
export function calcularTaxa(bruto: number, bps: number, fixa: number): number {
  return (
    Number((BigInt(bruto) * BigInt(bps) + BigInt(5000)) / BigInt(10000)) + fixa
  );
}
export function contratoDaVenda(v: Linha, contratos: Contrato[]) {
  const encontrados = contratos.filter(
    (c) =>
      c.provedor === v.provider &&
      c.estabelecimento === v.merchantRef &&
      c.bandeira === v.brand &&
      c.metodo === v.method &&
      c.parcelasDe <= v.installments &&
      c.parcelasAte >= v.installments &&
      c.de <= v.businessDay &&
      (!c.ate || c.ate >= v.businessDay),
  );
  return encontrados.length === 1 ? encontrados[0] : null;
}
const chaveForte = (l: Linha) =>
  l.nsu
    ? JSON.stringify([
        l.provider,
        l.merchantRef,
        l.accountRef,
        l.nsu,
        l.businessDay,
      ])
    : null;
const chaveLote = (l: Linha) =>
  l.payoutRef && l.expectedSettlementDay
    ? JSON.stringify([
        l.provider,
        l.merchantRef,
        l.accountRef,
        l.payoutRef,
        l.expectedSettlementDay,
      ])
    : null;
const mesmoEscopo = (a: Linha, b: Linha) =>
  a.provider === b.provider &&
  a.merchantRef === b.merchantRef &&
  a.accountRef === b.accountRef;

export function conciliar(entrada: {
  organizacaoId: string;
  unidadeId: string;
  linhas: LinhaMotor[];
  contratos: Contrato[];
  cobertura: Cobertura;
}) {
  const { linhas, contratos, cobertura } = entrada;
  const ids = new Set<string>();
  for (const l of linhas) {
    if (
      ids.has(l.id) ||
      l.organizacaoId !== entrada.organizacaoId ||
      l.unidadeId !== entrada.unidadeId
    )
      throw new Error("Escopo ou identidade de fonte inválido.");
    ids.add(l.id);
    linhaSchema.parse(
      Object.fromEntries(
        Object.entries(l).filter(
          ([k]) => !["id", "fonte", "organizacaoId", "unidadeId"].includes(k),
        ),
      ),
    );
  }
  const vendas = linhas.filter((l) => l.fonte === "VENDA");
  const adquirente = linhas.filter((l) => l.fonte === "ADQUIRENTE");
  const banco = linhas.filter((l) => l.fonte === "BANCO");
  const lotesMap = new Map<string, LinhaMotor[]>();
  for (const a of adquirente) {
    const k = chaveLote(a);
    if (k) lotesMap.set(k, [...(lotesMap.get(k) ?? []), a]);
  }
  const lotes: LoteMotor[] = [...lotesMap].map(([chave, componentes]) => {
    const a = componentes[0];
    const creditos = banco.filter(
      (b) =>
        mesmoEscopo(a, b) &&
        b.direction === "CREDIT" &&
        b.payoutRef === a.payoutRef &&
        b.businessDay === a.expectedSettlementDay,
    );
    const liquidoCentavos = somar(
      componentes
        .filter((c) => c.status === "SETTLED")
        .map((c) => c.netCents ?? 0),
    );
    const elegivel = componentes.every(
      (c) => c.status === "SETTLED" && c.adjustmentCents === 0,
    );
    return {
      chave,
      componentes: componentes.map((c) => c.id),
      liquidoCentavos,
      bancoId: creditos.length === 1 ? creditos[0].id : null,
      estado: !elegivel
        ? "ADJUSTMENT_REVIEW"
        : creditos.length > 1
          ? "AMBIGUOUS_BANK"
          : !creditos.length
            ? "WAITING_BANK"
            : creditos[0].amountCents !== liquidoCentavos
              ? "BANK_DIFFERENCE"
              : "RECONCILED",
    };
  });
  // Uma transação bancária não pode financiar dois lotes da mesma execução.
  for (const l of lotes)
    if (l.bancoId && lotes.filter((o) => o.bancoId === l.bancoId).length > 1)
      l.estado = "AMBIGUOUS_BANK";
  const usadas = new Set<string>();
  const resultados: Resultado[] = vendas.map((v) => {
    const contrato = contratoDaVenda(v, contratos);
    const taxaPrevista = contrato
      ? calcularTaxa(v.grossCents!, contrato.taxaBps, contrato.fixaCentavos)
      : null;
    const r: Resultado = {
      chave: JSON.stringify([
        "VENDA",
        v.provider,
        v.merchantRef,
        v.accountRef,
        v.externalId ?? v.id,
      ]),
      vendaId: v.id,
      adquirenteIds: [],
      bancoIds: [],
      estado: "WAITING_ACQUIRER",
      categoria: "AUSENTE",
      brutoCentavos: v.grossCents!,
      previstoCentavos:
        taxaPrevista === null ? null : v.grossCents! - taxaPrevista,
      liquidadoCentavos: 0,
      creditoAlocadoCentavos: 0,
      taxaPrevistaCentavos: taxaPrevista,
      taxaCobradaCentavos: 0,
      diferencaTaxaCentavos: null,
      diferencaBrutoCentavos: 0,
      diferencaBancoCentavos: 0,
      toleranciaCentavos: contrato?.toleranciaCentavos ?? 0,
      contratoIds: contrato ? [contrato.id] : [],
      candidatos: [],
      notas: [],
    };
    if (v.status === "CANCELLED") {
      r.estado = "CANCELLED";
      return r;
    }
    const forte = chaveForte(v);
    const candidatas = forte
      ? adquirente.filter((a) => chaveForte(a) === forte)
      : [];
    const parcelasCompletas =
      candidatas.length === v.installments &&
      v.installments > 1 &&
      candidatas.every(
        (a) =>
          a.installments === v.installments &&
          a.installmentNumber &&
          a.installmentNumber <= v.installments,
      ) &&
      new Set(candidatas.map((a) => a.installmentNumber)).size ===
        v.installments;
    const parcelaFaltante =
      candidatas.length > 0 &&
      candidatas.length < v.installments &&
      candidatas.every(
        (a) => a.installmentNumber && a.installments === v.installments,
      );
    if (
      (forte &&
        vendas.filter(
          (o) => chaveForte(o) === forte && o.status !== "CANCELLED",
        ).length > 1) ||
      (candidatas.length > 1 && !parcelasCompletas && !parcelaFaltante)
    ) {
      r.estado = "AMBIGUOUS";
      r.categoria = "AMBIGUA";
      r.candidatos = candidatas.map((a) => a.id);
      return r;
    }
    if (!candidatas.length) {
      r.candidatos = adquirente
        .filter(
          (a) =>
            mesmoEscopo(v, a) &&
            a.businessDay === v.businessDay &&
            a.grossCents === v.grossCents &&
            (a.brand === v.brand ||
              a.brand === "UNKNOWN" ||
              v.brand === "UNKNOWN"),
        )
        .map((a) => a.id);
      if (r.candidatos.length) {
        r.estado = "POSSIBLE_MATCH";
        r.categoria = "PROVAVEL";
      }
      return r;
    }
    // Quando o layout inclui autorização/terminal, uma contradição invalida a chave.
    if (
      candidatas.some(
        (a) =>
          (v.terminalRef && a.terminalRef && v.terminalRef !== a.terminalRef) ||
          (v.authorizationCode &&
            a.authorizationCode &&
            v.authorizationCode !== a.authorizationCode),
      )
    ) {
      r.estado = "AMBIGUOUS";
      r.categoria = "AMBIGUA";
      r.candidatos = candidatas.map((a) => a.id);
      return r;
    }
    r.categoria = "EXATA";
    r.adquirenteIds = candidatas.map((a) => a.id);
    candidatas.forEach((a) => usadas.add(a.id));
    r.taxaCobradaCentavos = somar(candidatas.map((a) => a.feeCents!));
    r.diferencaTaxaCentavos =
      taxaPrevista === null ? null : r.taxaCobradaCentavos - taxaPrevista;
    r.diferencaBrutoCentavos =
      somar(candidatas.map((a) => a.grossCents!)) - v.grossCents!;
    r.liquidadoCentavos = somar(
      candidatas.filter((a) => a.status === "SETTLED").map((a) => a.netCents!),
    );
    if (candidatas.some((a) => a.status === "CHARGEBACK"))
      r.estado = "CHARGEBACK";
    else if (parcelaFaltante) {
      r.estado = "WAITING_SETTLEMENT";
      r.notas.push(
        "Há parcelas ainda ausentes. O total parcial não fecha a venda.",
      );
    } else if (r.diferencaBrutoCentavos) r.estado = "GROSS_DIFFERENCE";
    else if (candidatas.some((a) => a.adjustmentCents !== 0))
      r.estado = "ADJUSTMENT_REVIEW";
    else if (candidatas.some((a) => a.status !== "SETTLED"))
      r.estado = "WAITING_SETTLEMENT";
    else {
      const vinculos = candidatas.map((a) =>
        lotes.find((l) => l.chave === chaveLote(a)),
      );
      for (const l of vinculos)
        if (l?.bancoId && !r.bancoIds.includes(l.bancoId))
          r.bancoIds.push(l.bancoId);
      const pendente = vinculos.find((l) => l?.estado !== "RECONCILED");
      const todos = vinculos.every((l) => l?.estado === "RECONCILED");
      r.estado = !todos
        ? (pendente?.estado ?? "WAITING_BANK_EVIDENCE")
        : taxaPrevista === null
          ? "FEE_UNKNOWN"
          : Math.abs(r.diferencaTaxaCentavos!) > r.toleranciaCentavos
            ? "FEE_DIFFERENCE"
            : "RECONCILED";
      r.creditoAlocadoCentavos = somar(
        candidatas
          .filter((_, i) => vinculos[i]?.estado === "RECONCILED")
          .map((a) => a.netCents!),
      );
      r.diferencaBancoCentavos = somar(
        [...new Set(vinculos)]
          .filter((l): l is LoteMotor => !!l && !!l.bancoId)
          .map(
            (l) =>
              banco.find((b) => b.id === l.bancoId)!.amountCents! -
              l.liquidoCentavos,
          ),
      );
      if (
        candidatas.some(
          (a) =>
            (lotes.find((l) => l.chave === chaveLote(a))?.componentes.length ??
              0) > 1,
        )
      )
        r.notas.push(
          "Crédito compartilhado por lote. O valor atribuído a esta venda é somente a soma dos seus componentes.",
        );
    }
    if (!Object.values(cobertura).every((c) => c.completa)) {
      r.notas.push(
        `Etapa encontrada: ${estados[r.estado] ?? r.estado}. A cobertura ainda impede fechar o período.`,
      );
      if (r.estado === "RECONCILED") r.estado = "SOURCE_PARTIAL";
    }
    if (
      r.diferencaTaxaCentavos &&
      Math.abs(r.diferencaTaxaCentavos) <= r.toleranciaCentavos
    )
      r.notas.push(
        "A diferença de taxa continua visível e está dentro da tolerância contratada.",
      );
    return r;
  });
  for (const a of adquirente.filter((a) => !usadas.has(a.id)))
    resultados.push({
      chave: JSON.stringify(["ADQUIRENTE", a.id]),
      vendaId: null,
      adquirenteIds: [a.id],
      bancoIds: [],
      estado: a.status === "CHARGEBACK" ? "CHARGEBACK" : "UNMATCHED",
      categoria: "AUSENTE",
      brutoCentavos: 0,
      previstoCentavos: null,
      liquidadoCentavos: a.status === "SETTLED" ? a.netCents! : 0,
      creditoAlocadoCentavos: 0,
      taxaPrevistaCentavos: null,
      taxaCobradaCentavos: a.feeCents!,
      diferencaTaxaCentavos: null,
      diferencaBrutoCentavos: 0,
      diferencaBancoCentavos: 0,
      toleranciaCentavos: 0,
      contratoIds: [],
      candidatos: [],
      notas: ["Recebível sem venda vinculada; não comprova receita ausente."],
    });
  const creditosVinculados = new Set(
    lotes.flatMap((l) => (l.bancoId ? [l.bancoId] : [])),
  );
  for (const b of banco.filter((b) => !creditosVinculados.has(b.id)))
    resultados.push({
      chave: JSON.stringify(["BANCO", b.id]),
      vendaId: null,
      adquirenteIds: [],
      bancoIds: [b.id],
      estado: "UNMATCHED",
      categoria: "AUSENTE",
      brutoCentavos: 0,
      previstoCentavos: null,
      liquidadoCentavos: 0,
      creditoAlocadoCentavos: 0,
      taxaPrevistaCentavos: null,
      taxaCobradaCentavos: 0,
      diferencaTaxaCentavos: null,
      diferencaBrutoCentavos: 0,
      diferencaBancoCentavos: 0,
      toleranciaCentavos: 0,
      contratoIds: [],
      candidatos: [],
      notas: [
        b.direction === "DEBIT"
          ? "Débito bancário preservado. Não é receita."
          : "Crédito sem lote vinculado; não é receita adicional.",
      ],
    });
  const validas = resultados.filter(
    (r) => r.vendaId && r.estado !== "CANCELLED" && r.estado !== "CHARGEBACK",
  );
  return {
    resultados,
    lotes,
    totais: {
      vendidoCentavos: somar(
        vendas
          .filter((v) => v.status !== "CANCELLED")
          .map((v) => v.grossCents!),
      ),
      previstoCentavos: validas.some((r) => r.previstoCentavos === null)
        ? null
        : somar(validas.map((r) => r.previstoCentavos!)),
      contratosDesconhecidos: validas.filter((r) => r.previstoCentavos === null)
        .length,
      liquidadoCentavos: somar(
        adquirente
          .filter((a) => a.status === "SETTLED")
          .map((a) => a.netCents!),
      ),
      creditadoCentavos: somar(
        banco
          .filter((b) => b.direction === "CREDIT")
          .map((b) => b.amountCents!),
      ),
      debitadoCentavos: somar(
        banco.filter((b) => b.direction === "DEBIT").map((b) => b.amountCents!),
      ),
      diferencaTaxaCentavos: somar(
        resultados
          .filter((r) => r.vendaId)
          .map((r) => r.diferencaTaxaCentavos ?? 0),
      ),
    },
  };
}

export function csvSeguro(valor: unknown): string {
  const texto = String(valor ?? "");
  const protegido = /^[\s\u0000-\u001f]*[=+@-]/u.test(texto)
    ? "'" + texto
    : texto;
  return '"' + protegido.replaceAll('"', '""') + '"';
}
