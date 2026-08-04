import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Gera uma pasta com o servidor e SÓ as dependências realmente usadas.
  // É o que permite a imagem final não carregar node_modules inteiro:
  // ~180 MB em vez de ~1,5 GB. Publicação mais rápida, menos disco na VPS.
  output: "standalone",
};

export default nextConfig;
