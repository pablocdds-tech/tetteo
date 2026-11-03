"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { api } from "../client/api";
import { useAuth } from "../client/context";
import { useVirtualAccount } from "../client/virtual-channel-context";
import type {
  VirtualConversationDetail,
  VirtualEscalation,
  VirtualInboxResult,
  VirtualOperatorAction,
  VirtualStatus,
} from "../virtual-types";
import { VirtualCredit, VirtualHeader } from "./virtual-header";
import VirtualCustomerBinding from "./virtual-customer-binding";
import styles from "./virtual.module.css";

const LABELS: Record<VirtualStatus, string> = {
  OPEN: "Abertas",
  WAITING_CUSTOMER: "Aguardando cliente",
  WAITING_TEAM: "Aguardando equipe",
  ESCALATED: "Escaladas",
  PAUSED: "Pausadas",
  RESOLVED: "Resolvidas",
};
const DELIVERY: Record<string, string> = {
  PENDING: "Na fila",
  SENDING: "Enviando",
  ACCEPTED: "Aceita pelo canal",
  DELIVERED: "Entregue no canal local",
  FAILED: "Falha de envio",
  CANCELLED: "Envio descartado",
  RECEIVED: "Recebida",
  DISCARDED: "Envio descartado",
  NOTIFIED: "Notificação interna registrada",
  UNCONFIGURED: "Destino não configurado",
};
const RUN_STATUS: Record<string, string> = {
  COMPLETED: "Concluída",
  RUNNING: "Em processamento",
  FAILED: "Falhou",
  DISCARDED: "Resposta obsoleta descartada",
  BLOCKED: "Bloqueada",
};
const AUTHOR: Record<string, string> = {
  CUSTOMER: "Cliente",
  AGENT: "Atendimento virtual",
  HUMAN: "Equipe",
  SYSTEM: "Sistema",
};
const RESERVATION_STATUS: Record<string, string> = {
  CONFIRMED: "Confirmada",
  CANCELLED: "Cancelada",
};
const when = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "America/Sao_Paulo",
      }).format(new Date(value))
    : "Sem prazo";
const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Não foi possível carregar a conversa.";
const amount = (micros: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 4,
  }).format(micros / 1_000_000);

function MessageText({ text }: { text: string }) {
  return text.split(/(https?:\/\/[^\s]+)/g).map((part, index) =>
    /^https?:\/\//.test(part) ? (
      <a href={part} key={index} target="_blank" rel="noreferrer">
        {part}
      </a>
    ) : (
      part
    ),
  );
}

function Escalation({
  task,
  busy,
  editable,
  act,
}: {
  task: VirtualEscalation;
  busy: boolean;
  editable: boolean;
  act: (action: VirtualOperatorAction, extra?: Record<string, unknown>) => void;
}) {
  return (
    <article className={styles.escalation}>
      <div className={styles.badges}>
        <span
          className={`${styles.badge} ${task.acknowledgedAt ? styles.success : styles.warning}`}
        >
          {task.acknowledgedAt
            ? "Reconhecida pela equipe"
            : "Aguardando reconhecimento"}
        </span>
      </div>
      <strong>{task.reason}</strong>
      <p>{task.excerpt}</p>
      <p className={styles.metadata}>
        {task.owner ? `Responsável: ${task.owner}` : "Sem responsável"}
        {task.acknowledgedAt ? ` · ${when(task.acknowledgedAt)}` : ""}
      </p>
      <p className={styles.metadata}>
        Alerta: {DELIVERY[task.alertStatus] ?? task.alertStatus}
      </p>
      {task.alertError && <p className={styles.danger}>{task.alertError}</p>}
      {editable && (
        <div className={styles.actions}>
          {!task.acknowledgedAt && (
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={() => act("ack_escalation", { escalationId: task.id })}
            >
              Reconhecer e assumir
            </button>
          )}
          {task.alertStatus === "FAILED" && (
            <button
              className="btn"
              disabled={busy}
              onClick={() => act("retry_alert", { escalationId: task.id })}
            >
              Reenviar alerta
            </button>
          )}
        </div>
      )}
    </article>
  );
}

export default function VirtualInbox({
  escalations = false,
}: {
  escalations?: boolean;
}) {
  const { selectedAccountId } = useVirtualAccount();
  return (
    <VirtualInboxForAccount
      key={selectedAccountId}
      escalations={escalations}
      accountId={selectedAccountId}
    />
  );
}

function VirtualInboxForAccount({
  escalations,
  accountId,
}: {
  escalations: boolean;
  accountId: string;
}) {
  const { selectedStoreId: storeId, user, can } = useAuth();
  const { refreshAccounts, setSelectedAccountId } = useVirtualAccount();
  const editable = can("CRM", "EDIT");
  const [status, setStatus] = useState<VirtualStatus | "">("");
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState("");
  const [revision, setRevision] = useState(0);
  const [list, setList] = useState<{
    key: string;
    data: VirtualInboxResult;
  } | null>(null);
  const [detail, setDetail] = useState<{
    key: string;
    data: VirtualConversationDetail;
  } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState("");
  const [simulation, setSimulation] = useState("");
  const [pauseMinutes, setPauseMinutes] = useState("0");
  const [summary, setSummary] = useState("");
  const [escalationToResolve, setEscalationToResolve] = useState("");
  const pendingRequest = useRef<{
    signature: string;
    body: Record<string, unknown>;
  } | null>(null);
  const selectionRef = useRef("");
  const messagesRef = useRef<HTMLDivElement>(null);
  const scrollPosition = useRef({ conversationId: "", nearBottom: true });
  const choose = useCallback((id: string) => {
    selectionRef.current = id;
    setSelected(id);
    setReply("");
    setSimulation("");
    setSummary("");
    setEscalationToResolve("");
    setNotice("");
  }, []);
  const listKey = `${storeId}:${accountId}:${status}:${search}:${page}:${escalations}`;
  const currentList = list?.key === listKey ? list.data : null;
  const activeId = currentList?.items.some((item) => item.id === selected)
    ? selected
    : "";
  const detailKey = `${storeId}:${activeId}`;
  const currentDetail = detail?.key === detailKey ? detail.data : null;
  const conversation = currentDetail?.conversation;
  const lastMessageId = currentDetail?.messages.at(-1)?.id;
  const activeEscalations =
    currentDetail?.escalations.filter((task) => task.status !== "RESOLVED") ??
    [];
  const resumeEscalationId = activeEscalations.some(
    (task) => task.id === escalationToResolve,
  )
    ? escalationToResolve
    : (activeEscalations[0]?.id ?? "");
  const unitName =
    user.stores.find((store) => store.id === storeId)?.name ?? "Unidade ativa";

  useEffect(() => {
    const pane = messagesRef.current;
    if (!pane || !activeId) return;
    if (
      scrollPosition.current.conversationId !== activeId ||
      scrollPosition.current.nearBottom
    ) {
      pane.scrollTop = pane.scrollHeight;
    }
    scrollPosition.current.conversationId = activeId;
  }, [activeId, lastMessageId]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) setRevision((value) => value + 1);
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!accountId) return;
    let alive = true;
    const query = new URLSearchParams({
      storeId,
      accountId,
      search,
      page: String(page),
    });
    if (status) query.set("status", status);
    if (escalations) query.set("escalationOnly", "true");
    void api
      .get<VirtualInboxResult>(`/api/crm/virtual?${query}`)
      .then((data) => {
        if (alive) {
          setList({ key: listKey, data });
          if (!data.items.some((item) => item.id === selectionRef.current)) {
            choose(data.items[0]?.id ?? "");
          }
        }
      })
      .catch((failure) => {
        if (alive) setError(errorText(failure));
      });
    return () => {
      alive = false;
    };
  }, [
    storeId,
    accountId,
    search,
    page,
    status,
    escalations,
    listKey,
    revision,
    choose,
  ]);

  useEffect(() => {
    if (!activeId) return;
    let alive = true;
    void api
      .get<VirtualConversationDetail>(
        `/api/crm/virtual/${encodeURIComponent(activeId)}?storeId=${encodeURIComponent(storeId)}`,
      )
      .then((data) => {
        if (alive) setDetail({ key: detailKey, data });
      })
      .catch((failure) => {
        if (alive) setError(errorText(failure));
      });
    return () => {
      alive = false;
    };
  }, [activeId, storeId, detailKey, revision]);

  async function act(
    action: VirtualOperatorAction,
    extra: Record<string, unknown> = {},
  ) {
    if (!conversation || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const signature = JSON.stringify({ id: conversation.id, action, extra });
      const body =
        pendingRequest.current?.signature === signature
          ? pendingRequest.current.body
          : {
              storeId,
              action,
              version: conversation.version,
              requestId: crypto.randomUUID(),
              ...extra,
            };
      pendingRequest.current = { signature, body };
      await api.post(
        `/api/crm/virtual/${encodeURIComponent(conversation.id)}`,
        body,
      );
      pendingRequest.current = null;
      if (action === "reply") setReply("");
      if (action === "resume") setSummary("");
      setNotice(
        action === "reply"
          ? "Resposta registrada na fila do canal local."
          : "Atendimento atualizado.",
      );
      setRevision((value) => value + 1);
    } catch (failure) {
      if (
        failure instanceof Error &&
        failure.message ===
          "O atendimento mudou. Atualize a conversa antes de continuar."
      )
        pendingRequest.current = null;
      setError(errorText(failure));
      setRevision((value) => value + 1);
    } finally {
      setBusy(false);
    }
  }

  async function demo(text?: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api.post<{ accountId?: string }>(
        "/api/crm/virtual/demo",
        {
          storeId,
          requestId: crypto.randomUUID(),
          ...(text && activeId ? { conversationId: activeId, text } : {}),
        },
      );
      if (!text) {
        if (result.accountId) setSelectedAccountId(result.accountId);
        refreshAccounts();
      }
      setSimulation("");
      setNotice(
        text
          ? "Mensagem fictícia recebida. A fila vai processar a conversa."
          : "Exemplos fictícios preparados no canal local.",
      );
      setRevision((value) => value + 1);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    setSearch(searchDraft.trim());
    setPage(1);
  }

  return (
    <main className={styles.page}>
      <VirtualHeader section={escalations ? "escalacoes" : "inbox"}>
        {editable && (
          <button className="btn" disabled={busy} onClick={() => void demo()}>
            {busy ? "Aguarde…" : "Preparar exemplos fictícios"}
          </button>
        )}
      </VirtualHeader>
      {conversation?.demo && (
        <div className={styles.demo} style={{ marginTop: 16 }}>
          <strong>Conversa de demonstração</strong>
          <span>
            Mensagens fictícias no canal local. Nenhum destinatário real recebe
            estes envios.
          </span>
        </div>
      )}
      {error && (
        <div className={styles.error} role="alert">
          {error}{" "}
          <button
            className="btn"
            onClick={() => {
              setError("");
              setRevision((value) => value + 1);
            }}
          >
            Tentar de novo
          </button>
        </div>
      )}
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
      <div className={styles.workspace}>
        <aside className={styles.inbox} aria-label="Lista de conversas">
          <div className={styles.filters}>
            <p className={styles.muted}>{unitName}</p>
            <form onSubmit={submitSearch}>
              <label htmlFor="virtual-search">Buscar cliente ou mensagem</label>
              <div className={styles.search}>
                <input
                  id="virtual-search"
                  value={searchDraft}
                  onChange={(event) => setSearchDraft(event.target.value)}
                  maxLength={120}
                  placeholder="Nome ou trecho da conversa"
                />
                <button className="btn" type="submit">
                  Buscar
                </button>
              </div>
            </form>
            <div className={styles.statuses} aria-label="Filtrar conversas">
              <button
                aria-pressed={!status}
                onClick={() => {
                  setStatus("");
                  setPage(1);
                }}
              >
                Todas
              </button>
              {Object.entries(LABELS).map(([key, label]) => (
                <button
                  key={key}
                  aria-pressed={status === key}
                  onClick={() => {
                    setStatus(key as VirtualStatus);
                    setPage(1);
                  }}
                >
                  {label}
                  <span>
                    {currentList?.counts[key as VirtualStatus] ?? "—"}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div
            className={styles.conversationList}
            aria-busy={!currentList && !error}
          >
            {!accountId && (
              <p className={styles.empty}>
                Configure uma conta ou prepare exemplos fictícios para começar.
              </p>
            )}
            {accountId && !currentList && !error && (
              <p className={styles.empty}>Carregando conversas…</p>
            )}
            {currentList?.items.map((item) => (
              <button
                className={styles.conversationItem}
                key={item.id}
                disabled={busy}
                aria-current={activeId === item.id ? "true" : undefined}
                onClick={() => choose(item.id)}
              >
                <span className={styles.rowTitle}>
                  <strong>{item.customerName}</strong>
                  <time dateTime={item.lastMessageAt}>
                    {new Date(item.lastMessageAt).toLocaleTimeString("pt-BR", {
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZone: "America/Sao_Paulo",
                    })}
                  </time>
                </span>
                <span className={styles.preview}>
                  {item.lastMessage || "Conversa iniciada"}
                </span>
                <span className={styles.badges}>
                  <span
                    className={`${styles.badge} ${item.status === "ESCALATED" ? styles.warning : ""}`}
                  >
                    {LABELS[item.status]}
                  </span>
                  <span className={styles.badge}>
                    {item.agentEnabled ? "IA ativa" : "Controle humano"}
                  </span>
                  {item.latestEscalation?.acknowledgedAt && (
                    <span className={`${styles.badge} ${styles.success}`}>
                      Equipe ciente
                    </span>
                  )}
                </span>
                <span className={styles.metadata}>
                  {item.channel} ·{" "}
                  {item.owner
                    ? `Responsável: ${item.owner}`
                    : "Sem responsável"}
                </span>
              </button>
            ))}
            {currentList?.items.length === 0 && (
              <div className={styles.empty}>
                <h2>
                  {escalations
                    ? "Nenhuma escalação neste filtro"
                    : "Nenhuma conversa neste filtro"}
                </h2>
                <p>
                  {search || status
                    ? "Ajuste a busca ou escolha outro estado."
                    : "Prepare os exemplos fictícios para experimentar o atendimento."}
                </p>
              </div>
            )}
          </div>
          {currentList && (
            <div className={styles.pagination}>
              <span>
                {currentList.total} conversa(s) · página {currentList.page}
              </span>
              <div className={styles.actions}>
                <button
                  className="btn"
                  disabled={page <= 1}
                  onClick={() => setPage((value) => value - 1)}
                >
                  Anterior
                </button>
                <button
                  className="btn"
                  disabled={page * currentList.pageSize >= currentList.total}
                  onClick={() => setPage((value) => value + 1)}
                >
                  Próxima
                </button>
              </div>
            </div>
          )}
        </aside>
        <section
          className={styles.conversation}
          aria-label="Conversa selecionada"
          aria-busy={Boolean(activeId && !currentDetail)}
        >
          {!currentDetail ? (
            <div className={styles.empty}>
              <h2>
                {activeId
                  ? "Carregando conversa…"
                  : "Sua equipe acompanha por aqui"}
              </h2>
              <p>
                {activeId
                  ? "Consultando mensagens e contexto autorizado."
                  : "Selecione uma conversa para ver o histórico e assumir o atendimento."}
              </p>
            </div>
          ) : (
            <>
              <header className={styles.conversationHeader}>
                <div>
                  <h2>{currentDetail.customer.name}</h2>
                  <p className={styles.metadata}>
                    {conversation?.unitName} · {conversation?.channel} ·{" "}
                    {conversation && LABELS[conversation.status]}
                  </p>
                </div>
                {editable && (
                  <div className={styles.actions}>
                    {conversation?.agentEnabled && (
                      <button
                        className="btn btn-primary"
                        disabled={busy}
                        onClick={() => void act("takeover")}
                      >
                        Assumir atendimento
                      </button>
                    )}
                    {conversation?.status === "RESOLVED" ? (
                      <button
                        className="btn"
                        disabled={busy}
                        onClick={() => void act("reopen")}
                      >
                        Reabrir
                      </button>
                    ) : (
                      <button
                        className="btn"
                        disabled={busy}
                        onClick={() => void act("resolve")}
                      >
                        Resolver
                      </button>
                    )}
                  </div>
                )}
              </header>
              <div className={styles.conversationBody}>
                <div className={styles.thread}>
                  {!conversation?.agentEnabled && (
                    <div className={styles.pauseBanner}>
                      <strong>
                        IA pausada{" "}
                        {currentDetail.pause?.until
                          ? `até ${when(currentDetail.pause.until)}`
                          : "sem prazo"}
                      </strong>
                      <br />
                      {currentDetail.pause
                        ? `${currentDetail.pause.actor}: ${currentDetail.pause.reason}`
                        : "A conversa está sob controle da equipe."}
                    </div>
                  )}
                  <div className={styles.messageNavigation}>
                    <button
                      className="btn"
                      onClick={() => {
                        const pane = messagesRef.current;
                        if (pane) pane.scrollTop = pane.scrollHeight;
                      }}
                    >
                      Ir para última mensagem
                    </button>
                  </div>
                  <div
                    className={styles.messages}
                    ref={messagesRef}
                    onScroll={() => {
                      const pane = messagesRef.current;
                      if (pane)
                        scrollPosition.current.nearBottom =
                          pane.scrollHeight -
                            pane.scrollTop -
                            pane.clientHeight <
                          80;
                    }}
                    aria-label="Histórico de mensagens"
                  >
                    {currentDetail.messages.map((item) => (
                      <article
                        key={item.id}
                        className={styles.message}
                        data-direction={item.direction}
                      >
                        <span className={styles.metadata}>
                          {AUTHOR[item.author] ?? item.author} ·{" "}
                          {when(item.createdAt)}
                        </span>
                        <p>
                          <MessageText text={item.text} />
                        </p>
                        <span className={styles.metadata}>
                          {DELIVERY[item.status] ?? item.status}
                          {item.kind !== "TEXT"
                            ? ` · ${item.kind === "AUDIO" ? "Áudio" : item.kind}`
                            : ""}
                        </span>
                      </article>
                    ))}
                    {currentDetail.messages.length === 0 && (
                      <p className={styles.muted}>
                        Nenhuma mensagem registrada.
                      </p>
                    )}
                  </div>
                  {editable && (
                    <>
                      <form
                        className={styles.composer}
                        onSubmit={(event) => {
                          event.preventDefault();
                          void act("reply", { text: reply });
                        }}
                      >
                        <label htmlFor="virtual-reply">
                          Responder como pessoa da equipe
                          <textarea
                            id="virtual-reply"
                            value={reply}
                            onChange={(event) => setReply(event.target.value)}
                            placeholder={
                              conversation?.agentEnabled
                                ? "Assuma o atendimento para responder."
                                : "Escreva uma resposta para o canal local…"
                            }
                            disabled={
                              conversation?.agentEnabled ||
                              busy ||
                              conversation?.status === "RESOLVED"
                            }
                            maxLength={4000}
                          />
                        </label>
                        <div className={styles.actions}>
                          <button
                            className="btn btn-primary"
                            disabled={
                              busy ||
                              !reply.trim() ||
                              conversation?.agentEnabled ||
                              conversation?.status === "RESOLVED"
                            }
                          >
                            Enviar resposta
                          </button>
                          <small>
                            O histórico mostra o estado de cada envio.
                          </small>
                        </div>
                      </form>
                      {conversation?.demo && (
                        <details open className={styles.simulator}>
                          <summary>
                            Testar como cliente · mensagem fictícia
                          </summary>
                          <p>
                            A mensagem entra na mesma fila durável. Use apenas
                            conteúdo fictício.
                          </p>
                          <form
                            onSubmit={(event) => {
                              event.preventDefault();
                              void demo(simulation);
                            }}
                          >
                            <label htmlFor="virtual-simulation">
                              Mensagem fictícia
                              <textarea
                                id="virtual-simulation"
                                value={simulation}
                                onChange={(event) =>
                                  setSimulation(event.target.value)
                                }
                                placeholder="Ex.: amanhã às 19h, quatro pessoas"
                                maxLength={4000}
                              />
                            </label>
                            <button
                              className="btn"
                              disabled={busy || !simulation.trim()}
                              style={{ marginTop: 12 }}
                            >
                              Receber mensagem fictícia
                            </button>
                          </form>
                        </details>
                      )}
                    </>
                  )}
                </div>
                <aside
                  className={styles.context}
                  aria-label="Contexto do atendimento"
                >
                  <section>
                    <h3>Cliente e origem</h3>
                    <span
                      className={`${styles.badge} ${currentDetail.customer.known ? styles.success : ""}`}
                    >
                      {currentDetail.customer.known
                        ? "Cadastro reconhecido"
                        : "Sem cadastro reconhecido"}
                    </span>
                    <dl>
                      <dt>Nome</dt>
                      <dd>{currentDetail.customer.name}</dd>
                      <dt>Origem do contexto</dt>
                      <dd>{currentDetail.customer.source}</dd>
                      <dt>Atualização</dt>
                      <dd>
                        {currentDetail.customer.updatedAt
                          ? when(currentDetail.customer.updatedAt)
                          : "Sem informação confirmada"}
                      </dd>
                    </dl>
                    {currentDetail.customer.preferences.length > 0 && (
                      <ul>
                        {currentDetail.customer.preferences.map(
                          (preference) => (
                            <li key={preference.key}>
                              <strong>{preference.key}:</strong>{" "}
                              {preference.value}
                            </li>
                          ),
                        )}
                      </ul>
                    )}
                    {user.role === "MANAGER" &&
                      !currentDetail.customer.known &&
                      conversation &&
                      !conversation.demo && (
                        <VirtualCustomerBinding
                          key={conversation.id}
                          conversationId={conversation.id}
                          version={conversation.version}
                          onBound={() => setRevision((value) => value + 1)}
                        />
                      )}
                  </section>
                  <section>
                    <h3>Reservas</h3>
                    {currentDetail.reservations.length ? (
                      <ul>
                        {currentDetail.reservations.map((reservation) => (
                          <li key={reservation.id}>
                            <strong>
                              {reservation.date} às {reservation.time}
                            </strong>
                            <br />
                            {reservation.partySize} pessoas ·{" "}
                            {RESERVATION_STATUS[reservation.status] ??
                              reservation.status}
                            <br />
                            <span className={styles.metadata}>
                              {reservation.id}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className={styles.muted}>Nenhuma reserva vinculada.</p>
                    )}
                  </section>
                  {editable && (
                    <section>
                      <h3>Controle da IA</h3>
                      {conversation?.agentEnabled ? (
                        <>
                          <label htmlFor="virtual-pause">
                            Duração da pausa
                          </label>
                          <select
                            id="virtual-pause"
                            value={pauseMinutes}
                            onChange={(event) =>
                              setPauseMinutes(event.target.value)
                            }
                          >
                            <option value="0">Sem prazo</option>
                            <option value="15">15 minutos</option>
                            <option value="60">1 hora</option>
                          </select>
                          <button
                            className="btn"
                            disabled={busy}
                            onClick={() =>
                              void act(
                                "pause",
                                Number(pauseMinutes)
                                  ? { minutes: Number(pauseMinutes) }
                                  : {},
                              )
                            }
                          >
                            Pausar IA
                          </button>
                        </>
                      ) : (
                        <>
                          {activeEscalations.length > 1 && (
                            <label className={styles.field}>
                              Pendência resolvida
                              <select
                                value={resumeEscalationId}
                                onChange={(event) =>
                                  setEscalationToResolve(event.target.value)
                                }
                              >
                                {activeEscalations.map((task) => (
                                  <option key={task.id} value={task.id}>
                                    {task.reason}
                                  </option>
                                ))}
                              </select>
                            </label>
                          )}
                          <label htmlFor="virtual-summary">
                            O que a equipe resolveu
                          </label>
                          <textarea
                            id="virtual-summary"
                            value={summary}
                            onChange={(event) => setSummary(event.target.value)}
                            maxLength={1000}
                            placeholder="Resumo para a IA continuar a conversa"
                          />
                          <button
                            className="btn"
                            disabled={
                              busy ||
                              conversation?.status === "RESOLVED" ||
                              (activeEscalations.length > 0 && !summary.trim())
                            }
                            onClick={() =>
                              void act("resume", {
                                summary,
                                ...(resumeEscalationId
                                  ? { escalationId: resumeEscalationId }
                                  : {}),
                              })
                            }
                          >
                            {activeEscalations.length > 1
                              ? "Concluir pendência selecionada"
                              : activeEscalations.length
                                ? "Concluir e retomar IA"
                                : "Retomar IA"}
                          </button>
                          {activeEscalations.length > 0 && (
                            <p className={styles.muted}>
                              Registre o que foi resolvido. A IA só retoma
                              quando todas as pendências da conversa estiverem
                              concluídas.
                            </p>
                          )}
                        </>
                      )}
                    </section>
                  )}
                  {currentDetail.summary && (
                    <section>
                      <h3>Resumo da equipe</h3>
                      <p>{currentDetail.summary}</p>
                    </section>
                  )}
                  <section>
                    <h3>Escalações</h3>
                    {currentDetail.escalations.length ? (
                      currentDetail.escalations.map((task) => (
                        <Escalation
                          key={task.id}
                          task={task}
                          busy={busy}
                          editable={editable}
                          act={(action, extra) => void act(action, extra)}
                        />
                      ))
                    ) : (
                      <p className={styles.muted}>
                        Nenhuma pendência para a equipe.
                      </p>
                    )}
                  </section>
                  <section>
                    <h3>Últimas execuções</h3>
                    {currentDetail.runs.length ? (
                      <ul>
                        {currentDetail.runs.slice(0, 3).map((run) => (
                          <li key={run.id}>
                            <strong>
                              {RUN_STATUS[run.status] ?? run.status}
                            </strong>
                            <br />
                            <span className={styles.metadata}>
                              {run.tokens} tokens · {amount(run.costMicros)} ·{" "}
                              {(run.latencyMs / 1000).toFixed(1)} s
                            </span>
                            {run.error && (
                              <p className={styles.danger}>{run.error}</p>
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className={styles.muted}>
                        Aguardando o processamento da fila.
                      </p>
                    )}
                  </section>
                </aside>
              </div>
            </>
          )}
        </section>
      </div>
      <VirtualCredit />
    </main>
  );
}
