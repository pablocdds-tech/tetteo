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
  destrutivo: "bg-bad text-surface hover:brightness-110 active:brightness-90",
};

// 48px no Modo Operação: tablet de cozinha, mão com pressa.
const TAMANHOS: Record<Tamanho, string> = {
  pequeno: "h-8 px-3 text-sm rounded-md",
  medio: "h-10 px-4 text-base rounded-md",
  grande: "h-12 px-6 text-lg rounded-lg",
};

/**
 * O ESTILO DO BOTÃO, sem o botão.
 *
 * Existe por causa de um erro que se repete no sistema inteiro:
 * `<Link><Botao/></Link>` produz `<a><button></a>`. HTML não permite um
 * controle dentro de outro, e o resultado é real — o leitor de tela anuncia
 * dois elementos onde há um, e o Enter às vezes cai no `<a>` e às vezes no
 * `<button>`.
 *
 * A regra é: NAVEGA é `<a>`, FAZ é `<button>`. Quando um link precisa parecer
 * um botão, ele pede a classe aqui e continua sendo um link.
 */
export function estiloDeBotao(
  peso: Peso = "primario",
  tamanho: Tamanho = "medio",
) {
  return [
    "inline-flex items-center justify-center gap-2 font-semibold",
    "transition-[background-color,border-color,color,filter] duration-150",
    "focus-visible:outline-accent focus-visible:outline-2 focus-visible:outline-offset-3",
    PESOS[peso],
    TAMANHOS[tamanho],
  ].join(" ");
}

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
        estiloDeBotao(peso, tamanho),
        "disabled:cursor-not-allowed disabled:opacity-40",
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
