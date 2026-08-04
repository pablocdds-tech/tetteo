import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { Botao } from "@/design-system/botao";
import { formatarMoeda, formatarQuantidade } from "@/lib/numero";
import { sigla } from "@/lib/unidades";
import { cancelarNotaAcao, removerItemAcao } from "@/modules/estoque/acoes";
import { AvisoUnidade } from "@/modules/estoque/components/aviso-unidade";
import { FormularioItemNota } from "@/modules/estoque/components/formulario-item-nota";
import { PainelLancamento } from "@/modules/estoque/components/painel-lancamento";
import { obterNota } from "@/modules/estoque/services/notas";
import { db } from "@/server/db";

const data = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

export default async function PaginaNota({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  if (!contexto.unidadeAtiva) {
    return (
      <div className="mx-auto w-full max-w-5xl">
        <h1 className="text-2xl font-semibold tracking-tight">Nota</h1>
        <div className="mt-6">
          <AvisoUnidade acao="Lançar entrada de mercadoria" />
        </div>
      </div>
    );
  }

  const { id } = await params;
  const nota = await obterNota(contexto, id);
  if (!nota || nota.canceladaEm) notFound();

  const rascunho = nota.status === "RASCUNHO";
  const podeLancar = pode(contexto, "estoque.lancar");

  // O catálogo com as embalagens já conhecidas: é o que permite ao formulário
  // do item oferecer "Caixa 10kg" em vez de pedir o fator toda vez.
  const insumos = rascunho
    ? await db.insumo.findMany({
        where: {
          organizacaoId: contexto.organizacao.id,
          excluidoEm: null,
          ativo: true,
        },
        select: {
          id: true,
          nome: true,
          unidadeMedida: true,
          unidadeRotulo: true,
          embalagens: {
            where: { ativo: true },
            select: { nome: true, fator: true },
            orderBy: [{ padrao: "desc" }, { nome: "asc" }],
          },
        },
        orderBy: { nome: "asc" },
      })
    : [];

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/estoque/entradas"
            className="text-ink-3 hover:text-ink text-sm"
          >
            ← Entradas
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {nota.fornecedor.nome}
          </h1>
          <p className="text-ink-3 mt-1 text-sm">
            Chegou em {data.format(nota.recebidaEm)}
            {nota.numero && ` · nota ${nota.numero}`}
            {nota.serie && `/${nota.serie}`}
            {nota.localDestino && ` · guardado em ${nota.localDestino.nome}`}
            {!rascunho && nota.lancadaEm && (
              <> · lançada em {data.format(nota.lancadaEm)}</>
            )}
          </p>
        </div>

        {podeLancar && (
          <form action={cancelarNotaAcao}>
            <input type="hidden" name="notaId" value={nota.id} />
            <Botao peso="fantasma" tamanho="pequeno" type="submit">
              {rascunho ? "Descartar rascunho" : "Cancelar nota"}
            </Botao>
          </form>
        )}
      </div>

      {rascunho && podeLancar && (
        <div className="mt-6">
          <PainelLancamento
            notaId={nota.id}
            itens={nota.itens.length}
            valorTotal={nota.valorTotal.toString()}
            local={nota.localDestino?.nome ?? null}
          />
        </div>
      )}

      {!rascunho && (
        <div className="border-line bg-surface-2 mt-6 rounded-xl border px-5 py-4">
          <p className="text-ink-3 font-mono text-[11px] tracking-[0.14em] uppercase">
            Total da nota
          </p>
          <p className="text-2xl font-semibold tabular-nums">
            {formatarMoeda(nota.valorTotal.toString())}
          </p>
          <p className="text-ink-3 mt-1 text-sm">
            Já somado ao saldo
            {nota.localDestino ? ` de ${nota.localDestino.nome}` : ""} e ao
            custo médio dos insumos. Cancelar devolve a quantidade, mas o custo
            médio não se desfaz — a média já misturou.
          </p>
        </div>
      )}

      {rascunho && podeLancar && (
        <div className="mt-6">
          <FormularioItemNota
            notaId={nota.id}
            insumos={insumos.map((i) => ({
              id: i.id,
              nome: i.nome,
              unidadeMedida: i.unidadeMedida,
              unidadeRotulo: i.unidadeRotulo,
              embalagens: i.embalagens.map((e) => ({
                nome: e.nome,
                fator: e.fator.toString(),
              })),
            }))}
          />
        </div>
      )}

      <section className="mt-6">
        <h2 className="mb-3 font-semibold">
          Itens da nota ({nota.itens.length})
        </h2>

        {nota.itens.length === 0 ? (
          <p className="text-ink-3 text-sm">
            Nenhum item ainda. Use o formulário acima, linha por linha, como
            está no papel.
          </p>
        ) : (
          <div className="border-line overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[620px] text-sm">
              <thead>
                <tr className="bg-surface-2 border-line border-b">
                  <th className="text-ink-3 px-4 py-2.5 text-left text-xs font-semibold uppercase">
                    Insumo
                  </th>
                  <th className="text-ink-3 px-4 py-2.5 text-right text-xs font-semibold uppercase">
                    Na nota
                  </th>
                  <th className="text-ink-3 px-4 py-2.5 text-right text-xs font-semibold uppercase">
                    Entra
                  </th>
                  <th className="text-ink-3 px-4 py-2.5 text-right text-xs font-semibold uppercase">
                    Custo
                  </th>
                  <th className="text-ink-3 px-4 py-2.5 text-right text-xs font-semibold uppercase">
                    Total
                  </th>
                  {rascunho && podeLancar && <th className="w-px px-4" />}
                </tr>
              </thead>
              <tbody>
                {nota.itens.map((item) => {
                  const unidade =
                    item.insumo.unidadeRotulo ??
                    sigla(item.insumo.unidadeMedida);
                  const converteu = Number(item.fatorConversao) !== 1;

                  return (
                    <tr
                      key={item.id}
                      className="border-line border-b last:border-b-0"
                    >
                      <td className="text-ink px-4 py-2.5 font-medium">
                        {item.insumo.nome}
                      </td>
                      <td className="text-ink-2 px-4 py-2.5 text-right tabular-nums">
                        {formatarQuantidade(item.quantidadeNota.toString())}
                        {converteu && (
                          <span className="text-ink-3 block text-xs">
                            ×{" "}
                            {formatarQuantidade(item.fatorConversao.toString())}{" "}
                            {unidade}
                          </span>
                        )}
                      </td>
                      <td className="text-ink px-4 py-2.5 text-right tabular-nums">
                        {formatarQuantidade(item.quantidade.toString())}{" "}
                        <span className="text-ink-3">{unidade}</span>
                      </td>
                      <td className="text-ink-2 px-4 py-2.5 text-right tabular-nums">
                        {formatarMoeda(item.valorUnitario.toString())}
                        <span className="text-ink-3">/{unidade}</span>
                      </td>
                      <td className="text-ink px-4 py-2.5 text-right font-medium tabular-nums">
                        {formatarMoeda(item.valorTotal.toString())}
                      </td>
                      {rascunho && podeLancar && (
                        <td className="px-4 py-2.5 text-right">
                          <form action={removerItemAcao}>
                            <input
                              type="hidden"
                              name="notaId"
                              value={nota.id}
                            />
                            <input
                              type="hidden"
                              name="itemId"
                              value={item.id}
                            />
                            <Botao
                              peso="fantasma"
                              tamanho="pequeno"
                              type="submit"
                            >
                              Remover
                            </Botao>
                          </form>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-surface-2 border-line border-t">
                  <td
                    colSpan={4}
                    className="text-ink-3 px-4 py-2.5 text-right text-xs font-semibold uppercase"
                  >
                    Total da nota
                  </td>
                  <td className="text-ink px-4 py-2.5 text-right font-semibold tabular-nums">
                    {formatarMoeda(nota.valorTotal.toString())}
                  </td>
                  {rascunho && podeLancar && <td />}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
