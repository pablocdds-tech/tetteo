"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api } from "../client/api";
import {
  useVirtualAccount,
  type VirtualChannelsResult,
} from "../client/virtual-channel-context";
import styles from "./virtual-history.module.css";

type HistoryStatus = {
  supported: boolean;
  state: "IDLE" | "RUNNING" | "COMPLETE" | "PARTIAL" | "FAILED";
  startedAt: string | null;
  finishedAt: string | null;
  importedConversations: number;
  importedMessages: number;
  skippedMessages: number;
  coverageFrom: string | null;
  coverageUntil: string | null;
  complete: boolean;
  limitReason: string | null;
  error: string | null;
  automatic?: {
    enabled: boolean;
    state: "IDLE" | "RUNNING" | "COMPLETE" | "PARTIAL" | "FAILED";
    lastSyncedAt: string | null;
    nextSyncAt: string | null;
    error: string | null;
  };
};
const LABELS: Record<HistoryStatus["state"], string> = {
  IDLE: "Histórico antigo ainda não importado",
  RUNNING: "Importando histórico antigo…",
  COMPLETE: "Importação do histórico antigo concluída",
  PARTIAL: "Histórico antigo importado parcialmente",
  FAILED: "A importação do histórico antigo precisa de atenção",
};
const AUTOMATIC_LABELS: Record<HistoryStatus["state"], string> = {
  IDLE: "Aguardando a próxima atualização",
  RUNNING: "Buscando mensagens recentes…",
  COMPLETE: "Última atualização concluída",
  PARTIAL: "Última atualização parcial",
  FAILED: "A atualização automática precisa de atenção",
};
const failureText = (failure: unknown) =>
  failure instanceof Error
    ? failure.message
    : "Não foi possível consultar a sincronização. Atualize o status.";
const when = (value: string) =>
  new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

export default function VirtualHistory({
  storeId,
  accountId,
  manageable,
  onUpdated,
}: {
  storeId: string;
  accountId: string;
  manageable: boolean;
  onUpdated: () => void;
}) {
  const { account, refreshAccounts } = useVirtualAccount();
  const connection = account?.id === accountId ? account : null;
  const revision = connection?.revision ?? null;
  const connectionState = connection?.connectionState;
  const currentRevision = useRef(revision);
  useEffect(() => {
    currentRevision.current = revision;
  }, [revision]);
  const [history, setHistory] = useState<HistoryStatus | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [checkingConnection, setCheckingConnection] = useState(false);
  const [connectionIssue, setConnectionIssue] = useState(false);
  const [checking, setChecking] = useState(false);
  const [watchStartedAt, setWatchStartedAt] = useState(() => Date.now());
  const [watchStopped, setWatchStopped] = useState(false);
  const pendingRequest = useRef<string | null>(null);
  const live = useRef(true);
  const path = `/api/crm/virtual/history?${new URLSearchParams({ storeId, accountId })}`;
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  useEffect(() => {
    let alive = true;
    void api
      .get<HistoryStatus>(path)
      .then((result) => {
        if (alive) {
          setHistory(result);
          setError("");
        }
      })
      .catch((failure) => {
        if (alive) setError(failureText(failure));
      });
    return () => {
      alive = false;
    };
  }, [path, revision, connectionState]);
  const state = history?.state;
  const automatic = history?.automatic;
  const automaticEnabled = automatic?.enabled;
  useEffect(() => {
    if (!automaticEnabled || (state === "RUNNING" && !watchStopped)) return;
    let alive = true;
    let pending = false;
    const timer = setInterval(async () => {
      if (document.hidden || pending) return;
      pending = true;
      try {
        const result = await api.get<HistoryStatus>(path);
        if (alive) {
          setHistory(result);
          setError("");
        }
      } catch (failure) {
        if (alive) setError(failureText(failure));
      } finally {
        pending = false;
      }
    }, 30000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [automaticEnabled, state, watchStopped, path]);
  useEffect(() => {
    if (state !== "RUNNING" || watchStopped) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const deadline = watchStartedAt + 90000;
    const cutoff = setTimeout(
      () => {
        alive = false;
        clearTimeout(timer);
        setWatchStopped(true);
      },
      Math.max(0, deadline - Date.now()),
    );
    async function poll() {
      if (!alive || Date.now() >= deadline) return;
      try {
        const result = await api.get<HistoryStatus>(path);
        if (!alive) return;
        setHistory(result);
        setError("");
        if (result.state !== "RUNNING") {
          onUpdated();
          return;
        }
        timer = setTimeout(poll, 3000);
      } catch (failure) {
        if (alive) {
          setError(failureText(failure));
          setWatchStopped(true);
        }
      }
    }
    timer = setTimeout(poll, 3000);
    return () => {
      alive = false;
      clearTimeout(timer);
      clearTimeout(cutoff);
    };
  }, [state, watchStartedAt, watchStopped, path, onUpdated]);

  async function refresh() {
    if (checking || submitting) return;
    setChecking(true);
    setError("");
    try {
      const result = await api.get<HistoryStatus>(path);
      if (!live.current) return;
      setHistory(result);
      setWatchStartedAt(Date.now());
      setWatchStopped(false);
      if (result.state !== "RUNNING") onUpdated();
    } catch (failure) {
      if (live.current) setError(failureText(failure));
    } finally {
      if (live.current) setChecking(false);
    }
  }
  async function synchronize() {
    if (
      submitting ||
      checking ||
      !history?.supported ||
      history.state === "RUNNING"
    )
      return;
    setSubmitting(true);
    setError("");
    setConnectionIssue(false);
    try {
      if (!connection) {
        setConnectionIssue(true);
        throw new Error(
          "Selecione o WhatsApp desta unidade antes de sincronizar.",
        );
      }
      if (connection.connectionState !== "VERIFIED") {
        setCheckingConnection(true);
        setConnectionIssue(true);
        let status: VirtualChannelsResult;
        try {
          status = await api.post<VirtualChannelsResult>(
            "/api/crm/virtual/channels",
            {
              storeId,
              accountId,
              revision: connection.revision,
              action: "status",
            },
          );
        } finally {
          if (live.current) refreshAccounts();
        }
        if (!live.current) return;
        const confirmed = status.accounts.find((item) => item.id === accountId);
        if (
          !confirmed ||
          confirmed.revision !== connection.revision ||
          currentRevision.current !== connection.revision
        )
          throw new Error(
            "A configuração deste WhatsApp mudou. Atualize a conexão antes de sincronizar.",
          );
        if (confirmed.connectionState !== "VERIFIED")
          throw new Error(
            "O provedor ainda não confirmou a conexão deste número. Reconecte o WhatsApp e tente novamente.",
          );
        setCheckingConnection(false);
        setConnectionIssue(false);
      }
      if (!live.current) return;
      pendingRequest.current ??= crypto.randomUUID();
      const result = await api.post<HistoryStatus>("/api/crm/virtual/history", {
        storeId,
        accountId,
        action: "sync",
        requestId: pendingRequest.current,
      });
      if (!live.current) return;
      pendingRequest.current = null;
      setHistory(result);
      setWatchStartedAt(Date.now());
      setWatchStopped(false);
      if (result.state !== "RUNNING") onUpdated();
    } catch (failure) {
      if (live.current) setError(failureText(failure));
    } finally {
      if (live.current) {
        setSubmitting(false);
        setCheckingConnection(false);
      }
    }
  }
  const running = state === "RUNNING";
  return (
    <section className={styles.history} aria-label="Sincronização do histórico">
      <div className={styles.heading}>
        <div>
          <h2>Mensagens e histórico deste WhatsApp</h2>
          <p>
            A atualização das mensagens recentes e a importação do histórico
            antigo são independentes. Sincronizar não ativa a IA nem envia
            mensagens.
          </p>
        </div>
        <div className={styles.actions}>
          {manageable && (
            <button
              className="btn btn-primary"
              disabled={
                submitting || checking || !history?.supported || running
              }
              onClick={() => void synchronize()}
            >
              {checkingConnection
                ? "Verificando conexão…"
                : submitting
                  ? "Solicitando sincronização…"
                  : running
                    ? "Sincronização em andamento"
                    : "Sincronizar histórico"}
            </button>
          )}
          {(!running || watchStopped || error) && (
            <button
              className="btn"
              disabled={submitting || checking}
              onClick={() => void refresh()}
            >
              {checking ? "Consultando…" : "Atualizar status"}
            </button>
          )}
        </div>
      </div>
      {!history && !error && <p>Consultando histórico disponível…</p>}
      {automatic && (
        <div className={styles.automatic}>
          <h3>Atualização automática</h3>
          <p className={styles.status} role="status">
            {automatic.enabled
              ? AUTOMATIC_LABELS[automatic.state]
              : "Atualização automática não está ativa nesta conta"}
          </p>
          <p>
            {automatic.enabled ? (
              <>
                O sistema verifica mensagens recentes a cada minuto. As
                primeiras podem aparecer em instantes, enquanto o histórico
                antigo continua em segundo plano.
              </>
            ) : (
              <>
                Confira a conexão em{" "}
                <Link href="/assistente/conectar">Conectar WhatsApp</Link> e o
                estado da operação em{" "}
                <Link href="/assistente/monitoramento">Monitoramento</Link>.
              </>
            )}
          </p>
          <dl className={styles.automaticTimes}>
            <div>
              <dt>Última atualização concluída</dt>
              <dd>
                {automatic.lastSyncedAt
                  ? when(automatic.lastSyncedAt)
                  : "Ainda sem atualização concluída"}
              </dd>
            </div>
            {automatic.enabled && automatic.nextSyncAt && (
              <div>
                <dt>Próxima verificação</dt>
                <dd>{when(automatic.nextSyncAt)}</dd>
              </div>
            )}
          </dl>
          {automatic.error && (
            <p className={styles.error} role="alert">
              {automatic.error}
            </p>
          )}
        </div>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
          {connectionIssue && (
            <>
              {" "}
              <Link className="underline" href="/assistente/conectar">
                Conectar WhatsApp
              </Link>
              .
            </>
          )}
        </p>
      )}
      {history && (
        <>
          <p className={styles.status} role="status">
            {LABELS[history.state]}
          </p>
          {!history.supported && (
            <p>
              {history.limitReason ??
                "A importação de histórico não está disponível para esta conta."}
            </p>
          )}
          {history.state !== "IDLE" && (
            <>
              <dl className={styles.counts}>
                <div>
                  <dt>Conversas importadas</dt>
                  <dd>{history.importedConversations}</dd>
                </div>
                <div>
                  <dt>Mensagens importadas</dt>
                  <dd>{history.importedMessages}</dd>
                </div>
                <div>
                  <dt>Mensagens ignoradas</dt>
                  <dd>{history.skippedMessages}</dd>
                </div>
              </dl>
              {history.coverageFrom && history.coverageUntil && (
                <p>
                  Período encontrado: {when(history.coverageFrom)} a{" "}
                  {when(history.coverageUntil)}.
                </p>
              )}
              {history.finishedAt && (
                <p>Última atualização: {when(history.finishedAt)}.</p>
              )}
            </>
          )}
          {history.error && (
            <p className={styles.error} role="alert">
              {history.error}
            </p>
          )}
          {history.supported && history.limitReason && (
            <p>{history.limitReason}</p>
          )}
          {running && watchStopped && (
            <p>
              A sincronização continua no servidor. Atualize o status ou reabra
              esta tela para acompanhar.
            </p>
          )}
        </>
      )}
      <p className={styles.limit}>
        A importação depende do que o servidor disponibiliza e pode não conter
        todo o histórico do celular. Mensagens importadas são identificadas no
        histórico da conversa.
      </p>
    </section>
  );
}
