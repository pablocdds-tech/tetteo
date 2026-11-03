"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api } from "../client/api";
import { useAuth } from "../client/context";
import {
  useVirtualAccount,
  type VirtualChannelAccount,
  type VirtualChannelsResult,
} from "../client/virtual-channel-context";
import { VirtualCredit, VirtualHeader } from "./virtual-header";
import styles from "./virtual.module.css";

type Provider = "EVOLUTION" | "META";
const subscribe = () => () => {};
const secureOrigin = () =>
  location.protocol === "https:" ||
  ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
const errorText = (failure: unknown) =>
  failure instanceof Error
    ? failure.message
    : "Não foi possível confirmar a operação do canal.";
const TEST_STATE = {
  SENDING: "Envio solicitado",
  ACCEPTED: "Aceito pelo provedor",
  DELIVERED: "Entrega confirmada pelo provedor",
  FAILED: "Falhou",
  UNCERTAIN: "Resultado incerto; consulte o status",
};
const CONNECTION = {
  PENDING: "Verificação pendente",
  VERIFIED: "Conexão verificada",
  FAILED: "Verificação falhou",
};
function randomSecret() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

export default function VirtualChannelsPage({
  provider,
}: {
  provider: Provider;
}) {
  const { selectedStoreId: storeId } = useAuth();
  return (
    <ChannelsForStore
      key={`${storeId}:${provider}`}
      provider={provider}
      storeId={storeId}
    />
  );
}

function ChannelsForStore({
  provider,
  storeId,
}: {
  provider: Provider;
  storeId: string;
}) {
  const { user } = useAuth();
  const { refreshAccounts, setSelectedAccountId } = useVirtualAccount();
  const manageable = user.role === "MANAGER";
  const [data, setData] = useState<VirtualChannelsResult | null>(null);
  const [selected, setSelected] = useState("");
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
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
    data?.accounts.filter((account) => account.provider === provider) ?? [];
  const account = accounts.find((item) => item.id === selected) ?? null;
  function result(value: VirtualChannelsResult, savedId?: string) {
    setData(value);
    refreshAccounts();
    if (savedId) {
      setSelected(savedId);
      setSelectedAccountId(savedId);
    }
  }
  return (
    <main className={styles.page}>
      <VirtualHeader section={provider === "EVOLUTION" ? "evolution" : "meta"}>
        <div className={styles.actions}>
          <button
            className="btn"
            onClick={() => setRevision((value) => value + 1)}
          >
            Atualizar contas
          </button>
          {manageable && (
            <button className="btn btn-primary" onClick={() => setSelected("")}>
              Nova conta {provider === "META" ? "Meta" : "Evolution"}
            </button>
          )}
        </div>
      </VirtualHeader>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <section className={styles.panel}>
        <h2>
          {provider === "META"
            ? "WhatsApp Business Platform oficial"
            : "Contas Evolution do atendimento"}
        </h2>
        <p>
          {provider === "META"
            ? "Configure o aplicativo e a conta empresarial autorizados na Meta. Cada número possui credenciais, webhook e teste de entrega próprios."
            : "Use uma instância dedicada ao atendimento dos clientes. A Evolution não equivale à aprovação da plataforma Meta; a conexão dos avisos da equipe permanece separada."}
        </p>
        <p>
          <a
            className={styles.textLink}
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
        {provider === "EVOLUTION" && data?.legacyReservedInstance && (
          <p className={styles.muted}>
            Instância reservada para a equipe: {data.legacyReservedInstance}.
          </p>
        )}
      </section>
      {!data && !error && (
        <p className={styles.empty}>Consultando contas desta unidade…</p>
      )}
      {data && (
        <>
          <section className={styles.panel}>
            <h2>Contas configuradas</h2>
            {accounts.length ? (
              <div className={styles.accountCards}>
                {accounts.map((item) => (
                  <button
                    className={styles.accountCard}
                    aria-pressed={item.id === selected}
                    key={item.id}
                    onClick={() => {
                      setSelected(item.id);
                      setSelectedAccountId(item.id);
                    }}
                  >
                    <strong>{item.name}</strong>
                    <span>
                      {item.settings.instance ?? item.settings.phoneNumberId}
                    </span>
                    <span className={styles.badges}>
                      <span
                        className={`${styles.badge} ${item.active ? styles.success : styles.warning}`}
                      >
                        {item.active ? "Ativada" : "Pausada"}
                      </span>
                      <span className={styles.badge}>
                        {CONNECTION[item.connectionState]}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p>
                Nenhuma conta {provider === "META" ? "Meta" : "Evolution"}{" "}
                cadastrada nesta unidade.
              </p>
            )}
          </section>
          {manageable ? (
            <ChannelManager
              key={`${provider}:${account?.id ?? "new"}:${account?.revision ?? 0}`}
              provider={provider}
              account={account}
              data={data}
              storeId={storeId}
              onResult={result}
            />
          ) : (
            <section className={styles.panel}>
              <h2>Configuração pela gestão</h2>
              <p>
                Seu perfil pode acompanhar as contas. A gestão configura
                credenciais, testa e ativa cada conexão.
              </p>
            </section>
          )}
        </>
      )}
      <VirtualCredit />
    </main>
  );
}

function ChannelManager({
  provider,
  account,
  data,
  storeId,
  onResult,
}: {
  provider: Provider;
  account: VirtualChannelAccount | null;
  data: VirtualChannelsResult;
  storeId: string;
  onResult: (result: VirtualChannelsResult, savedId?: string) => void;
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
  const [qr, setQr] = useState<{
    qrDataUrl: string | null;
    expiresAt: string | null;
    status: string;
  } | null>(null);
  const testRequest = useRef<{
    accountId: string;
    revision: number;
    recipient: string;
    requestId: string;
  } | null>(null);
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
  const creating = !account;
  useEffect(() => {
    if (!qr?.expiresAt) return;
    const timer = setTimeout(
      () => setQr(null),
      Math.max(0, new Date(qr.expiresAt).getTime() - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [qr]);

  async function save() {
    if (!secure || busy) return;
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
      const saved = result.accounts.find(
        (item) =>
          item.provider === provider &&
          (provider === "META"
            ? item.settings.phoneNumberId === phoneNumberId
            : item.settings.url === url && item.settings.instance === instance),
      );
      onResult(result, saved?.id);
      setNotice(
        "Conta salva. A conexão, o webhook e a entrega ainda precisam ser verificados antes da ativação.",
      );
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setApiKey("");
      setWebhookSecret("");
      setAccessToken("");
      setAppSecret("");
      setVerifyToken("");
      setBusy(null);
    }
  }

  async function act(
    action:
      | "verify"
      | "createInstance"
      | "webhook"
      | "qr"
      | "activate"
      | "sendTest"
      | "ackTest"
      | "reconcileTest",
    extra: Record<string, unknown> = {},
  ) {
    if (!account || busy) return;
    setBusy(action);
    setError("");
    setNotice("");
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
      const result = await api.post<
        | VirtualChannelsResult
        | { qrDataUrl: string | null; expiresAt: string | null; status: string }
      >("/api/crm/virtual/channels", {
        storeId,
        accountId: account.id,
        action,
        revision: account.revision,
        ...extra,
      });
      if ("qrDataUrl" in result) setQr(result);
      else onResult(result);
      setNotice(
        action === "activate"
          ? extra.enabled
            ? "Conta ativada pelo servidor após validar os requisitos."
            : "Conta pausada."
          : action === "sendTest"
            ? "Solicitação de teste registrada. Confira separadamente a aceitação, a entrega e a observação no número de teste."
            : action === "ackTest"
              ? "Observação do teste registrada para esta conta."
              : action === "webhook"
                ? "Configuração do webhook concluída. Aguarde uma entrada autêntica para confirmar o recebimento."
                : action === "qr"
                  ? "Estado de conexão consultado."
                  : action === "createInstance"
                    ? "Instância criada no Evolution. Configure o webhook e consulte o QR para conectar o número."
                    : "Estado da conta atualizado. Confira os resultados abaixo.",
      );
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(null);
    }
  }

  if (!secure)
    return (
      <section className={styles.panel}>
        <h2>Conexão privada</h2>
        <p className={styles.error}>
          Abra o endereço HTTPS autenticado do sistema para configurar
          credenciais e testar esta conta.
        </p>
      </section>
    );
  return (
    <>
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
      <section className={styles.panel}>
        <h2>
          {creating
            ? "Nova conta de atendimento"
            : `Configuração de ${account.name}`}
        </h2>
        <p>
          Credenciais são preenchidas somente neste painel privado e não voltam
          nas consultas. Campos privados em branco preservam o valor já salvo.
        </p>
        <form
          autoComplete="off"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <fieldset
            disabled={Boolean(busy)}
            className={styles.fields}
            style={{ border: 0, minWidth: 0 }}
          >
            <label className={styles.field}>
              Nome da conta
              <input
                value={name}
                required
                minLength={2}
                maxLength={100}
                onChange={(event) => setName(event.target.value)}
                placeholder="Nome para identificar o canal da unidade"
              />
            </label>
            {provider === "EVOLUTION" ? (
              <>
                <label className={styles.field}>
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
                <label className={styles.field}>
                  Instância dedicada ao atendimento
                  <input
                    value={instance}
                    required
                    disabled={!creating}
                    maxLength={100}
                    onChange={(event) => setInstance(event.target.value)}
                  />
                </label>
                <label className={styles.field}>
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
                        ? "Preencha para substituir a chave salva"
                        : "Chave privada do servidor Evolution"
                    }
                  />
                </label>
                <label className={styles.field}>
                  Segredo privado do webhook
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
                    className="btn"
                    onClick={() => setWebhookSecret(randomSecret())}
                  >
                    Gerar segredo privado
                  </button>
                </label>
                {!data.allowedEvolutionOrigins.length && (
                  <p className={styles.warning}>
                    Nenhum servidor Evolution está autorizado nesta instalação.
                    A administração precisa liberar o endereço do servidor.
                  </p>
                )}
                {reserved && (
                  <p className={styles.error}>
                    Esta instância está reservada para os avisos da equipe. Use
                    outra instância para os clientes.
                  </p>
                )}
              </>
            ) : (
              <>
                <label className={styles.field}>
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
                <label className={styles.field}>
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
                <label className={styles.field}>
                  Versão da API
                  <input
                    value={apiVersion}
                    required
                    maxLength={20}
                    onChange={(event) => setApiVersion(event.target.value)}
                  />
                </label>
                <label className={styles.field}>
                  Token de acesso
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={accessToken}
                    required={creating}
                    maxLength={4000}
                    onChange={(event) => setAccessToken(event.target.value)}
                  />
                </label>
                <label className={styles.field}>
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
                <label className={styles.field}>
                  Token de verificação do webhook
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={verifyToken}
                    required={creating}
                    minLength={16}
                    maxLength={1000}
                    onChange={(event) => setVerifyToken(event.target.value)}
                  />
                  <span className={styles.metadata}>
                    Use este mesmo token na configuração do webhook da Meta.
                    Registre-o no seu ambiente privado antes de salvar; o campo
                    será limpo.
                  </span>
                </label>
              </>
            )}
            <button
              type="submit"
              className="btn btn-primary"
              disabled={
                reserved ||
                (provider === "EVOLUTION" &&
                  creating &&
                  !data.allowedEvolutionOrigins.length)
              }
            >
              {busy === "save" ? "Salvando…" : "Salvar conta e credenciais"}
            </button>
          </fieldset>
        </form>
        {account && (
          <p className={styles.muted} style={{ marginTop: 12 }}>
            A vinculação física é preservada. Para trocar número, conta
            empresarial ou instância, cadastre outra conta.
          </p>
        )}
      </section>
      {account && (
        <>
          <section className={styles.panel}>
            <div className={styles.sectionHeading}>
              <h2>Verificação da configuração salva</h2>
              <span
                className={`${styles.badge} ${account.connectionState === "VERIFIED" ? styles.success : styles.warning}`}
              >
                {CONNECTION[account.connectionState]}
              </span>
            </div>
            <p>
              Revisão {account.revision}.{" "}
              {account.verifiedAt
                ? `Verificada em ${new Date(account.verifiedAt).toLocaleString("pt-BR")}.`
                : "Esta revisão ainda precisa ser verificada."}
            </p>
            {edited && (
              <p className={styles.warning}>
                Há alterações no formulário. Salve antes de verificar ou testar
                a conexão.
              </p>
            )}
            {account.lastError && (
              <p className={styles.error}>{account.lastError}</p>
            )}
            <div className={styles.actions} style={{ marginTop: 16 }}>
              <button
                className="btn"
                disabled={Boolean(busy) || edited}
                onClick={() => void act("verify")}
              >
                Verificar conexão
              </button>
              {provider === "EVOLUTION" && (
                <button
                  className="btn"
                  disabled={Boolean(busy) || edited}
                  onClick={() => void act("createInstance")}
                >
                  Criar instância no Evolution
                </button>
              )}
              {provider === "EVOLUTION" && (
                <button
                  className="btn"
                  disabled={Boolean(busy) || edited}
                  onClick={() => void act("qr")}
                >
                  Consultar QR e conexão
                </button>
              )}
            </div>
            {provider === "EVOLUTION" && (
              <p className={styles.muted} style={{ marginTop: 12 }}>
                Crie somente uma instância exclusiva para os clientes. A chave
                do servidor precisa ter permissão de criação. Uma instância
                existente deve ser verificada e conectada.
              </p>
            )}
            {qr && (
              <div className={styles.panel}>
                <p>{qr.status}</p>
                {qr.qrDataUrl && (
                  <Image
                    src={qr.qrDataUrl}
                    width={256}
                    height={256}
                    unoptimized
                    alt="QR privado para conectar esta instância Evolution"
                  />
                )}
                {qr.expiresAt && (
                  <p className={styles.muted}>
                    Válido até {new Date(qr.expiresAt).toLocaleString("pt-BR")}.
                  </p>
                )}
              </div>
            )}
          </section>
          <section className={styles.panel}>
            <h2>Webhook desta conta</h2>
            <p className={styles.callbackUrl}>{account.webhookUrl}</p>
            <p>
              Último recebimento autêntico:{" "}
              {account.webhookSeenAt
                ? new Date(account.webhookSeenAt).toLocaleString("pt-BR")
                : "ainda não registrado"}
              .
            </p>
            {provider === "META" && (
              <p>
                Configure esta URL de callback e o token de verificação no
                aplicativo da Meta. Depois, registre a assinatura da conta
                empresarial abaixo.
              </p>
            )}
            {provider === "EVOLUTION" && (
              <label className={styles.checkboxLabel} style={{ marginTop: 12 }}>
                <input
                  type="checkbox"
                  checked={replaceWebhook}
                  onChange={(event) => setReplaceWebhook(event.target.checked)}
                />{" "}
                Conferi o webhook atual no provedor e autorizo sua substituição
                por esta URL.
              </label>
            )}
            <button
              className="btn"
              style={{ marginTop: 16 }}
              disabled={Boolean(busy) || edited}
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
                ? "Assinar webhook da conta empresarial"
                : "Configurar webhook desta instância"}
            </button>
          </section>
          <section className={styles.panel}>
            <h2>Teste autorizado de entrega</h2>
            {provider === "META" && (
              <p>
                Antes do teste, envie “Oi” do seu número de teste para o número
                comercial no WhatsApp. Faça o teste dentro da janela de
                atendimento de 24 horas.
              </p>
            )}
            <p>
              Use somente um número de teste sob seu controle. O botão envia uma
              mensagem fixa por esta conta; aceitação pelo provedor e entrega
              são estados separados.
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void act("sendTest");
              }}
            >
              <fieldset
                disabled={
                  Boolean(busy) ||
                  edited ||
                  account.connectionState !== "VERIFIED"
                }
                className={styles.fields}
                style={{ border: 0, minWidth: 0 }}
              >
                <label className={styles.field}>
                  Número de teste internacional
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
                <label className={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={confirmedNumber}
                    required
                    onChange={(event) =>
                      setConfirmedNumber(event.target.checked)
                    }
                  />{" "}
                  Este número é de teste, está sob meu controle e autorizo o
                  envio de uma mensagem.
                </label>
                <button
                  className="btn"
                  type="submit"
                  disabled={!confirmedNumber || !recipient}
                >
                  Enviar uma mensagem de teste
                </button>
              </fieldset>
            </form>
            {account.latestTest && (
              <article className={styles.panel}>
                <div className={styles.badges}>
                  <span
                    className={`${styles.badge} ${account.latestTest.state === "DELIVERED" ? styles.success : styles.warning}`}
                  >
                    {TEST_STATE[account.latestTest.state]}
                  </span>
                </div>
                <p>
                  Destino: {account.latestTest.recipientMasked}. Solicitado em{" "}
                  {new Date(account.latestTest.createdAt).toLocaleString(
                    "pt-BR",
                  )}
                  .
                </p>
                {account.latestTest.error && (
                  <p className={styles.error}>{account.latestTest.error}</p>
                )}
                {account.latestTest.observedAt ? (
                  <p className={styles.success}>
                    Recebimento observado e registrado por uma pessoa em{" "}
                    {new Date(account.latestTest.observedAt).toLocaleString(
                      "pt-BR",
                    )}
                    .
                  </p>
                ) : (
                  <>
                    <label className={styles.checkboxLabel}>
                      <input
                        type="checkbox"
                        checked={confirmedObserved}
                        disabled={account.latestTest.state !== "DELIVERED"}
                        onChange={(event) =>
                          setConfirmedObserved(event.target.checked)
                        }
                      />{" "}
                      Observei no número de teste o recebimento desta mensagem.
                    </label>
                    <button
                      className="btn"
                      disabled={
                        Boolean(busy) ||
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
                      Registrar observação do teste
                    </button>
                  </>
                )}
                <button
                  className="btn"
                  style={{ marginTop: 12 }}
                  disabled={Boolean(busy) || edited}
                  onClick={() => void act("reconcileTest")}
                >
                  Consultar estado do teste
                </button>
              </article>
            )}
          </section>
          <section className={styles.panel}>
            <div className={styles.sectionHeading}>
              <h2>Ativação do atendimento</h2>
              <span
                className={`${styles.badge} ${account.active ? styles.success : styles.warning}`}
              >
                {account.active ? "Conta ativada" : "Conta pausada"}
              </span>
            </div>
            {account.blockers.length ? (
              <ul className={styles.checklist}>
                {account.blockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            ) : (
              <p>
                Os requisitos registrados desta conta estão disponíveis para
                validação pelo servidor.
              </p>
            )}
            <p>
              O atendimento também exige{" "}
              <Link
                className={styles.textLink}
                href="/assistente/configuracao#gemini"
              >
                Gemini ativo
              </Link>{" "}
              e{" "}
              <Link
                className={styles.textLink}
                href="/assistente/configuracao#informacoes"
              >
                base operacional real aprovada para esta conta
              </Link>
              .
            </p>
            <button
              className={account.active ? "btn" : "btn btn-primary"}
              disabled={
                Boolean(busy) ||
                (!account.active &&
                  (edited ||
                    account.blockers.length > 0 ||
                    account.connectionState !== "VERIFIED" ||
                    account.latestTest?.state !== "DELIVERED" ||
                    !account.latestTest.observedAt))
              }
              style={{ marginTop: 16 }}
              onClick={() => void act("activate", { enabled: !account.active })}
            >
              {account.active
                ? "Pausar esta conta"
                : "Ativar atendimento desta conta"}
            </button>
          </section>
        </>
      )}
    </>
  );
}
