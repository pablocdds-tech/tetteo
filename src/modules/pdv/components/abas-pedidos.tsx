import Link from "next/link";

export function AbasPedidos({ atual }: { atual: "quadro" | "agendados" }) {
  return (
    <nav
      aria-label="Visualização dos pedidos"
      className="border-line flex gap-5 border-b text-sm"
    >
      <Link
        href="/pdv"
        aria-current={atual === "quadro" ? "page" : undefined}
        className={`focus-visible:outline-accent border-b-2 px-1 py-3 font-semibold focus-visible:outline-2 ${atual === "quadro" ? "border-accent text-accent" : "text-ink-3 border-transparent"}`}
      >
        Em andamento
      </Link>
      <Link
        href="/pdv/agendamentos"
        aria-current={atual === "agendados" ? "page" : undefined}
        className={`focus-visible:outline-accent border-b-2 px-1 py-3 font-semibold focus-visible:outline-2 ${atual === "agendados" ? "border-accent text-accent" : "text-ink-3 border-transparent"}`}
      >
        Agendados
      </Link>
    </nav>
  );
}
