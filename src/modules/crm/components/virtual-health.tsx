"use client";

import { useEffect, useState } from "react";
import { api } from "../client/api";
import { useAuth } from "../client/context";
import type { VirtualHealth } from "../virtual-types";
import { VirtualCredit, VirtualHeader } from "./virtual-header";
import styles from "./virtual.module.css";

const money = (micros: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 4,
  }).format(micros / 1_000_000);

export default function VirtualHealthPage() {
  const { selectedStoreId: storeId } = useAuth();
  const [data, setData] = useState<{
    storeId: string;
    health: VirtualHealth;
  } | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const health = data?.storeId === storeId ? data.health : null;
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      if (document.hidden) return;
      void api
        .get<VirtualHealth>(
          `/api/crm/virtual/health?storeId=${encodeURIComponent(storeId)}`,
        )
        .then((result) => {
          if (alive) {
            setData({ storeId, health: result });
            setError("");
          }
        })
        .catch((failure) => {
          if (alive)
            setError(
              failure instanceof Error
                ? failure.message
                : "Não foi possível consultar a saúde da operação.",
            );
        });
    };
    refresh();
    const timer = setInterval(refresh, 10000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [storeId, revision]);

  const metrics = health
    ? [
        [
          "Fila de mensagens",
          String(health.queuePending),
          `Espera da mensagem mais antiga: ${Math.ceil(health.queueDelayMs / 1000)} s.`,
        ],
        [
          "Escalações pendentes",
          String(health.pendingEscalations),
          `${health.failedAlerts} alerta(s) com falha. Reconhecimento fica registrado no inbox.`,
        ],
        [
          "Erros do canal",
          String(health.channelErrors),
          "Verifique a fila e o estado de cada envio antes de repetir uma ação.",
        ],
        [
          "Respostas vazias",
          String(health.emptyResponses),
          "Execuções sem texto devem ser investigadas antes da retomada.",
        ],
        [
          "Loops bloqueados",
          String(health.loopsBlocked),
          "Repetições interrompidas pelo limite de execução.",
        ],
        [
          "Custo registrado",
          money(health.costMicros),
          `${health.tokens} tokens. Teto diário: ${money(health.dailyBudgetMicros)}. Demonstração local sem cobrança de modelo.`,
        ],
      ]
    : [];

  return (
    <main className={styles.page}>
      <VirtualHeader section="saude">
        <button
          className="btn"
          onClick={() => setRevision((value) => value + 1)}
        >
          Atualizar
        </button>
      </VirtualHeader>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {!health && !error && (
        <p className={styles.empty} role="status">
          Consultando a operação…
        </p>
      )}
      {health && (
        <>
          <section className={styles.panel}>
            <div className={styles.sectionHeading}>
              <h2>{health.accountName}</h2>
              <span
                className={`${styles.badge} ${health.active && !health.circuitUntil ? styles.success : styles.warning}`}
              >
                {health.circuitUntil
                  ? "Proteção automática acionada"
                  : health.active
                    ? "Canal local ativo"
                    : "Demonstração não iniciada"}
              </span>
            </div>
            <p>
              Última entrada recebida:{" "}
              {health.lastWebhookAt
                ? new Date(health.lastWebhookAt).toLocaleString("pt-BR", {
                    timeZone: "America/Sao_Paulo",
                  })
                : "nenhuma registrada"}
              .
            </p>
            {health.circuitUntil && (
              <p className={styles.warning}>
                Proteção ativa até{" "}
                {new Date(health.circuitUntil).toLocaleString("pt-BR", {
                  timeZone: "America/Sao_Paulo",
                })}
                .
              </p>
            )}
            {health.lastError && (
              <p className={styles.error}>{health.lastError}</p>
            )}
          </section>
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
            <h2>Recuperação com rastreio</h2>
            <p>
              Assuma uma conversa para interromper a IA, confira a pendência e
              registre o que foi resolvido antes de retomar. Alertas com falha
              podem ser reenviados pela escalação. Uma aceitação do canal e um
              reconhecimento da equipe são estados diferentes.
            </p>
          </section>
          <section className={styles.panel}>
            <h2>Conexão de produção</h2>
            <p>
              O atendimento usa somente o adaptador de demonstração. A conexão
              Evolution existente atende outros fluxos e continua separada. A
              ativação de WhatsApp exige conta configurada, documentação do
              provedor e teste autorizado; esta tela não habilita envios reais.
            </p>
          </section>
        </>
      )}
      <VirtualCredit />
    </main>
  );
}
