import { z } from "zod";

export const esquemaPagamentos = z
  .array(
    z
      .object({
        forma: z.enum(["DINHEIRO", "PIX", "CREDITO", "DEBITO"]),
        valorCentavos: z.number().int().min(1).max(100_000_000),
      })
      .strict(),
  )
  .max(20);
export const esquemaConsultarRecebimento = z
  .object({ vendaId: z.string().trim().min(1).max(100) })
  .strict();
export const esquemaReceber = z
  .object({
    vendaId: z.string().trim().min(1).max(100),
    versaoFinanceira: z.number().int().min(1).max(2_000_000_000),
    chave: z.string().uuid(),
    caixaId: z.string().trim().min(1).max(100),
    pagamentos: esquemaPagamentos.min(1),
  })
  .strict();
