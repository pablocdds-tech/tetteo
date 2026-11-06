import sharp from "sharp";
import { LeituraNotaRecusada } from "./documento";
export type ImagemNota = { bytes: Uint8Array; tipo: string; variante: string };
export type AnaliseImagem = {
  processada: ImagemNota;
  largura: number;
  altura: number;
  angulo: number;
  contraste: number;
  nitidez: number;
  ruim: boolean;
};
function inclinacao(data: Uint8Array, width: number, height: number): number {
  const pontos: { x: number; y: number }[] = [];
  const passo = Math.max(1, Math.ceil(Math.sqrt((width * height) / 100_000)));
  for (let y = 0; y < height; y += passo)
    for (let x = 0; x < width; x += passo)
      if (data[y * width + x] < 110) pontos.push({ x, y });
  if (pontos.length < 100 || pontos.length > 80_000) return 0;
  const score = (graus: number) => {
    const rad = (graus * Math.PI) / 180;
    const bins = new Map<number, number>();
    for (const p of pontos) {
      const linha = Math.round(
        (p.y * Math.cos(rad) + p.x * Math.sin(rad)) / passo,
      );
      bins.set(linha, (bins.get(linha) ?? 0) + 1);
    }
    return [...bins.values()].reduce((s, n) => s + n * n, 0);
  };
  const inicial = score(0);
  let melhor = inicial,
    angulo = 0;
  for (let a = -7; a <= 7; a += 0.5) {
    const s = score(a);
    if (s > melhor) {
      melhor = s;
      angulo = a;
    }
  }
  return melhor > inicial * 1.12 ? angulo : 0;
}
export async function prepararImagemNota(
  bytes: Uint8Array,
): Promise<AnaliseImagem> {
  try {
    const orientada = await sharp(bytes, {
      limitInputPixels: 20_000_000,
      failOn: "error",
      animated: false,
    })
      .autoOrient()
      .flatten({ background: "white" })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { width, height } = orientada.info;
    const contrasteOriginal = (
      await sharp(orientada.data, {
        raw: { width, height, channels: 1 },
      }).stats()
    ).channels[0].stdev;
    const angulo = inclinacao(orientada.data, width, height);
    const normalizada = await sharp(orientada.data, {
      raw: { width, height, channels: 1 },
    })
      .rotate(angulo, { background: "white" })
      .normalise({ lower: 1, upper: 99 })
      .sharpen({ sigma: 0.8 })
      .png()
      .toBuffer();
    // Recorta apenas bordas de fundo; o original permanece intacto e não há resize.
    let final: Buffer;
    try {
      final = await sharp(normalizada, { limitInputPixels: 24_000_000 })
        .trim({ background: "#ffffff", threshold: 10 })
        .extend({
          top: 16,
          bottom: 16,
          left: 16,
          right: 16,
          background: "white",
        })
        .png()
        .toBuffer();
    } catch {
      final = normalizada;
    }
    const s = await sharp(final).stats(),
      meta = await sharp(final).metadata();
    const { data, info } = await sharp(final)
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let soma = 0,
      soma2 = 0,
      n = 0;
    const passo = Math.max(1, Math.ceil(Math.sqrt(data.length / 120_000)));
    for (let y = 1; y < info.height - 1; y += passo)
      for (let x = 1; x < info.width - 1; x += passo) {
        const i = y * info.width + x,
          v =
            4 * data[i] -
            data[i - 1] -
            data[i + 1] -
            data[i - info.width] -
            data[i + info.width];
        soma += v;
        soma2 += v * v;
        n++;
      }
    const nitidez = n ? soma2 / n - (soma / n) ** 2 : 0,
      contraste = s.channels[0].stdev;
    const ruim =
      (meta.width ?? 0) < 180 ||
      (meta.height ?? 0) < 180 ||
      contrasteOriginal < 2 ||
      contraste < 8 ||
      nitidez < 2;
    return {
      processada: { bytes: final, tipo: "image/png", variante: "processada" },
      largura: width,
      altura: height,
      angulo,
      contraste,
      nitidez,
      ruim,
    };
  } catch {
    throw new LeituraNotaRecusada(
      "IMAGEM_INVALIDA",
      "Não consegui abrir a imagem com segurança. Envie o cupom esticado, com boa luz e enquadrado inteiro, de preferência como documento sem compressão.",
    );
  }
}
export async function recortesDaNota(
  imagens: ImagemNota[],
): Promise<ImagemNota[]> {
  const resultados: ImagemNota[] = [];
  for (const [pagina, imagem] of imagens.entries()) {
    const m = await sharp(imagem.bytes, {
      limitInputPixels: 24_000_000,
    }).metadata();
    if (!m.width || !m.height) continue;
    const faixas = [
      { nome: "cabecalho", top: 0, bottom: 0.3 },
      { nome: "itens", top: 0.2, bottom: 0.85 },
      { nome: "totais", top: 0.72, bottom: 1 },
    ];
    for (const f of faixas) {
      const top = Math.floor(m.height * f.top),
        height = Math.ceil(m.height * f.bottom) - top;
      const b = await sharp(imagem.bytes)
        .extract({ left: 0, top, width: m.width, height })
        .png()
        .toBuffer();
      resultados.push({
        bytes: b,
        tipo: "image/png",
        variante: `pagina-${pagina + 1}-${f.nome}`,
      });
    }
  }
  return resultados;
}
