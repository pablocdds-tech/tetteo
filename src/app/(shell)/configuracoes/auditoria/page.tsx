import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import {
  entidadesAuditadas,
  listarAuditoria,
} from "@/core/configuracoes/servicos";
import { obterContexto, pode } from "@/core/sessao/contexto";

const quando = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const VERBO: Record<string, string> = {
  CRIOU: "criou",
  ALTEROU: "alterou",
  EXCLUIU: "excluiu",
  ACESSOU: "acessou",
};

const COR: Record<string, string> = {
  CRIOU: "bg-ok-sub text-ok",
  ALTEROU: "bg-info-sub text-info",
  EXCLUIU: "bg-bad-sub text-bad",
  ACESSOU: "bg-surface-3 text-ink-2",
};

/**
 * O HISTÓRICO.
 *
 * O sistema vem gravando isto desde o primeiro dia e até agora não havia como
 * ler. Existe para um momento específico: o dia em que um número não fecha e
 * a pergunta é "quem mexeu nisso?".
 *
 * É só leitura — não há botão de apagar em lugar nenhum, de propósito. Um
 * histórico que pode ser editado não serve para provar nada.
 */
export default async function PaginaAuditoria({
  searchParams,
}: {
  searchParams: Promise<{ entidade?: string; pagina?: string }>;
}) {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");
  if (!pode(contexto, "configuracoes.auditoria")) notFound();

  const { entidade, pagina } = await searchParams;

  const [registro, entidades] = await Promise.all([
    listarAuditoria(contexto, {
      entidade: entidade || undefined,
      pagina: Number(pagina) || 1,
    }),
    entidadesAuditadas(contexto),
  ]);

  const totalPaginas = Math.max(
    1,
    Math.ceil(registro.total / registro.porPagina),
  );

  return (
    <div className="mx-auto w-full max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight">Histórico</h1>
      <p className="text-ink-3 mt-1 text-sm">
        Quem mudou o quê, e quando · {registro.total.toLocaleString("pt-BR")}{" "}
        {registro.total === 1 ? "registro" : "registros"}
      </p>

      {entidades.length > 0 && (
        <div className="mt-5 flex flex-wrap gap-1.5">
          <Filtro href="/configuracoes/auditoria" ativo={!entidade}>
            Tudo
          </Filtro>
          {entidades.map((e) => (
            <Filtro
              key={e}
              href={`/configuracoes/auditoria?entidade=${encodeURIComponent(e)}`}
              ativo={entidade === e}
            >
              {e}
            </Filtro>
          ))}
        </div>
      )}

      {registro.linhas.length === 0 ? (
        <div className="border-line-2 bg-surface-2 mt-6 rounded-xl border border-dashed px-6 py-10 text-center">
          <p className="font-semibold">Nada registrado ainda</p>
          <p className="text-ink-3 mx-auto mt-1 max-w-md text-sm">
            Toda alteração de cadastro, contagem ou nota entra aqui
            automaticamente, com o nome de quem fez.
          </p>
        </div>
      ) : (
        <div className="border-line divide-line mt-4 divide-y rounded-xl border">
          {registro.linhas.map((l) => (
            <div key={l.id} className="flex flex-wrap gap-x-3 gap-y-1 px-4 py-3">
              <span
                className={`h-fit flex-none rounded-full px-2 py-0.5 text-[10px] font-semibold ${COR[l.acao] ?? ""}`}
              >
                {VERBO[l.acao] ?? l.acao}
              </span>

              <div className="min-w-0 flex-1">
                <span className="block text-sm">
                  <span className="font-medium">
                    {l.usuario?.nome ?? "sistema"}
                  </span>{" "}
                  <span className="text-ink-2">
                    {VERBO[l.acao] ?? l.acao} {l.entidade}
                  </span>
                </span>
                {(l.valoresAntes || l.valoresDepois) && (
                  <details className="mt-0.5">
                    <summary className="text-ink-3 cursor-pointer text-xs">
                      ver o que mudou
                    </summary>
                    <div className="text-ink-3 mt-1 grid gap-2 font-mono text-[11px] sm:grid-cols-2">
                      {l.valoresAntes != null && (
                        <div>
                          <p className="text-ink-3 mb-0.5 font-sans uppercase">
                            antes
                          </p>
                          <pre className="bg-surface-2 overflow-x-auto rounded p-2">
                            {JSON.stringify(l.valoresAntes, null, 1)}
                          </pre>
                        </div>
                      )}
                      {l.valoresDepois != null && (
                        <div>
                          <p className="text-ink-3 mb-0.5 font-sans uppercase">
                            depois
                          </p>
                          <pre className="bg-surface-2 overflow-x-auto rounded p-2">
                            {JSON.stringify(l.valoresDepois, null, 1)}
                          </pre>
                        </div>
                      )}
                    </div>
                  </details>
                )}
              </div>

              <span className="text-ink-3 h-fit flex-none text-xs tabular-nums">
                {quando.format(l.quando)}
              </span>
            </div>
          ))}
        </div>
      )}

      {totalPaginas > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-ink-3">
            Página {registro.pagina} de {totalPaginas}
          </span>
          <div className="flex gap-2">
            {registro.pagina > 1 && (
              <Link
                href={`/configuracoes/auditoria?${new URLSearchParams({ ...(entidade ? { entidade } : {}), pagina: String(registro.pagina - 1) })}`}
                className="text-accent hover:underline"
              >
                ← Mais recentes
              </Link>
            )}
            {registro.pagina < totalPaginas && (
              <Link
                href={`/configuracoes/auditoria?${new URLSearchParams({ ...(entidade ? { entidade } : {}), pagina: String(registro.pagina + 1) })}`}
                className="text-accent hover:underline"
              >
                Mais antigas →
              </Link>
            )}
          </div>
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
      className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
        ativo
          ? "bg-accent text-accent-ink"
          : "bg-surface-2 text-ink-2 hover:bg-surface-3"
      }`}
    >
      {children}
    </Link>
  );
}
