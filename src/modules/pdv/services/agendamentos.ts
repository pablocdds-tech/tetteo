import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { pode, type ContextoSessao } from "@/core/sessao/nucleo";
import { db } from "@/server/db";
import type { AgendamentoPdv, PaginaAgendamentos } from "../agendamento-types";
import type { EventoPedido } from "../pedido-types";
import { ErroPdv } from "../schemas/erro";
import {
  converterAgendamento,
  esquemaIniciarAgendado,
  esquemaListaAgendamentos,
  esquemaReagendarPedido,
} from "../schemas/agendamento";
import { periodoPedidos } from "../schemas/pedido";
import { esquemaEntregaSnapshot } from "../schemas/entrega";
import { exigirEscopo, type EscopoPdv } from "./escopo";
import { serializarVendaPdv } from "./venda-dto";
import { processarPedidosRecebidos } from "./pedidos-recebidos";
import { serializarPedidoExterno } from "./pedido-externo-dto";

const incluir = {
  recebido: true,
  venda: true,
  eventos: { orderBy: { versao: "asc" as const } },
} satisfies Prisma.PdvPedidoInclude;
type Pedido = Prisma.PdvPedidoGetPayload<{ include: typeof incluir }>;
type Tx = Prisma.TransactionClient;
const ativos = ["AGENDADO", "COZINHA", "AGUARDANDO_COLETA", "SAIU_ENTREGA"];
async function trava(tx: Tx, e: EscopoPdv) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`pdv:${e.organizacaoId}:${e.unidadeId}`},0))`;
}
function dto(p: Pedido, ctx: ContextoSessao): AgendamentoPdv {
  if (!p.agendadoPara || !p.iniciarPreparoEm || p.antecedenciaMinutos === null)
    throw new ErroPdv("Pedido sem agendamento disponível.");
  if (p.recebido) {
    const externo = serializarPedidoExterno(p, ctx);
    return {
      pedidoId: p.id,
      numero: p.numero,
      versao: p.versao,
      status: p.status as AgendamentoPdv["status"],
      agendadoPara: p.agendadoPara.toISOString(),
      iniciarPreparoEm: p.iniciarPreparoEm.toISOString(),
      preparoIniciadoEm: p.preparoIniciadoEm?.toISOString() ?? null,
      antecedenciaMinutos: p.antecedenciaMinutos,
      venda: externo.venda,
      origem: externo.origem,
      historico: externo.historico,
    };
  }
  if (!p.venda) throw new ErroPdv("Venda indisponível nesta unidade.");
  return {
    pedidoId: p.id,
    numero: p.numero,
    versao: p.versao,
    status: p.status as AgendamentoPdv["status"],
    agendadoPara: p.agendadoPara.toISOString(),
    iniciarPreparoEm: p.iniciarPreparoEm.toISOString(),
    preparoIniciadoEm: p.preparoIniciadoEm?.toISOString() ?? null,
    antecedenciaMinutos: p.antecedenciaMinutos,
    venda: serializarVendaPdv(p.venda, pode(ctx, "crm.ver")),
    historico: p.eventos.map((e) => ({
      id: e.id,
      de: e.de as EventoPedido["de"],
      para: e.para as EventoPedido["para"],
      versao: e.versao,
      operador: e.operador,
      observacao: e.observacao,
      criadoEm: e.criadoEm.toISOString(),
    })),
  };
}
export async function listarAgendamentos(
  ctx: ContextoSessao,
  entrada: unknown = {},
): Promise<PaginaAgendamentos> {
  const e = await exigirEscopo(ctx);
  await processarPedidosRecebidos(e);
  const dados = esquemaListaAgendamentos.parse(entrada);
  const agora = new Date();
  const base: Prisma.PdvPedidoWhereInput = {
    ...e,
    agendadoPara: {
      not: null,
      ...(dados.de ? { gte: periodoPedidos(dados.de).inicio } : {}),
      ...(dados.ate ? { lt: periodoPedidos(dados.ate).fim } : {}),
    },
  };
  const status =
    dados.estado === "EM_ABERTO"
      ? ativos
      : dados.estado === "AGUARDANDO"
        ? ["AGENDADO"]
        : dados.estado === "INICIADOS"
          ? ["COZINHA", "AGUARDANDO_COLETA", "SAIU_ENTREGA"]
          : dados.estado === "FINALIZADOS"
            ? ["ENTREGUE", "CANCELADO"]
            : null;
  return db.$transaction(
    async (tx) => {
      const where = { ...base, ...(status ? { status: { in: status } } : {}) };
      const totalRegistros = await tx.pdvPedido.count({ where });
      const totalPaginas = Math.max(1, Math.ceil(totalRegistros / 20));
      const pagina = Math.min(dados.pagina, totalPaginas);
      const [pedidos, aguardando, proximos, atrasados] = await Promise.all([
        tx.pdvPedido.findMany({
          where,
          include: incluir,
          orderBy: [{ agendadoPara: "asc" }, { id: "asc" }],
          skip: (pagina - 1) * 20,
          take: 20,
        }),
        tx.pdvPedido.count({ where: { ...base, status: "AGENDADO" } }),
        tx.pdvPedido.count({
          where: {
            ...base,
            status: "AGENDADO",
            iniciarPreparoEm: {
              gt: agora,
              lte: new Date(agora.getTime() + 30 * 60000),
            },
          },
        }),
        tx.pdvPedido.count({
          where: {
            ...base,
            status: { in: ativos },
            AND: [{ agendadoPara: { lt: agora } }],
          },
        }),
      ]);
      return {
        pedidos: pedidos.map((p) => dto(p, ctx)),
        filtros: { ...dados, pagina },
        totalRegistros,
        totalPaginas,
        tamanhoPagina: 20,
        resumo: { aguardando, proximos, atrasados },
        agora: agora.toISOString(),
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
async function auditar(
  tx: Tx,
  e: EscopoPdv,
  p: Pedido,
  usuarioId: string | null,
  antes: Prisma.InputJsonValue,
  depois: Prisma.InputJsonValue,
) {
  await tx.auditoria.create({
    data: {
      ...e,
      usuarioId,
      entidade: "PdvPedido",
      entidadeId: p.id,
      acao: "ALTEROU",
      valoresAntes: antes,
      valoresDepois: depois,
    },
  });
}
async function alterar(
  ctx: ContextoSessao,
  entrada: unknown,
  reagendar: boolean,
): Promise<AgendamentoPdv> {
  const e = await exigirEscopo(ctx, reagendar ? "pdv.vender" : "pdv.operar");
  const dados = reagendar
    ? esquemaReagendarPedido.parse(entrada)
    : esquemaIniciarAgendado.parse(entrada);
  const hash = createHash("sha256")
    .update(
      JSON.stringify({ tipo: reagendar ? "REAGENDAR" : "INICIAR", ...dados }),
    )
    .digest("hex");
  return db.$transaction(async (tx) => {
    await trava(tx, e);
    const anterior = await tx.pdvPedidoEvento.findUnique({
      where: { organizacaoId_unidadeId_chave: { ...e, chave: dados.chave } },
    });
    if (
      anterior &&
      (anterior.usuarioId !== ctx.usuario.id ||
        anterior.payloadHash !== hash ||
        anterior.pedidoId !== dados.pedidoId)
    )
      throw new ErroPdv(
        "Esta tentativa já foi usada com outros dados ou por outra pessoa.",
      );
    const p = await tx.pdvPedido.findFirst({
      where: { ...e, id: dados.pedidoId },
      include: incluir,
    });
    if (!p) throw new ErroPdv("Agendamento indisponível nesta unidade.");
    if (!p.vendaId || !p.venda || p.recebidoId)
      throw new ErroPdv(
        "Este agendamento é atualizado pela plataforma de origem.",
      );
    if (anterior) return dto(p, ctx);
    if (p.versao !== dados.versao)
      throw new ErroPdv(
        "Este pedido mudou em outra tela. Atualize os agendamentos.",
      );
    if (p.status !== "AGENDADO" || p.venda.status === "CANCELADA")
      throw new ErroPdv(
        "Apenas pedidos aguardando preparo podem ser alterados.",
      );
    const agora = new Date();
    const agenda = reagendar
      ? converterAgendamento(
          esquemaReagendarPedido.parse(dados).agendamento,
          agora,
        )
      : null;
    const status =
      agenda && agenda.iniciarPreparoEm > agora ? "AGENDADO" : "COZINHA";
    if (agenda && p.venda.entrega !== null) {
      const entrega = esquemaEntregaSnapshot.parse(p.venda.entrega);
      await tx.pdvVenda.update({
        where: { id: p.vendaId },
        data: {
          entrega: {
            ...entrega,
            previstoEm: agenda.agendadoPara.toISOString(),
          },
        },
      });
    }
    const atualizado = await tx.pdvPedido.update({
      where: { id: p.id },
      data: {
        ...(agenda ?? {}),
        status,
        preparoIniciadoEm: status === "COZINHA" ? agora : null,
        versao: { increment: 1 },
        eventos: {
          create: {
            de: p.status,
            para: status,
            versao: p.versao + 1,
            usuarioId: ctx.usuario.id,
            operador: ctx.usuario.nome,
            observacao: dados.motivo,
            chave: dados.chave,
            payloadHash: hash,
          },
        },
      },
      include: incluir,
    });
    await auditar(
      tx,
      e,
      p,
      ctx.usuario.id,
      {
        status: p.status,
        agendadoPara: p.agendadoPara?.toISOString() ?? null,
        iniciarPreparoEm: p.iniciarPreparoEm?.toISOString() ?? null,
      },
      {
        status,
        agendadoPara: atualizado.agendadoPara?.toISOString() ?? null,
        iniciarPreparoEm: atualizado.iniciarPreparoEm?.toISOString() ?? null,
        versao: atualizado.versao,
      },
    );
    return dto(atualizado, ctx);
  });
}
export const reagendarPedido = (ctx: ContextoSessao, entrada: unknown) =>
  alterar(ctx, entrada, true);
export const iniciarAgendado = (ctx: ContextoSessao, entrada: unknown) =>
  alterar(ctx, entrada, false);
export async function processarAgendamentosVencidos(
  escopo?: EscopoPdv,
  agora = new Date(),
): Promise<number> {
  if (!Number.isFinite(agora.getTime())) throw new ErroPdv("Horário inválido.");
  const unidades = await db.unidade.findMany({
    where: {
      ...(escopo
        ? { id: escopo.unidadeId, organizacaoId: escopo.organizacaoId }
        : {}),
      ativa: true,
      excluidoEm: null,
      organizacao: { ativa: true, excluidoEm: null },
    },
    select: { id: true },
  });
  if (!unidades.length) return 0;
  const candidatos = await db.pdvPedido.findMany({
    where: {
      ...escopo,
      unidadeId: { in: unidades.map((u) => u.id) },
      status: "AGENDADO",
      iniciarPreparoEm: { lte: agora },
      venda: { status: { not: "CANCELADA" } },
    },
    orderBy: [{ iniciarPreparoEm: "asc" }, { id: "asc" }],
    take: 100,
    select: { id: true, organizacaoId: true, unidadeId: true },
  });
  let quantidade = 0;
  for (const c of candidatos)
    quantidade += await db.$transaction(async (tx) => {
      const e = { organizacaoId: c.organizacaoId, unidadeId: c.unidadeId };
      await trava(tx, e);
      const unidade = await tx.unidade.findFirst({
        where: {
          id: e.unidadeId,
          organizacaoId: e.organizacaoId,
          ativa: true,
          excluidoEm: null,
          organizacao: { ativa: true, excluidoEm: null },
        },
        select: { id: true },
      });
      if (!unidade) return 0;
      const p = await tx.pdvPedido.findFirst({
        where: {
          ...e,
          id: c.id,
          status: "AGENDADO",
          iniciarPreparoEm: { lte: agora },
          venda: { status: { not: "CANCELADA" } },
        },
        include: incluir,
      });
      if (!p) return 0;
      await tx.pdvPedido.update({
        where: { id: p.id },
        data: {
          status: "COZINHA",
          preparoIniciadoEm: agora,
          versao: { increment: 1 },
          eventos: {
            create: {
              de: "AGENDADO",
              para: "COZINHA",
              versao: p.versao + 1,
              usuarioId: null,
              operador: "Sistema",
              observacao: "Horário de preparo atingido",
              criadoEm: agora,
            },
          },
        },
      });
      await auditar(
        tx,
        e,
        p,
        null,
        { status: "AGENDADO" },
        {
          status: "COZINHA",
          preparoIniciadoEm: agora.toISOString(),
          versao: p.versao + 1,
        },
      );
      return 1;
    });
  return quantidade;
}
