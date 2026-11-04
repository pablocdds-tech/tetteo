import Link from "next/link";
import { Icone } from "@/design-system/icones";

export type IndicadorDeAcao = {
  rotulo: string;
  valor: string;
  apoio: string;
  icone: string;
  href: string;
  acao: string;
  tom?: "normal" | "critico" | "atencao" | "positivo";
};

const tons = {
  normal: "text-ink",
  critico: "text-bad",
  atencao: "text-warn",
  positivo: "text-ok",
};

export function ResumoFinanceiro({
  indicadores,
}: {
  indicadores: IndicadorDeAcao[];
}) {
  return (
    <section
      aria-label="Resumo financeiro e pendências"
      className={`border-line bg-surface grid overflow-hidden rounded-xl border ${indicadores.length >= 4 ? "sm:grid-cols-2 xl:grid-cols-4" : indicadores.length === 3 ? "sm:grid-cols-3" : indicadores.length === 2 ? "sm:grid-cols-2" : ""}`}
    >
      {indicadores.map((item) => (
        <Link
          key={item.rotulo}
          href={item.href}
          scroll={true}
          className="group border-line hover:bg-surface-2 focus-visible:outline-accent flex min-w-0 flex-col gap-2 border-b p-4 transition-colors duration-150 last:border-b-0 focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2 sm:border-r sm:even:border-r-0 xl:border-b-0 xl:last:border-r-0 xl:even:border-r"
        >
          <span className="text-ink-2 flex items-center justify-between gap-2 text-sm font-medium">
            {item.rotulo}
            <Icone nome={item.icone} tamanho={18} />
          </span>
          <span
            className={`text-2xl leading-8 font-semibold tracking-tight tabular-nums ${tons[item.tom ?? "normal"]}`}
          >
            {item.valor}
          </span>
          <span className="text-ink-3 min-h-9 text-xs leading-[18px]">
            {item.apoio}
          </span>
          <span className="text-accent mt-auto flex items-center gap-1 text-sm font-semibold">
            {item.acao}
            <span className="motion-safe:transition-transform motion-safe:group-hover:translate-x-1">
              <Icone nome="seta-direita" tamanho={14} />
            </span>
          </span>
        </Link>
      ))}
    </section>
  );
}
