import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { Botao } from "@/design-system/botao";
import { formatarMoeda, formatarQuantidade, lerNumeroBr } from "@/lib/numero";
import { sigla } from "@/lib/unidades";
import { AvisoUnidade } from "@/modules/estoque/components/aviso-unidade";
import { SeletorDeCmv } from "@/modules/estoque/components/seletor-de-cmv";
import { percentualDoCmv } from "@/modules/estoque/schemas/cmv";
import {
  calcularCmvDoPeriodo,
  contagensParaCmv,
} from "@/modules/estoque/services/cmv";

const data = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

export default async function PaginaCmv({
  searchParams,
}: {
  searchParams: Promise<{ de?: string; ate?: string; faturamento?: string }>;
}) {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");
  if (!pode(contexto, "estoque.custos")) notFound();

  if (!contexto.unidadeAtiva) {
    return (
      <div className="mx-auto w-full max-w-5xl">
        <h1 className="text-2xl font-semibold tracking-tight">CMV</h1>
        <div className="mt-6">
          <AvisoUnidade acao="Calcular CMV" />
        </div>
      </div>
    );
  }

  const { de, ate, faturamento } = await searchParams;
  const contagens = await contagensParaCmv(contexto);

  if (contagens.length < 2) {
    return (
      <div className="mx-auto w-full max-w-5xl">
        <Cabecalho unidade={contexto.unidadeAtiva.nome} />
        <div className="border-line-2 bg-surface-2 mt-6 rounded-xl border border-dashed px-6 py-10 text-center">
          <p aria-hidden className="text-2xl opacity-50">
            📉
          </p>
          <p className="mt-2 font-semibold">
            {contagens.length === 0
              ? "Ainda não há contagem fechada"
              : "Falta a segunda contagem"}
          </p>
          <p className="text-ink-3 mx-auto mt-1 max-w-lg text-sm">
            O CMV nasce da diferença entre duas fotos do estoque. Com{" "}
            {contagens.length === 0 ? "nenhuma" : "uma"} contagem fechada ele
            ainda não tem de onde partir — a primeira é o marco zero, e o número
            aparece quando a segunda fechar.
          </p>
          <Link href="/estoque/contagens" className="mt-4 inline-block">
            <Botao>Ir para Contagens</Botao>
          </Link>
        </div>
      </div>
    );
  }

  // Sem escolha explícita, as duas mais recentes — o caso comum é "como foi a
  // última semana", e ninguém deveria precisar clicar para ver isso.
  const finalId = ate ?? contagens[0].id;
  const inicialId = de ?? contagens[1].id;

  let resultado: Awaited<ReturnType<typeof calcularCmvDoPeriodo>> | null = null;
  let erro: string | null = null;
  try {
    resultado = await calcularCmvDoPeriodo(contexto, inicialId, finalId);
  } catch (e) {
    erro = e instanceof Error ? e.message : "Não foi possível calcular.";
  }

  const faturado = faturamento ? (lerNumeroBr(faturamento) ?? 0) : 0;
  const percentual = resultado
    ? percentualDoCmv(resultado.cmv, faturado)
    : null;

  return (
    <div className="mx-auto w-full max-w-5xl">
      <Cabecalho unidade={contexto.unidadeAtiva.nome} />

      <div className="mt-6">
        <SeletorDeCmv
          contagens={contagens.map((c) => ({
            id: c.id,
            rotulo: `${data.format(c.referencia)}${c.descricao ? ` · ${c.descricao}` : ""}${c.local ? ` · ${c.local.nome}` : ""} (${c._count.itens} itens)`,
          }))}
          de={inicialId}
          ate={finalId}
          faturamento={faturamento ?? ""}
        />
      </div>

      {erro && (
        <p
          role="alert"
          className="bg-bad-sub text-bad mt-6 rounded-md px-3 py-2 text-sm"
        >
          {erro}
        </p>
      )}

      {resultado && (
        <>
          {/* A CONTA, escrita como se faz no papel. Mostrar só o resultado
              obrigaria a confiar; mostrar as parcelas deixa conferir. */}
          <div className="border-line bg-surface-2 mt-6 rounded-xl border px-5 py-5">
            <dl className="mx-auto max-w-md">
              <Parcela
                rotulo={`Estoque em ${data.format(resultado.periodo.inicial.referencia)}`}
                valor={resultado.valorInicial}
              />
              <Parcela
                rotulo={`+ Compras do período (${resultado.periodo.notas} ${resultado.periodo.notas === 1 ? "item" : "itens"} de nota)`}
                valor={resultado.valorComprado}
              />
              <Parcela
                rotulo={`− Estoque em ${data.format(resultado.periodo.final.referencia)}`}
                valor={-resultado.valorFinal}
              />

              <div className="border-line-2 mt-2 flex items-baseline justify-between border-t pt-3">
                <dt className="font-semibold">
                  CMV de {resultado.periodo.dias}{" "}
                  {resultado.periodo.dias === 1 ? "dia" : "dias"}
                </dt>
                <dd className="text-2xl font-semibold tabular-nums">
                  {formatarMoeda(resultado.cmv)}
                </dd>
              </div>

              {percentual !== null && (
                <div className="mt-1 flex items-baseline justify-between">
                  <dt className="text-ink-3 text-sm">sobre o faturamento</dt>
                  <dd className="text-ink-2 text-lg font-semibold tabular-nums">
                    {percentual.toLocaleString("pt-BR", {
                      minimumFractionDigits: 1,
                      maximumFractionDigits: 1,
                    })}
                    %
                  </dd>
                </div>
              )}
            </dl>
          </div>

          {resultado.suspeitas.length > 0 && (
            <div className="border-bad bg-bad-sub mt-6 rounded-xl border px-5 py-4">
              <p className="text-bad font-semibold">
                {resultado.suspeitas.length}{" "}
                {resultado.suspeitas.length === 1
                  ? "item saiu"
                  : "itens saíram"}{" "}
                negativo
              </p>
              <p className="text-ink-2 mt-1 text-sm">
                Sobrou mais do que existia. Quase sempre é contagem errada,
                embalagem convertida errado, ou nota que ainda não foi lançada.
                Enquanto não for resolvido, o CMV está abaixo do real.
              </p>
              <p className="text-ink-2 mt-2 text-sm">
                {resultado.suspeitas.map((s) => s.nome).join(" · ")}
              </p>
            </div>
          )}

          {resultado.foraDoCalculo.length > 0 && (
            <div className="border-line bg-surface-2 mt-4 rounded-xl border px-5 py-4">
              <p className="font-semibold">
                {resultado.foraDoCalculo.length}{" "}
                {resultado.foraDoCalculo.length === 1
                  ? "item ficou"
                  : "itens ficaram"}{" "}
                de fora
              </p>
              <p className="text-ink-3 mt-1 text-sm">
                Só entram no cálculo os insumos contados nas duas pontas. Um
                item contado só numa delas apareceria como consumo inventado.
              </p>
              <details className="mt-2">
                <summary className="text-ink-2 cursor-pointer text-sm">
                  Ver quais
                </summary>
                <ul className="text-ink-3 mt-2 space-y-0.5 text-sm">
                  {resultado.foraDoCalculo.map((f) => (
                    <li key={f.nome}>
                      {f.nome} — {f.motivo}
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          )}

          <section className="mt-8">
            <h2 className="mb-1 font-semibold">Onde o custo está</h2>
            <p className="text-ink-3 mb-3 text-sm">
              Do maior para o menor. Os primeiros itens costumam responder pela
              maior parte do CMV — é neles que negociar preço muda o resultado.
            </p>

            <div className="border-line overflow-x-auto rounded-xl border">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="bg-surface-2 border-line border-b">
                    <th className="text-ink-3 px-4 py-2.5 text-left text-xs font-semibold uppercase">
                      Insumo
                    </th>
                    <th className="text-ink-3 px-4 py-2.5 text-right text-xs font-semibold uppercase">
                      Inicial
                    </th>
                    <th className="text-ink-3 px-4 py-2.5 text-right text-xs font-semibold uppercase">
                      Comprado
                    </th>
                    <th className="text-ink-3 px-4 py-2.5 text-right text-xs font-semibold uppercase">
                      Final
                    </th>
                    <th className="text-ink-3 px-4 py-2.5 text-right text-xs font-semibold uppercase">
                      Consumo
                    </th>
                    <th className="text-ink-3 px-4 py-2.5 text-right text-xs font-semibold uppercase">
                      CMV
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {resultado.linhas.map((l) => (
                    <tr
                      key={l.insumoId}
                      className={`border-line border-b last:border-b-0 ${l.consumo < 0 ? "bg-bad-sub" : ""}`}
                    >
                      <td className="px-4 py-2.5">
                        <span className="text-ink block font-medium">
                          {l.nome}
                        </span>
                        {l.categoria && (
                          <span className="text-ink-3 block text-xs">
                            {l.categoria}
                          </span>
                        )}
                      </td>
                      <td className="text-ink-3 px-4 py-2.5 text-right tabular-nums">
                        {formatarQuantidade(l.inicial)}
                      </td>
                      <td className="text-ink-3 px-4 py-2.5 text-right tabular-nums">
                        {l.comprado > 0 ? formatarQuantidade(l.comprado) : "—"}
                      </td>
                      <td className="text-ink-3 px-4 py-2.5 text-right tabular-nums">
                        {formatarQuantidade(l.final)}
                      </td>
                      <td
                        className={`px-4 py-2.5 text-right tabular-nums ${l.consumo < 0 ? "text-bad font-semibold" : "text-ink-2"}`}
                      >
                        {formatarQuantidade(l.consumo)}{" "}
                        <span className="text-ink-3">{sigla(l.unidade)}</span>
                      </td>
                      <td className="text-ink px-4 py-2.5 text-right font-medium tabular-nums">
                        {formatarMoeda(l.cmv)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-surface-2 border-line border-t">
                    <td
                      colSpan={5}
                      className="text-ink-3 px-4 py-2.5 text-right text-xs font-semibold uppercase"
                    >
                      Total
                    </td>
                    <td className="text-ink px-4 py-2.5 text-right font-semibold tabular-nums">
                      {formatarMoeda(resultado.cmv)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Parcela({ rotulo, valor }: { rotulo: string; valor: number }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <dt className="text-ink-2 min-w-0 text-sm">{rotulo}</dt>
      <dd className="flex-none tabular-nums">{formatarMoeda(valor)}</dd>
    </div>
  );
}

function Cabecalho({ unidade }: { unidade: string }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">CMV</h1>
      <p className="text-ink-3 mt-1 text-sm">
        Custo da mercadoria vendida · {unidade}
      </p>
    </div>
  );
}
