import Link from "next/link";
import { redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { Botao } from "@/design-system/botao";
import { ListaDeAgentes } from "@/modules/assistente/components/lista-de-agentes";
import { listarAgentes } from "@/modules/assistente/services/agentes";

export default async function PaginaAgentes() {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const podeConfigurar = pode(contexto, "assistente.configurar");
  const agentes = await listarAgentes(contexto);

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Agentes</h1>
          <p className="text-ink-3 mt-1 text-sm">
            Quando ela fala, com quem, e de que jeito
          </p>
        </div>

        {podeConfigurar && (
          <Link href="/assistente/agentes/novo">
            <Botao>Novo agente</Botao>
          </Link>
        )}
      </div>

      <div className="mt-6">
        <ListaDeAgentes agentes={agentes} podeConfigurar={podeConfigurar} />
      </div>
    </div>
  );
}
