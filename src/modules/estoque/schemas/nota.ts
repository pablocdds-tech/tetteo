import { z } from "zod";

import { lerDataLocal } from "@/lib/data";
import { numeroBr } from "@/lib/numero";

/**
 * A validação da nota de entrada.
 *
 * Duas decisões que vêm do papel, não do banco:
 *
 *   1. O item é digitado com a QUANTIDADE e o VALOR TOTAL da linha, não com o
 *      preço unitário. É o total que precisa bater com o rodapé da nota; o
 *      unitário o sistema calcula. Pedir os dois convida a divergência de
 *      centavo que ninguém consegue explicar depois.
 *   2. A quantidade é digitada COMO ESTÁ NA NOTA — "2", de duas caixas. A
 *      conversão para quilo é do sistema, com o fator guardado junto.
 */

export const esquemaNota = z.object({
  fornecedor: z
    .string()
    .trim()
    .min(2, "Informe o fornecedor.")
    .max(120, "O nome está longo demais."),

  numero: z.string().trim().max(30).optional(),
  serie: z.string().trim().max(10).optional(),

  // `lerDataLocal`, nunca `new Date`: a data pura do campo seria lida como
  // UTC e a nota de hoje entraria com a data de ontem.
  recebidaEm: z
    .string()
    .trim()
    .min(1, "Informe quando a mercadoria chegou.")
    .refine((v) => lerDataLocal(v) !== null, { message: "Data inválida." })
    .transform((v) => lerDataLocal(v)!),

  localDestinoId: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : null)),

  observacao: z.string().trim().max(300).optional(),
});

export type DadosNota = z.infer<typeof esquemaNota>;

export const esquemaItem = z
  .object({
    insumoId: z.string().trim().min(1, "Escolha o insumo."),

    /** Como está escrito na nota: "2", de duas caixas. */
    quantidadeNota: numeroBr("a quantidade").refine((n) => n > 0, {
      message: "A quantidade precisa ser maior que zero.",
    }),

    /** Nome da embalagem, quando a nota veio em caixa/fardo/saco. */
    embalagemNome: z.string().trim().max(40).optional(),

    /** Quantas unidades-base cabem na embalagem. 1 = veio na unidade base. */
    fatorConversao: numeroBr("o conteúdo da embalagem"),

    /** O valor total da LINHA, como no papel. */
    valorTotal: numeroBr("o valor").refine((n) => n > 0, {
      message: "O valor precisa ser maior que zero.",
    }),

    /** Guardar esta embalagem no insumo, para a próxima nota já vir pronta. */
    salvarEmbalagem: z.boolean().default(false),
  })
  .superRefine((dados, ctx) => {
    if (dados.fatorConversao <= 0) {
      ctx.addIssue({
        code: "custom",
        path: ["fatorConversao"],
        message: "O conteúdo da embalagem precisa ser maior que zero.",
      });
    }
    if (dados.salvarEmbalagem && !dados.embalagemNome) {
      ctx.addIssue({
        code: "custom",
        path: ["embalagemNome"],
        message: "Dê um nome à embalagem para poder guardá-la.",
      });
    }
  });

export type DadosItem = z.infer<typeof esquemaItem>;
