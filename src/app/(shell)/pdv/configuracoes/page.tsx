import { notFound, redirect } from "next/navigation";
import { obterContexto, pode } from "@/core/sessao/contexto";
import { ConfiguracoesPdv } from "@/modules/pdv/components/configuracoes-pdv";
export default async function PaginaConfiguracoesPdv() {
  const ctx = await obterContexto();
  if (!ctx) redirect("/login");
  if (!pode(ctx, "pdv.configurar")) notFound();
  if (!ctx.unidadeAtiva) return null;
  return (
    <ConfiguracoesPdv
      preferenciasId={ctx.usuario.id + ":" + ctx.unidadeAtiva.id}
    />
  );
}
