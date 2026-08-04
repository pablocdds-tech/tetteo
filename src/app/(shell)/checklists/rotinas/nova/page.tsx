import { notFound, redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { AvisoUnidade } from "@/modules/checklists/components/aviso-unidade";
import { FormularioRotina } from "@/modules/checklists/components/formulario-rotina";
import {
  listarResponsaveis,
  modelosSemRotina,
} from "@/modules/checklists/services/rotinas";

export default async function PaginaNovaRotina() {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");
  if (!pode(contexto, "checklists.editar")) notFound();

  if (!contexto.unidadeAtiva) {
    return (
      <div className="mx-auto w-full max-w-2xl">
        <Cabecalho />
        <div className="mt-6">
          <AvisoUnidade acao="Agendar checklist" />
        </div>
      </div>
    );
  }

  const [modelos, responsaveis] = await Promise.all([
    modelosSemRotina(contexto),
    listarResponsaveis(contexto),
  ]);

  return (
    <div className="mx-auto w-full max-w-2xl">
      <Cabecalho unidade={contexto.unidadeAtiva.nome} />
      <div className="mt-6">
        <FormularioRotina modelos={modelos} responsaveis={responsaveis} />
      </div>
    </div>
  );
}

function Cabecalho({ unidade }: { unidade?: string }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">
        Agendar um checklist
      </h1>
      <p className="text-ink-3 mt-1 text-sm">
        {unidade
          ? `A partir daqui a lista do dia cobra sozinha · ${unidade}`
          : "A partir daqui a lista do dia cobra sozinha"}
      </p>
    </div>
  );
}
