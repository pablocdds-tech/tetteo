import { z } from "zod";

import { numeroBrOpcional } from "@/lib/numero";

/**
 * A validação da contagem.
 *
 * A mesma definição vale no formulário e no servidor — uma regra só, escrita
 * uma vez, sem risco de o navegador aceitar o que o servidor recusa.
 */

export const esquemaNovaContagem = z.object({
  /**
   * O momento que a contagem REPRESENTA, não o momento em que foi digitada.
   * Você conta segunda de manhã o estoque que fechou domingo à noite — e é a
   * noite de domingo que delimita o período do CMV.
   */
  referencia: z
    .string()
    .trim()
    .min(1, "Informe a data e a hora da contagem.")
    .refine((v) => !Number.isNaN(new Date(v).getTime()), {
      message: "Data inválida.",
    })
    .transform((v) => new Date(v)),

  descricao: z
    .string()
    .trim()
    .max(80, "A descrição está longa demais.")
    .optional(),

  /** Vazio significa contagem cheia — todos os insumos ativos. */
  categorias: z.array(z.string().trim().min(1)).default([]),
});

export type DadosNovaContagem = z.infer<typeof esquemaNovaContagem>;

/**
 * Uma quantidade digitada na folha de contagem.
 *
 * Opcional de propósito: em branco é "não contei", zero é "acabou". O CMV
 * trata os dois de forma oposta.
 */
export const esquemaQuantidade = numeroBrOpcional("a quantidade");
