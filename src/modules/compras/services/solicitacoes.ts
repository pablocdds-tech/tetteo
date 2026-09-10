import type { Prisma } from "@prisma/client";

import { pode, type ContextoSessao } from "@/core/sessao/nucleo";
import { SemPermissao } from "@/lib/erros";
import { db } from "@/server/db";

import { milesimosDoBanco, quantidadeBr } from "../schemas/aritmetica";
import { situacaoDoLink } from "../schemas/link";
import { textoDoConvite } from "../schemas/mensagens";

import { registrar } from "./auditoria";
import { novoCodigo } from "./cripto-do-link";
import { enfileirar, linkDaSolicitacao } from "./fila";

/**
 * AS SOLICITAÇÕES DE COTAÇÃO — o que cada fornecedor é convidado a cotar.
 *
 * Nascem junto com a consolidação da rodada (services/rodadas.ts), DENTRO da
 * transação dela: a lista congelada e os convites são o mesmo fato.
 *
 * Quem é elegível: o fornecedor que tem o insumo cadastrado como produto dele
 * (`FornecedorInsumo`). O item de fornecedor FIXO não entra na disputa — vai
 * só para o fixo, marcado como direcionado (confirmação de preço). Incluir um
 * fornecedor à mão é possível, e fica auditado.
 */

type Tx = Prisma.TransactionClient;

const prazoBr = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

function exigir(ctx: ContextoSessao, chave: string, acao: string) {
  if (!pode(ctx, chave)) throw new SemPermissao(acao);
}

// ------------------------------------------------ DENTRO DA TRANSAÇÃO DA RODADA

export async function prepararSolicitacoesNaTransacao(
  tx: Tx,
  rodada: { id: string; organizacaoId: string; prazoCotacao: Date | null },
): Promise<number> {
  const itens = await tx.itemDaRodada.findMany({
    where: { rodadaId: rodada.id },
    select: { id: true, insumoId: true, modo: true, fornecedorFixoId: true },
  });
  if (itens.length === 0) return 0;

  const produtos = await tx.fornecedorInsumo.findMany({
    where: {
      organizacaoId: rodada.organizacaoId,
      ativo: true,
      insumoId: { in: itens.map((i) => i.insumoId) },
      fornecedor: { ativo: true, excluidoEm: null },
    },
    select: { fornecedorId: true, insumoId: true },
  });

  const porFornecedor = new Map<string, Map<string, boolean>>();
  const incluir = (fornecedorId: string, itemId: string, direcionado: boolean) => {
    const lista = porFornecedor.get(fornecedorId) ?? new Map<string, boolean>();
    lista.set(itemId, direcionado);
    porFornecedor.set(fornecedorId, lista);
  };

  for (const item of itens) {
    if (item.modo === "DIRECIONADO" && item.fornecedorFixoId) {
      incluir(item.fornecedorFixoId, item.id, true);
      continue;
    }
    for (const p of produtos) {
      if (p.insumoId === item.insumoId) incluir(p.fornecedorId, item.id, false);
    }
  }

  for (const [fornecedorId, seus] of porFornecedor) {
    // Reabrir não duplica convite: a unicidade (rodada, fornecedor) devolve a
    // solicitação que já existe, e só itens novos entram.
    const solicitacao = await tx.solicitacaoDeCotacao.upsert({
      where: { rodadaId_fornecedorId: { rodadaId: rodada.id, fornecedorId } },
      update: {},
      create: {
        organizacaoId: rodada.organizacaoId,
        rodadaId: rodada.id,
        fornecedorId,
        prazo: rodada.prazoCotacao,
      },
      select: { id: true },
    });
    await tx.itemDaSolicitacao.createMany({
      data: [...seus].map(([itemDaRodadaId, direcionado]) => ({
        solicitacaoId: solicitacao.id,
        itemDaRodadaId,
        direcionado,
      })),
      skipDuplicates: true,
    });
  }
  return porFornecedor.size;
}

/**
 * Encerra a cotação: quem respondeu fica ENCERRADA; quem não respondeu,
 * ENCERRADA_SEM_RESPOSTA. O link continua existindo, mas deixa de aceitar
 * resposta — ele confere o estado da rodada a cada envio.
 */
export async function encerrarCotacaoNaTransacao(tx: Tx, rodadaId: string) {
  await tx.solicitacaoDeCotacao.updateMany({
    where: { rodadaId, status: "RESPONDIDA" },
    data: { status: "ENCERRADA" },
  });
  await tx.solicitacaoDeCotacao.updateMany({
    where: { rodadaId, status: { in: ["RASCUNHO", "CONVIDADO"] } },
    data: { status: "ENCERRADA_SEM_RESPOSTA" },
  });
}

/** Reabrir a cotação devolve cada solicitação ao estado de antes de encerrar. */
export async function reabrirCotacaoNaTransacao(tx: Tx, rodadaId: string) {
  await tx.solicitacaoDeCotacao.updateMany({
    where: { rodadaId, status: "ENCERRADA" },
    data: { status: "RESPONDIDA" },
  });
  await tx.solicitacaoDeCotacao.updateMany({
    where: { rodadaId, status: "ENCERRADA_SEM_RESPOSTA", convidadoEm: { not: null } },
    data: { status: "CONVIDADO" },
  });
  await tx.solicitacaoDeCotacao.updateMany({
    where: { rodadaId, status: "ENCERRADA_SEM_RESPOSTA", convidadoEm: null },
    data: { status: "RASCUNHO" },
  });
}

// --------------------------------------------------------------------- TELA

export async function listarSolicitacoes(ctx: ContextoSessao, rodadaId: string) {
  exigir(ctx, "compras.ver", "ver compras");

  const rodada = await db.rodadaDeCompra.findFirst({
    where: { id: rodadaId, organizacaoId: ctx.organizacao.id },
    select: { estado: true },
  });
  if (!rodada) throw new Error("Rodada não encontrada.");

  const solicitacoes = await db.solicitacaoDeCotacao.findMany({
    where: { rodadaId },
    include: {
      fornecedor: {
        select: {
          id: true,
          nome: true,
          contato: true,
          telefonePedidos: true,
          autorizadoMensagens: true,
        },
      },
      itens: { select: { direcionado: true } },
      versoes: {
        orderBy: { numero: "desc" },
        take: 1,
        select: { numero: true, recebidaEm: true, origem: true },
      },
    },
    orderBy: { fornecedor: { nome: "asc" } },
  });

  const mensagens = await db.mensagemAoFornecedor.findMany({
    where: {
      referenciaTipo: "SolicitacaoDeCotacao",
      referenciaId: { in: solicitacoes.map((s) => s.id) },
    },
    orderBy: { enfileiradaEm: "desc" },
    select: {
      id: true,
      referenciaId: true,
      estado: true,
      simulada: true,
      enviadaAMaoEm: true,
      motivoBloqueio: true,
    },
  });

  const agora = new Date();
  return solicitacoes.map((s) => {
    const convite = mensagens.find((m) => m.referenciaId === s.id) ?? null;
    return {
      id: s.id,
      fornecedor: s.fornecedor,
      status: s.status,
      prazo: s.prazo,
      itens: s.itens.length,
      direcionados: s.itens.filter((i) => i.direcionado).length,
      versaoAtual: s.versaoAtual,
      ultimaVersao: s.versoes[0] ?? null,
      link: s.tokenHash
        ? situacaoDoLink(
            {
              expiraEm: s.tokenExpiraEm,
              revogadoEm: s.tokenRevogadoEm,
              tentativasInvalidas: s.tentativasInvalidas,
              versoes: s.versaoAtual,
              ultimoEnvioEm: null,
              rodadaEmCotacao: rodada.estado === "COTANDO",
            },
            agora,
          )
        : null,
      motivoRevogacao: s.motivoRevogacao,
      convite,
    };
  });
}

// ------------------------------------------------------------------ CONVITE

/**
 * Emite o link e enfileira o convite. `reemitir` troca o código: o link
 * antigo deixa de valer no mesmo instante (o hash dele some do banco).
 */
async function emitirConvite(
  ctx: ContextoSessao,
  solicitacaoId: string,
  reemitir: boolean,
): Promise<{ mensagemId: string; estado: string; motivoBloqueio: string | null }> {
  exigir(ctx, "compras.cotar", "convidar fornecedores");

  const s = await db.solicitacaoDeCotacao.findFirst({
    where: { id: solicitacaoId, organizacaoId: ctx.organizacao.id },
    include: {
      rodada: {
        select: { estado: true, descricao: true, numero: true, prazoCotacao: true },
      },
      fornecedor: { select: { nome: true, contato: true } },
      itens: {
        include: {
          itemDaRodada: {
            select: {
              quantidadeTotal: true,
              insumo: { select: { nome: true, unidadeMedida: true, unidadeRotulo: true } },
            },
          },
        },
      },
    },
  });
  if (!s) throw new Error("Solicitação não encontrada.");
  if (s.rodada.estado !== "COTANDO") {
    throw new Error("A rodada não está em cotação — não há o que convidar agora.");
  }
  if (s.itens.length === 0) throw new Error("Esta solicitação não tem itens.");
  if (!reemitir && s.status !== "RASCUNHO") {
    throw new Error(
      "Este fornecedor já foi convidado. Para mandar de novo, use Reemitir link — o anterior deixa de valer.",
    );
  }
  const prazo = s.prazo ?? s.rodada.prazoCotacao;
  if (!prazo || prazo <= new Date()) {
    throw new Error(
      "Defina na rodada um prazo de cotação no futuro antes de convidar: o link vence nele.",
    );
  }

  const organizacao = await db.organizacao.findUniqueOrThrow({
    where: { id: ctx.organizacao.id },
    select: { nome: true },
  });

  const corpo = textoDoConvite({
    organizacao: organizacao.nome,
    fornecedor: s.fornecedor.nome,
    contato: s.fornecedor.contato,
    rodada: `Rodada ${s.rodada.numero} — ${s.rodada.descricao}`,
    prazo: prazoBr.format(prazo),
    itens: s.itens.map((i) => ({
      nome: i.itemDaRodada.insumo.nome,
      quantidade: quantidadeBr(
        milesimosDoBanco(i.itemDaRodada.quantidadeTotal),
        i.itemDaRodada.insumo.unidadeRotulo ?? i.itemDaRodada.insumo.unidadeMedida,
      ),
    })),
  });

  return db.$transaction(async (tx) => {
    const { hash, cifrado } = novoCodigo();
    const envios = await tx.mensagemAoFornecedor.count({
      where: { referenciaTipo: "SolicitacaoDeCotacao", referenciaId: s.id },
    });

    await tx.solicitacaoDeCotacao.update({
      where: { id: s.id },
      data: {
        tokenHash: hash,
        tokenCifrado: cifrado,
        tokenExpiraEm: prazo,
        tokenRevogadoEm: null,
        motivoRevogacao: null,
        tentativasInvalidas: 0,
        prazo,
        convidadoEm: s.convidadoEm ?? new Date(),
        ...(s.status === "RASCUNHO" ? { status: "CONVIDADO" } : {}),
      },
    });

    // O convite anterior que ainda não saiu levaria o link novo mesmo assim
    // (o link é colocado na hora do envio); cancelá-lo evita mandar dois.
    await tx.mensagemAoFornecedor.updateMany({
      where: {
        referenciaTipo: "SolicitacaoDeCotacao",
        referenciaId: s.id,
        estado: { in: ["BLOQUEADA", "NA_FILA", "FALHOU"] },
      },
      data: { estado: "CANCELADA", canceladaEm: new Date(), resolucao: "Substituído por convite novo." },
    });

    const mensagem = await enfileirar(tx, {
      organizacaoId: ctx.organizacao.id,
      unidadeId: null,
      fornecedorId: s.fornecedorId,
      tipo: "CONVITE_COTACAO",
      referenciaTipo: "SolicitacaoDeCotacao",
      referenciaId: s.id,
      sequencia: envios + 1,
      corpo,
      chave: `convite:${s.id}:${envios + 1}`,
      criadoPorId: ctx.usuario.id,
    });

    await registrar(tx, ctx, {
      entidade: "SolicitacaoDeCotacao",
      entidadeId: s.id,
      acao: "ALTEROU",
      antes: { status: s.status },
      depois: {
        convite: envios + 1,
        reemitido: reemitir,
        expiraEm: prazo.toISOString(),
        mensagem: mensagem.estado,
      },
    });

    return {
      mensagemId: mensagem.id,
      estado: mensagem.estado,
      motivoBloqueio: mensagem.motivoBloqueio,
    };
  });
}

export function convidar(ctx: ContextoSessao, solicitacaoId: string) {
  return emitirConvite(ctx, solicitacaoId, false);
}

export function reemitirLink(ctx: ContextoSessao, solicitacaoId: string) {
  return emitirConvite(ctx, solicitacaoId, true);
}

export async function revogarLink(
  ctx: ContextoSessao,
  solicitacaoId: string,
  motivo: string,
): Promise<void> {
  exigir(ctx, "compras.cotar", "revogar links de cotação");
  const texto = motivo.trim();
  if (!texto) throw new Error("Diga por que o link está sendo revogado.");

  await db.$transaction(async (tx) => {
    const s = await tx.solicitacaoDeCotacao.findFirst({
      where: { id: solicitacaoId, organizacaoId: ctx.organizacao.id },
      select: { id: true, tokenHash: true },
    });
    if (!s?.tokenHash) throw new Error("Esta solicitação não tem link ativo.");
    await tx.solicitacaoDeCotacao.update({
      where: { id: s.id },
      data: { tokenRevogadoEm: new Date(), motivoRevogacao: texto.slice(0, 200) },
    });
    await tx.mensagemAoFornecedor.updateMany({
      where: {
        referenciaTipo: "SolicitacaoDeCotacao",
        referenciaId: s.id,
        estado: { in: ["BLOQUEADA", "NA_FILA", "FALHOU"] },
      },
      data: { estado: "CANCELADA", canceladaEm: new Date(), resolucao: "Link revogado." },
    });
    await registrar(tx, ctx, {
      entidade: "SolicitacaoDeCotacao",
      entidadeId: s.id,
      acao: "ALTEROU",
      depois: { linkRevogado: true, motivo: texto },
    });
  });
}

/** O link para copiar e colar no WhatsApp. Cada cópia fica registrada. */
export async function linkParaCopiar(
  ctx: ContextoSessao,
  solicitacaoId: string,
): Promise<string> {
  exigir(ctx, "compras.cotar", "copiar links de cotação");
  const s = await db.solicitacaoDeCotacao.findFirst({
    where: { id: solicitacaoId, organizacaoId: ctx.organizacao.id },
    select: { id: true },
  });
  if (!s) throw new Error("Solicitação não encontrada.");
  const link = await linkDaSolicitacao(s.id);
  await registrar(db, ctx, {
    entidade: "SolicitacaoDeCotacao",
    entidadeId: s.id,
    acao: "ACESSOU",
    depois: { linkCopiado: true },
  });
  return link;
}

/** Fornecedor fora do cadastro de produtos, convidado à mão. */
export async function incluirFornecedor(
  ctx: ContextoSessao,
  rodadaId: string,
  fornecedorId: string,
  itemDaRodadaIds: string[],
): Promise<string> {
  exigir(ctx, "compras.cotar", "incluir fornecedores na cotação");
  if (itemDaRodadaIds.length === 0) throw new Error("Escolha os itens que ele vai cotar.");

  return db.$transaction(async (tx) => {
    const rodada = await tx.rodadaDeCompra.findFirst({
      where: { id: rodadaId, organizacaoId: ctx.organizacao.id },
      select: { id: true, estado: true, organizacaoId: true, prazoCotacao: true },
    });
    if (!rodada) throw new Error("Rodada não encontrada.");
    if (rodada.estado !== "COTANDO") throw new Error("A rodada não está em cotação.");

    const fornecedor = await tx.fornecedor.findFirst({
      where: { id: fornecedorId, organizacaoId: ctx.organizacao.id, ativo: true, excluidoEm: null },
      select: { id: true },
    });
    if (!fornecedor) throw new Error("Fornecedor não encontrado ou desativado.");

    const itens = await tx.itemDaRodada.findMany({
      where: { id: { in: itemDaRodadaIds }, rodadaId, modo: "COTAVEL" },
      select: { id: true },
    });
    if (itens.length !== new Set(itemDaRodadaIds).size) {
      throw new Error(
        "Algum item não é desta rodada, ou é compra direcionada ao fornecedor fixo.",
      );
    }

    const s = await tx.solicitacaoDeCotacao.upsert({
      where: { rodadaId_fornecedorId: { rodadaId, fornecedorId } },
      update: {},
      create: {
        organizacaoId: rodada.organizacaoId,
        rodadaId,
        fornecedorId,
        prazo: rodada.prazoCotacao,
        criadoPorId: ctx.usuario.id,
      },
      select: { id: true },
    });
    await tx.itemDaSolicitacao.createMany({
      data: itens.map((i) => ({ solicitacaoId: s.id, itemDaRodadaId: i.id })),
      skipDuplicates: true,
    });
    await registrar(tx, ctx, {
      entidade: "SolicitacaoDeCotacao",
      entidadeId: s.id,
      acao: "CRIOU",
      depois: { incluidoAMao: true, itens: itens.length },
    });
    return s.id;
  });
}

/** O fornecedor disse que não vai cotar. */
export async function marcarRecusa(
  ctx: ContextoSessao,
  solicitacaoId: string,
  motivo: string,
): Promise<void> {
  exigir(ctx, "compras.cotar", "registrar recusa de fornecedor");
  const r = await db.solicitacaoDeCotacao.updateMany({
    where: {
      id: solicitacaoId,
      organizacaoId: ctx.organizacao.id,
      status: { in: ["RASCUNHO", "CONVIDADO"] },
    },
    data: { status: "RECUSOU" },
  });
  if (r.count !== 1) throw new Error("Esta solicitação não está aguardando resposta.");
  await registrar(db, ctx, {
    entidade: "SolicitacaoDeCotacao",
    entidadeId: solicitacaoId,
    acao: "ALTEROU",
    depois: { status: "RECUSOU", motivo: motivo.trim() || null },
  });
}
