import { redirect } from "next/navigation";
import { obterContexto, pode } from "@/core/sessao/contexto";
import { HistoricoPdv } from "@/modules/pdv/components/historico-pdv";
import { carregarPdv } from "@/modules/pdv/services/pdv";
export default async function PaginaVendasPdv() {
  const ctx = await obterContexto();
  if (!ctx) redirect("/login");
  if (!ctx.unidadeAtiva) return null;
  const dados = await carregarPdv(ctx);
  return (
    <HistoricoPdv
      vendas={dados.vendas}
      podeCancelar={pode(ctx, "pdv.cancelar")}
    />
  );
}
