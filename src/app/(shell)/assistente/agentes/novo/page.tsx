import Link from "next/link";
import { redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { FormularioAgente } from "@/modules/assistente/components/formulario-agente";
import { opcoesDeDestinatario } from "@/modules/assistente/services/agentes";

export default async function PaginaNovoAgente() {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");
  if (!pode(contexto, "assistente.configurar")) redirect("/assistente");

  const { papeis, pessoas, unidades } = await opcoesDeDestinatario(contexto);

  return (
    <div className="mx-auto w-full max-w-5xl">
      <Link
        href="/assistente/agentes"
        className="text-ink-3 hover:text-ink text-sm"
      >
        ← Agentes
      </Link>

      <div className="mt-2">
        <h1 className="text-2xl font-semibold tracking-tight">Novo agente</h1>
        <p className="text-ink-3 mt-1 text-sm">
          Você define quando, para quem e como. O sistema garante os limites.
        </p>
      </div>

      <div className="mt-6">
        <FormularioAgente
          papeis={papeis}
          pessoas={pessoas}
          unidades={unidades}
        />
      </div>
    </div>
  );
}
