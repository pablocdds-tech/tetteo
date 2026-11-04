"use client";
import Link from "next/link";
import { useVirtualAccount } from "../client/virtual-channel-context";
import styles from "./virtual.module.css";
import navigation from "./virtual-navigation.module.css";
type Section =
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
  | "meta"
  | "limites";
const CONFIGURATION = [
  ["configuracao", "/assistente/configuracao", "Inteligência artificial"],
  ["base", "/assistente/configuracao/informacoes", "Informações da unidade"],
  ["skills", "/assistente/configuracao/tom-de-voz", "Tom de voz"],
  ["limites", "/assistente/configuracao/limites", "Limites e responsáveis"],
];
export function VirtualHeader({
  section,
  children,
}: {
  section: Section;
  children?: React.ReactNode;
}) {
  const {
    accounts,
    selectedAccountId,
    accountMode,
    setAccountMode,
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
    "limites",
    "qualidade",
  ].includes(section);
  const separateDemonstration = ["inbox", "escalacoes"].includes(section);
  const visibleAccounts = separateDemonstration
    ? accounts.filter(
        (item) => (item.provider === "DEMO") === (accountMode === "DEMO"),
      )
    : accounts;
  const titles: Record<Section, string> = {
    overview: "Severina",
    inbox: "Atendimentos",
    escalacoes: "Pendências da equipe",
    saude: "Monitoramento",
    base: "Informações da unidade",
    conexoes: "Assistente",
    configuracao: "Assistente",
    skills: "Tom de voz",
    qualidade: "Qualidade do atendimento",
    evolution: "Conectar WhatsApp",
    meta: "Conectar WhatsApp",
    limites: "Limites e responsáveis",
  };
  const descriptions: Partial<Record<Section, string>> = {
    overview: "Seu atendimento e as conversas que precisam de atenção.",
    inbox: "Acompanhe as conversas e assuma quando precisar.",
    escalacoes: "Solicitações que precisam de uma pessoa da equipe.",
    saude: "Confira a conexão, a fila e os avisos da operação.",
    base: "O que a Severina pode informar aos seus clientes.",
    configuracao:
      "Configure a inteligência artificial e as informações do atendimento.",
    skills: "Escolha como a Severina recebe e orienta seus clientes.",
    qualidade: "Resultados e consumo das execuções do atendimento.",
    limites: "Defina quem recebe os alertas e os limites de uso.",
    evolution: "Conecte um número para atender seus clientes.",
    meta: "Conecte um número para atender seus clientes.",
  };
  const tabs = ["inbox", "escalacoes"].includes(section)
    ? [
        ["inbox", "/assistente/inbox", "Conversas"],
        ["escalacoes", "/assistente/inbox/pendencias", "Pendências"],
      ]
    : ["saude", "qualidade"].includes(section)
      ? [
          ["saude", "/assistente/monitoramento", "Saúde da operação"],
          [
            "qualidade",
            "/assistente/monitoramento/qualidade",
            "Qualidade e consumo",
          ],
        ]
      : ["configuracao", "base", "skills", "limites", "conexoes"].includes(
            section,
          )
        ? CONFIGURATION
        : [];
  return (
    <>
      <header className={styles.heading}>
        <div>
          <h1>{titles[section]}</h1>
          <p>{descriptions[section]}</p>
        </div>
        <div className={styles.actions}>
          {children}
          {[
            "inbox",
            "escalacoes",
            "saude",
            "qualidade",
            "configuracao",
            "base",
            "limites",
          ].includes(section) && (
            <Link className="btn" href="/assistente/conectar">
              Conectar WhatsApp
            </Link>
          )}
        </div>
      </header>
      {tabs.length > 0 && (
        <nav
          className={navigation.tabs}
          aria-label={
            ["inbox", "escalacoes"].includes(section)
              ? "Atendimentos"
              : ["saude", "qualidade"].includes(section)
                ? "Monitoramento"
                : "Configuração do assistente"
          }
        >
          {tabs.map(([key, href, label]) => (
            <Link
              key={key}
              href={href}
              aria-current={
                section === key ||
                (section === "conexoes" && key === "configuracao")
                  ? "page"
                  : undefined
              }
            >
              {label}
            </Link>
          ))}
        </nav>
      )}
      {chooseAccount && (
        <div className={navigation.accountRow}>
          {separateDemonstration && (
            <div
              className={navigation.accountModes}
              role="group"
              aria-label="Origem das conversas"
            >
              <button
                type="button"
                aria-pressed={accountMode === "REAL"}
                disabled={loading}
                onClick={() => setAccountMode("REAL")}
              >
                WhatsApp
              </button>
              <button
                type="button"
                aria-pressed={accountMode === "DEMO"}
                disabled={loading}
                onClick={() => setAccountMode("DEMO")}
              >
                Demonstração
              </button>
            </div>
          )}
          <label className={styles.field}>
            {separateDemonstration
              ? accountMode === "DEMO"
                ? "Demonstração Kairu"
                : "WhatsApp desta unidade"
              : "WhatsApp ou demonstração"}
            <select
              value={selectedAccountId}
              disabled={loading || visibleAccounts.length === 0}
              onChange={(event) => setSelectedAccountId(event.target.value)}
            >
              {visibleAccounts.length === 0 && (
                <option value="">
                  {loading
                    ? "Carregando…"
                    : accountMode === "DEMO"
                      ? "Nenhum exemplo preparado"
                      : "Nenhum WhatsApp cadastrado"}
                </option>
              )}
              {visibleAccounts.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                  {item.provider === "DEMO" ? " (demonstração)" : ""}
                </option>
              ))}
            </select>
          </label>
          {account && (
            <span
              className={`${styles.badge} ${account.active ? styles.success : styles.warning}`}
            >
              {account.provider === "DEMO"
                ? "Demonstração Kairu"
                : account.active
                  ? "IA ativa"
                  : "IA pausada"}
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
      Referência de fluxo:{" "}
      <a
        href="https://portal.kairulabs.com.br/images/solutions/atendimento-virtual-1.png"
        target="_blank"
        rel="noreferrer"
      >
        Kairu
      </a>
      . Exemplos identificados como demonstração usam dados fictícios.
    </p>
  );
}
