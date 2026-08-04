import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { EditorDePapel } from "@/core/configuracoes/componentes/editor-de-papel";
import { catalogoDePermissoes } from "@/core/configuracoes/permissoes";
import { obterPapel } from "@/core/configuracoes/servicos";
import { obterContexto, pode } from "@/core/sessao/contexto";
import { APPS_REGISTRADOS } from "@/registro-de-apps";

/**
 * O `id` "novo" cria; qualquer outro edita. Uma rota só para as duas telas,
 * que são a mesma coisa com dados diferentes.
 */
export default async function PaginaPapel({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");
  if (!pode(contexto, "configuracoes.editar")) notFound();

  const { id } = await params;
  const criando = id === "novo";

  const papel = criando ? undefined : await obterPapel(contexto, id);
  if (!criando && !papel) notFound();

  return (
    <div className="mx-auto w-full max-w-5xl">
      <Link
        href="/configuracoes/usuarios"
        className="text-ink-3 hover:text-ink text-sm"
      >
        ← Usuários e papéis
      </Link>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">
        {criando ? "Novo papel" : papel!.nome}
      </h1>
      <p className="text-ink-3 mt-1 text-sm">
        {criando
          ? "Um conjunto de permissões que você atribui a várias pessoas"
          : "Alterar aqui muda o que todas as pessoas neste papel enxergam"}
      </p>

      <div className="mt-6">
        <EditorDePapel
          grupos={catalogoDePermissoes(APPS_REGISTRADOS)}
          papel={papel ?? undefined}
        />
      </div>
    </div>
  );
}
