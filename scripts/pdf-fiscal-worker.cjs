/* Entrada não confiável; sem credenciais herdadas. Nunca executa texto do PDF. */
// CommonJS é executado diretamente pelo Node, fora do bundle do Next.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PDFParse } = require(process.argv[2]);
const partes = [];
let tamanho = 0;
process.stdin.on("data", (parte) => {
  tamanho += parte.length;
  if (tamanho > 20 * 1024 * 1024) process.exit(1);
  partes.push(parte);
});
process.stdin.on("end", async () => {
  let parser;
  try {
    parser = new PDFParse({
      data: new Uint8Array(Buffer.concat(partes)),
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
      stopAtErrors: true,
      maxImageSize: 20_000_000,
      useWorkerFetch: false,
    });
    const info = await parser.getInfo({ parsePageInfo: true });
    if (info.total < 1 || info.total > 5) throw Error("PDF_PAGINAS");
    const texto = (
      await parser.getText({ first: 5, pageJoiner: "", cellSeparator: "\t" })
    ).text;
    if (texto.length > 240_000) throw Error("PDF_TEXTO");
    let paginas = [];
    if (texto.replace(/\s/g, "").length < 60) {
      if (
        info.pages.length !== info.total ||
        info.pages.some(
          (p) =>
            !Number.isFinite(p.width * p.height) ||
            p.width <= 0 ||
            p.height <= 0 ||
            Math.ceil(p.width * 3) * Math.ceil(p.height * 3) > 20_000_000,
        )
      )
        throw Error("PDF_PIXELS");
      const resultado = await parser.getScreenshot({
        first: 5,
        scale: 3,
        imageDataUrl: false,
        imageBuffer: true,
      });
      let bytes = 0;
      paginas = resultado.pages.map((p) => {
        bytes += p.data.length;
        if (p.width * p.height > 20_000_000 || bytes > 20_000_000)
          throw Error("PDF_PIXELS");
        return Buffer.from(p.data).toString("base64");
      });
    }
    await parser.destroy();
    parser = null;
    process.stdout.write(
      JSON.stringify({ ok: true, texto, paginas, totalPaginas: info.total }),
    );
  } catch {
    if (parser) await parser.destroy().catch(() => {});
    process.exitCode = 1;
  }
});
