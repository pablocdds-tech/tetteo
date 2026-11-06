import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Gera uma pasta com o servidor e SÓ as dependências realmente usadas.
  // É o que permite a imagem final não carregar node_modules inteiro:
  // ~180 MB em vez de ~1,5 GB. Publicação mais rápida, menos disco na VPS.
  output: "standalone",
  serverExternalPackages: ["pdf-parse", "sharp", "jsqr", "fast-xml-parser"],
  // Os workers termináveis resolvem estes pacotes pelo Node, fora do bundle.
  outputFileTracingIncludes: {
    "/api/notas/rascunhos": [
      "./scripts/pdf-fiscal-worker.cjs",
      "./node_modules/pdf-parse/**/*",
      "./node_modules/pdfjs-dist/**/*",
      "./node_modules/@napi-rs/canvas*/**/*",
      "./node_modules/jsqr/**/*",
    ],
    "/api/whatsapp/webhook": [
      "./scripts/pdf-fiscal-worker.cjs",
      "./node_modules/pdf-parse/**/*",
      "./node_modules/pdfjs-dist/**/*",
      "./node_modules/@napi-rs/canvas*/**/*",
      "./node_modules/jsqr/**/*",
    ],
    "/api/severina/tick": [
      "./scripts/pdf-fiscal-worker.cjs",
      "./node_modules/pdf-parse/**/*",
      "./node_modules/pdfjs-dist/**/*",
      "./node_modules/@napi-rs/canvas*/**/*",
      "./node_modules/jsqr/**/*",
    ],
  },
  // O upload de evidências tem teto de 20 MB mais o envelope multipart.
  experimental: { proxyClientMaxBodySize: "22mb" },
};

export default nextConfig;
