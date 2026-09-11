import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { estiloDeBotao } from "@/design-system/botao";
import { CabecalhoDePagina } from "@/design-system/cabecalho-de-pagina";
import { Cartao, TituloDeSecao } from "@/design-system/cartao";
import { Tabela, type Coluna } from "@/design-system/tabela";
import { Vazio } from "@/design-system/vazio";
import { AvisoUnidade } from "@/modules/compras/components/aviso-unidade";
import { EditorDaRequisicao } from "@/modules/compras/components/editor-da-requisicao";
import {
  EstadoDaRequisicao,
  EstadoDaRodada,
  ROTULO_DA_RODADA,
} from "@/modules/compras/components/estado";
import { FiltrosDeCompras } from "@/modules/compras/components/filtros";
import { diaHora, qtd } from "@/modules/compras/components/formato";
import {
  requisicaoDaLoja,
  sugestoesDaLoja,
  type RequisicaoCompleta,
} from "@/modules/compras/services/requisicoes";
import { listarRodadas } from "@/modules/compras/services/rodadas";

/**
 * A REQUISIÇÃO DA LOJA — o que esta loja precisa, nesta rodada.
 *
 * É coisa de LOJA: sem uma loja escolhida no topo, a tela explica e para. A
 * rodada aberta mais recente vem escolhida; as outras ficam no filtro, com a
 * escolha no endereço.
 */

type Item = RequisicaoCompleta["itens"][number];

export default async function PaginaDaRequisicao({
  searchParams,
}: {
  searchParams: Promise<{ rodada?: string }>;
}) {
  const ctx = await obterContexto();
  if (!ctx) redirect("/login");
  if (!pode(ctx, "compras.ver")) notFound();

  if (!ctx.unidadeAtiva) {
    return (
      <div className="mx-auto flex w-full max-w-[var(--width-data)] flex-col gap-4">
        <CabecalhoDePagina
          titulo="Requisição da loja"
          contexto="O que cada loja precisa comprar nesta rodada"
        />
        <AvisoUnidade acao="Preparar a requisição" />
      </div>
    );
  }

  const loja = ctx.unidadeAtiva;
  const { rodada: rodadaPedida } = await searchParams;
  const rodadas = await listarRodadas(ctx, { unidadeId: loja.id });
  const abertas = rodadas.filter(
    (r) => r.estado === "RASCUNHO" || r.estado === "COLETANDO",
  );
  const alvo =
    rodadas.find((r) => r.id === rodadaPedida) ?? abertas[0] ?? rodadas[0];

  const cabecalho = (contexto: string) => (
    <CabecalhoDePagina
      titulo="Requisição da loja"
      contexto={contexto}
      controles={
        rodadas.length > 1 ? (
          <FiltrosDeCompras
            filtros={[
              {
                nome: "rodada",
                rotulo: "Rodada",
                todos: "Rodada aberta mais recente",
                opcoes: rodadas.map((r) => ({
                  valor: r.id,
                  rotulo: `Rodada ${r.numero} · ${ROTULO_DA_RODADA[r.estado] ?? r.estado}`,
                })),
              },
            ]}
          />
        ) : undefined
      }
    />
  );

  if (!alvo) {
    return (
      <div className="mx-auto flex w-full max-w-[var(--width-data)] flex-col gap-4">
        {cabecalho(loja.nome)}
        <Cartao>
          <Vazio
            icone="carrinho"
            titulo="Nenhuma rodada de compra para esta loja"
            explicacao="Quando quem cuida das compras abrir uma rodada, a lista da semana aparece aqui para você preencher."
            acao={
              pode(ctx, "compras.rodadas") ? (
                <Link
                  href="/compras/rodadas/nova"
                  className={estiloDeBotao("primario", "pequeno")}
                >
                  Abrir uma rodada
                </Link>
              ) : undefined
            }
          />
        </Cartao>
      </div>
    );
  }

  const requisicao = await requisicaoDaLoja(ctx, alvo.id);
  const contexto = `${loja.nome} · Rodada ${alvo.numero} · ${alvo.descricao}`;

  if (!requisicao) {
    return (
      <div className="mx-auto flex w-full max-w-[var(--width-data)] flex-col gap-4">
        {cabecalho(contexto)}
        <Cartao>
          <Vazio
            icone="casa"
            titulo="Esta loja não participa desta rodada"
            explicacao="Escolha outra rodada no topo, ou peça a quem cuida das compras para incluir a loja na próxima."
          />
        </Cartao>
      </div>
    );
  }

  const podeRequisitar = pode(ctx, "compras.requisitar");
  const editavel = requisicao.editavel && podeRequisitar;
  const sugestoes = editavel ? await sugestoesDaLoja(ctx) : [];

  const colunas: Coluna<Item>[] = [
    {
      chave: "insumo",
      titulo: "Insumo",
      principal: true,
      celula: (i) => (
        <span>
          {i.nome}
          {i.categoria && (
            <span className="text-ink-3 block text-xs font-normal">
              {i.categoria}
            </span>
          )}
        </span>
      ),
    },
    {
      chave: "quantidade",
      titulo: "Pedido",
      numerica: true,
      celula: (i) => qtd(i.quantidade, i.unidade),
    },
    {
      chave: "sugestao",
      titulo: "O sistema sugeria",
      celula: (i) =>
        i.sugestaoQuantidade ? (
          <span className="text-xs">
            {qtd(i.sugestaoQuantidade, i.unidade)}
            {i.sugestaoFormula && (
              <span className="text-ink-3 block">{i.sugestaoFormula}</span>
            )}
          </span>
        ) : (
          <span className="text-ink-3 text-xs">{i.sugestaoFormula ?? "—"}</span>
        ),
    },
    {
      chave: "observacao",
      titulo: "Observação",
      celula: (i) => i.observacao ?? "—",
    },
  ];

  return (
    <div className="mx-auto flex w-full max-w-[var(--width-data)] flex-col gap-4">
      {cabecalho(contexto)}

      <Cartao className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <EstadoDaRequisicao valor={requisicao.status} />
        <EstadoDaRodada valor={alvo.estado} />
        <span className="text-ink-2 text-sm">
          Mandar até{" "}
          <strong className="font-semibold">
            {diaHora(alvo.prazoRequisicao)}
          </strong>
        </span>
        {requisicao.status === "ENVIADA" && (
          <span className="text-ink-3 text-sm">
            Enviada em {diaHora(requisicao.enviadaEm)}. O comprador já vê esta
            lista.
          </span>
        )}
        {!requisicao.editavel && requisicao.status !== "ENVIADA" && (
          <span className="text-ink-3 text-sm">
            A coleta desta rodada terminou; a lista não muda mais por aqui.
          </span>
        )}
        {!podeRequisitar && requisicao.editavel && (
          <span className="text-ink-3 text-sm">
            Seu perfil acompanha a lista, mas não a preenche.
          </span>
        )}
      </Cartao>

      {requisicao.status === "DEVOLVIDA" && requisicao.motivoDevolucao && (
        <p
          role="status"
          className="border-bad/25 bg-bad-sub text-bad rounded-lg border px-4 py-3 text-sm leading-5"
        >
          <strong className="font-semibold">Devolvida para corrigir:</strong>{" "}
          {requisicao.motivoDevolucao}
        </p>
      )}

      <Cartao como="section" className="min-w-0">
        <TituloDeSecao
          apoio={
            editavel
              ? "Quantidades na unidade de estoque. A sugestão só entra quando você clica em Usar."
              : `${requisicao.itens.length} ${requisicao.itens.length === 1 ? "item" : "itens"}`
          }
        >
          Lista da loja
        </TituloDeSecao>
        {editavel ? (
          <EditorDaRequisicao
            requisicao={{
              id: requisicao.id,
              versao: requisicao.versao,
              itens: requisicao.itens,
            }}
            sugestoes={sugestoes}
          />
        ) : (
          <Tabela
            legenda="Itens da requisição da loja"
            colunas={colunas}
            linhas={requisicao.itens}
            chaveDaLinha={(i) => i.id}
            vazio={
              <Vazio
                icone="carrinho"
                titulo="A lista ficou vazia"
                explicacao="Esta loja não pediu nada nesta rodada."
              />
            }
          />
        )}
      </Cartao>
    </div>
  );
}
