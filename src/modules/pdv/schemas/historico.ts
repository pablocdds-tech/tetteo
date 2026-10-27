import { z } from "zod";
import type { HistoricoFiltros } from "../historico-types";
import { ErroPdv } from "./erro";
import { diaPedidos, periodoPedidos } from "./pedido";

export const TAMANHO_PAGINA_HISTORICO = 10;
export const LIMITE_EXPORTACAO_HISTORICO = 5000;
export const esquemaHistorico = z
  .object({
    de: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    ate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    status: z
      .enum(["TODAS", "PENDENTE", "CONCLUIDA", "CANCELADA"])
      .default("TODAS"),
    modalidade: z
      .enum(["TODAS", "BALCAO", "RETIRADA", "ENTREGA"])
      .default("TODAS"),
    pagamento: z
      .enum(["TODOS", "DINHEIRO", "PIX", "CREDITO", "DEBITO"])
      .default("TODOS"),
    operadorId: z.string().trim().max(100).default(""),
    busca: z.string().trim().max(100).default(""),
    pagina: z.coerce.number().int().min(1).max(1_000_000).default(1),
  })
  .strict();
export function analisarHistorico(
  entrada: unknown = {},
  agora = new Date(),
): HistoricoFiltros {
  const d = esquemaHistorico.parse(entrada);
  const hoje = diaPedidos(agora);
  const de = d.de ?? hoje;
  const ate = d.ate ?? hoje;
  periodoPedidos(de);
  periodoPedidos(ate);
  if (de > ate)
    throw new ErroPdv("A data inicial não pode ser posterior à data final.");
  return { ...d, de, ate };
}
/** Escape para contains do PostgreSQL: %, _ e barra são caracteres literais na busca. */
export function buscaLiteral(texto: string) {
  return texto.replace(/[\\%_]/g, "\\$&");
}
export function numeroBuscado(busca: string): number | null {
  if (!/^#?\d{1,10}$/.test(busca)) return null;
  const numero = Number(busca.replace(/^#/, ""));
  return Number.isSafeInteger(numero) && numero > 0 && numero <= 2_147_483_647
    ? numero
    : null;
}
/** Strings são sempre citadas; prefixo impede fórmulas ao abrir no Excel. */
export function celulaCsvHistorico(valor: unknown): string {
  const texto = String(valor ?? "");
  const seguro = /^[\s\u0000-\u001f]*[=+@-]/u.test(texto) ? "'" + texto : texto;
  return '"' + seguro.replaceAll('"', '""') + '"';
}
