"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { obterContexto } from "@/core/sessao/contexto";
import { ExigeUnidade, SemPermissao } from "@/lib/erros";
import { ErroPdv } from "./schemas/erro";
import type { ResultadoPdv } from "./types";
import {
  abrirCaixa,
  cancelarVenda,
  fecharCaixa,
  finalizarVenda,
  movimentarCaixa,
  salvarComplementos,
} from "./services/pdv";

async function executar(
  operacao: (
    ctx: NonNullable<Awaited<ReturnType<typeof obterContexto>>>,
  ) => Promise<unknown>,
  mensagem: string,
  venda = false,
): Promise<ResultadoPdv> {
  const ctx = await obterContexto();
  if (!ctx)
    return { erro: "Sua sessão expirou. Entre novamente para continuar." };
  let resultado: unknown;
  try {
    resultado = await operacao(ctx);
  } catch (erro) {
    if (erro instanceof ZodError)
      return {
        erro: "Confira os valores, quantidades e campos obrigatórios informados.",
      };
    if (erro instanceof Prisma.PrismaClientKnownRequestError) {
      if (erro.code === "P2002")
        return {
          erro: "Este código já está em uso ou o caixa já foi aberto. Atualize a tela.",
        };
      // Não declarar rejeição de uma escrita quando a confirmação da conexão é incerta.
      throw new Error(
        "Não foi possível confirmar a operação. Atualize ou tente novamente com a mesma tentativa.",
      );
    }
    if (
      erro instanceof ErroPdv ||
      erro instanceof SemPermissao ||
      erro instanceof ExigeUnidade
    )
      return { erro: erro.message };
    throw new Error(
      "Não foi possível confirmar a operação. Tente novamente com a mesma tentativa.",
    );
  }
  // Fora do catch: falha de atualização após COMMIT não pode virar rejeição da venda.
  revalidatePath("/pdv", "layout");
  revalidatePath("/estoque");
  return {
    ok: mensagem,
    ...(venda && typeof resultado === "string" ? { vendaId: resultado } : {}),
  };
}
export async function abrirCaixaAcao(dados: unknown): Promise<ResultadoPdv> {
  return executar((ctx) => abrirCaixa(ctx, dados), "Caixa aberto.");
}
export async function movimentarCaixaAcao(
  dados: unknown,
): Promise<ResultadoPdv> {
  return executar(
    (ctx) => movimentarCaixa(ctx, dados),
    "Movimentação registrada.",
  );
}
export async function fecharCaixaAcao(dados: unknown): Promise<ResultadoPdv> {
  return executar(
    (ctx) => fecharCaixa(ctx, dados),
    "Caixa fechado e conferência registrada.",
  );
}
export async function salvarComplementosAcao(
  dados: unknown,
): Promise<ResultadoPdv> {
  return executar(
    (ctx) => salvarComplementos(ctx, dados),
    "Configuração do produto salva.",
  );
}
export async function finalizarVendaAcao(
  dados: unknown,
): Promise<ResultadoPdv> {
  return executar(
    (ctx) => finalizarVenda(ctx, dados),
    "Venda concluída.",
    true,
  );
}
export async function cancelarVendaAcao(dados: unknown): Promise<ResultadoPdv> {
  return executar(
    (ctx) => cancelarVenda(ctx, dados),
    "Venda cancelada e estoque estornado. Faça a devolução do pagamento ao cliente.",
  );
}
