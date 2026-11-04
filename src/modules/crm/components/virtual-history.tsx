"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "../client/api";
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
};
const LABELS: Record<HistoryStatus["state"], string> = {
  IDLE: "Histórico ainda não sincronizado",
  RUNNING: "Sincronizando histórico…",
  COMPLETE: "Sincronização concluída",
  PARTIAL: "Histórico importado parcialmente",
  FAILED: "A sincronização precisa de atenção",
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
  const [history, setHistory] = useState<HistoryStatus | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
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
  }, [path]);
  const state = history?.state;
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
    pendingRequest.current ??= crypto.randomUUID();
    try {
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
      if (live.current) setSubmitting(false);
    }
  }
  const running = state === "RUNNING";
  return (
    <section className={styles.history} aria-label="Sincronização do histórico">
      <div className={styles.heading}>
        <div>
          <h2>Histórico deste WhatsApp</h2>
          <p>
            Importe as conversas disponíveis no servidor Evolution. Isso não
            ativa a IA nem envia mensagens.
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
              {submitting
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
      {error && (
        <p className={styles.error} role="alert">
          {error}
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
