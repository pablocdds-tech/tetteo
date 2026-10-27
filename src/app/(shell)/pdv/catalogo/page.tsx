import { notFound, redirect } from "next/navigation";
import { obterContexto, pode } from "@/core/sessao/contexto";
import { CatalogoPdv } from "@/modules/pdv/components/catalogo-pdv";
import { carregarPdv } from "@/modules/pdv/services/pdv";
export default async function PaginaCatalogoPdv() {
  const ctx = await obterContexto();
  if (!ctx) redirect("/login");
  if (!pode(ctx, "pdv.configurar")) notFound();
  if (!ctx.unidadeAtiva) return null;
  const dados = await carregarPdv(ctx);
  return <CatalogoPdv produtos={dados.produtos} podeConfigurar={true} />;
}
