import { notFound, redirect } from "next/navigation";
import { obterContexto, pode } from "@/core/sessao/contexto";
import { AdminEntregadores } from "@/modules/pdv/components/admin-entregadores";
import { listarEntregadores } from "@/modules/pdv/services/entregas";

export default async function PaginaEntregadoresPdv() {
  const ctx = await obterContexto();
  if (!ctx) redirect("/login");
  if (!pode(ctx, "pdv.ver") || !pode(ctx, "pdv.entrega")) notFound();
  if (!ctx.unidadeAtiva) return null;
  return <AdminEntregadores entregadores={await listarEntregadores(ctx)} />;
}
