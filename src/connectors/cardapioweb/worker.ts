import { randomUUID } from "node:crypto";
import type { CardapioWebRecebimento, Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { ClienteCw } from "./client";
import { configApiCw, ErroCw, type AmbienteCw } from "./config";
import { auditarRecebimentoCw, contextoLegadoCw } from "./recebimento";
import { decifrarCw, hashCw } from "./seguranca";

type Concessao = CardapioWebRecebimento & { dono: string };
async function conferirConcessao(tx: Prisma.TransactionClient, row: Concessao) {
  const valida = await tx.cardapioWebRecebimento.updateMany({
    where: {
      id: row.id,
      ativo: true,
      revisao: row.revisao,
      concessaoDono: row.dono,
      concessaoAte: { gt: new Date() },
      unidade: {
        ativa: true,
        excluidoEm: null,
        organizacao: { ativa: true, excluidoEm: null },
      },
    },
    data: { concessaoAte: new Date(Date.now() + 45_000) },
  });
  if (!valida.count)
    throw new ErroCw(
      "concessao",
      "O processamento foi interrompido porque a conexão mudou.",
    );
}
export async function processarRecebimentoCw(id: string) {
  const dono = randomUUID();
  const reservada = await db.cardapioWebRecebimento.updateMany({
    where: {
      id,
      ativo: true,
      apiKeyCifrada: { not: null },
      OR: [{ concessaoAte: null }, { concessaoAte: { lt: new Date() } }],
      unidade: {
        ativa: true,
        excluidoEm: null,
        organizacao: { ativa: true, excluidoEm: null },
      },
    },
    data: { concessaoDono: dono, concessaoAte: new Date(Date.now() + 45_000) },
  });
  if (!reservada.count) return;
  const registro = await db.cardapioWebRecebimento.findUniqueOrThrow({
    where: { id },
  });
  const row: Concessao = { ...registro, dono };
  try {
    const client = new ClienteCw(
      configApiCw(row.ambiente as AmbienteCw),
      fetch,
      "api-key",
    );
    const token = decifrarCw(
      row.apiKeyCifrada!,
      contextoLegadoCw(row, row.ambiente, row.merchantId),
    );
    const pendentes = await db.cardapioWebEvento.findMany({
      where: {
        recebimentoId: id,
        estado: "PENDENTE",
        proximaTentativaEm: { lte: new Date() },
      },
      orderBy: { recebidoEm: "asc" },
      take: 3,
    });
    for (const evento of pendentes) {
      try {
        const pedido = await client.pedido(token, evento.orderId);
        if (
          pedido.merchant_id !== row.merchantId ||
          pedido.id !== evento.orderId
        )
          throw new ErroCw(
            "identidade",
            "A identidade do pedido não corresponde à loja vinculada.",
          );
        await db.$transaction(async (tx) => {
          await conferirConcessao(tx, row);
          const atual = await tx.cardapioWebPedido.findUnique({
            where: {
              recebimentoId_orderId: { recebimentoId: id, orderId: pedido.id },
            },
          });
          const revisaoRemota = new Date(pedido.updated_at);
          // O evento pode ser antigo. Só o detalhe atual e sua revisão alteram a projeção.
          if (!atual || revisaoRemota >= atual.atualizadoNoProvedorEm) {
            const dados = {
              estado: pedido.status,
              displayId:
                pedido.display_id == null ? null : String(pedido.display_id),
              modalidade: pedido.order_type,
              canal: pedido.sales_channel,
              totalCentavos: BigInt(pedido.total),
              criadoNoProvedorEm: new Date(pedido.created_at),
              atualizadoNoProvedorEm: revisaoRemota,
              conferidoEm: new Date(),
            };
            await tx.cardapioWebPedido.upsert({
              where: {
                recebimentoId_orderId: {
                  recebimentoId: id,
                  orderId: pedido.id,
                },
              },
              create: {
                organizacaoId: row.organizacaoId,
                unidadeId: row.unidadeId,
                recebimentoId: id,
                orderId: pedido.id,
                ...dados,
              },
              update: dados,
            });
          }
          await tx.cardapioWebEvento.update({
            where: { id: evento.id },
            data: {
              estado: "PROCESSADO",
              processadoEm: new Date(),
              ultimoErro: null,
            },
          });
          await auditarRecebimentoCw(tx, row, evento.id, "PEDIDO_CONFERIDO");
        });
      } catch (erro) {
        if (
          erro instanceof ErroCw &&
          ["concessao", "reconectar", "identidade", "limite"].includes(
            erro.codigo,
          )
        )
          throw erro;
        const codigo = erro instanceof ErroCw ? erro.codigo : "interno";
        await db.$transaction(async (tx) => {
          await conferirConcessao(tx, row);
          await tx.cardapioWebEvento.update({
            where: { id: evento.id },
            data: {
              tentativas: { increment: 1 },
              ultimoErro: codigo,
              proximaTentativaEm: new Date(
                Date.now() +
                  Math.min(
                    1_800_000,
                    30_000 * 2 ** Math.min(evento.tentativas, 6),
                  ),
              ),
            },
          });
        });
      }
    }
    if (
      !row.tentativaReconciliacaoEm ||
      row.tentativaReconciliacaoEm.getTime() < Date.now() - 60_000
    ) {
      const inicio = new Date();
      const cursor =
        row.cursor && row.cursor.getTime() > Date.now() - 23 * 3_600_000
          ? new Date(row.cursor.getTime() - 120_000)
          : undefined;
      await db.$transaction(async (tx) => {
        await conferirConcessao(tx, row);
        await tx.cardapioWebRecebimento.update({
          where: { id },
          data: { tentativaReconciliacaoEm: inicio },
        });
      });
      const pedidos = await client.pedidos(token, cursor);
      await db.$transaction(
        async (tx) => {
          await conferirConcessao(tx, row);
          for (let i = 0; i < pedidos.length; i += 300) {
            await tx.cardapioWebEvento.createMany({
              skipDuplicates: true,
              data: pedidos.slice(i, i + 300).map((pedido) => ({
                organizacaoId: row.organizacaoId,
                unidadeId: row.unidadeId,
                recebimentoId: id,
                eventId: `poll:${hashCw(`${pedido.id}:${pedido.updated_at}`)}`,
                origem: "POLLING",
                tipo: "RECONCILIACAO",
                orderId: pedido.id,
                statusInformado: pedido.status,
                ocorridoEm: new Date(pedido.updated_at),
              })),
            });
          }
          await tx.cardapioWebRecebimento.update({
            where: { id },
            data: {
              cursor: inicio,
              ultimaReconciliacaoEm: new Date(),
              ultimoErro: null,
            },
          });
        },
        { timeout: 10_000 },
      );
    }
  } catch (erro) {
    const codigo = erro instanceof ErroCw ? erro.codigo : "interno";
    await db.cardapioWebRecebimento.updateMany({
      where: { id, concessaoDono: dono, revisao: row.revisao },
      data: {
        ultimoErro: codigo,
        ...(codigo === "reconectar" || codigo === "identidade"
          ? { ativo: false, apiKeyCifrada: null, webhookTokenHash: null }
          : {}),
        // 429 e falhas gerais não disparam uma tempestade de consultas.
        tentativaReconciliacaoEm: new Date(),
        concessaoAte: new Date(
          Date.now() + (codigo === "limite" ? 180_000 : 30_000),
        ),
      },
    });
  } finally {
    // Uma pausa por erro permanece até o prazo; uma passagem normal libera a concessão.
    await db.cardapioWebRecebimento.updateMany({
      where: {
        id,
        concessaoDono: dono,
        revisao: row.revisao,
        ultimoErro: null,
      },
      data: { concessaoDono: null, concessaoAte: null },
    });
  }
}

export async function executarFilaCw() {
  const linhas = await db.cardapioWebRecebimento.findMany({
    where: {
      ativo: true,
      apiKeyCifrada: { not: null },
      OR: [{ concessaoAte: null }, { concessaoAte: { lt: new Date() } }],
    },
    select: { id: true },
    orderBy: { tentativaReconciliacaoEm: { sort: "asc", nulls: "first" } },
    take: 5,
  });
  for (const row of linhas) await processarRecebimentoCw(row.id);
}

export function iniciarWorkerCw() {
  if (
    process.env.NODE_ENV === "test" ||
    process.env.CARDAPIOWEB_WORKER_ENABLED === "false"
  )
    return;
  const globalWorker = globalThis as typeof globalThis & {
    cwWorker?: ReturnType<typeof setInterval>;
    cwOcupado?: boolean;
  };
  if (globalWorker.cwWorker) return;
  globalWorker.cwWorker = setInterval(() => {
    if (globalWorker.cwOcupado) return;
    globalWorker.cwOcupado = true;
    void executarFilaCw()
      .catch(() =>
        console.error("[cardapioweb] Fila temporariamente indisponível."),
      )
      .finally(() => {
        globalWorker.cwOcupado = false;
      });
  }, 15_000);
  globalWorker.cwWorker.unref();
}
