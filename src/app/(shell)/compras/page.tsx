import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { estiloDeBotao } from "@/design-system/botao";
import { CabecalhoDePagina } from "@/design-system/cabecalho-de-pagina";
import { Cartao, TituloDeSecao } from "@/design-system/cartao";
import { Etiqueta } from "@/design-system/etiqueta";
import { Tabela, type Coluna } from "@/design-system/tabela";
import { Vazio } from "@/design-system/vazio";
import {
  EstadoDaRodada,
  ROTULO_DA_RODADA,
} from "@/modules/compras/components/estado";
import { FiltrosDeCompras } from "@/modules/compras/components/filtros";
import { dia, diaHora, janela } from "@/modules/compras/components/formato";
import {
  ESTADOS_DA_RODADA,
  type EstadoDaRodada as Estado,
} from "@/modules/compras/schemas/rodada";
import {
  listarRodadas,
  type ResumoDaRodada,
} from "@/modules/compras/services/rodadas";

/**
 * AS RODADAS — a porta de entrada de Compras.
 *
 * Uma linha por rodada: em que etapa está, quais lojas já mandaram a lista,
 * quantos fornecedores responderam, quantos pedidos esperam aprovação, e se
 * algum prazo venceu. Os filtros de loja e estado ficam no endereço.
 */
export default async function PaginaDasRodadas({
  searchParams,
}: {
  searchParams: Promise<{ loja?: string; estado?: string }>;
}) {
  const ctx = await obterContexto();
  if (!ctx) redirect("/login");
  if (!pode(ctx, "compras.ver")) notFound();

  const { loja, estado } = await searchParams;
  const lojaValida = ctx.unidadesVisiveis.some((u) => u.id === loja)
    ? loja
    : undefined;
  const estadoValido = (ESTADOS_DA_RODADA as readonly string[]).includes(
    estado ?? "",
  )
    ? (estado as Estado)
    : undefined;

  const rodadas = await listarRodadas(ctx, {
    unidadeId: lojaValida,
    estado: estadoValido,
  });
  const filtrado = !!(lojaValida || estadoValido);

  const colunas: Coluna<ResumoDaRodada>[] = [
    {
      chave: "rodada",
      titulo: "Rodada",
      principal: true,
      larguraMin: "14rem",
      celula: (r) => (
        <Link
          href={`/compras/rodadas/${r.id}`}
          className="hover:text-accent font-medium"
        >
          Rodada {r.numero}
          <span className="text-ink-3 block text-xs font-normal">
            {r.descricao}
          </span>
        </Link>
      ),
    },
    {
      chave: "estado",
      titulo: "Estado",
      celula: (r) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <EstadoDaRodada valor={r.estado} />
          {r.prazoVencido && <Etiqueta tom="ruim">Prazo vencido</Etiqueta>}
        </span>
      ),
    },
    {
      chave: "lojas",
      titulo: "Lojas",
      celula: (r) => (
        <span className="flex flex-col gap-0.5 text-xs">
          {r.lojas.map((l) => (
            <span key={l.unidadeId}>
              {l.nome}:{" "}
              <strong
                className={l.status === "ENVIADA" ? "text-ok" : "text-warn"}
              >
                {l.status === "ENVIADA"
                  ? `enviou ${l.itens} ${l.itens === 1 ? "item" : "itens"}`
                  : l.status === "DEVOLVIDA"
                    ? "devolvida"
                    : "não enviou"}
              </strong>
            </span>
          ))}
        </span>
      ),
    },
    {
      chave: "prazo",
      titulo: "Prazo",
      celula: (r) =>
        r.estado === "COLETANDO"
          ? `Requisição até ${diaHora(r.prazoRequisicao)}`
          : r.estado === "COTANDO"
            ? `Cotação até ${diaHora(r.prazoCotacao)}`
            : "—",
    },
    {
      chave: "entrega",
      titulo: "Entrega",
      celula: (r) => janela(r.entregaDe, r.entregaAte),
    },
    {
      chave: "cotacao",
      titulo: "Propostas",
      numerica: true,
      celula: (r) =>
        r.solicitacoes ? `${r.respondidas} de ${r.solicitacoes}` : "—",
    },
    {
      chave: "pedidos",
      titulo: "Pedidos",
      numerica: true,
      celula: (r) =>
        r.pedidos === 0 ? (
          "—"
        ) : r.aguardandoAprovacao > 0 ? (
          <Etiqueta tom="aviso">{r.aguardandoAprovacao} aguardando</Etiqueta>
        ) : (
          String(r.pedidos)
        ),
    },
    {
      chave: "criada",
      titulo: "Aberta em",
      numerica: true,
      celula: (r) => dia(r.criadoEm),
    },
  ];

  return (
    <div className="mx-auto flex w-full max-w-[var(--width-data)] flex-col gap-4">
      <CabecalhoDePagina
        titulo="Rodadas de compra"
        contexto="Da lista da loja à mercadoria conferida · rede inteira"
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
              {
                nome: "estado",
                rotulo: "Estado",
                todos: "Todos os estados",
                opcoes: ESTADOS_DA_RODADA.map((e) => ({
                  valor: e,
                  rotulo: ROTULO_DA_RODADA[e],
                })),
              },
            ]}
          />
        }
        acao={
          pode(ctx, "compras.rodadas") ? (
            <Link
              href="/compras/rodadas/nova"
              className={estiloDeBotao("primario", "medio")}
            >
              Nova rodada
            </Link>
          ) : undefined
        }
      />

      <Cartao className="min-w-0 overflow-hidden">
        <TituloDeSecao
          apoio={`${rodadas.length} ${rodadas.length === 1 ? "rodada" : "rodadas"}`}
        >
          Rodadas
        </TituloDeSecao>
        <Tabela
          legenda="Rodadas de compra"
          colunas={colunas}
          linhas={rodadas}
          chaveDaLinha={(r) => r.id}
          vazio={
            filtrado ? (
              <Vazio
                icone="filtro"
                titulo="Nenhuma rodada neste recorte"
                explicacao="Troque a loja ou o estado no topo, ou limpe os filtros."
              />
            ) : (
              <Vazio
                icone="carrinho"
                titulo="Nenhuma rodada ainda"
                explicacao={
                  pode(ctx, "compras.rodadas")
                    ? "Abra a primeira rodada: escolha as lojas e os prazos. As lojas mandam a lista, os fornecedores cotam, e você compara aqui."
                    : "Quando quem cuida das compras abrir uma rodada, ela aparece aqui e a sua loja pode mandar a lista."
                }
                acao={
                  pode(ctx, "compras.rodadas") ? (
                    <Link
                      href="/compras/rodadas/nova"
                      className={estiloDeBotao("primario", "pequeno")}
                    >
                      Nova rodada
                    </Link>
                  ) : undefined
                }
              />
            )
          }
        />
      </Cartao>
    </div>
  );
}
