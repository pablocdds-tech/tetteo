import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { Botao } from "@/design-system/botao";
import {
  cancelarCotacaoAcao,
  recusarPropostaAcao,
} from "@/modules/compras/acoes";
import { AvisoUnidade } from "@/modules/compras/components/aviso-unidade";
import { EditorDeCotacao } from "@/modules/compras/components/editor-de-cotacao";
import { GradeDeComparacao } from "@/modules/compras/components/grade-de-comparacao";
import { LancarProposta } from "@/modules/compras/components/lancar-proposta";
import {
  insumosDisponiveis,
  obterCotacao,
} from "@/modules/compras/services/cotacoes";
import { listarFornecedores } from "@/modules/compras/services/fornecedores";

export default async function PaginaCotacao({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");
  if (!pode(contexto, "compras.ver")) notFound();

  if (!contexto.unidadeAtiva) {
    return (
      <div className="mx-auto w-full max-w-5xl">
        <AvisoUnidade acao="Cotar preço" />
      </div>
    );
  }

  const { id } = await params;
  const cotacao = await obterCotacao(contexto, id);
  if (!cotacao) notFound();

  const [insumos, fornecedores] = await Promise.all([
    insumosDisponiveis(contexto),
    listarFornecedores(contexto),
  ]);

  const aberta = cotacao.status === "ABERTA";
  const podeCotar = aberta && pode(contexto, "compras.cotar");

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href="/compras/cotacoes"
            className="text-ink-3 hover:text-ink text-sm"
          >
            ← Cotações
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {cotacao.descricao}
          </h1>
          <p className="text-ink-3 mt-1 text-sm">
            {cotacao.itens.length}{" "}
            {cotacao.itens.length === 1 ? "item" : "itens"} ·{" "}
            {cotacao.propostas.length}{" "}
            {cotacao.propostas.length === 1 ? "fornecedor" : "fornecedores"}
            {cotacao.status !== "ABERTA"
              ? ` · ${cotacao.status.toLowerCase()}`
              : ""}
          </p>
        </div>

        {podeCotar && (
          <form action={cancelarCotacaoAcao}>
            <input type="hidden" name="cotacaoId" value={cotacao.id} />
            <Botao peso="fantasma" tamanho="pequeno" type="submit">
              Cancelar cotação
            </Botao>
          </form>
        )}
      </div>

      {!aberta && (
        <p className="border-line bg-surface-2 text-ink-2 mt-4 rounded-xl border px-4 py-3 text-sm">
          Cotação fechada. Os preços viraram histórico e não mudam mais — é
          deles que sai a comparação de quanto custava em cada época.
          {cotacao.pedidosGerados.length > 0 && (
            <>
              {" "}
              <Link href="/compras" className="text-accent font-semibold">
                Ver os {cotacao.pedidosGerados.length} pedidos gerados →
              </Link>
            </>
          )}
        </p>
      )}

      {aberta && (
        <div className="mt-6">
          <EditorDeCotacao
            cotacao={cotacao}
            insumos={insumos}
            fornecedores={fornecedores}
            podeEditar={podeCotar}
          />
        </div>
      )}

      {podeCotar &&
        cotacao.itens.length > 0 &&
        cotacao.propostas.length > 0 && (
          <section className="mt-10">
            <h2 className="font-semibold">Os preços que chegaram</h2>
            <p className="text-ink-3 mt-1 text-sm">
              Digite como o fornecedor falou — &quot;caixa de 10 kg por
              300&quot;. O preço por unidade aparece ao lado, calculado.
            </p>

            <div className="mt-3 flex flex-col gap-4">
              {cotacao.propostas
                .filter((p) => p.status !== "RECUSADA")
                .map((proposta) => (
                  <details
                    key={proposta.id}
                    open={proposta.status !== "RESPONDIDA"}
                    className="border-line rounded-xl border"
                  >
                    <summary className="flex cursor-pointer items-center gap-3 px-4 py-3">
                      <span className="min-w-0 flex-1 font-medium">
                        {proposta.fornecedor}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          proposta.status === "RESPONDIDA"
                            ? "bg-ok-sub text-ok"
                            : "bg-warn-sub text-warn"
                        }`}
                      >
                        {proposta.status === "RESPONDIDA"
                          ? "respondeu"
                          : "aguardando"}
                      </span>
                    </summary>

                    <div className="border-line border-t px-4 py-4">
                      <LancarProposta
                        cotacaoId={cotacao.id}
                        proposta={proposta}
                        itens={cotacao.itens}
                      />
                      <form action={recusarPropostaAcao} className="mt-3">
                        <input
                          type="hidden"
                          name="cotacaoId"
                          value={cotacao.id}
                        />
                        <input
                          type="hidden"
                          name="propostaId"
                          value={proposta.id}
                        />
                        <Botao peso="fantasma" tamanho="pequeno" type="submit">
                          Este não vai cotar
                        </Botao>
                      </form>
                    </div>
                  </details>
                ))}
            </div>
          </section>
        )}

      {cotacao.itens.length > 0 && (
        <section className="mt-10">
          <h2 className="font-semibold">Comparação</h2>
          <p className="text-ink-3 mt-1 text-sm">
            Preço já convertido para a unidade do insumo e multiplicado pela
            quantidade. O verde é o mais barato de cada linha.
          </p>

          <div className="mt-3">
            <GradeDeComparacao
              cotacaoId={cotacao.id}
              comparacao={cotacao.comparacao}
              aberta={aberta}
              podePedir={pode(contexto, "compras.pedir")}
            />
          </div>
        </section>
      )}
    </div>
  );
}
