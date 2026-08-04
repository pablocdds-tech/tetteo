import { notFound, redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { hojeParaCampo } from "@/lib/data";
import { AvisoUnidade } from "@/modules/checklists/components/aviso-unidade";
import { FormularioAvulso } from "@/modules/checklists/components/formulario-avulso";
import { modelosDisponiveis } from "@/modules/checklists/services/respostas";

export default async function PaginaChecklistAvulso() {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");
  if (!pode(contexto, "checklists.responder")) notFound();

  if (!contexto.unidadeAtiva) {
    return (
      <div className="mx-auto w-full max-w-2xl">
        <Cabecalho />
        <div className="mt-6">
          <AvisoUnidade acao="Responder checklist" />
        </div>
      </div>
    );
  }

  const modelos = await modelosDisponiveis(contexto);

  return (
    <div className="mx-auto w-full max-w-2xl">
      <Cabecalho unidade={contexto.unidadeAtiva.nome} />
      <div className="mt-6">
        <FormularioAvulso modelos={modelos} hoje={hojeParaCampo()} />
      </div>
    </div>
  );
}

function Cabecalho({ unidade }: { unidade?: string }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">
        Checklist avulso
      </h1>
      <p className="text-ink-3 mt-1 text-sm">
        {unidade
          ? `Fora da agenda, sem virar rotina · ${unidade}`
          : "Fora da agenda, sem virar rotina"}
      </p>
    </div>
  );
}
