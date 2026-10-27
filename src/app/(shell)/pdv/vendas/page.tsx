import Link from "next/link";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { obterContexto, pode } from "@/core/sessao/contexto";
import { HistoricoPdv } from "@/modules/pdv/components/historico-pdv";
import { consultarHistorico } from "@/modules/pdv/services/historico";
import { ErroPdv } from "@/modules/pdv/schemas/erro";
export default async function PaginaVendasPdv({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await obterContexto();
  if (!ctx) redirect("/login");
  if (!ctx.unidadeAtiva) return null;
  const parametros = await searchParams;
  const filtros = Object.fromEntries(
    [
      "de",
      "ate",
      "status",
      "modalidade",
      "pagamento",
      "operadorId",
      "busca",
      "pagina",
    ]
      .filter((chave) => parametros[chave] !== undefined)
      .map((chave) => [chave, parametros[chave]]),
  );
  let inicial;
  try {
    inicial = await consultarHistorico(ctx, filtros);
  } catch (erro) {
    if (!(erro instanceof ErroPdv) && !(erro instanceof ZodError)) throw erro;
    return (
      <div className="mx-auto max-w-6xl space-y-4">
        <h1 className="text-2xl font-semibold">Histórico de pedidos</h1>
        <p role="alert" className="text-bad">
          {erro instanceof ErroPdv
            ? erro.message
            : "Confira o período e os filtros informados."}
        </p>
        <Link href="/pdv/vendas" className="underline underline-offset-4">
          Voltar aos filtros de hoje
        </Link>
      </div>
    );
  }
  return (
    <HistoricoPdv
      key={`${ctx.organizacao.id}:${ctx.unidadeAtiva.id}:${JSON.stringify(inicial.filtros)}`}
      inicial={inicial}
      podeCancelar={pode(ctx, "pdv.cancelar")}
    />
  );
}
