import Link from "next/link";

import { formatarMoeda, formatarQuantidade } from "@/lib/numero";
import { sigla } from "@/lib/unidades";

import { calcularMargem } from "../schemas/custo";
import type { FichaNaLista } from "../services/fichas";

/**
 * A LISTA DE FICHAS — que é também o ranking de margem.
 *
 * Não existe uma tela separada de "engenharia de cardápio": ela seria a mesma
 * lista com as mesmas colunas. Aqui já dá para ver, de um olhar, que a
 * calabresa consome 41% do preço em ingrediente enquanto a margherita consome
 * 19% — e é essa comparação, não o custo isolado, que muda decisão de preço.
 *
 * Pratos e preparos ficam em blocos separados porque respondem a perguntas
 * diferentes: o prato tem margem, o preparo tem custo por unidade rendida.
 */
export function ListaFichas({
  fichas,
  podeVerCustos,
}: {
  fichas: FichaNaLista[];
  podeVerCustos: boolean;
}) {
  const pratos = fichas.filter((f) => f.tipo === "PRATO");
  const preparos = fichas.filter((f) => f.tipo === "PREPARO");

  if (fichas.length === 0) {
    return (
      <div className="border-line-2 bg-surface-2 rounded-xl border border-dashed px-6 py-10 text-center">
        <p aria-hidden className="text-2xl opacity-50">
          📋
        </p>
        <p className="mt-2 font-semibold">Nenhuma ficha técnica ainda</p>
        <p className="text-ink-3 mx-auto mt-1 max-w-md text-sm">
          Comece pelo que mais sai. Uma ficha responde quanto o prato custa de
          ingrediente — e, com o preço de venda ao lado, quanto do preço é
          comida.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {pratos.length > 0 && (
        <Bloco
          titulo="Pratos"
          descricao="Vão para o cliente. O CMV% é quanto do preço é ingrediente."
          fichas={pratos}
          podeVerCustos={podeVerCustos}
        />
      )}
      {preparos.length > 0 && (
        <Bloco
          titulo="Preparos"
          descricao="Massa, molho, mix. Entram como ingrediente de outras fichas."
          fichas={preparos}
          podeVerCustos={podeVerCustos}
        />
      )}
    </div>
  );
}

function Bloco({
  titulo,
  descricao,
  fichas,
  podeVerCustos,
}: {
  titulo: string;
  descricao: string;
  fichas: FichaNaLista[];
  podeVerCustos: boolean;
}) {
  return (
    <section>
      <h2 className="font-semibold">{titulo}</h2>
      <p className="text-ink-3 mt-1 text-sm">{descricao}</p>

      <div className="border-line divide-line mt-3 divide-y rounded-xl border">
        {fichas.map((f) => {
          const margem = calcularMargem(f.custoUnitario, f.precoVenda);

          return (
            <Link
              key={f.id}
              href={`/cardapio/fichas/${f.id}`}
              className="hover:bg-surface-2 flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 transition-colors"
            >
              <div className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {f.nome}
                  {!f.ativo && (
                    <span className="bg-surface-3 text-ink-3 ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold">
                      desativada
                    </span>
                  )}
                </span>
                <span className="text-ink-3 block truncate text-xs">
                  {f.categoria ? `${f.categoria} · ` : ""}
                  {f.itens} {f.itens === 1 ? "ingrediente" : "ingredientes"}
                  {f.tipo === "PREPARO" &&
                    ` · rende ${formatarQuantidade(f.rendimento)} ${sigla(f.unidadeRendimento)}`}
                </span>
              </div>

              {/* O aviso vem ANTES do número: um custo incompleto ao lado de um
                  número bonito é como a ficha engana. */}
              {f.linhasComProblema > 0 && (
                <span className="bg-warn-sub text-warn rounded-full px-2 py-0.5 text-xs font-semibold">
                  {f.linhasComProblema}{" "}
                  {f.linhasComProblema === 1
                    ? "linha sem custo"
                    : "linhas sem custo"}
                </span>
              )}

              {podeVerCustos && (
                <>
                  <span className="text-ink-2 w-24 text-right text-sm tabular-nums">
                    {formatarMoeda(f.custoUnitario)}
                    <span className="text-ink-3 block text-[10px]">
                      {f.tipo === "PRATO"
                        ? "custo"
                        : `por ${sigla(f.unidadeRendimento)}`}
                    </span>
                  </span>

                  {f.tipo === "PRATO" && (
                    <span className="w-24 text-right text-sm tabular-nums">
                      {margem ? (
                        <>
                          <span
                            className={
                              margem.cmvPercentual <= 30
                                ? "text-ok font-semibold"
                                : margem.cmvPercentual <= 40
                                  ? "text-warn font-semibold"
                                  : "text-bad font-semibold"
                            }
                          >
                            {margem.cmvPercentual.toLocaleString("pt-BR")}%
                          </span>
                          <span className="text-ink-3 block text-[10px]">
                            de {formatarMoeda(f.precoVenda ?? 0)}
                          </span>
                        </>
                      ) : (
                        <span className="text-ink-3 text-xs">sem preço</span>
                      )}
                    </span>
                  )}
                </>
              )}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
