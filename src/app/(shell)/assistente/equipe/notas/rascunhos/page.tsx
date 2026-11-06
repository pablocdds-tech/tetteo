import { redirect, notFound } from "next/navigation";
import { obterContexto, pode } from "@/core/sessao/contexto";
import { FormularioRascunhoFiscal } from "@/modules/assistente/components/formulario-rascunho-fiscal";

export default async function PaginaRascunhosFiscais() {
  const ctx = await obterContexto();
  if (!ctx) redirect("/login");
  if (
    !["assistente.ver", "estoque.ver", "estoque.lancar"].every((p) =>
      pode(ctx, p),
    )
  )
    notFound();
  if (!ctx.unidadeAtiva)
    return <p>Selecione uma unidade para preparar um rascunho fiscal.</p>;
  return (
    <FormularioRascunhoFiscal
      key={ctx.unidadeAtiva.id}
      unidadeId={ctx.unidadeAtiva.id}
      unidade={ctx.unidadeAtiva.nome}
    />
  );
}
