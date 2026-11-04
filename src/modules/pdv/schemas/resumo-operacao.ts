import type { EscopoPdv } from "../services/escopo";
import { diaPedidos, periodoPedidos } from "./pedido";

export const ETAPAS_AO_VIVO = [
  "COZINHA",
  "AGUARDANDO_COLETA",
  "SAIU_ENTREGA",
] as const;

/** Sete dias civis de Brasília, incluindo o dia em andamento. */
export function janelaDaOperacao(agora = new Date()) {
  const hoje = diaPedidos(agora);
  const inicioSemana = new Date(`${hoje}T12:00:00Z`);
  inicioSemana.setUTCDate(inicioSemana.getUTCDate() - 6);
  const de = inicioSemana.toISOString().slice(0, 10);
  return {
    hoje,
    de,
    inicioHoje: periodoPedidos(hoje).inicio,
    inicioSemana: periodoPedidos(de).inicio,
    // Evita incluir registros com data futura, mesmo dentro do dia atual.
    ate: agora,
  };
}

export function filtrosDaOperacao(escopo: EscopoPdv, agora = new Date()) {
  const janela = janelaDaOperacao(agora);
  return {
    janela,
    vendasHoje: {
      ...escopo,
      status: "CONCLUIDA" as const,
      criadaEm: { gte: janela.inicioHoje, lte: janela.ate },
    },
    vendasSemana: {
      ...escopo,
      status: "CONCLUIDA" as const,
      criadaEm: { gte: janela.inicioSemana, lte: janela.ate },
    },
    pedidosSemana: {
      ...escopo,
      status: { not: "CANCELADO" as const },
      OR: [
        {
          venda: {
            criadaEm: { gte: janela.inicioSemana, lte: janela.ate },
          },
        },
        {
          vendaId: null,
          recebido: {
            criadoNaOrigemEm: { gte: janela.inicioSemana, lte: janela.ate },
          },
        },
      ],
    },
    aoVivo: { ...escopo, status: { in: [...ETAPAS_AO_VIVO] } },
  };
}
