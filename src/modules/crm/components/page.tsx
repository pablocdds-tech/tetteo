/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { api } from "@/modules/crm/client/api";
import { useAuth } from "@/modules/crm/client/context";
import styles from "./crm.module.css";
import ContactCampaignTools from "./contact-campaign-tools";

type Segment = "LEAD" | "NEW" | "ACTIVE" | "AT_RISK" | "LOST";
type Contact = {
  id: string;
  storeId: string;
  name: string;
  phone: string | null;
  email: string | null;
  marketingOptIn: boolean;
  createdAt: string;
  purchases: number;
  spent: number;
  firstPurchaseAt: string | null;
  lastPurchaseAt: string | null;
  segment: Segment;
};
type ContactDetail = Omit<
  Contact,
  "purchases" | "spent" | "firstPurchaseAt" | "lastPurchaseAt" | "segment"
> & {
  notes: string | null;
  metrics: Pick<
    Contact,
    "purchases" | "spent" | "firstPurchaseAt" | "lastPurchaseAt" | "segment"
  >;
  sales: {
    id: string;
    source: string;
    externalId: string;
    totalAmount: number;
    status: string;
    soldAt: string;
  }[];
  activities: {
    id: string;
    type: "NOTE" | "CALL" | "WHATSAPP" | "EMAIL" | "SMS";
    summary: string;
    createdBy: string;
    createdAt: string;
  }[];
};
type Overview = {
  counts: Record<Segment, number>;
  total: number;
  optedIn: number;
};
type Insights = {
  buyers: number;
  recurring: number;
  repeatRate: number;
  totalSales: number;
  identifiedSales: number;
  identificationRate: number;
};
type ListResult = {
  items: Contact[];
  total: number;
  page: number;
  pageSize: number;
};

const SEGMENTS: { key: Segment; label: string; description: string }[] = [
  { key: "LEAD", label: "Leads", description: "Sem compra vinculada" },
  { key: "NEW", label: "Novos", description: "Uma compra há menos de 30 dias" },
  {
    key: "ACTIVE",
    label: "Ativos",
    description: "Duas ou mais compras recentes",
  },
  {
    key: "AT_RISK",
    label: "Em risco",
    description: "Última compra entre 30 e 89 dias",
  },
  {
    key: "LOST",
    label: "Inativos",
    description: "Última compra há 90 dias ou mais",
  },
];
const emptyForm = {
  name: "",
  phone: "",
  email: "",
  notes: "",
  marketingOptIn: false,
};
const money = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    value,
  );
const date = (value: string | null) =>
  value
    ? new Date(value).toLocaleDateString("pt-BR", {
        timeZone: "America/Sao_Paulo",
      })
    : "—";
const message = (error: unknown) =>
  error instanceof Error ? error.message : "Não foi possível carregar o CRM.";

export default function CrmPage() {
  const { user, selectedStoreId, can } = useAuth();
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [list, setList] = useState<ListResult | null>(null);
  const [segment, setSegment] = useState<Segment | "">("");
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [marketingOnly, setMarketingOnly] = useState(false);
  const [minPurchases, setMinPurchases] = useState("");
  const [maxDaysSincePurchase, setMaxDaysSincePurchase] = useState("");
  const [minSpent, setMinSpent] = useState("");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedContactStoreId, setSelectedContactStoreId] = useState<
    string | null
  >(null);
  const [detail, setDetail] = useState<ContactDetail | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [formStoreId, setFormStoreId] = useState("");
  const [editing, setEditing] = useState(false);
  const [saleSource, setSaleSource] = useState("SAIPOS");
  const [saleExternalId, setSaleExternalId] = useState("");
  const [activityType, setActivityType] = useState("NOTE");
  const [activitySummary, setActivitySummary] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saiposStatus, setSaiposStatus] = useState<
    {
      historyComplete: boolean;
      historyCoveredFrom: string | null;
      lastError: string | null;
    }[]
  >([]);
  useEffect(() => {
    setSaiposStatus([]);
    if (!selectedStoreId || selectedStoreId === "all") return;
    let alive = true;
    const refresh = () =>
      api
        .get<typeof saiposStatus>(
          `/api/crm/saipos?storeId=${encodeURIComponent(selectedStoreId)}`,
        )
        .then((data) => {
          if (alive) setSaiposStatus(data);
        })
        .catch(() => {});
    void refresh();
    const timer = setInterval(() => void refresh(), 30000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [selectedStoreId]);

  const load = useCallback(async () => {
    if (!can("CRM", "VIEW")) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        storeId: selectedStoreId,
        page: String(page),
        pageSize: "25",
      });
      if (segment) params.set("segment", segment);
      if (search) params.set("search", search);
      if (marketingOnly) params.set("marketingOnly", "true");
      if (minPurchases) params.set("minPurchases", minPurchases);
      if (maxDaysSincePurchase)
        params.set("maxDaysSincePurchase", maxDaysSincePurchase);
      if (minSpent) params.set("minSpent", minSpent);
      const [nextOverview, nextInsights, nextList] = await Promise.all([
        api.get<Overview>(
          `/api/crm/overview?storeId=${encodeURIComponent(selectedStoreId)}`,
        ),
        api.get<Insights>(
          `/api/crm/insights?storeId=${encodeURIComponent(selectedStoreId)}`,
        ),
        api.get<ListResult>(`/api/crm/contacts?${params}`),
      ]);
      setOverview(nextOverview);
      setInsights(nextInsights);
      setList(nextList);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setLoading(false);
    }
  }, [
    can,
    selectedStoreId,
    page,
    segment,
    search,
    marketingOnly,
    minPurchases,
    maxDaysSincePurchase,
    minSpent,
  ]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    api
      .get<{ id: string; name: string }[]>("/api/crm/stores")
      .then(setStores)
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    setPage(1);
    setSelectedId(null);
    setSelectedContactStoreId(null);
    setDetail(null);
  }, [selectedStoreId]);
  useEffect(() => {
    if (!selectedId || !selectedContactStoreId) return;
    let active = true;
    api
      .get<ContactDetail>(
        `/api/crm/contacts/${selectedId}?storeId=${encodeURIComponent(selectedContactStoreId)}`,
      )
      .then((value) => {
        if (active) setDetail(value);
      })
      .catch((cause) => {
        if (active) setError(message(cause));
      });
    return () => {
      active = false;
    };
  }, [selectedId, selectedContactStoreId]);

  const storeName = (id: string) =>
    stores.find((store) => store.id === id)?.name ??
    user?.stores.find((store) => store.id === id)?.name ??
    "Loja";
  const selectedSegment = SEGMENTS.find((item) => item.key === segment);

  function selectContact(id: string, storeId: string) {
    setDetail(null);
    setSelectedContactStoreId(storeId);
    setSelectedId(id);
  }

  function openCreate() {
    setForm(emptyForm);
    setFormStoreId(
      selectedStoreId === "all"
        ? (stores[0]?.id ?? user?.stores[0]?.id ?? "")
        : selectedStoreId,
    );
    setEditing(false);
    setFormOpen(true);
    setNotice("");
  }

  function openEdit() {
    if (!detail) return;
    setForm({
      name: detail.name,
      phone: detail.phone ?? "",
      email: detail.email ?? "",
      notes: detail.notes ?? "",
      marketingOptIn: detail.marketingOptIn,
    });
    setFormStoreId(detail.storeId);
    setEditing(true);
    setFormOpen(true);
    setNotice("");
  }

  async function saveContact(event: FormEvent) {
    event.preventDefault();
    if (!formStoreId) {
      setError("Selecione uma loja.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const body = {
        ...form,
        storeId: formStoreId,
        email: form.email || null,
        notes: form.notes || null,
      };
      const saved =
        editing && detail
          ? await api.put<{ id: string; storeId: string }>(
              `/api/crm/contacts/${detail.id}`,
              body,
            )
          : await api.post<{ id: string; storeId: string }>(
              "/api/crm/contacts",
              body,
            );
      setFormOpen(false);
      setNotice(
        editing
          ? "Contato atualizado."
          : "Contato criado. Ele aparece como lead até ter uma compra vinculada.",
      );
      selectContact(saved.id, saved.storeId);
      setDetail(
        await api.get<ContactDetail>(
          `/api/crm/contacts/${saved.id}?storeId=${encodeURIComponent(saved.storeId)}`,
        ),
      );
      await load();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setSaving(false);
    }
  }

  async function attachSale(event: FormEvent) {
    event.preventDefault();
    if (!detail) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await api.post(`/api/crm/contacts/${detail.id}/sales`, {
        storeId: detail.storeId,
        source: saleSource,
        externalId: saleExternalId.trim(),
      });
      setSaleExternalId("");
      setNotice("Venda vinculada ao contato.");
      const updated = await api.get<ContactDetail>(
        `/api/crm/contacts/${detail.id}?storeId=${encodeURIComponent(detail.storeId)}`,
      );
      setDetail(updated);
      await load();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setSaving(false);
    }
  }

  async function saveActivity(event: FormEvent) {
    event.preventDefault();
    if (!detail) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await api.post(`/api/crm/contacts/${detail.id}/activities`, {
        storeId: detail.storeId,
        type: activityType,
        summary: activitySummary.trim(),
      });
      setActivitySummary("");
      setNotice("Interação registrada.");
      setDetail(
        await api.get<ContactDetail>(
          `/api/crm/contacts/${detail.id}?storeId=${encodeURIComponent(detail.storeId)}`,
        ),
      );
    } catch (cause) {
      setError(message(cause));
    } finally {
      setSaving(false);
    }
  }

  if (!can("CRM", "VIEW"))
    return (
      <div className={styles.page}>
        <p>Sem permissão para acessar o CRM.</p>
      </div>
    );

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Clientes e relacionamento</h1>
          <p>
            Contatos da{" "}
            {selectedStoreId === "all" ? "rede" : storeName(selectedStoreId)}.
            Compras só aparecem quando vinculadas a uma pessoa.
          </p>
        </div>
        {can("CRM", "CREATE") && (
          <button className="btn btn-primary" onClick={openCreate}>
            Novo contato
          </button>
        )}
      </header>

      <div className={styles.context}>
        Clientes identificados no Saipos são importados com suas compras. Vendas
        anônimas permanecem sem vínculo e não entram nas métricas individuais.
        {saiposStatus.map((state, index) => (
          <p key={index} role="status">
            {state.lastError ??
              (state.historyComplete
                ? "Histórico importado. Novas compras são sincronizadas automaticamente."
                : state.historyCoveredFrom
                  ? `Importando histórico: cobertura confirmada desde ${date(state.historyCoveredFrom + "T12:00:00Z")}. A carga continua para os períodos anteriores.`
                  : "Aguardando o primeiro lote do Saipos.")}
          </p>
        ))}
      </div>
      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className={styles.notice} role="status">
          {notice}
        </div>
      )}

      <section className={styles.summary} aria-label="Visão geral do CRM">
        <div className={styles.total}>
          <span>Contatos na base</span>
          <strong>{overview?.total ?? "—"}</strong>
          <small>{overview?.optedIn ?? "—"} com autorização de marketing</small>
        </div>
        <div className={styles.segments}>
          {SEGMENTS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`${styles.segment} ${segment === item.key ? styles.segmentActive : ""}`}
              onClick={() => {
                setSegment(segment === item.key ? "" : item.key);
                setPage(1);
              }}
              title={item.description}
            >
              <span>{item.label}</span>
              <strong>{overview?.counts[item.key] ?? "—"}</strong>
              <small>{item.description}</small>
            </button>
          ))}
        </div>
      </section>

      <section
        className={styles.quality}
        aria-label="Qualidade dos dados de clientes"
      >
        <div>
          <span>Vendas com cliente identificado</span>
          <strong>
            {insights
              ? `${Math.round(insights.identificationRate * 100)}%`
              : "—"}
          </strong>
          <small>
            {insights
              ? `${insights.identifiedSales} de ${insights.totalSales} vendas concluídas`
              : "Carregando"}
          </small>
          <div className={styles.progress}>
            <div
              style={{
                width: `${Math.min(100, (insights?.identificationRate ?? 0) * 100)}%`,
              }}
            />
          </div>
        </div>
        <div>
          <span>Clientes que voltaram</span>
          <strong>
            {insights ? `${Math.round(insights.repeatRate * 100)}%` : "—"}
          </strong>
          <small>
            {insights
              ? `${insights.recurring} de ${insights.buyers} com compra vinculada`
              : "Carregando"}
          </small>
          <p>
            Essas taxas usam apenas vínculos comprovados. Elas podem mudar
            conforme novas vendas forem identificadas.
          </p>
        </div>
      </section>

      <section className={styles.workspace}>
        <div className={styles.directory}>
          <div className={styles.directoryHead}>
            <div>
              <h2>
                {selectedSegment ? selectedSegment.label : "Todos os contatos"}
              </h2>
              <p>
                {list?.total ?? 0} resultado{list?.total === 1 ? "" : "s"}
              </p>
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                setSearch(searchDraft.trim());
                setPage(1);
              }}
              className={styles.search}
            >
              <label className={styles.visuallyHidden} htmlFor="crm-search">
                Buscar contato
              </label>
              <input
                id="crm-search"
                placeholder="Nome, telefone ou e-mail"
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.target.value)}
              />
              <button type="submit" className="btn btn-ghost">
                Buscar
              </button>
            </form>
          </div>
          <div className={styles.filterBar}>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setAdvancedOpen(!advancedOpen)}
              aria-expanded={advancedOpen}
            >
              Critérios {advancedOpen ? "−" : "+"}
            </button>
            {(marketingOnly ||
              minPurchases ||
              maxDaysSincePurchase ||
              minSpent) && (
              <button
                type="button"
                className={styles.clearFilters}
                onClick={() => {
                  setMarketingOnly(false);
                  setMinPurchases("");
                  setMaxDaysSincePurchase("");
                  setMinSpent("");
                  setPage(1);
                }}
              >
                Limpar critérios
              </button>
            )}
          </div>
          {advancedOpen && (
            <div className={styles.advanced}>
              <label>
                Mínimo de compras
                <input
                  type="number"
                  min="0"
                  max="100000"
                  value={minPurchases}
                  onChange={(event) => {
                    setMinPurchases(event.target.value);
                    setPage(1);
                  }}
                  placeholder="Qualquer"
                />
              </label>
              <label>
                Comprou nos últimos dias
                <input
                  type="number"
                  min="0"
                  max="3650"
                  value={maxDaysSincePurchase}
                  onChange={(event) => {
                    setMaxDaysSincePurchase(event.target.value);
                    setPage(1);
                  }}
                  placeholder="Qualquer"
                />
              </label>
              <label>
                Valor mínimo gasto
                <input
                  type="number"
                  min="0"
                  max="1000000000"
                  step="0.01"
                  value={minSpent}
                  onChange={(event) => {
                    setMinSpent(event.target.value);
                    setPage(1);
                  }}
                  placeholder="Qualquer"
                />
              </label>
              <label className={styles.filterCheck}>
                <input
                  type="checkbox"
                  checked={marketingOnly}
                  onChange={(event) => {
                    setMarketingOnly(event.target.checked);
                    setPage(1);
                  }}
                />{" "}
                Apenas com autorização de marketing
              </label>
            </div>
          )}
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Contato</th>
                  <th>Perfil</th>
                  <th>Última compra</th>
                  <th>Compras</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5}>Carregando contatos...</td>
                  </tr>
                ) : list?.items.length ? (
                  list.items.map((contact) => (
                    <tr
                      key={contact.id}
                      className={
                        selectedId === contact.id ? styles.rowSelected : ""
                      }
                      onClick={() => selectContact(contact.id, contact.storeId)}
                    >
                      <td>
                        <button
                          type="button"
                          className={styles.contactButton}
                          onClick={() =>
                            selectContact(contact.id, contact.storeId)
                          }
                        >
                          <strong>{contact.name}</strong>
                          <small>
                            {contact.phone ?? "Sem telefone"}
                            {selectedStoreId === "all"
                              ? ` · ${storeName(contact.storeId)}`
                              : ""}
                          </small>
                        </button>
                      </td>
                      <td>
                        <span className={styles.badge}>
                          {
                            SEGMENTS.find(
                              (item) => item.key === contact.segment,
                            )?.label
                          }
                        </span>
                      </td>
                      <td>{date(contact.lastPurchaseAt)}</td>
                      <td>{contact.purchases}</td>
                      <td>{money(contact.spent)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className={styles.empty}>
                      Nenhum contato encontrado.{" "}
                      {segment || search
                        ? "Revise os filtros."
                        : "Cadastre o primeiro contato para começar."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className={styles.pagination}>
            <span>
              Página {page} de {Math.max(1, Math.ceil((list?.total ?? 0) / 25))}
            </span>
            <div>
              <button
                className="btn btn-ghost"
                disabled={page === 1}
                onClick={() => setPage(page - 1)}
              >
                Anterior
              </button>
              <button
                className="btn btn-ghost"
                disabled={!list || page * 25 >= list.total}
                onClick={() => setPage(page + 1)}
              >
                Próxima
              </button>
            </div>
          </div>
        </div>

        <aside className={styles.detail} aria-label="Detalhes do contato">
          {!selectedId ? (
            <div className={styles.detailEmpty}>
              <span>◎</span>
              <h2>Conheça cada contato</h2>
              <p>
                Selecione uma pessoa para ver histórico, perfil e preferências.
              </p>
            </div>
          ) : !detail ? (
            <p>Carregando detalhes...</p>
          ) : (
            <>
              <div className={styles.detailHead}>
                <div>
                  <h2>{detail.name}</h2>
                  <p>{storeName(detail.storeId)}</p>
                </div>
                <button
                  className={styles.close}
                  onClick={() => {
                    setSelectedId(null);
                    setSelectedContactStoreId(null);
                    setDetail(null);
                  }}
                  aria-label="Fechar detalhes"
                >
                  ×
                </button>
              </div>
              <div className={styles.profile}>
                <span className={styles.badge}>
                  {
                    SEGMENTS.find((item) => item.key === detail.metrics.segment)
                      ?.label
                  }
                </span>
                <strong>{detail.phone ?? "Sem telefone cadastrado"}</strong>
                {detail.email && <span>{detail.email}</span>}
                <small>
                  Marketing:{" "}
                  {detail.marketingOptIn ? "autorizado" : "não autorizado"}
                </small>
              </div>
              <div className={styles.metricGrid}>
                <div>
                  <span>Compras</span>
                  <strong>{detail.metrics.purchases}</strong>
                </div>
                <div>
                  <span>Valor total</span>
                  <strong>{money(detail.metrics.spent)}</strong>
                </div>
                <div>
                  <span>Primeira</span>
                  <strong>{date(detail.metrics.firstPurchaseAt)}</strong>
                </div>
                <div>
                  <span>Última</span>
                  <strong>{date(detail.metrics.lastPurchaseAt)}</strong>
                </div>
              </div>
              {detail.notes && (
                <div className={styles.notes}>
                  <h3>Observações</h3>
                  <p>{detail.notes}</p>
                </div>
              )}
              {can("CRM", "EDIT") && (
                <button className="btn btn-ghost" onClick={openEdit}>
                  Editar contato
                </button>
              )}
              <ContactCampaignTools
                key={detail.id}
                contactId={detail.id}
                storeId={detail.storeId}
                onChanged={async () => {
                  try {
                    setDetail(
                      await api.get<ContactDetail>(
                        `/api/crm/contacts/${detail.id}?storeId=${encodeURIComponent(detail.storeId)}`,
                      ),
                    );
                  } catch {
                    setSelectedId(null);
                    setDetail(null);
                  }
                  await load();
                }}
              />
              <div className={styles.history}>
                <h3>Interações</h3>
                {detail.activities.length ? (
                  detail.activities.map((activity) => (
                    <div className={styles.activity} key={activity.id}>
                      <div>
                        <strong>
                          {
                            {
                              NOTE: "Observação",
                              CALL: "Ligação",
                              WHATSAPP: "WhatsApp",
                              EMAIL: "E-mail",
                              SMS: "SMS",
                            }[activity.type]
                          }
                        </strong>
                        <small>
                          {date(activity.createdAt)} · {activity.createdBy}
                        </small>
                      </div>
                      <p>{activity.summary}</p>
                    </div>
                  ))
                ) : (
                  <p>Nenhuma interação registrada.</p>
                )}
              </div>
              {can("CRM", "CREATE") && (
                <form className={styles.activityForm} onSubmit={saveActivity}>
                  <h3>Registrar interação</h3>
                  <p>Histórico manual. Este registro não envia mensagens.</p>
                  <select
                    aria-label="Tipo de interação"
                    value={activityType}
                    onChange={(event) => setActivityType(event.target.value)}
                  >
                    <option value="NOTE">Observação</option>
                    <option value="CALL">Ligação</option>
                    <option value="WHATSAPP">WhatsApp</option>
                    <option value="EMAIL">E-mail</option>
                    <option value="SMS">SMS</option>
                  </select>
                  <textarea
                    aria-label="Resumo da interação"
                    required
                    minLength={2}
                    maxLength={1000}
                    rows={3}
                    value={activitySummary}
                    onChange={(event) => setActivitySummary(event.target.value)}
                    placeholder="O que aconteceu?"
                  />
                  <button className="btn btn-ghost" disabled={saving}>
                    Registrar
                  </button>
                </form>
              )}
              <div className={styles.history}>
                <h3>Histórico de compras</h3>
                {detail.sales.length ? (
                  detail.sales.map((sale) => (
                    <div className={styles.sale} key={sale.id}>
                      <span>
                        {date(sale.soldAt)}
                        <small>
                          {sale.source} · {sale.externalId}
                          {sale.status === "CANCELLED" ? " · cancelada" : ""}
                        </small>
                      </span>
                      <strong>{money(sale.totalAmount)}</strong>
                    </div>
                  ))
                ) : (
                  <p>Nenhuma venda vinculada.</p>
                )}
              </div>
              {can("CRM", "EDIT") && (
                <form className={styles.linkSale} onSubmit={attachSale}>
                  <h3>Vincular venda existente</h3>
                  <p>
                    Use o ID externo da venda da mesma loja. Uma venda não pode
                    pertencer a duas pessoas.
                  </p>
                  <div>
                    <label>
                      Origem
                      <select
                        value={saleSource}
                        onChange={(event) => setSaleSource(event.target.value)}
                      >
                        <option value="SAIPOS">Saipos</option>
                        <option value="GENERIC_WEBHOOK">Webhook</option>
                        <option value="TAKEAT">Takeat</option>
                      </select>
                    </label>
                    <label>
                      ID externo
                      <input
                        required
                        maxLength={160}
                        value={saleExternalId}
                        onChange={(event) =>
                          setSaleExternalId(event.target.value)
                        }
                      />
                    </label>
                  </div>
                  <button className="btn btn-ghost" disabled={saving}>
                    Vincular venda
                  </button>
                </form>
              )}
            </>
          )}
        </aside>
      </section>

      {formOpen && (
        <div
          className={styles.modalBackdrop}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setFormOpen(false);
          }}
        >
          <div
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="crm-form-title"
          >
            <div className={styles.modalHead}>
              <h2 id="crm-form-title">
                {editing ? "Editar contato" : "Novo contato"}
              </h2>
              <button
                className={styles.close}
                onClick={() => setFormOpen(false)}
                aria-label="Fechar formulário"
              >
                ×
              </button>
            </div>
            {error && (
              <div className={styles.error} role="alert">
                {error}
              </div>
            )}
            <form onSubmit={saveContact} className={styles.form}>
              <label>
                Loja
                <select
                  value={formStoreId}
                  onChange={(event) => setFormStoreId(event.target.value)}
                  disabled={editing}
                  required
                >
                  {(stores.length ? stores : (user?.stores ?? [])).map(
                    (store) => (
                      <option key={store.id} value={store.id}>
                        {store.name}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <label>
                Nome
                <input
                  required
                  minLength={2}
                  maxLength={160}
                  value={form.name}
                  onChange={(event) =>
                    setForm({ ...form, name: event.target.value })
                  }
                />
              </label>
              <label>
                Telefone
                <input
                  required
                  type="tel"
                  maxLength={30}
                  placeholder="(11) 99999-9999"
                  value={form.phone}
                  onChange={(event) =>
                    setForm({ ...form, phone: event.target.value })
                  }
                />
              </label>
              <label>
                E-mail
                <input
                  type="email"
                  maxLength={240}
                  value={form.email}
                  onChange={(event) =>
                    setForm({ ...form, email: event.target.value })
                  }
                />
              </label>
              <label>
                Observações
                <textarea
                  rows={3}
                  maxLength={2000}
                  value={form.notes}
                  onChange={(event) =>
                    setForm({ ...form, notes: event.target.value })
                  }
                />
              </label>
              <label className={styles.consent}>
                <input
                  type="checkbox"
                  checked={form.marketingOptIn}
                  onChange={(event) =>
                    setForm({ ...form, marketingOptIn: event.target.checked })
                  }
                />
                <span>A pessoa autorizou comunicações de marketing</span>
              </label>
              <p className={styles.formHint}>
                Sem autorização, o contato permanece na base, mas não deve
                receber campanhas.
              </p>
              <div className={styles.formActions}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setFormOpen(false)}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={saving}
                >
                  {saving
                    ? "Salvando..."
                    : editing
                      ? "Salvar alterações"
                      : "Criar contato"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
