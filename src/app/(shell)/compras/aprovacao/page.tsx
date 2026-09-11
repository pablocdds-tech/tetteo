import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { estiloDeBotao } from "@/design-system/botao";
import { CabecalhoDePagina } from "@/design-system/cabecalho-de-pagina";
import { Cartao } from "@/design-system/cartao";
import { Vazio } from "@/design-system/vazio";
import { aprovarPedidoAcao, recusarPedidoAcao } from "@/modules/compras/acoes";
import { Acao } from "@/modules/compras/components/acao";
import { FiltrosDeCompras } from "@/modules/compras/components/filtros";
import { janela } from "@/modules/compras/components/formato";
import {
  descreverLinha,
  emReais,
} from "@/modules/compras/components/linha-do-pedido";
import { centavosDoBanco, reais } from "@/modules/compras/schemas/aritmetica";
import {
  obterPedido,
  pendentesDeAprovacao,
  type PedidoCompleto,
} from "@/modules/compras/services/pedidos";

/**
 * A APROVAÇÃO — o que espera o "sim" de quem responde pelo dinheiro.
 *
 * Cada pedido aparece inteiro: fornecedor, loja, cada linha com a origem do
 * preço, frete e total. O botão de aprovar só aparece para quem tem alçada
 * que cobre o valor — mas quem decide de verdade é o servidor, na mesma
 * transação que aprova, conferindo a alçada e a versão do pedido.
 */

type Pendente = Awaited<ReturnType<typeof pendentesDeAprovacao>>[number];

function sobreAlcada(p: Pendente, podeAprovar: boolean): string {
  if (!podeAprovar) return "Seu perfil acompanha a aprovação, mas não aprova.";
  const limite = p.meuLimite;
  if (p.possoAprovar) {
    if (limite === null) return "Sua alçada: sem limite.";
    if (limite === undefined)
      return "Você aprova como Diretor (nenhuma alçada cadastrada para o seu papel).";
    return `Sua alçada: até ${reais(limite)}.`;
  }
  if (limite === undefined)
    return "Seu papel não tem alçada de compra cadastrada.";
  if (limite === null) return "Fora da sua alçada nesta loja.";
  return `Acima da sua alçada (até ${reais(limite)}) — quem tem alçada maior aprova.`;
}

export default async function PaginaDeAprovacao({
  searchParams,
}: {
  searchParams: Promise<{ loja?: string; rodada?: string }>;
}) {
  const ctx = await obterContexto();
  if (!ctx) redirect("/login");
  if (!pode(ctx, "compras.ver")) notFound();

  const { loja, rodada } = await searchParams;
  const podeAprovar = pode(ctx, "compras.aprovar");

  const pendentes = await pendentesDeAprovacao(ctx);
  const detalhes: { resumo: Pendente; pedido: PedidoCompleto }[] = [];
  for (const p of pendentes) {
    const pedido = await obterPedido(ctx, p.id);
    if (pedido) detalhes.push({ resumo: p, pedido });
  }

  const rodadas = [
    ...new Map(
      detalhes
        .filter((d) => d.pedido.rodada)
        .map((d) => [d.pedido.rodada!.id, d.pedido.rodada!] as const),
    ).values(),
  ];
  const visiveis = detalhes.filter(
    (d) =>
      (!loja || d.pedido.unidadeId === loja) &&
      (!rodada || d.pedido.rodadaId === rodada),
  );
  const total = visiveis.reduce(
    (s, d) => s + centavosDoBanco(d.pedido.total),
    0n,
  );
  const filtrado = !!(loja || rodada);

  return (
    <div className="mx-auto flex w-full max-w-[var(--width-data)] flex-col gap-4">
      <CabecalhoDePagina
        titulo="Aprovação de pedidos"
        contexto={
          visiveis.length
            ? `${visiveis.length} ${visiveis.length === 1 ? "pedido esperando" : "pedidos esperando"} · ${reais(total)}`
            : "Nada esperando"
        }
        controles={
          <FiltrosDeCompras
            filtros={[
              ...(ctx.unidadesVisiveis.length > 1
                ? [
                    {
                      nome: "loja",
                      rotulo: "Loja",
                      todos: "Todas as lojas",
                      opcoes: ctx.unidadesVisiveis.map((u) => ({
                        valor: u.id,
                        rotulo: u.nome,
                      })),
                    },
                  ]
                : []),
              ...(rodadas.length
                ? [
                    {
                      nome: "rodada",
                      rotulo: "Rodada",
                      todos: "Todas as rodadas",
                      opcoes: rodadas.map((r) => ({
                        valor: r.id,
                        rotulo: `Rodada ${r.numero} · ${r.descricao}`,
                      })),
                    },
                  ]
                : []),
            ]}
          />
        }
      />

      {visiveis.length === 0 ? (
        <Cartao>
          <Vazio
            tom={filtrado ? "neutro" : "bom"}
            icone="filtro"
            titulo={
              filtrado
                ? "Nada esperando neste recorte"
                : "Nenhum pedido esperando aprovação"
            }
            explicacao={
              filtrado
                ? "Troque a loja ou a rodada no topo, ou limpe os filtros."
                : "Pedidos novos aparecem aqui quando o comprador gera os pedidos a partir da comparação."
            }
          />
        </Cartao>
      ) : (
        visiveis.map(({ resumo, pedido: p }) => (
          <Cartao key={p.id} como="article" className="min-w-0 overflow-hidden">
            <div className="border-line flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3">
              <div className="min-w-0">
                <h2 className="text-[15px] leading-6 font-semibold">
                  <Link
                    href={`/compras/pedidos/${p.id}`}
                    className="hover:text-accent"
                  >
                    {p.tipo === "ADENDO" ? "Adendo" : "Pedido"} {p.referencia}
                  </Link>{" "}
                  · {p.fornecedorNome}
                </h2>
                <p className="text-ink-3 text-xs leading-[18px]">
                  {p.unidadeNome} · entrega {janela(p.entregaDe, p.entregaAte)}
                  {p.rodada ? ` · Rodada ${p.rodada.numero}` : ""}
                  {p.criadoPor ? ` · montado por ${p.criadoPor}` : ""}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xl leading-7 font-semibold tabular-nums">
                  {emReais(p.total)}
                </p>
                <p className="text-ink-3 text-xs tabular-nums">
                  mercadoria {emReais(p.subtotal)} + frete {emReais(p.frete)}
                </p>
              </div>
            </div>

            <div
              role="region"
              aria-label={`Itens do pedido ${p.referencia}. Role para o lado para ver todas as colunas.`}
              tabIndex={0}
              className="focus-visible:outline-accent overflow-x-auto focus-visible:outline-2 focus-visible:-outline-offset-2"
            >
              <table className="w-full min-w-[680px] border-collapse text-sm">
                <caption className="sr-only">
                  Itens do pedido {p.referencia}
                </caption>
                <thead>
                  <tr className="border-line text-ink-3 border-b text-xs">
                    <th scope="col" className="px-4 py-2 text-left font-medium">
                      Insumo
                    </th>
                    <th scope="col" className="px-4 py-2 text-left font-medium">
                      Pedido
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-2 text-right font-medium"
                    >
                      Quantidade
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-2 text-right font-medium"
                    >
                      Preço
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-2 text-right font-medium"
                    >
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-line divide-y">
                  {p.itens.map((i) => {
                    const l = descreverLinha(i);
                    return (
                      <tr key={i.id} className="align-top">
                        <th
                          scope="row"
                          className="px-4 py-2.5 text-left font-medium"
                        >
                          {i.insumoNome}
                          <span className="text-ink-3 block text-xs font-normal">
                            {i.origemPreco}
                          </span>
                        </th>
                        <td className="text-ink-2 px-4 py-2.5">
                          {l.quanto}
                          <span className="text-ink-3 block text-xs">
                            {l.embalagem}
                          </span>
                        </td>
                        <td className="text-ink-2 px-4 py-2.5 text-right tabular-nums">
                          {l.comprado}
                          <span className="text-ink-3 block text-xs">
                            precisava {l.necessario}
                            {l.adicional ? ` · +${l.adicional}` : ""}
                          </span>
                        </td>
                        <td className="text-ink-2 px-4 py-2.5 text-right tabular-nums">
                          {l.preco}
                          <span className="text-ink-3 block text-xs">
                            {l.porUnidade}
                          </span>
                        </td>
                        <td className="text-ink px-4 py-2.5 text-right font-medium tabular-nums">
                          {l.total}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {p.observacao && (
              <p className="bg-warn-sub text-warn mx-4 mt-3 rounded-md px-3 py-2 text-sm leading-5">
                {p.observacao}
              </p>
            )}

            <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
              <p className="text-ink-3 max-w-[48ch] pt-2 text-xs leading-[18px]">
                {sobreAlcada(resumo, podeAprovar)}
              </p>
              <div className="flex flex-wrap items-start gap-2">
                {resumo.possoAprovar && (
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
                <Link
                  href={`/compras/pedidos/${p.id}`}
                  className={estiloDeBotao("fantasma", "medio")}
                >
                  Abrir e ajustar
                </Link>
              </div>
            </div>
          </Cartao>
        ))
      )}
    </div>
  );
}
