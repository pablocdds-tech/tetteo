import { notFound, redirect } from "next/navigation";
import { obterContexto, pode } from "@/core/sessao/contexto";

export default async function LayoutPdv({
  children,
}: {
  children: React.ReactNode;
}) {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");
  if (!pode(contexto, "pdv.ver")) notFound();
  if (!contexto.unidadeAtiva)
    return (
      <div className="bg-surface border-line rounded-xl border p-6">
        <h1 className="text-xl font-semibold">PDV</h1>
        <p className="text-ink-3 mt-2">
          Selecione uma unidade no menu para acessar as vendas e o caixa.
        </p>
      </div>
    );
  return children;
}
