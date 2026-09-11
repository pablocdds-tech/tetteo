import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { estiloDeBotao } from "@/design-system/botao";
import { CabecalhoDePagina } from "@/design-system/cabecalho-de-pagina";
import { Cartao, TituloDeSecao } from "@/design-system/cartao";
import { Etiqueta } from "@/design-system/etiqueta";
import { Indicador } from "@/design-system/indicador";
import { Tabela, type Coluna } from "@/design-system/tabela";
import { Vazio } from "@/design-system/vazio";
import { sigla, type Unidade } from "@/lib/unidades";
import {
  aplicarSugestaoAcao,
  escolherAcao,
  gerarPedidosAcao,
} from "@/modules/compras/acoes";
import { Acao } from "@/modules/compras/components/acao";
import {
  EstadoDaRodada,
  ROTULO_DA_RODADA,
} from "@/modules/compras/components/estado";
import { FiltrosDeCompras } from "@/modules/compras/components/filtros";
import {
  precoPorUnidade,
  quantidadeBr,
  reais,
  reaisPorUnidade,
} from "@/modules/compras/schemas/aritmetica";
import type {
  Celula,
  LinhaDaGrade,
  TotalDoFornecedor,
} from "@/modules/compras/schemas/comparacao";
import { descreverEmbalagem } from "@/modules/compras/schemas/embalagem";
import { compararRodada } from "@/modules/compras/services/comparacao";
import { listarRodadas } from "@/modules/compras/services/rodadas";

/**
 * A COMPARAÇÃO — de quem comprar cada item em disputa.
 *
 * Uma linha por item, uma coluna por fornecedor. Cada célula diz o custo do
 * item INTEIRO naquele fornecedor, já em embalagens inteiras por loja, com o
 * que sobra por arredondar e quanto esse arredondamento custa. Embaixo, o
 * total de cada um COM frete e mínimo — é o total que decide, não o preço
 * unitário.
 *
 * Ausência não vira vantagem: sem resposta, não tem, embalagem sem conversão
 * e preço zero não autorizado aparecem escritos e não entram na disputa.
 * A sugestão de menor custo total testa as combinações; quem escolhe é o
 * comprador, e escolher diferente da sugestão pede uma frase.
 */

type Comparacao = NonNullable<Awaited<ReturnType<typeof compararRodada>>>;
type Direcionado = Comparacao["direcionados"][number];

const EM_COMPARACAO = [
  "COTANDO",
  "REVISAO",
  "APROVADA",
  "DESPACHANDO",
  "FECHADA",
];

function totalEscolhido(c: Comparacao, escolhaDe: Map<string, string>) {
  const porFornecedor = new Map<string, Map<string, bigint>>();
  let mercadoria = 0n;
  for (const l of c.grade.linhas) {
    const fornecedorId = escolhaDe.get(l.item.id);
    if (!fornecedorId) continue;
    const celula = l.celulas.find((x) => x.fornecedorId === fornecedorId);
    if (!celula || celula.custo === null) continue;
    mercadoria += celula.custo;
    const lojas = porFornecedor.get(fornecedorId) ?? new Map<string, bigint>();
    for (const pl of celula.porLoja) {
      lojas.set(pl.unidadeId, (lojas.get(pl.unidadeId) ?? 0n) + pl.custo);
    }
    porFornecedor.set(fornecedorId, lojas);
  }
  let frete = 0n;
  let semFrete = false;
  for (const [fornecedorId, lojas] of porFornecedor) {
    const entregas = [...lojas.values()].filter((v) => v > 0n).length;
    const f = c.fretes.find((x) => x.fornecedorId === fornecedorId);
    if (f?.frete == null) {
      if (entregas > 0) semFrete = true;
      continue;
    }
    frete += f.frete * BigInt(entregas);
  }
  return { mercadoria, frete, total: mercadoria + frete, semFrete };
}

export default async function PaginaDaComparacao({
  searchParams,
}: {
  searchParams: Promise<{ rodada?: string }>;
}) {
  const ctx = await obterContexto();
  if (!ctx) redirect("/login");
  if (!pode(ctx, "compras.cotar") && !pode(ctx, "compras.aprovar")) notFound();

  const { rodada: pedida } = await searchParams;
  const rodadas = (await listarRodadas(ctx)).filter((r) =>
    EM_COMPARACAO.includes(r.estado),
  );
  const alvo =
    rodadas.find((r) => r.id === pedida) ??
    rodadas.find((r) => r.estado === "REVISAO") ??
    rodadas[0];

  const filtro = (
    <FiltrosDeCompras
      filtros={[
        {
          nome: "rodada",
          rotulo: "Rodada",
          todos: "Em revisão mais recente",
          opcoes: rodadas.map((r) => ({
            valor: r.id,
            rotulo: `Rodada ${r.numero} · ${ROTULO_DA_RODADA[r.estado] ?? r.estado}`,
          })),
        },
      ]}
    />
  );

  if (!alvo) {
    return (
      <div className="mx-auto flex w-full max-w-[var(--width-data)] flex-col gap-4">
        <CabecalhoDePagina
          titulo="Comparação de propostas"
          contexto="Nenhuma rodada em cotação"
        />
        <Cartao>
          <Vazio
            icone="grade"
            titulo="Nenhuma rodada com propostas ainda"
            explicacao="A comparação aparece quando uma rodada entra em cotação e os fornecedores começam a responder."
            acao={
              <Link
                href="/compras"
                className={estiloDeBotao("secundario", "pequeno")}
              >
                Ver rodadas
              </Link>
            }
          />
        </Cartao>
      </div>
    );
  }

  const c = await compararRodada(ctx, alvo.id);
  if (!c) notFound();

  const colunas = c.grade.fornecedores.filter((f) => f.itensSolicitados > 0);
  const escolhas = new Map(c.escolhas.map((e) => [e.itemDaRodadaId, e]));
  const escolhaDe = new Map(
    c.escolhas.map((e) => [e.itemDaRodadaId, e.fornecedorId]),
  );
  const sugerido = new Map(
    c.sugestao.ok
      ? c.sugestao.sugestao.escolhas.map((e) => [e.itemId, e.fornecedorId])
      : [],
  );
  const nomeDaLoja = new Map(c.lojas.map((l) => [l.id, l.nome]));
  const nomeDoFornecedor = new Map(
    c.solicitacoes.map((s) => [s.fornecedorId, s.fornecedor]),
  );
  const freteDe = new Map(c.fretes.map((f) => [f.fornecedorId, f]));

  const emRevisao = c.rodada.estado === "REVISAO";
  const podeEscolher = emRevisao && pode(ctx, "compras.cotar");
  const podeGerar = emRevisao && pode(ctx, "compras.pedir");
  const escolhido = totalEscolhido(c, escolhaDe);
  const semEscolha = c.grade.linhas.filter((l) => !escolhas.has(l.item.id));
  const semPreco = c.direcionados.filter((d) => !d.preco);
  const respondidas = c.solicitacoes.filter((s) => s.versao > 0).length;

  const diferenca =
    c.sugestao.ok && semEscolha.length === 0
      ? escolhido.total - c.sugestao.sugestao.total
      : null;

  const colunasDirecionados: Coluna<Direcionado>[] = [
    {
      chave: "insumo",
      titulo: "Insumo",
      principal: true,
      celula: (d) => d.nome,
    },
    {
      chave: "necessario",
      titulo: "Necessário",
      numerica: true,
      celula: (d) => quantidadeBr(d.necessario, d.unidade),
    },
    {
      chave: "fixo",
      titulo: "Fornecedor fixo",
      celula: (d) => d.fornecedorFixo?.nome ?? "—",
    },
    {
      chave: "preco",
      titulo: "Preço",
      celula: (d) =>
        d.preco ? (
          <span className="text-xs">
            <span className="text-ink font-medium">
              {reais(d.preco.precoEmbalagem)}
            </span>
            {" · "}
            {descreverEmbalagem(
              {
                pecas: d.preco.pecas,
                conteudo: d.preco.conteudo,
                unidadeConteudo: d.preco.unidadeConteudo,
                fracionavel: d.preco.fracionavel,
              },
              d.unidade,
            )}
            <span className="text-ink-3 block">
              {reaisPorUnidade(
                precoPorUnidade(d.preco.precoEmbalagem, d.preco.fator),
                d.unidade,
              )}
            </span>
          </span>
        ) : (
          <Etiqueta tom="ruim">Sem preço</Etiqueta>
        ),
    },
    {
      chave: "origem",
      titulo: "De onde vem o preço",
      celula: (d) =>
        d.preco ? (
          <span className="text-xs">{d.preco.origem}</span>
        ) : (
          <span className="text-ink-3 text-xs">
            Nem confirmação nem preço de referência — cadastre a referência no
            fornecedor, ou deixe de fora ao gerar os pedidos.
          </span>
        ),
    },
  ];

  const rodape: {
    rotulo: string;
    celula: (f: TotalDoFornecedor) => ReactNode;
  }[] = [
    { rotulo: "Mercadoria", celula: (f) => reais(f.subtotal) },
    {
      rotulo: "Frete",
      celula: (f) =>
        f.freteInformado ? (
          <span>
            {reais(f.freteTotal!)}
            <span className="text-ink-3 block text-xs">
              {f.lojasAtendidas}{" "}
              {f.lojasAtendidas === 1 ? "entrega" : "entregas"}
            </span>
          </span>
        ) : (
          <Etiqueta tom="aviso">Não informado</Etiqueta>
        ),
    },
    {
      rotulo: "Pedido mínimo",
      celula: (f) => {
        const minimo = freteDe.get(f.fornecedorId)?.minimo ?? null;
        if (f.minimoAtendido === null) {
          return (
            <span className="text-ink-3">
              {minimo === null ? "Sem mínimo" : "—"}
            </span>
          );
        }
        return f.minimoAtendido ? (
          <span>
            Atende
            <span className="text-ink-3 block text-xs">
              {reais(minimo!)} por entrega
            </span>
          </span>
        ) : (
          <span className="flex flex-col items-end gap-1">
            <Etiqueta tom="ruim">Não atinge</Etiqueta>
            <span className="text-ink-3 text-xs">
              {reais(minimo!)} por entrega
            </span>
          </span>
        );
      },
    },
    {
      rotulo: "Total com frete",
      celula: (f) =>
        f.total === null ? (
          <span className="text-ink-3 text-xs">Sem total — falta o frete</span>
        ) : (
          <strong className="text-ink font-semibold">{reais(f.total)}</strong>
        ),
    },
    {
      rotulo: "Entrega",
      celula: (f) =>
        f.prazoDias === null ? "Não informou" : `${f.prazoDias} dias`,
    },
    {
      rotulo: "Cotou",
      celula: (f) => (
        <span>
          {f.itensComparaveis} de {f.itensSolicitados}
          {!f.completo && f.itensComparaveis > 0 && (
            <span className="text-ink-3 block text-xs">proposta parcial</span>
          )}
        </span>
      ),
    },
  ];

  return (
    <div className="mx-auto flex w-full max-w-[var(--width-data)] flex-col gap-4">
      <CabecalhoDePagina
        titulo="Comparação de propostas"
        contexto={`Rodada ${c.rodada.numero} · ${c.rodada.descricao}`}
        controles={
          <>
            {filtro}
            <EstadoDaRodada valor={c.rodada.estado} />
          </>
        }
        acao={
          <Link
            href={`/compras/rodadas/${c.rodada.id}`}
            className={estiloDeBotao("secundario", "medio")}
          >
            Abrir rodada
          </Link>
        }
      />

      {c.rodada.estado === "COTANDO" && (
        <p className="border-info/25 bg-info-sub text-info rounded-lg border px-4 py-3 text-sm leading-5">
          A cotação ainda está aberta: esta grade é uma prévia e muda a cada
          resposta. Para escolher, encerre a cotação na tela da rodada.
        </p>
      )}

      <div className="desk:grid-cols-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Indicador
          rotulo="Sugestão de menor custo"
          valor={c.sugestao.ok ? reais(c.sugestao.sugestao.total) : null}
          apoio={
            c.sugestao.ok
              ? `mercadoria ${reais(c.sugestao.sugestao.mercadoria)} + frete ${reais(c.sugestao.sugestao.frete)}`
              : c.sugestao.motivo
          }
          comparacao={
            c.sugestao.ok
              ? `${c.sugestao.sugestao.fornecedores.length} ${c.sugestao.sugestao.fornecedores.length === 1 ? "fornecedor" : "fornecedores"} · itens em disputa`
              : null
          }
        />
        <Indicador
          rotulo="Escolhido até agora"
          valor={escolhas.size ? reais(escolhido.total) : null}
          apoio={`mercadoria ${reais(escolhido.mercadoria)} + frete ${reais(escolhido.frete)}${escolhido.semFrete ? " (algum sem frete)" : ""}`}
          comparacao={
            diferenca === null
              ? `${escolhas.size} de ${c.grade.linhas.length} itens escolhidos`
              : diferenca === 0n
                ? "Igual à sugestão"
                : diferenca > 0n
                  ? `${reais(diferenca)} acima da sugestão`
                  : `${reais(-diferenca)} abaixo da sugestão`
          }
          tom={diferenca !== null && diferenca > 0n ? "atencao" : "normal"}
        />
        <Indicador
          rotulo="Propostas recebidas"
          valor={`${respondidas} de ${c.solicitacoes.length}`}
          apoio="fornecedores que responderam"
          comparacao={
            c.solicitacoes.length - respondidas > 0
              ? `${c.solicitacoes.length - respondidas} sem resposta — não contam como oferta`
              : "Todos responderam"
          }
        />
        <Indicador
          rotulo="Itens"
          valor={String(c.grade.linhas.length)}
          apoio={`em disputa · ${c.direcionados.length} com fornecedor fixo`}
          comparacao={
            semEscolha.length
              ? `${semEscolha.length} sem escolha`
              : "Todos com fornecedor escolhido"
          }
        />
      </div>

      <Cartao como="section" className="min-w-0 overflow-hidden">
        <TituloDeSecao
          apoio="Custo do item inteiro em cada fornecedor, em embalagens inteiras por loja. Rolagem para o lado quando há muitos fornecedores."
          acao={
            podeEscolher && c.sugestao.ok ? (
              <Acao
                acao={aplicarSugestaoAcao}
                campos={{ rodadaId: c.rodada.id }}
                rotulo="Usar a sugestão"
                peso="secundario"
                tamanho="pequeno"
                confirmar="Isto troca as escolhas atuais pelas da sugestão de menor custo total. Continuar?"
              />
            ) : undefined
          }
        >
          Grade de preços
        </TituloDeSecao>

        {c.grade.linhas.length === 0 || colunas.length === 0 ? (
          <Vazio
            icone="grade"
            titulo={
              c.grade.linhas.length === 0
                ? "Nenhum item em disputa"
                : "Nenhum fornecedor convidado"
            }
            explicacao={
              c.grade.linhas.length === 0
                ? "Todos os itens desta rodada são de fornecedor fixo — veja abaixo."
                : "Convide fornecedores na tela da rodada para que as propostas apareçam aqui."
            }
          />
        ) : (
          <>
            <div
              role="region"
              aria-label="Grade de comparação. Role para o lado para ver todos os fornecedores."
              tabIndex={0}
              className="focus-visible:outline-accent hidden overflow-x-auto focus-visible:outline-2 focus-visible:-outline-offset-2 md:block"
            >
              <table className="w-full border-collapse text-sm">
                <caption className="sr-only">
                  Custo de cada item por fornecedor, com frete e mínimo no
                  rodapé
                </caption>
                <thead>
                  <tr className="border-line border-b">
                    <th
                      scope="col"
                      className="bg-surface text-ink-3 sticky left-0 z-[1] min-w-[15rem] px-4 py-2.5 text-left text-xs font-medium"
                    >
                      Item
                    </th>
                    {colunas.map((f) => (
                      <th
                        key={f.fornecedorId}
                        scope="col"
                        className="text-ink min-w-[13.5rem] px-3 py-2.5 text-left align-bottom text-sm font-semibold"
                      >
                        {f.nome}
                        <span className="text-ink-3 block text-xs font-normal">
                          {f.versao > 0
                            ? `proposta v${f.versao}`
                            : "sem resposta"}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-line divide-y">
                  {c.grade.linhas.map((l) => (
                    <tr key={l.item.id} className="align-top">
                      <th
                        scope="row"
                        className="bg-surface sticky left-0 z-[1] px-4 py-3 text-left font-normal"
                      >
                        <CabecaDoItem
                          linha={l}
                          nomeDaLoja={nomeDaLoja}
                          escolha={escolhas.get(l.item.id)}
                          nomeDoFornecedor={nomeDoFornecedor}
                        />
                      </th>
                      {colunas.map((f) => (
                        <td key={f.fornecedorId} className="px-3 py-3">
                          <CelulaDaGrade
                            celula={l.celulas.find(
                              (x) => x.fornecedorId === f.fornecedorId,
                            )!}
                            linha={l}
                            escolhido={
                              escolhaDe.get(l.item.id) === f.fornecedorId
                            }
                            sugeridoPara={sugerido.get(l.item.id) ?? null}
                            podeEscolher={podeEscolher}
                            rodadaId={c.rodada.id}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-line-2 border-t-2">
                  {rodape.map((r) => (
                    <tr
                      key={r.rotulo}
                      className="border-line border-b last:border-b-0"
                    >
                      <th
                        scope="row"
                        className="bg-surface text-ink-2 sticky left-0 z-[1] px-4 py-2.5 text-left text-sm font-semibold"
                      >
                        {r.rotulo}
                      </th>
                      {colunas.map((f) => (
                        <td
                          key={f.fornecedorId}
                          className="text-ink-2 px-3 py-2.5 text-right tabular-nums"
                        >
                          {r.celula(f)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tfoot>
              </table>
            </div>

            <ul className="divide-line divide-y md:hidden">
              {c.grade.linhas.map((l) => (
                <li key={l.item.id} className="flex flex-col gap-3 px-4 py-4">
                  <CabecaDoItem
                    linha={l}
                    nomeDaLoja={nomeDaLoja}
                    escolha={escolhas.get(l.item.id)}
                    nomeDoFornecedor={nomeDoFornecedor}
                  />
                  <ul className="flex flex-col gap-2">
                    {colunas.map((f) => (
                      <li
                        key={f.fornecedorId}
                        className="border-line rounded-md border p-3"
                      >
                        <p className="text-ink mb-1 text-sm font-semibold">
                          {f.nome}
                        </p>
                        <CelulaDaGrade
                          celula={l.celulas.find(
                            (x) => x.fornecedorId === f.fornecedorId,
                          )!}
                          linha={l}
                          escolhido={
                            escolhaDe.get(l.item.id) === f.fornecedorId
                          }
                          sugeridoPara={sugerido.get(l.item.id) ?? null}
                          podeEscolher={podeEscolher}
                          rodadaId={c.rodada.id}
                        />
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
              <li className="flex flex-col gap-2 px-4 py-4">
                <p className="text-ink text-sm font-semibold">
                  Totais por fornecedor
                </p>
                {colunas.map((f) => (
                  <dl
                    key={f.fornecedorId}
                    className="border-line grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border p-3 text-sm"
                  >
                    <dt className="text-ink col-span-2 font-semibold">
                      {f.nome}
                    </dt>
                    {rodape.map((r) => (
                      <div key={r.rotulo} className="contents">
                        <dt className="text-ink-3 text-xs">{r.rotulo}</dt>
                        <dd className="text-ink-2 text-right tabular-nums">
                          {r.celula(f)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ))}
              </li>
            </ul>
          </>
        )}
      </Cartao>

      <div className="desk:grid-cols-2 grid gap-4">
        <Cartao como="section" className="flex min-w-0 flex-col">
          <TituloDeSecao
            apoio={
              c.sugestao.ok
                ? c.sugestao.sugestao.metodo === "combinacoes"
                  ? "Testou todas as combinações de fornecedores, com frete e mínimo."
                  : "Muitos fornecedores: pegou o mais barato de cada item."
                : "Não foi possível sugerir"
            }
          >
            Sugestão de menor custo total
          </TituloDeSecao>
          <div className="flex flex-col gap-3 p-4 text-sm leading-5">
            {c.sugestao.ok ? (
              <>
                <p>
                  Comprar de{" "}
                  <strong className="font-semibold">
                    {c.sugestao.sugestao.fornecedores
                      .map((id) => nomeDoFornecedor.get(id) ?? "fornecedor")
                      .join(", ")}
                  </strong>{" "}
                  sai por{" "}
                  <strong className="font-semibold">
                    {reais(c.sugestao.sugestao.total)}
                  </strong>{" "}
                  (mercadoria {reais(c.sugestao.sugestao.mercadoria)} + frete{" "}
                  {reais(c.sugestao.sugestao.frete)}).
                </p>
                {c.sugestao.sugestao.avisos.map((a) => (
                  <p key={a} className="text-warn">
                    {a}
                  </p>
                ))}
              </>
            ) : (
              <p className="text-warn">{c.sugestao.motivo}</p>
            )}
            {(c.sugestao.ok ? c.sugestao.sugestao.fora : c.sugestao.fora).map(
              (f) => (
                <p key={f.fornecedorId} className="text-ink-3">
                  Fora da sugestão:{" "}
                  <strong className="text-ink-2 font-medium">
                    {nomeDoFornecedor.get(f.fornecedorId)}
                  </strong>{" "}
                  — {f.motivo}
                </p>
              ),
            )}
            {(c.sugestao.ok
              ? c.sugestao.sugestao.semOpcao
              : c.sugestao.semOpcao
            ).length > 0 && (
              <p className="text-ink-3">
                Sem oferta comparável:{" "}
                {(c.sugestao.ok
                  ? c.sugestao.sugestao.semOpcao
                  : c.sugestao.semOpcao
                )
                  .map(
                    (id) =>
                      c.grade.linhas.find((l) => l.item.id === id)?.item.nome,
                  )
                  .filter(Boolean)
                  .join(", ")}
                .
              </p>
            )}
            <p className="text-ink-3 border-line border-t pt-3 text-xs leading-[18px]">
              A sugestão olha só custo: não há histórico de qualidade que
              sustente um ranking. Quem escolhe é você, item por item — escolher
              diferente da sugestão pede uma frase, que fica registrada.
            </p>
          </div>
        </Cartao>

        <Cartao como="section" className="min-w-0 overflow-hidden">
          <TituloDeSecao apoio="Não entram na disputa: vão direto para o fornecedor fixo.">
            Itens de fornecedor fixo
          </TituloDeSecao>
          <Tabela
            legenda="Itens com fornecedor fixo"
            colunas={colunasDirecionados}
            linhas={c.direcionados}
            chaveDaLinha={(d) => d.itemId}
            vazio={
              <Vazio
                icone="entrega"
                titulo="Nenhum item de fornecedor fixo"
                explicacao="Marque o fornecedor fixo de um insumo no cadastro de fornecedores para ele sair da disputa."
              />
            }
          />
        </Cartao>
      </div>

      {podeGerar && (
        <Cartao como="section" className="min-w-0">
          <TituloDeSecao apoio="Um pedido por loja e fornecedor, com os preços congelados. Eles vão para aprovação.">
            Gerar pedidos
          </TituloDeSecao>
          <div className="p-4">
            {alvo.pedidos > 0 ? (
              <p className="text-sm">
                Os pedidos desta rodada já foram gerados.{" "}
                <Link
                  href={`/compras/aprovacao?rodada=${c.rodada.id}`}
                  className="text-accent font-semibold hover:underline"
                >
                  Ver na aprovação
                </Link>
                . Para acrescentar itens, faça um adendo no pedido.
              </p>
            ) : (
              <Acao
                acao={gerarPedidosAcao}
                campos={{ rodadaId: c.rodada.id }}
                rotulo="Gerar pedidos para aprovação"
                confirmar="Gerar os pedidos com as escolhas atuais? Um por loja e fornecedor, direto para a aprovação."
              >
                {semEscolha.length + semPreco.length > 0 && (
                  <fieldset className="flex flex-col gap-2">
                    <legend className="text-ink-2 mb-1 text-sm font-semibold">
                      Sem fornecedor definido — marque os que NÃO serão
                      comprados nesta rodada
                    </legend>
                    <div className="flex flex-wrap gap-2">
                      {[
                        ...semEscolha.map((l) => ({
                          id: l.item.id,
                          nome: l.item.nome,
                          motivo: "sem escolha",
                        })),
                        ...semPreco.map((d) => ({
                          id: d.itemId,
                          nome: d.nome,
                          motivo: "fixo sem preço",
                        })),
                      ].map((x) => (
                        <label
                          key={x.id}
                          className="border-line-2 has-[:checked]:border-accent has-[:checked]:bg-accent-sub flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm md:min-h-9"
                        >
                          <input
                            type="checkbox"
                            name="ignorar"
                            value={x.id}
                            className="size-4"
                          />
                          {x.nome}
                          <span className="text-ink-3 text-xs">
                            ({x.motivo})
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                )}
              </Acao>
            )}
          </div>
        </Cartao>
      )}
    </div>
  );
}

function CabecaDoItem({
  linha,
  nomeDaLoja,
  escolha,
  nomeDoFornecedor,
}: {
  linha: LinhaDaGrade;
  nomeDaLoja: Map<string, string>;
  escolha: Comparacao["escolhas"][number] | undefined;
  nomeDoFornecedor: Map<string, string>;
}) {
  const u = linha.item.unidade;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-ink text-sm font-semibold">{linha.item.nome}</span>
      <span className="text-ink-2 text-xs tabular-nums">
        Precisa {quantidadeBr(linha.necessario, u)}
      </span>
      <span className="text-ink-3 text-xs">
        {linha.item.porLoja
          .map(
            (p) =>
              `${nomeDaLoja.get(p.unidadeId) ?? "Loja"}: ${quantidadeBr(p.quantidade, u)}`,
          )
          .join(" · ")}
      </span>
      {escolha ? (
        <span className="text-xs">
          <Etiqueta tom="info">
            Escolhido: {nomeDoFornecedor.get(escolha.fornecedorId) ?? "—"}
          </Etiqueta>
          {!escolha.seguiuSugestao && escolha.justificativa && (
            <span className="text-ink-3 mt-1 block">
              Por quê: {escolha.justificativa}
            </span>
          )}
        </span>
      ) : (
        <span className="text-warn text-xs font-medium">Sem escolha</span>
      )}
    </div>
  );
}

function CelulaDaGrade({
  celula,
  linha,
  escolhido,
  sugeridoPara,
  podeEscolher,
  rodadaId,
}: {
  celula: Celula;
  linha: LinhaDaGrade;
  escolhido: boolean;
  sugeridoPara: string | null;
  podeEscolher: boolean;
  rodadaId: string;
}) {
  const u = linha.item.unidade as Unidade;
  switch (celula.estado) {
    case "sem-resposta":
      return <span className="text-ink-3 text-sm">Sem resposta</span>;
    case "nao-solicitado":
      return <span className="text-ink-3 text-sm">Não foi pedido a ele</span>;
    case "indisponivel":
      return <span className="text-ink-2 text-sm">Não tem o item</span>;
    case "conferir-fator":
      return (
        <span className="flex flex-col items-start gap-1">
          <Etiqueta tom="aviso">Conferir embalagem</Etiqueta>
          {celula.descricaoEmbalagem && (
            <span className="text-ink-2 text-xs">
              {celula.descricaoEmbalagem}
            </span>
          )}
          {celula.fatorMotivo && (
            <span className="text-ink-3 text-xs">{celula.fatorMotivo}</span>
          )}
        </span>
      );
    case "zero-sem-autorizacao":
      return (
        <span className="flex flex-col items-start gap-1">
          <Etiqueta tom="ruim">Preço zero sem autorização</Etiqueta>
          <span className="text-ink-3 text-xs">Não entra na disputa.</span>
        </span>
      );
  }

  const sugerida = sugeridoPara === celula.fornecedorId;
  const pedeFrase =
    celula.estado !== "cotado" ||
    (sugeridoPara !== null && sugeridoPara !== celula.fornecedorId);

  return (
    <div
      className={`flex flex-col gap-1 rounded-md p-2 ${escolhido ? "bg-accent-sub ring-accent ring-2" : ""}`}
    >
      <span className="text-ink text-[15px] font-semibold tabular-nums">
        {reais(celula.custo!)}
      </span>
      <span className="text-ink-2 text-xs leading-[18px]">
        {reais(celula.precoEmbalagem!)} · {celula.descricaoEmbalagem}
      </span>
      <span className="text-ink-3 text-xs tabular-nums">
        {reaisPorUnidade(celula.precoPorUnidade!, u)} ·{" "}
        {celula.embalagens !== null
          ? `${celula.embalagens} ${celula.embalagens === 1n ? "embalagem" : "embalagens"} = `
          : `a granel, `}
        {quantidadeBr(celula.comprado!, u)}
      </span>
      {celula.adicional! > 0n && (
        <span className="text-warn text-xs">
          +{quantidadeBr(celula.adicional!, u)} a mais por arredondar (
          {reais(celula.custoAdicional!)})
        </span>
      )}
      {celula.estado === "disponibilidade-insuficiente" && (
        <span className="text-warn text-xs font-medium">
          Não tem a quantidade toda
        </span>
      )}
      <span className="flex flex-wrap gap-1 pt-0.5">
        {celula.menorCusto && <Etiqueta tom="ok">Menor custo</Etiqueta>}
        {sugerida && <Etiqueta tom="acento">Sugerido</Etiqueta>}
        {escolhido && <Etiqueta tom="info">Escolhido</Etiqueta>}
      </span>
      {podeEscolher && !escolhido && (
        <div className="pt-1">
          <Acao
            acao={escolherAcao}
            campos={{
              rodadaId,
              itemDaRodadaId: linha.item.id,
              fornecedorId: celula.fornecedorId,
            }}
            rotulo="Escolher"
            peso="secundario"
            tamanho="pequeno"
            pedeMotivo={
              pedeFrase
                ? celula.estado !== "cotado"
                  ? "Ele não tem tudo. Por que escolher mesmo assim?"
                  : `Por que este e não o sugerido? (${sigla(u)} mais caro ou outro motivo)`
                : undefined
            }
          />
        </div>
      )}
    </div>
  );
}
