"use server";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { obterContexto } from "@/core/sessao/contexto";
import { ExigeUnidade, SemPermissao } from "@/lib/erros";
import type { ResultadoAgendamento } from "./agendamento-types";
import { ErroPdv } from "./schemas/erro";
import {
  listarAgendamentos,
  reagendarPedido,
  iniciarAgendado,
} from "./services/agendamentos";
async function executar(
  operacao: (
    ctx: NonNullable<Awaited<ReturnType<typeof obterContexto>>>,
  ) => Promise<ResultadoAgendamento>,
  escrita = false,
): Promise<ResultadoAgendamento> {
  const ctx = await obterContexto();
  if (!ctx) return { erro: "Sua sessão expirou. Entre novamente." };
  let resultado: ResultadoAgendamento;
  try {
    resultado = await operacao(ctx);
  } catch (e) {
    if (
      e instanceof ErroPdv ||
      e instanceof SemPermissao ||
      e instanceof ExigeUnidade
    )
      return { erro: e.message };
    if (e instanceof ZodError)
      return { erro: "Confira as datas, o horário e o motivo do agendamento." };
    throw new Error(
      "Não foi possível confirmar a operação. Atualize ou repita a mesma tentativa.",
    );
  }
  if (escrita) revalidatePath("/pdv", "layout");
  return resultado;
}
export async function listarAgendamentosAcao(
  dados: unknown = {},
): Promise<ResultadoAgendamento> {
  return executar(async (ctx) => ({
    pagina: await listarAgendamentos(ctx, dados),
  }));
}
export async function reagendarPedidoAcao(
  dados: unknown,
): Promise<ResultadoAgendamento> {
  return executar(
    async (ctx) => ({
      ok: "Agendamento atualizado.",
      pedido: await reagendarPedido(ctx, dados),
    }),
    true,
  );
}
export async function iniciarAgendadoAcao(
  dados: unknown,
): Promise<ResultadoAgendamento> {
  return executar(
    async (ctx) => ({
      ok: "Preparo iniciado.",
      pedido: await iniciarAgendado(ctx, dados),
    }),
    true,
  );
}
