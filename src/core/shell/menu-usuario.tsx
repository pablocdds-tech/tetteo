import { signOut } from "@/core/auth";
import { Icone } from "@/design-system/icones";

/**
 * A CONTA, no rodapé da barra lateral.
 *
 * Nome, e-mail e sair. É o canto do "seu" — e por isso ele não some quando a
 * lista de destinos precisa rolar: a barra rola no meio, este bloco fica
 * ancorado embaixo. Ter que rolar até o fim de um menu para achar o botão de
 * sair é o tipo de coisa que só se descobre no dia em que o computador é
 * emprestado.
 */

/** Iniciais para o avatar, quando não há foto. */
function iniciais(nome: string) {
  return nome
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export function MenuUsuario({ nome, email }: { nome: string; email: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className="bg-accent-sub text-accent grid size-8 flex-none place-items-center rounded-full text-xs font-bold"
      >
        {iniciais(nome)}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm leading-5 font-semibold">
          {nome}
        </span>
        <span className="text-ink-3 block truncate text-xs leading-4">
          {email}
        </span>
      </span>

      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/login" });
        }}
        className="flex-none"
      >
        <button
          type="submit"
          className="text-ink-3 hover:bg-surface-2 hover:text-ink focus-visible:outline-accent desk:size-9 grid size-11 place-items-center rounded-md transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-3"
        >
          <Icone nome="sair" tamanho={17} />
          <span className="sr-only">Sair da conta de {nome}</span>
        </button>
      </form>
    </div>
  );
}
