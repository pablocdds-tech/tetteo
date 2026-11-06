import { Worker } from "node:worker_threads";
import { createRequire } from "node:module";
import path from "node:path";
import sharp from "sharp";
import { chaveFiscalValida } from "@/lib/documento-fiscal";
export function chaveDoQr(texto: string): string | null {
  if (texto.length > 4096) return null;
  const valores: string[] = [texto];
  try {
    const u = new URL(texto);
    for (const k of ["p", "chNFe", "chave", "chaveAcesso"])
      for (const v of u.searchParams.getAll(k)) valores.push(v);
  } catch {}
  const chaves = new Set(
    valores.flatMap((v) => v.match(/(?<!\d)\d{44}(?!\d)/g) ?? []),
  );
  return chaves.size === 1 ? [...chaves][0] : null;
}
export async function lerQrFiscal(
  bytes: Uint8Array,
): Promise<{ chave: string; valida: boolean } | null> {
  const { data, info } = await sharp(bytes, {
    limitInputPixels: 20_000_000,
    failOn: "error",
  })
    .autoOrient()
    .toColourspace("srgb")
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pacote = createRequire(
    path.join(process.cwd(), "package.json"),
  ).resolve("jsqr");
  const resultado = await new Promise<string | null>((resolve) => {
    const worker = new Worker(
      `const{parentPort,workerData:d}=require('node:worker_threads');const m=require(d.pacote);const qr=(m.default||m)(new Uint8ClampedArray(d.data),d.width,d.height,{inversionAttempts:'attemptBoth'});parentPort.postMessage(qr?.data??null);`,
      {
        eval: true,
        execArgv: [],
        workerData: { pacote, data, width: info.width, height: info.height },
        resourceLimits: { maxOldGenerationSizeMb: 128 },
      },
    );
    const timer = setTimeout(() => {
      void worker.terminate();
      resolve(null);
    }, 8_000);
    worker.once("message", (v: string | null) => {
      clearTimeout(timer);
      void worker.terminate();
      resolve(v);
    });
    worker.once("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    worker.once("exit", () => {
      clearTimeout(timer);
      resolve(null);
    });
  });
  const chave = resultado ? chaveDoQr(resultado) : null;
  return chave ? { chave, valida: chaveFiscalValida(chave) } : null;
}
