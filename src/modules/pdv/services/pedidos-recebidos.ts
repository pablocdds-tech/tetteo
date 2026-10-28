import { db } from "@/server/db";
import { EVENTO_PEDIDO_RECEBIDO } from "@/server/pedidos-recebidos";
import { esquemaPedidoRecebido } from "@/lib/pedido-recebido";
import type { EscopoPdv } from "./escopo";

/** O PDV consome fatos; o conector nunca grava pedidos ou vendas do módulo. */
export async function processarPedidosRecebidos(escopo?: EscopoPdv) {
  const pendentes = await db.entregaEvento.findMany({
    where: {
      appDestino: "pdv",
      status: "PENDENTE",
      evento: {
        ...escopo,
        tipo: EVENTO_PEDIDO_RECEBIDO,
        unidade: {
          ativa: true,
          excluidoEm: null,
          organizacao: { ativa: true, excluidoEm: null },
        },
      },
    },
    orderBy: [{ criadoEm: "asc" }, { id: "asc" }],
    take: 100,
    select: {
      id: true,
      evento: { select: { organizacaoId: true, unidadeId: true } },
    },
  });
  let quantidade = 0;
  for (const candidato of pendentes) {
    const e = {
      organizacaoId: candidato.evento.organizacaoId,
      unidadeId: candidato.evento.unidadeId!,
    };
    try {
      quantidade += await db.$transaction(
        async (tx) => {
          // É a mesma trava usada pelo caixa ao reservar o próximo número.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`pdv:${e.organizacaoId}:${e.unidadeId}`},0))`;
          const entrega = await tx.entregaEvento.findFirst({
            where: {
              id: candidato.id,
              appDestino: "pdv",
              status: "PENDENTE",
              evento: {
                ...e,
                tipo: EVENTO_PEDIDO_RECEBIDO,
                unidade: {
                  ativa: true,
                  excluidoEm: null,
                  organizacao: { ativa: true, excluidoEm: null },
                },
              },
            },
            include: { evento: true },
          });
          if (!entrega) return 0;
          const id = (entrega.evento.dados as Record<string, unknown>)
            ?.pedidoRecebidoId;
          if (typeof id !== "string")
            throw new Error("Evento de pedido inválido.");
          const recebido = await tx.pedidoRecebido.findFirst({
            where: { ...e, id },
          });
          if (!recebido)
            throw new Error("Pedido recebido indisponível nesta unidade.");
          const dados = esquemaPedidoRecebido.parse(recebido.conteudo);
          const anterior = await tx.pdvPedido.findFirst({
            where: { ...e, recebidoId: id },
          });
          if (
            !anterior ||
            !anterior.revisaoOrigemEm ||
            recebido.atualizadoNaOrigemEm > anterior.revisaoOrigemEm
          ) {
            const agenda = dados.agendadoPara
              ? new Date(dados.agendadoPara)
              : null;
            const atualizacao = {
              status:
                dados.etapa === "AGENDADO" && !agenda ? "COZINHA" : dados.etapa,
              revisaoOrigemEm: recebido.atualizadoNaOrigemEm,
              agendadoPara: dados.agendadoPara
                ? new Date(dados.agendadoPara)
                : null,
              // O preparo de pedidos externos é confirmado pela origem.
              iniciarPreparoEm: agenda,
              antecedenciaMinutos: agenda ? 0 : null,
              ...(dados.etapa === "AGUARDANDO_COLETA"
                ? { prontoEm: recebido.atualizadoNaOrigemEm }
                : {}),
              ...(dados.etapa === "SAIU_ENTREGA"
                ? { saiuEntregaEm: recebido.atualizadoNaOrigemEm }
                : {}),
              ...(dados.etapa === "ENTREGUE"
                ? { entregueEm: recebido.atualizadoNaOrigemEm }
                : {}),
              ...(dados.etapa === "CANCELADO"
                ? { canceladoEm: recebido.atualizadoNaOrigemEm }
                : {}),
            };
            const numero =
              anterior?.numero ??
              ((
                await tx.pdvPedido.aggregate({
                  where: e,
                  _max: { numero: true },
                })
              )._max.numero ?? 0) + 1;
            const evento = {
              de: anterior?.status ?? null,
              para: atualizacao.status,
              versao: (anterior?.versao ?? 0) + 1,
              operador: "Integração",
              observacao: "Pedido atualizado pela origem",
            };
            const pedido = anterior
              ? await tx.pdvPedido.update({
                  where: { id: anterior.id },
                  data: {
                    ...atualizacao,
                    versao: { increment: 1 },
                    eventos: { create: evento },
                  },
                })
              : await tx.pdvPedido.create({
                  data: {
                    ...e,
                    recebidoId: recebido.id,
                    numero,
                    ...atualizacao,
                    criadoEm: recebido.recebidoEm,
                    eventos: { create: evento },
                  },
                });
            await tx.auditoria.create({
              data: {
                ...e,
                entidade: "PdvPedido",
                entidadeId: pedido.id,
                acao: anterior ? "ALTEROU" : "CRIOU",
                valoresDepois: {
                  numero,
                  status: pedido.status,
                  origem: recebido.origem,
                  recebidoId: recebido.id,
                  versao: pedido.versao,
                },
              },
            });
          }
          await tx.entregaEvento.update({
            where: { id: entrega.id },
            data: {
              status: "PROCESSADO",
              processadoEm: new Date(),
              ultimoErro: null,
            },
          });
          return 1;
        },
        { timeout: 10_000 },
      );
    } catch {
      await db.entregaEvento.updateMany({
        where: { id: candidato.id, status: "PENDENTE" },
        data: {
          tentativas: { increment: 1 },
          ultimoErro: "Não foi possível atualizar o pedido no PDV.",
        },
      });
    }
  }
  return quantidade;
}

export function iniciarRelogioPedidosRecebidos() {
  if (
    process.env.NODE_ENV === "test" ||
    process.env.NEXT_PHASE === "phase-production-build"
  )
    return;
  const estado = globalThis as typeof globalThis & {
    pdvRecebidosTimer?: ReturnType<typeof setInterval>;
    pdvRecebidosOcupado?: boolean;
  };
  if (estado.pdvRecebidosTimer) return;
  const tick = async () => {
    if (estado.pdvRecebidosOcupado) return;
    estado.pdvRecebidosOcupado = true;
    try {
      await processarPedidosRecebidos();
    } catch {
      console.error("[pdv-recebidos] Fila temporariamente indisponível.");
    } finally {
      estado.pdvRecebidosOcupado = false;
    }
  };
  void tick();
  estado.pdvRecebidosTimer = setInterval(() => void tick(), 15_000);
  estado.pdvRecebidosTimer.unref();
}
