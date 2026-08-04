import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { FormularioFicha } from "@/modules/cardapio/components/formulario-ficha";

export default async function PaginaNovaFicha() {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");
  if (!pode(contexto, "cardapio.editar")) notFound();

  return (
    <div className="mx-auto w-full max-w-2xl">
      <Link
        href="/cardapio/fichas"
        className="text-ink-3 hover:text-ink text-sm"
      >
        ← Fichas técnicas
      </Link>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Nova ficha</h1>
      <p className="text-ink-3 mt-1 text-sm">
        O cabeçalho primeiro. Os ingredientes vêm na tela seguinte, um a um.
      </p>

      <div className="mt-6">
        <FormularioFicha podeVerCustos={pode(contexto, "cardapio.custos")} />
      </div>
    </div>
  );
}
