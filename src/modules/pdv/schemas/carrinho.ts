import { z } from "zod";
import type { ConteudoCarrinho } from "../carrinho-types";
import type { ProdutoPdv } from "../types";
import { calcularPrecoItem } from "./venda";
import { ErroPdv } from "./erro";

const identificador = z.string().trim().min(1).max(100);
export const esquemaConteudoCarrinho = z
  .object({
    clienteId: identificador.optional(),
    modalidade: z.enum(["RETIRADA", "BALCAO"]),
    observacao: z.string().trim().max(500),
    itens: z
      .array(
        z
          .object({
            produtoId: identificador,
            quantidade: z.number().int().min(1).max(1000),
            opcoes: z.array(identificador).max(200),
            observacao: z.string().trim().max(140),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
export const esquemaSalvarCarrinho = z
  .object({
    id: z.string().uuid(),
    versao: z.number().int().min(0).max(2_000_000_000),
    nome: z.string().trim().max(80),
    conteudo: esquemaConteudoCarrinho,
  })
  .strict();
export const esquemaIdentificarCarrinho = z
  .object({ id: z.string().uuid() })
  .strict();
export const esquemaDescartarCarrinho = z
  .object({
    id: z.string().uuid(),
    versao: z.number().int().min(1).max(2_000_000_000),
  })
  .strict();

/** Nunca remove escolhas silenciosamente: o rascunho original continua preservado. */
export function atualizarConteudoCarrinho(
  conteudo: ConteudoCarrinho,
  produtos: ProdutoPdv[],
) {
  for (const item of conteudo.itens) {
    const produto = produtos.find((p) => p.id === item.produtoId);
    if (!produto)
      throw new ErroPdv(
        "Um produto deste carrinho está indisponível. O rascunho foi preservado; confira o cadastro ou monte uma nova venda.",
      );
    try {
      calcularPrecoItem(produto, item.opcoes);
    } catch {
      throw new ErroPdv(
        `As opções de ${produto.nome} mudaram. O rascunho foi preservado; confira o cadastro ou monte uma nova venda.`,
      );
    }
  }
  return {
    conteudo,
    avisos: [
      "Preços atualizados pelo catálogo atual. Confira o total e registre os pagamentos novamente.",
    ],
  };
}
