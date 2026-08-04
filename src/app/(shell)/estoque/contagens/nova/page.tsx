import { notFound, redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { agoraParaCampo } from "@/lib/data";
import { AvisoUnidade } from "@/modules/estoque/components/aviso-unidade";
import { FormularioNovaContagem } from "@/modules/estoque/components/formulario-nova-contagem";
import { categoriasDeInsumos } from "@/modules/estoque/services/contagens";
import { listarLocais } from "@/modules/estoque/services/rotinas";

export default async function PaginaNovaContagem() {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");
  if (!pode(contexto, "estoque.contar")) notFound();

  if (!contexto.unidadeAtiva) {
    return (
      <div className="mx-auto w-full max-w-5xl">
        <h1 className="text-2xl font-semibold tracking-tight">Nova contagem</h1>
        <div className="mt-6">
          <AvisoUnidade acao="Contar estoque" />
        </div>
      </div>
    );
  }

  const [categorias, locais] = await Promise.all([
    categoriasDeInsumos(contexto),
    listarLocais(contexto),
  ]);

  return (
    <div className="mx-auto w-full max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight">Nova contagem</h1>
      <p className="text-ink-3 mt-1 text-sm">{contexto.unidadeAtiva.nome}</p>

      <div className="mt-6">
        <FormularioNovaContagem
          categorias={categorias}
          locais={locais}
          agora={agoraParaCampo()}
        />
      </div>
    </div>
  );
}
