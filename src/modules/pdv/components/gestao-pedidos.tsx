"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Botao, estiloDeBotao } from "@/design-system/botao";
import { Campo } from "@/design-system/campo";
import { Icone } from "@/design-system/icones";
import { PainelLateral } from "@/design-system/painel-lateral";
import { cancelarVendaAcao } from "../acoes";
import { listarPedidosAcao, moverPedidoAcao } from "../acoes-pedidos";
import type {
  DestinoPedido,
  PedidoPdv,
  QuadroPedidos,
  StatusPedido,
} from "../pedido-types";
import styles from "./gestao-pedidos.module.css";
import { BotoesImpressao } from "./botoes-impressao";

const COLUNAS: {
  status: StatusPedido;
  nome: string;
  classe: string;
  vazio: string;
}[] = [
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
const identificacao = (p: PedidoPdv) =>
  `#${p.numero.toString().padStart(4, "0")}`;
function proximo(p: PedidoPdv): { status: DestinoPedido; nome: string } | null {
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
      (new Date(agora).getTime() - new Date(p.criadoEm).getTime()) / 60_000,
    ),
  );
  return minutos >= 60
    ? `${Math.floor(minutos / 60)}h ${minutos % 60}min`
    : `${minutos} min`;
}

export function GestaoPedidos({
  inicial,
  unidade,
  podeVender,
  podeOperar,
  podeCancelar,
  novaVenda,
  instante,
}: {
  inicial: QuadroPedidos;
  unidade: string;
  podeVender: boolean;
  podeOperar: boolean;
  podeCancelar: boolean;
  novaVenda?: string;
  instante: string;
}) {
  const router = useRouter();
  const [quadro, setQuadro] = useState(inicial);
  const [busca, setBusca] = useState("");
  const [visiveis, setVisiveis] = useState<StatusPedido[]>(
    COLUNAS.map((c) => c.status),
  );
  const [selecionadoId, setSelecionadoId] = useState<string | null>(
    () => inicial.pedidos.find((p) => p.vendaId === novaVenda)?.id ?? null,
  );
  const [erro, setErro] = useState("");
  const [erroAtualizacao, setErroAtualizacao] = useState("");
  const [aviso, setAviso] = useState("");
  const [atualizando, setAtualizando] = useState(false);
  const [mutando, setMutando] = useState(false);
  const [agora, setAgora] = useState(instante);
  const [ultima, setUltima] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [destinoDrag, setDestinoDrag] = useState<StatusPedido | null>(null);
  const [compacto, setCompacto] = useState(false);
  const [cancelando, setCancelando] = useState<PedidoPdv | null>(null);
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
    `${identificacao(p)} ${p.numero} ${p.venda.cliente ?? ""}`
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
        const resposta = await listarPedidosAcao({ dia });
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
    [dia],
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
    if (!cancelando || alterando.current || motivo.trim().length < 3) return;
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

  return (
    <div className={styles.pagina}>
      <header className={styles.topo}>
        <div>
          <h1>Gestão de pedidos</h1>
          <p>{unidade} · cozinha, coleta e entregas</p>
        </div>
        <Link
          href="/pdv/caixa"
          className={estiloDeBotao("fantasma", "pequeno")}
        >
          Caixa
        </Link>
      </header>
      <div className={styles.toolbar}>
        <div className={styles.busca}>
          <label htmlFor="busca-pedidos">Buscar pedido</label>
          <input
            id="busca-pedidos"
            type="search"
            placeholder="Pesquise por cliente ou número do pedido"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
        {podeVender && (
          <Link href="/pdv/novo-pedido" className={estiloDeBotao("primario")}>
            + Novo pedido
          </Link>
        )}
        <div className={styles.dia}>
          <label htmlFor="dia-pedidos">Entregues/cancelados em</label>
          <input
            id="dia-pedidos"
            type="date"
            value={dia}
            onChange={(e) => {
              if (e.target.value)
                router.replace(
                  `/pdv?dia=${encodeURIComponent(e.target.value)}`,
                );
            }}
          />
        </div>
        <Botao
          peso="secundario"
          carregando={atualizando}
          disabled={mutando}
          onClick={() => void atualizar(true)}
        >
          Atualizar
        </Botao>
        <details className={styles.layout}>
          <summary>Ajustar layout</summary>
          <fieldset className={styles.opcoes}>
            <legend className="sr-only">Colunas visíveis</legend>
            {COLUNAS.map((c) => (
              <label key={c.status}>
                <input
                  type="checkbox"
                  checked={visiveis.includes(c.status)}
                  disabled={
                    visiveis.length === 1 && visiveis.includes(c.status)
                  }
                  onChange={(e) =>
                    setVisiveis((v) =>
                      e.target.checked
                        ? [...v, c.status]
                        : v.filter((s) => s !== c.status),
                    )
                  }
                />
                {c.nome}
              </label>
            ))}
          </fieldset>
        </details>
      </div>
      <div className={styles.linhaAtualizacao}>
        <p>
          Pedidos em andamento aparecem mesmo quando iniciados em outro dia.
        </p>
        <p>
          {ultima
            ? `Atualizado às ${new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "America/Sao_Paulo" }).format(new Date(ultima))}`
            : "Atualização automática a cada 15 segundos"}
        </p>
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
          finalizados do dia. Consulte também o histórico de vendas.
        </p>
      )}
      <p id="ajuda-quadro" className="sr-only">
        Selecione um cartão para ver o pedido e avançar sua etapa. No
        computador, também é possível arrastar o cartão para a próxima coluna.
        Cancelar exige justificativa.
      </p>
      <div className={styles.workspace}>
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
                      aria-label={`Pedido ${identificacao(p)}, ${p.venda.cliente ?? "Cliente não identificado"}, ${moeda(p.venda.totalCentavos)}`}
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
                        <time className={styles.tempo} dateTime={p.criadoEm}>
                          {tempo(p, agora)}
                        </time>
                      </span>
                      <span className={styles.cliente}>
                        {p.venda.cliente ?? "Cliente não identificado"}
                      </span>
                      <span className={styles.resumo}>
                        {p.venda.itens
                          .slice(0, 3)
                          .map((i) => `${i.quantidade}× ${i.nome}`)
                          .join(" · ")}
                      </span>
                      <span className={styles.rodapeCard}>
                        <span>
                          {modalidade(p)} ·{" "}
                          {p.venda.itens.reduce((s, i) => s + i.quantidade, 0)}{" "}
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
        <aside className={styles.detalhe} aria-label="Detalhes do pedido">
          {selecionado ? (
            <DetalhesPedido
              pedido={selecionado}
              podeOperar={podeOperar}
              podeCancelar={podeCancelar}
              pendente={mutando}
              aoMover={mover}
              aoFechar={() => setSelecionadoId(null)}
            />
          ) : (
            <div className={styles.semSelecao}>
              <Icone nome="caixa" tamanho={65} />
              <p>Nenhum pedido selecionado</p>
              <p className="text-xs">
                Selecione um cartão para acompanhar o pedido.
              </p>
            </div>
          )}
        </aside>
      </div>
      <PainelLateral
        aberto={compacto && !!selecionado && !cancelando}
        aoFechar={() => setSelecionadoId(null)}
        podeFechar={() => !mutando}
        titulo={selecionado ? `Pedido ${identificacao(selecionado)}` : "Pedido"}
      >
        {selecionado && (
          <DetalhesPedido
            pedido={selecionado}
            podeOperar={podeOperar}
            podeCancelar={podeCancelar}
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
            O histórico será preservado. A devolução do pagamento ao cliente é
            manual. Se os ingredientes já foram consumidos, registre a perda
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
    </div>
  );
}

function DetalhesPedido({
  pedido: p,
  podeOperar,
  podeCancelar,
  pendente,
  aoMover,
  aoFechar,
}: {
  pedido: PedidoPdv;
  podeOperar: boolean;
  podeCancelar: boolean;
  pendente: boolean;
  aoMover: (p: PedidoPdv, destino: StatusPedido) => Promise<void>;
  aoFechar?: () => void;
}) {
  const seguinte = proximo(p);
  return (
    <div className={styles.detalheConteudo}>
      <header className={styles.detalheTopo}>
        <div>
          <h2>Pedido {identificacao(p)}</h2>
          <p>
            {data(p.criadoEm)} · {modalidade(p)}
          </p>
        </div>
        {aoFechar && (
          <button
            type="button"
            aria-label="Fechar pedido selecionado"
            className={styles.fechar}
            onClick={aoFechar}
          >
            ×
          </button>
        )}
      </header>
      <span className={styles.etapa}>{nomes[p.status]}</span>
      <BotoesImpressao vendaId={p.vendaId} />
      <section className={styles.secao}>
        <h3>Cliente</h3>
        <p>{p.venda.cliente ?? "Não identificado"}</p>
      </section>
      <section className={styles.secao}>
        <h3>Itens do pedido</h3>
        {p.venda.itens.map((item, i) => (
          <div key={i} className={styles.item}>
            <div className={styles.linha}>
              <strong>
                {item.quantidade}× {item.nome}
              </strong>
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
        <h3>Pagamento registrado</h3>
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
        <p className="mt-2 text-xs">Conferência manual do operador.</p>
      </section>
      <div className={styles.total}>
        <span>Total</span>
        <span>{moeda(p.venda.totalCentavos)}</span>
      </div>
      <div className={styles.acoes}>
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
        {p.status !== "CANCELADO" && podeCancelar && (
          <Botao
            peso="fantasma"
            disabled={pendente}
            onClick={() => void aoMover(p, "CANCELADO")}
          >
            Cancelar pedido
          </Botao>
        )}
      </div>
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
              <strong>{nomes[e.para]}</strong> · {e.operador}
              <time dateTime={e.criadoEm}>{data(e.criadoEm)}</time>
              {e.observacao && <p>{e.observacao}</p>}
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}
