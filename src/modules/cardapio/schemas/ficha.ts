import { z } from "zod";

import { numeroBr, numeroBrOpcional } from "@/lib/numero";

/**
 * A validação da ficha técnica.
 *
 * A mesma definição vale no formulário e no servidor — uma regra só, escrita
 * uma vez, sem risco de o navegador aceitar o que o servidor recusa.
 */

export const TIPOS_DE_FICHA = [
  {
    valor: "PRATO",
    rotulo: "Prato",
    ajuda: "Vai para o cliente e tem preço de venda",
  },
  {
    valor: "PREPARO",
    rotulo: "Preparo",
    ajuda: "Massa, molho, mix — vira ingrediente de outra ficha",
  },
] as const;

export const esquemaFicha = z
  .object({
    nome: z
      .string()
      .trim()
      .min(2, "O nome precisa de pelo menos 2 letras.")
      .max(120, "O nome está longo demais."),
    categoria: z
      .string()
      .trim()
      .max(60, "A categoria está longa demais.")
      .optional()
      .transform((v) => v || null),
    tipo: z.enum(["PRATO", "PREPARO"], {
      message: "Escolha se é prato ou preparo.",
    }),
    modoDePreparo: z
      .string()
      .trim()
      .max(4000, "O modo de preparo está longo demais.")
      .optional()
      .transform((v) => v || null),
    rendimento: numeroBr("o rendimento"),
    unidadeRendimento: z.enum(["KG", "G", "L", "ML", "UN"], {
      message: "Escolha a unidade do rendimento.",
    }),
    precoVenda: numeroBrOpcional("o preço de venda"),
  })
  .superRefine((dados, ctx) => {
    /**
     * Rendimento zero não é "não informado": é divisão por zero na hora de
     * achar o custo unitário. E o custo unitário é justamente o que faz um
     * preparo poder entrar em outra receita.
     */
    if (dados.rendimento <= 0) {
      ctx.addIssue({
        code: "custom",
        path: ["rendimento"],
        message:
          "O rendimento precisa ser maior que zero — é ele que divide o custo.",
      });
    }
  });

export type DadosFicha = z.infer<typeof esquemaFicha>;

export const esquemaItemDeFicha = z
  .object({
    /** Vem como "insumo:<id>" ou "ficha:<id>" — um seletor só na tela. */
    alvo: z.string().trim().min(1, "Escolha o insumo ou o preparo."),
    quantidade: numeroBr("a quantidade"),
    unidade: z.enum(["KG", "G", "L", "ML", "UN"], {
      message: "Escolha a unidade.",
    }),
    perdaPercentual: numeroBr("a perda"),
    observacao: z
      .string()
      .trim()
      .max(200, "A observação está longa demais.")
      .optional()
      .transform((v) => v || null),
  })
  .superRefine((dados, ctx) => {
    if (dados.quantidade <= 0) {
      ctx.addIssue({
        code: "custom",
        path: ["quantidade"],
        message: "A quantidade precisa ser maior que zero.",
      });
    }
    if (dados.perdaPercentual >= 100) {
      ctx.addIssue({
        code: "custom",
        path: ["perdaPercentual"],
        message: "Uma perda de 100% não deixaria nada para o prato.",
      });
    }
    if (!dados.alvo.startsWith("insumo:") && !dados.alvo.startsWith("ficha:")) {
      ctx.addIssue({
        code: "custom",
        path: ["alvo"],
        message: "Escolha o insumo ou o preparo.",
      });
    }
  });

export type DadosItemDeFicha = z.infer<typeof esquemaItemDeFicha>;

/** Separa "insumo:abc" em { tipo, id }. */
export function lerAlvo(alvo: string) {
  const [tipo, ...resto] = alvo.split(":");
  const id = resto.join(":");
  if (tipo === "insumo") return { insumoId: id, subFichaId: null };
  return { insumoId: null, subFichaId: id };
}
