import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { estiloDeBotao } from "@/design-system/botao";

/**
 * Provisória: as telas do fluxo novo (rodadas, requisição, comparação,
 * aprovação, envios, recebimento) entram na Fase H do plano
 * `docs/superpowers/plans/2026-09-10-compras-fluxo.md`.
 */
export default async function PaginaCompras() {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");
  if (!pode(contexto, "compras.ver")) notFound();

  return (
    <div className="mx-auto w-full max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight">Compras</h1>
      <p className="text-ink-3 mt-1 text-sm">
        As rodadas de compra estão sendo montadas. Enquanto isso, o cadastro de
        fornecedores continua disponível.
      </p>
      <Link
        href="/compras/fornecedores"
        className={`${estiloDeBotao("secundario")} mt-6`}
      >
        Ver fornecedores
      </Link>
    </div>
  );
}
