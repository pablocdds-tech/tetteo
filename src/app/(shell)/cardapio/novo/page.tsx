import { redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { FormularioInsumo } from "@/modules/cardapio/components/formulario-insumo";

export default async function PaginaNovoInsumo() {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");
  if (!pode(contexto, "cardapio.editar")) redirect("/cardapio");

  return (
    <div className="mx-auto w-full max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight">Novo insumo</h1>
      <p className="text-ink-3 mt-1 text-sm">
        O cadastro vale para a rede inteira — o saldo é que será por unidade.
      </p>
      <div className="mt-6">
        <FormularioInsumo />
      </div>
    </div>
  );
}
