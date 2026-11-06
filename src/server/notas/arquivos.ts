import { mkdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { db } from "@/server/db";
import { pastaDosArquivos } from "@/server/arquivos";
import {
  LIMITE_DOCUMENTO_NOTA,
  tipoDocumentoNota,
  type TipoDocumentoNota,
} from "./documento";
const extensoes: Record<TipoDocumentoNota, string> = {
  "application/xml": "xml",
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
export async function gravarArquivoFiscal(d: {
  organizacaoId: string;
  unidadeId: string;
  usuarioId: string;
  bytes: Uint8Array;
  tipo: TipoDocumentoNota;
  variante: string;
}) {
  if (
    d.bytes.length > LIMITE_DOCUMENTO_NOTA ||
    tipoDocumentoNota(d.bytes) !== d.tipo
  )
    throw new Error("Arquivo fiscal inválido ou acima de 20 MB.");
  const agora = new Date(),
    relativo = path.posix.join(
      "notas",
      String(agora.getUTCFullYear()),
      String(agora.getUTCMonth() + 1).padStart(2, "0"),
      `${randomBytes(20).toString("hex")}.${extensoes[d.tipo]}`,
    );
  const destino = path.join(pastaDosArquivos(), relativo);
  await mkdir(path.dirname(destino), { recursive: true });
  await writeFile(destino, d.bytes, { flag: "wx", mode: 0o600 });
  return db.arquivo.create({
    data: {
      organizacaoId: d.organizacaoId,
      unidadeId: d.unidadeId,
      enviadoPorId: d.usuarioId,
      caminho: relativo,
      tipo: d.tipo,
      tamanho: d.bytes.length,
      nomeOriginal: `nota-${d.variante.replace(/[^a-z0-9-]/gi, "").slice(0, 60)}`,
      permissaoLeitura: "estoque.ver",
    },
    select: { id: true },
  });
}
