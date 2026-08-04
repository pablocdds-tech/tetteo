import { z } from "zod";

import { lerDataLocal } from "@/lib/data";
import { numeroBr } from "@/lib/numero";

/**
 * A validação de Compras.
 *
 * A mesma definição vale no formulário e no servidor — uma regra só, escrita
 * uma vez, sem risco de o navegador aceitar o que o servidor recusa.
 */

export const esquemaFornecedor = z.object({
  nome: z
    .string()
    .trim()
    .min(2, "O nome precisa de pelo menos 2 letras.")
    .max(120, "O nome está longo demais."),
  documento: z
    .string()
    .trim()
    .max(20)
    .optional()
    .transform((v) => v || null),
  telefone: z
    .string()
    .trim()
    .max(30)
    .optional()
    .transform((v) => v || null),
  email: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((v) => v || null)
    .refine((v) => v === null || v.includes("@"), {
      message: "E-mail inválido.",
    }),
  contato: z
    .string()
    .trim()
    .max(80)
    .optional()
    .transform((v) => v || null),
  prazoEntregaDias: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? Number(v) : null))
    .refine((v) => v === null || (Number.isInteger(v) && v >= 0 && v <= 365), {
      message: "Informe o prazo em dias, de 0 a 365.",
    }),
  condicaoPagamento: z
    .string()
    .trim()
    .max(60)
    .optional()
    .transform((v) => v || null),
  observacao: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((v) => v || null),
});

export type DadosFornecedor = z.infer<typeof esquemaFornecedor>;

export const esquemaCotacao = z.object({
  descricao: z
    .string()
    .trim()
    .min(3, "Dê um nome à cotação — ela vira histórico de preço.")
    .max(80, "O nome está longo demais."),
  validaAte: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? lerDataLocal(v) : null)),
  observacao: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((v) => v || null),
});

export const esquemaItemDeCotacao = z
  .object({
    insumoId: z.string().trim().min(1, "Escolha o insumo."),
    quantidade: numeroBr("a quantidade"),
    observacao: z
      .string()
      .trim()
      .max(200)
      .optional()
      .transform((v) => v || null),
  })
  .superRefine((dados, ctx) => {
    /**
     * Quantidade zero quebra a comparação sem avisar: o item entraria na
     * grade valendo R$ 0 para todo mundo, e o fornecedor caro nele passaria
     * a empatar com o barato.
     */
    if (dados.quantidade <= 0) {
      ctx.addIssue({
        code: "custom",
        path: ["quantidade"],
        message: "A quantidade precisa ser maior que zero.",
      });
    }
  });

export const esquemaProposta = z.object({
  fornecedorId: z.string().trim().min(1, "Escolha o fornecedor."),
});

/**
 * Um preço recebido do fornecedor.
 *
 * Chega como ele fala — "a caixa de 10 kg sai por 300" — e o sistema divide.
 * Pedir o preço já unitário faria a pessoa fazer essa conta de cabeça na hora
 * de digitar, que é exatamente o erro que a cotação existe para eliminar.
 */
export const esquemaPreco = z
  .object({
    itemId: z.string().trim().min(1),
    embalagem: z
      .string()
      .trim()
      .max(40)
      .optional()
      .transform((v) => v || null),
    fatorConversao: numeroBr("o conteúdo da embalagem"),
    precoEmbalagem: numeroBr("o preço"),
    naoAtende: z.boolean().default(false),
  })
  .superRefine((dados, ctx) => {
    if (dados.naoAtende) return;
    if (dados.fatorConversao <= 0) {
      ctx.addIssue({
        code: "custom",
        path: ["fatorConversao"],
        message: "Quanto vem na embalagem? Para venda a granel, use 1.",
      });
    }
  });

export const esquemaFecharProposta = z.object({
  frete: numeroBr("o frete"),
  pedidoMinimo: numeroBr("o pedido mínimo"),
  observacao: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((v) => v || null),
});
