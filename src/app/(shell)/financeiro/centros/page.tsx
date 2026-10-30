import { PaginaFinanceiroIntegrado } from "@/modules/financeiro/components/pagina-integrada";
export default async function Pagina({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <PaginaFinanceiroIntegrado secao="centros" searchParams={searchParams} />
  );
}
