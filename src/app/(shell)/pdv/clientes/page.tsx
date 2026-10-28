import { notFound, redirect } from "next/navigation";
import { obterContexto, pode } from "@/core/sessao/contexto";
import { listarClientesAtendimento } from "@/modules/crm/services/atendimento";
import { crmUser } from "@/modules/crm/services/scope";
import { ClientesPdv } from "@/modules/pdv/components/clientes-pdv";

export default async function PaginaClientesPdv() {
  const ctx = await obterContexto();
  if (!ctx) redirect("/login");
  if (!pode(ctx, "pdv.ver") || !pode(ctx, "crm.ver")) notFound();
  if (!ctx.unidadeAtiva) return null;
  const inicial = await listarClientesAtendimento(crmUser(ctx), {
    storeId: ctx.unidadeAtiva.id,
  });
  return (
    <ClientesPdv
      key={ctx.unidadeAtiva.id}
      unidadeId={ctx.unidadeAtiva.id}
      inicial={inicial}
      podeEditar={pode(ctx, "crm.editar")}
    />
  );
}
