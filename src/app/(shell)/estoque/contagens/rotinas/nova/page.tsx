import { notFound, redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { AvisoUnidade } from "@/modules/estoque/components/aviso-unidade";
import { FormularioRotina } from "@/modules/estoque/components/formulario-rotina";
import { categoriasDeInsumos } from "@/modules/estoque/services/contagens";
import { listarLocais } from "@/modules/estoque/services/rotinas";

export default async function PaginaNovaRotina() {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");
  if (!pode(contexto, "estoque.contar")) notFound();

  if (!contexto.unidadeAtiva) {
    return (
      <div className="mx-auto w-full max-w-5xl">
        <h1 className="text-2xl font-semibold tracking-tight">Nova rotina</h1>
        <div className="mt-6">
          <AvisoUnidade acao="Criar rotina de contagem" />
        </div>
      </div>
    );
  }

  const [locais, categorias] = await Promise.all([
    listarLocais(contexto),
    categoriasDeInsumos(contexto),
  ]);

  return (
    <div className="mx-auto w-full max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight">
        Nova rotina de contagem
      </h1>
      <p className="text-ink-3 mt-1 text-sm">
        {contexto.unidadeAtiva.nome} · a tela de contagens passa a cobrar esta
        rotina sozinha
      </p>

      <div className="mt-6">
        <FormularioRotina locais={locais} categorias={categorias} />
      </div>
    </div>
  );
}
