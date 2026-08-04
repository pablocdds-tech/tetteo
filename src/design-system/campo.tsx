import type { InputHTMLAttributes, ReactNode } from "react";
import { useId } from "react";

/**
 * Campo de formulário.
 *
 * Regra inegociável: o rótulo fica ACIMA do campo e nunca some. Usar o texto
 * de dica como rótulo (aquele que desaparece ao digitar) é o erro de
 * formulário mais comum que existe — a pessoa preenche cinco campos, é
 * interrompida, volta e não sabe mais o que era cada um. Num sistema de
 * gestão, interrupção é o estado normal.
 *
 * A mensagem de erro diz o que fazer. "Campo inválido" não ajuda ninguém;
 * "o custo não pode ser negativo" resolve em um segundo.
 */

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "id"> & {
  rotulo: string;
  erro?: string;
  ajuda?: ReactNode;
};

export function Campo({
  rotulo,
  erro,
  ajuda,
  className = "",
  ...resto
}: Props) {
  const id = useId();
  const idAjuda = `${id}-ajuda`;

  return (
    <div className="flex w-full flex-col gap-1.5">
      <label htmlFor={id} className="text-ink-2 text-sm font-semibold">
        {rotulo}
      </label>

      <input
        {...resto}
        id={id}
        aria-invalid={erro ? true : undefined}
        aria-describedby={erro || ajuda ? idAjuda : undefined}
        className={[
          "bg-surface text-ink h-10 w-full rounded-md border px-3 text-base",
          "placeholder:text-ink-3",
          "transition-[border-color,box-shadow] duration-150",
          "focus:outline-none",
          erro
            ? "border-bad focus:shadow-[0_0_0_3px_var(--bad-sub)]"
            : "border-line-2 hover:border-ink-3 focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-sub)]",
          "disabled:bg-surface-2 disabled:text-ink-3 disabled:cursor-not-allowed",
          "read-only:bg-surface-2 read-only:border-dashed",
          className,
        ].join(" ")}
      />

      {(erro || ajuda) && (
        <span
          id={idAjuda}
          className={`text-sm ${erro ? "text-bad" : "text-ink-3"}`}
        >
          {erro ?? ajuda}
        </span>
      )}
    </div>
  );
}
