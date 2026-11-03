"use client";

import { useEffect, useState } from "react";
import { api } from "../client/api";
import { useAuth } from "../client/context";
import { useVirtualAccount } from "../client/virtual-channel-context";
import { VirtualCredit, VirtualHeader } from "./virtual-header";
import styles from "./virtual.module.css";

type Quality = {
  periodDays: number;
  total: number;
  completed: number;
  failed: number;
  discarded: number;
  emptyResponses: number;
  loopsBlocked: number;
  pendingEscalations: number;
  costMicros: number;
  tokens: number;
  latencyP50: number | null;
  latencyP95: number | null;
  toolFailures: number;
  runs: {
    id: string;
    status: string;
    model: string;
    tokens: number;
    costMicros: number;
    latencyMs: number;
    error: string | null;
    createdAt: string;
    conversationId: string;
  }[];
};
const STATUS: Record<string, string> = {
  RUNNING: "Em execução",
  COMPLETED: "Concluída",
  FAILED: "Falhou",
  DISCARDED: "Descartada",
};
const money = (value: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 4,
  }).format(value / 1_000_000);
const latency = (value: number | null) =>
  value === null
    ? "—"
    : `${(value / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} s`;

export default function VirtualQuality() {
  const { selectedStoreId: storeId } = useAuth();
  const { selectedAccountId: accountId } = useVirtualAccount();
  const [periodDays, setPeriodDays] = useState("30");
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ key: string; data: Quality } | null>(
    null,
  );
  const [error, setError] = useState("");
  const key = `${storeId}:${accountId}:${periodDays}`;
  const data = result?.key === key ? result.data : null;
  useEffect(() => {
    if (!accountId) return;
    let alive = true;
    void api
      .get<Quality>(
        `/api/crm/virtual/quality?${new URLSearchParams({ storeId, accountId, periodDays })}`,
      )
      .then((value) => {
        if (alive) {
          setResult({ key, data: value });
          setError("");
        }
      })
      .catch((failure) => {
        if (alive)
          setError(
            failure instanceof Error
              ? failure.message
              : "Não foi possível consultar a qualidade do atendimento.",
          );
      });
    return () => {
      alive = false;
    };
  }, [storeId, accountId, periodDays, revision, key]);
  const metrics = data
    ? [
        [
          "Execuções concluídas",
          `${data.completed} de ${data.total}`,
          `${data.failed} falharam; ${data.discarded} foram descartadas.`,
        ],
        [
          "Falhas em ferramentas",
          String(data.toolFailures),
          "Chamadas com erro registradas no período.",
        ],
        [
          "Respostas sem texto",
          String(data.emptyResponses),
          `${data.loopsBlocked} repetição(ões) bloqueada(s).`,
        ],
        [
          "Tempo de resposta mediano",
          latency(data.latencyP50),
          `95% das execuções até ${latency(data.latencyP95)}.`,
        ],
        [
          "Uso de modelo",
          data.tokens.toLocaleString("pt-BR"),
          `Tokens registrados. Custo: ${money(data.costMicros)}.`,
        ],
        [
          "Escalações pendentes",
          String(data.pendingEscalations),
          "Pendências ainda abertas na unidade.",
        ],
      ]
    : [];
  return (
    <main className={styles.page}>
      <VirtualHeader section="qualidade">
        <div className={styles.actions}>
          <label className={styles.field}>
            Período
            <select
              value={periodDays}
              onChange={(event) => setPeriodDays(event.target.value)}
            >
              <option value="7">Últimos 7 dias</option>
              <option value="30">Últimos 30 dias</option>
              <option value="90">Últimos 90 dias</option>
            </select>
          </label>
          <button
            className="btn"
            onClick={() => setRevision((value) => value + 1)}
          >
            Atualizar
          </button>
        </div>
      </VirtualHeader>
      <p className={styles.muted} style={{ marginTop: 16 }}>
        Execuções, erros, custos e tempo de resposta registrados no servidor.
      </p>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {!data && !error && (
        <p className={styles.empty}>
          {accountId
            ? "Consultando as execuções…"
            : "Selecione uma conta de canal para consultar as execuções."}
        </p>
      )}
      {data && (
        <>
          <div className={styles.healthGrid}>
            {metrics.map(([label, value, description]) => (
              <section className={styles.healthMetric} key={label}>
                <h2>{label}</h2>
                <strong>{value}</strong>
                <p>{description}</p>
              </section>
            ))}
          </div>
          <section className={styles.panel}>
            <h2>Execuções recentes</h2>
            {data.runs.length ? (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Quando</th>
                      <th>Situação</th>
                      <th>Modelo</th>
                      <th>Tempo</th>
                      <th>Tokens</th>
                      <th>Custo</th>
                      <th>Ocorrência</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.runs.map((run) => (
                      <tr key={run.id}>
                        <td>
                          {new Date(run.createdAt).toLocaleString("pt-BR")}
                        </td>
                        <td>{STATUS[run.status] ?? run.status}</td>
                        <td>{run.model}</td>
                        <td>{latency(run.latencyMs)}</td>
                        <td>{run.tokens}</td>
                        <td>{money(run.costMicros)}</td>
                        <td>{run.error ?? "Sem erro registrado"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p>
                Nenhuma execução neste período. As próximas conversas
                processadas aparecerão aqui.
              </p>
            )}
          </section>
        </>
      )}
      <VirtualCredit />
    </main>
  );
}
