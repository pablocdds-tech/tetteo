import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { FormularioUnidade } from "@/core/configuracoes/componentes/formulario-unidade";
import { listarUnidades } from "@/core/configuracoes/servicos";
import { obterContexto, pode } from "@/core/sessao/contexto";

/** `nova` cria; qualquer outro id edita. */
export default async function PaginaUnidade({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");
  if (!pode(contexto, "configuracoes.editar")) notFound();

  const { id } = await params;
  const criando = id === "nova";

  const unidade = criando
    ? undefined
    : (await listarUnidades(contexto)).find((u) => u.id === id);
  if (!criando && !unidade) notFound();

  return (
    <div className="mx-auto w-full max-w-5xl">
      <Link
        href="/configuracoes/unidades"
        className="text-ink-3 hover:text-ink text-sm"
      >
        ← Unidades
      </Link>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">
        {criando ? "Nova loja" : unidade!.nome}
      </h1>

      <div className="mt-6">
        <FormularioUnidade
          unidade={
            unidade && {
              id: unidade.id,
              nome: unidade.nome,
              codigo: unidade.codigo,
              documento: unidade.documento,
              cidade: unidade.cidade,
              estado: unidade.estado,
              telefone: unidade.telefone,
            }
          }
        />
      </div>
    </div>
  );
}
