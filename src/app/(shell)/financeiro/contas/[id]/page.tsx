import Link from "next/link";
import { randomUUID } from "node:crypto";
import { notFound, redirect } from "next/navigation";
import { obterContexto, pode } from "@/core/sessao/contexto";
import { formatarMoeda } from "@/lib/numero";
import { db } from "@/server/db";
import {
  FormContaBanco,
  FormEstornoBanco,
} from "@/modules/financeiro/components/formularios-bancos";
import {
  listarEmpresasBancarias,
  listarSaldosBancarios,
  extratoBancario,
} from "@/modules/financeiro/services/bancos";
import { diaNoFuso, dataBancaria } from "@/modules/financeiro/schemas/bancos";
import { AvisoUnidade } from "@/modules/financeiro/components/aviso-unidade";

export default async function PaginaExtrato({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ de?: string; ate?: string }>;
}) {
  const ctx = await obterContexto();
  if (!ctx) redirect("/login");
  if (!pode(ctx, "financeiro.ver")) notFound();
  if (!ctx.unidadeAtiva) return <AvisoUnidade acao="Ver o extrato bancário" />;
  const [{ id }, filtro, contas, empresas, unidade] = await Promise.all([
    params,
    searchParams,
    listarSaldosBancarios(ctx),
    listarEmpresasBancarias(ctx),
    db.unidade.findUniqueOrThrow({
      where: { id: ctx.unidadeAtiva.id },
      select: { fusoHorario: true },
    }),
  ]);
  const conta = contas.find((c) => c.id === id);
  if (!conta) notFound();
  const hoje = diaNoFuso(new Date(), unidade.fusoHorario);
  const de = filtro.de ?? hoje.slice(0, 8) + "01",
    ate = filtro.ate ?? hoje;
  let extrato: Awaited<ReturnType<typeof extratoBancario>> | null = null,
    erro = "";
  try {
    extrato = await extratoBancario(ctx, id, de, ate);
  } catch (e) {
    erro =
      e instanceof Error ? e.message : "Não foi possível carregar o extrato.";
  }
  const editar = pode(ctx, "financeiro.lancar");
  return (
    <div className="mx-auto w-full max-w-5xl">
      <Link
        href="/financeiro/contas"
        className="text-accent text-sm font-semibold"
      >
        ← Contas bancárias
      </Link>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {conta.nome}
          </h1>
          <p className="text-ink-3 mt-1 text-sm">
            {conta.empresa
              ? `${conta.empresa.nome} · ${conta.empresa.cnpj}`
              : "Conta anterior à separação por CNPJ"}
          </p>
          <p className="text-ink-3 mt-1 text-sm">
            {conta.banco} {conta.agencia ? `· Agência ${conta.agencia}` : ""}{" "}
            {conta.numero ? `· Conta ${conta.numero}` : ""}{" "}
            {conta.nomeTitular
              ? `· ${conta.titularidade}: ${conta.nomeTitular}`
              : ""}
          </p>
        </div>
        <div>
          <span className="text-ink-3 text-xs">Saldo registrado hoje</span>
          <strong className="mt-1 block text-3xl font-semibold tabular-nums">
            {formatarMoeda(Number(conta.saldo))}
          </strong>
        </div>
      </div>
      <p className="text-ink-3 mt-4 text-sm">
        {conta.corteAplicado
          ? `Abertura em ${diaNoFuso(conta.iniciadaEm, unidade.fusoHorario).split("-").reverse().join("/")}: ${formatarMoeda(Number(conta.saldoInicial))}. Baixas anteriores à abertura ficam fora deste saldo.`
          : "Histórico anterior preservado integralmente. Atribuir um CNPJ não reescreve o saldo nem aplica um corte retroativo."}
      </p>
      <form
        method="get"
        className="border-line bg-surface-2 mt-6 flex flex-wrap items-end gap-3 rounded-xl border p-4"
      >
        <label className="text-ink-2 flex min-w-0 flex-1 flex-col gap-1 text-sm font-semibold">
          De
          <input
            name="de"
            type="date"
            defaultValue={de}
            min="2000-01-01"
            max={hoje}
            required
            className="border-line-2 bg-surface h-10 min-w-0 rounded-md border px-3"
          />
        </label>
        <label className="text-ink-2 flex min-w-0 flex-1 flex-col gap-1 text-sm font-semibold">
          Até
          <input
            name="ate"
            type="date"
            defaultValue={ate}
            min="2000-01-01"
            max={hoje}
            required
            className="border-line-2 bg-surface h-10 min-w-0 rounded-md border px-3"
          />
        </label>
        <button
          className="border-line-2 bg-surface h-10 rounded-md border px-4 text-sm font-semibold"
          type="submit"
        >
          Ver extrato
        </button>
      </form>
      {erro && (
        <p
          role="alert"
          className="bg-bad-sub text-bad mt-4 rounded-md p-4 text-sm"
        >
          {erro}
        </p>
      )}
      {extrato && (
        <>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {[
              ["Saldo anterior ao período", extrato.saldoAnterior],
              ["Saldo ao final do período", extrato.saldoFinal],
            ].map(([titulo, valor]) => (
              <div className="border-line rounded-xl border p-4" key={titulo}>
                <span className="text-ink-3 text-xs">{titulo}</span>
                <strong className="mt-1 block text-xl font-semibold tabular-nums">
                  {formatarMoeda(Number(valor))}
                </strong>
              </div>
            ))}
          </div>
          <section className="mt-6">
            <h2 className="font-semibold">Movimentos</h2>
            <p className="text-ink-3 mt-1 text-sm">
              Pagamentos, recebimentos e transferências. Fechamento por dia, sem
              efeito das transferências no DRE.
            </p>
            {!extrato.movimentos.length ? (
              <p className="border-line-2 text-ink-3 mt-4 rounded-xl border border-dashed p-8 text-center text-sm">
                Nenhum movimento neste período. O saldo anterior permanece como
                fechamento.
              </p>
            ) : (
              <div className="mt-4 space-y-5">
                {extrato.dias.map((dia) => (
                  <div
                    key={dia.dia}
                    className="border-line overflow-hidden rounded-xl border"
                  >
                    <div className="bg-surface-2 flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                      <h3 className="font-semibold">
                        {dataBancaria(dia.dia).toLocaleDateString("pt-BR", {
                          timeZone: "UTC",
                        })}
                      </h3>
                      <span className="text-ink-2">
                        Fechamento{" "}
                        <strong className="tabular-nums">
                          {formatarMoeda(Number(dia.saldo))}
                        </strong>
                      </span>
                    </div>
                    <ul className="divide-line divide-y">
                      {extrato!.movimentos
                        .filter((m) => m.dia === dia.dia)
                        .map((m) => (
                          <li key={m.id} className="p-4">
                            <div className="flex items-start justify-between gap-4">
                              <div className="min-w-0">
                                <span className="text-ink-3 block text-xs">
                                  {m.tipo}
                                </span>
                                <p className="mt-1 text-sm break-words">
                                  {m.descricao}
                                </p>
                              </div>
                              <div className="shrink-0 text-right">
                                <strong
                                  className={`text-sm tabular-nums ${Number(m.valor) > 0 ? "text-ok" : ""}`}
                                >
                                  {Number(m.valor) > 0 ? "+ " : ""}
                                  {formatarMoeda(Number(m.valor))}
                                </strong>
                                <span className="text-ink-3 mt-1 block text-xs tabular-nums">
                                  Saldo {formatarMoeda(Number(m.saldo))}
                                </span>
                              </div>
                            </div>
                            {editar &&
                              pode(ctx, "financeiro.quitar") &&
                              m.estornavel &&
                              m.transferenciaId && (
                                <details className="mt-3">
                                  <summary className="text-accent cursor-pointer text-xs font-semibold">
                                    Estornar transferência
                                  </summary>
                                  <div className="max-w-sm">
                                    <FormEstornoBanco
                                      id={m.transferenciaId}
                                      hoje={hoje}
                                      chave={randomUUID()}
                                    />
                                  </div>
                                </details>
                              )}
                          </li>
                        ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
      {editar && (
        <details className="border-line mt-8 rounded-xl border p-4">
          <summary className="cursor-pointer font-semibold">
            Editar cadastro da conta
          </summary>
          <FormContaBanco
            key={conta.versao}
            empresas={empresas}
            hoje={hoje}
            conta={{
              ...conta,
              dataInicial: diaNoFuso(conta.iniciadaEm, unidade.fusoHorario),
            }}
          />
        </details>
      )}
    </div>
  );
}
