import type { ReactNode } from "react";

/**
 * OS ÍCONES.
 *
 * Desenhados aqui, não emprestados de uma fonte de emoji. A diferença não é
 * estética: emoji é COLORIDO E FIXO. Ele não escurece junto com o texto, não
 * clareia no tema escuro, muda de forma a cada sistema operacional e não tem
 * como ser lido por um leitor de tela. Um ícone que muda de desenho conforme
 * o computador da pessoa não é um sistema de ícones — é sorte.
 *
 * Todos partem da mesma grade de 24×24, com traço de 1,6 e pontas
 * arredondadas. É essa uniformidade que faz quinze desenhos diferentes
 * parecerem uma família só, e é a primeira coisa que se perde quando alguém
 * cola um SVG achado na internet no meio deles.
 *
 * O ícone é sempre `aria-hidden`: quem precisa do nome recebe TEXTO ao lado,
 * ou um `aria-label` no botão que o contém. Ícone nunca é o único jeito de
 * saber o que uma coisa faz.
 */

const ICONES: Record<string, ReactNode> = {
  // ---- Identidade dos Apps -------------------------------------------------
  grafico: <path d="M4 4v16h16M8.5 20v-5.5M13 20v-9M17.5 20v-4" />,

  coracao: (
    <path d="M12 20.2s-7.4-4.5-7.4-9.8A4.6 4.6 0 0 1 12 7a4.6 4.6 0 0 1 7.4 3.4c0 5.3-7.4 9.8-7.4 9.8Z" />
  ),

  brilho: (
    <>
      <path d="m11 3 1.7 4.8L17.5 9.5l-4.8 1.7L11 16l-1.7-4.8L4.5 9.5l4.8-1.7L11 3Z" />
      <path d="m18.5 14.5.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9.9-2.3Z" />
    </>
  ),

  carrinho: (
    <>
      <path d="M2.5 4h2.2l2.4 10.6a1.8 1.8 0 0 0 1.8 1.4h7.4a1.8 1.8 0 0 0 1.8-1.4L19.8 8H6" />
      <circle cx="9.5" cy="19.5" r="1.5" />
      <circle cx="17" cy="19.5" r="1.5" />
    </>
  ),

  prato: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4" />
    </>
  ),

  caixa: (
    <>
      <path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5v-9Z" />
      <path d="M3.5 7.5 12 12l8.5-4.5M12 12v9" />
    </>
  ),

  moeda: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M14.6 9.3A3.2 3.2 0 0 0 12 8.1c-1.7 0-3 .9-3 2.1 0 2.7 6 1.2 6 3.8 0 1.2-1.3 2.1-3 2.1a3.2 3.2 0 0 1-2.6-1.2M12 6.4v1.7M12 15.9v1.7" />
    </>
  ),

  "lista-conferida": (
    <>
      <path d="M9 4.5H7.4A1.6 1.6 0 0 0 5.8 6.1v13.3A1.6 1.6 0 0 0 7.4 21h9.2a1.6 1.6 0 0 0 1.6-1.6V6.1A1.6 1.6 0 0 0 16.6 4.5H15" />
      <rect x="9" y="3" width="6" height="3.2" rx="1.1" />
      <path d="m9.3 13.2 1.9 1.9 3.8-4" />
    </>
  ),

  entrega: (
    <>
      <path d="M3 6.6h10a1 1 0 0 1 1 1v8.9H4a1 1 0 0 1-1-1V6.6Z" />
      <path d="M14 10.2h3.1a1 1 0 0 1 .8.4l1.9 2.5a1 1 0 0 1 .2.6v2.8h-6" />
      <circle cx="7.4" cy="18.6" r="1.9" />
      <circle cx="17" cy="18.6" r="1.9" />
    </>
  ),

  ferramenta: (
    <path d="M15.4 3.5a5 5 0 0 0-4.6 6.9L3.5 17.7 6.3 20.5l7.3-7.3a5 5 0 0 0 6.9-4.6 5 5 0 0 0-.4-2l-3.3 3.3-2.5-2.5L17.6 4a5 5 0 0 0-2.2-.5Z" />
  ),

  olho: (
    <>
      <path d="M2.6 12S6.2 5.6 12 5.6 21.4 12 21.4 12 17.8 18.4 12 18.4 2.6 12 2.6 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),

  monitor: (
    <>
      <rect x="3" y="4.5" width="18" height="12" rx="1.8" />
      <path d="M9 20.5h6M12 16.5v4" />
    </>
  ),

  pessoas: (
    <>
      <circle cx="9.2" cy="8" r="3.4" />
      <path d="M3 19.8a6.2 6.2 0 0 1 12.4 0" />
      <path d="M16.4 5.1a3.4 3.4 0 0 1 0 5.9M17.8 14.3a6.2 6.2 0 0 1 3.2 5.5" />
    </>
  ),

  broto: (
    <>
      <path d="M12 20.5v-7.2" />
      <path d="M12 13.3c0-3.1 2.3-5.4 5.4-5.4 0 3.1-2.3 5.4-5.4 5.4Z" />
      <path d="M12 15.8c0-2.6-2-4.6-4.6-4.6 0 2.6 2 4.6 4.6 4.6Z" />
    </>
  ),

  engrenagem: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.1 14.6a1.6 1.6 0 0 0 .3 1.8l.1.1a1.95 1.95 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5v.2a1.95 1.95 0 1 1-3.9 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a1.95 1.95 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1h-.2a1.95 1.95 0 1 1 0-3.9h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a1.95 1.95 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3h.1a1.6 1.6 0 0 0 1-1.5v-.2a1.95 1.95 0 1 1 3.9 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a1.95 1.95 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8v.1a1.6 1.6 0 0 0 1.5 1h.2a1.95 1.95 0 1 1 0 3.9h-.1a1.6 1.6 0 0 0-1.5 1Z" />
    </>
  ),

  // ---- Interface -----------------------------------------------------------
  casa: (
    <>
      <path d="M3.4 10.6 12 3.4l8.6 7.2" />
      <path d="M5.6 9.8v9.4A1.5 1.5 0 0 0 7.1 20.7h9.8a1.5 1.5 0 0 0 1.5-1.5V9.8" />
      <path d="M9.9 20.7v-5.6h4.2v5.6" />
    </>
  ),

  lupa: (
    <>
      <circle cx="10.5" cy="10.5" r="6.6" />
      <path d="m20.2 20.2-5-5" />
    </>
  ),

  menu: <path d="M3.5 6.5h17M3.5 12h17M3.5 17.5h17" />,

  fechar: <path d="m5.6 5.6 12.8 12.8M18.4 5.6 5.6 18.4" />,

  "seta-baixo": <path d="m6.2 9.4 5.8 5.8 5.8-5.8" />,

  "seta-direita": <path d="m9.6 5.8 6.2 6.2-6.2 6.2" />,

  "seta-esquerda": <path d="M14.4 5.8 8.2 12l6.2 6.2" />,

  alerta: (
    <>
      <path d="M12 4.2 21.2 19.8H2.8L12 4.2Z" />
      <path d="M12 10.2v4M12 17.2h.01" />
    </>
  ),

  relogio: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 6.8v5.4l3.4 2" />
    </>
  ),

  check: <path d="m4.8 12.4 4.7 4.7L19.2 7.4" />,

  circulo: <circle cx="12" cy="12" r="8.5" />,

  pessoa: (
    <>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.8 20.4a7.2 7.2 0 0 1 14.4 0" />
    </>
  ),

  sair: (
    <>
      <path d="M14.2 7.8V6a1.6 1.6 0 0 0-1.6-1.6H6.4A1.6 1.6 0 0 0 4.8 6v12a1.6 1.6 0 0 0 1.6 1.6h6.2a1.6 1.6 0 0 0 1.6-1.6v-1.8" />
      <path d="M9.8 12h10.4" />
      <path d="m17.2 8.6 3.4 3.4-3.4 3.4" />
    </>
  ),

  grade: (
    <>
      <rect x="3.8" y="3.8" width="7" height="7" rx="1.6" />
      <rect x="13.2" y="3.8" width="7" height="7" rx="1.6" />
      <rect x="3.8" y="13.2" width="7" height="7" rx="1.6" />
      <rect x="13.2" y="13.2" width="7" height="7" rx="1.6" />
    </>
  ),

  filtro: <path d="M3.8 5.4h16.4l-6.4 7.5v5.6l-3.6 2v-7.6L3.8 5.4Z" />,

  baixar: (
    <>
      <path d="M12 3.8v10.6" />
      <path d="m7.8 10.6 4.2 4.2 4.2-4.2" />
      <path d="M4.6 19.6h14.8" />
    </>
  ),

  atualizar: (
    <>
      <path d="M20.2 12a8.2 8.2 0 1 1-2.5-5.9" />
      <path d="M20.6 3.6v4.8h-4.8" />
    </>
  ),

  "sem-sinal": (
    <>
      <path d="M17.4 17.6H7.2a4.2 4.2 0 0 1-.7-8.3 5.7 5.7 0 0 1 8.9-3.4" />
      <path d="m3.4 3.4 17.2 17.2" />
    </>
  ),

  cadeado: (
    <>
      <rect x="4.8" y="10.4" width="14.4" height="9.6" rx="2" />
      <path d="M8.2 10.4V7.7a3.8 3.8 0 0 1 7.6 0v2.7" />
    </>
  ),

  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11.2v5M12 7.8h.01" />
    </>
  ),

  entrada: (
    <>
      <path d="M3.4 13.6h4.2l1.3 2.5h6.2l1.3-2.5h4.2" />
      <path d="M3.4 13.6 6 5.3a1.6 1.6 0 0 1 1.5-1.1h9a1.6 1.6 0 0 1 1.5 1.1l2.6 8.3v4.9a1.6 1.6 0 0 1-1.6 1.6H5a1.6 1.6 0 0 1-1.6-1.6v-4.9Z" />
    </>
  ),

  mais: <path d="M12 5.2v13.6M5.2 12h13.6" />,
};

export type NomeDeIcone = keyof typeof ICONES & string;

export function Icone({
  nome,
  tamanho = 18,
  className = "",
}: {
  nome: NomeDeIcone;
  /** 18px é o tamanho do sistema. Só troque com motivo. */
  tamanho?: number;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      width={tamanho}
      height={tamanho}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`flex-none ${className}`}
    >
      {ICONES[nome]}
    </svg>
  );
}
