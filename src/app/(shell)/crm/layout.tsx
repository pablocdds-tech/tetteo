import { notFound, redirect } from "next/navigation";
import { obterContexto, pode } from "@/core/sessao/contexto";
import { CrmProvider } from "@/modules/crm/client/context";
import CrmTabs from "@/modules/crm/components/layout";
import styles from "@/modules/crm/components/shell.module.css";

export default async function CrmLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await obterContexto();
  if (!ctx) redirect("/login");
  if (!pode(ctx, "crm.ver")) notFound();
  if (!ctx.unidadeAtiva)
    return (
      <div className={styles.shell}>
        <h1>Clientes e relacionamento</h1>
        <p>Selecione uma unidade no menu do sistema para acessar o CRM.</p>
      </div>
    );
  return (
    <CrmProvider
      key={ctx.unidadeAtiva.id}
      storeId={ctx.unidadeAtiva.id}
      stores={ctx.unidadesVisiveis.map((u) => ({ id: u.id, name: u.nome }))}
      permissions={[...ctx.permissoes]}
      manager={pode(ctx, "crm.gerenciar")}
    >
      <div className={styles.shell}>
        <CrmTabs>{children}</CrmTabs>
      </div>
    </CrmProvider>
  );
}
