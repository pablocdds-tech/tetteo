"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../client/api";
import { useAuth } from "../client/context";
import type { VirtualHealth, VirtualInboxResult } from "../virtual-types";
import { VirtualCredit, VirtualHeader } from "./virtual-header";
import styles from "./virtual.module.css";

const STATUS: Record<string, string> = {
  OPEN: "Aberta",
  WAITING_CUSTOMER: "Aguardando cliente",
  WAITING_TEAM: "Aguardando equipe",
  ESCALATED: "Escalada",
  PAUSED: "Pausada",
  RESOLVED: "Resolvida",
};

export default function VirtualOverview() {
  const { selectedStoreId: storeId, user } = useAuth();
  const [result, setResult] = useState<{
    storeId: string;
    inbox: VirtualInboxResult;
    health: VirtualHealth;
  } | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const data = result?.storeId === storeId ? result : null;
  useEffect(() => {
    let alive = true;
    void Promise.all([
      api.get<VirtualInboxResult>(
        `/api/crm/virtual?storeId=${encodeURIComponent(storeId)}&page=1`,
      ),
      api.get<VirtualHealth>(
        `/api/crm/virtual/health?storeId=${encodeURIComponent(storeId)}`,
      ),
    ])
      .then(([inbox, health]) => {
        if (alive) {
          setResult({ storeId, inbox, health });
          setError("");
        }
      })
      .catch((failure) => {
        if (alive)
          setError(
            failure instanceof Error
              ? failure.message
              : "Não foi possível consultar a operação.",
          );
      });
    return () => {
      alive = false;
    };
  }, [storeId, revision]);
  const metrics = data
    ? [
        [
          "Atendimentos em andamento",
          String(
            Object.entries(data.inbox.counts).reduce(
              (total, [status, count]) =>
                total + (status === "RESOLVED" ? 0 : count),
              0,
            ),
          ),
          "Conversas abertas nos estados do inbox.",
          "/assistente/inbox",
        ],
        [
          "Pendências da equipe",
          String(data.health.pendingEscalations),
          "Escalações ainda não concluídas.",
          "/assistente/escalacoes",
        ],
        [
          "Na fila",
          String(data.health.queuePending),
          `Espera mais antiga: ${Math.ceil(data.health.queueDelayMs / 1000)} segundos.`,
          "/assistente/saude",
        ],
        [
          "Erros de canal",
          String(data.health.channelErrors),
          `${data.health.failedAlerts} alerta(s) com falha.`,
          "/assistente/saude",
        ],
      ]
    : [];
  return (
    <main className={styles.page}>
      <VirtualHeader section="overview">
        <button
          className="btn"
          onClick={() => setRevision((value) => value + 1)}
        >
          Atualizar
        </button>
      </VirtualHeader>
      <p className={styles.muted} style={{ marginTop: 16 }}>
        {user.stores.find((store) => store.id === storeId)?.name}
      </p>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {!data && !error && (
        <p className={styles.empty}>Consultando atendimentos e pendências…</p>
      )}
      {data && (
        <>
          <div className={styles.overviewGrid}>
            {metrics.map(([label, value, description, href]) => (
              <Link href={href} className={styles.healthMetric} key={label}>
                <h2>{label}</h2>
                <strong>{value}</strong>
                <p>{description}</p>
              </Link>
            ))}
          </div>
          <section className={styles.panel}>
            <div className={styles.sectionHeading}>
              <h2>Conversas recentes</h2>
              <Link className="btn" href="/assistente/inbox">
                Abrir inbox
              </Link>
            </div>
            {data.inbox.items.length ? (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Cliente</th>
                      <th>Última mensagem</th>
                      <th>Canal</th>
                      <th>Situação</th>
                      <th>Atualização</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.inbox.items.slice(0, 6).map((item) => (
                      <tr key={item.id}>
                        <td>
                          <strong>{item.customerName}</strong>
                        </td>
                        <td>{item.lastMessage}</td>
                        <td>
                          {item.channel}
                          {item.demo ? " · demonstração" : ""}
                        </td>
                        <td>{STATUS[item.status] ?? item.status}</td>
                        <td>
                          {new Date(item.lastMessageAt).toLocaleString("pt-BR")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p>
                Nenhuma conversa recebida nesta unidade. Configure um canal ou
                prepare exemplos fictícios no inbox.
              </p>
            )}
          </section>
          <section className={styles.panel}>
            <h2>Processamento e conexões</h2>
            <p>
              {data.health.engine?.enabled
                ? `Gemini ativo: ${data.health.engine.model ?? "modelo configurado"}.`
                : "O modelo Gemini não está ativo nesta unidade."}{" "}
              O estado de cada conta de WhatsApp é verificado separadamente.
            </p>
            <div className={styles.actions} style={{ marginTop: 16 }}>
              <Link className="btn" href="/assistente/evolution">
                Chips Evolution
              </Link>
              <Link className="btn" href="/assistente/meta-whatsapp">
                Meta WhatsApp
              </Link>
              <Link className="btn" href="/assistente/configuracao">
                Configurar atendimento
              </Link>
            </div>
          </section>
        </>
      )}
      <section className={styles.panel}>
        <h2>Operação da equipe</h2>
        <p>
          Os avisos, agentes e vínculos existentes continuam disponíveis na
          Severina.
        </p>
        <div className={styles.actions} style={{ marginTop: 16 }}>
          <Link className="btn" href="/assistente/disparos">
            Feed de Disparos
          </Link>
          <Link className="btn" href="/assistente/conversas-equipe">
            Conversas da equipe
          </Link>
          <Link className="btn" href="/assistente/agentes">
            Agentes de aviso
          </Link>
        </div>
      </section>
      <VirtualCredit />
    </main>
  );
}
