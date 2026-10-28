import type { ContextoSessao } from "@/core/sessao/nucleo";
import { listarPedidos } from "./pedidos";
import { quadroCozinha } from "../schemas/cozinha";

export async function carregarCozinha(ctx: ContextoSessao) {
  return quadroCozinha(await listarPedidos(ctx, { visao: "EM_ANDAMENTO" }));
}
