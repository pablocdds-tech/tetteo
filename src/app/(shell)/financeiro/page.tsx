import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { formatarMoeda } from "@/lib/numero";
import { AvisoUnidade } from "@/modules/financeiro/components/aviso-unidade";
import { ImportarNotas } from "@/modules/financeiro/components/importar-notas";
import {
  listarCategorias,
  notasSemContaAPagar,
} from "@/modules/financeiro/services/cadastros";
import { visaoDoCaixa } from "@/modules/financeiro/services/lancamentos";

const data = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
});

export default async function PaginaFinanceiro() {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");
  if (!pode(contexto, "financeiro.ver")) notFound();

  if (!contexto.unidadeAtiva) {
    return (
      <div className="mx-auto w-full max-w-5xl">
        <Cabecalho />
        <div className="mt-6">
          <AvisoUnidade acao="Ver o caixa" />
        </div>
      </div>
    );
  }

  const podeLancar = pode(contexto, "financeiro.lancar");
  const [caixa, notas, categorias] = await Promise.all([
    visaoDoCaixa(contexto, 30),
    podeLancar ? notasSemContaAPagar(contexto) : Promise.resolve([]),
    listarCategorias(contexto),
  ]);

  const { resumo, projecao } = caixa;
  // O dia em que o saldo vira negativo — a única informação desta tela que
  // muda decisão hoje em vez de no fim do mês.
  const rompe = projecao.find((d) => d.saldo < 0);

  return (
    <div className="mx-auto w-full max-w-5xl">
      <Cabecalho unidade={contexto.unidadeAtiva.nome} />

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <Cartao
          titulo="Saldo hoje"
          valor={caixa.saldoAtual}
          detalhe={
            caixa.contas.length === 0
              ? "nenhuma conta cadastrada"
              : `${caixa.contas.length} ${caixa.contas.length === 1 ? "conta" : "contas"}`
          }
          cor={caixa.saldoAtual < 0 ? "text-bad" : undefined}
        />
        <Cartao
          titulo="A pagar em aberto"
          valor={resumo.totalAPagar}
          detalhe={
            resumo.contasVencidas > 0
              ? `${resumo.contasVencidas} ${resumo.contasVencidas === 1 ? "vencida" : "vencidas"}`
              : "nada vencido"
          }
          cor={resumo.contasVencidas > 0 ? "text-bad" : undefined}
        />
        <Cartao
          titulo="A receber em aberto"
          valor={resumo.totalAReceber}
          detalhe={`sobra prevista ${formatarMoeda(resumo.saldoDoPeriodo)}`}
        />
      </div>

      {podeLancar && notas.length > 0 && (
        <div className="mt-6">
          <ImportarNotas notas={notas} categorias={categorias} />
        </div>
      )}

      <section className="mt-8">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold">Quando vence</h2>
          <Link
            href="/financeiro/pagar"
            className="text-accent text-sm font-semibold"
          >
            Ver contas a pagar →
          </Link>
        </div>

        <div className="border-line divide-line mt-3 divide-y rounded-xl border">
          {(
            [
              ["vencido", "Já venceu"],
              ["hoje", "Vence hoje"],
              ["semana", "Próximos 7 dias"],
              ["depois", "Depois"],
            ] as const
          ).map(([faixa, rotulo]) => (
            <div
              key={faixa}
              className="flex items-center gap-4 px-4 py-2.5 text-sm"
            >
              <span
                className={`min-w-0 flex-1 ${faixa === "vencido" && resumo.aPagar.vencido > 0 ? "text-bad font-semibold" : ""}`}
              >
                {rotulo}
              </span>
              <span className="text-ink-3 w-32 text-right tabular-nums">
                {resumo.aReceber[faixa] > 0
                  ? `+ ${formatarMoeda(resumo.aReceber[faixa])}`
                  : ""}
              </span>
              <span
                className={`w-32 text-right tabular-nums ${
                  resumo.aPagar[faixa] > 0 ? "text-ink" : "text-ink-3"
                }`}
              >
                {resumo.aPagar[faixa] > 0
                  ? `− ${formatarMoeda(resumo.aPagar[faixa])}`
                  : "—"}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="font-semibold">Saldo projetado — 30 dias</h2>
        <p className="text-ink-3 mt-1 text-sm">
          Começa no saldo de hoje e caminha com o que está em aberto. Contas já
          vencidas entram no primeiro dia.
        </p>

        {rompe ? (
          <p className="bg-bad-sub text-bad mt-3 rounded-md px-3 py-2 text-sm">
            O saldo fica negativo em <strong>{data.format(rompe.data)}</strong>{" "}
            ({formatarMoeda(rompe.saldo)}). Dá para antecipar recebimento ou
            renegociar vencimento antes disso.
          </p>
        ) : (
          <p className="bg-ok-sub text-ok mt-3 rounded-md px-3 py-2 text-sm">
            O saldo não fica negativo nos próximos 30 dias.
          </p>
        )}

        <div className="border-line mt-3 overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="bg-surface-2 text-ink-3">
              <tr>
                <th className="px-4 py-2 text-left font-semibold">Dia</th>
                <th className="px-4 py-2 text-right font-semibold">Entra</th>
                <th className="px-4 py-2 text-right font-semibold">Sai</th>
                <th className="px-4 py-2 text-right font-semibold">Saldo</th>
              </tr>
            </thead>
            <tbody className="divide-line divide-y">
              {projecao
                .filter((d) => d.entradas > 0 || d.saidas > 0)
                .map((d) => (
                  <tr key={d.data.toISOString()}>
                    <td className="px-4 py-2 tabular-nums">
                      {data.format(d.data)}
                    </td>
                    <td className="text-ok px-4 py-2 text-right tabular-nums">
                      {d.entradas > 0 ? formatarMoeda(d.entradas) : "—"}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {d.saidas > 0 ? formatarMoeda(d.saidas) : "—"}
                    </td>
                    <td
                      className={`px-4 py-2 text-right font-semibold tabular-nums ${
                        d.saldo < 0 ? "text-bad" : ""
                      }`}
                    >
                      {formatarMoeda(d.saldo)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {projecao.every((d) => d.entradas === 0 && d.saidas === 0) && (
          <p className="text-ink-3 mt-3 text-sm">
            Nenhum vencimento nos próximos 30 dias.
          </p>
        )}
      </section>
    </div>
  );
}

function Cartao({
  titulo,
  valor,
  detalhe,
  cor,
}: {
  titulo: string;
  valor: number;
  detalhe: string;
  cor?: string;
}) {
  return (
    <div className="border-line bg-surface-2 rounded-xl border p-4">
      <span className="text-ink-3 block text-xs font-semibold tracking-wide uppercase">
        {titulo}
      </span>
      <span
        className={`mt-1 block text-2xl font-semibold tabular-nums ${cor ?? ""}`}
      >
        {formatarMoeda(valor)}
      </span>
      <span className="text-ink-3 block text-xs">{detalhe}</span>
    </div>
  );
}

function Cabecalho({ unidade }: { unidade?: string }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Visão do caixa</h1>
      <p className="text-ink-3 mt-1 text-sm">
        {unidade
          ? `Tenho dinheiro para o que vence? · ${unidade}`
          : "Tenho dinheiro para o que vence?"}
      </p>
    </div>
  );
}
