import { z } from "zod";
import { ControleRequisicoesSaipos, TAMANHO_PAGINA } from "./limites";

const BASE = "https://data.saipos.io/v1/";
const DAY = 86_400_000;
export type Operation = "sales" | "financial";
export type DateColumn =
  | "shift_date"
  | "created_at"
  | "updated_at"
  | "date"
  | "payment_date"
  | "issuance_date";
export class SaiposError extends Error {
  constructor(
    public readonly kind: string,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
  }
}
// Campos verificados na conta real. Dados pessoais são descartados pelo Zod.
const saleSchema = z.object({
  id_store: z.number().int(),
  id_sale: z.number().int(),
  total_amount: z.number().finite(),
  id_sale_type: z.number().int().nullish(),
  partner_sale: z
    .object({ desc_partner_sale: z.string().max(120).nullish() })
    .nullish(),
  canceled: z.enum(["Y", "N"]),
  shift_date: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type SaiposSale = z.infer<typeof saleSchema>;
const financialSchema = z.object({
  id_store: z.number().int(),
  id_store_fin_transaction: z.number().int(),
  amount: z.number().finite(),
  date: z.string(),
  paid: z.enum(["Y", "N"]),
  created_at: z.string(),
  updated_at: z.string(),
});
export type SaiposFinancial = z.infer<typeof financialSchema>;
export interface Period {
  start: string;
  end: string;
  column: DateColumn;
}
export interface Cursor {
  operation: Operation;
  storeId: number;
  through: string;
}

function time(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value))
    throw new SaiposError(
      "period",
      "Use data local no formato AAAA-MM-DDTHH:mm:ss.",
    );
  const result = Date.parse(value + "Z");
  if (
    !Number.isFinite(result) ||
    new Date(result).toISOString().slice(0, 19) !== value
  )
    throw new SaiposError("period", "Data inválida.");
  return result;
}
const local = (value: number) => new Date(value).toISOString().slice(0, 19);
export function windows(period: Period): Period[] {
  const start = time(period.start),
    end = time(period.end);
  if (end < start)
    throw new SaiposError("period", "Período final anterior ao inicial.");
  if (end - start > 366 * DAY)
    throw new SaiposError(
      "period",
      "Consulte no máximo 366 dias por execução.",
    );
  const result: Period[] = [];
  for (let next = start; next <= end;) {
    const stop = Math.min(next + 15 * DAY - 1000, end);
    result.push({ ...period, start: local(next), end: local(stop) });
    next = stop + 1000;
  }
  return result;
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
// Fila e orçamento compartilhados no processo, inclusive entre tokens e endpoints.
// O worker de produção é único pela concessão no banco; outros consumidores no
// mesmo IP precisam compartilhar um limitador distribuído antes de serem ativados.
let queue: Promise<unknown> = Promise.resolve();
const controleCompartilhado = new ControleRequisicoesSaipos();
export class SaiposClient {
  private readonly token: string;
  constructor(
    private readonly transport: typeof fetch = fetch,
    private readonly controle = controleCompartilhado,
  ) {
    this.token = (process.env.SAIPOS_TOKEN || "")
      .replace(/^Bearer\s+/i, "")
      .trim();
    if (!this.token)
      throw new SaiposError(
        "configuration",
        "Configure SAIPOS_TOKEN no ambiente privado do backend.",
      );
  }
  private async request(
    path: string,
    period: Period,
    offset: number,
  ): Promise<unknown> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const task = queue.then(async () => {
        if (this.controle.bloqueada(Date.now()))
          throw new SaiposError(
            "rate_limit",
            "Limite Saipos atingido. Aguarde pelo menos 5 minutos antes de executar novamente.",
            429,
          );
        let espera = this.controle.espera(Date.now());
        while (espera > 0) {
          await sleep(espera);
          espera = this.controle.espera(Date.now());
        }
        this.controle.registrar(Date.now());
        const url = new URL(path, BASE);
        url.search = new URLSearchParams({
          p_date_column_filter: period.column,
          p_filter_date_start: period.start,
          p_filter_date_end: period.end,
          p_limit: String(TAMANHO_PAGINA),
          p_offset: String(offset),
        }).toString();
        const resposta = await this.transport(url, {
          method: "GET",
          headers: { Authorization: `Bearer ${this.token}` },
          redirect: "error",
          signal: AbortSignal.timeout(30_000),
        });
        if (resposta.status === 429)
          this.controle.bloquear(
            Date.now(),
            resposta.headers.get("Retry-After"),
          );
        return resposta;
      });
      queue = task.catch(() => undefined);
      let response: Response;
      try {
        response = await task;
      } catch (erro) {
        if (erro instanceof SaiposError) throw erro;
        if (attempt === 2)
          throw new SaiposError(
            "temporary",
            "Saipos indisponível após 3 tentativas.",
          );
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      if (response.status === 401 || response.status === 403) {
        throw new SaiposError(
          response.status === 401 ? "unauthorized" : "forbidden",
          response.status === 401
            ? "Token inválido ou acesso não autorizado pelo Saipos."
            : "Conta sem permissão para esta consulta.",
          response.status,
        );
      }
      if (response.status === 429)
        throw new SaiposError(
          "rate_limit",
          "Limite Saipos atingido. Aguarde pelo menos 5 minutos antes de executar novamente.",
          429,
        );
      if (response.status >= 500) {
        await response.body?.cancel();
        if (attempt === 2)
          throw new SaiposError(
            "temporary",
            "Falha temporária do Saipos após 3 tentativas.",
            response.status,
          );
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      if (!response.ok)
        throw new SaiposError(
          "request",
          "Saipos recusou os parâmetros da consulta.",
          response.status,
        );
      try {
        return await response.json();
      } catch {
        throw new SaiposError("format", "Resposta Saipos não é JSON válido.");
      }
    }
    throw new SaiposError("temporary", "Consulta não concluída.");
  }
  async sales(period: Period, storeId: number): Promise<SaiposSale[]> {
    if (!Number.isSafeInteger(storeId) || storeId <= 0)
      throw new SaiposError("store", "Informe a loja Saipos autorizada.");
    if (!["shift_date", "created_at", "updated_at"].includes(period.column))
      throw new SaiposError("period", "Filtro inválido para vendas.");
    const records = new Map<string, SaiposSale>();
    for (const window of windows(period)) {
      let previousPage = "";
      for (let page = 0; ; page++) {
        if (page >= 1000)
          throw new SaiposError(
            "pagination",
            "Limite de páginas atingido; cursor não deve avançar.",
          );
        const raw = await this.request(
          "search_sales",
          window,
          page * TAMANHO_PAGINA,
        );
        // Consulta real sem vendas em 25/10/2026 retornou HTTP 200 com null.
        // Somente esse valor equivale à página vazia; objetos inválidos falham.
        const parsed = z.array(saleSchema).safeParse(raw === null ? [] : raw);
        if (!parsed.success)
          throw new SaiposError(
            "format",
            "Formato de vendas mudou; revisão necessária, sem avançar cursor.",
          );
        const signature = JSON.stringify(parsed.data);
        if (parsed.data.length && signature === previousPage)
          throw new SaiposError(
            "pagination",
            "Saipos repetiu uma página; consulta interrompida.",
          );
        previousPage = signature;
        for (const sale of parsed.data) {
          if (sale.id_store !== storeId) continue;
          const key = `${sale.id_store}:${sale.id_sale}`;
          const previous = records.get(key);
          if (!previous || sale.updated_at >= previous.updated_at)
            records.set(key, sale);
        }
        if (parsed.data.length < TAMANHO_PAGINA) break;
      }
    }
    return [...records.values()];
  }
  // Prova de acesso sem expor dados brutos.
  async probeFinancial(
    period: Period,
    storeId: number,
  ): Promise<{ status: string; count: number }> {
    const records = await this.financial(period, storeId);
    return {
      status: records.length
        ? "Acesso financeiro confirmado nesta consulta para a loja autorizada."
        : "Consulta sem registros; situação da conta e permissão ainda não comprovadas.",
      count: records.length,
    };
  }
  async financial(period: Period, storeId: number): Promise<SaiposFinancial[]> {
    if (!Number.isSafeInteger(storeId) || storeId <= 0)
      throw new SaiposError("store", "Informe a loja Saipos autorizada.");
    if (
      ![
        "date",
        "created_at",
        "updated_at",
        "payment_date",
        "issuance_date",
      ].includes(period.column)
    )
      throw new SaiposError("period", "Filtro inválido para financeiro.");
    const records = new Map<string, SaiposFinancial>();
    for (const window of windows(period)) {
      let previousPage = "";
      for (let page = 0; ; page++) {
        if (page >= 1000)
          throw new SaiposError(
            "pagination",
            "Limite de páginas financeiras atingido; cursor não deve avançar.",
          );
        const raw = await this.request(
          "search_financial_transactions",
          window,
          page * TAMANHO_PAGINA,
        );
        // HTTP 200 null confirmado em consulta financeira vazia real.
        const parsed = z
          .array(financialSchema)
          .safeParse(raw === null ? [] : raw);
        if (!parsed.success)
          throw new SaiposError(
            "format",
            "Formato financeiro mudou; revisão necessária, sem avançar cursor.",
          );
        const signature = JSON.stringify(parsed.data);
        if (parsed.data.length && signature === previousPage)
          throw new SaiposError(
            "pagination",
            "Saipos repetiu uma página financeira.",
          );
        previousPage = signature;
        for (const record of parsed.data) {
          if (record.id_store !== storeId) continue;
          const key = `${record.id_store}:${record.id_store_fin_transaction}`;
          const previous = records.get(key);
          if (!previous || record.updated_at >= previous.updated_at)
            records.set(key, record);
        }
        if (parsed.data.length < TAMANHO_PAGINA) break;
      }
    }
    return [...records.values()];
  }
  async inventory(): Promise<never> {
    throw new SaiposError(
      "maintenance",
      "Endpoint de estoque em manutenção segundo a documentação oficial; integração indisponível.",
    );
  }
  async incremental(
    cursor: Cursor,
    through: string,
  ): Promise<{ sales: SaiposSale[]; nextCursor: Cursor }> {
    if (cursor.operation !== "sales")
      throw new SaiposError(
        "cursor",
        "Use incrementalFinancial para o cursor financeiro.",
      );
    if (time(through) <= time(cursor.through))
      throw new SaiposError(
        "cursor",
        "O novo cursor deve ser posterior ao anterior.",
      );
    const sales = await this.sales(
      {
        start: local(time(cursor.through) - 2 * DAY),
        end: through,
        column: "updated_at",
      },
      cursor.storeId,
    );
    return { sales, nextCursor: { ...cursor, through } };
  }
  async incrementalFinancial(
    cursor: Cursor,
    through: string,
  ): Promise<{ records: SaiposFinancial[]; nextCursor: Cursor }> {
    if (cursor.operation !== "financial")
      throw new SaiposError(
        "cursor",
        "Cursor deve pertencer à operação financeira.",
      );
    if (time(through) <= time(cursor.through))
      throw new SaiposError(
        "cursor",
        "O novo cursor deve ser posterior ao anterior.",
      );
    const records = await this.financial(
      {
        start: local(time(cursor.through) - 2 * DAY),
        end: through,
        column: "updated_at",
      },
      cursor.storeId,
    );
    return { records, nextCursor: { ...cursor, through } };
  }
}
export function revenue(sales: SaiposSale[]): {
  count: number;
  canceled: number;
  amount: string;
} {
  const valid = sales.filter((sale) => sale.canceled === "N");
  const cents = valid.reduce(
    (sum, sale) => sum + Math.round(sale.total_amount * 100),
    0,
  );
  return {
    count: valid.length,
    canceled: sales.length - valid.length,
    amount: (cents / 100).toFixed(2),
  };
}
