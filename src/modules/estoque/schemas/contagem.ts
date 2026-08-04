import { z } from "zod";

import { lerDataLocal } from "@/lib/data";
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
    .refine((v) => lerDataLocal(v) !== null, { message: "Data inválida." })
    .transform((v) => lerDataLocal(v)!),

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

export const esquemaRotina = z
  .object({
    nome: z
      .string()
      .trim()
      .min(2, "Dê um nome à rotina — ele aparece na lista de cobrança.")
      .max(80, "O nome está longo demais."),
    recorrencia: z.enum(["DIARIA", "SEMANAL", "MENSAL"], {
      message: "Escolha a frequência.",
    }),
    diaDaSemana: z.coerce.number().int().min(0).max(6).nullish(),
    diaDoMes: z.coerce
      .number()
      .int()
      .min(1, "O dia do mês vai de 1 a 28.")
      // Até 28: "dia 31" não existe em fevereiro e a rotina sumiria do mês.
      .max(28, "Use até o dia 28 — fevereiro existe.")
      .nullish(),
    horario: z
      .string()
      .trim()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Horário no formato 07:00.")
      .optional()
      .or(z.literal("").transform(() => undefined)),
    localId: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v ? v : null)),
    categorias: z.array(z.string().trim().min(1)).default([]),
  })
  .superRefine((dados, ctx) => {
    if (dados.recorrencia === "SEMANAL" && dados.diaDaSemana == null) {
      ctx.addIssue({
        code: "custom",
        path: ["diaDaSemana"],
        message: "Escolha o dia da semana.",
      });
    }
    if (dados.recorrencia === "MENSAL" && dados.diaDoMes == null) {
      ctx.addIssue({
        code: "custom",
        path: ["diaDoMes"],
        message: "Escolha o dia do mês.",
      });
    }
  });

export type DadosRotina = z.infer<typeof esquemaRotina>;
