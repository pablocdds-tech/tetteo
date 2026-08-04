import Link from "next/link";
import { redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { Botao } from "@/design-system/botao";
import { formatarMoeda, formatarQuantidade } from "@/lib/numero";
import { sigla } from "@/lib/unidades";
import { AvisoUnidade } from "@/modules/estoque/components/aviso-unidade";
import { listarPosicao } from "@/modules/estoque/services/posicao";
import { listarLocais } from "@/modules/estoque/services/rotinas";

const data = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

export default async function PaginaPosicao({
  searchParams,
}: {
  searchParams: Promise<{ local?: string; faltando?: string }>;
}) {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  if (!contexto.unidadeAtiva) {
    return (
      <div className="mx-auto w-full max-w-5xl">
        <h1 className="text-2xl font-semibold tracking-tight">Posição</h1>
        <div className="mt-6">
          <AvisoUnidade acao="Ver estoque" />
        </div>
      </div>
    );
  }

  const { local, faltando } = await searchParams;
  const soFaltando = faltando === "1";

  const [posicao, locais] = await Promise.all([
    listarPosicao(contexto, {
      localId: local ?? null,
      abaixoDoMinimo: soFaltando,
    }),
    listarLocais(contexto),
  ]);

  const podeVerCustos = pode(contexto, "estoque.custos");
  const rota = (params: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    if (params.local) q.set("local", params.local);
    if (params.faltando) q.set("faltando", params.faltando);
    const texto = q.toString();
    return texto ? `/estoque?${texto}` : "/estoque";
  };

  return (
    <div className="mx-auto w-full max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight">Posição</h1>
      <p className="text-ink-3 mt-1 text-sm">
        O que existe hoje · {contexto.unidadeAtiva.nome}
      </p>

      {/* A honestidade que a tela precisa ter: sem baixa de saída, este saldo
          só cresce. Dizer isso evita decisão de compra sobre número falso. */}
      <p className="border-line-2 bg-surface-2 text-ink-3 mt-4 rounded-xl border border-dashed px-4 py-3 text-sm">
        Este saldo vem das{" "}
        <strong className="text-ink-2">contagens fechadas</strong> mais as{" "}
        <strong className="text-ink-2">notas lançadas</strong> depois delas. As
        saídas ainda não são registradas — então ele fica alto até a próxima
        contagem corrigir.{" "}
        {posicao.ultimaContagem
          ? `Última contagem: ${data.format(posicao.ultimaContagem.referencia)}.`
          : "Nenhuma contagem fechada ainda."}
      </p>

      {podeVerCustos && (
        <div className="border-line bg-surface-2 mt-4 flex flex-wrap items-baseline gap-x-8 gap-y-2 rounded-xl border px-5 py-4">
          <div>
            <p className="text-ink-3 font-mono text-[10px] tracking-[0.14em] uppercase">
              Valor em estoque
            </p>
            <p className="text-2xl font-semibold tabular-nums">
              {formatarMoeda(posicao.valorTotal)}
            </p>
          </div>
          <div>
            <p className="text-ink-3 font-mono text-[10px] tracking-[0.14em] uppercase">
              Itens
            </p>
            <p className="text-2xl font-semibold tabular-nums">
              {posicao.linhas.length}
            </p>
          </div>
          {posicao.faltando > 0 && (
            <div>
              <p className="text-ink-3 font-mono text-[10px] tracking-[0.14em] uppercase">
                Abaixo do mínimo
              </p>
              <p className="text-bad text-2xl font-semibold tabular-nums">
                {posicao.faltando}
              </p>
            </div>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Link href={rota({ faltando: soFaltando ? "1" : undefined })}>
          <Botao peso={local ? "secundario" : "primario"} tamanho="pequeno">
            Todos os lugares
          </Botao>
        </Link>
        {locais.map((l) => (
          <Link
            key={l.id}
            href={rota({ local: l.id, faltando: soFaltando ? "1" : undefined })}
          >
            <Botao
              peso={local === l.id ? "primario" : "secundario"}
              tamanho="pequeno"
            >
              {l.nome}
            </Botao>
          </Link>
        ))}
        <span className="text-line-2 px-1">|</span>
        <Link href={rota({ local, faltando: soFaltando ? undefined : "1" })}>
          <Botao
            peso={soFaltando ? "primario" : "secundario"}
            tamanho="pequeno"
          >
            Só o que está faltando
          </Botao>
        </Link>
      </div>

      <div className="border-line mt-4 overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[620px] text-sm">
          <thead>
            <tr className="bg-surface-2 border-line border-b">
              <th className="text-ink-3 px-4 py-2.5 text-left text-xs font-semibold uppercase">
                Insumo
              </th>
              <th className="text-ink-3 px-4 py-2.5 text-left text-xs font-semibold uppercase">
                Onde
              </th>
              <th className="text-ink-3 px-4 py-2.5 text-right text-xs font-semibold uppercase">
                Tem
              </th>
              <th className="text-ink-3 px-4 py-2.5 text-right text-xs font-semibold uppercase">
                Mínimo
              </th>
              {podeVerCustos && (
                <th className="text-ink-3 px-4 py-2.5 text-right text-xs font-semibold uppercase">
                  Valor
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {posicao.linhas.length === 0 && (
              <tr>
                <td
                  colSpan={podeVerCustos ? 5 : 4}
                  className="text-ink-3 px-4 py-8 text-center text-sm"
                >
                  {soFaltando
                    ? "Nada abaixo do mínimo por aqui."
                    : "Nenhum insumo com posição neste lugar."}
                </td>
              </tr>
            )}
            {posicao.linhas.map((l) => (
              <tr
                key={l.id}
                className="border-line hover:bg-surface-2 border-b last:border-b-0"
              >
                <td className="px-4 py-2.5">
                  <span className="text-ink block font-medium">{l.nome}</span>
                  {l.categoria && (
                    <span className="text-ink-3 block text-xs">
                      {l.categoria}
                    </span>
                  )}
                </td>
                <td className="text-ink-2 px-4 py-2.5">{l.local.nome}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  <span className={l.faltando ? "text-bad font-semibold" : ""}>
                    {formatarQuantidade(l.quantidade)}
                  </span>{" "}
                  <span className="text-ink-3">{sigla(l.unidade)}</span>
                </td>
                <td className="text-ink-3 px-4 py-2.5 text-right tabular-nums">
                  {l.minimo > 0 ? formatarQuantidade(l.minimo) : "—"}
                </td>
                {podeVerCustos && (
                  <td className="text-ink px-4 py-2.5 text-right tabular-nums">
                    {formatarMoeda(l.valor)}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
