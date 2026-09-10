import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Prisma } from "@prisma/client";

import { db } from "./db";
import {
  EXTENSAO,
  LIMITE_BYTES,
  tipoPelaAssinatura,
  type TipoAceito,
} from "./tipo-de-arquivo";

export { LIMITE_BYTES, tipoPelaAssinatura, type TipoAceito } from "./tipo-de-arquivo";

/**
 * OS ARQUIVOS PRIVADOS.
 *
 * Conforme `docs/superpowers/specs/2026-08-04-onde-os-arquivos-moram.md`:
 *
 *   o BYTE mora numa pasta persistente (`ARQUIVOS_DIR`), com nome aleatório,
 *   em pastas por ano e mês — nunca o nome original, nunca sequencial;
 *
 *   o DONO mora na tabela `arquivo`. Sem linha lá, o arquivo é órfão e não é
 *   servido;
 *
 *   a ENTREGA passa por rota que confere organização, loja e permissão — a
 *   pasta nunca é servida como estática.
 *
 * O tipo é conferido pela ASSINATURA do conteúdo (`tipo-de-arquivo.ts`), não
 * pela extensão. Só imagem, até 5 MB.
 *
 * Este arquivo não conhece permissão (a camada `server` não enxerga o Core):
 * quem chama confere `pode()` antes.
 */

export function pastaDosArquivos(): string {
  if (process.env.ARQUIVOS_DIR) return process.env.ARQUIVOS_DIR;
  return process.env.NODE_ENV === "production"
    ? "/app/arquivos"
    : path.join(process.cwd(), ".arquivos");
}

export class ArquivoRecusado extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ArquivoRecusado";
  }
}

export async function gravarArquivo(dados: {
  organizacaoId: string;
  unidadeId: string | null;
  enviadoPorId: string;
  bytes: Uint8Array;
  nomeOriginal: string;
  permissaoLeitura: string;
}): Promise<{ id: string; tipo: TipoAceito }> {
  if (dados.bytes.length === 0) throw new ArquivoRecusado("O arquivo está vazio.");
  if (dados.bytes.length > LIMITE_BYTES) {
    throw new ArquivoRecusado("A foto passa de 5 MB. Tire outra, ou reduza antes de enviar.");
  }
  const tipo = tipoPelaAssinatura(dados.bytes);
  if (!tipo) {
    throw new ArquivoRecusado("Só dá para enviar foto (JPG, PNG ou WebP).");
  }

  const agora = new Date();
  const relativo = path.posix.join(
    String(agora.getUTCFullYear()),
    String(agora.getUTCMonth() + 1).padStart(2, "0"),
    `${randomBytes(16).toString("hex")}.${EXTENSAO[tipo]}`,
  );
  const destino = path.join(pastaDosArquivos(), relativo);
  await mkdir(path.dirname(destino), { recursive: true });
  // `wx`: nunca sobrescreve — com 128 bits aleatórios não colide, mas se
  // colidir, falha em vez de trocar a foto de alguém.
  await writeFile(destino, dados.bytes, { flag: "wx" });

  const registro = await db.arquivo.create({
    data: {
      organizacaoId: dados.organizacaoId,
      unidadeId: dados.unidadeId,
      enviadoPorId: dados.enviadoPorId,
      caminho: relativo,
      tipo,
      tamanho: dados.bytes.length,
      nomeOriginal:
        dados.nomeOriginal.replace(/[^\p{L}\p{N} ._-]/gu, "").slice(0, 120) || "foto",
      permissaoLeitura: dados.permissaoLeitura,
    },
    select: { id: true },
  });
  return { id: registro.id, tipo };
}

/**
 * Liga fotos enviadas a quem as usa (ex.: um recebimento). Só vale para
 * arquivo da MESMA organização, enviado pela MESMA pessoa, e ainda sem dono —
 * não dá para "adotar" a foto de outro recebimento pelo id.
 */
export async function vincularArquivos(
  tx: Prisma.TransactionClient,
  ids: string[],
  dono: {
    organizacaoId: string;
    enviadoPorId: string;
    entidade: string;
    entidadeId: string;
  },
): Promise<void> {
  const unicos = [...new Set(ids)];
  if (unicos.length === 0) return;
  const r = await tx.arquivo.updateMany({
    where: {
      id: { in: unicos },
      organizacaoId: dono.organizacaoId,
      enviadoPorId: dono.enviadoPorId,
      entidade: null,
      excluidoEm: null,
    },
    data: { entidade: dono.entidade, entidadeId: dono.entidadeId },
  });
  if (r.count !== unicos.length) {
    throw new Error("Uma das fotos não foi encontrada, ou já pertence a outro registro.");
  }
}

export async function lerArquivo(id: string) {
  const registro = await db.arquivo.findFirst({
    where: { id, excluidoEm: null },
  });
  if (!registro) return null;

  const pasta = path.resolve(pastaDosArquivos());
  const completo = path.resolve(pasta, registro.caminho);
  // O caminho é gerado aqui mesmo, mas a trava fica: nada fora da pasta.
  if (!completo.startsWith(pasta + path.sep)) return null;

  try {
    return { registro, bytes: await readFile(completo) };
  } catch {
    return null;
  }
}
