import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Gera uma pasta com o servidor e SÓ as dependências realmente usadas.
  // É o que permite a imagem final não carregar node_modules inteiro:
  // ~180 MB em vez de ~1,5 GB. Publicação mais rápida, menos disco na VPS.
  output: "standalone",
  // Permite que o preview do Base44 (origem externa) acesse os assets de dev.
  allowedDevOrigins: process.env.BASE44_PUBLIC_HOST_SUFFIX
    ? ["3000-" + process.env.BASE44_PUBLIC_HOST_SUFFIX]
    : [],
};

export default nextConfig;
