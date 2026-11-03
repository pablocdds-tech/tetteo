"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../client/api";
import { useAuth } from "../client/context";
import { useVirtualAccount } from "../client/virtual-channel-context";
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
  const {
    selectedAccountId: accountId,
    account,
    refreshAccounts,
  } = useVirtualAccount();
  const [data, setData] = useState<{
    storeId: string;
    accountId: string;
    health: VirtualHealth;
  } | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const health =
    data?.storeId === storeId && data.accountId === accountId
      ? data.health
      : null;
  const engine = health?.engine;
  useEffect(() => {
    if (!accountId) return;
    let alive = true;
    const refresh = () => {
      if (document.hidden) return;
      void api
        .get<VirtualHealth>(
          `/api/crm/virtual/health?${new URLSearchParams({ storeId, accountId })}`,
        )
        .then((result) => {
          if (alive) {
            setData({ storeId, accountId, health: result });
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
  }, [storeId, accountId, revision]);

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
          `${health.tokens} tokens. Teto diário: ${money(health.dailyBudgetMicros)}. Chamadas ao Gemini podem consumir cota e gerar custo na conta do provedor.`,
        ],
      ]
    : [];

  return (
    <main className={styles.page}>
      <VirtualHeader section="saude">
        <button
          className="btn"
          onClick={() => {
            setRevision((value) => value + 1);
            refreshAccounts();
          }}
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
          {accountId
            ? "Consultando a operação…"
            : "Selecione ou configure uma conta de canal para acompanhar a operação."}
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
                    ? "Conta ativada"
                    : "Conta pausada"}
              </span>
            </div>
            <p>
              <strong>Canal:</strong>{" "}
              {account?.provider === "DEMO"
                ? "demonstração local, sem destinatário real"
                : account?.provider === "META"
                  ? "Meta WhatsApp Business Platform"
                  : "Evolution"}
              .
            </p>
            <p>
              <strong>Processamento:</strong>{" "}
              {engine
                ? engine.enabled
                  ? `Gemini ativo · ${engine.model ?? "modelo configurado"}`
                  : "regras locais de demonstração, sem chamada de modelo"
                : "estado do modelo indisponível"}
              .
            </p>
            {engine && (
              <p className={styles.muted}>
                Configuração Gemini:{" "}
                {engine.credentialPresent ? "chave presente" : "sem chave"};{" "}
                {engine.test.state === "PASSED" &&
                engine.test.revision === engine.revision
                  ? "revisão atual testada"
                  : "revisão atual ainda não validada"}
                .{" "}
                <Link
                  className={styles.textLink}
                  href="/assistente/configuracao#gemini"
                >
                  Ver conexões
                </Link>
              </p>
            )}
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
              Cada conta possui verificação, webhook e teste de entrega
              próprios. Configure as contas em{" "}
              <Link className={styles.textLink} href="/assistente/evolution">
                Chips Evolution
              </Link>{" "}
              ou{" "}
              <Link
                className={styles.textLink}
                href="/assistente/meta-whatsapp"
              >
                Meta WhatsApp
              </Link>
              . A conexão usada pelos avisos da equipe continua separada.
            </p>
          </section>
        </>
      )}
      <VirtualCredit />
    </main>
  );
}
