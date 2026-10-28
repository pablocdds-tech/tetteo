import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { obterContexto, pode } from "@/core/sessao/contexto";
import { ImpressaoCaixa } from "@/modules/pdv/components/impressao-caixa";
import { ErroPdv } from "@/modules/pdv/schemas/erro";
import { consultarCaixa } from "@/modules/pdv/services/caixa";

export const metadata: Metadata = {
  title: "Resumo do caixa · PDV",
  robots: { index: false, follow: false },
};
export default async function PaginaImprimirCaixa({
  params,
}: {
  params: Promise<{ caixaId: string }>;
}) {
  const ctx = await obterContexto();
  if (!ctx) redirect("/login");
  if (!pode(ctx, "pdv.ver") || !ctx.unidadeAtiva) notFound();
  const { caixaId } = await params;
  let caixa;
  try {
    caixa = await consultarCaixa(ctx, caixaId);
  } catch (erro) {
    if (erro instanceof ErroPdv) notFound();
    throw erro;
  }
  return <ImpressaoCaixa caixa={caixa} unidade={ctx.unidadeAtiva.nome} />;
}
