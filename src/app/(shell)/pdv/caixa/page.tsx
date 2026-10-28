import { notFound, redirect } from "next/navigation";
import { obterContexto, pode } from "@/core/sessao/contexto";
import { GestaoCaixa } from "@/modules/pdv/components/gestao-caixa";
import { carregarGestaoCaixa } from "@/modules/pdv/services/caixa";
import { ErroPdv } from "@/modules/pdv/schemas/erro";
export default async function PaginaCaixa({
  searchParams,
}: {
  searchParams: Promise<{ caixa?: string | string[] }>;
}) {
  const ctx = await obterContexto();
  if (!ctx) redirect("/login");
  if (!ctx.unidadeAtiva) return null;
  const consulta = await searchParams;
  if (Array.isArray(consulta.caixa)) notFound();
  let dados;
  try {
    dados = await carregarGestaoCaixa(ctx, consulta.caixa);
  } catch (erro) {
    if (erro instanceof ErroPdv) notFound();
    throw erro;
  }
  return (
    <GestaoCaixa
      caixa={dados.caixa}
      caixaAtualId={dados.caixaAtualId}
      historico={dados.historico}
      locais={dados.locais}
      podeOperar={pode(ctx, "pdv.caixa")}
    />
  );
}
