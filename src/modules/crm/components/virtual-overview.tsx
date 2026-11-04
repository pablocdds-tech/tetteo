"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../client/api";
import { useAuth } from "../client/context";
import { useVirtualAccount } from "../client/virtual-channel-context";
import type { VirtualHealth, VirtualInboxResult } from "../virtual-types";
import { VirtualCredit, VirtualHeader } from "./virtual-header";
import styles from "./virtual-overview.module.css";
import common from "./virtual.module.css";
const STATUS: Record<string, string> = {
  OPEN: "Aberta",
  WAITING_CUSTOMER: "Aguardando cliente",
  WAITING_TEAM: "Aguardando equipe",
  ESCALATED: "Precisa da equipe",
  PAUSED: "Pausada",
  RESOLVED: "Resolvida",
};
export default function VirtualOverview() {
  const { selectedStoreId: storeId, user } = useAuth();
  const { accounts, loading: accountsLoading } = useVirtualAccount();
  const [result, setResult] = useState<{
    storeId: string;
    inbox: VirtualInboxResult;
    health: VirtualHealth;
  } | null>(null);
  const [error, setError] = useState("");
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
              : "Não foi possível consultar o atendimento.",
          );
      });
    return () => {
      alive = false;
    };
  }, [storeId]);
  const real = accounts.filter((account) => account.provider !== "DEMO");
  const active = real.filter((account) => account.active);
  const verified = real.filter(
    (account) => account.connectionState === "VERIFIED",
  );
  const recent =
    data?.inbox.items.filter((item) => !item.demo).slice(0, 5) ?? [];
  return (
    <main className={`${common.page} ${styles.page}`}>
      <VirtualHeader section="overview" />
      <p className={styles.unit}>
        {user.stores.find((store) => store.id === storeId)?.name}
      </p>
      {error && (
        <p className={common.error} role="alert">
          {error}
        </p>
      )}
      <section className={styles.connection} aria-labelledby="connection-title">
        <div>
          <h2 id="connection-title">
            {accountsLoading
              ? "Seu WhatsApp"
              : real.length
                ? active.length
                  ? "Seu atendimento está ativo"
                  : "Continue a configuração do WhatsApp"
                : "Comece conectando seu WhatsApp"}
          </h2>
          <p>
            {accountsLoading
              ? "Consultando os números desta unidade…"
              : real.length
                ? `${real.length} WhatsApp${real.length === 1 ? "" : "s"} cadastrado${real.length === 1 ? "" : "s"}. ${verified.length ? `${verified.length} com conexão verificada.` : "Abra a conexão para gerar o QR Code e ler com o celular."}`
                : "Gere o QR Code, leia com o celular e prepare o atendimento aos seus clientes."}
          </p>
          {real.length > 0 && (
            <div className={styles.names}>
              {real.slice(0, 3).map((account) => (
                <span key={account.id}>
                  {account.name}
                  <span
                    className={`${common.badge} ${account.active ? common.success : common.warning}`}
                  >
                    {account.active
                      ? "Atendimento ativo"
                      : "Configuração pendente"}
                  </span>
                </span>
              ))}
            </div>
          )}
        </div>
        <Link href="/assistente/conectar" className="btn btn-primary">
          {real.length ? "Abrir conexão e QR Code" : "Conectar WhatsApp"}
        </Link>
      </section>
      <div className={styles.content}>
        <section
          className={styles.conversations}
          aria-labelledby="recent-title"
        >
          <div className={styles.sectionTitle}>
            <h2 id="recent-title">Conversas recentes</h2>
            <Link href="/assistente/inbox">Ver atendimentos</Link>
          </div>
          {!data && !error ? (
            <p className={styles.empty}>Carregando conversas…</p>
          ) : recent.length ? (
            <ul className={styles.recent}>
              {recent.map((item) => (
                <li key={item.id}>
                  <Link href="/assistente/inbox">
                    <div>
                      <strong>{item.customerName}</strong>
                      <p>{item.lastMessage}</p>
                    </div>
                    <div>
                      <span>{STATUS[item.status] ?? item.status}</span>
                      <time dateTime={item.lastMessageAt}>
                        {new Date(item.lastMessageAt).toLocaleTimeString(
                          "pt-BR",
                          { hour: "2-digit", minute: "2-digit" },
                        )}
                      </time>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className={styles.empty}>
              <h3>As mensagens dos clientes aparecem aqui</h3>
              <p>
                Depois de conectar o número, as mensagens recebidas ficam
                reunidas nesta área.
              </p>
              <Link href="/assistente/conectar">Abrir conexão do WhatsApp</Link>
            </div>
          )}
        </section>
        <aside className={styles.next} aria-labelledby="next-title">
          <h2 id="next-title">Prepare seu atendimento</h2>
          <ol>
            <li>
              <Link href="/assistente/conectar">Conecte o WhatsApp</Link>
              <p>Leia o QR Code ou configure a API oficial.</p>
            </li>
            <li>
              <Link href="/assistente/configuracao">Configure a Severina</Link>
              <p>
                {data?.health.engine?.enabled
                  ? "Inteligência artificial ativada nesta unidade."
                  : "Escolha a IA e cadastre as informações da unidade."}
              </p>
            </li>
            <li>
              <Link href="/assistente/conectar">
                Teste e ative o atendimento
              </Link>
              <p>
                Confira a entrega no seu celular antes de liberar as respostas.
              </p>
            </li>
          </ol>
        </aside>
      </div>
      <div className={styles.bottom}>
        <Link href="/assistente/equipe">Equipe e avisos internos</Link>
        <Link href="/assistente/monitoramento">Ver monitoramento</Link>
      </div>
      <VirtualCredit />
    </main>
  );
}
