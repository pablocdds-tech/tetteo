import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { LIMITE_DOCUMENTO_NOTA, LeituraNotaRecusada } from "./documento";
export type PdfFiscal = {
  texto: string;
  paginas: Uint8Array[];
  totalPaginas: number;
};
/** Processo separado contém falhas nativas do renderizador e não recebe segredos. */
export async function extrairPdfFiscal(bytes: Uint8Array): Promise<PdfFiscal> {
  if (!bytes.length || bytes.length > LIMITE_DOCUMENTO_NOTA)
    throw new LeituraNotaRecusada("PDF_TAMANHO", "Envie um PDF de até 20 MB.");
  const pacote = createRequire(
    path.join(process.cwd(), "package.json"),
  ).resolve("pdf-parse");
  const env: NodeJS.ProcessEnv = { NODE_ENV: "production" };
  for (const nome of [
    "PATH",
    "SystemRoot",
    "SYSTEMROOT",
    "WINDIR",
    "TEMP",
    "TMP",
  ])
    if (process.env[nome]) env[nome] = process.env[nome];
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--max-old-space-size=256",
        path.join(process.cwd(), "scripts/pdf-fiscal-worker.cjs"),
        pacote,
      ],
      {
        env,
        windowsHide: true,
        stdio: ["pipe", "pipe", "ignore"],
      },
    );
    const erro = () =>
      new LeituraNotaRecusada(
        "PDF_INVALIDO",
        "Não consegui extrair este PDF com segurança. Envie o XML ou um PDF de até cinco páginas, sem senha.",
      );
    const partes: Buffer[] = [];
    let tamanho = 0;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(erro());
    }, 25_000);
    child.stdout.on("data", (parte: Buffer) => {
      tamanho += parte.length;
      if (tamanho > 30_000_000) {
        child.kill("SIGKILL");
        reject(erro());
        return;
      }
      partes.push(parte);
    });
    child.once("error", () => {
      clearTimeout(timer);
      reject(erro());
    });
    child.stdin.on("error", () => {});
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 || tamanho > 30_000_000) {
        reject(erro());
        return;
      }
      try {
        const r = JSON.parse(Buffer.concat(partes).toString("utf8"));
        if (
          !r.ok ||
          typeof r.texto !== "string" ||
          r.texto.length > 240_000 ||
          !Number.isInteger(r.totalPaginas) ||
          r.totalPaginas < 1 ||
          r.totalPaginas > 5 ||
          !Array.isArray(r.paginas) ||
          r.paginas.length > 5
        )
          throw erro();
        const paginas = r.paginas.map((p: unknown) => {
          if (
            typeof p !== "string" ||
            p.length > 27_000_000 ||
            !/^[A-Za-z0-9+/]*={0,2}$/.test(p)
          )
            throw erro();
          const imagem = Buffer.from(p, "base64");
          if (
            imagem.length > LIMITE_DOCUMENTO_NOTA ||
            imagem.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
          )
            throw erro();
          return imagem;
        });
        resolve({ texto: r.texto, totalPaginas: r.totalPaginas, paginas });
      } catch {
        reject(erro());
      }
    });
    child.stdin.end(bytes);
  });
}
