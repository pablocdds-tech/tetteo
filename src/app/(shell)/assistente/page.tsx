import { notFound, redirect } from "next/navigation";
import { obterContexto, pode } from "@/core/sessao/contexto";
import VirtualOverview from "@/modules/crm/components/virtual-overview";
import AtendimentoFrame from "./_atendimento/frame";

export default async function SeverinaOverviewPage() {
  const ctx = await obterContexto();
  if (!ctx) redirect("/login");
  if (!pode(ctx, "assistente.ver")) notFound();
  if (!pode(ctx, "crm.ver")) redirect("/assistente/equipe");
  return (
    <AtendimentoFrame>
      <VirtualOverview />
    </AtendimentoFrame>
  );
}
