import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { AvisoUnidade } from "@/modules/checklists/components/aviso-unidade";
import { ListaPendencias } from "@/modules/checklists/components/lista-pendencias";
import { listarPendencias } from "@/modules/checklists/services/pendencias";
import { listarResponsaveis } from "@/modules/checklists/services/rotinas";

export default async function PaginaPendencias({
  searchParams,
}: {
  searchParams: Promise<{ resolvidas?: string }>;
}) {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");
  if (!pode(contexto, "checklists.ver")) notFound();

  if (!contexto.unidadeAtiva) {
    return (
      <div className="mx-auto w-full max-w-4xl">
        <Cabecalho />
        <div className="mt-6">
          <AvisoUnidade acao="Acompanhar pendências" />
        </div>
      </div>
    );
  }

  const { resolvidas } = await searchParams;
  const incluirResolvidas = resolvidas === "1";

  const [pendencias, responsaveis] = await Promise.all([
    listarPendencias(contexto, { incluirResolvidas }),
    listarResponsaveis(contexto),
  ]);

  return (
    <div className="mx-auto w-full max-w-4xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <Cabecalho unidade={contexto.unidadeAtiva.nome} />

        <div className="flex items-center gap-1 text-sm">
          <Filtro href="/checklists/pendencias" ativo={!incluirResolvidas}>
            Abertas
          </Filtro>
          <Filtro
            href="/checklists/pendencias?resolvidas=1"
            ativo={incluirResolvidas}
          >
            Com resolvidas
          </Filtro>
        </div>
      </div>

      <div className="mt-6">
        <ListaPendencias
          pendencias={pendencias}
          responsaveis={responsaveis}
          podeResolver={pode(contexto, "checklists.resolver")}
        />
      </div>
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
      <h1 className="text-2xl font-semibold tracking-tight">Pendências</h1>
      <p className="text-ink-3 mt-1 text-sm">
        {unidade
          ? `O que os checklists deixaram para consertar · ${unidade}`
          : "O que os checklists deixaram para consertar"}
      </p>
    </div>
  );
}
