import { z } from "zod";

import { lerDataLocal } from "@/lib/data";
import { numeroBr } from "@/lib/numero";

/** A validação das saídas e transferências. */

export const TIPOS_DE_SAIDA = [
  { valor: "PERDA", rotulo: "Perda — vencido, estragado, queimado" },
  { valor: "QUEBRA", rotulo: "Quebra — caiu, derramou, quebrou" },
  {
    valor: "CONSUMO_INTERNO",
    rotulo: "Consumo interno — refeição, degustação",
  },
  { valor: "DOACAO", rotulo: "Doação" },
] as const;

export const esquemaSaida = z
  .object({
    insumoId: z.string().trim().min(1, "Escolha o insumo."),
    localId: z.string().trim().min(1, "Escolha de qual lugar saiu."),
    tipo: z.enum(["PERDA", "QUEBRA", "CONSUMO_INTERNO", "DOACAO"], {
      message: "Escolha o que aconteceu.",
    }),
    quantidade: numeroBr("a quantidade"),
    motivo: z
      .string()
      .trim()
      .max(200, "O motivo está longo demais.")
      .optional()
      .transform((v) => v || null),
    ocorridoEm: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v ? lerDataLocal(v) : null)),
  })
  .superRefine((dados, ctx) => {
    if (dados.quantidade <= 0) {
      ctx.addIssue({
        code: "custom",
        path: ["quantidade"],
        message: "A quantidade precisa ser maior que zero.",
      });
    }
  });

export const esquemaTransferencia = z
  .object({
    insumoId: z.string().trim().min(1, "Escolha o insumo."),
    localId: z.string().trim().min(1, "Escolha a origem."),
    localDestinoId: z.string().trim().min(1, "Escolha o destino."),
    quantidade: numeroBr("a quantidade"),
    motivo: z
      .string()
      .trim()
      .max(200)
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
    if (dados.localId === dados.localDestinoId) {
      ctx.addIssue({
        code: "custom",
        path: ["localDestinoId"],
        message: "O destino precisa ser diferente da origem.",
      });
    }
  });
