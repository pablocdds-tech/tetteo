import { z } from "zod";

/**
 * A validação do cadastro de fornecedor.
 *
 * A mesma definição vale no formulário e no servidor — uma regra só, escrita
 * uma vez, sem risco de o navegador aceitar o que o servidor recusa. A
 * validação da RESPOSTA do fornecedor mora em `proposta.ts`: ela chega também
 * pelo link público, e lá cada campo é hostil até prova em contrário.
 */

const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || null);

export const esquemaFornecedor = z.object({
  nome: z
    .string()
    .trim()
    .min(2, "O nome precisa de pelo menos 2 letras.")
    .max(120, "O nome está longo demais."),
  documento: textoOpcional(20),
  telefone: textoOpcional(30),
  email: textoOpcional(120).refine((v) => v === null || v.includes("@"), {
    message: "E-mail inválido.",
  }),
  contato: textoOpcional(80),
  prazoEntregaDias: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? Number(v) : null))
    .refine((v) => v === null || (Number.isInteger(v) && v >= 0 && v <= 365), {
      message: "Informe o prazo em dias, de 0 a 365.",
    }),
  condicaoPagamento: textoOpcional(60),
  observacao: textoOpcional(300),
});

export type DadosFornecedor = z.infer<typeof esquemaFornecedor>;
