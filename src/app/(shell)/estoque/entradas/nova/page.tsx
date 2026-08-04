import { notFound, redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { hojeParaCampo } from "@/lib/data";
import { AvisoUnidade } from "@/modules/estoque/components/aviso-unidade";
import { FormularioNota } from "@/modules/estoque/components/formulario-nota";
import { listarFornecedores } from "@/modules/estoque/services/notas";
import { listarLocais } from "@/modules/estoque/services/rotinas";

export default async function PaginaNovaNota() {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");
  if (!pode(contexto, "estoque.lancar")) notFound();

  if (!contexto.unidadeAtiva) {
    return (
      <div className="mx-auto w-full max-w-5xl">
        <h1 className="text-2xl font-semibold tracking-tight">Nova nota</h1>
        <div className="mt-6">
          <AvisoUnidade acao="Lançar entrada de mercadoria" />
        </div>
      </div>
    );
  }

  const [fornecedores, locais] = await Promise.all([
    listarFornecedores(contexto),
    listarLocais(contexto),
  ]);

  return (
    <div className="mx-auto w-full max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight">
        Nova nota de entrada
      </h1>
      <p className="text-ink-3 mt-1 text-sm">
        {contexto.unidadeAtiva.nome} · nada entra no estoque até você lançar
      </p>

      <div className="mt-6">
        <FormularioNota
          fornecedores={fornecedores}
          locais={locais}
          agora={hojeParaCampo()}
        />
      </div>
    </div>
  );
}
