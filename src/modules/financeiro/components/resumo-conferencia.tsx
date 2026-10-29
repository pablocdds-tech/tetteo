import { Icone } from "@/design-system/icones";
import {
  estados,
  fontes,
  rotuloFonte,
  type Cobertura,
} from "../schemas/conferencia";

export function CoberturaFontes({
  cobertura,
  importacoes,
  onImportar,
}: {
  cobertura?: Cobertura;
  importacoes: {
    id: string;
    fonte: string;
    estado: string;
    criadoEm: unknown;
    lidas: number;
    rejeitadas: number;
    ignoradas: number;
  }[];
  onImportar: () => void;
}) {
  return (
    <section
      aria-label="Cobertura das três fontes"
      className="border-line bg-surface overflow-hidden rounded-2xl border"
    >
      <div className="border-line flex flex-wrap items-center justify-between gap-2 border-b px-5 py-4">
        <h2 className="font-bold">As três fontes da conferência</h2>
        <button
          onClick={onImportar}
          className="text-accent min-h-10 text-sm font-semibold"
        >
          Ver arquivos e cobertura →
        </button>
      </div>
      <div className="grid gap-5 p-5 md:grid-cols-3">
        {fontes.map((f, indice) => {
          const arquivos = importacoes.filter(
            (i) => i.fonte === f && i.estado !== "DESCARTADA",
          );
          const c = cobertura?.[f];
          const ultimo = arquivos
            .map((i) => new Date(String(i.criadoEm)))
            .sort((a, b) => b.getTime() - a.getTime())[0];
          return (
            <div key={f} className="min-w-0">
              <div className="flex items-center gap-3">
                <span className="bg-surface-2 text-ink-2 flex size-9 shrink-0 items-center justify-center rounded-xl text-xs font-bold">
                  0{indice + 1}
                </span>
                <h3 className="text-sm font-semibold">{rotuloFonte[f]}</h3>
              </div>
              <p
                className={`mt-3 flex items-center gap-1.5 text-sm font-medium ${c?.completa ? "text-ok" : "text-warn"}`}
              >
                <Icone nome={c?.completa ? "check" : "relogio"} tamanho={16} />
                {c?.completa
                  ? "Cobertura declarada completa"
                  : arquivos.length
                    ? "Cobertura parcial"
                    : "Aguardando arquivo"}
              </p>
              <p className="text-ink-3 mt-1 text-xs leading-relaxed">
                {arquivos.length} arquivo(s) ·{" "}
                {arquivos.reduce((s, i) => s + i.lidas, 0)} linhas lidas
                <br />
                {arquivos.reduce((s, i) => s + i.rejeitadas, 0)} rejeitadas ·{" "}
                {arquivos.reduce((s, i) => s + i.ignoradas, 0)} ignoradas
              </p>
              {ultimo && (
                <p className="text-ink-3 mt-2 text-xs">
                  Última importação:{" "}
                  {ultimo.toLocaleString("pt-BR", {
                    timeZone: "America/Sao_Paulo",
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}{" "}
                  · Brasília
                </p>
              )}
              {c && (
                <p className="text-ink-3 mt-1 text-xs">
                  {c.de.split("-").reverse().join("/")} a{" "}
                  {c.ate.split("-").reverse().join("/")}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function PendenciasConferencia({
  resumo,
  selecionado,
  onSelect,
}: {
  resumo: { estado: string; categoria: string; _count: number }[];
  selecionado: string;
  onSelect: (estado: string) => void;
}) {
  const agrupado = new Map<string, number>();
  for (const r of resumo)
    if (!["RECONCILED", "CANCELLED"].includes(r.estado))
      agrupado.set(r.estado, (agrupado.get(r.estado) ?? 0) + r._count);
  const grupos = [...agrupado].sort((a, b) => b[1] - a[1]);
  const maior = Math.max(1, ...grupos.map(([, n]) => n));
  return (
    <section
      className="border-line bg-surface rounded-2xl border p-5"
      aria-label="Pendências por etapa"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-bold">Onde estão as pendências</h2>
        <span className="text-ink-3 text-xs">
          Todas as ocorrências da execução
        </span>
      </div>
      {grupos.length ? (
        <div className="mt-4 grid gap-x-7 gap-y-2 md:grid-cols-2">
          {grupos.map(([estado, quantidade]) => (
            <button
              key={estado}
              aria-pressed={selecionado === estado}
              onClick={() => onSelect(selecionado === estado ? "" : estado)}
              className="hover:bg-surface-2 min-h-14 rounded-lg px-2 py-2 text-left"
            >
              <span className="flex justify-between gap-3 text-sm">
                <span className="font-medium">{estados[estado] ?? estado}</span>
                <span className="text-ink-3 tabular-nums">
                  {quantidade} {quantidade === 1 ? "caso" : "casos"}
                </span>
              </span>
              <span className="bg-surface-2 mt-2 block h-1.5 overflow-hidden rounded-full">
                <span
                  className={`block h-full rounded-full ${estado === "POSSIBLE_MATCH" ? "bg-info" : "bg-warn"}`}
                  style={{ width: `${(quantidade / maior) * 100}%` }}
                />
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="text-ink-3 mt-4 flex items-center gap-2 text-sm">
          <Icone nome="check" className="text-ok" />
          Nenhuma pendência nesta execução. Confira a cobertura antes de fechar
          o período.
        </p>
      )}
    </section>
  );
}
