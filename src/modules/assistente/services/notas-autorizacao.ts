import { Prisma } from "@prisma/client";
import {
  contextoDeFundo,
  pode,
  type ContextoSessao,
} from "@/core/sessao/nucleo";
import { SemPermissao } from "@/lib/erros";
import { normalizarTelefone, ehGrupo } from "@/lib/telefone";
import { db } from "@/server/db";
import {
  alteracaoAutorizacaoNota,
  temPermissoesParaNotas,
} from "../schemas/autorizacao-nota";

export type PessoaNotas = {
  id: string;
  usuarioId: string;
  nome: string;
  telefone: string;
  recebeAvisos: boolean;
  autorizada: boolean;
  elegivel: boolean;
  motivo: string | null;
  versao: number;
  autorizadoEm: string | null;
  autorizadoPor: string | null;
};
export type PainelNotas = {
  unidade: string;
  unidadeId: string;
  conexao: {
    numero: string | null;
    ligada: boolean;
    conectada: boolean;
    pronta: boolean;
    motivo: string | null;
  };
  pessoas: PessoaNotas[];
  podeAutorizar: boolean;
};

/** Remover/restaurar vínculo exige nova decisão, inclusive com o mesmo telefone. */
export async function revogarNotasDoVinculo(
  tx: Prisma.TransactionClient,
  ctx: ContextoSessao,
  vinculoId: string,
) {
  const linhas = await tx.autorizacaoNotaWhatsapp.findMany({
    where: {
      organizacaoId: ctx.organizacao.id,
      vinculoId,
      autorizadoEm: { not: null },
    },
    select: { id: true, unidadeId: true },
  });
  for (const a of linhas) {
    await tx.autorizacaoNotaWhatsapp.update({
      where: { id: a.id },
      data: {
        autorizadoEm: null,
        autorizadoPorId: null,
        revogadoEm: new Date(),
        revogadoPorId: ctx.usuario.id,
        versao: { increment: 1 },
      },
    });
    await tx.auditoria.create({
      data: {
        organizacaoId: ctx.organizacao.id,
        unidadeId: a.unidadeId,
        usuarioId: ctx.usuario.id,
        entidade: "AutorizacaoNotaWhatsapp",
        entidadeId: a.id,
        acao: "ALTEROU",
        valoresAntes: { autorizada: true },
        valoresDepois: { autorizada: false, origem: "alteracao-vinculo" },
      },
    });
  }
}

async function exigirGestao(ctx: ContextoSessao) {
  if (
    !ctx.unidadeAtiva ||
    !ctx.unidadesVisiveis.some((u) => u.id === ctx.unidadeAtiva!.id)
  )
    throw new SemPermissao("gerenciar notas nesta unidade");
  // Não confia em permissões antigas enviadas pelo chamador.
  const atual = await contextoDeFundo(ctx.usuario.id, ctx.unidadeAtiva.id);
  const usuario = await db.usuario.count({
    where: { id: ctx.usuario.id, status: "ATIVO", excluidoEm: null },
  });
  if (
    !usuario ||
    !atual ||
    atual.organizacao.id !== ctx.organizacao.id ||
    !pode(atual, "assistente.autorizar_notas")
  )
    throw new SemPermissao("autorizar notas pelo WhatsApp");
  return atual;
}

/** Reler no instante dos efeitos, com trava contra revogação concorrente. */
export async function exigirAutorizacaoNotaNaTransacao(
  tx: Prisma.TransactionClient,
  ctx: ContextoSessao,
  origem: { instanciaId: string; vinculoId: string },
) {
  const unidadeId = ctx.unidadeAtiva!.id,
    organizacaoId = ctx.organizacao.id;
  const a = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM autorizacao_nota_whatsapp WHERE "organizacaoId"=${organizacaoId} AND "unidadeId"=${unidadeId} AND "vinculoId"=${origem.vinculoId} FOR SHARE`;
  const [autorizacao, vinculo, instancia] = await Promise.all([
    a.length
      ? tx.autorizacaoNotaWhatsapp.findUnique({ where: { id: a[0].id } })
      : null,
    tx.vinculoWhatsapp.findFirst({
      where: {
        id: origem.vinculoId,
        organizacaoId,
        usuarioId: ctx.usuario.id,
        excluidoEm: null,
      },
      select: { telefone: true },
    }),
    tx.instanciaWhatsapp.findFirst({
      where: {
        id: origem.instanciaId,
        organizacaoId,
        ativa: true,
        excluidoEm: null,
      },
      select: { unidadeId: true },
    }),
  ]);
  if (
    !autorizacao?.autorizadoEm ||
    autorizacao.usuarioId !== ctx.usuario.id ||
    !vinculo ||
    autorizacao.telefone !== vinculo.telefone ||
    !instancia
  )
    throw new SemPermissao("lançar notas por este número de WhatsApp");
  const unidades = await tx.unidade.findMany({
    where: {
      organizacaoId,
      ativa: true,
      excluidoEm: null,
      ...(instancia.unidadeId ? { id: instancia.unidadeId } : {}),
    },
    select: { id: true },
    take: 2,
  });
  if (unidades.length !== 1 || unidades[0].id !== unidadeId)
    throw new SemPermissao("lançar notas nesta unidade pelo WhatsApp");
}

export async function alterarAutorizacaoNota(
  ctx: ContextoSessao,
  entrada: unknown,
) {
  const dados = alteracaoAutorizacaoNota.parse(entrada),
    atual = await exigirGestao(ctx);
  const organizacaoId = atual.organizacao.id,
    unidadeId = atual.unidadeAtiva!.id;
  if (dados.unidadeId !== unidadeId)
    throw new Error(
      "A unidade mudou. Atualize a página antes de autorizar notas.",
    );
  return db.$transaction(async (tx) => {
    const vinculo = await tx.vinculoWhatsapp.findFirst({
      where: { id: dados.vinculoId, organizacaoId, excluidoEm: null },
      select: { usuarioId: true, telefone: true, remoteJid: true },
    });
    if (!vinculo) throw new Error("Pessoa não encontrada nesta organização.");
    if (
      vinculo.usuarioId !== dados.usuarioId ||
      vinculo.telefone !== dados.telefone
    )
      throw new Error(
        "O usuário ou telefone do vínculo mudou. Atualize a página antes de continuar.",
      );
    if (dados.autorizar) {
      const usuario = await tx.usuario.count({
        where: { id: vinculo.usuarioId, status: "ATIVO", excluidoEm: null },
      });
      const acessos = await tx.acesso.findMany({
        where: {
          organizacaoId,
          usuarioId: vinculo.usuarioId,
          status: "ATIVO",
          excluidoEm: null,
          organizacao: { ativa: true, excluidoEm: null },
          OR: [{ unidadeId: null }, { unidadeId }],
        },
        select: {
          papel: {
            select: {
              organizacaoId: true,
              permissoes: { select: { chave: true } },
            },
          },
        },
      });
      const permissoes = new Set(
        acessos
          .filter((a) => a.papel.organizacaoId === organizacaoId)
          .flatMap((a) => a.papel.permissoes.map((p) => p.chave)),
      );
      if (
        !usuario ||
        !temPermissoesParaNotas(permissoes) ||
        !normalizarTelefone(vinculo.telefone) ||
        ehGrupo(vinculo.remoteJid)
      )
        throw new Error(
          "Este usuário precisa estar ativo, com telefone válido e permissões de Estoque e Financeiro nesta unidade.",
        );
    }
    const where = {
      organizacaoId_unidadeId_vinculoId: {
        organizacaoId,
        unidadeId,
        vinculoId: dados.vinculoId,
      },
    };
    const anterior = await tx.autorizacaoNotaWhatsapp.findUnique({ where });
    if ((anterior?.versao ?? 0) !== dados.versao)
      throw new Error(
        "A autorização mudou. Atualize a página antes de continuar.",
      );
    const agora = new Date(),
      valores = {
        usuarioId: vinculo.usuarioId,
        telefone: vinculo.telefone,
        autorizadoEm: dados.autorizar ? agora : null,
        autorizadoPorId: dados.autorizar ? ctx.usuario.id : null,
        revogadoEm: dados.autorizar ? null : agora,
        revogadoPorId: dados.autorizar ? null : ctx.usuario.id,
      };
    let id = anterior?.id;
    if (anterior) {
      const r = await tx.autorizacaoNotaWhatsapp.updateMany({
        where: { id, organizacaoId, unidadeId, versao: dados.versao },
        data: { ...valores, versao: { increment: 1 } },
      });
      if (r.count !== 1)
        throw new Error(
          "A autorização mudou. Atualize a página antes de continuar.",
        );
    } else {
      try {
        id = (
          await tx.autorizacaoNotaWhatsapp.create({
            data: {
              organizacaoId,
              unidadeId,
              vinculoId: dados.vinculoId,
              ...valores,
            },
          })
        ).id;
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === "P2002"
        )
          throw new Error(
            "A autorização mudou. Atualize a página antes de continuar.",
          );
        throw e;
      }
    }
    await tx.auditoria.create({
      data: {
        organizacaoId,
        unidadeId,
        usuarioId: ctx.usuario.id,
        entidade: "AutorizacaoNotaWhatsapp",
        entidadeId: id!,
        acao: "ALTEROU",
        valoresAntes: { autorizada: !!anterior?.autorizadoEm },
        valoresDepois: {
          autorizada: dados.autorizar,
          vinculoId: dados.vinculoId,
          usuarioId: vinculo.usuarioId,
          origem: "painel-notas",
        },
      },
    });
  });
}

export async function obterPainelNotas(
  ctx: ContextoSessao,
): Promise<PainelNotas> {
  if (
    !pode(ctx, "assistente.ver") ||
    !ctx.unidadeAtiva ||
    !ctx.unidadesVisiveis.some((u) => u.id === ctx.unidadeAtiva!.id)
  )
    throw new SemPermissao("ver notas nesta unidade");
  const organizacaoId = ctx.organizacao.id,
    unidadeId = ctx.unidadeAtiva.id;
  // Telefone é dado privado. Quem só envia notas vê apenas o seu vínculo.
  const gerenciar = pode(ctx, "assistente.autorizar_notas"),
    verEquipe = gerenciar || pode(ctx, "assistente.vincular");
  const [instancias, unidades, vinculos, autorizacoes, acessos] =
    await Promise.all([
      db.instanciaWhatsapp.findMany({
        where: {
          organizacaoId,
          nome: process.env.EVOLUTION_INSTANCIA ?? "severina",
          excluidoEm: null,
        },
        select: {
          numeroProprio: true,
          ativa: true,
          estado: true,
          unidadeId: true,
        },
      }),
      db.unidade.findMany({
        where: { organizacaoId, ativa: true, excluidoEm: null },
        select: { id: true },
      }),
      db.vinculoWhatsapp.findMany({
        where: {
          organizacaoId,
          excluidoEm: null,
          ...(!verEquipe ? { usuarioId: ctx.usuario.id } : {}),
        },
        select: {
          id: true,
          usuarioId: true,
          telefone: true,
          remoteJid: true,
          autorizadoEm: true,
        },
      }),
      db.autorizacaoNotaWhatsapp.findMany({
        where: { organizacaoId, unidadeId },
      }),
      db.acesso.findMany({
        where: {
          organizacaoId,
          status: "ATIVO",
          excluidoEm: null,
          OR: [{ unidadeId: null }, { unidadeId }],
        },
        select: {
          usuarioId: true,
          papel: {
            select: {
              organizacaoId: true,
              permissoes: { select: { chave: true } },
            },
          },
        },
      }),
    ]);
  const ids = new Set([
    ...vinculos.map((v) => v.usuarioId),
    ...autorizacoes.flatMap((a) =>
      a.autorizadoPorId ? [a.autorizadoPorId] : [],
    ),
  ]);
  const usuarios = await db.usuario.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, nome: true, status: true, excluidoEm: true },
  });
  const pessoas = vinculos
    .flatMap((v) => {
      const usuario = usuarios.find((u) => u.id === v.usuarioId),
        acessosPessoa = acessos.filter(
          (a) =>
            a.usuarioId === v.usuarioId &&
            a.papel.organizacaoId === organizacaoId,
        );
      if (
        !usuario ||
        (!acessosPessoa.length &&
          !autorizacoes.some((a) => a.vinculoId === v.id))
      )
        return [];
      const permissoes = new Set(
        acessosPessoa.flatMap((a) => a.papel.permissoes.map((p) => p.chave)),
      );
      const elegivel =
        usuario.status === "ATIVO" &&
        !usuario.excluidoEm &&
        !!normalizarTelefone(v.telefone) &&
        !ehGrupo(v.remoteJid) &&
        temPermissoesParaNotas(permissoes);
      const a = autorizacoes.find((a) => a.vinculoId === v.id),
        identidade = a?.usuarioId === v.usuarioId && a?.telefone === v.telefone;
      return [
        {
          id: v.id,
          usuarioId: v.usuarioId,
          nome: usuario.nome,
          telefone: v.telefone,
          recebeAvisos: !!v.autorizadoEm,
          autorizada: !!a?.autorizadoEm && identidade,
          elegivel: !!elegivel,
          motivo: !elegivel
            ? "Usuário inativo ou sem as permissões necessárias de Estoque e Financeiro."
            : a?.autorizadoEm && !identidade
              ? "Vínculo alterado. Autorize este número novamente."
              : null,
          versao: a?.versao ?? 0,
          autorizadoEm: a?.autorizadoEm?.toISOString() ?? null,
          autorizadoPor:
            usuarios.find((u) => u.id === a?.autorizadoPorId)?.nome ?? null,
        },
      ];
    })
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const i = instancias.length === 1 ? instancias[0] : null;
  const destino =
    i?.unidadeId ?? (unidades.length === 1 ? unidades[0].id : null);
  const motivo = !i
    ? "Configure o WhatsApp da equipe."
    : destino !== unidadeId
      ? "O WhatsApp da equipe precisa estar vinculado a esta unidade."
      : !i.numeroProprio || i.estado !== "CONECTADO"
        ? "Conecte o número da equipe para receber notas."
        : !i.ativa
          ? "O WhatsApp da equipe está pausado."
          : null;
  return {
    unidade: ctx.unidadeAtiva.nome,
    unidadeId,
    podeAutorizar: gerenciar,
    pessoas,
    conexao: {
      numero: destino === unidadeId ? (i?.numeroProprio ?? null) : null,
      ligada: i?.ativa ?? false,
      conectada: i?.estado === "CONECTADO",
      pronta: !motivo,
      motivo,
    },
  };
}
