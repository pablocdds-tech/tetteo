"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";

import { BarraDeFiltros } from "@/design-system/barra-de-filtros";
import { Botao } from "@/design-system/botao";
import { Cartao, TituloDeSecao } from "@/design-system/cartao";
import { Etiqueta } from "@/design-system/etiqueta";
import { Icone } from "@/design-system/icones";
import { LinhaDeDetalhe, PainelLateral } from "@/design-system/painel-lateral";
import { Tabela, type Coluna } from "@/design-system/tabela";
import { Vazio } from "@/design-system/vazio";
import { formatarMoeda, formatarQuantidade, paraCampo } from "@/lib/numero";
import { sigla } from "@/lib/unidades";
import type {
  ItemDaDespensa,
  SituacaoDoItem,
} from "@/modules/estoque/services/despensa";

import { ListaDeCompras, type EstadoDaCotacao } from "./lista-de-compras";
import { useRascunhoDeCompras } from "./rascunho-de-compras";

/**
 * A DESPENSA.
 *
 * Uma tela para responder o que se compra esta semana. À esquerda o que existe;
 * à direita o que vai no pedido. As duas coisas na mesma tela de propósito:
 * separadas em duas páginas, a pessoa volta para conferir um número e perde a
 * lista que estava montando.
 *
 * ---------------------------------------------------------------------------
 * ONDE CADA COISA MORA.
 *
 * BUSCA, CATEGORIA e SITUAÇÃO ficam aqui, na memória do navegador. Eles apenas
 * escondem parte do que já veio. Mandá-los ao servidor faria uma requisição por
 * tecla digitada, e a tela piscaria a cada letra.
 *
 * A LISTA DE COMPRAS fica no `sessionStorage`, por unidade. Ela sobrevive a
 * trocar de filtro, abrir um detalhe e voltar, e até a recarregar a página —
 * mas morre quando a aba fecha, porque um rascunho de compra da semana passada
 * reaparecendo silenciosamente é pior do que não ter rascunho.
 *
 * Nada disso vai para o banco antes de virar cotação. Enquanto é lista, é
 * rascunho, e a tela diz isso.
 * ---------------------------------------------------------------------------
 */

type Situacao = "todas" | "repor" | "sem-saldo" | "sem-minimo" | "saudavel";

const ETIQUETAS: Record<
  SituacaoDoItem,
  { tom: "ok" | "aviso" | "neutro" | "info"; texto: string }
> = {
  repor: { tom: "aviso", texto: "Repor" },
  saudavel: { tom: "ok", texto: "Suficiente" },
  "sem-minimo": { tom: "neutro", texto: "Sem mínimo" },
  "nunca-contado": { tom: "info", texto: "Nunca contado" },
};

function normalizar(texto: string) {
  return texto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

function caiNaSituacao(item: ItemDaDespensa, situacao: Situacao) {
  if (situacao === "todas") return true;
  if (situacao === "repor") return item.situacao === "repor";
  if (situacao === "sem-saldo") return item.situacao === "nunca-contado";
  if (situacao === "sem-minimo") return item.situacao === "sem-minimo";
  return item.situacao === "saudavel";
}

/** Quantidade e unidade andam juntas, sempre. "12,5" sozinho não informa. */
function comUnidade(valor: number, unidade: string) {
  return `${formatarQuantidade(valor)} ${sigla(unidade)}`;
}

const dataLonga = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

export function Despensa({
  itens,
  categorias,
  unidadeId,
  podeVerCustos,
  podeCotar,
  situacaoInicial = "todas",
  acaoDeCotar,
}: {
  itens: ItemDaDespensa[];
  categorias: string[];
  /** A chave do rascunho. Trocar de loja não pode herdar a lista da outra. */
  unidadeId: string;
  podeVerCustos: boolean;
  /** Sem `compras.cotar` a lista existe, mas não vira cotação. */
  podeCotar: boolean;
  /**
   * O filtro com que a tela ABRE, vindo do endereço (`?faltando=1`).
   *
   * Depois disso a situação é estado da tela, não da URL: mexer no filtro não
   * empilha entradas no botão Voltar. O endereço serve para CHEGAR num
   * recorte — um link colado no WhatsApp abre o mesmo lugar —, não para
   * registrar cada clique de quem já está aqui.
   */
  situacaoInicial?: Situacao;
  /**
   * Vem da camada de rota, que é a única que pode conhecer Estoque E Compras.
   * Ver a trava de fronteira no `eslint.config.mjs`.
   */
  acaoDeCotar?: (
    estado: EstadoDaCotacao,
    dados: FormData,
  ) => Promise<EstadoDaCotacao>;
}) {
  const [busca, setBusca] = useState("");
  const [categoria, setCategoria] = useState("todas");
  const [situacao, setSituacao] = useState<Situacao>(situacaoInicial);
  const [aberto, setAberto] = useState<ItemDaDespensa | null>(null);
  const idCategoria = useId();

  const [escolhas, lista] = useRascunhoDeCompras(
    `tetteo.despensa.lista.${unidadeId}`,
  );

  const contagens = useMemo(
    () => ({
      todas: itens.length,
      repor: itens.filter((i) => i.situacao === "repor").length,
      "sem-saldo": itens.filter((i) => i.situacao === "nunca-contado").length,
      "sem-minimo": itens.filter((i) => i.situacao === "sem-minimo").length,
      saudavel: itens.filter((i) => i.situacao === "saudavel").length,
    }),
    [itens],
  );

  const filtrados = useMemo(() => {
    const termo = normalizar(busca);

    return itens.filter((item) => {
      if (!caiNaSituacao(item, situacao)) return false;
      if (categoria !== "todas" && item.categoria !== categoria) return false;
      if (!termo) return true;
      return normalizar(`${item.nome} ${item.categoria ?? ""}`).includes(termo);
    });
  }, [itens, busca, categoria, situacao]);

  const temFiltro =
    busca.trim() !== "" || situacao !== "todas" || categoria !== "todas";

  function limpar() {
    setBusca("");
    setSituacao("todas");
    setCategoria("todas");
  }

  const naLista = useMemo(
    () => new Set(escolhas.map((e) => e.insumoId)),
    [escolhas],
  );

  /**
   * Põe o item na lista com a sugestão JÁ PREENCHIDA quando ela existe.
   *
   * A sugestão é sempre "mínimo menos disponível", e o de onde ela veio viaja
   * junto (`origem`) para a lista poder mostrar. Sem mínimo ou sem saldo
   * conhecido, o campo entra VAZIO — inventar um número aqui seria o sistema
   * decidindo uma compra por conta própria.
   */
  function adicionar(item: ItemDaDespensa) {
    lista.adicionar({
      insumoId: item.insumoId,
      nome: item.nome,
      unidade: item.unidade,
      quantidade: item.sugestao === null ? "" : paraCampo(item.sugestao),
      origem:
        item.sugestao === null || item.minimo === null
          ? null
          : `mínimo ${comUnidade(item.minimo, item.unidade)} − disponível ${comUnidade(
              item.disponivel ?? 0,
              item.unidade,
            )}`,
    });
  }

  const colunas: Coluna<ItemDaDespensa>[] = [
    {
      chave: "item",
      titulo: "Item",
      principal: true,
      larguraMin: "13rem",
      celula: (i) => <span className="block truncate">{i.nome}</span>,
    },
    {
      chave: "categoria",
      titulo: "Categoria",
      celula: (i) =>
        i.categoria ?? <span className="text-ink-3">sem categoria</span>,
    },
    {
      chave: "disponivel",
      titulo: "Disponível",
      numerica: true,
      celula: (i) =>
        i.disponivel === null ? (
          <span className="text-ink-3">—</span>
        ) : (
          <span
            className={i.situacao === "repor" ? "text-warn font-semibold" : ""}
          >
            {formatarQuantidade(i.disponivel)}{" "}
            <span className="text-ink-3 font-normal">{sigla(i.unidade)}</span>
          </span>
        ),
    },
    {
      chave: "minimo",
      titulo: "Mínimo",
      numerica: true,
      celula: (i) =>
        i.minimo === null ? (
          <span className="text-ink-3">—</span>
        ) : (
          <>
            {formatarQuantidade(i.minimo)}{" "}
            <span className="text-ink-3">{sigla(i.unidade)}</span>
          </>
        ),
    },
    {
      chave: "situacao",
      titulo: "Situação",
      celula: (i) => (
        <Etiqueta tom={ETIQUETAS[i.situacao].tom}>
          {ETIQUETAS[i.situacao].texto}
        </Etiqueta>
      ),
    },
    {
      chave: "lista",
      titulo: "Lista",
      celula: (i) =>
        naLista.has(i.insumoId) ? (
          <Botao
            peso="fantasma"
            tamanho="pequeno"
            onClick={() => lista.remover(i.insumoId)}
            aria-label={`Tirar ${i.nome} da lista de compras`}
          >
            <Icone nome="check" tamanho={14} />
            Na lista
          </Botao>
        ) : (
          <Botao
            peso="secundario"
            tamanho="pequeno"
            onClick={() => adicionar(i)}
            aria-label={`Adicionar ${i.nome} à lista de compras`}
          >
            <Icone nome="mais" tamanho={14} />
            Adicionar
          </Botao>
        ),
    },
  ];

  // A categoria é o RECORTE da tabela, e mora no cabeçalho dela. Na barra de
  // filtros ela não cabia ao lado das pílulas e sobrava sozinha numa linha.
  const seletorDeCategoria =
    categorias.length > 0 ? (
      <div className="flex items-center gap-2">
        <label htmlFor={idCategoria} className="text-ink-2 text-sm font-medium">
          Categoria
        </label>
        <select
          id={idCategoria}
          value={categoria}
          onChange={(e) => setCategoria(e.target.value)}
          className="bg-surface border-line-2 text-ink hover:border-ink-3 focus:border-accent h-11 rounded-md border px-2 text-base transition-[border-color,box-shadow] duration-150 focus:shadow-[0_0_0_3px_var(--accent-sub)] focus:outline-none md:h-9 md:text-sm"
        >
          <option value="todas">Todas</option>
          {categorias.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
    ) : undefined;

  return (
    <div className="desk:grid-cols-[7fr_3fr] grid min-w-0 grid-cols-1 items-start gap-4">
      <Cartao como="section" className="min-w-0 overflow-hidden">
        <TituloDeSecao
          apoio="Uma linha por insumo, somando todas as prateleiras da loja"
          acao={seletorDeCategoria}
        >
          O que existe
        </TituloDeSecao>

        <BarraDeFiltros
          busca={busca}
          aoBuscar={setBusca}
          rotuloBusca="Buscar por insumo ou categoria"
          nomeDoGrupo="Situação do insumo"
          opcoes={[
            { valor: "todas", rotulo: "Todos", contagem: contagens.todas },
            { valor: "repor", rotulo: "Repor", contagem: contagens.repor },
            {
              valor: "sem-saldo",
              rotulo: "Nunca contados",
              contagem: contagens["sem-saldo"],
            },
            {
              valor: "sem-minimo",
              rotulo: "Sem mínimo",
              contagem: contagens["sem-minimo"],
            },
            {
              valor: "saudavel",
              rotulo: "Suficientes",
              contagem: contagens.saudavel,
            },
          ]}
          selecionado={situacao}
          aoSelecionar={(v) => setSituacao(v as Situacao)}
          aoLimpar={temFiltro ? limpar : undefined}
          resumo={`${filtrados.length} de ${itens.length} ${
            itens.length === 1 ? "insumo" : "insumos"
          }`}
        />

        <Tabela
          legenda="Insumos da despensa, com o disponível e o mínimo de cada um"
          colunas={colunas}
          linhas={filtrados}
          chaveDaLinha={(i) => i.insumoId}
          linhaAtiva={aberto?.insumoId ?? null}
          aoAbrir={setAberto}
          rotuloAbrir={(i) => `Ver detalhe de ${i.nome}`}
          vazio={
            <Vazio
              icone="lupa"
              titulo="Nenhum insumo com esses filtros"
              explicacao={
                busca.trim()
                  ? `Nada encontrado para “${busca.trim()}”. Sua busca continua aqui — limpe os filtros para ver os ${itens.length} insumos.`
                  : `Nenhum insumo nessa combinação de categoria e situação. Limpe os filtros para ver os ${itens.length} insumos.`
              }
              acao={
                <Botao peso="secundario" tamanho="pequeno" onClick={limpar}>
                  Limpar filtros
                </Botao>
              }
            />
          }
        />
      </Cartao>

      <ListaDeCompras
        escolhas={escolhas}
        podeCotar={podeCotar}
        acao={acaoDeCotar}
        aoRemover={lista.remover}
        aoMudarQuantidade={lista.mudarQuantidade}
        aoLimpar={lista.limpar}
      />

      <PainelLateral
        aberto={aberto !== null}
        aoFechar={() => setAberto(null)}
        titulo={aberto?.nome ?? ""}
        apoio={
          aberto
            ? `${aberto.categoria ?? "Sem categoria"} · contado em ${sigla(aberto.unidade)}`
            : undefined
        }
        rodape={
          aberto ? (
            naLista.has(aberto.insumoId) ? (
              <Botao
                peso="secundario"
                tamanho="pequeno"
                onClick={() => lista.remover(aberto.insumoId)}
              >
                Tirar da lista de compras
              </Botao>
            ) : (
              <Botao tamanho="pequeno" onClick={() => adicionar(aberto)}>
                <Icone nome="mais" tamanho={14} />
                Adicionar à lista
              </Botao>
            )
          ) : undefined
        }
      >
        {aberto && (
          <DetalheDoInsumo item={aberto} podeVerCustos={podeVerCustos} />
        )}
      </PainelLateral>
    </div>
  );
}

/**
 * O DETALHE DO INSUMO.
 *
 * Existe para desfazer a confusão que dá prejuízo: a unidade em que se CONTA
 * não é a unidade em que se COMPRA. A caixa só vira quilo quando o cadastro
 * disser quantos quilos ela tem — e quando não disser, a tela fala isso em vez
 * de escondê-lo atrás de um número redondo.
 */
function DetalheDoInsumo({
  item,
  podeVerCustos,
}: {
  item: ItemDaDespensa;
  podeVerCustos: boolean;
}) {
  return (
    <>
      <h3 className="text-ink-3 text-xs leading-[18px] font-semibold">
        Situação hoje
      </h3>
      <dl className="mt-1">
        <LinhaDeDetalhe rotulo="Disponível">
          {item.disponivel === null ? (
            <span className="text-ink-3">
              nunca contado nesta loja — em branco não é zero
            </span>
          ) : (
            <span className="font-semibold tabular-nums">
              {comUnidade(item.disponivel, item.unidade)}
            </span>
          )}
        </LinhaDeDetalhe>
        <LinhaDeDetalhe rotulo="Mínimo">
          {item.minimo === null ? (
            <span className="text-ink-3">sem mínimo cadastrado</span>
          ) : (
            <span className="tabular-nums">
              {comUnidade(item.minimo, item.unidade)}
            </span>
          )}
        </LinhaDeDetalhe>
        <LinhaDeDetalhe rotulo="Situação">
          <Etiqueta tom={ETIQUETAS[item.situacao].tom}>
            {ETIQUETAS[item.situacao].texto}
          </Etiqueta>
        </LinhaDeDetalhe>
        <LinhaDeDetalhe rotulo="Atualizado">
          {item.atualizadoEm ? (
            <span className="tabular-nums">
              {dataLonga.format(item.atualizadoEm)}
            </span>
          ) : (
            <span className="text-ink-3">nunca</span>
          )}
        </LinhaDeDetalhe>
      </dl>

      <h3 className="text-ink-3 mt-5 text-xs leading-[18px] font-semibold">
        As unidades
      </h3>
      <dl className="mt-1">
        <LinhaDeDetalhe rotulo="Contagem">
          {sigla(item.unidade)}
          {item.unidade !== item.unidadeMedida && (
            <span className="text-ink-3">
              {" "}
              · medido em {sigla(item.unidadeMedida)}
            </span>
          )}
        </LinhaDeDetalhe>
        <LinhaDeDetalhe rotulo="Compra">
          {item.embalagens.length === 0 ? (
            <span className="text-ink-3">
              nenhuma embalagem cadastrada — pede-se na unidade de contagem
            </span>
          ) : (
            <ul className="flex flex-col gap-1">
              {item.embalagens.map((e) => (
                <li key={e.id} className="tabular-nums">
                  {e.nome} ={" "}
                  <strong className="font-semibold">
                    {comUnidade(e.fator, item.unidade)}
                  </strong>
                  {e.padrao && (
                    <span className="text-ink-3 font-normal"> · padrão</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </LinhaDeDetalhe>
      </dl>

      {podeVerCustos && (
        <>
          <h3 className="text-ink-3 mt-5 text-xs leading-[18px] font-semibold">
            Custo
          </h3>
          <dl className="mt-1">
            <LinhaDeDetalhe rotulo="Custo médio">
              <span className="tabular-nums">
                {formatarMoeda(item.custoMedio)} / {sigla(item.unidade)}
              </span>
            </LinhaDeDetalhe>
            <LinhaDeDetalhe rotulo="Última compra">
              <span className="tabular-nums">
                {formatarMoeda(item.custoUltimo)} / {sigla(item.unidade)}
              </span>
            </LinhaDeDetalhe>
            <LinhaDeDetalhe rotulo="Valor parado">
              {item.valor === null ? (
                <span className="text-ink-3">sem saldo conhecido</span>
              ) : (
                <span className="tabular-nums">
                  {formatarMoeda(item.valor)}
                </span>
              )}
            </LinhaDeDetalhe>
          </dl>
          <p className="text-ink-3 mt-2 text-xs leading-[18px]">
            O médio custeia o que já foi consumido; o da última compra diz por
            quanto se repõe hoje. Os dois vêm do cadastro do insumo — esta tela
            não recalcula nenhum.
          </p>
        </>
      )}

      <h3 className="text-ink-3 mt-5 text-xs leading-[18px] font-semibold">
        Onde está
      </h3>
      {item.porLocal.length === 0 ? (
        <p className="text-ink-3 mt-1 text-sm leading-5">
          Nenhuma prateleira tem posição deste insumo. Ele entra no saldo assim
          que aparecer numa contagem fechada ou numa nota lançada.
        </p>
      ) : (
        <ul className="mt-1">
          {item.porLocal.map((l) => (
            <li
              key={l.localId}
              className="border-line flex items-baseline justify-between gap-3 border-b py-2.5 last:border-b-0"
            >
              <span className="text-ink text-sm leading-5">{l.local}</span>
              <span className="flex items-baseline gap-2 text-sm leading-5">
                <span
                  className={`tabular-nums ${l.faltando ? "text-warn font-semibold" : "text-ink-2"}`}
                >
                  {comUnidade(l.quantidade, item.unidade)}
                </span>
                <span className="text-ink-3 text-xs tabular-nums">
                  {l.minimo === null
                    ? "sem mínimo"
                    : `mín. ${comUnidade(l.minimo, item.unidade)}`}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="text-ink-3 mt-5 text-xs leading-[18px]">
        O saldo vem das contagens fechadas mais as notas lançadas depois delas.
        As saídas ainda não são registradas — então ele fica alto até a próxima
        contagem corrigir.{" "}
        <Link
          href="/estoque/movimentos"
          className="text-accent underline underline-offset-2"
        >
          Ver movimentos
        </Link>
        .
      </p>
    </>
  );
}
