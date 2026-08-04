import type { ButtonHTMLAttributes } from "react";

/**
 * Botão.
 *
 * Quatro pesos. A regra mais importante é de quantidade: UMA ação primária
 * por tela. Duas primárias competindo significam que a tela não decidiu o que
 * ela é.
 *
 * O foco de teclado nunca é removido — é acessibilidade, e é o que permite
 * operar o sistema sem tirar a mão do teclado.
 */

type Peso = "primario" | "secundario" | "fantasma" | "destrutivo";
type Tamanho = "pequeno" | "medio" | "grande";

const PESOS: Record<Peso, string> = {
  primario:
    "bg-accent text-accent-ink hover:brightness-110 active:brightness-90",
  secundario:
    "bg-surface text-ink border border-line-2 hover:bg-surface-2 active:bg-surface-3",
  fantasma: "bg-transparent text-ink-2 hover:bg-surface-2 hover:text-ink",
  destrutivo: "bg-bad text-white hover:brightness-110 active:brightness-90",
};

// 48px no Modo Operação: tablet de cozinha, mão com pressa.
const TAMANHOS: Record<Tamanho, string> = {
  pequeno: "h-8 px-3 text-sm rounded-md",
  medio: "h-10 px-4 text-base rounded-md",
  grande: "h-12 px-6 text-lg rounded-lg",
};

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  peso?: Peso;
  tamanho?: Tamanho;
  carregando?: boolean;
};

export function Botao({
  peso = "primario",
  tamanho = "medio",
  carregando = false,
  disabled,
  className = "",
  children,
  ...resto
}: Props) {
  return (
    <button
      {...resto}
      disabled={disabled || carregando}
      aria-busy={carregando || undefined}
      className={[
        "inline-flex items-center justify-center gap-2 font-semibold",
        "transition-[background-color,border-color,color,filter] duration-150",
        "focus-visible:outline-accent focus-visible:outline-2 focus-visible:outline-offset-2",
        "disabled:cursor-not-allowed disabled:opacity-40",
        PESOS[peso],
        TAMANHOS[tamanho],
        className,
      ].join(" ")}
    >
      {carregando && (
        <span
          aria-hidden
          className="size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent"
        />
      )}
      {children}
    </button>
  );
}
