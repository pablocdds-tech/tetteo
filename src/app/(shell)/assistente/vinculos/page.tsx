import { redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { PainelDeVinculos } from "@/modules/assistente/components/painel-de-vinculos";
import {
  listarVinculos,
  pessoasSemVinculo,
} from "@/modules/assistente/services/vinculos";

export default async function PaginaVinculos() {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");
  if (!pode(contexto, "assistente.vincular")) redirect("/assistente");

  const [vinculos, disponiveis] = await Promise.all([
    listarVinculos(contexto),
    pessoasSemVinculo(contexto),
  ]);

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Números</h1>
        <p className="text-ink-3 mt-1 text-sm">
          Quem a Severina enxerga — e quem pode receber avisos
        </p>
      </div>

      <div className="mt-6">
        <PainelDeVinculos
          vinculos={vinculos}
          disponiveis={disponiveis}
          podeVincular
          podeAutorizar={pode(contexto, "assistente.autorizar")}
        />
      </div>
    </div>
  );
}
