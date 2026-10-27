import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { pode, type ContextoSessao } from "@/core/sessao/nucleo";
import { SemPermissao } from "@/lib/erros";
import { db } from "@/server/db";
import type {
  AreaEntrega,
  Entregador,
  EntregaSnapshot,
  UfEntrega,
} from "../entrega-types";
import { ErroPdv } from "../schemas/erro";
import {
  conferirAreaEntrega,
  esquemaAreaEntrega,
  esquemaAtribuirEntregador,
  esquemaEntregador,
  esquemaEntregaEntrada,
  LIMITE_CADASTROS_ENTREGA,
  normalizarEntrega,
} from "../schemas/entrega";
import { exigirEscopo, type EscopoPdv } from "./escopo";

type Transacao = Prisma.TransactionClient;
function hash(valor: unknown) {
  return createHash("sha256").update(JSON.stringify(valor)).digest("hex");
}
async function travar(tx: Transacao, escopo: EscopoPdv) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`pdv:${escopo.organizacaoId}:${escopo.unidadeId}`},0))`;
}
function comoArea(a: Prisma.PdvAreaEntregaGetPayload<object>): AreaEntrega {
  return {
    id: a.id,
    versao: a.versao,
    nome: a.nome,
    cidade: a.cidade,
    uf: a.uf as UfEntrega,
    bairros: a.bairros as string[],
    freteCentavos: a.freteCentavos,
    prazoMinutos: a.prazoMinutos,
    ativa: a.ativa,
    atualizadoEm: a.atualizadoEm.toISOString(),
  };
}
function comoEntregador(e: Prisma.PdvEntregadorGetPayload<object>): Entregador {
  return {
    id: e.id,
    versao: e.versao,
    nome: e.nome,
    telefone: e.telefone,
    ativo: e.ativo,
    atualizadoEm: e.atualizadoEm.toISOString(),
  };
}
async function auditar(
  tx: Transacao,
  ctx: ContextoSessao,
  escopo: EscopoPdv,
  entidade: string,
  id: string,
  antes: Prisma.InputJsonValue | null,
  depois: Prisma.InputJsonValue,
) {
  // Nenhum endereço, telefone, destinatário ou texto livre de atendimento vai ao log.
  await tx.auditoria.create({
    data: {
      ...escopo,
      usuarioId: ctx.usuario.id,
      entidade,
      entidadeId: id,
      acao: antes ? "ALTEROU" : "CRIOU",
      valoresAntes: antes ?? Prisma.JsonNull,
      valoresDepois: depois,
    },
  });
}
export async function listarAreasEntrega(
  ctx: ContextoSessao,
  incluirInativas = false,
): Promise<AreaEntrega[]> {
  const escopo = await exigirEscopo(ctx);
  if (
    !pode(ctx, "pdv.vender") &&
    !pode(ctx, "pdv.entrega") &&
    !pode(ctx, "pdv.configurar")
  )
    throw new SemPermissao("consultar áreas de entrega");
  if (typeof incluirInativas !== "boolean")
    throw new ErroPdv("Informe se deseja incluir áreas inativas.");
  const areas = await db.pdvAreaEntrega.findMany({
    where: { ...escopo, ...(!incluirInativas ? { ativa: true } : {}) },
    orderBy: [{ ativa: "desc" }, { nome: "asc" }],
  });
  return areas.map(comoArea);
}
export async function salvarAreaEntrega(
  ctx: ContextoSessao,
  entrada: unknown,
): Promise<AreaEntrega> {
  const escopo = await exigirEscopo(ctx, "pdv.configurar");
  const dados = esquemaAreaEntrega.parse(entrada);
  const { id, versao, ...conteudo } = dados;
  const ultimoHash = hash(conteudo);
  return db.$transaction(async (tx) => {
    await travar(tx, escopo);
    const antes = await tx.pdvAreaEntrega.findFirst({
      where: { ...escopo, id },
    });
    if (antes) {
      if (antes.versao === versao + 1 && antes.ultimoHash === ultimoHash)
        return comoArea(antes);
      if (antes.versao !== versao)
        throw new ErroPdv(
          "Esta área mudou em outra tela. Atualize a lista antes de salvar.",
        );
    } else {
      if (versao !== 0) throw new ErroPdv("Área indisponível nesta unidade.");
      if (
        (await tx.pdvAreaEntrega.count({ where: escopo })) >=
        LIMITE_CADASTROS_ENTREGA
      )
        throw new ErroPdv(
          `O limite é de ${LIMITE_CADASTROS_ENTREGA} áreas por unidade. Reutilize ou edite um cadastro existente.`,
        );
    }
    const nomeChave = normalizarEntrega(dados.nome);
    if (
      await tx.pdvAreaEntrega.findFirst({
        where: { ...escopo, nomeChave, id: { not: id } },
        select: { id: true },
      })
    )
      throw new ErroPdv("Já existe uma área com este nome nesta unidade.");
    const salva = antes
      ? await tx.pdvAreaEntrega.update({
          where: { id },
          data: {
            ...conteudo,
            nomeChave,
            ultimoHash,
            versao: { increment: 1 },
          },
        })
      : await tx.pdvAreaEntrega.create({
          data: { ...escopo, id, ...conteudo, nomeChave, ultimoHash },
        });
    await auditar(
      tx,
      ctx,
      escopo,
      "PdvAreaEntrega",
      id,
      antes ? { versao: antes.versao, ativa: antes.ativa } : null,
      {
        versao: salva.versao,
        ativa: salva.ativa,
        freteCentavos: salva.freteCentavos,
        prazoMinutos: salva.prazoMinutos,
        quantidadeBairros: dados.bairros.length,
      },
    );
    return comoArea(salva);
  });
}
export async function listarEntregadores(
  ctx: ContextoSessao,
): Promise<Entregador[]> {
  const escopo = await exigirEscopo(ctx, "pdv.entrega");
  const entregadores = await db.pdvEntregador.findMany({
    where: escopo,
    orderBy: [{ ativo: "desc" }, { nome: "asc" }],
  });
  return entregadores.map(comoEntregador);
}
export async function salvarEntregador(
  ctx: ContextoSessao,
  entrada: unknown,
): Promise<Entregador> {
  const escopo = await exigirEscopo(ctx, "pdv.entrega");
  const dados = esquemaEntregador.parse(entrada);
  const { id, versao, ...conteudo } = dados;
  const ultimoHash = hash(conteudo);
  return db.$transaction(async (tx) => {
    await travar(tx, escopo);
    const antes = await tx.pdvEntregador.findFirst({
      where: { ...escopo, id },
    });
    if (antes) {
      if (antes.versao === versao + 1 && antes.ultimoHash === ultimoHash)
        return comoEntregador(antes);
      if (antes.versao !== versao)
        throw new ErroPdv(
          "Este entregador mudou em outra tela. Atualize a lista antes de salvar.",
        );
    } else {
      if (versao !== 0)
        throw new ErroPdv("Entregador indisponível nesta unidade.");
      if (
        (await tx.pdvEntregador.count({ where: escopo })) >=
        LIMITE_CADASTROS_ENTREGA
      )
        throw new ErroPdv(
          `O limite é de ${LIMITE_CADASTROS_ENTREGA} entregadores por unidade. Reutilize ou edite um cadastro existente.`,
        );
    }
    const salvo = antes
      ? await tx.pdvEntregador.update({
          where: { id },
          data: { ...conteudo, ultimoHash, versao: { increment: 1 } },
        })
      : await tx.pdvEntregador.create({
          data: { ...escopo, id, ...conteudo, ultimoHash },
        });
    await auditar(
      tx,
      ctx,
      escopo,
      "PdvEntregador",
      id,
      antes ? { versao: antes.versao, ativo: antes.ativo } : null,
      { versao: salvo.versao, ativo: salvo.ativo },
    );
    return comoEntregador(salvo);
  });
}
/** Chamada dentro da transação da venda, depois da autenticação e trava da unidade. */
export async function prepararEntrega(
  tx: Transacao,
  ctx: ContextoSessao,
  escopo: EscopoPdv,
  entrada: unknown,
  agora = new Date(),
): Promise<EntregaSnapshot> {
  if (
    !pode(ctx, "pdv.ver") ||
    !pode(ctx, "pdv.vender") ||
    ctx.organizacao.id !== escopo.organizacaoId ||
    ctx.unidadeAtiva?.id !== escopo.unidadeId ||
    !ctx.unidadesVisiveis.some((u) => u.id === escopo.unidadeId)
  )
    throw new SemPermissao("registrar entrega nesta unidade");
  const dados = esquemaEntregaEntrada.parse(entrada);
  if (
    !(await tx.unidade.findFirst({
      where: {
        id: escopo.unidadeId,
        organizacaoId: escopo.organizacaoId,
        ativa: true,
        excluidoEm: null,
      },
      select: { id: true },
    }))
  )
    throw new SemPermissao("registrar entrega nesta unidade");
  let areaNome: string | null = null;
  if (dados.areaId) {
    const area = await tx.pdvAreaEntrega.findFirst({
      where: { ...escopo, id: dados.areaId },
    });
    if (!area) throw new ErroPdv("Área de entrega indisponível nesta unidade.");
    conferirAreaEntrega(comoArea(area), dados);
    areaNome = area.nome;
  }
  if (!Number.isFinite(agora.getTime()))
    throw new ErroPdv("Não foi possível determinar o prazo de entrega.");
  return {
    ...dados,
    ...(dados.areaId ? { motivoFreteManual: "" } : {}),
    areaNome,
    previstoEm: new Date(
      agora.getTime() + dados.prazoMinutos * 60_000,
    ).toISOString(),
  };
}
export async function atribuirEntregador(
  ctx: ContextoSessao,
  entrada: unknown,
): Promise<void> {
  const escopo = await exigirEscopo(ctx, "pdv.entrega");
  const dados = esquemaAtribuirEntregador.parse(entrada);
  await db.$transaction(async (tx) => {
    await travar(tx, escopo);
    const pedido = await tx.pdvPedido.findFirst({
      where: { ...escopo, id: dados.pedidoId },
    });
    if (!pedido) throw new ErroPdv("Pedido indisponível nesta unidade.");
    const venda = await tx.pdvVenda.findFirst({
      where: { ...escopo, id: pedido.vendaId },
      select: { modalidade: true, status: true },
    });
    if (!venda || venda.modalidade !== "ENTREGA")
      throw new ErroPdv(
        "Somente pedidos de entrega podem receber um entregador.",
      );
    if (
      venda.status === "CANCELADA" ||
      !["COZINHA", "AGUARDANDO_COLETA"].includes(pedido.status)
    )
      throw new ErroPdv(
        "O entregador só pode ser atribuído ou removido antes da saída de um pedido não cancelado.",
      );
    if (
      pedido.versao === dados.versaoPedido + 1 &&
      pedido.entregadorId === dados.entregadorId
    ) {
      const ultimoEvento = await tx.pdvPedidoEvento.findUnique({
        where: {
          pedidoId_versao: { pedidoId: pedido.id, versao: pedido.versao },
        },
      });
      const observacao = dados.entregadorId
        ? "Entregador atribuído"
        : "Entregador removido";
      if (
        ultimoEvento?.de === pedido.status &&
        ultimoEvento.para === pedido.status &&
        ultimoEvento.observacao === observacao &&
        ultimoEvento.usuarioId === ctx.usuario.id
      )
        return;
    }
    if (pedido.versao !== dados.versaoPedido)
      throw new ErroPdv(
        "Este pedido mudou em outra tela. Atualize o quadro antes de atribuir o entregador.",
      );
    const entregador = dados.entregadorId
      ? await tx.pdvEntregador.findFirst({
          where: { ...escopo, id: dados.entregadorId, ativo: true },
        })
      : null;
    if (dados.entregadorId && !entregador)
      throw new ErroPdv("Entregador indisponível ou inativo nesta unidade.");
    await tx.pdvPedido.update({
      where: { id: pedido.id },
      data: {
        entregadorId: entregador?.id ?? null,
        entregadorNome: entregador?.nome ?? null,
        versao: { increment: 1 },
        eventos: {
          create: {
            de: pedido.status,
            para: pedido.status,
            versao: pedido.versao + 1,
            usuarioId: ctx.usuario.id,
            operador: ctx.usuario.nome,
            observacao: entregador
              ? "Entregador atribuído"
              : "Entregador removido",
          },
        },
      },
    });
    await auditar(
      tx,
      ctx,
      escopo,
      "PdvPedidoEntrega",
      pedido.id,
      { versao: pedido.versao, entregadorId: pedido.entregadorId },
      { versao: pedido.versao + 1, entregadorId: entregador?.id ?? null },
    );
  });
}
