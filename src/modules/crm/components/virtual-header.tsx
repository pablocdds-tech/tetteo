"use client";

import Link from "next/link";
import { useVirtualAccount } from "../client/virtual-channel-context";
import styles from "./virtual.module.css";

export function VirtualHeader({
  section,
  children,
}: {
  section:
    | "overview"
    | "inbox"
    | "escalacoes"
    | "saude"
    | "base"
    | "conexoes"
    | "configuracao"
    | "skills"
    | "qualidade"
    | "evolution"
    | "meta";
  children?: React.ReactNode;
}) {
  const {
    accounts,
    selectedAccountId,
    setSelectedAccountId,
    account,
    loading,
    error,
  } = useVirtualAccount();
  const chooseAccount = [
    "inbox",
    "escalacoes",
    "saude",
    "base",
    "conexoes",
    "configuracao",
    "qualidade",
  ].includes(section);
  const titles = {
    overview: "Severina",
    inbox: "Inbox",
    escalacoes: "Escalações da equipe",
    saude: "Saúde do atendimento",
    base: "Informações da unidade",
    conexoes: "Conexões do atendimento",
    configuracao: "Configuração da Severina",
    skills: "Skills / Tom de voz",
    qualidade: "Qualidade do atendimento",
    evolution: "Chips Evolution",
    meta: "Meta WhatsApp",
  };
  return (
    <>
      <header className={styles.heading}>
        <div>
          <h1>{titles[section]}</h1>
          <p>
            Conversas com contexto, reservas e passagem para uma pessoa da
            Vitaliano.
          </p>
        </div>
        {children}
      </header>
      <div className={styles.toolbar}>
        <nav className={styles.navigation} aria-label="Atendimento da Severina">
          {[
            ["overview", "/assistente", "Overview"],
            ["inbox", "/assistente/inbox", "Inbox"],
            ["escalacoes", "/assistente/escalacoes", "Escalações"],
            ["saude", "/assistente/saude", "Saúde da operação"],
            ["configuracao", "/assistente/configuracao", "Configuração"],
          ].map(([key, href, label]) => (
            <Link
              key={key}
              href={href}
              aria-current={section === key ? "page" : undefined}
            >
              {label}
            </Link>
          ))}
        </nav>
      </div>
      {chooseAccount && (
        <div className={styles.channelBar}>
          <label className={styles.field}>
            Conta do canal
            <select
              value={selectedAccountId}
              disabled={loading || accounts.length === 0}
              onChange={(event) => setSelectedAccountId(event.target.value)}
            >
              {accounts.length === 0 && (
                <option value="">
                  {loading ? "Carregando contas…" : "Nenhuma conta configurada"}
                </option>
              )}
              {accounts.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ·{" "}
                  {item.provider === "DEMO"
                    ? "Demonstração"
                    : item.provider === "META"
                      ? "Meta oficial"
                      : "Evolution"}
                </option>
              ))}
            </select>
          </label>
          {account && (
            <span
              className={`${styles.badge} ${account.active ? styles.success : styles.warning}`}
            >
              {account.provider === "DEMO"
                ? "Canal local de demonstração"
                : account.active
                  ? "Conta ativada"
                  : "Conta pausada"}
            </span>
          )}
          {error && (
            <span className={styles.danger} role="alert">
              {error}
            </span>
          )}
        </div>
      )}
    </>
  );
}

export function VirtualCredit() {
  return (
    <p className={styles.credit}>
      Fluxo e composição inspirados nas prévias ilustrativas de atendimento da{" "}
      <a
        href="https://portal.kairulabs.com.br/images/solutions/atendimento-virtual-1.png"
        target="_blank"
        rel="noreferrer"
      >
        Kairu
      </a>
      , adaptados ao Tetteo. Os exemplos não comprovam atendimento ou entrega
      real.
    </p>
  );
}
