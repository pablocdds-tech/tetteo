import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import { pastaDosArquivos } from "./arquivos";
import { tipoPelaAssinatura, EXTENSAO } from "./tipo-de-arquivo";

/** Documento privado, nunca servido por pasta pública. Leitura usa /api/arquivos. */
export async function gravarDocumentoPrivado(
  tx: Prisma.TransactionClient,
  d: {
    organizacaoId: string;
    unidadeId: string;
    usuarioId: string;
    pessoaId: string;
    bytes: Uint8Array;
    nome: string;
  },
) {
  if (!d.bytes.length || d.bytes.length > 5 * 1024 * 1024)
    throw new Error("Envie um documento de até 5 MB.");
  const imagem = tipoPelaAssinatura(d.bytes),
    pdf = Buffer.from(d.bytes.subarray(0, 5)).toString("ascii") === "%PDF-";
  if (!imagem && !pdf) throw new Error("Envie PDF, JPG, PNG ou WebP.");
  const tipo = pdf ? "application/pdf" : imagem!;
  const caminho = path.posix.join(
    "documentos-financeiro",
    `${randomBytes(24).toString("hex")}.${pdf ? "pdf" : EXTENSAO[imagem!]}`,
  );
  const destino = path.join(pastaDosArquivos(), caminho);
  await mkdir(path.dirname(destino), { recursive: true });
  await writeFile(destino, d.bytes, { flag: "wx" });
  return tx.arquivo.create({
    data: {
      organizacaoId: d.organizacaoId,
      unidadeId: d.unidadeId,
      enviadoPorId: d.usuarioId,
      caminho,
      tipo,
      tamanho: d.bytes.length,
      nomeOriginal:
        d.nome.replace(/[^\p{L}\p{N} ._-]/gu, "").slice(0, 120) || "documento",
      permissaoLeitura: "financeiro.ver",
      entidade: "PessoaFinanceira",
      entidadeId: d.pessoaId,
    },
    select: { id: true, nomeOriginal: true },
  });
}
