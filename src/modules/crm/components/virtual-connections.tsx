"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api } from "../client/api";
import { useAuth } from "../client/context";
import type { VirtualModelStatus } from "../virtual-types";
import { VirtualCredit, VirtualHeader } from "./virtual-header";
import styles from "./virtual.module.css";

const subscribe = () => () => {};
const secureOrigin = () =>
  window.location.protocol === "https:" ||
  ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
const money = (micros: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 6,
  }).format(micros / 1_000_000);
const problem = (failure: unknown) =>
  failure instanceof Error
    ? failure.message
    : "Não foi possível concluir a configuração do Gemini.";
const TEST_LABELS: Record<VirtualModelStatus["test"]["state"], string> = {
  NONE: "Sem teste realizado",
  PENDING: "Configuração salva; teste pendente",
  TESTING: "Teste em andamento",
  PASSED: "Teste concluído com sucesso",
  FAILED: "Teste falhou",
};

export default function VirtualConnections({
  embedded = false,
}: {
  embedded?: boolean;
}) {
  const { selectedStoreId: storeId } = useAuth();
  return (
    <VirtualConnectionForStore
      key={storeId}
      storeId={storeId}
      embedded={embedded}
    />
  );
}

function VirtualConnectionForStore({
  storeId,
  embedded,
}: {
  storeId: string;
  embedded: boolean;
}) {
  const { user } = useAuth();
  const manageable = user.role === "MANAGER";
  const secure = useSyncExternalStore(subscribe, secureOrigin, () => false);
  const [status, setStatus] = useState<VirtualModelStatus | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<{ name: string; displayName: string }[]>(
    [],
  );
  const [inputPrice, setInputPrice] = useState("0");
  const [outputPrice, setOutputPrice] = useState("0");
  const [ratesConfirmed, setRatesConfirmed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const pendingTest = useRef<{ revision: number; requestId: string } | null>(
    null,
  );
  const inputRate = Math.round(Number(inputPrice) * 1_000_000);
  const outputRate = Math.round(Number(outputPrice) * 1_000_000);
  const hasEdits = Boolean(
    status &&
    (apiKey ||
      model !== (status.model ?? "") ||
      inputRate !== status.rates.inputMicrosPerMillion ||
      outputRate !== status.rates.outputMicrosPerMillion ||
      ratesConfirmed !== status.rates.confirmed),
  );
  const testPassed =
    status?.test.state === "PASSED" && status.test.revision === status.revision;
  const configuredModelMissingFromList = Boolean(
    model && !models.some((item) => item.name === model),
  );

  function accept(result: VirtualModelStatus) {
    setStatus(result);
    setModel(result.model ?? "");
    setInputPrice(String(result.rates.inputMicrosPerMillion / 1_000_000));
    setOutputPrice(String(result.rates.outputMicrosPerMillion / 1_000_000));
    setRatesConfirmed(result.rates.confirmed);
  }

  useEffect(() => {
    let alive = true;
    void api
      .get<VirtualModelStatus>(
        `/api/crm/virtual/model?storeId=${encodeURIComponent(storeId)}`,
      )
      .then((result) => {
        if (alive) accept(result);
      })
      .catch((failure) => {
        if (alive) setError(problem(failure));
      });
    return () => {
      alive = false;
    };
  }, [storeId, revision]);

  async function loadModels() {
    const result = await api.post<{
      models: { name: string; displayName: string }[];
    }>("/api/crm/virtual/model", { storeId, action: "models" });
    setModels(result.models);
    return result.models;
  }

  async function save(withKey: boolean) {
    if (!secure || busy) return;
    setBusy("save");
    setError("");
    setNotice("");
    try {
      const result = await api.post<VirtualModelStatus>(
        "/api/crm/virtual/model",
        {
          storeId,
          action: "save",
          ...(withKey ? { apiKey: apiKey.trim() } : {}),
          model,
          ratesConfirmed,
          inputMicrosPerMillion: inputRate,
          outputMicrosPerMillion: outputRate,
        },
      );
      accept(result);
      pendingTest.current = null;
      setNotice(
        "Configuração privada salva. O teste desta revisão ainda precisa ser concluído antes da ativação.",
      );
      if (withKey) await loadModels();
    } catch (failure) {
      setError(problem(failure));
    } finally {
      setApiKey("");
      setBusy(null);
    }
  }

  async function listModels() {
    if (busy) return;
    setBusy("models");
    setError("");
    try {
      await loadModels();
      setNotice(
        "Lista consultada na API do Gemini. Escolha o modelo e confira os custos aplicáveis à sua conta.",
      );
    } catch (failure) {
      setError(problem(failure));
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    if (!status || busy || hasEdits) return;
    setBusy("test");
    setError("");
    setNotice("");
    if (pendingTest.current?.revision !== status.revision) {
      pendingTest.current = {
        revision: status.revision,
        requestId: crypto.randomUUID(),
      };
    }
    try {
      const result = await api.post<VirtualModelStatus>(
        "/api/crm/virtual/model",
        { storeId, action: "test", ...pendingTest.current },
      );
      accept(result);
      if (result.test.state === "PASSED" || result.test.state === "FAILED")
        pendingTest.current = null;
      if (result.test.state === "PASSED")
        setNotice(
          "Gemini respondeu ao teste fictício desta revisão. O modelo continua sujeito à ativação abaixo; nenhum WhatsApp foi enviado.",
        );
    } catch (failure) {
      setError(problem(failure));
      setRevision((value) => value + 1);
    } finally {
      setBusy(null);
    }
  }

  async function activate(enabled: boolean) {
    if (!status || busy) return;
    setBusy("activate");
    setError("");
    setNotice("");
    try {
      const result = await api.post<VirtualModelStatus>(
        "/api/crm/virtual/model",
        { storeId, action: "activate", revision: status.revision, enabled },
      );
      accept(result);
      setNotice(
        enabled
          ? "Gemini ativado para interpretar as mensagens desta unidade."
          : "Gemini desativado. Consulte o estado do processamento na saúde da operação.",
      );
    } catch (failure) {
      setError(problem(failure));
    } finally {
      setBusy(null);
    }
  }

  const Container = embedded ? "section" : "main";
  return (
    <Container className={embedded ? undefined : styles.page}>
      {!embedded && (
        <VirtualHeader section="conexoes">
          <button
            className="btn"
            disabled={Boolean(busy)}
            onClick={() => {
              setError("");
              setRevision((value) => value + 1);
            }}
          >
            Atualizar estado
          </button>
        </VirtualHeader>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
      {!status && !error && (
        <p className={styles.empty}>Consultando a conexão privada…</p>
      )}
      {status && (
        <>
          <section className={styles.panel}>
            <div className={styles.sectionHeading}>
              <h2>Processamento das mensagens</h2>
              <span
                className={`${styles.badge} ${status.enabled ? styles.success : styles.warning}`}
              >
                {status.enabled
                  ? `Gemini ativo · ${status.model ?? "modelo configurado"}`
                  : "Regras locais de demonstração"}
              </span>
            </div>
            <p>
              {status.credentialPresent
                ? status.source === "ENVIRONMENT"
                  ? "Há uma configuração privada no ambiente do servidor."
                  : "Há uma chave privada salva para esta unidade."
                : "Nenhuma chave do Gemini foi configurada nesta unidade."}{" "}
              A presença da chave, o teste e a ativação são estados separados.
            </p>
            <p className={styles.muted}>
              O modelo interpreta a intenção. Reservas, permissões e envio de
              mensagens continuam sendo controlados pelo servidor.
            </p>
            {status.blockers.length > 0 && (
              <ul className={styles.checklist}>
                {status.blockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            )}
          </section>
          {manageable ? (
            <>
              {!secure && (
                <p className={styles.error} role="alert">
                  Abra o endereço HTTPS autenticado do sistema para configurar a
                  chave. A entrada de credenciais está indisponível nesta
                  conexão.
                </p>
              )}
              {secure && (
                <>
                  <section className={styles.panel}>
                    <h2>Chave privada do Gemini</h2>
                    <p>
                      Insira a chave somente neste campo do sistema. Ela será
                      enviada ao servidor desta organização e não será exibida
                      novamente.
                    </p>
                    <p>
                      <a
                        className={styles.textLink}
                        href="https://aistudio.google.com/api-keys"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Criar ou gerenciar chave no Google AI Studio
                      </a>
                      . Depois, volte a este campo privado para configurá-la.
                    </p>
                    <form
                      className={styles.fields}
                      onSubmit={(event) => {
                        event.preventDefault();
                        void save(true);
                      }}
                      autoComplete="off"
                    >
                      <label className={styles.field}>
                        Chave da API do Gemini
                        <input
                          type="password"
                          name="gemini-private-key"
                          autoComplete="new-password"
                          spellCheck={false}
                          autoCapitalize="off"
                          value={apiKey}
                          required
                          disabled={Boolean(busy)}
                          onChange={(event) => setApiKey(event.target.value)}
                          maxLength={500}
                          placeholder={
                            status.credentialPresent
                              ? "Preencha para substituir a chave salva"
                              : "Insira a chave privada aqui"
                          }
                        />
                      </label>
                      <div className={styles.actions}>
                        <button
                          className="btn btn-primary"
                          disabled={Boolean(busy) || !apiKey.trim()}
                        >
                          {busy === "save"
                            ? "Salvando…"
                            : status.credentialPresent
                              ? "Substituir chave e consultar modelos"
                              : "Salvar chave e consultar modelos"}
                        </button>
                      </div>
                    </form>
                  </section>
                  <section className={styles.panel}>
                    <div className={styles.sectionHeading}>
                      <h2>Modelo e custos</h2>
                      <button
                        className="btn"
                        disabled={Boolean(busy) || !status.credentialPresent}
                        onClick={() => void listModels()}
                      >
                        {busy === "models"
                          ? "Consultando…"
                          : "Consultar modelos disponíveis"}
                      </button>
                    </div>
                    <p>
                      Confirme na{" "}
                      <a
                        className={styles.textLink}
                        href="https://ai.google.dev/gemini-api/docs/pricing"
                        target="_blank"
                        rel="noreferrer"
                      >
                        tabela oficial do Gemini
                      </a>{" "}
                      a tarifa do modelo e da modalidade usados na sua conta. Os
                      valores abaixo são em dólares por um milhão de tokens.
                      Informe zero somente quando a tarifa aplicável for
                      gratuita.
                    </p>
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        void save(false);
                      }}
                    >
                      <fieldset
                        disabled={Boolean(busy) || !status.credentialPresent}
                        className={styles.fields}
                        style={{ border: 0, minWidth: 0 }}
                      >
                        <label className={styles.field}>
                          Modelo Gemini
                          <select
                            value={model}
                            required
                            onChange={(event) => setModel(event.target.value)}
                          >
                            <option value="">
                              Selecione após consultar a API
                            </option>
                            {configuredModelMissingFromList && (
                              <option value={model}>
                                {model} · configuração atual
                              </option>
                            )}
                            {models.map((item) => (
                              <option key={item.name} value={item.name}>
                                {item.displayName || item.name} ({item.name})
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className={styles.field}>
                          Entrada: US$ por 1 milhão de tokens
                          <input
                            type="number"
                            value={inputPrice}
                            min="0"
                            step="0.000001"
                            max="1000000"
                            required
                            onChange={(event) =>
                              setInputPrice(event.target.value)
                            }
                          />
                        </label>
                        <label className={styles.field}>
                          Saída: US$ por 1 milhão de tokens
                          <input
                            type="number"
                            value={outputPrice}
                            min="0"
                            step="0.000001"
                            max="1000000"
                            required
                            onChange={(event) =>
                              setOutputPrice(event.target.value)
                            }
                          />
                        </label>
                        <label className={styles.checkboxLabel}>
                          <input
                            type="checkbox"
                            checked={ratesConfirmed}
                            onChange={(event) =>
                              setRatesConfirmed(event.target.checked)
                            }
                          />{" "}
                          Conferi estas tarifas para o modelo e a modalidade da
                          minha conta.
                        </label>
                        <button
                          type="submit"
                          className="btn"
                          disabled={!model || !hasEdits}
                        >
                          Salvar modelo e custos
                        </button>
                      </fieldset>
                    </form>
                    {hasEdits && (
                      <p className={styles.muted} style={{ marginTop: 12 }}>
                        Há alterações ainda não salvas. Salve a configuração
                        antes de testar ou ativar.
                      </p>
                    )}
                  </section>
                  <section className={styles.panel}>
                    <div className={styles.sectionHeading}>
                      <h2>Teste e ativação</h2>
                      <span
                        className={`${styles.badge} ${testPassed ? styles.success : styles.warning}`}
                      >
                        {TEST_LABELS[status.test.state]}
                      </span>
                    </div>
                    <p>
                      O teste faz uma requisição limitada ao Gemini com uma
                      mensagem fictícia. Pode consumir a cota da sua conta. Não
                      cria reserva nem envia WhatsApp.
                    </p>
                    {status.test.testedAt && (
                      <p className={styles.muted}>
                        Último teste:{" "}
                        {new Date(status.test.testedAt).toLocaleString("pt-BR")}{" "}
                        · {status.test.tokens} tokens · custo registrado{" "}
                        {money(status.test.costMicros)}.
                      </p>
                    )}
                    {status.test.state === "FAILED" && (
                      <p className={styles.error}>
                        O teste não validou a configuração. Confira a chave, o
                        modelo, a cota e as tarifas antes de repetir.
                      </p>
                    )}
                    <div className={styles.actions} style={{ marginTop: 16 }}>
                      <button
                        className="btn"
                        disabled={
                          Boolean(busy) ||
                          hasEdits ||
                          !status.credentialPresent ||
                          !status.model ||
                          !status.rates.confirmed
                        }
                        onClick={() => void test()}
                      >
                        {busy === "test"
                          ? "Testando Gemini…"
                          : "Testar com mensagem fictícia"}
                      </button>
                      {status.enabled ? (
                        <button
                          className="btn"
                          disabled={Boolean(busy)}
                          onClick={() => void activate(false)}
                        >
                          Desativar Gemini
                        </button>
                      ) : (
                        <button
                          className="btn btn-primary"
                          disabled={Boolean(busy) || hasEdits || !testPassed}
                          onClick={() => void activate(true)}
                        >
                          Ativar Gemini testado
                        </button>
                      )}
                    </div>
                  </section>
                </>
              )}
            </>
          ) : (
            <section className={styles.panel}>
              <h2>Configuração pela gestão</h2>
              <p>
                Seu perfil pode acompanhar o estado da conexão. Uma pessoa com
                permissão de gestão configura a chave, testa e ativa o modelo.
              </p>
            </section>
          )}
          <section className={styles.panel}>
            <div className={styles.sectionHeading}>
              <h2>Canal de atendimento</h2>
              <span className={styles.badge}>Conexões por conta e unidade</span>
            </div>
            <p>
              Configure as contas em{" "}
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
              . Consulte o estado verificado de cada conexão antes de ativar
              envios. Ativar Gemini não conecta nem autoriza um canal de
              WhatsApp.
            </p>
          </section>
        </>
      )}
      {!embedded && <VirtualCredit />}
    </Container>
  );
}
