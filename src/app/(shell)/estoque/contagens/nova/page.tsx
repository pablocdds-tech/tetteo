import { notFound, redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { AvisoUnidade } from "@/modules/estoque/components/aviso-unidade";
import { FormularioNovaContagem } from "@/modules/estoque/components/formulario-nova-contagem";
import { categoriasDeInsumos } from "@/modules/estoque/services/contagens";

/**
 * O valor padrão do campo de data.
 *
 * `datetime-local` exige "AAAA-MM-DDTHH:MM" no horário LOCAL. `toISOString()`
 * devolveria UTC e o campo abriria com três horas de diferença — erro que
 * ninguém percebe até o CMV sair de um período errado.
 */
function agoraLocal() {
  const agora = new Date();
  const deslocamento = agora.getTimezoneOffset() * 60_000;
  return new Date(agora.getTime() - deslocamento).toISOString().slice(0, 16);
}

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

  const categorias = await categoriasDeInsumos(contexto);

  return (
    <div className="mx-auto w-full max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight">Nova contagem</h1>
      <p className="text-ink-3 mt-1 text-sm">{contexto.unidadeAtiva.nome}</p>

      <div className="mt-6">
        <FormularioNovaContagem categorias={categorias} agora={agoraLocal()} />
      </div>
    </div>
  );
}
