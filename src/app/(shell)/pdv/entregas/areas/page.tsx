import { notFound, redirect } from "next/navigation";
import { obterContexto, pode } from "@/core/sessao/contexto";
import { AdminAreasEntrega } from "@/modules/pdv/components/admin-areas-entrega";
import { listarAreasEntrega } from "@/modules/pdv/services/entregas";

export default async function PaginaAreasEntregaPdv() {
  const ctx = await obterContexto();
  if (!ctx) redirect("/login");
  if (!pode(ctx, "pdv.ver") || !pode(ctx, "pdv.configurar")) notFound();
  if (!ctx.unidadeAtiva) return null;
  return <AdminAreasEntrega areas={await listarAreasEntrega(ctx, true)} />;
}
