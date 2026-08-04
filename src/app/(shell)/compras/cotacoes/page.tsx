import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { Botao } from "@/design-system/botao";
import { AvisoUnidade } from "@/modules/compras/components/aviso-unidade";
import { listarCotacoes } from "@/modules/compras/services/cotacoes";

const data = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
});

export default async function PaginaCotacoes() {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");
  if (!pode(contexto, "compras.ver")) notFound();

  if (!contexto.unidadeAtiva) {
    return (
      <div className="mx-auto w-full max-w-4xl">
        <Cabecalho />
        <div className="mt-6">
          <AvisoUnidade acao="Cotar preço" />
        </div>
      </div>
    );
  }

  const cotacoes = await listarCotacoes(contexto);

  return (
    <div className="mx-auto w-full max-w-4xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <Cabecalho unidade={contexto.unidadeAtiva.nome} />
        {pode(contexto, "compras.cotar") && (
          <Link href="/compras/cotacoes/nova">
            <Botao>Nova cotação</Botao>
          </Link>
        )}
      </div>

      {cotacoes.length === 0 ? (
        <div className="border-line-2 bg-surface-2 mt-6 rounded-xl border border-dashed px-6 py-10 text-center">
          <p aria-hidden className="text-2xl opacity-50">
            📋
          </p>
          <p className="mt-2 font-semibold">Nenhuma cotação ainda</p>
          <p className="text-ink-3 mx-auto mt-1 max-w-lg text-sm">
            Monte a lista da semana, convide dois ou três fornecedores e lance
            os preços que chegarem no WhatsApp. O sistema converte embalagem,
            multiplica pela quantidade, soma o frete e mostra quem sai mais
            barato de verdade.
          </p>
        </div>
      ) : (
        <div className="border-line divide-line mt-6 divide-y rounded-xl border">
          {cotacoes.map((c) => (
            <Link
              key={c.id}
              href={`/compras/cotacoes/${c.id}`}
              className="hover:bg-surface-2 flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 transition-colors"
            >
              <div className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {c.descricao}
                </span>
                <span className="text-ink-3 block text-xs">
                  {data.format(c.criadoEm)} · {c.itens}{" "}
                  {c.itens === 1 ? "item" : "itens"} · {c.respondidas} de{" "}
                  {c.fornecedores}{" "}
                  {c.fornecedores === 1 ? "resposta" : "respostas"}
                  {c.pedidos > 0
                    ? ` · ${c.pedidos} ${c.pedidos === 1 ? "pedido" : "pedidos"}`
                    : ""}
                </span>
              </div>

              <span
                className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                  c.status === "ABERTA"
                    ? "bg-warn-sub text-warn"
                    : c.status === "FECHADA"
                      ? "bg-ok-sub text-ok"
                      : "bg-surface-3 text-ink-3"
                }`}
              >
                {c.status.toLowerCase()}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function Cabecalho({ unidade }: { unidade?: string }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Cotações</h1>
      <p className="text-ink-3 mt-1 text-sm">
        {unidade
          ? `Mesma lista, vários fornecedores · ${unidade}`
          : "Mesma lista, vários fornecedores"}
      </p>
    </div>
  );
}
