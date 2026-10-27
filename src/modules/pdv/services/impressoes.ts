import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { pode, type ContextoSessao } from "@/core/sessao/nucleo";
import { db } from "@/server/db";
import type { SolicitacaoImpressaoPdv } from "../impressao-types";
import { ErroPdv } from "../schemas/erro";
import {
  esquemaDocumentoImpressao,
  esquemaSolicitarImpressao,
  montarDocumentoImpressao,
} from "../schemas/impressao";
import { exigirEscopo } from "./pdv";

type Escopo = { organizacaoId: string; unidadeId: string };
type Entrada = { vendaId: string; tipo: "COMPROVANTE" | "COZINHA" };
async function consultarDocumento(
  tx: Prisma.TransactionClient,
  ctx: ContextoSessao,
  escopo: Escopo,
  dados: Entrada,
) {
  const [venda, pedido] = await Promise.all([
    tx.pdvVenda.findFirst({ where: { ...escopo, id: dados.vendaId } }),
    tx.pdvPedido.findFirst({
      where: { ...escopo, vendaId: dados.vendaId },
      select: { id: true, numero: true, status: true },
    }),
  ]);
  if (!venda) throw new ErroPdv("Venda indisponível nesta unidade.");
  try {
    return montarDocumentoImpressao(venda, {
      unidade: ctx.unidadeAtiva!.nome,
      tipo: dados.tipo,
      podeVerCliente: pode(ctx, "crm.ver"),
      pedido,
    });
  } catch {
    throw new ErroPdv(
      "O registro desta venda não está disponível para impressão. Consulte o histórico.",
    );
  }
}

export async function obterDocumentoImpressao(
  ctx: ContextoSessao,
  entrada: unknown,
) {
  const escopo = await exigirEscopo(ctx);
  const dados = esquemaDocumentoImpressao.parse(entrada);
  return db.$transaction((tx) => consultarDocumento(tx, ctx, escopo, dados));
}

/** Registra a solicitação. O navegador não confirma emissão física ou cancelamento. */
export async function solicitarImpressao(
  ctx: ContextoSessao,
  entrada: unknown,
): Promise<SolicitacaoImpressaoPdv> {
  const escopo = await exigirEscopo(ctx);
  const dados = esquemaSolicitarImpressao.parse(entrada);
  const id = `pdv-impressao-${createHash("sha256")
    .update(
      JSON.stringify([
        escopo.organizacaoId,
        escopo.unidadeId,
        ctx.usuario.id,
        dados.chave,
      ]),
    )
    .digest("hex")}`;
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`pdv-impressao:${escopo.organizacaoId}:${escopo.unidadeId}:${dados.vendaId}:${dados.tipo}`},0))`;
    const documento = await consultarDocumento(tx, ctx, escopo, dados);
    const registrada = await tx.auditoria.findFirst({
      where: {
        id,
        ...escopo,
        usuarioId: ctx.usuario.id,
        entidade: "PdvImpressao",
      },
    });
    if (registrada) {
      const antes = registrada.valoresDepois as Record<string, unknown> | null;
      if (registrada.entidadeId !== dados.vendaId || antes?.tipo !== dados.tipo)
        throw new ErroPdv(
          "Esta solicitação já foi utilizada para outro documento. Abra uma nova prévia.",
        );
      return {
        documento,
        solicitacao: {
          chave: dados.chave,
          quando: registrada.quando.toISOString(),
          reimpressao: antes?.reimpressao === true,
        },
      };
    }
    const anterior = await tx.auditoria.findFirst({
      where: {
        ...escopo,
        entidade: "PdvImpressao",
        entidadeId: dados.vendaId,
        valoresDepois: { path: ["tipo"], equals: dados.tipo },
      },
      select: { id: true },
    });
    const registro = await tx.auditoria.create({
      data: {
        id,
        ...escopo,
        usuarioId: ctx.usuario.id,
        entidade: "PdvImpressao",
        entidadeId: dados.vendaId,
        acao: "ACESSOU",
        valoresDepois: {
          evento: anterior
            ? "SOLICITACAO_REIMPRESSAO"
            : "SOLICITACAO_IMPRESSAO",
          chave: dados.chave,
          tipo: dados.tipo,
          reimpressao: !!anterior,
          statusVenda: documento.statusVenda,
          pedidoId: documento.pedido?.id ?? null,
          statusPedido: documento.pedido?.status ?? null,
        },
      },
    });
    return {
      documento,
      solicitacao: {
        chave: dados.chave,
        quando: registro.quando.toISOString(),
        reimpressao: !!anterior,
      },
    };
  });
}
