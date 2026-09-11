import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { estiloDeBotao } from "@/design-system/botao";
import { CabecalhoDePagina } from "@/design-system/cabecalho-de-pagina";
import { Cartao, TituloDeSecao } from "@/design-system/cartao";
import { Etiqueta } from "@/design-system/etiqueta";
import {
  ajustarItemAcao,
  aprovarPedidoAcao,
  buscarMensagemAcao,
  cancelarPedidoAcao,
  criarAdendoAcao,
  criarAlteracaoAcao,
  marcarEnviadaAMaoAcao,
  recusarPedidoAcao,
  registrarConcordanciaAcao,
  registrarConfirmacaoAcao,
  reprocessarAcao,
  resolverIncertaAcao,
} from "@/modules/compras/acoes";
import { Acao } from "@/modules/compras/components/acao";
import { Copiar } from "@/modules/compras/components/copiar";
import { ROTULO_DA_DIVERGENCIA } from "@/modules/compras/components/divergencia";
import {
  EstadoDaConfirmacao,
  EstadoDoEnvio,
  EstadoDoPedido,
  EstadoDoRecebimento,
} from "@/modules/compras/components/estado";
import { diaHora, janela } from "@/modules/compras/components/formato";
import {
  descreverLinha,
  emReais,
} from "@/modules/compras/components/linha-do-pedido";
import { Voltar } from "@/modules/compras/components/voltar";
import {
  CASAS,
  milesimosDoBanco,
  numeroBrDe,
  reais,
} from "@/modules/compras/schemas/aritmetica";
import { referenciaDoPedido } from "@/modules/compras/schemas/mensagens";
import { mensagensDaReferencia } from "@/modules/compras/services/fila";
import {
  obterPedido,
  pendentesDeAprovacao,
} from "@/modules/compras/services/pedidos";
import { listarProdutosDoFornecedor } from "@/modules/compras/services/produtos-do-fornecedor";

/**
 * O PEDIDO — congelado na aprovação, e tudo o que aconteceu com ele depois.
 *
 * À esquerda, o que foi comprado (preço e embalagem de cada linha, com a
 * origem do preço) e o que veio depois: alteração, adendo, recebimento,
 * divergência. À direita, as três perguntas que o comprador faz todo dia, cada
 * uma com a sua resposta separada:
 *
 *   A mensagem saiu?          Situação do envio (fila, canal, entregue…)
 *   O fornecedor confirmou?   Resposta do fornecedor
 *   Quem aprovou, sob que alçada?
 */

type Mensagem = Awaited<ReturnType<typeof mensagensDaReferencia>>[number];
type Tom = "ok" | "aviso" | "ruim" | "neutro";

const TIPO_DA_MENSAGEM: Record<string, string> = {
  CONVITE_COTACAO: "Convite de cotação",
  PEDIDO: "Mensagem do pedido",
  ADENDO: "Mensagem do adendo",
  ALTERACAO: "Mensagem da alteração",
  CANCELAMENTO: "Mensagem de cancelamento",
  TESTE: "Teste",
};

const CONCORDANCIA: Record<string, { tom: Tom; texto: string }> = {
  PENDENTE: { tom: "neutro", texto: "Fornecedor não respondeu" },
  ACEITA: { tom: "ok", texto: "Fornecedor aceitou" },
  RECUSADA: { tom: "ruim", texto: "Fornecedor recusou" },
};

const COR_DO_PASSO: Record<Tom, string> = {
  ok: "bg-ok",
  aviso: "bg-warn",
  ruim: "bg-bad",
  neutro: "bg-ink-3",
};

const CAIXA =
  "bg-surface text-ink border-line-2 hover:border-ink-3 focus:border-accent h-10 w-full min-w-0 rounded-md border px-3 text-base focus:shadow-[0_0_0_3px_var(--accent-sub)] focus:outline-none md:text-sm";

const embalagensBr = (v: { toString(): string }) =>
  numeroBrDe(milesimosDoBanco(v), CASAS.milesimos);

export default async function PaginaDoPedido({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await obterContexto();
  if (!ctx) redirect("/login");
  if (!pode(ctx, "compras.ver")) notFound();

  const { id } = await params;
  const p = await obterPedido(ctx, id);
  if (!p) notFound();

  const podePedir = pode(ctx, "compras.pedir");
  const podeEnviar = pode(ctx, "compras.enviar");
  const podeAprovar = pode(ctx, "compras.aprovar");
  const podeCopiar = podeEnviar || podePedir;
  const aprovado = p.status === "APROVADO";
  const pendente = p.status === "AGUARDANDO_APROVACAO";
  const ehAdendo = p.tipo === "ADENDO";

  const resumo = pendente
    ? (await pendentesDeAprovacao(ctx)).find((x) => x.id === p.id)
    : undefined;
  const produtos =
    aprovado && podePedir && !ehAdendo
      ? await listarProdutosDoFornecedor(ctx, p.fornecedorId)
      : [];
  const mensagensDasAlteracoes = await Promise.all(
    p.alteracoes.map((a) => mensagensDaReferencia("AlteracaoDePedido", a.id)),
  );
  const itemPorId = new Map(p.itens.map((i) => [i.id, i]));
  const opcoesDoAdendo = [
    ...new Map([
      ...p.itens.map((i) => [i.insumoId, i.insumoNome] as const),
      ...produtos.map((x) => [x.insumoId, x.insumo] as const),
    ]).entries(),
  ].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));

  const limite = resumo?.meuLimite;

  return (
    <div className="mx-auto flex w-full max-w-[var(--width-data)] flex-col gap-4">
      <Voltar para="/compras/pedidos" rotulo="Pedidos e envios" />
      <CabecalhoDePagina
        titulo={`${ehAdendo ? "Adendo" : "Pedido"} ${p.referencia}`}
        contexto={`${p.fornecedorNome} → ${p.unidadeNome}${p.rodada ? ` · Rodada ${p.rodada.numero}` : ""}`}
        controles={
          <div className="flex flex-wrap items-center gap-1.5">
            <EstadoDoPedido valor={p.status} />
            {(aprovado || p.status === "CONCLUIDO") && (
              <EstadoDaConfirmacao valor={p.confirmacao} />
            )}
            <EstadoDoRecebimento valor={p.situacaoRecebimento} />
          </div>
        }
      />

      {p.pedidoOrigem && (
        <p className="text-ink-2 text-sm leading-5">
          Adendo do pedido{" "}
          <Link
            href={`/compras/pedidos/${p.pedidoOrigem.id}`}
            className="text-accent font-semibold hover:underline"
          >
            {referenciaDoPedido(p.pedidoOrigem.numero, 1)}
          </Link>{" "}
          — só os itens novos, com sequência própria.
        </p>
      )}
      {p.status === "RECUSADO" && p.motivoRecusa && (
        <p className="border-bad/25 bg-bad-sub text-bad rounded-lg border px-4 py-3 text-sm leading-5">
          <strong className="font-semibold">Recusado:</strong> {p.motivoRecusa}
        </p>
      )}
      {p.status === "CANCELADO" && p.motivoCancelamento && (
        <p className="border-line bg-surface-2 text-ink-2 rounded-lg border px-4 py-3 text-sm leading-5">
          <strong className="font-semibold">Cancelado:</strong>{" "}
          {p.motivoCancelamento}
        </p>
      )}

      <div className="desk:grid-cols-[minmax(0,1fr)_400px] grid items-start gap-4">
        <div className="flex min-w-0 flex-col gap-4">
          <Cartao como="section" className="min-w-0 overflow-hidden">
            <TituloDeSecao
              apoio={`${p.itens.length} ${p.itens.length === 1 ? "item" : "itens"} · preços congelados quando o pedido foi montado`}
            >
              Itens
            </TituloDeSecao>
            <div
              role="region"
              aria-label="Itens do pedido. Role para o lado para ver todas as colunas."
              tabIndex={0}
              className="focus-visible:outline-accent overflow-x-auto focus-visible:outline-2 focus-visible:-outline-offset-2"
            >
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <caption className="sr-only">
                  Itens do pedido {p.referencia}
                </caption>
                <thead>
                  <tr className="border-line text-ink-3 border-b text-xs">
                    <th
                      scope="col"
                      className="px-4 py-2.5 text-left font-medium"
                    >
                      Insumo
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-2.5 text-right font-medium"
                    >
                      Quantidade
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-2.5 text-right font-medium"
                    >
                      Preço
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-2.5 text-right font-medium"
                    >
                      Total
                    </th>
                    {pendente && podePedir && (
                      <th
                        scope="col"
                        className="px-4 py-2.5 text-left font-medium"
                      >
                        Ajustar
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-line divide-y">
                  {p.itens.map((i) => {
                    const l = descreverLinha(i);
                    return (
                      <tr key={i.id} className="align-top">
                        <th
                          scope="row"
                          className="px-4 py-3 text-left font-medium"
                        >
                          {i.insumoNome}
                          <span className="text-ink-3 block text-xs font-normal">
                            {l.embalagem}
                          </span>
                          <span className="text-ink-3 block text-xs font-normal">
                            {i.origemPreco}
                          </span>
                        </th>
                        <td className="text-ink-2 px-4 py-3 text-right tabular-nums">
                          <span className="whitespace-nowrap">{l.quanto}</span>
                          {!i.fracionavel && (
                            <span className="block whitespace-nowrap">
                              = {l.comprado}
                            </span>
                          )}
                          <span className="text-ink-3 block text-xs">
                            precisava {l.necessario}
                            {l.adicional ? ` · +${l.adicional}` : ""}
                          </span>
                          {l.cancelado && (
                            <span className="text-bad block text-xs">
                              −{l.cancelado} cancelado
                            </span>
                          )}
                        </td>
                        <td className="text-ink-2 px-4 py-3 text-right tabular-nums">
                          <span className="whitespace-nowrap">{l.preco}</span>
                          <span className="text-ink-3 block text-xs whitespace-nowrap">
                            {l.porUnidade}
                          </span>
                        </td>
                        <td className="text-ink px-4 py-3 text-right font-medium whitespace-nowrap tabular-nums">
                          {l.total}
                        </td>
                        {pendente && podePedir && (
                          <td className="px-4 py-3">
                            <Acao
                              acao={ajustarItemAcao}
                              campos={{ pedidoId: p.id, itemId: i.id }}
                              rotulo="Ajustar"
                              peso="fantasma"
                              tamanho="pequeno"
                            >
                              <label
                                htmlFor={`ajustar-${i.id}`}
                                className="sr-only"
                              >
                                Embalagens de {i.insumoNome}
                              </label>
                              <input
                                id={`ajustar-${i.id}`}
                                name="embalagens"
                                defaultValue={l.embalagensNoCampo}
                                inputMode="decimal"
                                className={`${CAIXA} w-24`}
                              />
                            </Acao>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="border-line flex flex-col gap-2 border-t px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
              <p className="text-ink-3 max-w-[52ch] text-xs leading-[18px]">
                Cada linha é arredondada uma vez, meio para cima; o total é a
                soma das linhas mais o frete (regra {p.regraArredondamento}).
              </p>
              <dl className="grid grid-cols-[1fr_auto] gap-x-8 gap-y-1 text-sm tabular-nums sm:w-72">
                <dt className="text-ink-3">Mercadoria</dt>
                <dd className="text-right">{emReais(p.subtotal)}</dd>
                <dt className="text-ink-3">Frete</dt>
                <dd className="text-right">{emReais(p.frete)}</dd>
                <dt className="font-semibold">Total</dt>
                <dd className="text-right font-semibold">{emReais(p.total)}</dd>
              </dl>
            </div>
            {p.observacao && (
              <p className="bg-warn-sub text-warn mx-4 mb-3 rounded-md px-3 py-2 text-sm leading-5">
                {p.observacao}
              </p>
            )}
          </Cartao>

          {(aprovado || p.alteracoes.length > 0) && (
            <Cartao como="section" className="min-w-0">
              <TituloDeSecao apoio="Diminuir ou cancelar o que já foi enviado. Aumentar é adendo.">
                Alterações e cancelamento
              </TituloDeSecao>
              <div className="flex flex-col gap-3 p-4">
                {p.alteracoes.map((a, indice) => {
                  const concordancia =
                    CONCORDANCIA[a.concordancia] ?? CONCORDANCIA.PENDENTE;
                  return (
                    <article
                      key={a.id}
                      className="border-line flex flex-col gap-2 rounded-md border p-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold">
                          {a.tipo === "CANCELAMENTO"
                            ? "Cancelamento"
                            : "Alteração"}{" "}
                          ·{" "}
                          {referenciaDoPedido(
                            p.pedidoOrigem?.numero ?? p.numero,
                            a.sequencia,
                          )}
                        </h3>
                        <Etiqueta tom={concordancia.tom}>
                          {concordancia.texto}
                        </Etiqueta>
                      </div>
                      <p className="text-ink-2 text-sm">Motivo: {a.motivo}</p>
                      <ul className="text-ink-2 flex flex-col gap-0.5 text-xs tabular-nums">
                        {a.itens.map((x) => (
                          <li key={x.id}>
                            {itemPorId.get(x.itemDePedidoId)?.insumoNome ??
                              "Item"}
                            : {embalagensBr(x.embalagensAntes)} →{" "}
                            {embalagensBr(x.embalagensDepois)} embalagens
                          </li>
                        ))}
                      </ul>
                      {mensagensDasAlteracoes[indice].map((m) => (
                        <div
                          key={m.id}
                          className="flex flex-wrap items-center gap-2"
                        >
                          <EstadoDoEnvio
                            valor={m.estado}
                            simulada={m.simulada}
                            enviadaAMao={!!m.enviadaAMaoEm}
                          />
                          {podeCopiar && m.estado !== "CANCELADA" && (
                            <Copiar
                              rotulo="Copiar mensagem"
                              buscar={buscarMensagemAcao.bind(null, m.id)}
                            />
                          )}
                          {podeEnviar &&
                            !m.enviadaAMaoEm &&
                            m.estado !== "ENVIANDO" &&
                            m.estado !== "CANCELADA" &&
                            (m.simulada ||
                              ["BLOQUEADA", "FALHOU", "INCERTA"].includes(
                                m.estado,
                              )) && (
                              <Acao
                                acao={marcarEnviadaAMaoAcao}
                                campos={{ mensagemId: m.id, pedidoId: p.id }}
                                rotulo="Mandei pelo meu WhatsApp"
                                peso="secundario"
                                tamanho="pequeno"
                              />
                            )}
                        </div>
                      ))}
                      {a.concordancia !== "PENDENTE" && a.concordanciaTexto && (
                        <p className="text-ink-3 text-xs">
                          “{a.concordanciaTexto}” · {diaHora(a.concordanciaEm)}
                        </p>
                      )}
                      {a.concordancia === "PENDENTE" && podePedir && (
                        <details className="pt-1">
                          <summary className="text-accent cursor-pointer text-sm font-semibold">
                            Registrar a resposta do fornecedor
                          </summary>
                          <div className="pt-3">
                            <Acao
                              acao={registrarConcordanciaAcao}
                              campos={{ alteracaoId: a.id, pedidoId: p.id }}
                              rotulo="Registrar resposta"
                              peso="secundario"
                              tamanho="pequeno"
                            >
                              <label
                                htmlFor={`resposta-${a.id}`}
                                className="text-ink-2 text-sm font-semibold"
                              >
                                Ele…
                              </label>
                              <select
                                id={`resposta-${a.id}`}
                                name="resposta"
                                className={CAIXA}
                              >
                                <option value="ACEITA">
                                  aceitou a alteração
                                </option>
                                <option value="RECUSADA">
                                  recusou a alteração
                                </option>
                              </select>
                              <label
                                htmlFor={`texto-${a.id}`}
                                className="text-ink-2 text-sm font-semibold"
                              >
                                O que ele disse
                              </label>
                              <input
                                id={`texto-${a.id}`}
                                name="texto"
                                required
                                maxLength={300}
                                className={CAIXA}
                              />
                            </Acao>
                          </div>
                        </details>
                      )}
                    </article>
                  );
                })}
                {aprovado && podePedir ? (
                  <details>
                    <summary className="text-accent cursor-pointer text-sm font-semibold">
                      Diminuir ou cancelar itens
                    </summary>
                    <div className="pt-3">
                      <Acao
                        acao={criarAlteracaoAcao}
                        campos={{ pedidoId: p.id }}
                        rotulo="Mandar alteração ao fornecedor"
                        peso="secundario"
                        pedeMotivo="Motivo — vai junto na mensagem ao fornecedor"
                      >
                        <label
                          htmlFor="tipo-alteracao"
                          className="text-ink-2 text-sm font-semibold"
                        >
                          O que fazer
                        </label>
                        <select
                          id="tipo-alteracao"
                          name="tipo"
                          className={CAIXA}
                        >
                          <option value="ALTERACAO">
                            Diminuir as quantidades abaixo
                          </option>
                          <option value="CANCELAMENTO">
                            Cancelar o pedido inteiro
                          </option>
                        </select>
                        <fieldset className="flex flex-col gap-2">
                          <legend className="text-ink-3 mb-1 text-xs">
                            Nova quantidade de embalagens (deixe em branco o que
                            não muda)
                          </legend>
                          {p.itens.map((i) => (
                            <div
                              key={i.id}
                              className="grid grid-cols-[minmax(0,1fr)_7rem] items-center gap-3"
                            >
                              <input
                                type="hidden"
                                name="itemDePedidoId"
                                value={i.id}
                              />
                              <label
                                htmlFor={`depois-${i.id}`}
                                className="text-ink-2 text-sm"
                              >
                                {i.insumoNome}{" "}
                                <span className="text-ink-3 text-xs">
                                  (hoje {embalagensBr(i.embalagens)})
                                </span>
                              </label>
                              <input
                                id={`depois-${i.id}`}
                                name={`depois:${i.id}`}
                                inputMode="decimal"
                                className={CAIXA}
                              />
                            </div>
                          ))}
                        </fieldset>
                      </Acao>
                    </div>
                  </details>
                ) : (
                  p.alteracoes.length === 0 && (
                    <p className="text-ink-3 text-sm">Nenhuma alteração.</p>
                  )
                )}
              </div>
            </Cartao>
          )}

          {!ehAdendo && (aprovado || p.adendos.length > 0) && (
            <Cartao como="section" className="min-w-0">
              <TituloDeSecao apoio="Itens novos depois do envio: um pedido filho, só com o que faltou.">
                Adendos
              </TituloDeSecao>
              <div className="flex flex-col gap-3 p-4">
                {p.adendos.length > 0 ? (
                  <ul className="divide-line divide-y">
                    {p.adendos.map((a) => (
                      <li
                        key={a.id}
                        className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                      >
                        <Link
                          href={`/compras/pedidos/${a.id}`}
                          className="text-accent font-semibold hover:underline"
                        >
                          {referenciaDoPedido(p.numero, a.sequencia)}
                        </Link>
                        <EstadoDoPedido valor={a.status} />
                        <span className="tabular-nums">{emReais(a.total)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-ink-3 text-sm">Nenhum adendo.</p>
                )}
                {aprovado && podePedir && opcoesDoAdendo.length > 0 && (
                  <details>
                    <summary className="text-accent cursor-pointer text-sm font-semibold">
                      Fazer adendo
                    </summary>
                    <div className="pt-3">
                      <Acao
                        acao={criarAdendoAcao}
                        campos={{ pedidoId: p.id }}
                        rotulo="Criar adendo para aprovação"
                        peso="secundario"
                        pedeMotivo="Por que o adendo?"
                      >
                        <label
                          htmlFor="adendo-insumo"
                          className="text-ink-2 text-sm font-semibold"
                        >
                          Insumo
                        </label>
                        <select
                          id="adendo-insumo"
                          name="insumoId"
                          required
                          className={CAIXA}
                        >
                          {opcoesDoAdendo.map(([insumoId, nome]) => (
                            <option key={insumoId} value={insumoId}>
                              {nome}
                            </option>
                          ))}
                        </select>
                        <label
                          htmlFor="adendo-quanto"
                          className="text-ink-2 text-sm font-semibold"
                        >
                          Quanto a mais, na unidade de estoque
                        </label>
                        <input
                          id="adendo-quanto"
                          name="necessario"
                          required
                          inputMode="decimal"
                          className={CAIXA}
                        />
                        <p className="text-ink-3 text-xs leading-[18px]">
                          O preço vem do pedido original, se o insumo estava
                          nele; se não, da proposta ou da referência do
                          fornecedor — escrito na linha.
                        </p>
                      </Acao>
                    </div>
                  </details>
                )}
              </div>
            </Cartao>
          )}

          <Cartao como="section" className="min-w-0">
            <TituloDeSecao
              apoio="Só o que chegou bom entra no estoque"
              acao={
                aprovado && pode(ctx, "compras.receber") ? (
                  <Link
                    href={`/compras/recebimento/${p.id}`}
                    className={estiloDeBotao("secundario", "pequeno")}
                  >
                    Conferir recebimento
                  </Link>
                ) : undefined
              }
            >
              Recebimento
            </TituloDeSecao>
            <div className="p-4">
              {p.recebimentosComNome.length === 0 ? (
                <p className="text-ink-3 text-sm">Nada recebido ainda.</p>
              ) : (
                <ul className="divide-line divide-y text-sm">
                  {p.recebimentosComNome.map((r) => (
                    <li
                      key={r.id}
                      className="flex flex-wrap items-center justify-between gap-2 py-2"
                    >
                      <span>
                        <strong className="font-semibold">
                          {r.tipo === "DEVOLUCAO" ? "Devolução" : "Entrega"}{" "}
                          {String(r.numero).padStart(2, "0")}
                        </strong>{" "}
                        · {diaHora(r.recebidaEm)} · {r.recebidoPor ?? "—"}
                        {r.motivo && (
                          <span className="text-ink-3 block text-xs">
                            {r.motivo}
                          </span>
                        )}
                      </span>
                      <span className="tabular-nums">
                        {emReais(r.valorConferido)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Cartao>

          {p.divergencias.length > 0 && (
            <Cartao como="section" className="min-w-0">
              <TituloDeSecao apoio="Cada uma fecha com o que foi feito, escrito por alguém.">
                Divergências
              </TituloDeSecao>
              <ul className="divide-line divide-y">
                {p.divergencias.map((d) => (
                  <li
                    key={d.id}
                    className="flex flex-wrap items-start justify-between gap-2 px-4 py-3 text-sm"
                  >
                    <span className="min-w-0">
                      <strong className="font-semibold">
                        {ROTULO_DA_DIVERGENCIA[d.tipo] ?? d.tipo}
                      </strong>
                      : {d.detalhe}
                      {d.resolucao && (
                        <span className="text-ink-3 block text-xs">
                          Resolvida: {d.resolucao}
                        </span>
                      )}
                    </span>
                    <span className="flex items-center gap-2">
                      {d.impacto && (
                        <span className="tabular-nums">
                          {emReais(d.impacto)}
                        </span>
                      )}
                      <Etiqueta tom={d.estado === "ABERTA" ? "aviso" : "ok"}>
                        {d.estado === "ABERTA" ? "Aberta" : "Resolvida"}
                      </Etiqueta>
                    </span>
                  </li>
                ))}
              </ul>
            </Cartao>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Cartao como="section" className="min-w-0">
            <TituloDeSecao apoio="Na fila ≠ enviada ≠ entregue ≠ fornecedor confirmou">
              Situação do envio
            </TituloDeSecao>
            <div className="flex flex-col gap-5 p-4">
              {p.mensagens.length === 0 ? (
                <p className="text-ink-3 text-sm leading-5">
                  {pendente
                    ? "A mensagem ao fornecedor nasce quando o pedido for aprovado."
                    : "Nenhuma mensagem para este pedido."}
                </p>
              ) : (
                p.mensagens.map((m, i) => (
                  <SituacaoDaMensagem
                    key={m.id}
                    m={m}
                    pedidoId={p.id}
                    podeEnviar={podeEnviar}
                    podeCopiar={podeCopiar}
                    aprovacao={
                      i === 0 && p.aprovadoEm
                        ? { quem: p.aprovadoPor, quando: p.aprovadoEm }
                        : null
                    }
                  />
                ))
              )}
            </div>
          </Cartao>

          {(aprovado || p.status === "CONCLUIDO") && (
            <Cartao como="section" className="flex min-w-0 flex-col gap-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-[15px] leading-6 font-semibold">
                  Resposta do fornecedor
                </h2>
                <EstadoDaConfirmacao valor={p.confirmacao} />
              </div>
              {p.confirmacaoTexto ? (
                <blockquote className="border-line text-ink-2 border-l-2 pl-3 text-sm leading-5">
                  “{p.confirmacaoTexto}”
                  <footer className="text-ink-3 mt-1 text-xs">
                    registrado por {p.confirmacaoRegistradaPor ?? "—"} ·{" "}
                    {diaHora(p.confirmadoEm)}
                  </footer>
                </blockquote>
              ) : (
                <p className="text-ink-3 text-sm leading-5">
                  Mensagem entregue não é pedido confirmado. Quando ele
                  responder, registre aqui o que disse.
                </p>
              )}
              {podePedir && (
                <details open={p.confirmacao === "PENDENTE"}>
                  <summary className="text-accent cursor-pointer text-sm font-semibold">
                    Registrar o que ele respondeu
                  </summary>
                  <div className="pt-3">
                    <Acao
                      acao={registrarConfirmacaoAcao}
                      campos={{ pedidoId: p.id }}
                      rotulo="Registrar resposta"
                      peso="secundario"
                    >
                      <label
                        htmlFor="confirmacao"
                        className="text-ink-2 text-sm font-semibold"
                      >
                        Ele…
                      </label>
                      <select
                        id="confirmacao"
                        name="confirmacao"
                        className={CAIXA}
                      >
                        <option value="CONFIRMADO">confirmou o pedido</option>
                        <option value="CONFIRMADO_COM_RESSALVA">
                          confirmou com ressalva
                        </option>
                        <option value="RECUSADO">recusou o pedido</option>
                      </select>
                      <label
                        htmlFor="confirmacao-texto"
                        className="text-ink-2 text-sm font-semibold"
                      >
                        O que ele disse
                      </label>
                      <textarea
                        id="confirmacao-texto"
                        name="texto"
                        required
                        rows={2}
                        maxLength={300}
                        className="bg-surface border-line-2 text-ink focus:border-accent w-full rounded-md border px-3 py-2 text-base focus:shadow-[0_0_0_3px_var(--accent-sub)] focus:outline-none md:text-sm"
                      />
                    </Acao>
                  </div>
                </details>
              )}
            </Cartao>
          )}

          <Cartao como="section" className="flex min-w-0 flex-col gap-3 p-4">
            <h2 className="text-[15px] leading-6 font-semibold">Aprovação</h2>
            {pendente && (
              <div className="flex flex-col gap-2">
                <p className="text-ink-3 text-xs leading-[18px]">
                  {!podeAprovar
                    ? "Seu perfil acompanha a aprovação, mas não aprova."
                    : resumo?.possoAprovar
                      ? limite === null
                        ? "Sua alçada: sem limite."
                        : typeof limite === "bigint"
                          ? `Sua alçada: até ${reais(limite)}.`
                          : "Você aprova como Diretor (nenhuma alçada cadastrada para o seu papel)."
                      : "Este valor está fora da sua alçada."}
                </p>
                <div className="flex flex-wrap items-start gap-2">
                  {resumo?.possoAprovar && (
                    <Acao
                      acao={aprovarPedidoAcao}
                      campos={{ pedidoId: p.id, versao: p.versao }}
                      rotulo="Aprovar pedido"
                      confirmar={`Aprovar o pedido ${p.referencia} de ${emReais(p.total)}? A mensagem ao fornecedor entra na fila.`}
                    />
                  )}
                  {podeAprovar && (
                    <Acao
                      acao={recusarPedidoAcao}
                      campos={{ pedidoId: p.id, versao: p.versao }}
                      rotulo="Recusar"
                      peso="secundario"
                      pedeMotivo="Por que recusar? O comprador vê o motivo."
                    />
                  )}
                </div>
                {podePedir && (
                  <Acao
                    acao={cancelarPedidoAcao}
                    campos={{ pedidoId: p.id }}
                    rotulo="Cancelar este pedido"
                    peso="fantasma"
                    tamanho="pequeno"
                    pedeMotivo="Por que cancelar antes da aprovação?"
                  />
                )}
              </div>
            )}
            {p.aprovacoesComNome.length > 0 ? (
              <ul className="divide-line divide-y text-sm">
                {p.aprovacoesComNome.map((a) => (
                  <li key={a.id} className="py-2">
                    <span className="flex flex-wrap items-center gap-2">
                      <Etiqueta tom={a.decisao === "APROVADO" ? "ok" : "ruim"}>
                        {a.decisao === "APROVADO" ? "Aprovou" : "Recusou"}
                      </Etiqueta>
                      <strong className="font-semibold">
                        {a.aprovador ?? "—"}
                      </strong>
                      <span className="text-ink-3 tabular-nums">
                        {emReais(a.valor)}
                      </span>
                    </span>
                    <span className="text-ink-3 block text-xs">
                      {diaHora(a.criadoEm)}
                      {a.alcadaVersao
                        ? ` · alçada versão ${a.alcadaVersao}`
                        : " · sem alçada cadastrada (Diretor)"}
                    </span>
                    {a.motivo && (
                      <span className="text-ink-2 block text-xs">
                        Motivo: {a.motivo}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              !pendente && (
                <p className="text-ink-3 text-sm">Sem registro de aprovação.</p>
              )
            )}
          </Cartao>

          <Cartao como="section" className="p-4">
            <h2 className="mb-3 text-[15px] leading-6 font-semibold">
              Dados do pedido
            </h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
              <dt className="text-ink-3">Fornecedor</dt>
              <dd>
                {p.fornecedorNome}
                {p.fornecedorDocumento && (
                  <span className="text-ink-3 block text-xs">
                    {p.fornecedorDocumento}
                  </span>
                )}
              </dd>
              <dt className="text-ink-3">Mensagem para</dt>
              <dd className="tabular-nums">
                {p.destinoTelefone ?? "sem número autorizado"}
              </dd>
              <dt className="text-ink-3">Entregar em</dt>
              <dd>
                {p.unidadeNome}
                {p.enderecoEntrega && (
                  <span className="text-ink-3 block text-xs">
                    {p.enderecoEntrega}
                  </span>
                )}
              </dd>
              <dt className="text-ink-3">Entrega</dt>
              <dd className="tabular-nums">
                {janela(p.entregaDe, p.entregaAte)}
              </dd>
              <dt className="text-ink-3">Pagamento</dt>
              <dd>{p.condicaoPagamento ?? "—"}</dd>
              <dt className="text-ink-3">Montado por</dt>
              <dd>
                {p.criadoPor ?? "—"} · {diaHora(p.criadoEm)}
              </dd>
            </dl>
          </Cartao>
        </div>
      </div>
    </div>
  );
}

type Passo = { quando: Date | null; texto: string; tom: Tom };

function passosDoEnvio(
  m: Mensagem,
  aprovacao: { quem: string | null; quando: Date } | null,
): Passo[] {
  const passos: Passo[] = [];
  if (aprovacao) {
    passos.push({
      quando: aprovacao.quando,
      texto: `Aprovado por ${aprovacao.quem ?? "—"}`,
      tom: "ok",
    });
  }
  passos.push({
    quando: m.enfileiradaEm,
    texto:
      m.estado === "BLOQUEADA"
        ? `Bloqueada: ${m.motivoBloqueio ?? "fornecedor sem número autorizado"}`
        : `Entrou na fila para ${m.destino ?? "—"}${m.tentativas > 1 ? ` · ${m.tentativas} tentativas` : ""}`,
    tom: m.estado === "BLOQUEADA" ? "ruim" : "neutro",
  });
  if (m.aceitaEm) {
    passos.push({
      quando: m.aceitaEm,
      texto: m.simulada
        ? "O simulador aceitou — nada saiu de verdade"
        : "Aceita pelo WhatsApp",
      tom: m.simulada ? "aviso" : "ok",
    });
  }
  if (m.entregueEm)
    passos.push({
      quando: m.entregueEm,
      texto: "Entregue no celular do fornecedor",
      tom: "ok",
    });
  if (m.incertaEm) {
    passos.push({
      quando: m.incertaEm,
      texto: "Incerta: o canal não confirmou se saiu",
      tom: "aviso",
    });
  }
  if (m.falhouEm) {
    passos.push({
      quando: m.falhouEm,
      texto: `Falhou${m.ultimoErro ? `: ${m.ultimoErro}` : ""}`,
      tom: "ruim",
    });
  }
  if (m.enviadaAMaoEm) {
    passos.push({
      quando: m.enviadaAMaoEm,
      texto: "Enviada à mão, pelo WhatsApp de quem comprou",
      tom: "ok",
    });
  }
  if (m.canceladaEm) {
    passos.push({
      quando: m.canceladaEm,
      texto: `Cancelada${m.resolucao ? `: ${m.resolucao}` : ""}`,
      tom: "neutro",
    });
  }
  passos.sort(
    (a, b) => (a.quando?.getTime() ?? 0) - (b.quando?.getTime() ?? 0),
  );

  // O que falta, em palavras: é a pergunta que faz alguém abrir esta tela.
  if (!m.enviadaAMaoEm && m.estado !== "CANCELADA" && m.estado !== "ENTREGUE") {
    const falta =
      m.simulada && m.estado === "ACEITA_PELO_CANAL"
        ? "Falta: copiar a mensagem e mandar pelo seu WhatsApp"
        : m.estado === "NA_FILA" || m.estado === "ENVIANDO"
          ? "Sai na próxima batida do relógio (a cada minuto)"
          : m.estado === "ACEITA_PELO_CANAL"
            ? "Esperando o aviso de entrega do WhatsApp"
            : m.estado === "BLOQUEADA"
              ? "Falta: autorizar o número do fornecedor, ou mandar à mão"
              : m.estado === "INCERTA"
                ? "Falta: conferir no WhatsApp se chegou"
                : m.estado === "FALHOU"
                  ? "Falta: tentar de novo, ou mandar à mão"
                  : null;
    if (falta) passos.push({ quando: null, texto: falta, tom: "aviso" });
  }
  return passos;
}

function SituacaoDaMensagem({
  m,
  pedidoId,
  podeEnviar,
  podeCopiar,
  aprovacao,
}: {
  m: Mensagem;
  pedidoId: string;
  podeEnviar: boolean;
  podeCopiar: boolean;
  aprovacao: { quem: string | null; quando: Date } | null;
}) {
  const passos = passosDoEnvio(m, aprovacao);
  const podeMarcar =
    podeEnviar &&
    !m.enviadaAMaoEm &&
    m.estado !== "ENVIANDO" &&
    m.estado !== "CANCELADA" &&
    (m.simulada ||
      ["BLOQUEADA", "FALHOU", "INCERTA", "NA_FILA"].includes(m.estado));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">
          {TIPO_DA_MENSAGEM[m.tipo] ?? m.tipo}
          {m.sequencia > 1 ? ` · envio ${m.sequencia}` : ""}
        </p>
        <EstadoDoEnvio
          valor={m.estado}
          simulada={m.simulada}
          enviadaAMao={!!m.enviadaAMaoEm}
        />
      </div>
      <ol className="border-line-2 ml-1.5 flex flex-col gap-3 border-l pl-4">
        {passos.map((passo, i) => (
          <li key={i} className="relative">
            <span
              aria-hidden
              className={`ring-surface absolute top-1.5 -left-[22px] size-2.5 rounded-full ring-2 ${
                passo.quando
                  ? COR_DO_PASSO[passo.tom]
                  : "bg-surface border-warn border-2"
              }`}
            />
            <p
              className={`text-sm leading-5 ${passo.quando ? "text-ink" : "text-warn font-medium"}`}
            >
              {passo.texto}
            </p>
            {passo.quando && (
              <p className="text-ink-3 text-xs tabular-nums">
                {diaHora(passo.quando)}
              </p>
            )}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-start gap-2">
        {podeCopiar && m.estado !== "CANCELADA" && (
          <Copiar
            rotulo="Copiar mensagem"
            buscar={buscarMensagemAcao.bind(null, m.id)}
          />
        )}
        {podeMarcar && (
          <Acao
            acao={marcarEnviadaAMaoAcao}
            campos={{ mensagemId: m.id, pedidoId }}
            rotulo="Mandei pelo meu WhatsApp"
            peso="secundario"
            tamanho="pequeno"
          />
        )}
        {podeEnviar && m.estado === "FALHOU" && (
          <Acao
            acao={reprocessarAcao}
            campos={{ mensagemId: m.id, pedidoId }}
            rotulo="Tentar de novo"
            peso="secundario"
            tamanho="pequeno"
          />
        )}
        {podeEnviar && m.estado === "INCERTA" && (
          <>
            <Acao
              acao={resolverIncertaAcao}
              campos={{ mensagemId: m.id, pedidoId, decisao: "saiu" }}
              rotulo="Conferi: chegou"
              peso="secundario"
              tamanho="pequeno"
            />
            <Acao
              acao={resolverIncertaAcao}
              campos={{ mensagemId: m.id, pedidoId, decisao: "reenviar" }}
              rotulo="Não chegou: reenviar"
              peso="fantasma"
              tamanho="pequeno"
              confirmar="Reenviar? Se a primeira tiver chegado, o fornecedor recebe duas. Confira no WhatsApp antes."
            />
          </>
        )}
      </div>
    </div>
  );
}
