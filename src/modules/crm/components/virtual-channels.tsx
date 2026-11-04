"use client";

import Image from "next/image";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { api } from "../client/api";
import { useAuth } from "../client/context";
import {
  useVirtualAccount,
  type VirtualChannelAccount,
  type VirtualChannelsResult,
} from "../client/virtual-channel-context";
import { VirtualCredit, VirtualHeader } from "./virtual-header";
import common from "./virtual.module.css";
import styles from "./virtual-channels.module.css";

type Provider = "EVOLUTION" | "META";
type ConnectionResult = {
  state: "CONNECTED" | "QR" | "CONNECTING" | "UNAVAILABLE";
  qrDataUrl: string | null;
  expiresAt: string | null;
  status: string;
};
type ConnectionAttempt = {
  accountId: string;
  startedAt: number;
  result: ConnectionResult;
};
type ChannelAction =
  | "connect"
  | "status"
  | "verify"
  | "createInstance"
  | "webhook"
  | "activate"
  | "sendTest"
  | "ackTest"
  | "reconcileTest";
const subscribe = () => () => {};
const secureOrigin = () =>
  location.protocol === "https:" ||
  ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
const errorText = (failure: unknown) =>
  failure instanceof Error
    ? failure.message
    : "Não foi possível confirmar a operação. Tente atualizar o status.";
const TEST_STATE = {
  SENDING: "Envio solicitado",
  ACCEPTED: "Aceito pelo provedor; entrega pendente",
  DELIVERED: "Entrega confirmada pelo provedor",
  FAILED: "O envio falhou",
  UNCERTAIN: "Resultado incerto; consulte o status",
};
const CONNECTION = {
  PENDING: "Aguardando conexão",
  VERIFIED: "Conexão verificada",
  FAILED: "Conexão precisa de atenção",
};
function randomSecret() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

export default function VirtualChannelsPage({
  provider = "EVOLUTION",
}: {
  provider?: Provider;
}) {
  const { selectedStoreId: storeId } = useAuth();
  return (
    <ChannelsForStore
      key={`${storeId}:${provider}`}
      initialProvider={provider}
      storeId={storeId}
    />
  );
}

function ChannelsForStore({
  initialProvider,
  storeId,
}: {
  initialProvider: Provider;
  storeId: string;
}) {
  const { user } = useAuth();
  const { refreshAccounts, setSelectedAccountId } = useVirtualAccount();
  const manageable = user.role === "MANAGER";
  const secure = useSyncExternalStore(subscribe, secureOrigin, () => false);
  const [provider, setProvider] = useState(initialProvider);
  const [data, setData] = useState<VirtualChannelsResult | null>(null);
  // null selects an existing account; an empty string explicitly starts a new one.
  const [selected, setSelected] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [quickBusy, setQuickBusy] = useState(false);
  const [quickName, setQuickName] = useState("");
  const [initialConnection, setInitialConnection] =
    useState<ConnectionAttempt | null>(null);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  useEffect(() => {
    let alive = true;
    void api
      .get<VirtualChannelsResult>(
        `/api/crm/virtual/channels?storeId=${encodeURIComponent(storeId)}`,
      )
      .then((result) => {
        if (alive) {
          setData(result);
          setError("");
        }
      })
      .catch((failure) => {
        if (alive) setError(errorText(failure));
      });
    return () => {
      alive = false;
    };
  }, [storeId, revision]);
  const accounts =
    data?.accounts.filter((item) => item.provider === provider) ?? [];
  const account =
    selected === ""
      ? null
      : (accounts.find((item) => item.id === selected) ?? accounts[0] ?? null);
  const accountId = account?.id;
  useEffect(() => {
    if (accountId) setSelectedAccountId(accountId);
  }, [accountId, setSelectedAccountId]);
  const onResult = useCallback(
    (value: VirtualChannelsResult, savedId?: string) => {
      if (!live.current) return;
      setData(value);
      refreshAccounts();
      if (savedId) {
        setSelected(savedId);
        setSelectedAccountId(savedId);
      }
    },
    [refreshAccounts, setSelectedAccountId],
  );

  async function quickConnect() {
    if (quickBusy || !data?.managedEvolutionAvailable || !secure) return;
    setQuickBusy(true);
    setError("");
    try {
      const setup = await api.post<VirtualChannelsResult>(
        "/api/crm/virtual/channels",
        { storeId, action: "quickSetup", name: quickName.trim() || undefined },
      );
      if (!live.current) return;
      const saved = setup.accounts.find(
        (item) => item.id === setup.createdAccountId,
      );
      if (!saved)
        throw new Error("A conta não foi identificada. Atualize as conexões.");
      // Keep the saved account if preparing its QR fails; retry connects it.
      onResult(setup, saved.id);
      const startedAt = Date.now();
      const result = await api.post<ConnectionResult>(
        "/api/crm/virtual/channels",
        {
          storeId,
          accountId: saved.id,
          revision: saved.revision,
          action: "connect",
        },
      );
      if (live.current) {
        setInitialConnection({ accountId: saved.id, startedAt, result });
        if (result.state === "CONNECTED") {
          const current = await api.get<VirtualChannelsResult>(
            `/api/crm/virtual/channels?storeId=${encodeURIComponent(storeId)}`,
          );
          if (live.current) onResult(current);
        }
      }
    } catch (failure) {
      if (live.current) setError(errorText(failure));
    } finally {
      if (live.current) setQuickBusy(false);
    }
  }

  return (
    <main className={`${common.page} ${styles.page}`}>
      <VirtualHeader
        section={provider === "EVOLUTION" ? "evolution" : "meta"}
      />
      <div className={styles.methods} aria-label="Como conectar o WhatsApp">
        {(
          [
            [
              "EVOLUTION",
              "Ler QR no celular",
              "Conectar pelo WhatsApp do aparelho",
            ],
            [
              "META",
              "API oficial (Meta)",
              "Usar uma conta WhatsApp Business Platform",
            ],
          ] as const
        ).map(([value, label, description]) => (
          <button
            className={styles.method}
            type="button"
            key={value}
            aria-pressed={provider === value}
            disabled={quickBusy}
            onClick={() => {
              setProvider(value);
              setSelected(null);
              setError("");
              setInitialConnection(null);
              setQuickName("");
            }}
          >
            <strong>{label}</strong>
            <span>{description}</span>
          </button>
        ))}
      </div>
      {error && (
        <p className={common.error} role="alert">
          {error}
        </p>
      )}
      {!data && !error && (
        <p className={common.empty}>Consultando conexões desta unidade…</p>
      )}
      {data && (
        <>
          <div className={styles.accountBar}>
            {accounts.length > 0 ? (
              <label className={common.field}>
                WhatsApp desta unidade
                <select
                  value={account?.id ?? ""}
                  disabled={quickBusy}
                  onChange={(event) => {
                    setSelected(event.target.value);
                    setInitialConnection(null);
                    setError("");
                  }}
                >
                  {selected === "" && <option value="">Nova conexão</option>}
                  {accounts.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className={common.muted}>
                {provider === "EVOLUTION"
                  ? "Primeiro WhatsApp de clientes desta unidade"
                  : "Cadastre a conta empresarial autorizada pela Meta."}
              </p>
            )}
            <div className={common.actions}>
              <button
                className="btn"
                disabled={quickBusy}
                onClick={() => setRevision((value) => value + 1)}
              >
                Atualizar
              </button>
              {manageable && accounts.length > 0 && account && (
                <button
                  className="btn"
                  disabled={quickBusy}
                  onClick={() => {
                    setSelected("");
                    setInitialConnection(null);
                    setError("");
                  }}
                >
                  Adicionar WhatsApp
                </button>
              )}
            </div>
          </div>
          {manageable ? (
            <>
              {!account &&
                provider === "EVOLUTION" &&
                data.managedEvolutionAvailable &&
                secure && (
                  <section className={styles.quickSetup}>
                    <div>
                      <h2>Conecte o WhatsApp pelo QR Code</h2>
                      <p>
                        Use a configuração privada do restaurante. Gere o código
                        e leia pelo celular que usa esse número.
                      </p>
                      <form
                        className={styles.quickForm}
                        onSubmit={(event) => {
                          event.preventDefault();
                          void quickConnect();
                        }}
                      >
                        <label className={common.field}>
                          Nome para identificar este WhatsApp (opcional)
                          <input
                            value={quickName}
                            maxLength={100}
                            disabled={quickBusy}
                            placeholder="Ex.: Atendimento da unidade Centro"
                            onChange={(event) =>
                              setQuickName(event.target.value)
                            }
                          />
                        </label>
                        <button
                          className="btn btn-primary"
                          disabled={quickBusy}
                        >
                          {quickBusy ? "Preparando QR Code…" : "Gerar QR Code"}
                        </button>
                      </form>
                    </div>
                    <PhoneInstructions />
                  </section>
                )}
              <ChannelManager
                key={`${provider}:${account?.id ?? "new"}:${account?.revision ?? 0}`}
                provider={provider}
                account={account}
                data={data}
                storeId={storeId}
                onResult={onResult}
                initialConnection={initialConnection}
                connecting={quickBusy}
              />
            </>
          ) : (
            <section className={styles.section}>
              <h2>Conexão pela gestão</h2>
              <p>
                {account
                  ? `${account.name}: ${CONNECTION[account.connectionState]}. Atendimento automático ${account.active ? "ativo" : "pausado"}.`
                  : "Nenhum WhatsApp cadastrado nesta opção."}{" "}
                A gestão pode conectar o número, testar e ativar o atendimento.
              </p>
            </section>
          )}
          <p className={styles.providerNote}>
            {provider === "EVOLUTION"
              ? "Conexão por Evolution, separada dos avisos da equipe. Não equivale à aprovação da API oficial da Meta."
              : "A API oficial é configurada com as credenciais da conta empresarial. Esta opção não usa QR Code."}{" "}
            <a
              href={
                provider === "META"
                  ? "https://developers.facebook.com/docs/whatsapp/"
                  : "https://doc.evolution-api.com/v2/pt/"
              }
              target="_blank"
              rel="noreferrer"
            >
              Documentação do provedor
            </a>
          </p>
        </>
      )}
      <VirtualCredit />
    </main>
  );
}

function PhoneInstructions() {
  return (
    <div className={styles.phoneInstructions}>
      <h3>No celular do restaurante</h3>
      <ol>
        <li>Abra o WhatsApp.</li>
        <li>Entre em Dispositivos conectados.</li>
        <li>Toque em Conectar dispositivo e leia o QR Code.</li>
      </ol>
    </div>
  );
}

function ChannelManager({
  provider,
  account,
  data,
  storeId,
  onResult,
  initialConnection,
  connecting,
}: {
  provider: Provider;
  account: VirtualChannelAccount | null;
  data: VirtualChannelsResult;
  storeId: string;
  onResult: (result: VirtualChannelsResult, savedId?: string) => void;
  initialConnection: ConnectionAttempt | null;
  connecting: boolean;
}) {
  const secure = useSyncExternalStore(subscribe, secureOrigin, () => false);
  const [name, setName] = useState(account?.name ?? "");
  const [url, setUrl] = useState(
    account?.settings.url ?? data.allowedEvolutionOrigins[0] ?? "",
  );
  const [instance, setInstance] = useState(account?.settings.instance ?? "");
  const [phoneNumberId, setPhoneNumberId] = useState(
    account?.settings.phoneNumberId ?? "",
  );
  const [businessAccountId, setBusinessAccountId] = useState(
    account?.settings.businessAccountId ?? "",
  );
  const [apiVersion, setApiVersion] = useState(
    account?.settings.apiVersion ?? "v26.0",
  );
  const [apiKey, setApiKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [verifyToken, setVerifyToken] = useState("");
  const [recipient, setRecipient] = useState("");
  const [confirmedNumber, setConfirmedNumber] = useState(false);
  const [confirmedObserved, setConfirmedObserved] = useState(false);
  const [replaceWebhook, setReplaceWebhook] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [attempt, setAttempt] = useState<ConnectionAttempt | null>(null);
  const [pollNote, setPollNote] = useState("");
  const live = useRef(true);
  const testRequest = useRef<{
    accountId: string;
    revision: number;
    recipient: string;
    requestId: string;
  } | null>(null);
  const activeAttempt =
    attempt ??
    (initialConnection?.accountId === account?.id ? initialConnection : null);
  const connection = activeAttempt?.result ?? null;
  const blocked = Boolean(busy) || connecting;
  const creating = !account;
  const edited = Boolean(
    account &&
    (name !== account.name ||
      url !== (account.settings.url ?? data.allowedEvolutionOrigins[0] ?? "") ||
      instance !== (account.settings.instance ?? "") ||
      phoneNumberId !== (account.settings.phoneNumberId ?? "") ||
      businessAccountId !== (account.settings.businessAccountId ?? "") ||
      apiVersion !== (account.settings.apiVersion ?? "v26.0") ||
      apiKey ||
      webhookSecret ||
      accessToken ||
      appSecret ||
      verifyToken),
  );
  const reserved =
    provider === "EVOLUTION" &&
    Boolean(instance && instance === data.legacyReservedInstance);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const accountId = account?.id;
  const accountRevision = account?.revision;
  const startedAt = activeAttempt?.startedAt;
  const expiresAt = connection?.expiresAt;
  const connectionState = connection?.state;
  useEffect(() => {
    if (
      !accountId ||
      accountRevision === undefined ||
      !startedAt ||
      busy ||
      !connectionState ||
      connectionState === "CONNECTED" ||
      connectionState === "UNAVAILABLE"
    )
      return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const deadline = Math.min(
      startedAt + 45000,
      expiresAt ? new Date(expiresAt).getTime() : Infinity,
    );
    const controller = new AbortController();
    const cutoff = setTimeout(
      () => {
        alive = false;
        controller.abort();
        clearTimeout(timer);
        setPollNote(
          "Consulta automática encerrada. Você pode atualizar o status.",
        );
      },
      Math.max(0, deadline - Date.now()),
    );
    async function poll() {
      if (!alive) return;
      if (Date.now() >= deadline) {
        setPollNote(
          "Consulta automática encerrada. Você pode atualizar o status.",
        );
        return;
      }
      try {
        const result = await api.post<VirtualChannelsResult>(
          "/api/crm/virtual/channels",
          { storeId, accountId, revision: accountRevision, action: "status" },
          { signal: controller.signal },
        );
        if (!alive) return;
        onResult(result);
        if (
          result.accounts.find((item) => item.id === accountId)
            ?.connectionState === "VERIFIED"
        ) {
          setAttempt({
            accountId: accountId!,
            startedAt: startedAt!,
            result: {
              state: "CONNECTED",
              qrDataUrl: null,
              expiresAt: null,
              status: "Número conectado ao WhatsApp.",
            },
          });
          return;
        }
        timer = setTimeout(poll, 3000);
      } catch (failure) {
        if (alive) setPollNote(errorText(failure));
      }
    }
    timer = setTimeout(poll, 3000);
    return () => {
      alive = false;
      clearTimeout(timer);
      clearTimeout(cutoff);
      controller.abort();
    };
  }, [
    accountId,
    accountRevision,
    startedAt,
    expiresAt,
    connectionState,
    busy,
    storeId,
    onResult,
  ]);
  useEffect(() => {
    if (!expiresAt || !activeAttempt || connectionState !== "QR") return;
    const savedAttempt = activeAttempt;
    const timer = setTimeout(
      () => {
        setAttempt({
          ...savedAttempt,
          result: {
            state: "UNAVAILABLE",
            qrDataUrl: null,
            expiresAt: null,
            status: "O QR Code expirou. Gere outro para conectar o número.",
          },
        });
      },
      Math.max(0, new Date(expiresAt).getTime() - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [expiresAt, activeAttempt, connectionState]);

  async function save() {
    if (!secure || blocked) return;
    setBusy("save");
    setError("");
    setNotice("");
    try {
      const settings =
        provider === "EVOLUTION"
          ? {
              url,
              instance,
              ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
              ...(webhookSecret ? { webhookSecret } : {}),
            }
          : {
              phoneNumberId,
              businessAccountId,
              apiVersion,
              ...(accessToken.trim()
                ? { accessToken: accessToken.trim() }
                : {}),
              ...(appSecret ? { appSecret } : {}),
              ...(verifyToken ? { verifyToken } : {}),
            };
      const result = await api.post<VirtualChannelsResult>(
        "/api/crm/virtual/channels",
        {
          storeId,
          action: "save",
          provider,
          name: name.trim(),
          ...(account ? { accountId: account.id } : {}),
          ...settings,
        },
      );
      if (!live.current) return;
      const saved = result.accounts.find(
        (item) =>
          item.provider === provider &&
          (provider === "META"
            ? item.settings.phoneNumberId === phoneNumberId
            : item.settings.url === url && item.settings.instance === instance),
      );
      onResult(result, saved?.id);
      setNotice(
        "Conexão salva. Agora conecte o número e faça o teste de entrega.",
      );
    } catch (failure) {
      if (live.current) setError(errorText(failure));
    } finally {
      setApiKey("");
      setWebhookSecret("");
      setAccessToken("");
      setAppSecret("");
      setVerifyToken("");
      if (live.current) setBusy(null);
    }
  }
  async function act(
    action: ChannelAction,
    extra: Record<string, unknown> = {},
  ) {
    if (!account || blocked || !secure) return;
    setBusy(action);
    setError("");
    setNotice("");
    setPollNote("");
    try {
      if (action === "sendTest") {
        if (
          testRequest.current?.accountId !== account.id ||
          testRequest.current.revision !== account.revision ||
          testRequest.current.recipient !== recipient
        )
          testRequest.current = {
            accountId: account.id,
            revision: account.revision,
            recipient,
            requestId: crypto.randomUUID(),
          };
        extra = {
          ...extra,
          recipient,
          requestId: testRequest.current.requestId,
          confirmedTestNumber: confirmedNumber,
        };
      }
      const startedAt = Date.now();
      const result = await api.post<VirtualChannelsResult | ConnectionResult>(
        "/api/crm/virtual/channels",
        {
          storeId,
          accountId: account.id,
          action,
          revision: account.revision,
          ...extra,
        },
      );
      if (!live.current) return;
      if ("qrDataUrl" in result) {
        setAttempt({ accountId: account.id, startedAt, result });
        if (result.state === "CONNECTED") {
          const current = await api.get<VirtualChannelsResult>(
            `/api/crm/virtual/channels?storeId=${encodeURIComponent(storeId)}`,
          );
          if (live.current) onResult(current);
        }
      } else {
        onResult(result);
        if (action === "status" || action === "verify") {
          const verified =
            result.accounts.find((item) => item.id === account.id)
              ?.connectionState === "VERIFIED";
          if (verified || connection?.state === "CONNECTED")
            setAttempt({
              accountId: account.id,
              startedAt,
              result: {
                state: verified ? "CONNECTED" : "UNAVAILABLE",
                qrDataUrl: null,
                expiresAt: null,
                status: verified
                  ? "Conexão verificada pelo provedor."
                  : "O provedor ainda não confirmou a conexão do número.",
              },
            });
        }
        setNotice(
          action === "activate"
            ? extra.enabled
              ? "Atendimento automático ativado após a validação do servidor."
              : "Atendimento automático pausado."
            : action === "sendTest"
              ? "Teste solicitado. Aguarde a confirmação de entrega do provedor."
              : action === "ackTest"
                ? "Recebimento observado e registrado."
                : action === "webhook"
                  ? "Recebimento de mensagens configurado. Aguarde uma entrada autêntica."
                  : action === "createInstance"
                    ? "Instância criada. Gere o QR Code para conectar o número."
                    : "Status atualizado pelo provedor.",
        );
      }
    } catch (failure) {
      if (live.current) setError(errorText(failure));
    } finally {
      if (live.current) setBusy(null);
    }
  }

  if (!secure)
    return (
      <section className={styles.section}>
        <h2>Conexão privada</h2>
        <p className={common.error}>
          Abra o endereço HTTPS autenticado do sistema para conectar o WhatsApp.
        </p>
      </section>
    );
  const numberConnected = connection
    ? connection.state === "CONNECTED"
    : account?.connectionState === "VERIFIED";
  const canActivate = Boolean(
    account &&
    !edited &&
    account.blockers.length === 0 &&
    account.connectionState === "VERIFIED" &&
    account.latestTest?.state === "DELIVERED" &&
    account.latestTest.observedAt,
  );
  return (
    <>
      {error && (
        <p className={common.error} role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className={common.notice} role="status">
          {notice}
        </p>
      )}
      {account && (
        <>
          <section className={styles.connection} aria-label="Conectar número">
            <div className={styles.connectionHeading}>
              <div>
                <h2>
                  {numberConnected
                    ? provider === "EVOLUTION"
                      ? "Número conectado ao WhatsApp"
                      : "Conexão com a Meta verificada"
                    : provider === "EVOLUTION"
                      ? "Conecte seu número pelo celular"
                      : "Verifique a conexão com a Meta"}
                </h2>
                <p>
                  {account.name}. Conectar o número e ativar o atendimento
                  automático são etapas separadas.
                </p>
              </div>
              <span
                className={`${common.badge} ${account.active ? common.success : common.warning}`}
              >
                IA {account.active ? "ativa" : "pausada"}
              </span>
            </div>
            <div className={styles.connectionGrid}>
              <div>
                <div className={common.actions}>
                  {provider === "EVOLUTION" && (
                    <button
                      className={numberConnected ? "btn" : "btn btn-primary"}
                      disabled={blocked || edited}
                      onClick={() => void act("connect")}
                    >
                      {busy === "connect" || connecting
                        ? "Preparando QR Code…"
                        : "Gerar QR Code"}
                    </button>
                  )}
                  <button
                    className={
                      provider === "META" && !numberConnected
                        ? "btn btn-primary"
                        : "btn"
                    }
                    disabled={blocked || edited}
                    onClick={() => void act("status")}
                  >
                    {busy === "status"
                      ? "Consultando…"
                      : "Atualizar status da conexão"}
                  </button>
                </div>
                {edited && (
                  <p className={common.warning}>
                    Salve as alterações em Editar conexão antes de continuar.
                  </p>
                )}
                {connection ? (
                  <div className={styles.qrStage} role="status">
                    <p
                      className={
                        connection.state === "CONNECTED" ? common.success : ""
                      }
                    >
                      {connection.status}
                    </p>
                    {connection.qrDataUrl && (
                      <Image
                        className={styles.qr}
                        src={connection.qrDataUrl}
                        width={288}
                        height={288}
                        unoptimized
                        alt="QR Code privado para conectar o WhatsApp desta unidade"
                      />
                    )}
                    {connection.expiresAt && (
                      <p>
                        Válido até{" "}
                        {new Date(connection.expiresAt).toLocaleTimeString(
                          "pt-BR",
                        )}
                        .
                      </p>
                    )}
                    {pollNote && <p>{pollNote}</p>}
                  </div>
                ) : (
                  <p className={styles.connectionHint}>
                    {connecting
                      ? "Preparando a conexão. Aguarde o QR Code aparecer aqui."
                      : numberConnected
                        ? "A conexão foi verificada pelo provedor. Confira o teste de entrega antes de ativar a IA."
                        : provider === "EVOLUTION"
                          ? "Clique em Gerar QR Code. O código aparecerá aqui para você ler pelo celular."
                          : "A consulta usa as credenciais salvas. Esta opção não usa QR Code."}
                  </p>
                )}
                {account.lastError && (
                  <p className={common.danger}>{account.lastError}</p>
                )}
              </div>
              {provider === "EVOLUTION" ? (
                <PhoneInstructions />
              ) : (
                <div className={styles.phoneInstructions}>
                  <h3>Conta oficial da Meta</h3>
                  <p>
                    Depois de verificar a conexão, configure o recebimento de
                    mensagens abaixo e teste a entrega no seu número de teste.
                  </p>
                </div>
              )}
            </div>
          </section>
          <ol className={styles.progress} aria-label="Etapas do atendimento">
            <li>
              <strong>Conexão cadastrada</strong>
              <span>Credenciais salvas</span>
            </li>
            <li>
              <strong>Conectar número</strong>
              <span>{numberConnected ? "Verificado" : "Pendente"}</span>
            </li>
            <li>
              <strong>Testar entrega</strong>
              <span>
                {account.latestTest?.state === "DELIVERED" &&
                account.latestTest.observedAt
                  ? "Confirmado e observado"
                  : "Pendente"}
              </span>
            </li>
            <li>
              <strong>Ativar atendimento</strong>
              <span>{account.active ? "IA ativa" : "IA pausada"}</span>
            </li>
          </ol>
        </>
      )}
      <details
        className={styles.disclosure}
        open={
          creating &&
          !(provider === "EVOLUTION" && data.managedEvolutionAvailable)
        }
      >
        <summary>
          {account
            ? "Editar conexão"
            : provider === "META"
              ? "Cadastrar conta da API oficial"
              : data.managedEvolutionAvailable
                ? "Usar outro servidor Evolution"
                : "Configurar servidor Evolution"}
        </summary>
        <div className={styles.disclosureBody}>
          {creating &&
            provider === "EVOLUTION" &&
            !data.managedEvolutionAvailable && (
              <p>
                A conexão rápida ainda não está disponível nesta instalação.
                Preencha os dados de um servidor Evolution autorizado para
                continuar.
              </p>
            )}
          <p className={common.muted}>
            Preencha credenciais somente neste painel privado. Campos privados
            em branco preservam o valor salvo.
          </p>
          <form
            autoComplete="off"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <fieldset disabled={blocked} className={styles.fields}>
              <label className={common.field}>
                Nome deste WhatsApp
                <input
                  value={name}
                  required
                  minLength={2}
                  maxLength={100}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Ex.: Atendimento Centro"
                />
              </label>
              {provider === "EVOLUTION" ? (
                <>
                  <label className={common.field}>
                    Servidor Evolution autorizado
                    <select
                      value={url}
                      required
                      disabled={!creating}
                      onChange={(event) => setUrl(event.target.value)}
                    >
                      {!url && (
                        <option value="">Nenhum servidor autorizado</option>
                      )}
                      {url && !data.allowedEvolutionOrigins.includes(url) && (
                        <option value={url}>{url} · configuração salva</option>
                      )}
                      {data.allowedEvolutionOrigins.map((origin) => (
                        <option key={origin} value={origin}>
                          {origin}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={common.field}>
                    Instância exclusiva para os clientes
                    <input
                      value={instance}
                      required
                      disabled={!creating}
                      maxLength={100}
                      onChange={(event) => setInstance(event.target.value)}
                    />
                  </label>
                  <label className={common.field}>
                    Chave da API Evolution
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={apiKey}
                      required={creating}
                      maxLength={1000}
                      onChange={(event) => setApiKey(event.target.value)}
                      placeholder={
                        account?.credentialPresent
                          ? "Preencha apenas para substituir"
                          : "Chave privada do servidor"
                      }
                    />
                  </label>
                  <label className={common.field}>
                    Segredo privado para receber mensagens
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={webhookSecret}
                      required={creating}
                      minLength={32}
                      maxLength={1000}
                      onChange={(event) => setWebhookSecret(event.target.value)}
                    />
                    <button
                      type="button"
                      className={`btn ${styles.fitButton}`}
                      onClick={() => setWebhookSecret(randomSecret())}
                    >
                      Gerar segredo privado
                    </button>
                  </label>
                  {!data.allowedEvolutionOrigins.length && (
                    <p className={common.warning}>
                      A administração precisa autorizar o endereço do servidor
                      Evolution no ambiente privado do projeto.
                    </p>
                  )}
                  {reserved && (
                    <p className={common.error}>
                      Esta instância está reservada para os avisos da equipe.
                      Use outra para atender clientes.
                    </p>
                  )}
                </>
              ) : (
                <>
                  <label className={common.field}>
                    ID do número de telefone na Meta
                    <input
                      value={phoneNumberId}
                      required
                      disabled={!creating}
                      inputMode="numeric"
                      pattern="[0-9]+"
                      maxLength={40}
                      onChange={(event) => setPhoneNumberId(event.target.value)}
                    />
                  </label>
                  <label className={common.field}>
                    ID da conta empresarial WhatsApp (WABA)
                    <input
                      value={businessAccountId}
                      required
                      disabled={!creating}
                      inputMode="numeric"
                      pattern="[0-9]+"
                      maxLength={40}
                      onChange={(event) =>
                        setBusinessAccountId(event.target.value)
                      }
                    />
                  </label>
                  <label className={common.field}>
                    Versão da API
                    <input
                      value={apiVersion}
                      required
                      pattern="v[0-9]+\.[0-9]+"
                      maxLength={12}
                      onChange={(event) => setApiVersion(event.target.value)}
                    />
                  </label>
                  <label className={common.field}>
                    Token de acesso
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={accessToken}
                      required={creating}
                      maxLength={2000}
                      onChange={(event) => setAccessToken(event.target.value)}
                    />
                  </label>
                  <label className={common.field}>
                    App Secret da Meta
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={appSecret}
                      required={creating}
                      maxLength={1000}
                      onChange={(event) => setAppSecret(event.target.value)}
                    />
                  </label>
                  <label className={common.field}>
                    Token de verificação para receber mensagens
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={verifyToken}
                      required={creating}
                      minLength={16}
                      maxLength={1000}
                      onChange={(event) => setVerifyToken(event.target.value)}
                    />
                    <span className={common.muted}>
                      Use este token na configuração do webhook da Meta.
                      Guarde-o no ambiente privado antes de salvar; o campo será
                      limpo.
                    </span>
                  </label>
                </>
              )}
            </fieldset>
            <div className={styles.formFooter}>
              <button
                className="btn btn-primary"
                disabled={
                  blocked ||
                  reserved ||
                  (provider === "EVOLUTION" &&
                    creating &&
                    !data.allowedEvolutionOrigins.length)
                }
              >
                {busy === "save" ? "Salvando…" : "Salvar conexão"}
              </button>
              {account && (
                <p>
                  Para trocar o número, a conta empresarial ou a instância,
                  adicione outra conexão.
                </p>
              )}
            </div>
          </form>
        </div>
      </details>
      {account && (
        <>
          <details className={styles.disclosure}>
            <summary>Recebimento de mensagens e opções avançadas</summary>
            <div className={styles.disclosureBody}>
              <h3>Receber mensagens nesta conta</h3>
              {account.webhookUrl ? (
                <p className={styles.callback}>{account.webhookUrl}</p>
              ) : (
                <p className={common.warning}>
                  O endereço HTTPS público do sistema precisa ser configurado
                  pela administração antes de registrar o recebimento.
                </p>
              )}
              <p>
                Última mensagem autêntica recebida:{" "}
                {account.webhookSeenAt
                  ? new Date(account.webhookSeenAt).toLocaleString("pt-BR")
                  : "ainda não registrada"}
                .
              </p>
              {provider === "META" ? (
                <p>
                  Cadastre a URL acima e o token de verificação no aplicativo da
                  Meta. Depois, registre a assinatura da conta empresarial.
                </p>
              ) : (
                <label className={common.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={replaceWebhook}
                    onChange={(event) =>
                      setReplaceWebhook(event.target.checked)
                    }
                  />
                  Conferi o webhook no provedor e autorizo substituir o endereço
                  existente.
                </label>
              )}
              <div className={styles.advancedActions}>
                <button
                  className="btn"
                  disabled={blocked || edited || !account.webhookUrl}
                  onClick={() =>
                    void act(
                      "webhook",
                      provider === "EVOLUTION"
                        ? { replaceExistingWebhook: replaceWebhook }
                        : {},
                    )
                  }
                >
                  {provider === "META"
                    ? "Registrar recebimento na Meta"
                    : "Configurar recebimento de mensagens"}
                </button>
                <button
                  className="btn"
                  disabled={blocked || edited}
                  onClick={() => void act("verify")}
                >
                  Verificar credenciais e conexão
                </button>
                {provider === "EVOLUTION" && (
                  <button
                    className="btn"
                    disabled={blocked || edited}
                    onClick={() => void act("createInstance")}
                  >
                    Criar instância no Evolution
                  </button>
                )}
              </div>
              {provider === "EVOLUTION" && (
                <p className={common.muted}>
                  Gerar QR Code já prepara a instância exclusiva dos clientes e
                  o recebimento de mensagens. A opção acima cria somente a
                  instância; exige uma chave com permissão de criação.
                </p>
              )}
              <p className={common.muted}>
                Revisão {account.revision}.{" "}
                {account.verifiedAt
                  ? `Verificada em ${new Date(account.verifiedAt).toLocaleString("pt-BR")}.`
                  : "Verificação pendente."}
              </p>
            </div>
          </details>
          <details className={styles.disclosure}>
            <summary>
              Testar entrega e confirmar recebimento
              <span className={styles.summaryState}>
                {account.latestTest?.observedAt &&
                account.latestTest.state === "DELIVERED"
                  ? "Concluído"
                  : "Pendente"}
              </span>
            </summary>
            <div className={styles.disclosureBody}>
              <p>
                Envie uma mensagem fixa para um número de teste sob seu
                controle. O teste não ativa o atendimento automático.
              </p>
              {provider === "META" && (
                <p>
                  Antes, envie “Oi” do número de teste para o número comercial.
                  Faça o teste na janela de atendimento de 24 horas.
                </p>
              )}
              {!numberConnected && (
                <p className={common.warning}>
                  Conecte e verifique o número antes de testar a entrega.
                </p>
              )}
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void act("sendTest");
                }}
              >
                <fieldset
                  disabled={
                    blocked || edited || account.connectionState !== "VERIFIED"
                  }
                  className={styles.testFields}
                >
                  <label className={common.field}>
                    Número de teste com código do país
                    <input
                      type="tel"
                      inputMode="tel"
                      autoComplete="off"
                      value={recipient}
                      required
                      pattern="\+[1-9][0-9]{7,14}"
                      onChange={(event) => {
                        setRecipient(event.target.value);
                        setConfirmedNumber(false);
                      }}
                      placeholder="+55 DDD número"
                    />
                  </label>
                  <label className={common.checkboxLabel}>
                    <input
                      type="checkbox"
                      checked={confirmedNumber}
                      required
                      onChange={(event) =>
                        setConfirmedNumber(event.target.checked)
                      }
                    />
                    Este número é de teste, está sob meu controle e autorizo uma
                    mensagem.
                  </label>
                  <button
                    className={`btn ${styles.fitButton}`}
                    disabled={!confirmedNumber || !recipient}
                  >
                    Enviar mensagem de teste
                  </button>
                </fieldset>
              </form>
              {account.latestTest && (
                <div className={styles.testResult}>
                  <strong>{TEST_STATE[account.latestTest.state]}</strong>
                  <p>
                    Destino: {account.latestTest.recipientMasked}. Solicitado em{" "}
                    {new Date(account.latestTest.createdAt).toLocaleString(
                      "pt-BR",
                    )}
                    .
                  </p>
                  {account.latestTest.error && (
                    <p className={common.danger}>{account.latestTest.error}</p>
                  )}
                  {account.latestTest.observedAt ? (
                    <p className={common.success}>
                      Recebimento observado e registrado em{" "}
                      {new Date(account.latestTest.observedAt).toLocaleString(
                        "pt-BR",
                      )}
                      .
                    </p>
                  ) : (
                    <>
                      <label className={common.checkboxLabel}>
                        <input
                          type="checkbox"
                          checked={confirmedObserved}
                          disabled={account.latestTest.state !== "DELIVERED"}
                          onChange={(event) =>
                            setConfirmedObserved(event.target.checked)
                          }
                        />
                        Observei esta mensagem no número de teste.
                      </label>
                      <button
                        className="btn"
                        disabled={
                          blocked ||
                          !confirmedObserved ||
                          account.latestTest.state !== "DELIVERED"
                        }
                        onClick={() =>
                          void act("ackTest", {
                            testId: account.latestTest!.id,
                            confirmedObserved,
                          })
                        }
                      >
                        Registrar recebimento observado
                      </button>
                    </>
                  )}
                  <button
                    className="btn"
                    disabled={blocked || edited}
                    onClick={() => void act("reconcileTest")}
                  >
                    Consultar estado do teste
                  </button>
                </div>
              )}
            </div>
          </details>
          <section className={styles.activation}>
            <div>
              <h2>Atendimento automático</h2>
              <p>
                {account.active
                  ? "A IA está ativa nesta conta."
                  : "A IA continua pausada até concluir os requisitos abaixo."}
              </p>
              {account.blockers.length > 0 && (
                <details className={styles.requirements}>
                  <summary>
                    {account.blockers.length} requisito(s) para ativar
                  </summary>
                  <ul>
                    {account.blockers.map((blocker) => (
                      <li key={blocker}>{blocker}</li>
                    ))}
                  </ul>
                </details>
              )}
              <p className={styles.setupLinks}>
                <Link href="/assistente/configuracao#gemini">
                  Configurar Gemini
                </Link>
                <Link href="/assistente/configuracao/informacoes">
                  Revisar informações do restaurante
                </Link>
              </p>
            </div>
            <button
              className={account.active ? "btn" : "btn btn-primary"}
              disabled={blocked || (!account.active && !canActivate)}
              onClick={() => void act("activate", { enabled: !account.active })}
            >
              {account.active
                ? "Pausar atendimento automático"
                : "Ativar atendimento automático"}
            </button>
          </section>
        </>
      )}
    </>
  );
}
