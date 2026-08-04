import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { AvisoUnidade } from "@/modules/checklists/components/aviso-unidade";
import {
  listarHistorico,
  modelosDisponiveis,
} from "@/modules/checklists/services/respostas";

const data = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
});

export default async function PaginaHistorico({
  searchParams,
}: {
  searchParams: Promise<{ modelo?: string }>;
}) {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");
  if (!pode(contexto, "checklists.ver")) notFound();

  if (!contexto.unidadeAtiva) {
    return (
      <div className="mx-auto w-full max-w-4xl">
        <Cabecalho />
        <div className="mt-6">
          <AvisoUnidade acao="Ver o histórico" />
        </div>
      </div>
    );
  }

  const { modelo } = await searchParams;

  const [respostas, modelos] = await Promise.all([
    listarHistorico(contexto, { modeloId: modelo ?? null }),
    modelosDisponiveis(contexto),
  ]);

  // A média só sobre os que TÊM nota. Checklist de registro puro não tem, e
  // contá-lo como zero puxaria a média para baixo sem nenhum motivo.
  const comNota = respostas.filter((r) => r.pontuacao !== null);
  const media =
    comNota.length > 0
      ? comNota.reduce((total, r) => total + Number(r.pontuacao), 0) /
        comNota.length
      : null;

  return (
    <div className="mx-auto w-full max-w-4xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <Cabecalho unidade={contexto.unidadeAtiva.nome} />

        {media !== null && (
          <div className="text-right">
            <span className="block text-2xl font-semibold tabular-nums">
              {media.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%
            </span>
            <span className="text-ink-3 block text-xs">
              média dos últimos {comNota.length}
            </span>
          </div>
        )}
      </div>

      {modelos.length > 1 && (
        <div className="mt-4 flex flex-wrap items-center gap-1 text-sm">
          <Filtro href="/checklists/historico" ativo={!modelo}>
            Todos
          </Filtro>
          {modelos.map((m) => (
            <Filtro
              key={m.id}
              href={`/checklists/historico?modelo=${m.id}`}
              ativo={modelo === m.id}
            >
              {m.nome}
            </Filtro>
          ))}
        </div>
      )}

      {respostas.length === 0 ? (
        <p className="border-line-2 text-ink-3 mt-6 rounded-xl border border-dashed px-4 py-10 text-center text-sm">
          Nenhum checklist respondido ainda nesta loja.
        </p>
      ) : (
        <div className="border-line divide-line mt-6 divide-y rounded-xl border">
          {respostas.map((r) => (
            <Link
              key={r.id}
              href={`/checklists/${r.id}`}
              className="hover:bg-surface-2 flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 transition-colors"
            >
              <span className="text-ink-3 w-16 flex-none text-sm tabular-nums">
                {data.format(r.referencia)}
              </span>

              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {r.modelo.nome}
              </span>

              {r._count.pendencias > 0 && (
                <span className="bg-warn-sub text-warn rounded-full px-2 py-0.5 text-xs font-semibold">
                  {r._count.pendencias}{" "}
                  {r._count.pendencias === 1 ? "pendência" : "pendências"}
                </span>
              )}

              {r.status === "ABERTA" ? (
                <span className="text-ink-3 text-xs font-semibold">
                  em andamento
                </span>
              ) : r.pontuacao !== null ? (
                <span
                  className={`text-sm font-semibold tabular-nums ${
                    Number(r.pontuacao) >= 90
                      ? "text-ok"
                      : Number(r.pontuacao) >= 70
                        ? "text-warn"
                        : "text-bad"
                  }`}
                >
                  {Number(r.pontuacao).toLocaleString("pt-BR")}%
                </span>
              ) : (
                <span className="text-ink-3 text-xs">sem nota</span>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function Filtro({
  href,
  ativo,
  children,
}: {
  href: string;
  ativo: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`rounded-full px-3 py-1 font-medium ${
        ativo
          ? "bg-accent text-accent-ink"
          : "text-ink-2 hover:bg-surface-2 border-line-2 border"
      }`}
    >
      {children}
    </Link>
  );
}

function Cabecalho({ unidade }: { unidade?: string }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Histórico</h1>
      <p className="text-ink-3 mt-1 text-sm">
        {unidade
          ? `Checklists já respondidos · ${unidade}`
          : "Checklists já respondidos"}
      </p>
    </div>
  );
}
