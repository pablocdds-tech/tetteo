import { z } from "zod";

export const FORMAS_RECEBIMENTO_PDV = [
  "DINHEIRO",
  "PIX",
  "DEBITO",
  "CREDITO",
] as const;
export const NOMES_RECEBIMENTO_PDV: Record<
  (typeof FORMAS_RECEBIMENTO_PDV)[number],
  string
> = { DINHEIRO: "Dinheiro", PIX: "Pix", DEBITO: "Débito", CREDITO: "Crédito" };
const referencia = z.string().max(128).nullable();
const regra = z
  .object({
    forma: z.enum(FORMAS_RECEBIMENTO_PDV),
    ativa: z.boolean(),
    empresaId: referencia,
    contaId: referencia,
    categoriaId: referencia,
    taxaBps: z.number().int().min(0).max(9999).nullable(),
    prazoDias: z.number().int().min(0).max(365).nullable(),
    baixarNoRecebimento: z.boolean(),
    versao: z.number().int().nonnegative(),
  })
  .superRefine((r, c) => {
    const erro = (message: string) => c.addIssue({ code: "custom", message });
    if (
      r.ativa &&
      (!r.empresaId ||
        !r.contaId ||
        !r.categoriaId ||
        r.taxaBps === null ||
        r.prazoDias === null)
    )
      erro(
        `${NOMES_RECEBIMENTO_PDV[r.forma]}: complete empresa, conta, plano, taxa e prazo antes de ativar.`,
      );
    if (
      r.baixarNoRecebimento &&
      (["DEBITO", "CREDITO"].includes(r.forma) || r.prazoDias !== 0)
    )
      erro(
        "Baixa no recebimento só pode ser usada para dinheiro ou Pix com prazo zero.",
      );
    if (
      r.forma === "DINHEIRO" &&
      ((r.taxaBps ?? 0) !== 0 || (r.prazoDias ?? 0) !== 0)
    )
      erro(
        "Dinheiro exige taxa e prazo zero; despesas bancárias devem ser lançadas separadamente.",
      );
  });
export const configuracaoRecebimentosPdv = z
  .object({ regras: z.array(regra).length(4) })
  .refine(
    (d) => new Set(d.regras.map((r) => r.forma)).size === 4,
    "Envie uma regra por forma de pagamento.",
  );
export type RegraRecebimentoPdv = z.infer<typeof regra>;
