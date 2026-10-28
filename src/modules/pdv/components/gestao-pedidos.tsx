"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAmbienteProprio } from "@/core/shell/link-integrado";
import { Botao, estiloDeBotao } from "@/design-system/botao";
import { Campo } from "@/design-system/campo";
import { Icone } from "@/design-system/icones";
import { PainelLateral } from "@/design-system/painel-lateral";
import { cancelarVendaAcao } from "../acoes";
import { listarPedidosAcao, moverPedidoAcao } from "../acoes-pedidos";
import { atribuirEntregadorAcao } from "../acoes-entregas";
import type {
  DestinoPedido,
  PedidoPdv,
  QuadroPedidos,
  StatusPedido,
  VisaoPedidos,
} from "../pedido-types";
import styles from "./gestao-pedidos.module.css";
import { BotoesImpressao } from "./botoes-impressao";
import { EtiquetaPagamento } from "./etiqueta-pagamento";
import { ReceberPedido } from "./receber-pedido";
import { GerenciarAgendamento } from "./gerenciar-agendamento";
import {
  EtiquetaOrigemPedido,
  PagamentosOrigemPedido,
  EntregaOrigemPedido,
} from "./origem-pedido";
import { useLayoutPedidos } from "../hooks/use-layout-pedidos";
import {
  ESTADOS_OCULTAVEIS,
  LAYOUT_PEDIDOS_PADRAO,
} from "../schemas/layout-pedidos";

const COLUNAS: {
  status: StatusPedido;
  nome: string;
  classe: string;
  vazio: string;
}[] = [
  {
    status: "AGENDADO",
    nome: "Agendado",
    classe: styles.agendado,
    vazio: "Pedidos aguardando o horário do preparo.",
  },
  {
    status: "COZINHA",
    nome: "Na cozinha",
    classe: styles.cozinha,
    vazio: "Os pedidos em preparo aparecerão aqui.",
  },
  {
    status: "AGUARDANDO_COLETA",
    nome: "Aguardando coleta",
    classe: styles.coleta,
    vazio: "Pedidos prontos, aguardando motoboy ou retirada.",
  },
  {
    status: "SAIU_ENTREGA",
    nome: "Saiu para entrega",
    classe: styles.rua,
    vazio: "Entregas em andamento aparecerão aqui.",
  },
  {
    status: "ENTREGUE",
    nome: "Entregue",
    classe: styles.entregue,
    vazio: "Nenhum pedido entregue neste dia.",
  },
  {
    status: "CANCELADO",
    nome: "Cancelado",
    classe: styles.cancelado,
    vazio: "Nenhum pedido cancelado neste dia.",
  },
];
const nomes = Object.fromEntries(
  COLUNAS.map((c) => [c.status, c.nome]),
) as Record<StatusPedido, string>;
const moeda = (valor: number) =>
  (valor / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const data = (valor: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(valor));
const modalidade = (p: PedidoPdv) =>
  p.venda.modalidade === "ENTREGA"
    ? "Entrega"
    : p.venda.modalidade === "BALCAO"
      ? "Balcão"
      : "Retirada";
const identificacao = (p: PedidoPdv) => `#${p.origem?.numero ?? p.numero}`;
const VISOES: { valor: VisaoPedidos; nome: string }[] = [
  { valor: "TODOS", nome: "Todos" },
  { valor: "EM_ANDAMENTO", nome: "Em andamento" },
  { valor: "AGENDADOS", nome: "Agendados" },
  { valor: "RETIRADA", nome: "Retiradas" },
  { valor: "ENTREGA", nome: "Entregas" },
  { valor: "BALCAO", nome: "Balcão" },
];
function etapaPedido(p: PedidoPdv) {
  if (p.status === "ENTREGUE" && p.venda.status === "CONCLUIDA")
    return "Concluído";
  if (p.status === "AGUARDANDO_COLETA")
    return p.venda.modalidade === "ENTREGA"
      ? "Aguardando motoboy"
      : p.venda.modalidade === "BALCAO"
        ? "Pronto no balcão"
        : "Esperando retirada";
  return nomes[p.status];
}
function proximo(p: PedidoPdv): { status: DestinoPedido; nome: string } | null {
  if (p.origem) return null;
  if (p.status === "COZINHA")
    return { status: "AGUARDANDO_COLETA", nome: "Pedido pronto" };
  if (p.status === "AGUARDANDO_COLETA")
    return p.venda.modalidade === "ENTREGA"
      ? { status: "SAIU_ENTREGA", nome: "Saiu para entrega" }
      : { status: "ENTREGUE", nome: "Confirmar retirada" };
  if (p.status === "SAIU_ENTREGA")
    return { status: "ENTREGUE", nome: "Confirmar entrega" };
  return null;
}
function tempo(p: PedidoPdv, agora: string) {
  if (p.status === "ENTREGUE" || p.status === "CANCELADO")
    return new Intl.DateTimeFormat("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "America/Sao_Paulo",
    }).format(new Date(p.atualizadoEm));
  const minutos = Math.max(
    0,
    Math.floor(
      (new Date(agora).getTime() -
        new Date(p.preparoIniciadoEm ?? p.criadoEm).getTime()) /
        60_000,
    ),
  );
  return minutos >= 60
    ? `${Math.floor(minutos / 60)}h ${minutos % 60}min`
    : `${minutos} min`;
}

export function GestaoPedidos({
  inicial,
  unidade,
  preferenciasId,
  podeVender,
  podeOperar,
  podeCancelar,
  podeEntrega,
  entregadores,
  novaVenda,
  instante,
}: {
  inicial: QuadroPedidos;
  unidade: string;
  preferenciasId: string;
  podeVender: boolean;
  podeOperar: boolean;
  podeCancelar: boolean;
  podeEntrega: boolean;
  entregadores: { id: string; nome: string }[];
  novaVenda?: string;
  instante: string;
}) {
  const router = useRouter();
  const ambienteProprio = useAmbienteProprio();
  const buscaRef = useRef<HTMLInputElement>(null);
  const layoutRef = useRef<HTMLDetailsElement>(null);
  const filtrosRef = useRef<HTMLDetailsElement>(null);
  const [quadro, setQuadro] = useState(inicial);
  const [busca, setBusca] = useState("");
  const [layout, setLayout] = useLayoutPedidos(preferenciasId);
  const { modo: modoLayout, distribuicao, visiveis } = layout;
  const setModoLayout = (modo: "LISTAS" | "KANBAN") =>
    setLayout((l) => ({ ...l, modo }));
  const [selecionadoId, setSelecionadoId] = useState<string | null>(
    () => inicial.pedidos.find((p) => p.vendaId === novaVenda)?.id ?? null,
  );
  const [erro, setErro] = useState("");
  const [erroAtualizacao, setErroAtualizacao] = useState("");
  const [aviso, setAviso] = useState("");
  const [atualizando, setAtualizando] = useState(false);
  const [mutando, setMutando] = useState(false);
  useEffect(() => {
    function fecharLayout(evento: PointerEvent) {
      for (const ref of [layoutRef, filtrosRef]) {
        if (
          ref.current?.open &&
          evento.target instanceof Node &&
          !ref.current.contains(evento.target)
        )
          ref.current.open = false;
      }
    }
    function atalhos(evento: KeyboardEvent) {
      const aberto = [layoutRef, filtrosRef].find(
        (ref) => ref.current?.open,
      )?.current;
      if (evento.key === "Escape" && aberto) {
        aberto.open = false;
        aberto.querySelector("summary")?.focus();
        evento.preventDefault();
        return;
      }
      if (mutando || document.querySelector("dialog[open]")) return;
      const editando =
        evento.target instanceof Element &&
        evento.target.closest(
          'input, textarea, select, [contenteditable="true"]',
        );
      if (
        evento.key === "/" &&
        !editando &&
        !evento.ctrlKey &&
        !evento.metaKey &&
        !evento.altKey
      ) {
        evento.preventDefault();
        buscaRef.current?.focus();
      }
      if (evento.key === "Escape" && !editando) setSelecionadoId(null);
    }
    document.addEventListener("pointerdown", fecharLayout);
    document.addEventListener("keydown", atalhos);
    return () => {
      document.removeEventListener("pointerdown", fecharLayout);
      document.removeEventListener("keydown", atalhos);
    };
  }, [mutando]);
  const [agora, setAgora] = useState(instante);
  const [ultima, setUltima] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [destinoDrag, setDestinoDrag] = useState<StatusPedido | null>(null);
  const [compacto, setCompacto] = useState(false);
  const [cancelando, setCancelando] = useState<PedidoPdv | null>(null);
  const [recebendoId, setRecebendoId] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");
  const [erroCancelamento, setErroCancelamento] = useState("");
  const lendo = useRef(false);
  const alterando = useRef(false);
  const montado = useRef(true);
  const epoca = useRef(0);
  const reler = useRef(false);
  const atualizarDepois = useRef<(manual?: boolean) => Promise<void>>(
    async () => {},
  );
  const dia = inicial.dia;
  const selecionado =
    quadro.pedidos.find((p) => p.id === selecionadoId) ?? null;
  const filtro = busca.trim().toLocaleLowerCase("pt-BR");
  const filtrados = quadro.pedidos.filter((p) =>
    `${identificacao(p)} ${p.numero} ${p.origem?.nome ?? "Tetteo"} ${p.origem?.numero ?? ""} ${p.venda.cliente ?? ""} ${p.entrega?.destinatario ?? ""} ${p.origem?.entrega?.destinatario ?? ""} ${p.entregadorNome ?? ""}`
      .toLocaleLowerCase("pt-BR")
      .includes(filtro),
  );

  const atualizar = useCallback(
    async (manual = false): Promise<void> => {
      if (lendo.current || alterando.current) {
        reler.current = true;
        return;
      }
      reler.current = false;
      lendo.current = true;
      const epocaLeitura = epoca.current;
      if (manual) setAtualizando(true);
      try {
        const resposta = await listarPedidosAcao({ dia, visao: inicial.visao });
        if (!montado.current || epocaLeitura !== epoca.current) return;
        if (resposta.erro || !resposta.quadro) {
          setErroAtualizacao(
            resposta.erro ?? "Não foi possível atualizar os pedidos.",
          );
          return;
        }
        setQuadro(resposta.quadro);
        setErroAtualizacao("");
        setAgora(new Date().toISOString());
        setUltima(new Date().toISOString());
      } catch {
        if (montado.current)
          setErroAtualizacao(
            "Sem atualização do quadro. Verifique a conexão e tente novamente.",
          );
      } finally {
        lendo.current = false;
        if (montado.current) setAtualizando(false);
        if (reler.current && montado.current && !alterando.current) {
          reler.current = false;
          window.setTimeout(() => void atualizarDepois.current(), 0);
        }
      }
    },
    [dia, inicial.visao],
  );
  useEffect(() => {
    montado.current = true;
    atualizarDepois.current = atualizar;
    const media = window.matchMedia("(max-width:1100px)");
    const medir = () => setCompacto(media.matches);
    medir();
    media.addEventListener("change", medir);
    const tick = () => {
      if (!document.hidden) void atualizar();
    };
    const timer = window.setInterval(tick, 15_000);
    window.addEventListener("focus", tick);
    return () => {
      montado.current = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", tick);
      media.removeEventListener("change", medir);
    };
  }, [atualizar]);

  function aplicarPedido(pedido: PedidoPdv) {
    setQuadro((q) => {
      const antes = q.pedidos.find((p) => p.id === pedido.id);
      const totais = { ...q.totais };
      if (antes && antes.status !== pedido.status) {
        totais[antes.status] = Math.max(0, totais[antes.status] - 1);
        totais[pedido.status]++;
      }
      return {
        ...q,
        totais,
        pedidos: q.pedidos.map((p) => (p.id === pedido.id ? pedido : p)),
      };
    });
  }
  async function mover(p: PedidoPdv, destino: StatusPedido) {
    if (p.origem) return;
    if (alterando.current || p.status === destino) return;
    if (destino === "CANCELADO") {
      if (podeCancelar) {
        setCancelando(p);
        setMotivo("");
        setErroCancelamento("");
      }
      return;
    }
    if (!podeOperar || proximo(p)?.status !== destino) {
      setErro("Selecione a próxima etapa disponível no detalhe do pedido.");
      return;
    }
    alterando.current = true;
    epoca.current++;
    setMutando(true);
    setErro("");
    setAviso("");
    try {
      const resposta = await moverPedidoAcao({
        pedidoId: p.id,
        versao: p.versao,
        destino,
      });
      if (resposta.erro || !resposta.pedido) {
        setErro(resposta.erro ?? "Não foi possível mudar a etapa.");
        return;
      }
      aplicarPedido(resposta.pedido);
      setAviso(`Pedido ${identificacao(p)}: ${nomes[destino]}.`);
    } catch {
      setErro(
        "A confirmação da mudança não chegou. Atualize o quadro antes de tentar novamente.",
      );
    } finally {
      alterando.current = false;
      setMutando(false);
      void atualizar();
    }
  }
  async function cancelar() {
    if (
      !cancelando?.vendaId ||
      cancelando.origem ||
      alterando.current ||
      motivo.trim().length < 3
    )
      return;
    alterando.current = true;
    epoca.current++;
    setMutando(true);
    setErroCancelamento("");
    try {
      const resposta = await cancelarVendaAcao({
        vendaId: cancelando.vendaId,
        motivo: motivo.trim(),
        pedidoId: cancelando.id,
        versaoPedido: cancelando.versao,
        versaoFinanceira: cancelando.venda.versaoFinanceira ?? 1,
      });
      if (resposta.erro) {
        setErroCancelamento(resposta.erro);
        return;
      }
      setCancelando(null);
      setAviso(resposta.ok ?? "Pedido cancelado.");
    } catch {
      setErroCancelamento(
        "Não foi possível confirmar o cancelamento. Consulte o quadro antes de repetir a operação.",
      );
    } finally {
      alterando.current = false;
      setMutando(false);
      void atualizar();
    }
  }
  async function atribuir(p: PedidoPdv, entregadorId: string | null) {
    if (alterando.current || !podeEntrega) return;
    alterando.current = true;
    epoca.current++;
    setMutando(true);
    setErro("");
    try {
      const resposta = await atribuirEntregadorAcao({
        pedidoId: p.id,
        versaoPedido: p.versao,
        entregadorId,
      });
      if (resposta.erro) {
        setErro(resposta.erro);
        return;
      }
      setAviso(resposta.ok ?? "Entregador atualizado.");
    } catch {
      setErro(
        "A confirmação da atribuição não chegou. Atualize o quadro para conferir antes de repetir.",
      );
    } finally {
      alterando.current = false;
      setMutando(false);
      void atualizar();
    }
  }
  function abrirRecebimento(vendaId: string) {
    if (!podeVender || alterando.current) return;
    alterando.current = true;
    epoca.current++;
    setMutando(true);
    setRecebendoId(vendaId);
  }
  function fecharRecebimento() {
    setRecebendoId(null);
    alterando.current = false;
    setMutando(false);
    void atualizar();
  }

  const ocuparAgendamento = useCallback((ocupado: boolean) => {
    alterando.current = ocupado;
    epoca.current++;
    setMutando(ocupado);
    if (!ocupado) void atualizarDepois.current();
  }, []);
  const confirmarAgendamento = useCallback(() => {
    setAviso("Programação do pedido atualizada.");
  }, []);
  return (
    <div
      className={styles.pagina}
      data-ambiente={ambienteProprio ? "proprio" : "integrado"}
    >
      <header className={ambienteProprio ? "sr-only" : styles.topo}>
        <div>
          <h1>Gestão de pedidos</h1>
          <p>{unidade} · agendados, retiradas, balcão e entregas</p>
        </div>
        {!ambienteProprio && (
          <Link
            href="/pdv/caixa"
            className={estiloDeBotao("fantasma", "pequeno")}
          >
            Caixa
          </Link>
        )}
      </header>
      <div className={styles.toolbar}>
        <div className={styles.busca}>
          <label htmlFor="busca-pedidos" className="sr-only">
            Buscar pedido
          </label>
          <Icone nome="lupa" tamanho={18} />
          <input
            ref={buscaRef}
            id="busca-pedidos"
            type="search"
            placeholder="Pesquise por cliente ou número do pedido"
            value={busca}
            disabled={mutando}
            aria-keyshortcuts="/"
            onChange={(e) => {
              setBusca(e.target.value);
              setSelecionadoId(null);
            }}
          />
          <kbd aria-hidden="true">/</kbd>
        </div>
        {podeVender && (
          <Link
            href="/pdv/novo-pedido"
            className={`${estiloDeBotao("primario")} ${styles.novoPedido}`}
          >
            <Icone nome="mais" tamanho={17} /> Novo pedido
          </Link>
        )}
        <div className={styles.acoesToolbar}>
          <details className={styles.filtros} ref={filtrosRef}>
            <summary aria-label="Filtrar pedidos" title="Filtrar pedidos">
              <Icone nome="filtro" tamanho={18} />
              {quadro.visao !== "TODOS" && (
                <span
                  className={styles.filtroAtivo}
                  aria-label="Filtro ativo"
                />
              )}
            </summary>
            <div className={styles.painelFiltros}>
              <h2>Filtrar pedidos</h2>
              <nav className={styles.filtrosVisao} aria-label="Filtrar pedidos">
                {VISOES.map((v) => (
                  <button
                    type="button"
                    key={v.valor}
                    aria-pressed={quadro.visao === v.valor}
                    disabled={mutando}
                    onClick={() => {
                      const params = new URLSearchParams(
                        window.location.search,
                      );
                      params.set("visao", v.valor);
                      params.set("dia", dia);
                      router.replace(`/pdv?${params}`);
                    }}
                  >
                    {v.nome}
                    <span>{quadro.totaisVisao[v.valor]}</span>
                  </button>
                ))}
              </nav>
              <div className={styles.linhaAtualizacao}>
                <p title="Pedidos em andamento e entregues com pagamento pendente continuam visíveis, mesmo quando iniciados em outro dia.">
                  <Icone nome="relogio" tamanho={14} /> Em andamento +
                  finalizados do dia
                </p>
                <p>
                  {ultima
                    ? `Atualizado às ${new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "America/Sao_Paulo" }).format(new Date(ultima))}`
                    : "Atualização automática a cada 15 segundos"}
                </p>
              </div>
              <div className={styles.dataAtualizacao}>
                <span>Finalizados em</span>{" "}
                <div className={styles.dia}>
                  <label htmlFor="dia-pedidos" className="sr-only">
                    Entregues/cancelados em
                  </label>
                  <input
                    id="dia-pedidos"
                    type="date"
                    value={dia}
                    title="Data dos pedidos entregues e cancelados. Pedidos em andamento continuam visíveis."
                    disabled={mutando}
                    onChange={(e) => {
                      if (e.target.value) {
                        const params = new URLSearchParams(
                          window.location.search,
                        );
                        params.set("dia", e.target.value);
                        params.set("visao", quadro.visao);
                        router.replace(`/pdv?${params}`);
                      }
                    }}
                  />
                </div>
                <Botao
                  peso="secundario"
                  className={styles.botaoAtualizar}
                  aria-label="Atualizar pedidos"
                  title="Atualizar pedidos"
                  carregando={atualizando}
                  disabled={mutando}
                  onClick={() => void atualizar(true)}
                >
                  <Icone nome="atualizar" tamanho={17} />
                </Botao>
              </div>
            </div>
          </details>
          <Link
            href={`/pdv?dia=${dia}&visao=ENTREGA`}
            className={styles.gestaoEntregas}
          >
            <Icone nome="entrega" tamanho={18} />
            Gestão de entregas
          </Link>
          <details className={styles.layout} ref={layoutRef}>
            <summary title="Ajustar layout" aria-label="Ajustar layout">
              <Icone nome="colunas" tamanho={17} />
              <span>Ajustar layout</span>
            </summary>
            <fieldset className={styles.opcoes}>
              <legend className="sr-only">Organização dos pedidos</legend>
              <label>
                <input
                  type="radio"
                  name="modo-gestao"
                  checked={modoLayout === "LISTAS"}
                  onChange={() => setModoLayout("LISTAS")}
                />
                Listas compactas
              </label>
              <label>
                <input
                  type="radio"
                  name="modo-gestao"
                  checked={modoLayout === "KANBAN"}
                  onChange={() => setModoLayout("KANBAN")}
                />
                Kanban
              </label>
              <div className={styles.configEstados}>
                {COLUNAS.map((c) =>
                  modoLayout === "LISTAS" ? (
                    <div key={c.status} className={styles.posicaoEstado}>
                      <span>{c.nome}</span>
                      <div role="group" aria-label={`Posição de ${c.nome}`}>
                        {(["1", "2", "OCULTO"] as const).map((posicao) => (
                          <button
                            key={posicao}
                            type="button"
                            aria-label={`${posicao === "OCULTO" ? "Ocultar" : `Lista ${posicao}:`} ${c.nome}`}
                            aria-pressed={distribuicao[c.status] === posicao}
                            disabled={
                              posicao === "OCULTO" &&
                              !(
                                ESTADOS_OCULTAVEIS as readonly string[]
                              ).includes(c.status)
                            }
                            onClick={() =>
                              setLayout((l) => ({
                                ...l,
                                distribuicao: {
                                  ...l.distribuicao,
                                  [c.status]: posicao,
                                },
                              }))
                            }
                          >
                            {posicao === "OCULTO" ? (
                              <Icone nome="olho" tamanho={15} />
                            ) : (
                              posicao
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <label key={c.status}>
                      <input
                        type="checkbox"
                        checked={visiveis.includes(c.status)}
                        disabled={
                          !(ESTADOS_OCULTAVEIS as readonly string[]).includes(
                            c.status,
                          )
                        }
                        onChange={(e) =>
                          setLayout((l) => ({
                            ...l,
                            visiveis: e.target.checked
                              ? [...l.visiveis, c.status]
                              : l.visiveis.filter((s) => s !== c.status),
                          }))
                        }
                      />
                      {c.nome}
                    </label>
                  ),
                )}
              </div>
              <button
                type="button"
                className={styles.restaurarLayout}
                onClick={() => setLayout(() => LAYOUT_PEDIDOS_PADRAO)}
              >
                Restaurar padrão
              </button>
            </fieldset>
          </details>
        </div>
      </div>
      {erroAtualizacao && (
        <p role="alert" className={`${styles.aviso} ${styles.erro}`}>
          {erroAtualizacao}
        </p>
      )}
      {erro && (
        <p role="alert" className={`${styles.aviso} ${styles.erro}`}>
          {erro}
        </p>
      )}
      {aviso && (
        <p role="status" className={styles.aviso}>
          {aviso}
        </p>
      )}
      {quadro.truncado && (
        <p className={styles.aviso}>
          Mostrando {quadro.ativosExibidos} de {quadro.ativosTotal} pedidos
          ativos e {quadro.finalizadosExibidos} de {quadro.finalizadosTotal}{" "}
          finalizados do período ou entregues com pagamento pendente. Consulte
          também o histórico de vendas.
        </p>
      )}
      <p id="ajuda-quadro" className="sr-only">
        Selecione um cartão para ver o pedido e avançar sua etapa. No
        computador, também é possível arrastar o cartão para a próxima coluna.
        Cancelar exige justificativa.
      </p>
      <div
        className={styles.workspace}
        data-modo={modoLayout}
        data-selecionado={!!selecionado}
      >
        {modoLayout === "LISTAS" ? (
          <section className={styles.listas} aria-label="Listas de pedidos">
            {(["1", "2"] as const).map((lista) => {
              const pedidos = filtrados.filter(
                (p) => distribuicao[p.status] === lista,
              );
              const total = COLUNAS.filter(
                (c) => distribuicao[c.status] === lista,
              ).reduce((n, c) => n + quadro.totais[c.status], 0);
              return (
                <section
                  key={lista}
                  className={styles.listaMista}
                  aria-label={`Lista ${lista}`}
                >
                  <header className="sr-only">
                    <h2>Lista {lista}</h2>
                    <span>
                      {filtro ? `${pedidos.length}/` : ""}
                      {total}
                    </span>
                  </header>
                  <div className={styles.linhasPedidos}>
                    {!pedidos.length && (
                      <p className={styles.vazio}>
                        {filtro
                          ? "Nenhum pedido encontrado."
                          : "Seus pedidos aparecerão aqui"}
                      </p>
                    )}
                    {pedidos.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className={styles.cardLinha}
                        data-status={p.status}
                        aria-pressed={selecionadoId === p.id}
                        disabled={mutando}
                        onClick={() => setSelecionadoId(p.id)}
                        aria-label={`Pedido ${identificacao(p)}, ${p.origem ? `${p.origem.nome} pedido ${p.origem.numero}, ` : "Tetteo, "}${modalidade(p)}, ${etapaPedido(p)}, ${p.venda.cliente ?? "Cliente não identificado"}, ${moeda(p.venda.totalCentavos)}`}
                      >
                        <span
                          className={styles.iconeModalidade}
                          title={modalidade(p)}
                        >
                          <Icone
                            nome={
                              p.venda.modalidade === "ENTREGA"
                                ? "entrega"
                                : "pessoa"
                            }
                            tamanho={17}
                          />
                          <span className="sr-only">{modalidade(p)}</span>
                        </span>
                        <span className={styles.nomeLinha}>
                          <span className={styles.identidadeLinha}>
                            <strong
                              title={
                                p.venda.cliente ?? "Cliente não identificado"
                              }
                            >
                              {p.venda.cliente ?? "Cliente não identificado"}
                            </strong>
                            <span className={styles.numero}>
                              {identificacao(p)}
                            </span>
                          </span>
                          <span className={styles.resumoLinha}>
                            <strong className={styles.valorLinha}>
                              {moeda(p.venda.totalCentavos)}
                            </strong>
                            <span className="sr-only">{modalidade(p)}</span>
                          </span>
                        </span>
                        <span className={styles.situacaoLinha}>
                          <span className={styles.tempo}>
                            {p.status === "AGENDADO" ? "—" : tempo(p, agora)}
                          </span>
                          <span
                            className={styles.statusLinha}
                            data-status={p.status}
                          >
                            {etapaPedido(p)}
                          </span>
                        </span>
                        <span
                          className={styles.financeiroLinha}
                          data-financeiro={p.venda.status}
                          data-excecao={
                            p.venda.status === "PENDENTE" ||
                            (p.venda.status === "CANCELADA" &&
                              p.venda.pagamentos.length > 0)
                          }
                          title={
                            p.origem
                              ? "Pagamento gerenciado na origem"
                              : p.venda.status === "PENDENTE"
                                ? "Aguardando pagamento"
                                : p.venda.status === "CANCELADA"
                                  ? "Cancelado"
                                  : "Pagamento registrado"
                          }
                        >
                          <EtiquetaPagamento venda={p.venda} />
                        </span>
                        {p.origem && (
                          <span className={styles.origemLinha}>
                            <EtiquetaOrigemPedido origem={p.origem} />
                          </span>
                        )}
                        {p.status === "AGENDADO" && p.agendadoPara && (
                          <span className={styles.horariosLinha}>
                            Para {data(p.agendadoPara)}
                            {p.iniciarPreparoEm
                              ? ` · Preparo ${data(p.iniciarPreparoEm)}`
                              : ""}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </section>
              );
            })}
          </section>
        ) : (
          <section
            className={styles.quadro}
            aria-label="Quadro de pedidos"
            aria-describedby="ajuda-quadro"
          >
            {COLUNAS.filter((c) => visiveis.includes(c.status)).map((c) => {
              const pedidos = filtrados.filter((p) => p.status === c.status);
              const pDrag = quadro.pedidos.find((p) => p.id === arrastando);
              const aceita =
                !!pDrag &&
                !pDrag.origem &&
                ((c.status === "CANCELADO" && podeCancelar) ||
                  (podeOperar && proximo(pDrag)?.status === c.status));
              return (
                <section
                  key={c.status}
                  className={`${styles.coluna} ${c.classe}`}
                  aria-label={c.nome}
                  data-destino={destinoDrag === c.status && aceita}
                  onDragOver={(e) => {
                    if (aceita) {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      setDestinoDrag(c.status);
                    }
                  }}
                  onDragLeave={(e) => {
                    if (
                      !(e.relatedTarget instanceof Node) ||
                      !e.currentTarget.contains(e.relatedTarget)
                    )
                      setDestinoDrag(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDestinoDrag(null);
                    setArrastando(null);
                    if (aceita && pDrag) void mover(pDrag, c.status);
                  }}
                >
                  <header className={styles.cabecalhoColuna}>
                    <span className={styles.marcador} aria-hidden="true" />
                    <h2>{c.nome}</h2>
                    <span
                      className={styles.contador}
                      aria-label={`${quadro.totais[c.status]} pedidos`}
                    >
                      {filtro ? `${pedidos.length}/` : ""}
                      {quadro.totais[c.status]}
                    </span>
                  </header>
                  <div className={styles.lista}>
                    {!pedidos.length && (
                      <p className={styles.vazio}>
                        {filtro
                          ? "Nenhum pedido encontrado nesta coluna."
                          : c.vazio}
                      </p>
                    )}
                    {pedidos.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className={styles.card}
                        aria-label={`Pedido ${identificacao(p)}, ${p.origem ? `${p.origem.nome} pedido ${p.origem.numero}, ` : "Tetteo, "}${p.venda.cliente ?? "Cliente não identificado"}, ${moeda(p.venda.totalCentavos)}${p.venda.status === "PENDENTE" ? ", aguardando pagamento" : ""}`}
                        aria-pressed={selecionadoId === p.id}
                        draggable={podeOperar && !mutando && !!proximo(p)}
                        onDragStart={(e) => {
                          e.dataTransfer.setData("text/plain", p.id);
                          e.dataTransfer.effectAllowed = "move";
                          setArrastando(p.id);
                        }}
                        onDragEnd={() => {
                          setArrastando(null);
                          setDestinoDrag(null);
                        }}
                        onClick={() => setSelecionadoId(p.id)}
                      >
                        <span className={styles.linha}>
                          <span className={styles.numero}>
                            {identificacao(p)}
                          </span>
                          <time
                            className={styles.tempo}
                            dateTime={p.preparoIniciadoEm ?? p.criadoEm}
                          >
                            {tempo(p, agora)}
                          </time>
                        </span>
                        {p.origem && <EtiquetaOrigemPedido origem={p.origem} />}
                        <span className={styles.cliente}>
                          {p.venda.cliente ?? "Cliente não identificado"}
                        </span>
                        <span
                          className={styles.statusLinha}
                          data-status={p.status}
                        >
                          {etapaPedido(p)}
                        </span>
                        <EtiquetaPagamento venda={p.venda} />
                        {p.origem && <small>{p.origem.situacao}</small>}
                        {p.agendadoPara && (
                          <small className="text-accent">
                            Agendado para {data(p.agendadoPara)}
                            {p.status === "AGENDADO" && p.iniciarPreparoEm
                              ? ` · Preparo ${data(p.iniciarPreparoEm)}`
                              : ""}
                            {!["ENTREGUE", "CANCELADO"].includes(p.status) &&
                            p.agendadoPara < agora
                              ? " · Atrasado"
                              : ""}
                          </small>
                        )}
                        {p.status === "ENTREGUE" &&
                          p.venda.status === "PENDENTE" &&
                          p.entregueEm && (
                            <small>Entregue em {data(p.entregueEm)}</small>
                          )}

                        <span className={styles.rodapeCard}>
                          <span>
                            {modalidade(p)} ·{" "}
                            {p.venda.itens.reduce(
                              (s, i) => s + i.quantidade,
                              0,
                            )}{" "}
                            itens
                          </span>
                          <strong>{moeda(p.venda.totalCentavos)}</strong>
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              );
            })}
          </section>
        )}
        <aside className={styles.detalhe} aria-label="Detalhes do pedido">
          {selecionado ? (
            <DetalhesPedido
              aoOcupar={ocuparAgendamento}
              aoConfirmarAgendamento={confirmarAgendamento}
              pedido={selecionado}
              podeOperar={podeOperar}
              podeCancelar={podeCancelar}
              podeReceber={podeVender}
              aoReceber={abrirRecebimento}
              podeEntrega={podeEntrega}
              entregadores={entregadores}
              aoAtribuir={atribuir}
              pendente={mutando}
              aoMover={mover}
              aoFechar={() => setSelecionadoId(null)}
            />
          ) : (
            <div className={styles.semSelecao}>
              <Icone nome="caixa-aberta" tamanho={96} />
              <h2>Nenhum pedido selecionado</h2>
              <p className="sr-only">
                Selecione um cartão para acompanhar o pedido.
              </p>
            </div>
          )}
        </aside>
      </div>
      <PainelLateral
        aberto={compacto && !!selecionado && !cancelando && !recebendoId}
        aoFechar={() => setSelecionadoId(null)}
        podeFechar={() => !mutando}
        titulo={
          selecionado
            ? `Pedido Nº ${selecionado.origem?.numero ?? selecionado.numero}`
            : "Pedido"
        }
      >
        {selecionado && (
          <DetalhesPedido
            emPainel
            aoOcupar={ocuparAgendamento}
            aoConfirmarAgendamento={confirmarAgendamento}
            pedido={selecionado}
            podeOperar={podeOperar}
            podeCancelar={podeCancelar}
            podeReceber={podeVender}
            aoReceber={abrirRecebimento}
            podeEntrega={podeEntrega}
            entregadores={entregadores}
            aoAtribuir={atribuir}
            pendente={mutando}
            aoMover={mover}
          />
        )}
      </PainelLateral>
      <PainelLateral
        aberto={!!cancelando}
        aoFechar={() => setCancelando(null)}
        podeFechar={() => !mutando}
        titulo={
          cancelando
            ? `Cancelar pedido ${identificacao(cancelando)}`
            : "Cancelar pedido"
        }
        apoio="Cancelamento integral da venda, com estorno do consumo registrado."
        rodape={
          <Botao
            peso="destrutivo"
            className="w-full"
            carregando={mutando}
            disabled={motivo.trim().length < 3}
            onClick={() => void cancelar()}
          >
            Confirmar cancelamento
          </Botao>
        }
      >
        <div className="space-y-4">
          <p className="text-ink-2 text-sm">
            O histórico será preservado.{" "}
            {cancelando?.venda.pagamentos.length
              ? "A devolução do pagamento ao cliente é manual."
              : "Nenhum pagamento foi registrado; não haverá devolução de dinheiro."}{" "}
            Se os ingredientes já foram consumidos, registre a perda
            correspondente no Estoque.
          </p>
          <Campo
            rotulo="Motivo do cancelamento"
            value={motivo}
            maxLength={300}
            disabled={mutando}
            onChange={(e) => setMotivo(e.target.value)}
          />
          {erroCancelamento && (
            <p
              role="alert"
              className="bg-bad-sub text-bad rounded-lg p-3 text-sm"
            >
              {erroCancelamento}
            </p>
          )}
        </div>
      </PainelLateral>
      {recebendoId && (
        <ReceberPedido
          key={recebendoId}
          vendaId={recebendoId}
          aoFechar={fecharRecebimento}
          aoReceber={() =>
            setAviso(
              "Pagamento registrado no caixa. O estoque não foi movimentado novamente.",
            )
          }
        />
      )}
    </div>
  );
}

function DetalhesPedido({
  emPainel = false,
  pedido: p,
  aoOcupar,
  aoConfirmarAgendamento,
  podeOperar,
  podeCancelar,
  podeReceber,
  aoReceber,
  podeEntrega,
  entregadores,
  aoAtribuir,
  pendente,
  aoMover,
  aoFechar,
}: {
  emPainel?: boolean;
  pedido: PedidoPdv;
  aoOcupar: (ocupado: boolean) => void;
  aoConfirmarAgendamento: () => void;
  podeOperar: boolean;
  podeCancelar: boolean;
  podeReceber: boolean;
  aoReceber: (vendaId: string) => void;
  podeEntrega: boolean;
  entregadores: { id: string; nome: string }[];
  aoAtribuir: (p: PedidoPdv, entregadorId: string | null) => Promise<void>;
  pendente: boolean;
  aoMover: (p: PedidoPdv, destino: StatusPedido) => Promise<void>;
  aoFechar?: () => void;
}) {
  const seguinte = proximo(p);
  return (
    <div className={styles.detalheConteudo}>
      <header
        className={`${styles.detalheTopo} ${emPainel ? styles.detalheNoPainel : ""}`}
      >
        {!emPainel && (
          <span className={styles.iconeDetalhe} aria-hidden="true">
            <Icone
              nome={p.venda.modalidade === "ENTREGA" ? "entrega" : "pessoa"}
              tamanho={22}
            />
          </span>
        )}
        <div className={styles.tituloDetalhe}>
          {!emPainel && <h2>Pedido Nº {p.origem?.numero ?? p.numero}</h2>}
          <p>
            {data(p.criadoEm)} · {modalidade(p)}
          </p>
        </div>
        <div className={styles.acoesCabecalho}>
          {p.vendaId && <BotoesImpressao vendaId={p.vendaId} compacto />}
          {aoFechar && (
            <button
              type="button"
              aria-label="Fechar pedido selecionado"
              className={styles.fechar}
              onClick={aoFechar}
            >
              <Icone nome="fechar" tamanho={18} />
            </button>
          )}
        </div>
      </header>
      <div className={styles.faixaEtapa} data-status={p.status}>
        {etapaPedido(p)}
      </div>
      <div
        className={styles.corpoDetalhe}
        tabIndex={0}
        role="region"
        aria-label={`Resumo do pedido ${identificacao(p)}`}
      >
        <div className={styles.metadadosPedido}>
          <span>{modalidade(p)}</span>
          <EtiquetaOrigemPedido origem={p.origem} />
        </div>
        {p.origem && (
          <p className="text-ink-3 text-xs">
            {p.origem.situacao} · atualizado pela {p.origem.nome} em{" "}
            {data(p.origem.atualizadoEm)}. Canal: {p.origem.canal}.
          </p>
        )}
        {p.agendadoPara && (
          <p className="border-line rounded-md border p-3 text-sm">
            Agendado para <strong>{data(p.agendadoPara)}</strong>
            {!p.preparoIniciadoEm && p.iniciarPreparoEm && (
              <span className="text-ink-3 mt-1 block">
                Preparo previsto para {data(p.iniciarPreparoEm)}.
              </span>
            )}
            {p.preparoIniciadoEm && (
              <span className="text-ink-3 mt-1 block">
                Preparo iniciado em {data(p.preparoIniciadoEm)}.
              </span>
            )}
          </p>
        )}
        <section className={styles.secao}>
          <h3>
            <Icone nome="pessoa" tamanho={18} /> Cliente
          </h3>
          <p>{p.venda.cliente ?? "Não identificado"}</p>
        </section>
        {p.venda.modalidade === "ENTREGA" && (
          <section className={styles.secao}>
            <h3>
              <Icone nome="entrega" tamanho={18} /> Entrega
            </h3>
            {p.origem ? (
              <EntregaOrigemPedido
                origem={p.origem}
                podeEntrega={podeEntrega}
              />
            ) : p.entrega ? (
              <>
                <p>
                  <strong>{p.entrega.destinatario}</strong>
                </p>
                {p.entrega.telefone && <p>Telefone: {p.entrega.telefone}</p>}
                <p>
                  {p.entrega.endereco.logradouro}, {p.entrega.endereco.numero}
                </p>
                {p.entrega.endereco.complemento && (
                  <p>{p.entrega.endereco.complemento}</p>
                )}
                <p>
                  {p.entrega.endereco.bairro} · {p.entrega.endereco.cidade}/
                  {p.entrega.endereco.uf}
                </p>
                {p.entrega.endereco.cep && <p>CEP: {p.entrega.endereco.cep}</p>}
                {p.entrega.endereco.referencia && (
                  <p>Referência: {p.entrega.endereco.referencia}</p>
                )}
                <p>
                  {p.entrega.areaNome ?? "Frete manual"} ·{" "}
                  {moeda(p.venda.freteCentavos ?? 0)}
                </p>
                <p>
                  Previsão: {data(p.entrega.previstoEm)} ·{" "}
                  {p.entrega.prazoMinutos} min
                </p>
              </>
            ) : (
              <p>
                {!podeEntrega
                  ? "Seu perfil precisa de permissão de entrega para consultar o endereço."
                  : p.temEnderecoEntrega
                    ? "Dados da entrega indisponíveis. Consulte o responsável pela operação."
                    : "Pedido anterior ao cadastro de endereços. Confira a entrega com o responsável."}
              </p>
            )}
            {!p.origem &&
            podeEntrega &&
            (p.status === "COZINHA" || p.status === "AGUARDANDO_COLETA") ? (
              <label className="text-ink-2 mt-3 block text-sm font-semibold">
                Entregador
                <select
                  className="border-line-2 bg-surface text-ink mt-1 h-10 w-full rounded-md border px-2 font-normal"
                  value={p.entregadorId ?? ""}
                  disabled={pendente}
                  onChange={(e) => void aoAtribuir(p, e.target.value || null)}
                >
                  <option value="">Sem entregador</option>
                  {p.entregadorId &&
                    !entregadores.some((e) => e.id === p.entregadorId) && (
                      <option value={p.entregadorId}>
                        {p.entregadorNome} (indisponível)
                      </option>
                    )}
                  {entregadores.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.nome}
                    </option>
                  ))}
                </select>
                {!entregadores.length && (
                  <Link
                    href="/pdv/entregas/entregadores"
                    className="text-accent mt-2 inline-block text-xs underline"
                  >
                    Cadastrar entregador
                  </Link>
                )}
              </label>
            ) : !p.origem ? (
              <p className="mt-3">
                Entregador: {p.entregadorNome ?? "Não atribuído"}
              </p>
            ) : null}
          </section>
        )}
        <section className={styles.secao}>
          <h3>
            <Icone nome="prato" tamanho={18} /> Itens do pedido
          </h3>
          {p.venda.itens.map((item, i) => (
            <div key={i} className={styles.item}>
              <div className={styles.linha}>
                <span className={styles.quantidadeItem}>
                  {item.quantidade}×
                </span>
                <strong className={styles.nomeItem}>{item.nome}</strong>
                <strong>{moeda(item.totalCentavos)}</strong>
              </div>
              {item.complementos.map((o, n) => (
                <small key={n}>
                  {o.grupo}: {o.nome}
                </small>
              ))}
              {item.observacao && <small>Observação: {item.observacao}</small>}
            </div>
          ))}
        </section>
        {p.venda.observacao && (
          <section className={styles.secao}>
            <h3>Observação do pedido</h3>
            <p>{p.venda.observacao}</p>
          </section>
        )}
        <section className={styles.secao}>
          <h3>
            <Icone nome="moeda" tamanho={18} /> Pagamento
          </h3>
          <EtiquetaPagamento venda={p.venda} />
          {p.origem && <PagamentosOrigemPedido origem={p.origem} />}
          {p.venda.status === "PENDENTE" && (
            <p className="mt-2">
              Valor a receber: {moeda(p.venda.totalCentavos)}.
            </p>
          )}
          {p.venda.pagamentos.map((pag, i) => (
            <p className={styles.linha} key={i}>
              <span>
                {
                  {
                    DINHEIRO: "Dinheiro",
                    PIX: "Pix",
                    CREDITO: "Crédito",
                    DEBITO: "Débito",
                  }[pag.forma]
                }
              </span>
              <span>{moeda(pag.valorCentavos)}</span>
            </p>
          ))}
          {p.venda.trocoCentavos > 0 && (
            <p className={styles.linha}>
              <span>Troco</span>
              <span>{moeda(p.venda.trocoCentavos)}</span>
            </p>
          )}
          {!p.origem && (
            <p className="mt-2 text-xs">Conferência manual do operador.</p>
          )}
          {p.venda.recebidoEm && (
            <p className="mt-2 text-xs">
              Recebido em {data(p.venda.recebidoEm)}
              {p.venda.recebidoPor ? ` por ${p.venda.recebidoPor}` : ""}.
            </p>
          )}
        </section>
        {(p.venda.freteCentavos ?? 0) > 0 && (
          <p className="text-ink-3 text-xs">
            Inclui frete de {moeda(p.venda.freteCentavos ?? 0)}.
          </p>
        )}
        {p.venda.motivoCancelamento && (
          <p className="text-bad mt-3 text-sm">
            Motivo: {p.venda.motivoCancelamento}
          </p>
        )}
        <details className={styles.historico}>
          <summary>Histórico do pedido</summary>
          <ol>
            {p.historico.map((e) => (
              <li key={e.id}>
                <strong>
                  {e.para === "AGENDADO" ? "Agendado" : nomes[e.para]}
                </strong>{" "}
                · {e.operador}
                <time dateTime={e.criadoEm}>{data(e.criadoEm)}</time>
                {e.observacao && <p>{e.observacao}</p>}
              </li>
            ))}
          </ol>
        </details>
      </div>
      <div className={styles.acoes}>
        <div className={styles.total}>
          <span>Total</span>
          <span>{moeda(p.venda.totalCentavos)}</span>
        </div>
        {!p.origem && p.status === "AGENDADO" && (
          <GerenciarAgendamento
            key={p.id}
            pedido={p}
            podeVender={podeReceber}
            podeOperar={podeOperar}
            bloqueado={pendente}
            aoOcupar={aoOcupar}
            aoConfirmar={aoConfirmarAgendamento}
          />
        )}

        {p.vendaId && p.venda.status === "PENDENTE" && podeReceber && (
          <Botao
            peso="secundario"
            disabled={pendente}
            onClick={() => aoReceber(p.vendaId!)}
          >
            Receber pagamento
          </Botao>
        )}
        {seguinte && (
          <Botao
            disabled={!podeOperar || pendente}
            carregando={pendente}
            onClick={() => void aoMover(p, seguinte.status)}
          >
            {seguinte.nome}
          </Botao>
        )}
        {!podeOperar && seguinte && (
          <p className="text-ink-3 text-xs">
            Seu perfil permite consultar. Avançar pedidos exige permissão de
            operação.
          </p>
        )}
        {!p.origem && p.status !== "CANCELADO" && podeCancelar && (
          <details className={styles.maisAcoes}>
            <summary>
              Mais ações <Icone nome="seta-baixo" tamanho={14} />
            </summary>
            <Botao
              peso="fantasma"
              disabled={pendente}
              onClick={() => void aoMover(p, "CANCELADO")}
            >
              Cancelar pedido
            </Botao>
          </details>
        )}
        {p.origem?.codigo === "CARDAPIO_WEB" && (
          <div className="space-y-2 text-sm">
            <p className="text-ink-3">
              A situação e o pagamento são atualizados pela Cardápio Web.
            </p>
            <a
              href="https://portal.cardapioweb.com/latest-orders"
              target="_blank"
              rel="noopener noreferrer"
              className={estiloDeBotao("secundario", "pequeno")}
            >
              Gerenciar na Cardápio Web
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
