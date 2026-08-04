import { notFound, redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { paraCampo } from "@/lib/numero";
import { FormularioInsumo } from "@/modules/cardapio/components/formulario-insumo";
import { obterInsumo } from "@/modules/cardapio/services/insumos";

export default async function PaginaEditarInsumo({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");
  if (!pode(contexto, "cardapio.editar")) redirect("/cardapio");

  const { id } = await params;
  const insumo = await obterInsumo(contexto, id);
  if (!insumo) notFound();

  return (
    <div className="mx-auto w-full max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight">Editar insumo</h1>
      <p className="text-ink-3 mt-1 text-sm">{insumo.nome}</p>
      <div className="mt-6">
        <FormularioInsumo
          valores={{
            id: insumo.id,
            nome: insumo.nome,
            categoria: insumo.categoria,
            unidadeMedida: insumo.unidadeMedida,
            // `paraCampo`, nunca `.toString()`: o Decimal devolveria "38.9" e
            // o ponto solto seria relido como milhar — salvar sem mexer em
            // nada gravaria 389.
            custoMedio: paraCampo(insumo.custoMedio.toString(), 2),
            estoqueMinimo: paraCampo(insumo.estoqueMinimo.toString()),
          }}
        />
      </div>
    </div>
  );
}
