import { notFound, redirect } from "next/navigation";
import { obterContexto, pode } from "@/core/sessao/contexto";
import VirtualOverview from "@/modules/crm/components/virtual-overview";
import AtendimentoFrame from "./_atendimento/frame";
import PaginaConversasEquipe from "./conversas-equipe/page";

export default async function SeverinaOverviewPage() {
  const ctx = await obterContexto();
  if (!ctx) redirect("/login");
  if (!pode(ctx, "assistente.ver")) notFound();
  if (!pode(ctx, "crm.ver")) return <PaginaConversasEquipe />;
  return (
    <AtendimentoFrame>
      <VirtualOverview />
    </AtendimentoFrame>
  );
}
