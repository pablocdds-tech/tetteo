import { randomUUID } from "node:crypto";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { CabecalhoDePagina } from "@/design-system/cabecalho-de-pagina";
import { Cartao, TituloDeSecao } from "@/design-system/cartao";
import { Etiqueta } from "@/design-system/etiqueta";
import { Vazio } from "@/design-system/vazio";
import { sigla } from "@/lib/unidades";
import {
  encerrarSaldoAcao,
  resolverDivergenciaAcao,
} from "@/modules/compras/acoes";
import { Acao } from "@/modules/compras/components/acao";
import { AvisoUnidade } from "@/modules/compras/components/aviso-unidade";
import { ROTULO_DA_DIVERGENCIA } from "@/modules/compras/components/divergencia";
import { EstadoDoRecebimento } from "@/modules/compras/components/estado";
import {
  dia,
  diaHora,
  dinheiro,
  janela,
  qtd,
} from "@/modules/compras/components/formato";
import { Voltar } from "@/modules/compras/components/voltar";
import { prepararConferencia } from "@/modules/compras/services/recebimentos";

import { devolverMercadoriaAcao } from "../acoes";
import { ConferenciaDoRecebimento } from "../conferencia";

/**
 * CONFERIR O RECEBIMENTO — a entrega de agora, as anteriores e o que ficou.
 *
 * Em cima, a conferência (quando ainda falta algo). Embaixo, o histórico:
 * cada entrega com o que entrou bom, o que chegou avariado e o que foi
 * recusado na porta — e, para o que já entrou, a devolução, que é um
 * movimento novo e nunca apaga a entrada original.
 */

export default async function PaginaDaConferencia({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await obterContexto();
  if (!ctx) redirect("/login");
  if (!pode(ctx, "compras.ver")) notFound();

  const { id } = await params;

  if (!ctx.unidadeAtiva) {
    return (
      <div className="mx-auto flex w-full max-w-[var(--width-data)] flex-col gap-4">
        <Voltar para="/compras/recebimento" rotulo="Recebimento" />
        <CabecalhoDePagina
          titulo="Conferir recebimento"
          contexto="Coisa de loja"
        />
        <AvisoUnidade acao="Conferir o recebimento" />
      </div>
    );
  }

  const v = await prepararConferencia(ctx, id);
  if (!v) notFound();

  const podeReceber = pode(ctx, "compras.receber");
  const insumoPorId = new Map(v.insumos.map((i) => [i.id, i]));
  const linhaPorItem = new Map(v.linhas.map((l) => [l.itemDePedidoId, l]));
  const faltaAlgo = v.linhas.some(
    (l) => l.saldo !== "0" && Number(l.saldo) > 0,
  );

  return (
    <div className="mx-auto flex w-full max-w-[var(--width-data)] flex-col gap-4">
      <Voltar para="/compras/recebimento" rotulo="Recebimento" />
      <CabecalhoDePagina
        titulo={`Conferir recebimento · ${v.referencia}`}
        contexto={`${v.fornecedor} → ${v.loja} · entrega prevista ${janela(v.entregaDe, v.entregaAte)}`}
        controles={<EstadoDoRecebimento valor={v.situacaoRecebimento} />}
      />

      {v.podeConferir ? (
        <Cartao como="section" className="min-w-0">
          <TituloDeSecao
            apoio={
              v.historico.some((r) => r.tipo === "ENTRADA")
                ? "Entrega parcial: confira o que chegou agora. O que já entrou está embaixo."
                : "Confira o que o caminhão trouxe."
            }
            acao={
              <Link
                href={`/compras/pedidos/${v.id}`}
                className="text-accent text-sm font-semibold hover:underline"
              >
                Ver o pedido
              </Link>
            }
          >
            O que chegou agora
          </TituloDeSecao>
          <ConferenciaDoRecebimento
            pedidoId={v.id}
            chave={v.chave}
            linhas={v.linhas}
            locais={v.locais}
            notas={v.notas}
            insumos={v.insumos}
          />
        </Cartao>
      ) : (
        <Cartao>
          <Vazio
            tom={v.status === "CONCLUIDO" ? "bom" : "neutro"}
            icone="entrega"
            titulo={
              v.status === "CONCLUIDO"
                ? "Pedido recebido por completo"
                : !podeReceber
                  ? "Seu perfil acompanha o recebimento, mas não confere"
                  : "Este pedido não está aberto para receber"
            }
            explicacao={
              v.status === "CONCLUIDO"
                ? "Tudo o que foi pedido entrou no estoque, ou o saldo foi encerrado com motivo."
                : !podeReceber
                  ? "Quem confere é a loja, com a permissão de receber."
                  : "Só pedido aprovado recebe mercadoria."
            }
          />
        </Cartao>
      )}

      <Cartao como="section" className="min-w-0">
        <TituloDeSecao apoio="Cada entrega é um registro que não se edita. Correção é devolução.">
          Entregas já conferidas
        </TituloDeSecao>
        {v.historico.length === 0 ? (
          <p className="text-ink-3 p-4 text-sm">
            Nenhuma entrega conferida ainda.
          </p>
        ) : (
          <div className="flex flex-col gap-3 p-4">
            {v.historico.map((r) => (
              <article
                key={r.id}
                className="border-line flex flex-col gap-2 rounded-md border p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">
                    {r.tipo === "DEVOLUCAO" ? "Devolução" : "Entrega"}{" "}
                    {String(r.numero).padStart(2, "0")}
                    <span className="text-ink-3 font-normal">
                      {" "}
                      · {diaHora(r.recebidaEm)} · {r.recebidoPor ?? "—"}
                    </span>
                  </h3>
                  <span className="flex items-center gap-2">
                    {r.notaVinculadaExistente && (
                      <Etiqueta tom="info">Ligada a nota já lançada</Etiqueta>
                    )}
                    <span className="text-sm font-medium tabular-nums">
                      {dinheiro(r.valorConferido)}
                    </span>
                  </span>
                </div>
                {r.motivo && (
                  <p className="text-ink-2 text-sm">Motivo: {r.motivo}</p>
                )}
                <div
                  role="region"
                  aria-label={`Itens da entrega ${r.numero}. Role para o lado para ver todas as colunas.`}
                  tabIndex={0}
                  className="overflow-x-auto"
                >
                  <table className="w-full min-w-[640px] border-collapse text-sm">
                    <caption className="sr-only">
                      Itens da entrega {r.numero}
                    </caption>
                    <thead>
                      <tr className="text-ink-3 border-line border-b text-xs">
                        <th
                          scope="col"
                          className="py-2 pr-3 text-left font-medium"
                        >
                          Insumo
                        </th>
                        <th
                          scope="col"
                          className="px-3 py-2 text-right font-medium"
                        >
                          {r.tipo === "DEVOLUCAO" ? "Voltou" : "Entrou bom"}
                        </th>
                        <th
                          scope="col"
                          className="px-3 py-2 text-right font-medium"
                        >
                          Avariado
                        </th>
                        <th
                          scope="col"
                          className="px-3 py-2 text-right font-medium"
                        >
                          Recusado
                        </th>
                        <th
                          scope="col"
                          className="px-3 py-2 text-left font-medium"
                        >
                          Lote · validade
                        </th>
                        <th
                          scope="col"
                          className="px-3 py-2 text-left font-medium"
                        >
                          Fotos
                        </th>
                        {r.tipo === "ENTRADA" && podeReceber && (
                          <th
                            scope="col"
                            className="py-2 pl-3 text-left font-medium"
                          >
                            Devolver
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-line divide-y">
                      {r.itens.map((x) => {
                        const linha = linhaPorItem.get(x.itemDePedidoId);
                        const insumo = insumoPorId.get(x.insumoId);
                        const u =
                          insumo?.unidadeMedida ?? linha?.unidade ?? "UN";
                        const trocado = linha && x.insumoId !== linha.insumoId;
                        return (
                          <tr key={x.id} className="align-top">
                            <th
                              scope="row"
                              className="py-2 pr-3 text-left font-medium"
                            >
                              {insumo?.nome ?? linha?.nome ?? "Item"}
                              {trocado && (
                                <span className="text-warn block text-xs font-normal">
                                  no lugar de {linha.nome}
                                </span>
                              )}
                            </th>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {qtd(x.quantidadeBoa, u)}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {Number(x.quantidadeAvariada) > 0
                                ? qtd(x.quantidadeAvariada, u)
                                : "—"}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {Number(x.quantidadeRecusada) > 0
                                ? qtd(x.quantidadeRecusada, u)
                                : "—"}
                            </td>
                            <td className="text-ink-2 px-3 py-2 text-xs">
                              {[
                                x.lote,
                                x.validade ? `vence ${dia(x.validade)}` : null,
                              ]
                                .filter(Boolean)
                                .join(" · ") || "—"}
                            </td>
                            <td className="px-3 py-2 text-xs">
                              {x.fotoIds.length === 0
                                ? "—"
                                : x.fotoIds.map((fid, i) => (
                                    <a
                                      key={fid}
                                      href={`/api/arquivos/${fid}`}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-accent mr-2 hover:underline"
                                    >
                                      Foto {i + 1}
                                    </a>
                                  ))}
                            </td>
                            {r.tipo === "ENTRADA" && podeReceber && (
                              <td className="py-2 pl-3">
                                {Number(x.quantidadeBoa) > 0 ? (
                                  <details>
                                    <summary className="text-accent cursor-pointer text-sm font-semibold">
                                      Devolver
                                    </summary>
                                    <div className="w-64 pt-2">
                                      <Acao
                                        acao={devolverMercadoriaAcao}
                                        campos={{
                                          pedidoId: v.id,
                                          recebimentoId: r.id,
                                          itemDeRecebimentoId: x.id,
                                          chave: randomUUID(),
                                        }}
                                        rotulo="Registrar devolução"
                                        peso="secundario"
                                        tamanho="pequeno"
                                        pedeMotivo="Por que volta?"
                                      >
                                        <label
                                          htmlFor={`devolver-${x.id}`}
                                          className="text-ink-2 text-xs font-semibold"
                                        >
                                          Quanto volta ({sigla(u)})
                                        </label>
                                        <input
                                          id={`devolver-${x.id}`}
                                          name="quantidade"
                                          required
                                          inputMode="decimal"
                                          className="bg-surface border-line-2 text-ink focus:border-accent h-10 w-full rounded-md border px-3 text-base md:text-sm"
                                        />
                                      </Acao>
                                    </div>
                                  </details>
                                ) : (
                                  <span className="text-ink-3 text-xs">—</span>
                                )}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </article>
            ))}
          </div>
        )}
      </Cartao>

      {v.divergencias.length > 0 && (
        <Cartao como="section" className="min-w-0">
          <TituloDeSecao apoio="Cada uma fecha com o que foi feito, escrito por alguém.">
            Divergências deste pedido
          </TituloDeSecao>
          <ul className="divide-line divide-y">
            {v.divergencias.map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 text-sm"
              >
                <span className="max-w-[60ch] min-w-0">
                  <strong className="font-semibold">
                    {ROTULO_DA_DIVERGENCIA[d.tipo] ?? d.tipo}
                  </strong>
                  : {d.detalhe}
                  {d.impacto && (
                    <span className="text-ink-3 block text-xs">
                      Valor: {dinheiro(d.impacto)}
                    </span>
                  )}
                </span>
                {d.estado === "ABERTA" &&
                (podeReceber || pode(ctx, "compras.pedir")) ? (
                  <Acao
                    acao={resolverDivergenciaAcao}
                    campos={{ divergenciaId: d.id, pedidoId: v.id }}
                    rotulo="Resolver"
                    peso="secundario"
                    tamanho="pequeno"
                    pedeMotivo="O que foi feito?"
                  />
                ) : (
                  <Etiqueta tom={d.estado === "ABERTA" ? "aviso" : "ok"}>
                    {d.estado === "ABERTA" ? "Aberta" : "Resolvida"}
                  </Etiqueta>
                )}
              </li>
            ))}
          </ul>
        </Cartao>
      )}

      {v.status === "APROVADO" &&
        v.situacaoRecebimento === "PARCIAL" &&
        faltaAlgo &&
        (podeReceber || pode(ctx, "compras.pedir")) && (
          <Cartao como="section" className="flex flex-col gap-2 p-4">
            <h2 className="text-[15px] leading-6 font-semibold">
              O resto não vem mais?
            </h2>
            <p className="text-ink-3 text-sm leading-5">
              Encerrar o saldo fecha o pedido com o que chegou. O que faltou
              vira divergência, para acertar a conta com o fornecedor.
            </p>
            <Acao
              acao={encerrarSaldoAcao}
              campos={{ pedidoId: v.id }}
              rotulo="Encerrar o saldo pendente"
              peso="secundario"
              pedeMotivo="Por que o resto não vem? (ex.: fornecedor sem estoque)"
            />
          </Cartao>
        )}
    </div>
  );
}
