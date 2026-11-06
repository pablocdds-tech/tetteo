import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  contextoDeFundo,
  pode,
  type ContextoSessao,
} from "@/core/sessao/nucleo";
import { SemPermissao } from "@/lib/erros";
import { db } from "@/server/db";
import { gravarArquivoFiscal } from "@/server/notas/arquivos";
import {
  tipoDocumentoNota,
  LeituraNotaRecusada,
} from "@/server/notas/documento";
import { extracaoVazia } from "@/server/notas/extracao";
import { lerDocumentoFiscal } from "@/server/notas/pipeline";
import { lerFiscalComGemini } from "@/server/notas/orcamento";
import { conferenciaFiscal } from "../schemas/leitura-fiscal";
import {
  aplicarEdicaoFiscal,
  pendenciasDoRascunho,
  salvarRascunhoFiscalSchema,
  RascunhoFiscalRecusado,
  type RascunhoFiscal,
} from "../schemas/rascunho-fiscal";

// A tabela histórica já armazena leitura, revisão e reservas sem FK de canal.
// WEB + estados próprios não pertencem a conversa/fila e nunca geram confirmação.
const ORIGEM = "WEB";
const ESTADO = "RASCUNHO_WEB";
const json = (v: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(v));

export async function exigirAcessoRascunho(
  ctx: ContextoSessao,
  unidadeId: string,
) {
  if (
    !ctx.unidadeAtiva ||
    ctx.unidadeAtiva.id !== unidadeId ||
    !ctx.unidadesVisiveis.some((u) => u.id === unidadeId)
  )
    throw new SemPermissao("editar rascunhos nesta unidade");
  const atual = await contextoDeFundo(ctx.usuario.id, unidadeId);
  const ativo = await db.usuario.count({
    where: { id: ctx.usuario.id, status: "ATIVO", excluidoEm: null },
  });
  if (
    !ativo ||
    !atual ||
    atual.organizacao.id !== ctx.organizacao.id ||
    !["assistente.ver", "estoque.ver", "estoque.lancar"].every((p) =>
      pode(atual, p),
    )
  )
    throw new SemPermissao("editar rascunhos fiscais");
  return {
    organizacaoId: atual.organizacao.id,
    unidadeId,
    usuarioId: atual.usuario.id,
    instanciaId: ORIGEM,
  };
}

function apresentar(n: {
  id: string;
  revisao: number;
  arquivoId: string | null;
  leitura: unknown;
  erro: string | null;
}): RascunhoFiscal {
  const c = conferenciaFiscal(n.leitura);
  if (!c)
    throw new RascunhoFiscalRecusado(
      "O documento ainda está sendo lido. Aguarde e abra o rascunho novamente.",
    );
  return {
    id: n.id,
    revisao: n.revisao,
    arquivoId: n.arquivoId,
    dados: c.conferida,
    pendencias: pendenciasDoRascunho(c.conferida),
    avisos: [
      ...new Set([
        ...(n.erro ? [n.erro] : []),
        ...c.conferida.alertas,
        ...c.extras.map((p) => p.mensagem),
      ]),
    ],
  };
}

export async function obterRascunhoFiscal(
  ctx: ContextoSessao,
  unidadeId: string,
  id: string,
) {
  const escopo = await exigirAcessoRascunho(ctx, unidadeId);
  const n = await db.notaFiscalWhatsapp.findFirst({
    where: { ...escopo, id, estado: ESTADO },
  });
  if (!n)
    throw new RascunhoFiscalRecusado("Rascunho não encontrado nesta unidade.");
  return apresentar(n);
}

export async function listarRascunhosFiscais(
  ctx: ContextoSessao,
  unidadeId: string,
) {
  const escopo = await exigirAcessoRascunho(ctx, unidadeId);
  const notas = await db.notaFiscalWhatsapp.findMany({
    where: { ...escopo, estado: ESTADO },
    orderBy: { atualizadoEm: "desc" },
    take: 20,
  });
  return notas.map((n) => ({
    id: n.id,
    fornecedor:
      conferenciaFiscal(n.leitura)?.conferida.razao_social ??
      "Documento a conferir",
  }));
}

export async function receberRascunhoFiscal(
  ctx: ContextoSessao,
  entrada: { unidadeId: string; operacaoId: string; bytes: Uint8Array },
): Promise<RascunhoFiscal> {
  const escopo = await exigirAcessoRascunho(ctx, entrada.unidadeId);
  const operacao = z.uuid().parse(entrada.operacaoId);
  const tipo = tipoDocumentoNota(entrada.bytes);
  if (!tipo)
    throw new RascunhoFiscalRecusado(
      "Envie XML, PDF, JPG, PNG ou WebP de até 20 MB.",
    );
  const imagemHash = createHash("sha256").update(entrada.bytes).digest("hex");
  const mensagemId = `web:${createHash("sha256")
    .update(JSON.stringify([escopo, operacao]))
    .digest("hex")}`;
  const reserva = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`rascunho:${escopo.organizacaoId}:${escopo.usuarioId}`}, 0))`;
    const existente = await tx.notaFiscalWhatsapp.findFirst({
      where: { ...escopo, mensagemId },
    });
    if (existente) {
      if (existente.imagemHash !== imagemHash)
        throw new RascunhoFiscalRecusado(
          "Este envio já pertence a outro documento. Inicie um novo envio.",
        );
      return { nota: existente, nova: false };
    }
    const quantidade = await tx.notaFiscalWhatsapp.count({
      where: {
        organizacaoId: escopo.organizacaoId,
        usuarioId: escopo.usuarioId,
        criadoEm: { gte: new Date(Date.now() - 86_400_000) },
      },
    });
    if (quantidade >= 20)
      throw new RascunhoFiscalRecusado(
        "O limite diário de documentos foi atingido. Continue editando os rascunhos salvos.",
      );
    const nota = await tx.notaFiscalWhatsapp.create({
      data: {
        ...escopo,
        vinculoId: escopo.usuarioId,
        mensagemId,
        imagemHash,
        estado: "LENDO_WEB",
      },
    });
    return { nota, nova: true };
  });
  if (!reserva.nova) return apresentar(reserva.nota);
  const notaId = reserva.nota.id;
  const original = await gravarArquivoFiscal({
    ...escopo,
    bytes: entrada.bytes,
    tipo,
    variante: "original",
  });
  await db.notaFiscalWhatsapp.update({
    where: { id: notaId },
    data: { arquivoId: original.id },
  });
  let dados = extracaoVazia();
  let extras: { campo: string; codigo: string; mensagem: string }[] = [];
  let metodo = "INCOMPLETO";
  let erro: string | null = null;
  const derivados: { id: string; variante: string }[] = [];
  const registrar = async (evento: {
    etapa: string;
    codigos?: string[];
    tentativa?: number;
    modelo?: string;
    tokens?: number;
  }) => {
    await db.auditoria.create({
      data: {
        ...escopoAuditoria(escopo),
        entidadeId: notaId,
        acao: "ALTEROU",
        valoresDepois: json(evento),
      },
    });
  };
  try {
    const resultado = await lerDocumentoFiscal(entrada.bytes, {
      ...escopo,
      registrar,
      salvar: async (imagem) => {
        const a = await gravarArquivoFiscal({
          ...escopo,
          ...imagem,
          tipo: "image/png",
        });
        derivados.push({ id: a.id, variante: imagem.variante });
        return a.id;
      },
      gemini: (imagens, recortes) =>
        lerFiscalComGemini(
          {
            organizationId: escopo.organizacaoId,
            storeId: escopo.unidadeId,
            solicitacaoId: notaId,
          },
          imagens,
          recortes,
          registrar,
        ),
    });
    dados = resultado.dados;
    extras = resultado.extras;
    metodo = resultado.metodo;
  } catch (e) {
    erro =
      e instanceof LeituraNotaRecusada
        ? e.message
        : "Não foi possível ler o documento. Você pode preencher e salvar o rascunho ou enviar outro arquivo.";
  }
  const conferencia = {
    versao: "fiscal-2.0",
    metodo,
    original: structuredClone(dados),
    conferida: dados,
    extras,
    alertasConferidos: false,
  };
  // Revalida acesso após a chamada externa; nenhuma resposta libera lançamentos.
  await exigirAcessoRascunho(ctx, entrada.unidadeId);
  const nota = await db.$transaction(async (tx) => {
    const n = await tx.notaFiscalWhatsapp.update({
      where: { id: notaId },
      data: {
        estado: ESTADO,
        leitura: json(conferencia),
        erro,
        metodoLeitura: metodo,
        versaoLeitor: "fiscal-2.0",
        arquivosDerivados: json(derivados),
        validacoes: json(pendenciasDoRascunho(dados)),
      },
    });
    await tx.auditoria.create({
      data: {
        ...escopoAuditoria(escopo),
        entidadeId: notaId,
        acao: "CRIOU",
        valoresDepois: {
          metodo,
          incompleta: pendenciasDoRascunho(dados).length > 0,
        },
      },
    });
    return n;
  });
  return apresentar(nota);
}

function escopoAuditoria(s: {
  organizacaoId: string;
  unidadeId: string;
  usuarioId: string;
}) {
  return {
    organizacaoId: s.organizacaoId,
    unidadeId: s.unidadeId,
    usuarioId: s.usuarioId,
    entidade: "RascunhoFiscal",
  };
}

export async function salvarRascunhoFiscal(
  ctx: ContextoSessao,
  entrada: unknown,
) {
  const e = salvarRascunhoFiscalSchema.parse(entrada);
  const escopo = await exigirAcessoRascunho(ctx, e.unidadeId);
  return db.$transaction(async (tx) => {
    const n = await tx.notaFiscalWhatsapp.findFirst({
      where: { ...escopo, id: e.id, estado: ESTADO },
    });
    const c = n && conferenciaFiscal(n.leitura);
    if (!n || !c)
      throw new RascunhoFiscalRecusado(
        "Rascunho não encontrado nesta unidade.",
      );
    if (n.revisao !== e.revisao)
      throw new RascunhoFiscalRecusado(
        "Este rascunho mudou em outra aba. Abra a versão atual antes de salvar.",
      );
    c.conferida = aplicarEdicaoFiscal(c.conferida, e.dados);
    const p = pendenciasDoRascunho(c.conferida);
    const alterou = await tx.notaFiscalWhatsapp.updateMany({
      where: { ...escopo, id: e.id, estado: ESTADO, revisao: e.revisao },
      data: {
        leitura: json(c),
        validacoes: json(p),
        revisao: { increment: 1 },
      },
    });
    if (!alterou.count)
      throw new RascunhoFiscalRecusado(
        "Este rascunho mudou em outra aba. Abra a versão atual antes de salvar.",
      );
    await tx.auditoria.create({
      data: {
        ...escopoAuditoria(escopo),
        entidadeId: e.id,
        acao: "ALTEROU",
        valoresDepois: {
          revisao: e.revisao + 1,
          pendencias: p.map((v) => v.campo),
        },
      },
    });
    return apresentar({ ...n, leitura: c, revisao: e.revisao + 1 });
  });
}
