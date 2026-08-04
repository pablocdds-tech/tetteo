import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { Botao } from "@/design-system/botao";
import { formatarMoeda } from "@/lib/numero";
import { AvisoUnidade } from "@/modules/compras/components/aviso-unidade";
import { listarPedidos } from "@/modules/compras/services/pedidos";

const data = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
});

const SELO: Record<string, string> = {
  RASCUNHO: "bg-warn-sub text-warn",
  ENVIADO: "bg-accent-sub text-accent",
  RECEBIDO: "bg-ok-sub text-ok",
  CANCELADO: "bg-surface-3 text-ink-3",
};

export default async function PaginaPedidos() {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");
  if (!pode(contexto, "compras.ver")) notFound();

  if (!contexto.unidadeAtiva) {
    return (
      <div className="mx-auto w-full max-w-5xl">
        <Cabecalho />
        <div className="mt-6">
          <AvisoUnidade acao="Comprar" />
        </div>
      </div>
    );
  }

  const pedidos = await listarPedidos(contexto);
  const abertos = pedidos.filter(
    (p) => p.status === "RASCUNHO" || p.status === "ENVIADO",
  );

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <Cabecalho unidade={contexto.unidadeAtiva.nome} />
        {pode(contexto, "compras.cotar") && (
          <Link href="/compras/cotacoes/nova">
            <Botao>Nova cotação</Botao>
          </Link>
        )}
      </div>

      {pedidos.length === 0 ? (
        <div className="border-line-2 bg-surface-2 mt-6 rounded-xl border border-dashed px-6 py-10 text-center">
          <p aria-hidden className="text-2xl opacity-50">
            🛒
          </p>
          <p className="mt-2 font-semibold">Nenhum pedido ainda</p>
          <p className="text-ink-3 mx-auto mt-1 max-w-md text-sm">
            Os pedidos nascem de uma cotação fechada — um por fornecedor
            escolhido. Comece cotando a lista da semana com dois ou três
            fornecedores.
          </p>
        </div>
      ) : (
        <>
          {abertos.length > 0 && (
            <p className="text-ink-3 mt-6 text-sm">
              {abertos.length}{" "}
              {abertos.length === 1
                ? "pedido em andamento"
                : "pedidos em andamento"}
            </p>
          )}

          <div className="border-line divide-line mt-3 divide-y rounded-xl border">
            {pedidos.map((p) => (
              <Link
                key={p.id}
                href={`/compras/${p.id}`}
                className="hover:bg-surface-2 flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {p.fornecedor}
                  </span>
                  <span className="text-ink-3 block text-xs">
                    {p.itens} {p.itens === 1 ? "item" : "itens"} ·{" "}
                    {data.format(p.criadoEm)}
                    {p.previsaoEntrega
                      ? ` · entrega ${data.format(p.previsaoEntrega)}`
                      : ""}
                  </span>
                </div>

                <span className="text-ink-2 text-sm tabular-nums">
                  {formatarMoeda(p.total)}
                </span>

                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${SELO[p.status]}`}
                >
                  {p.status.toLowerCase()}
                </span>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Cabecalho({ unidade }: { unidade?: string }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Pedidos</h1>
      <p className="text-ink-3 mt-1 text-sm">
        {unidade
          ? `O que foi encomendado · ${unidade}`
          : "O que foi encomendado"}
      </p>
    </div>
  );
}
