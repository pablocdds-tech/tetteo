import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { hojeParaCampo, lerDataLocal } from "@/lib/data";
import { formatarMoeda } from "@/lib/numero";
import { AvisoUnidade } from "@/modules/financeiro/components/aviso-unidade";
import { resultadoDoPeriodo } from "@/modules/financeiro/services/lancamentos";
import type { LinhaDoResultado } from "@/modules/financeiro/schemas/dinheiro";

export default async function PaginaResultado({
  searchParams,
}: {
  searchParams: Promise<{ de?: string; ate?: string }>;
}) {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");
  if (!pode(contexto, "financeiro.resultado")) notFound();

  if (!contexto.unidadeAtiva) {
    return (
      <div className="mx-auto w-full max-w-4xl">
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
  // Inclui o dia inteiro do fim: quem digita 31/08 quer o dia 31 junto.
  const ateFim = new Date(ate);
  ateFim.setHours(23, 59, 59, 999);

  const r = await resultadoDoPeriodo(contexto, de, ateFim);

  return (
    <div className="mx-auto w-full max-w-4xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Resultado</h1>
          <p className="text-ink-3 mt-1 text-sm">
            O que entrou e saiu de verdade · {contexto.unidadeAtiva.nome}
          </p>
        </div>

        <form className="flex flex-wrap items-end gap-2 text-sm">
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
          <button
            type="submit"
            className="border-line-2 hover:bg-surface-2 h-9 rounded-md border px-3 font-semibold"
          >
            Ver
          </button>
        </form>
      </div>

      {/* A ressalva vem ANTES do número, não num rodapé. Confundir caixa com
          competência é o erro de leitura mais caro que um dono de restaurante
          comete — e ele acontece justamente porque a ressalva fica escondida. */}
      <p className="border-line bg-surface-2 text-ink-2 mt-4 rounded-xl border px-4 py-3 text-sm">
        Isto é <strong>regime de caixa</strong>: o que foi efetivamente pago e
        recebido, na data em que aconteceu. Não é o custo do que foi consumido —
        mercadoria comprada em julho e usada em agosto é custo de agosto. Essa
        pergunta quem responde é o{" "}
        <Link href="/estoque/cmv" className="text-accent font-semibold">
          CMV do Estoque
        </Link>
        , com a contagem na mão.
      </p>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <Cartao titulo="Entrou" valor={r.totalReceitas} cor="text-ok" />
        <Cartao titulo="Saiu" valor={r.totalDespesas} />
        <Cartao
          titulo="Sobrou"
          valor={r.sobra}
          cor={r.sobra < 0 ? "text-bad" : "text-ok"}
          detalhe={
            r.margem !== null
              ? `${r.margem.toLocaleString("pt-BR")}% da receita`
              : undefined
          }
        />
      </div>

      {r.semCategoria > 0 && (
        <p className="bg-warn-sub text-warn mt-4 rounded-md px-3 py-2 text-sm">
          {formatarMoeda(r.semCategoria)} movimentados sem categoria — não
          entram em nenhuma linha abaixo. Categorize para o resultado fechar.
        </p>
      )}

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <Bloco
          titulo="Entradas"
          linhas={r.receitas}
          vazio="Nada recebido no período."
        />
        <Bloco
          titulo="Saídas"
          linhas={r.despesas}
          vazio="Nada pago no período."
        />
      </div>
    </div>
  );
}

function Bloco({
  titulo,
  linhas,
  vazio,
}: {
  titulo: string;
  linhas: LinhaDoResultado[];
  vazio: string;
}) {
  return (
    <section>
      <h2 className="font-semibold">{titulo}</h2>
      {linhas.length === 0 ? (
        <p className="text-ink-3 mt-2 text-sm">{vazio}</p>
      ) : (
        <div className="border-line divide-line mt-2 divide-y rounded-xl border">
          {linhas.map((l) => (
            <div
              key={l.categoria}
              className="flex items-center gap-3 px-4 py-2.5 text-sm"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate">{l.categoria}</span>
                {l.grupo && (
                  <span className="text-ink-3 block text-xs">{l.grupo}</span>
                )}
              </span>
              <span className="text-ink-3 w-14 text-right text-xs tabular-nums">
                {l.percentual !== null
                  ? `${l.percentual.toLocaleString("pt-BR")}%`
                  : ""}
              </span>
              <span className="w-28 text-right tabular-nums">
                {formatarMoeda(l.valor)}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Cartao({
  titulo,
  valor,
  cor,
  detalhe,
}: {
  titulo: string;
  valor: number;
  cor?: string;
  detalhe?: string;
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
      {detalhe && <span className="text-ink-3 block text-xs">{detalhe}</span>}
    </div>
  );
}
