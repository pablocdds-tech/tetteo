import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { estiloDeBotao } from "@/design-system/botao";
import { CabecalhoDePagina } from "@/design-system/cabecalho-de-pagina";
import { Cartao, TituloDeSecao } from "@/design-system/cartao";
import { Etiqueta } from "@/design-system/etiqueta";
import { Icone } from "@/design-system/icones";
import { Tabela, type Coluna } from "@/design-system/tabela";
import { Vazio } from "@/design-system/vazio";
import {
  buscarLinkAcao,
  buscarMensagemAcao,
  colocarEmDisputaAcao,
  convidarAcao,
  devolverRequisicaoAcao,
  incluirFornecedorAcao,
  marcarEnviadaAMaoAcao,
  marcarRecusaAcao,
  moverRodadaAcao,
  revogarLinkAcao,
} from "@/modules/compras/acoes";
import { Acao } from "@/modules/compras/components/acao";
import { Copiar } from "@/modules/compras/components/copiar";
import {
  EstadoDaRequisicao,
  EstadoDaRodada,
  EstadoDaSolicitacao,
  EstadoDoEnvio,
} from "@/modules/compras/components/estado";
import {
  dia,
  diaHora,
  janela,
  qtd,
} from "@/modules/compras/components/formato";
import { Voltar } from "@/modules/compras/components/voltar";
import type { SituacaoDoLink } from "@/modules/compras/schemas/link";
import {
  ESTADOS_DA_RODADA,
  ROTULO_DO_ESTADO,
  proximoEstado,
  type EstadoDaRodada as Estado,
} from "@/modules/compras/schemas/rodada";
import { listarFornecedores } from "@/modules/compras/services/fornecedores";
import {
  obterRodada,
  type RodadaCompleta,
} from "@/modules/compras/services/rodadas";
import { listarSolicitacoes } from "@/modules/compras/services/solicitacoes";

/**
 * A RODADA — do rascunho à rodada fechada, numa tela.
 *
 * Em cima, as etapas: onde a rodada está e o que falta. Ao lado, o PRÓXIMO
 * PASSO, com um botão só, que diz o verbo ("Consolidar e abrir cotação").
 * Voltar uma etapa é REABRIR e pede motivo; cancelar também.
 *
 * Embaixo, o que a rodada juntou: as lojas e as listas delas, os itens
 * consolidados (com quem é fornecedor fixo e quem está em disputa), e os
 * fornecedores convidados — com o link de cada um, o convite e a resposta.
 */

type Solicitacao = Awaited<ReturnType<typeof listarSolicitacoes>>[number];
type ItemNaRodada = RodadaCompleta["itens"][number];
type RequisicaoNaRodada = RodadaCompleta["requisicoes"][number];

const ETAPAS = ESTADOS_DA_RODADA.filter((e) => e !== "CANCELADA");

const PASSO: Partial<Record<Estado, { rotulo: string; explica: string }>> = {
  RASCUNHO: {
    rotulo: "Abrir coleta das requisições",
    explica:
      "As lojas passam a ver a rodada e mandam a lista de cada uma até o prazo.",
  },
  COLETANDO: {
    rotulo: "Consolidar e abrir cotação",
    explica:
      "Soma as listas enviadas e prepara um pedido de cotação por fornecedor. Loja que não enviou fica de fora — e isso fica registrado.",
  },
  COTANDO: {
    rotulo: "Encerrar cotação",
    explica:
      "Os links dos fornecedores deixam de aceitar resposta, e a comparação fica pronta para revisar.",
  },
  REVISAO: {
    rotulo: "Concluir aprovação",
    explica:
      "Quando todos os pedidos da rodada estiverem aprovados ou recusados.",
  },
  APROVADA: {
    rotulo: "Passar para envio e entrega",
    explica:
      "Os pedidos aprovados já estão na fila de envio. A rodada fica aberta até as mensagens e as entregas se resolverem.",
  },
  DESPACHANDO: {
    rotulo: "Fechar rodada",
    explica:
      "Só com todas as mensagens de pedido resolvidas no painel de envios.",
  },
};

const CONFIRMAR: Partial<Record<Estado, string>> = {
  COLETANDO:
    "Consolidar agora? Loja que ainda não enviou a lista fica de fora desta rodada.",
  COTANDO:
    "Encerrar a cotação? Os links dos fornecedores param de aceitar resposta.",
  DESPACHANDO:
    "Fechar a rodada? Depois disso, mudança só reabrindo, com motivo.",
};

const REABRIR: Partial<Record<Estado, Estado>> = {
  REVISAO: "COTANDO",
  APROVADA: "REVISAO",
  DESPACHANDO: "REVISAO",
  FECHADA: "DESPACHANDO",
};

const ORIGEM_DA_PROPOSTA: Record<string, string> = {
  FORNECEDOR_LINK: "pelo link",
  COMPRADOR_DIGITOU: "digitada pelo comprador",
  NEGOCIACAO: "negociação registrada",
};

const LINK: Record<
  SituacaoDoLink,
  { tom: "ok" | "aviso" | "ruim" | "neutro"; texto: string }
> = {
  valido: { tom: "ok", texto: "Link válido" },
  aguarde: { tom: "ok", texto: "Link válido" },
  limite: { tom: "aviso", texto: "Limite de versões" },
  vencido: { tom: "neutro", texto: "Link vencido" },
  encerrado: { tom: "neutro", texto: "Cotação encerrada" },
  revogado: { tom: "ruim", texto: "Link desativado" },
  bloqueado: { tom: "ruim", texto: "Link bloqueado" },
};

export default async function PaginaDaRodada({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await obterContexto();
  if (!ctx) redirect("/login");
  if (!pode(ctx, "compras.ver")) notFound();

  const { id } = await params;
  const rodada = await obterRodada(ctx, id);
  if (!rodada) notFound();

  const estado = rodada.estado as Estado;
  const podeRodadas = pode(ctx, "compras.rodadas");
  const podeCotar = pode(ctx, "compras.cotar");
  const podeEnviar = pode(ctx, "compras.enviar");
  const podeRequisitar = pode(ctx, "compras.requisitar");
  const veFornecedores = podeCotar || pode(ctx, "compras.aprovar");

  const solicitacoes: Solicitacao[] = veFornecedores
    ? await listarSolicitacoes(ctx, rodada.id)
    : [];
  const fornecedores =
    estado === "COTANDO" && podeCotar ? await listarFornecedores(ctx) : [];
  const convidados = new Set(solicitacoes.map((s) => s.fornecedor.id));
  const paraIncluir = fornecedores.filter((f) => !convidados.has(f.id));
  const cotaveis = rodada.itens.filter((i) => i.modo === "COTAVEL");

  const prox = proximoEstado(estado);
  const passo = prox ? PASSO[estado] : undefined;
  const reabrir = REABRIR[estado];
  const cancelavel = estado !== "FECHADA" && estado !== "CANCELADA";
  const campos = { id: rodada.id, versao: rodada.versao };

  const colunasLojas: Coluna<RequisicaoNaRodada>[] = [
    { chave: "loja", titulo: "Loja", principal: true, celula: (q) => q.loja },
    {
      chave: "situacao",
      titulo: "Situação",
      celula: (q) => (
        <span className="flex flex-col items-start gap-1">
          <EstadoDaRequisicao valor={q.status} />
          {q.status === "DEVOLVIDA" && q.motivoDevolucao && (
            <span className="text-ink-3 text-xs">
              Motivo: {q.motivoDevolucao}
            </span>
          )}
        </span>
      ),
    },
    {
      chave: "itens",
      titulo: "Itens",
      numerica: true,
      celula: (q) => String(q.itens),
    },
    {
      chave: "enviada",
      titulo: "Enviada em",
      numerica: true,
      celula: (q) => (q.enviadaEm ? diaHora(q.enviadaEm) : "—"),
    },
    ...(podeRodadas && estado === "COLETANDO"
      ? [
          {
            chave: "acao",
            titulo: "O que fazer",
            celula: (q: RequisicaoNaRodada) =>
              q.status === "ENVIADA" ? (
                <Acao
                  acao={devolverRequisicaoAcao}
                  campos={{ requisicaoId: q.id, rodadaId: rodada.id }}
                  rotulo="Devolver para corrigir"
                  peso="secundario"
                  tamanho="pequeno"
                  pedeMotivo="O que a loja precisa corrigir?"
                />
              ) : null,
          },
        ]
      : []),
  ];

  const colunasItens: Coluna<ItemNaRodada>[] = [
    {
      chave: "insumo",
      titulo: "Insumo",
      principal: true,
      larguraMin: "12rem",
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
      chave: "total",
      titulo: "Total da rede",
      numerica: true,
      celula: (i) => qtd(i.quantidadeTotal, i.unidade),
    },
    {
      chave: "lojas",
      titulo: "Por loja",
      celula: (i) => (
        <span className="text-xs">
          {i.porLoja
            .map((l) => `${l.loja}: ${qtd(l.quantidade, i.unidade)}`)
            .join(" · ") || "—"}
        </span>
      ),
    },
    {
      chave: "modo",
      titulo: "Como se compra",
      celula: (i) =>
        i.modo === "DIRECIONADO" ? (
          <span className="flex flex-col items-start gap-1">
            <Etiqueta tom="info">Fornecedor fixo</Etiqueta>
            <span className="text-xs">{i.fornecedorFixo?.nome}</span>
          </span>
        ) : (
          <span className="flex flex-col items-start gap-1">
            <Etiqueta tom="acento">Em disputa</Etiqueta>
            {i.excecaoMotivo && (
              <span className="text-ink-3 text-xs">
                Tirado do fixo: {i.excecaoMotivo}
              </span>
            )}
          </span>
        ),
    },
    ...(podeCotar && estado === "COTANDO"
      ? [
          {
            chave: "acao",
            titulo: "O que fazer",
            celula: (i: ItemNaRodada) =>
              i.modo === "DIRECIONADO" ? (
                <Acao
                  acao={colocarEmDisputaAcao}
                  campos={{ itemDaRodadaId: i.id, rodadaId: rodada.id }}
                  rotulo="Colocar em disputa"
                  peso="secundario"
                  tamanho="pequeno"
                  pedeMotivo="Por que tirar do fornecedor fixo?"
                />
              ) : null,
          },
        ]
      : []),
  ];

  const colunasFornecedores: Coluna<Solicitacao>[] = [
    {
      chave: "fornecedor",
      titulo: "Fornecedor",
      principal: true,
      larguraMin: "12rem",
      celula: (s) => (
        <span>
          {s.fornecedor.nome}
          <span className="text-ink-3 block text-xs font-normal">
            {s.fornecedor.autorizadoMensagens && s.fornecedor.telefonePedidos
              ? "Recebe pelo WhatsApp"
              : "Sem número autorizado — copie e mande"}
          </span>
        </span>
      ),
    },
    {
      chave: "situacao",
      titulo: "Situação",
      celula: (s) => <EstadoDaSolicitacao valor={s.status} />,
    },
    {
      chave: "itens",
      titulo: "Itens",
      numerica: true,
      celula: (s) =>
        s.direcionados
          ? `${s.itens} (${s.direcionados} de fixo)`
          : String(s.itens),
    },
    {
      chave: "resposta",
      titulo: "Última resposta",
      celula: (s) =>
        s.ultimaVersao ? (
          <span className="text-xs whitespace-nowrap">
            v{s.ultimaVersao.numero} · {diaHora(s.ultimaVersao.recebidaEm)}
            <span className="text-ink-3 block">
              {ORIGEM_DA_PROPOSTA[s.ultimaVersao.origem] ??
                s.ultimaVersao.origem}
            </span>
          </span>
        ) : (
          <span className="text-ink-3 text-xs">Sem resposta</span>
        ),
    },
    {
      chave: "link",
      titulo: "Link e convite",
      celula: (s) => (
        <span className="flex flex-col items-start gap-1">
          {s.link ? (
            <Etiqueta tom={LINK[s.link].tom}>{LINK[s.link].texto}</Etiqueta>
          ) : (
            <Etiqueta tom="neutro">Sem link</Etiqueta>
          )}
          {s.convite && (
            <EstadoDoEnvio
              valor={s.convite.estado}
              simulada={s.convite.simulada}
              enviadaAMao={!!s.convite.enviadaAMaoEm}
            />
          )}
          {estado === "COTANDO" &&
            s.convite?.estado === "BLOQUEADA" &&
            s.convite.motivoBloqueio && (
              <span className="text-ink-3 text-xs">
                {s.convite.motivoBloqueio}
              </span>
            )}
        </span>
      ),
    },
    ...(podeCotar
      ? [
          {
            chave: "acoes",
            titulo: "O que fazer",
            celula: (s: Solicitacao) => (
              <AcoesDaSolicitacao
                s={s}
                rodadaId={rodada.id}
                estado={estado}
                podeEnviar={podeEnviar}
              />
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="mx-auto flex w-full max-w-[var(--width-data)] flex-col gap-4">
      <Voltar para="/compras" rotulo="Rodadas" />
      <CabecalhoDePagina
        titulo={`Rodada ${rodada.numero}`}
        contexto={`${rodada.descricao} · aberta em ${dia(rodada.criadoEm)}`}
        controles={<EstadoDaRodada valor={estado} />}
      />
      <Etapas estado={estado} />

      <div className="desk:grid-cols-[minmax(0,1fr)_340px] grid gap-4">
        <div className="flex min-w-0 flex-col gap-4">
          <Cartao como="section" className="min-w-0 overflow-hidden">
            <TituloDeSecao
              apoio={`${rodada.requisicoes.filter((q) => q.status === "ENVIADA").length} de ${rodada.requisicoes.length} enviaram a lista`}
            >
              Lojas e requisições
            </TituloDeSecao>
            <Tabela
              legenda="Requisições das lojas nesta rodada"
              colunas={colunasLojas}
              linhas={rodada.requisicoes}
              chaveDaLinha={(q) => q.id}
              vazio={
                <Vazio
                  icone="casa"
                  titulo="Nenhuma loja nesta rodada"
                  explicacao="Cancele esta rodada e abra outra escolhendo as lojas."
                />
              }
            />
          </Cartao>

          <Cartao como="section" className="min-w-0 overflow-hidden">
            <TituloDeSecao
              apoio={
                rodada.consolidadaEm
                  ? `${rodada.itens.length} itens · consolidada em ${diaHora(rodada.consolidadaEm)}`
                  : "Aparece quando a coleta for consolidada"
              }
            >
              Itens da rodada
            </TituloDeSecao>
            <Tabela
              legenda="Itens consolidados da rodada"
              colunas={colunasItens}
              linhas={rodada.itens}
              chaveDaLinha={(i) => i.id}
              vazio={
                <Vazio
                  icone="lista-conferida"
                  titulo="A lista da rodada ainda não existe"
                  explicacao={
                    estado === "RASCUNHO" || estado === "COLETANDO"
                      ? "Ela nasce quando a coleta for consolidada: a soma do que cada loja enviou."
                      : "Nenhuma loja enviou itens nesta rodada."
                  }
                />
              }
            />
          </Cartao>
        </div>

        {/* Os fornecedores em largura inteira: a tabela tem ações demais para
            dividir a linha com o "Próximo passo". No computador vem depois da
            coluna lateral; no celular, na ordem natural. */}
        <div className="desk:order-last desk:col-span-2 flex min-w-0 flex-col gap-4">
          {veFornecedores && (
            <Cartao como="section" className="min-w-0 overflow-hidden">
              <TituloDeSecao
                apoio={
                  solicitacoes.length
                    ? `${solicitacoes.filter((s) => s.ultimaVersao).length} de ${solicitacoes.length} responderam`
                    : "Um pedido de cotação por fornecedor que vende os itens"
                }
              >
                Fornecedores e propostas
              </TituloDeSecao>
              <Tabela
                legenda="Fornecedores convidados a cotar"
                colunas={colunasFornecedores}
                linhas={solicitacoes}
                chaveDaLinha={(s) => s.id}
                vazio={
                  <Vazio
                    icone="entrega"
                    titulo="Nenhum fornecedor convidado"
                    explicacao={
                      estado === "RASCUNHO" || estado === "COLETANDO"
                        ? "Os pedidos de cotação nascem na consolidação, para quem vende cada item no cadastro de fornecedores."
                        : "Nenhum fornecedor cadastrado vende estes itens. Cadastre os produtos de cada fornecedor, ou inclua um à mão abaixo."
                    }
                  />
                }
              />
            </Cartao>
          )}

          {estado === "COTANDO" && podeCotar && (
            <Cartao como="section" className="min-w-0 overflow-hidden">
              <TituloDeSecao apoio="Quem não está no cadastro de produtos, convidado à mão.">
                Incluir fornecedor
              </TituloDeSecao>
              <div className="p-4">
                {paraIncluir.length === 0 || cotaveis.length === 0 ? (
                  <p className="text-ink-3 text-sm">
                    {cotaveis.length === 0
                      ? "Todos os itens desta rodada são de fornecedor fixo — não há o que pôr em disputa."
                      : "Todos os fornecedores ativos já estão nesta cotação."}
                  </p>
                ) : (
                  <Acao
                    acao={incluirFornecedorAcao}
                    campos={{ rodadaId: rodada.id }}
                    rotulo="Incluir na cotação"
                    peso="secundario"
                  >
                    <div className="flex max-w-md flex-col gap-1.5">
                      <label
                        htmlFor="incluir-fornecedor"
                        className="text-ink-2 text-sm font-semibold"
                      >
                        Fornecedor
                      </label>
                      <select
                        id="incluir-fornecedor"
                        name="fornecedorId"
                        required
                        className="bg-surface border-line-2 text-ink focus:border-accent h-10 rounded-md border px-2.5 text-sm"
                      >
                        {paraIncluir.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.nome}
                          </option>
                        ))}
                      </select>
                    </div>
                    <fieldset className="flex flex-col gap-1.5">
                      <legend className="text-ink-2 mb-1 text-sm font-semibold">
                        Itens que ele vai cotar
                      </legend>
                      <div className="flex flex-wrap gap-2">
                        {cotaveis.map((i) => (
                          <label
                            key={i.id}
                            className="border-line-2 has-[:checked]:border-accent has-[:checked]:bg-accent-sub flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm md:min-h-9"
                          >
                            <input
                              type="checkbox"
                              name="itemIds"
                              value={i.id}
                              className="size-4"
                            />
                            {i.nome}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  </Acao>
                )}
              </div>
            </Cartao>
          )}
        </div>

        <div className="desk:order-none order-first flex min-w-0 flex-col gap-4">
          <Cartao como="section" className="flex flex-col gap-3 p-4">
            <h2 className="text-[15px] leading-6 font-semibold">
              Próximo passo
            </h2>

            {estado === "REVISAO" && veFornecedores && (
              <Link
                href={`/compras/comparacao?rodada=${rodada.id}`}
                className={estiloDeBotao("primario", "medio")}
              >
                Revisar propostas
              </Link>
            )}

            {(estado === "RASCUNHO" || estado === "COLETANDO") &&
              podeRequisitar && (
                <Link
                  href={`/compras/requisicao?rodada=${rodada.id}`}
                  className={estiloDeBotao(
                    podeRodadas ? "secundario" : "primario",
                    "medio",
                  )}
                >
                  Preencher a requisição da loja
                </Link>
              )}

            {passo && podeRodadas && prox && (
              <div className="flex flex-col gap-2">
                <p className="text-ink-3 text-sm leading-5">{passo.explica}</p>
                <Acao
                  acao={moverRodadaAcao}
                  campos={{ ...campos, para: prox }}
                  rotulo={passo.rotulo}
                  peso={estado === "REVISAO" ? "secundario" : "primario"}
                  confirmar={CONFIRMAR[estado]}
                />
              </div>
            )}

            {!passo && (
              <p className="text-ink-3 text-sm leading-5">
                {estado === "FECHADA"
                  ? "Rodada fechada. Mudança agora só reabrindo, com motivo."
                  : estado === "CANCELADA"
                    ? "Rodada cancelada. Nada dela vai para fornecedor."
                    : ""}
              </p>
            )}

            {!podeRodadas && passo && (
              <p className="text-ink-3 text-sm leading-5">
                Quem cuida das compras avança a rodada. {passo.explica}
              </p>
            )}

            {rodada.motivoUltimaReabertura && (
              <p className="bg-warn-sub text-warn rounded-md px-3 py-2 text-sm leading-5">
                Reaberta: {rodada.motivoUltimaReabertura}
              </p>
            )}

            {podeRodadas && (reabrir || cancelavel) && (
              <div className="border-line flex flex-col gap-2 border-t pt-3">
                {reabrir && (
                  <Acao
                    acao={moverRodadaAcao}
                    campos={{ ...campos, para: reabrir }}
                    rotulo={`Reabrir para "${ROTULO_DO_ESTADO[reabrir]}"`}
                    peso="fantasma"
                    tamanho="pequeno"
                    pedeMotivo="Por que reabrir? Fica gravado na rodada."
                  />
                )}
                {cancelavel && (
                  <Acao
                    acao={moverRodadaAcao}
                    campos={{ ...campos, para: "CANCELADA" }}
                    rotulo="Cancelar rodada"
                    peso="fantasma"
                    tamanho="pequeno"
                    pedeMotivo="Por que cancelar a rodada?"
                  />
                )}
              </div>
            )}

            <div className="border-line flex flex-wrap gap-x-4 gap-y-1 border-t pt-3 text-sm">
              <Link
                href={`/compras/pedidos?rodada=${rodada.id}`}
                className="text-accent hover:underline"
              >
                Pedidos desta rodada
              </Link>
              <Link
                href={`/compras/aprovacao?rodada=${rodada.id}`}
                className="text-accent hover:underline"
              >
                Aprovação
              </Link>
            </div>
          </Cartao>

          <Cartao como="section" className="p-4">
            <h2 className="mb-3 text-[15px] leading-6 font-semibold">Prazos</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
              <dt className="text-ink-3">Lojas mandam a lista até</dt>
              <dd className="tabular-nums">
                {diaHora(rodada.prazoRequisicao)}
              </dd>
              <dt className="text-ink-3">Fornecedores respondem até</dt>
              <dd className="tabular-nums">{diaHora(rodada.prazoCotacao)}</dd>
              <dt className="text-ink-3">Entrega</dt>
              <dd className="tabular-nums">
                {janela(rodada.entregaDe, rodada.entregaAte)}
              </dd>
              <dt className="text-ink-3">Responsável</dt>
              <dd>{rodada.responsavel ?? "—"}</dd>
              {rodada.observacao && (
                <>
                  <dt className="text-ink-3">Observação</dt>
                  <dd>{rodada.observacao}</dd>
                </>
              )}
            </dl>
          </Cartao>
        </div>
      </div>
    </div>
  );
}

/** As etapas, com a atual marcada — em palavra, não só em cor. */
function Etapas({ estado }: { estado: Estado }) {
  if (estado === "CANCELADA") return null;
  const atual = ETAPAS.indexOf(estado);
  return (
    <ol
      aria-label="Etapas da rodada"
      className="flex flex-wrap items-center gap-1.5"
    >
      {ETAPAS.map((e, i) => (
        <li
          key={e}
          aria-current={i === atual ? "step" : undefined}
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${
            i === atual
              ? "bg-accent text-accent-ink"
              : i < atual
                ? "bg-ok-sub text-ok"
                : "bg-surface-2 text-ink-3"
          }`}
        >
          {i < atual && <Icone nome="check" tamanho={12} />}
          <span className="sr-only">
            {i < atual ? "Feito: " : i === atual ? "Agora: " : "Depois: "}
          </span>
          {ROTULO_DO_ESTADO[e]}
        </li>
      ))}
    </ol>
  );
}

/** Os gestos de cada fornecedor convidado, conforme a etapa. */
function AcoesDaSolicitacao({
  s,
  rodadaId,
  estado,
  podeEnviar,
}: {
  s: Solicitacao;
  rodadaId: string;
  estado: Estado;
  podeEnviar: boolean;
}) {
  const campos = { solicitacaoId: s.id, rodadaId };
  const emCotacao = estado === "COTANDO";
  const aguardando = s.status === "RASCUNHO" || s.status === "CONVIDADO";
  const convite = s.convite;
  // Depois de encerrada a cotação, mandar o convite não serve mais para nada.
  const podeMarcar =
    emCotacao &&
    podeEnviar &&
    !!convite &&
    !convite.enviadaAMaoEm &&
    convite.estado !== "ENVIANDO" &&
    convite.estado !== "CANCELADA" &&
    (convite.simulada ||
      ["BLOQUEADA", "FALHOU", "INCERTA"].includes(convite.estado));

  return (
    <div className="flex flex-wrap items-start gap-2">
      {emCotacao && s.status === "RASCUNHO" && (
        <Acao
          acao={convidarAcao}
          campos={campos}
          rotulo="Convidar"
          tamanho="pequeno"
        />
      )}
      {emCotacao && s.link && (
        <Copiar rotulo="Copiar link" buscar={buscarLinkAcao.bind(null, s.id)} />
      )}
      {emCotacao && convite && (
        <Copiar
          rotulo="Copiar convite"
          buscar={buscarMensagemAcao.bind(null, convite.id)}
        />
      )}
      {podeMarcar && convite && (
        <Acao
          acao={marcarEnviadaAMaoAcao}
          campos={{ mensagemId: convite.id }}
          rotulo="Mandei pelo meu WhatsApp"
          peso="secundario"
          tamanho="pequeno"
        />
      )}
      {(estado === "COTANDO" || estado === "REVISAO") && (
        <Link
          href={`/compras/rodadas/${rodadaId}/proposta/${s.id}`}
          className={estiloDeBotao("secundario", "pequeno")}
        >
          {estado === "REVISAO" ? "Registrar negociação" : "Lançar resposta"}
        </Link>
      )}
      {emCotacao && s.link && s.status !== "RASCUNHO" && (
        <Acao
          acao={convidarAcao}
          campos={{ ...campos, reemitir: "1" }}
          rotulo="Mandar link novo"
          peso="fantasma"
          tamanho="pequeno"
          confirmar="O link anterior deixa de valer na hora. Mandar um link novo?"
        />
      )}
      {emCotacao && s.link && s.link !== "revogado" && (
        <Acao
          acao={revogarLinkAcao}
          campos={campos}
          rotulo="Desativar link"
          peso="fantasma"
          tamanho="pequeno"
          pedeMotivo="Por que desativar? (ex.: mandei para o número errado)"
        />
      )}
      {emCotacao && aguardando && (
        <Acao
          acao={marcarRecusaAcao}
          campos={campos}
          rotulo="Não vai cotar"
          peso="fantasma"
          tamanho="pequeno"
          pedeMotivo="O que o fornecedor disse?"
        />
      )}
    </div>
  );
}
