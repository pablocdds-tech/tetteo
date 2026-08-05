import { z } from "zod";

import { lerDataLocal } from "@/lib/data";
import { numeroBr } from "@/lib/numero";

/** A validação do Financeiro — a mesma regra no formulário e no servidor. */

export const esquemaLancamento = z
  .object({
    direcao: z.enum(["PAGAR", "RECEBER"], { message: "Escolha o tipo." }),
    descricao: z
      .string()
      .trim()
      .min(2, "Escreva o que é — você vai reler isto no dia 5.")
      .max(120, "A descrição está longa demais."),
    valor: numeroBr("o valor"),
    vencimento: z
      .string()
      .trim()
      .min(1, "Informe o vencimento.")
      .refine((v) => lerDataLocal(v) !== null, { message: "Data inválida." })
      .transform((v) => lerDataLocal(v)!),
    categoriaId: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v ? v : null)),
    fornecedorId: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v ? v : null)),
    contaId: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v ? v : null)),
    /** Quantas vezes se repete, de mês em mês. 1 é o normal. */
    parcelas: z.coerce
      .number()
      .int()
      .min(1, "No mínimo uma parcela.")
      .max(60, "No máximo 60 parcelas — cinco anos já é longe demais."),
    observacao: z
      .string()
      .trim()
      .max(300)
      .optional()
      .transform((v) => v || null),
  })
  .superRefine((dados, ctx) => {
    if (dados.valor <= 0) {
      ctx.addIssue({
        code: "custom",
        path: ["valor"],
        message: "O valor precisa ser maior que zero.",
      });
    }
  });

export type DadosLancamento = z.infer<typeof esquemaLancamento>;

export const esquemaQuitacao = z
  .object({
    /**
     * Em branco assume o valor combinado. Preenchido diferente registra o que
     * realmente saiu — desconto por antecipação, juro por atraso. Sobrescrever
     * o original apagaria a diferença justamente quando ela interessa.
     */
    valorQuitado: numeroBr("o valor pago"),
    quitadoEm: z
      .string()
      .trim()
      .min(1, "Informe a data do pagamento.")
      .refine((v) => lerDataLocal(v) !== null, { message: "Data inválida." })
      .transform((v) => lerDataLocal(v)!),
    contaId: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v ? v : null)),
  })
  .superRefine((dados, ctx) => {
    if (dados.valorQuitado <= 0) {
      ctx.addIssue({
        code: "custom",
        path: ["valorQuitado"],
        message: "O valor pago precisa ser maior que zero.",
      });
    }
  });

export const esquemaCategoria = z.object({
  nome: z
    .string()
    .trim()
    .min(2, "O nome precisa de pelo menos 2 letras.")
    .max(60, "O nome está longo demais."),
  tipo: z.enum(["RECEITA", "DESPESA"], { message: "Receita ou despesa?" }),
  grupo: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((v) => v || null),
  /** A linha do DRE. Em branco, a categoria não entra no resultado. */
  grupoDre: z
    .enum([
      "RECEITA",
      "DEDUCAO",
      "MERCADORIA",
      "PESSOAL",
      "OCUPACAO",
      "OPERACIONAL",
      "FINANCEIRA",
      "INVESTIMENTO",
    ])
    .optional()
    .or(z.literal("").transform(() => undefined))
    .transform((v) => v ?? null),
});

export const esquemaConta = z.object({
  nome: z
    .string()
    .trim()
    .min(2, "O nome precisa de pelo menos 2 letras.")
    .max(60, "O nome está longo demais."),
  tipo: z.enum(["CAIXA", "BANCO"], { message: "Caixa ou banco?" }),
  saldoInicial: numeroBr("o saldo inicial"),
});
