import { z } from "zod";

import { numeroBr } from "@/lib/numero";

/**
 * A validação do insumo.
 *
 * A mesma definição vale no formulário e no servidor. Uma regra só, escrita
 * uma vez — sem risco de o navegador aceitar o que o servidor recusa.
 */
export const UNIDADES = [
  { valor: "KG", rotulo: "Quilograma (kg)" },
  { valor: "G", rotulo: "Grama (g)" },
  { valor: "L", rotulo: "Litro (L)" },
  { valor: "ML", rotulo: "Mililitro (ml)" },
  { valor: "UN", rotulo: "Unidade (un)" },
] as const;

export const esquemaInsumo = z.object({
  nome: z
    .string()
    .trim()
    .min(2, "O nome precisa de pelo menos 2 letras.")
    .max(120, "O nome está longo demais."),
  categoria: z.string().trim().max(60).optional(),
  unidadeMedida: z.enum(["KG", "G", "L", "ML", "UN"], {
    message: "Escolha a unidade de medida.",
  }),
  custoMedio: numeroBr("o custo"),
  estoqueMinimo: numeroBr("o estoque mínimo"),
});

export type DadosInsumo = z.infer<typeof esquemaInsumo>;
