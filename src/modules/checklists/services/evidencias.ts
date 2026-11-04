import { createHash, randomBytes } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { pode, type ContextoSessao } from "@/core/sessao/nucleo";
import { SemPermissao } from "@/lib/erros";
import { lerArquivo, pastaDosArquivos } from "@/server/arquivos";
import { db } from "@/server/db";

import {
  ErroEvidencia,
  MAX_EVIDENCIAS_POR_ITEM,
  validarEvidencia,
  type TipoEvidencia,
} from "../schemas/evidencia";

import {
  auditarResposta,
  comRespostaBloqueada,
  exigirPodeResponder,
} from "./respostas";

const EXTENSAO: Record<TipoEvidencia, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/webm": "webm",
};

const parecerInvalidado = {
  resultadoIA: "NAO_SOLICITADA",
  motivoIA: null,
  confiancaIA: null,
  analisadaVersao: null,
  analiseIniciadaEm: null,
  revisadoPorId: null,
  revisadoEm: null,
};

export function urlDaEvidencia(respostaId: string, evidenciaId: string) {
  return `/api/checklists/${encodeURIComponent(respostaId)}/evidencias/${encodeURIComponent(evidenciaId)}`;
}

export async function gravarEvidencia(
  contexto: ContextoSessao,
  respostaId: string,
  dados: {
    itemId: string;
    versaoEsperada: number;
    bytes: Uint8Array;
    nome: string;
  },
) {
  const tipo = validarEvidencia(dados.bytes);
  const sha256 = createHash("sha256").update(dados.bytes).digest("hex");
  let caminhoCriado: string | null = null;
  try {
    return await comRespostaBloqueada(
      contexto,
      respostaId,
      async (tx, resposta) => {
        exigirPodeResponder(contexto, resposta);
        if (resposta.status !== "ABERTA")
          throw new ErroEvidencia("Este checklist já foi concluído.", 409);
        const item = await tx.respostaItem.findFirst({
          where: { id: dados.itemId, respostaId },
          include: {
            evidencias: {
              where: { excluidoEm: null },
              include: { arquivo: true },
            },
          },
        });
        if (!item) throw new ErroEvidencia("Item não encontrado.", 404);
        if (item.versao !== dados.versaoEsperada)
          throw new ErroEvidencia(
            "A resposta mudou. Atualize a página antes de enviar o arquivo.",
            409,
          );
        const repetida = item.evidencias.find(
          (e) =>
            e.sha256 === sha256 &&
            e.arquivo.enviadoPorId === contexto.usuario.id &&
            !e.arquivo.excluidoEm,
        );
        if (repetida)
          return {
            evidencia: {
              id: repetida.id,
              tipo,
              nome: repetida.arquivo.nomeOriginal,
              url: urlDaEvidencia(respostaId, repetida.id),
            },
            versao: item.versao,
          };
        if (item.evidencias.length >= MAX_EVIDENCIAS_POR_ITEM)
          throw new ErroEvidencia(
            "Cada item pode ter até 5 arquivos. Remova um antes de enviar outro.",
          );
        const agora = new Date();
        const relativo = path.posix.join(
          "checklists",
          String(agora.getUTCFullYear()),
          String(agora.getUTCMonth() + 1).padStart(2, "0"),
          `${randomBytes(16).toString("hex")}.${EXTENSAO[tipo]}`,
        );
        const destino = path.resolve(pastaDosArquivos(), relativo);
        await mkdir(path.dirname(destino), { recursive: true });
        await writeFile(destino, dados.bytes, { flag: "wx" });
        caminhoCriado = destino;
        const arquivo = await tx.arquivo.create({
          data: {
            organizacaoId: contexto.organizacao.id,
            unidadeId: resposta.unidadeId,
            enviadoPorId: contexto.usuario.id,
            caminho: relativo,
            tipo,
            tamanho: dados.bytes.length,
            nomeOriginal:
              dados.nome.replace(/[^\p{L}\p{N} ._-]/gu, "").slice(0, 120) ||
              `evidencia.${EXTENSAO[tipo]}`,
            permissaoLeitura: "checklists.ver",
            entidade: "RespostaItem",
            entidadeId: item.id,
          },
        });
        const evidencia = await tx.checklistEvidencia.create({
          data: { respostaItemId: item.id, arquivoId: arquivo.id, sha256 },
        });
        const atualizado = await tx.respostaItem.update({
          where: { id: item.id },
          data: { ...parecerInvalidado, versao: { increment: 1 } },
          select: { versao: true },
        });
        await tx.respostaDeChecklist.update({
          where: { id: respostaId },
          data: { versao: { increment: 1 } },
        });
        await auditarResposta(
          tx,
          contexto,
          respostaId,
          { itemId: item.id, versao: item.versao },
          {
            acao: "ENVIOU_EVIDENCIA",
            itemId: item.id,
            evidenciaId: evidencia.id,
            sha256,
            versao: atualizado.versao,
          },
        );
        return {
          evidencia: {
            id: evidencia.id,
            tipo,
            nome: arquivo.nomeOriginal,
            url: urlDaEvidencia(respostaId, evidencia.id),
          },
          versao: atualizado.versao,
        };
      },
    );
  } catch (erro) {
    // Remove somente o arquivo recém-criado cujo registro não foi confirmado.
    if (caminhoCriado) await unlink(caminhoCriado).catch(() => undefined);
    throw erro;
  }
}

export async function removerEvidencia(
  contexto: ContextoSessao,
  respostaId: string,
  evidenciaId: string,
  versaoEsperada: number,
) {
  return comRespostaBloqueada(contexto, respostaId, async (tx, resposta) => {
    exigirPodeResponder(contexto, resposta);
    if (resposta.status !== "ABERTA")
      throw new ErroEvidencia("Este checklist já foi concluído.", 409);
    const evidencia = await tx.checklistEvidencia.findFirst({
      where: {
        id: evidenciaId,
        excluidoEm: null,
        respostaItem: { respostaId },
      },
      include: { respostaItem: true },
    });
    if (!evidencia) throw new ErroEvidencia("Evidência não encontrada.", 404);
    if (evidencia.respostaItem.versao !== versaoEsperada)
      throw new ErroEvidencia(
        "A resposta mudou. Atualize a página antes de remover o arquivo.",
        409,
      );
    await tx.checklistEvidencia.update({
      where: { id: evidencia.id },
      data: { excluidoEm: new Date() },
    });
    await tx.arquivo.update({
      where: { id: evidencia.arquivoId },
      data: { excluidoEm: new Date() },
    });
    const item = await tx.respostaItem.update({
      where: { id: evidencia.respostaItemId },
      data: { ...parecerInvalidado, versao: { increment: 1 } },
      select: { versao: true },
    });
    await tx.respostaDeChecklist.update({
      where: { id: respostaId },
      data: { versao: { increment: 1 } },
    });
    await auditarResposta(
      tx,
      contexto,
      respostaId,
      { evidenciaId, versao: versaoEsperada },
      { acao: "REMOVEU_EVIDENCIA", evidenciaId, versao: item.versao },
    );
    return { versao: item.versao };
  });
}

export async function lerEvidencia(
  contexto: ContextoSessao,
  respostaId: string,
  evidenciaId: string,
) {
  if (!pode(contexto, "checklists.ver"))
    throw new SemPermissao("ver checklists");
  if (!contexto.unidadeAtiva) return null;
  const evidencia = await db.checklistEvidencia.findFirst({
    where: {
      id: evidenciaId,
      excluidoEm: null,
      respostaItem: {
        respostaId,
        resposta: {
          unidadeId: contexto.unidadeAtiva.id,
          modelo: { organizacaoId: contexto.organizacao.id },
        },
      },
      arquivo: {
        organizacaoId: contexto.organizacao.id,
        unidadeId: contexto.unidadeAtiva.id,
        excluidoEm: null,
      },
    },
    select: { arquivoId: true },
  });
  if (!evidencia) return null;
  return lerArquivo(evidencia.arquivoId);
}
