import { PaginaFinanceiroIntegrado } from "@/modules/financeiro/components/pagina-integrada";
export default async function Pagina({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PaginaFinanceiroIntegrado id={id} />;
}
