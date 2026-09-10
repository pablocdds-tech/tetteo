import type { Metadata, Viewport } from "next";
import "./globals.css";

/**
 * A RAIZ.
 *
 * Não há `next/font` aqui, e a ausência é uma decisão.
 *
 * A direção Aurora pede a tipografia do próprio sistema operacional de quem
 * está lendo — San Francisco no Mac e no iPhone, Segoe no Windows, Roboto no
 * Android. Isso custa zero byte de fonte: a tela desenha no primeiro quadro,
 * sem o lampejo de texto invisível esperando o arquivo chegar, e sem depender
 * de servidor nenhum além do nosso.
 *
 * A pilha inteira mora em `--font-sans`, no globals.css. Aqui só se declara o
 * idioma, o tema e a cor da barra do navegador.
 */

export const metadata: Metadata = {
  title: "Tetteo",
  description: "Sistema operacional da Vitaliano Pizzaria",
};

export const viewport: Viewport = {
  // A cor da barra do navegador acompanha o tema — a casca começa antes da
  // página. Os dois valores são --paper de cada tema, no globals.css.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f3f5" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1114" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      // O sistema é claro por padrão, independente do tema do computador.
      // O tema escuro continua desenhado e disponível: será usado pelo seletor
      // de tema e forçado no Modo Operação (cozinha, à noite).
      data-theme="light"
      className="h-full antialiased"
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
