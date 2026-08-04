import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { FormularioModelo } from "@/modules/checklists/components/formulario-modelo";

export default async function PaginaNovoModelo() {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");
  if (!pode(contexto, "checklists.editar")) notFound();

  return (
    <div className="mx-auto w-full max-w-2xl">
      <Link
        href="/checklists/modelos"
        className="text-ink-3 hover:text-ink text-sm"
      >
        ← Modelos
      </Link>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">
        Novo checklist
      </h1>
      <p className="text-ink-3 mt-1 text-sm">
        Dê o nome primeiro. As perguntas vêm na tela seguinte, uma a uma.
      </p>

      <div className="mt-6">
        <FormularioModelo />
      </div>
    </div>
  );
}
