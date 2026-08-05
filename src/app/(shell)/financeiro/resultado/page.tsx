import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { hojeParaCampo, lerDataLocal } from "@/lib/data";
import { formatarMoeda } from "@/lib/numero";
import { AvisoUnidade } from "@/modules/financeiro/components/aviso-unidade";
import { QuadroDre } from "@/modules/financeiro/components/quadro-dre";
import { montarDre } from "@/modules/financeiro/schemas/dre";
import { movimentosParaDre } from "@/modules/financeiro/services/lancamentos";
import {
  calcularCmvDoPeriodo,
  contagensParaCmv,
} from "@/modules/estoque/services/cmv";

const data = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
});

/**
 * O DRE.
 *
 * Esta rota é o lugar CERTO para a composição entre dois Apps: a camada de
 * roteamento pode falar com qualquer módulo, enquanto um módulo não pode falar
 * com outro. O Financeiro monta a demonstração e recebe o CMV pronto; quem
 * calcula o CMV continua sendo o Estoque, onde a contagem mora.
 *
 * Sem isso, ou o Financeiro reimplementaria a conta do CMV — duas versões da
 * mesma regra, esperando para divergir — ou somaria as compras como custo, que
 * é o erro que o DRE inteiro existe para não cometer.
 */
export default async function PaginaResultado({
  searchParams,
}: {
  searchParams: Promise<{
    de?: string;
    ate?: string;
    base?: string;
    inicial?: string;
    final?: string;
  }>;
}) {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");
  if (!pode(contexto, "financeiro.resultado")) notFound();

  if (!contexto.unidadeAtiva) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <AvisoUnidade acao="Ver o resultado" />
      </div>
    );
  }

  const params = await searchParams;
  const agora = new Date();
  const primeiroDoMes = new Date(agora.getFullYear(), agora.getMonth(), 1);

  const de = params.de
    ? (lerDataLocal(params.de) ?? primeiroDoMes)
    : primeiroDoMes;
  const ate = params.ate ? (lerDataLocal(params.ate) ?? agora) : agora;
  const ateFim = new Date(ate);
  ateFim.setHours(23, 59, 59, 999);

  const base = params.base === "caixa" ? "caixa" : "competencia";

  // As contagens fechadas que podem delimitar o CMV. O período do estoque é o
  // que existe entre duas contagens — quase nunca o mês do calendário, e forçar
  // as datas do DRE sobre ele daria um número inventado.
  const contagens = pode(contexto, "estoque.custos")
    ? await contagensParaCmv(contexto)
    : [];

  const inicialId = params.inicial ?? contagens[1]?.id;
  const finalId = params.final ?? contagens[0]?.id;

  const cmv =
    inicialId && finalId && inicialId !== finalId
      ? await calcularCmvDoPeriodo(contexto, inicialId, finalId)
      : null;

  const movimentos = await movimentosParaDre(contexto, de, ateFim, base);
  const dre = montarDre(movimentos, cmv?.cmv ?? 0);

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Resultado (DRE)
          </h1>
          <p className="text-ink-3 mt-1 text-sm">
            {contexto.unidadeAtiva.nome} ·{" "}
            {base === "competencia"
              ? "por competência (vencimento)"
              : "por caixa (pagamento)"}
          </p>
        </div>

        <form className="flex flex-wrap items-end gap-2 text-sm">
          <input type="hidden" name="inicial" value={inicialId ?? ""} />
          <input type="hidden" name="final" value={finalId ?? ""} />
          <label className="flex flex-col gap-1">
            <span className="text-ink-2 text-xs font-semibold">De</span>
            <input
              type="date"
              name="de"
              defaultValue={hojeParaCampo(de)}
              className="border-line-2 bg-surface text-ink h-9 rounded-md border px-2"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-ink-2 text-xs font-semibold">Até</span>
            <input
              type="date"
              name="ate"
              defaultValue={hojeParaCampo(ate)}
              className="border-line-2 bg-surface text-ink h-9 rounded-md border px-2"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-ink-2 text-xs font-semibold">Base</span>
            <select
              name="base"
              defaultValue={base}
              className="border-line-2 bg-surface text-ink h-9 rounded-md border px-2"
            >
              <option value="competencia">Competência</option>
              <option value="caixa">Caixa</option>
            </select>
          </label>
          <button
            type="submit"
            className="border-line-2 hover:bg-surface-2 h-9 rounded-md border px-3 font-semibold"
          >
            Ver
          </button>
        </form>
      </div>

      {/* O CMV vem do Estoque e depende de DUAS contagens fechadas. Sem elas o
          DRE ainda fecha — só que com a linha mais importante em zero, e a tela
          precisa dizer isso alto em vez de mostrar um lucro bruto fantasioso. */}
      {cmv ? (
        <p className="border-line bg-surface-2 text-ink-2 mt-4 rounded-xl border px-4 py-3 text-sm">
          CMV de <strong>{formatarMoeda(cmv.cmv)}</strong>, calculado entre as
          contagens de{" "}
          {data.format(contagens.find((c) => c.id === inicialId)!.referencia)} e{" "}
          {data.format(contagens.find((c) => c.id === finalId)!.referencia)}.{" "}
          <Link href="/estoque/cmv" className="text-accent font-semibold">
            Ver o cálculo →
          </Link>
        </p>
      ) : (
        <p className="bg-warn-sub text-warn mt-4 rounded-xl px-4 py-3 text-sm">
          <strong>O CMV está zerado</strong> porque não há duas contagens de
          estoque fechadas nesta unidade. Sem elas, o lucro bruto abaixo ignora
          o custo da comida — que costuma ser o maior de todos.{" "}
          <Link href="/estoque/contagens" className="font-semibold underline">
            Fazer uma contagem →
          </Link>
        </p>
      )}

      <div className="mt-6">
        <QuadroDre dre={dre} />
      </div>

      <div className="text-ink-3 mt-4 flex flex-col gap-1 text-xs">
        {dre.comprasIgnoradas > 0 && (
          <p>
            Compras de mercadoria no período:{" "}
            <strong className="tabular-nums">
              {formatarMoeda(dre.comprasIgnoradas)}
            </strong>{" "}
            — fora do DRE de propósito. O custo da comida é o CMV (o que foi
            consumido), não o que foi comprado. A diferença entre os dois é
            estoque que subiu ou desceu.
          </p>
        )}
        {dre.investimentos > 0 && (
          <p>
            Investimentos:{" "}
            <strong className="tabular-nums">
              {formatarMoeda(dre.investimentos)}
            </strong>{" "}
            — saem do caixa, não do lucro.
          </p>
        )}
        {dre.semClassificacao > 0 && (
          <p className="text-warn">
            {formatarMoeda(dre.semClassificacao)} em categorias sem linha de DRE
            — não entram em nenhuma conta acima.{" "}
            <Link href="/financeiro/categorias" className="underline">
              Classificar
            </Link>
          </p>
        )}
        <p className="mt-2">
          {base === "competencia"
            ? "Competência usa a data de vencimento — o mês a que a conta pertence. É uma aproximação: a luz que vence dia 10 é do consumo do mês anterior."
            : "Caixa usa a data de pagamento. Responde “sobrou dinheiro”, não “deu lucro”."}
        </p>
      </div>
    </div>
  );
}
