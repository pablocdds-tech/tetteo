import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { Botao } from "@/design-system/botao";
import { AvisoUnidade } from "@/modules/checklists/components/aviso-unidade";
import { PainelDoDia } from "@/modules/checklists/components/painel-do-dia";
import { contarPendenciasAbertas } from "@/modules/checklists/services/pendencias";
import { listarDoDia } from "@/modules/checklists/services/rotinas";

/** A rota só delega: quem sabe o que é um checklist é o App, não o roteamento. */
export default async function PaginaChecklists() {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");
  if (!pode(contexto, "checklists.ver")) notFound();

  const podeResponder = pode(contexto, "checklists.responder");
  const podeEditar = pode(contexto, "checklists.editar");

  if (!contexto.unidadeAtiva) {
    return (
      <div className="mx-auto w-full max-w-5xl">
        <Cabecalho />
        <div className="mt-6">
          <AvisoUnidade acao="Responder checklist" />
        </div>
      </div>
    );
  }

  const [rotinas, pendencias] = await Promise.all([
    listarDoDia(contexto),
    contarPendenciasAbertas(contexto),
  ]);

  const atrasadas = rotinas.filter((r) => r.status === "atrasada").length;

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <Cabecalho unidade={contexto.unidadeAtiva.nome} />

        <div className="flex flex-wrap items-center gap-2">
          {podeResponder && (
            <Link href="/checklists/nova">
              <Botao peso="secundario">Checklist avulso</Botao>
            </Link>
          )}
          {podeEditar && rotinas.length > 0 && (
            <Link href="/checklists/rotinas/nova">
              <Botao peso="secundario">Agendar</Botao>
            </Link>
          )}
        </div>
      </div>

      {/* A pendência é o que sobra do checklist de ontem. Ela precisa aparecer
          ANTES da lista de hoje, senão vira uma tela que ninguém abre — e o
          módulo inteiro volta a ser ritual. */}
      {pendencias > 0 && (
        <Link
          href="/checklists/pendencias"
          className="border-line bg-warn-sub hover:border-warn mt-5 flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors"
        >
          <span aria-hidden className="text-lg">
            ⚠️
          </span>
          <span className="min-w-0 flex-1 text-sm">
            <span className="text-warn block font-semibold">
              {pendencias}{" "}
              {pendencias === 1
                ? "pendência esperando conserto"
                : "pendências esperando conserto"}
            </span>
            <span className="text-ink-2 block">
              Apontado num checklist e ainda não resolvido.
            </span>
          </span>
          <span className="text-ink-2 flex-none text-sm">Ver →</span>
        </Link>
      )}

      <section className="mt-6">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold">Hoje</h2>
          {atrasadas > 0 && (
            <span className="text-bad text-sm font-semibold">
              {atrasadas} {atrasadas === 1 ? "atrasado" : "atrasados"}
            </span>
          )}
        </div>

        <PainelDoDia
          rotinas={rotinas}
          podeResponder={podeResponder}
          podeEditar={podeEditar}
        />
      </section>
    </div>
  );
}

function Cabecalho({ unidade }: { unidade?: string }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Checklists</h1>
      <p className="text-ink-3 mt-1 text-sm">
        {unidade
          ? `O que precisa ser feito · ${unidade}`
          : "O que precisa ser feito"}
      </p>
    </div>
  );
}
