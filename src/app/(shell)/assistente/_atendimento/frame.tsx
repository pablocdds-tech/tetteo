import { notFound, redirect } from "next/navigation";
import { obterContexto, pode } from "@/core/sessao/contexto";
import { CrmProvider } from "@/modules/crm/client/context";
import { VirtualAccountProvider } from "@/modules/crm/client/virtual-channel-context";
import styles from "@/modules/crm/components/shell.module.css";

/** App costura o atendimento à Severina sem importar um módulo de outro. */
export default async function AtendimentoFrame({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await obterContexto();
  if (!ctx) redirect("/login");
  if (!pode(ctx, "assistente.ver") || !pode(ctx, "crm.ver")) notFound();
  if (!ctx.unidadeAtiva)
    return (
      <div className={styles.shell}>
        <h1>Severina</h1>
        <p>
          Selecione uma unidade no menu do sistema para acompanhar o atendimento
          aos clientes.
        </p>
      </div>
    );
  return (
    <CrmProvider
      key={ctx.unidadeAtiva.id}
      storeId={ctx.unidadeAtiva.id}
      stores={ctx.unidadesVisiveis.map((unit) => ({
        id: unit.id,
        name: unit.nome,
      }))}
      permissions={[...ctx.permissoes]}
      manager={pode(ctx, "crm.gerenciar")}
    >
      <VirtualAccountProvider>
        <div className={styles.shell}>{children}</div>
      </VirtualAccountProvider>
    </CrmProvider>
  );
}
