import Link from "next/link";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { obterContexto } from "@/core/sessao/contexto";
import { obterDesempenho } from "@/modules/pdv/services/desempenho";
import { DesempenhoPdv } from "@/modules/pdv/components/desempenho-pdv";
import { ErroPdv } from "@/modules/pdv/schemas/erro";
export default async function PaginaDesempenho({
  searchParams,
}: {
  searchParams: Promise<{ de?: string | string[]; ate?: string | string[] }>;
}) {
  const ctx = await obterContexto();
  if (!ctx) redirect("/login");
  if (!ctx.unidadeAtiva) return null;
  const consulta = await searchParams;
  let dados: Awaited<ReturnType<typeof obterDesempenho>> | undefined;
  let erro = "";
  try {
    dados = await obterDesempenho(ctx, {
      de: consulta.de,
      ate: consulta.ate,
    });
  } catch (e) {
    if (!(e instanceof ErroPdv) && !(e instanceof ZodError)) throw e;
    erro =
      e instanceof ErroPdv
        ? e.message
        : "Informe datas válidas para consultar o desempenho.";
  }
  if (!dados) {
    return (
      <div className="bg-surface border-line space-y-4 rounded border p-6">
        <h1 className="text-lg font-semibold">Confira o período</h1>
        <p>{erro}</p>
        <Link href="/pdv/desempenho" className="text-accent underline">
          Consultar hoje
        </Link>
      </div>
    );
  }
  return <DesempenhoPdv dados={dados} />;
}
