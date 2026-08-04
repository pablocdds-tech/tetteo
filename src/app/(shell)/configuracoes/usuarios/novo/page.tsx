import { notFound, redirect } from "next/navigation";

import { FormularioPessoa } from "@/core/configuracoes/componentes/formulario-pessoa";
import { listarPapeis, listarUnidades } from "@/core/configuracoes/servicos";
import { obterContexto, pode } from "@/core/sessao/contexto";

export default async function PaginaNovaPessoa() {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");
  if (!pode(contexto, "configuracoes.editar")) notFound();

  const [papeis, unidades] = await Promise.all([
    listarPapeis(contexto),
    listarUnidades(contexto),
  ]);

  return (
    <div className="mx-auto w-full max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight">Nova pessoa</h1>
      <p className="text-ink-3 mt-1 text-sm">
        Cria a conta e já libera o acesso. Não vai e-mail nenhum — a senha é
        você quem entrega.
      </p>

      <div className="mt-6">
        <FormularioPessoa
          papeis={papeis.map((p) => ({ id: p.id, nome: p.nome }))}
          unidades={unidades
            .filter((u) => u.ativa)
            .map((u) => ({ id: u.id, nome: u.nome }))}
        />
      </div>
    </div>
  );
}
