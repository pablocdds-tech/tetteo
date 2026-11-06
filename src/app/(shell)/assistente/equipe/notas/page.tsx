import { redirect } from "next/navigation";
import { obterContexto } from "@/core/sessao/contexto";
import { obterPainelNotas } from "@/modules/assistente/services/notas-autorizacao";
import { PainelDeNotas } from "@/modules/assistente/components/painel-notas";

export default async function PaginaNotas() {
  const ctx = await obterContexto();
  if (!ctx) redirect("/login");
  if (!ctx.unidadeAtiva)
    return (
      <div className="mx-auto max-w-5xl">
        <h1 className="text-2xl font-semibold">Notas pelo WhatsApp</h1>
        <p className="text-ink-3 mt-2">
          Selecione uma unidade no topo do painel para ver o número receptor e
          autorizar pessoas.
        </p>
      </div>
    );
  return <PainelDeNotas dados={await obterPainelNotas(ctx)} />;
}
