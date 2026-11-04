import { notFound, redirect } from "next/navigation";
import { obterContexto, pode } from "@/core/sessao/contexto";
import EquipeNavigation from "../_atendimento/equipe-navigation";
import styles from "@/modules/crm/components/virtual-navigation.module.css";
export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const context = await obterContexto();
  if (!context) redirect("/login");
  if (!pode(context, "assistente.ver")) notFound();
  return (
    <div className={styles.team}>
      <EquipeNavigation
        configure={pode(context, "assistente.configurar")}
        bind={pode(context, "assistente.vincular")}
      />
      {children}
    </div>
  );
}
