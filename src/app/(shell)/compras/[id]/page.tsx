import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { Botao } from "@/design-system/botao";
import { hojeParaCampo } from "@/lib/data";
import { formatarMoeda, formatarQuantidade } from "@/lib/numero";
import { sigla } from "@/lib/unidades";
import { definirPrevisaoAcao, moverPedidoAcao } from "@/modules/compras/acoes";
import { AvisoUnidade } from "@/modules/compras/components/aviso-unidade";
import { obterPedido, pedidoEmTexto } from "@/modules/compras/services/pedidos";

const data = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

export default async function PaginaPedido({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");
  if (!pode(contexto, "compras.ver")) notFound();

  if (!contexto.unidadeAtiva) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <AvisoUnidade acao="Ver pedidos" />
      </div>
    );
  }

  const { id } = await params;
  const pedido = await obterPedido(contexto, id);
  if (!pedido) notFound();

  const podePedir = pode(contexto, "compras.pedir");
  const texto = pedidoEmTexto(pedido);

  return (
    <div className="mx-auto w-full max-w-3xl">
      <Link href="/compras" className="text-ink-3 hover:text-ink text-sm">
        ← Pedidos
      </Link>

      <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">
            {pedido.fornecedor.nome}
          </h1>
          <p className="text-ink-3 mt-1 text-sm">
            {pedido.status.toLowerCase()} · {data.format(pedido.criadoEm)}
            {pedido.cotacao ? ` · de "${pedido.cotacao.descricao}"` : ""}
            {pedido.fornecedor.telefone
              ? ` · ${pedido.fornecedor.telefone}`
              : ""}
          </p>
        </div>

        <span className="text-right">
          <span className="block text-2xl font-semibold tabular-nums">
            {formatarMoeda(pedido.total)}
          </span>
          {pedido.frete > 0 && (
            <span className="text-ink-3 block text-xs">
              inclui {formatarMoeda(pedido.frete)} de frete
            </span>
          )}
        </span>
      </div>

      <div className="border-line divide-line mt-6 divide-y rounded-xl border">
        {pedido.itens.map((i) => (
          <div
            key={i.id}
            className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm"
          >
            <div className="min-w-0 flex-1">
              <span className="block truncate font-medium">{i.nome}</span>
              <span className="text-ink-3 block text-xs">
                {formatarQuantidade(i.quantidade)} {sigla(i.unidade)}
                {i.embalagem ? ` · ${i.embalagem}` : ""} ·{" "}
                {formatarMoeda(i.precoUnitario)}/{sigla(i.unidade)}
              </span>
            </div>
            <span className="text-ink-2 tabular-nums">
              {formatarMoeda(i.total)}
            </span>
          </div>
        ))}
      </div>

      {/* O pedido chega ao fornecedor por WhatsApp — não por EDI, não por
          e-mail formatado. Gerar o texto certo aqui evita a redigitação, que é
          onde a quantidade errada entra. */}
      <section className="mt-6">
        <h2 className="font-semibold">Para mandar no WhatsApp</h2>
        <pre className="border-line bg-surface-2 text-ink-2 mt-2 overflow-x-auto rounded-xl border px-4 py-3 text-sm whitespace-pre-wrap">
          {texto}
        </pre>
      </section>

      {podePedir && pedido.status !== "CANCELADO" && (
        <section className="mt-8 flex flex-col gap-4">
          {pedido.status !== "RECEBIDO" && (
            <form
              action={definirPrevisaoAcao}
              className="flex flex-wrap items-end gap-2"
            >
              <input type="hidden" name="pedidoId" value={pedido.id} />
              <label className="flex flex-col gap-1.5">
                <span className="text-ink-2 text-sm font-semibold">
                  Entrega combinada
                </span>
                <input
                  type="date"
                  name="previsaoEntrega"
                  defaultValue={
                    pedido.previsaoEntrega
                      ? hojeParaCampo(pedido.previsaoEntrega)
                      : ""
                  }
                  className="border-line-2 bg-surface text-ink focus:border-accent h-10 rounded-md border px-3 focus:shadow-[0_0_0_3px_var(--accent-sub)] focus:outline-none"
                />
              </label>
              <Botao peso="secundario" type="submit">
                Salvar data
              </Botao>
            </form>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {pedido.status === "RASCUNHO" && (
              <form action={moverPedidoAcao}>
                <input type="hidden" name="pedidoId" value={pedido.id} />
                <input type="hidden" name="destino" value="ENVIADO" />
                <Botao type="submit">Marcar como enviado</Botao>
              </form>
            )}

            {pedido.status === "ENVIADO" && (
              <form action={moverPedidoAcao}>
                <input type="hidden" name="pedidoId" value={pedido.id} />
                <input type="hidden" name="destino" value="RECEBIDO" />
                <Botao type="submit">O caminhão chegou</Botao>
              </form>
            )}

            {pedido.status !== "RECEBIDO" && (
              <form action={moverPedidoAcao}>
                <input type="hidden" name="pedidoId" value={pedido.id} />
                <input type="hidden" name="destino" value="CANCELADO" />
                <Botao peso="fantasma" type="submit">
                  Cancelar pedido
                </Botao>
              </form>
            )}
          </div>
        </section>
      )}

      {pedido.status === "RECEBIDO" && (
        <p className="border-line bg-surface-2 text-ink-2 mt-6 rounded-xl border px-4 py-3 text-sm">
          Caminhão recebido. O estoque ainda <strong>não</strong> foi alterado —
          quem dá entrada é o lançamento da nota, com o papel na mão, conferindo
          o que veio contra o que foi pedido.{" "}
          <Link
            href="/estoque/entradas/nova"
            className="text-accent font-semibold"
          >
            Lançar a nota →
          </Link>
        </p>
      )}
    </div>
  );
}
