import { signOut } from "@/core/auth";

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
    <div className="flex items-center gap-3">
      <div className="hidden text-right sm:block">
        <p className="text-sm leading-tight font-semibold">{nome}</p>
        <p className="text-ink-3 text-xs leading-tight">{email}</p>
      </div>

      <span
        aria-hidden
        className="bg-accent-sub text-accent grid size-8 flex-none place-items-center rounded-full text-xs font-bold"
      >
        {iniciais(nome)}
      </span>

      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/login" });
        }}
      >
        <button
          type="submit"
          className="text-ink-3 hover:bg-surface-2 hover:text-ink rounded-md px-2 py-1 text-sm transition-colors"
        >
          Sair
        </button>
      </form>
    </div>
  );
}
