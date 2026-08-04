import { redirect } from "next/navigation";

import { obterContexto } from "@/core/sessao/contexto";
import { BarraLateral } from "@/core/shell/barra-lateral";
import { Topo } from "@/core/shell/topo";

/**
 * A CASCA.
 *
 * Monta uma vez e nunca remonta. Ao trocar de App, só a área central muda —
 * a barra lateral e o topo ficam imóveis. Se isso piscar ou recarregar, a
 * ilusão de "sistema operacional" morre no primeiro clique e não volta.
 */
export default async function LayoutCasca({
  children,
}: {
  children: React.ReactNode;
}) {
  const contexto = await obterContexto();

  // Sem contexto: ou não há sessão, ou o usuário não tem acesso a nenhuma
  // organização. Nos dois casos, não há sistema para mostrar.
  if (!contexto) redirect("/login");

  return (
    <div className="flex min-h-full flex-1">
      <BarraLateral contexto={contexto} />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topo contexto={contexto} />
        <main className="bg-paper min-h-0 flex-1 overflow-auto p-5">
          {children}
        </main>
      </div>
    </div>
  );
}
