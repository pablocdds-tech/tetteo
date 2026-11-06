import { z } from "zod";
import { pode } from "@/core/sessao/nucleo";
export const permissoesParaNotas = [
  "assistente.ver",
  "estoque.lancar",
  "financeiro.ver",
  "financeiro.lancar",
] as const;
export const alteracaoAutorizacaoNota = z
  .object({
    vinculoId: z.string().min(1).max(128),
    unidadeId: z.string().min(1).max(128),
    usuarioId: z.string().min(1).max(128),
    telefone: z.string().regex(/^\d{10,15}$/),
    autorizar: z.boolean(),
    versao: z.number().int().nonnegative(),
  })
  .strict();
export function temPermissoesParaNotas(permissoes: Set<string>) {
  return permissoesParaNotas.every((p) => pode({ permissoes }, p));
}
