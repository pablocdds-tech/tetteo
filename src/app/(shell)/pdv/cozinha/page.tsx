import { redirect } from "next/navigation";
import { obterContexto, pode } from "@/core/sessao/contexto";
import { carregarCozinha } from "@/modules/pdv/services/cozinha";
import { CozinhaPdv } from "@/modules/pdv/components/cozinha-pdv";
export default async function PaginaCozinha() {
  const ctx = await obterContexto();
  if (!ctx) redirect("/login");
  if (!ctx.unidadeAtiva) return null;
  return (
    <CozinhaPdv
      key={ctx.unidadeAtiva.id}
      inicial={await carregarCozinha(ctx)}
      podeOperar={pode(ctx, "pdv.operar")}
    />
  );
}
