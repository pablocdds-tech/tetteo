import { redirect } from "next/navigation";
import { obterContexto, pode } from "@/core/sessao/contexto";
import { GestaoCaixa } from "@/modules/pdv/components/gestao-caixa";
import { carregarPdv } from "@/modules/pdv/services/pdv";
export default async function PaginaCaixa() {
  const ctx = await obterContexto();
  if (!ctx) redirect("/login");
  if (!ctx.unidadeAtiva) return null;
  const dados = await carregarPdv(ctx);
  return (
    <GestaoCaixa
      caixa={dados.caixa}
      caixasAnteriores={dados.caixasAnteriores}
      locais={dados.locais}
      podeOperar={pode(ctx, "pdv.caixa")}
    />
  );
}
