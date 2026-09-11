import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { estiloDeBotao } from "@/design-system/botao";
import { CabecalhoDePagina } from "@/design-system/cabecalho-de-pagina";
import { Cartao, TituloDeSecao } from "@/design-system/cartao";
import { Tabela, type Coluna } from "@/design-system/tabela";
import { Vazio } from "@/design-system/vazio";
import { resolverDivergenciaAcao } from "@/modules/compras/acoes";
import { Acao } from "@/modules/compras/components/acao";
import { ROTULO_DA_DIVERGENCIA } from "@/modules/compras/components/divergencia";
import { EstadoDoRecebimento } from "@/modules/compras/components/estado";
import { FiltrosDeCompras } from "@/modules/compras/components/filtros";
import { dia, dinheiro, janela } from "@/modules/compras/components/formato";
import { listarDivergencias } from "@/modules/compras/services/divergencias";
import { pedidosParaReceber } from "@/modules/compras/services/recebimentos";

/**
 * O RECEBIMENTO — os pedidos aprovados esperando o caminhão, e o que ficou
 * pendente de conciliar (faltou, sobrou, avariou, voltou).
 */

type Pedido = Awaited<ReturnType<typeof pedidosParaReceber>>[number];
type Divergencia = Awaited<ReturnType<typeof listarDivergencias>>[number];

export default async function PaginaDeRecebimento({
  searchParams,
}: {
  searchParams: Promise<{ ver?: string }>;
}) {
  const ctx = await obterContexto();
  if (!ctx) redirect("/login");
  if (!pode(ctx, "compras.ver")) notFound();

  const { ver } = await searchParams;
  const todos = ver === "todos";
  const [pedidos, divergencias] = await Promise.all([
    pedidosParaReceber(ctx),
    listarDivergencias(ctx, { estado: "ABERTA" }),
  ]);
  const mostrar = todos
    ? pedidos
    : pedidos.filter((p) => p.status === "APROVADO");
  const podeReceber = pode(ctx, "compras.receber");
  const podeResolver = podeReceber || pode(ctx, "compras.pedir");
  const variasLojas = !ctx.unidadeAtiva && ctx.unidadesVisiveis.length > 1;

  const colunas: Coluna<Pedido>[] = [
    {
      chave: "pedido",
      titulo: "Pedido",
      principal: true,
      celula: (p) => (
        <Link
          href={`/compras/recebimento/${p.id}`}
          className="hover:text-accent font-medium"
        >
          {p.referencia}
        </Link>
      ),
    },
    ...(variasLojas
      ? [{ chave: "loja", titulo: "Loja", celula: (p: Pedido) => p.loja }]
      : []),
    { chave: "fornecedor", titulo: "Fornecedor", celula: (p) => p.fornecedor },
    {
      chave: "entrega",
      titulo: "Entrega prevista",
      celula: (p) => janela(p.entregaDe, p.entregaAte),
    },
    {
      chave: "situacao",
      titulo: "Situação",
      celula: (p) => <EstadoDoRecebimento valor={p.situacaoRecebimento} />,
    },
    {
      chave: "entregas",
      titulo: "Entregas",
      numerica: true,
      celula: (p) => String(p.entregas),
    },
    {
      chave: "total",
      titulo: "Total",
      numerica: true,
      celula: (p) => dinheiro(p.total),
    },
    {
      chave: "acao",
      titulo: "O que fazer",
      ocultarNoCartao: false,
      celula: (p) =>
        p.status === "APROVADO" && podeReceber ? (
          <Link
            href={`/compras/recebimento/${p.id}`}
            className={estiloDeBotao("secundario", "pequeno")}
          >
            Conferir recebimento
          </Link>
        ) : (
          <Link
            href={`/compras/recebimento/${p.id}`}
            className="text-accent text-sm font-semibold hover:underline"
          >
            Ver entregas
          </Link>
        ),
    },
  ];

  const colunasDivergencias: Coluna<Divergencia>[] = [
    {
      chave: "tipo",
      titulo: "O que houve",
      principal: true,
      celula: (d) => ROTULO_DA_DIVERGENCIA[d.tipo] ?? d.tipo,
    },
    {
      chave: "pedido",
      titulo: "Pedido",
      celula: (d) => (
        <Link
          href={`/compras/recebimento/${d.pedidoId}`}
          className="text-accent hover:underline"
        >
          {d.pedido.fornecedorNome}
          {variasLojas && (
            <span className="text-ink-3 block text-xs">
              {d.pedido.unidadeNome}
            </span>
          )}
        </Link>
      ),
    },
    {
      chave: "detalhe",
      titulo: "Detalhe",
      larguraMin: "16rem",
      celula: (d) => d.detalhe,
    },
    {
      chave: "impacto",
      titulo: "Valor",
      numerica: true,
      celula: (d) =>
        d.impacto === null ? "—" : dinheiro(d.impacto.toString()),
    },
    {
      chave: "quando",
      titulo: "Aberta em",
      numerica: true,
      celula: (d) => dia(d.criadoEm),
    },
    ...(podeResolver
      ? [
          {
            chave: "resolver",
            titulo: "O que fazer",
            celula: (d: Divergencia) => (
              <Acao
                acao={resolverDivergenciaAcao}
                campos={{ divergenciaId: d.id, pedidoId: d.pedidoId }}
                rotulo="Resolver"
                peso="secundario"
                tamanho="pequeno"
                pedeMotivo="O que foi feito? (ex.: fornecedor mandou o que faltou; abatemos na nota)"
              />
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="mx-auto flex w-full max-w-[var(--width-data)] flex-col gap-4">
      <CabecalhoDePagina
        titulo="Recebimento"
        contexto={
          ctx.unidadeAtiva
            ? `${ctx.unidadeAtiva.nome} · pedidos aprovados esperando entrega`
            : "Todas as lojas · para conferir, escolha a loja no topo"
        }
        controles={
          <FiltrosDeCompras
            filtros={[
              {
                nome: "ver",
                rotulo: "Mostrar",
                todos: "Esperando entrega",
                opcoes: [{ valor: "todos", rotulo: "Também os concluídos" }],
              },
            ]}
          />
        }
      />

      <Cartao className="min-w-0 overflow-hidden">
        <TituloDeSecao
          apoio={`${mostrar.length} ${mostrar.length === 1 ? "pedido" : "pedidos"}`}
        >
          Pedidos para receber
        </TituloDeSecao>
        <Tabela
          legenda="Pedidos para receber"
          colunas={colunas}
          linhas={mostrar}
          chaveDaLinha={(p) => p.id}
          vazio={
            <Vazio
              tom={todos ? "neutro" : "bom"}
              icone="entrega"
              titulo={
                todos
                  ? "Nenhum pedido ainda"
                  : "Nenhum pedido esperando entrega"
              }
              explicacao={
                todos
                  ? "Pedidos aprovados aparecem aqui para a loja conferir quando o caminhão chegar."
                  : "Tudo o que foi aprovado já chegou. Os concluídos ficam em Também os concluídos."
              }
            />
          }
        />
      </Cartao>

      <Cartao className="min-w-0 overflow-hidden">
        <TituloDeSecao apoio="Faltou, sobrou, avariou, veio outro, voltou: nada se corrige sozinho.">
          Divergências abertas
        </TituloDeSecao>
        <Tabela
          legenda="Divergências abertas"
          colunas={colunasDivergencias}
          linhas={divergencias}
          chaveDaLinha={(d) => d.id}
          vazio={
            <Vazio
              tom="bom"
              icone="check"
              titulo="Nenhuma divergência aberta"
              explicacao="Quando uma conferência não bater com o pedido, a diferença aparece aqui até alguém resolver."
            />
          }
        />
      </Cartao>
    </div>
  );
}
