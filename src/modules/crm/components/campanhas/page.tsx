/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/modules/crm/client/api";
import { useAuth } from "@/modules/crm/client/context";
import {
  crmDate,
  crmError,
  crmMoney,
  retentionRules,
  useCrmMutation,
} from "../campaign-client";
import styles from "../campaigns.module.css";

type Fields = {
  name: string;
  objective: string;
  segment: string;
  startDate: string;
  endDate: string;
  message: string;
  benefit: string;
  costBudgetCents: number;
  unitCostCents: number;
  fixedCostCents: number;
};
type Campaign = Omit<Fields, "startDate" | "endDate"> & {
  id: string;
  storeId: string;
  status: string;
  version: number;
  startAt: string;
  endAt: string;
  previewHash: string | null;
  eligibleAt: string | null;
  excluded: number;
  groups?: Record<string, number>;
  deliveries?: Record<string, number>;
};
type Group = {
  assigned: number;
  returned: number;
  visits: number;
  netRevenueCents: number | null;
  simulated: number;
  blocked: number;
  failed: number;
  uncertain: number;
  contaminated: number;
};
type Result = {
  status: string;
  endAt?: string;
  treatment?: Group;
  control?: Group;
  treatmentRate?: number | null;
  controlRate?: number | null;
  upliftPoints?: number | null;
  incrementalRevenueCents?: number | null;
  contributionAfterCampaignCents?: number | null;
  costCents?: number;
  calculatedAt?: string;
  note?: string;
};
const empty: Fields = {
  name: "",
  objective: "Incentivar uma nova visita",
  segment: "AT_RISK",
  startDate: "",
  endDate: "",
  message: "",
  benefit: "",
  costBudgetCents: 0,
  unitCostCents: 0,
  fixedCostCents: 0,
};
const statusLabel: Record<string, string> = {
  DRAFT: "Rascunho",
  APPROVED: "Aprovada",
  RUNNING: "Simulação autorizada",
  CLOSED: "Janela encerrada",
};
const localDay = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
const fieldsOf = (c: Campaign): Fields => ({
  name: c.name,
  objective: c.objective,
  segment: c.segment,
  startDate: localDay(c.startAt),
  endDate: localDay(c.endAt),
  message: c.message,
  benefit: c.benefit,
  costBudgetCents: c.costBudgetCents,
  unitCostCents: c.unitCostCents,
  fixedCostCents: c.fixedCostCents,
});

export default function CampaignsPage() {
  const { selectedStoreId, setSelectedStoreId, user, can } = useAuth();
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [items, setItems] = useState<Campaign[]>([]),
    [loadedStore, setLoadedStore] = useState("");
  const [current, setCurrent] = useState<Campaign | null>(null),
    [form, setForm] = useState<Fields>(empty);
  const [saved, setSaved] = useState(JSON.stringify(empty));
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const storeRef = useRef(selectedStoreId),
    selectionRef = useRef<string | null>(null);
  useEffect(() => {
    storeRef.current = selectedStoreId;
  }, [selectedStoreId]);
  const mutate = useCrmMutation();
  const query = `?storeId=${encodeURIComponent(selectedStoreId)}`;
  const scoped = selectedStoreId !== "all";
  const manage = ["SUPER_ADMIN", "MANAGER"].includes(user?.role ?? "");
  const dirty = JSON.stringify(form) !== saved;
  const visibleCurrent = current?.storeId === selectedStoreId ? current : null;
  const editable =
    (!visibleCurrent || visibleCurrent.status === "DRAFT") &&
    can("CRM", "EDIT");

  const load = useCallback(async () => {
    if (selectedStoreId === "all" || !can("CRM", "VIEW")) return;
    const storeId = selectedStoreId;
    setLoading(true);
    try {
      const list = await api.get<{ items: Campaign[] }>(
        `/api/crm/experiments?storeId=${encodeURIComponent(storeId)}`,
      );
      if (storeRef.current === storeId) {
        setItems(list.items);
        setLoadedStore(storeId);
      }
    } catch (cause) {
      if (storeRef.current === storeId) setError(crmError(cause));
    } finally {
      if (storeRef.current === storeId) setLoading(false);
    }
  }, [selectedStoreId, can]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    api
      .get<{ id: string; name: string }[]>("/api/crm/stores")
      .then(setStores)
      .catch((cause) => setError(crmError(cause)));
  }, []);
  useEffect(() => {
    setCurrent(null);
    setResult(null);
    setForm(empty);
    setSaved(JSON.stringify(empty));
    selectionRef.current = null;
    setError("");
    setNotice("");
  }, [selectedStoreId]);

  async function select(id: string, updateForm = true) {
    const storeId = selectedStoreId;
    selectionRef.current = id;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const [detail, nextResult] = await Promise.all([
        api.get<Campaign>(`/api/crm/experiments/${id}${query}`),
        api.get<Result>(`/api/crm/experiments/${id}/result${query}`),
      ]);
      if (storeRef.current !== storeId || selectionRef.current !== id) return;
      setCurrent(detail);
      setResult(nextResult);
      if (updateForm) {
        const next = fieldsOf(detail);
        setForm(next);
        setSaved(JSON.stringify(next));
      }
    } catch (cause) {
      if (storeRef.current === storeId) setError(crmError(cause));
    } finally {
      setBusy(false);
    }
  }
  function newDraft() {
    selectionRef.current = null;
    setCurrent(null);
    setResult(null);
    setForm(empty);
    setSaved(JSON.stringify(empty));
    setNotice("");
    setError("");
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const created = visibleCurrent
        ? await mutate<Campaign>(
            `/api/crm/experiments/${visibleCurrent.id}${query}`,
            { ...form, version: visibleCurrent.version },
            "PUT",
          )
        : await mutate<Campaign>(`/api/crm/experiments${query}`, form);
      setNotice("Rascunho salvo. Revise o público antes de aprovar.");
      await load();
      await select(created.id);
    } catch (cause) {
      setError(crmError(cause));
    } finally {
      setBusy(false);
    }
  }
  async function action(kind: "preview" | "approve" | "simulate") {
    if (!visibleCurrent) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const body =
        kind === "approve"
          ? {
              version: visibleCurrent.version,
              previewHash: visibleCurrent.previewHash,
            }
          : kind === "simulate"
            ? { version: visibleCurrent.version, confirmed: true }
            : { version: visibleCurrent.version };
      await mutate(
        `/api/crm/experiments/${visibleCurrent.id}/${kind}${query}`,
        body,
      );
      setNotice(
        kind === "preview"
          ? "Público congelado. Confira a mensagem, os grupos e o custo máximo."
          : kind === "approve"
            ? "Versão aprovada. A simulação depende de autorização separada e respeita o início da janela."
            : "Simulação local autorizada. O processamento respeita o período, o horário e a frequência configurados no servidor.",
      );
      await load();
      await select(visibleCurrent.id, false);
    } catch (cause) {
      setError(crmError(cause));
    } finally {
      setBusy(false);
    }
  }
  async function exportResult() {
    if (!visibleCurrent) return;
    try {
      const data = await api.get(
        `/api/crm/experiments/${visibleCurrent.id}/export${query}`,
      );
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `campanha-${visibleCurrent.id}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(crmError(cause));
    }
  }

  if (!can("CRM", "VIEW"))
    return <div className={styles.page}>Sem permissão para acessar o CRM.</div>;
  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <h1>Campanhas com comparação</h1>
          <p>
            Prepare uma ação, aprove a versão e compare quem recebeu a simulação
            com quem ficou no controle.
          </p>
        </div>
        {scoped && can("CRM", "EDIT") && (
          <button className="btn btn-ghost" disabled={busy} onClick={newDraft}>
            Novo rascunho
          </button>
        )}
      </header>
      <label className={styles.store}>
        Loja da campanha
        <select
          value={selectedStoreId}
          onChange={(e) => setSelectedStoreId(e.target.value)}
          disabled={busy}
        >
          <option value="all">Selecione uma loja</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <div role="alert" className={styles.error}>
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className={styles.notice}>
          {notice}
        </div>
      )}
      {!scoped ? (
        <p className={styles.empty}>
          Selecione uma loja para preparar campanhas com dados apenas desta
          unidade.
        </p>
      ) : (
        <>
          <div className={styles.info}>
            Modo local: nenhum WhatsApp, SMS ou e-mail é enviado. Controle
            aproximado de 20%, sem remanejar pessoas após o congelamento.{" "}
            <Link href="/crm/publicos">Conferir públicos e atualização</Link>
          </div>
          <div className={styles.workspace}>
            <aside className={styles.list} aria-label="Campanhas salvas">
              {loading && (
                <p role="status" className={styles.muted}>
                  Carregando campanhas…
                </p>
              )}
              {loadedStore === selectedStoreId &&
                items.map((item) => (
                  <button
                    key={item.id}
                    aria-pressed={visibleCurrent?.id === item.id}
                    disabled={busy}
                    onClick={() => void select(item.id)}
                  >
                    <strong>{item.name}</strong>
                    <span>
                      {statusLabel[item.status] ?? item.status} · versão{" "}
                      {item.version}
                    </span>
                    <span>
                      {crmDate(item.startAt)} a {crmDate(item.endAt)}
                    </span>
                  </button>
                ))}
              {!loading && loadedStore === selectedStoreId && !items.length && (
                <p className={styles.empty}>
                  Nenhuma campanha salva. Comece com um rascunho.
                </p>
              )}
            </aside>
            <section
              className={styles.panel}
              aria-label="Preparação e revisão da campanha"
            >
              <h2>
                {visibleCurrent
                  ? `${visibleCurrent.name} · versão ${visibleCurrent.version}`
                  : "Preparar campanha"}
              </h2>
              <form className={styles.form} onSubmit={save}>
                <label>
                  Nome da campanha
                  <input
                    required
                    minLength={2}
                    maxLength={120}
                    value={form.name}
                    disabled={!editable || busy}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </label>
                <label>
                  Público
                  <select
                    value={form.segment}
                    disabled={!editable || busy}
                    onChange={(e) =>
                      setForm({ ...form, segment: e.target.value })
                    }
                  >
                    {retentionRules.map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.wide}>
                  Objetivo
                  <input
                    required
                    minLength={3}
                    maxLength={500}
                    value={form.objective}
                    disabled={!editable || busy}
                    onChange={(e) =>
                      setForm({ ...form, objective: e.target.value })
                    }
                  />
                </label>
                <label>
                  Início da janela
                  <input
                    required
                    type="date"
                    value={form.startDate}
                    disabled={!editable || busy}
                    onChange={(e) =>
                      setForm({ ...form, startDate: e.target.value })
                    }
                  />
                </label>
                <label>
                  Fim da janela (exclusivo)
                  <input
                    required
                    type="date"
                    value={form.endDate}
                    disabled={!editable || busy}
                    onChange={(e) =>
                      setForm({ ...form, endDate: e.target.value })
                    }
                  />
                </label>
                <small className={styles.wide}>
                  Dias em America/Sao_Paulo, da meia-noite inicial até antes da
                  meia-noite final. Congele o público antes do dia de início.
                </small>
                <label className={styles.wide}>
                  Benefício e validade
                  <input
                    required
                    maxLength={500}
                    value={form.benefit}
                    disabled={!editable || busy}
                    placeholder="Ex.: benefício válido durante a janela; sem benefício financeiro"
                    onChange={(e) =>
                      setForm({ ...form, benefit: e.target.value })
                    }
                  />
                </label>
                <label className={styles.wide}>
                  Mensagem da simulação
                  <textarea
                    required
                    minLength={5}
                    maxLength={2000}
                    rows={4}
                    value={form.message}
                    disabled={!editable || busy}
                    onChange={(e) =>
                      setForm({ ...form, message: e.target.value })
                    }
                  />
                </label>
                <label>
                  Orçamento máximo (R$)
                  <input
                    required
                    type="number"
                    min="0"
                    max="10000000"
                    step="0.01"
                    value={form.costBudgetCents / 100}
                    disabled={!editable || busy}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        costBudgetCents: Math.round(
                          Number(e.target.value) * 100,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  Custo por simulação (R$)
                  <input
                    required
                    type="number"
                    min="0"
                    max="10000000"
                    step="0.01"
                    value={form.unitCostCents / 100}
                    disabled={!editable || busy}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        unitCostCents: Math.round(Number(e.target.value) * 100),
                      })
                    }
                  />
                </label>
                <label className={styles.wide}>
                  Outros custos considerados, inclusive descontos (R$)
                  <input
                    required
                    type="number"
                    min="0"
                    max="10000000"
                    step="0.01"
                    value={form.fixedCostCents / 100}
                    disabled={!editable || busy}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        fixedCostCents: Math.round(
                          Number(e.target.value) * 100,
                        ),
                      })
                    }
                  />
                  <small>
                    Valor fixo considerado no cenário; não é uma apuração
                    automática de descontos reais.
                  </small>
                </label>
                {editable && (
                  <div className={styles.wide}>
                    <button
                      className="btn btn-primary"
                      type="submit"
                      disabled={busy || (!!visibleCurrent && !dirty)}
                    >
                      {busy ? "Processando…" : "Salvar rascunho"}
                    </button>
                  </div>
                )}
              </form>
              {visibleCurrent?.status === "DRAFT" && (
                <div className={styles.actions}>
                  <button
                    className="btn btn-ghost"
                    disabled={busy || dirty || !can("CRM", "EDIT")}
                    onClick={() => void action("preview")}
                  >
                    Revisar público
                  </button>
                  {dirty && (
                    <span className={styles.muted}>
                      Salve as alterações para revisar esta versão.
                    </span>
                  )}
                </div>
              )}
              {visibleCurrent?.previewHash && (
                <section
                  className={styles.preview}
                  aria-label="Revisão da versão"
                >
                  <h3>Conferir antes de aprovar</h3>
                  <p>{visibleCurrent.message}</p>
                  <div className={styles.facts}>
                    <div>
                      Tratamento
                      <strong>{visibleCurrent.groups?.TREATMENT ?? 0}</strong>
                    </div>
                    <div>
                      Controle
                      <strong>{visibleCurrent.groups?.CONTROL ?? 0}</strong>
                    </div>
                    <div>
                      Sem consentimento elegível
                      <strong>{visibleCurrent.excluded}</strong>
                    </div>
                    <div>
                      Custo máximo
                      <strong>
                        {crmMoney(
                          (visibleCurrent.groups?.TREATMENT ?? 0) *
                            visibleCurrent.unitCostCents +
                            visibleCurrent.fixedCostCents,
                        )}
                      </strong>
                    </div>
                  </div>
                  <p>
                    Benefício: {visibleCurrent.benefit}
                    <br />
                    Validade: {crmDate(visibleCurrent.startAt)} até antes de{" "}
                    {crmDate(visibleCurrent.endAt)}.<br />
                    Público congelado em {crmDate(visibleCurrent.eligibleAt)}.
                    Opt-out posterior bloqueia a simulação e preserva a
                    alocação.
                  </p>
                  {!visibleCurrent.groups?.CONTROL && (
                    <p>
                      Este público ficou sem controle. A comparação incremental
                      ficará indisponível; a distribuição é aproximada em
                      amostras pequenas.
                    </p>
                  )}
                  {visibleCurrent.status === "DRAFT" && manage && (
                    <div className={styles.actions}>
                      <button
                        className="btn btn-primary"
                        disabled={busy || dirty}
                        onClick={() => void action("approve")}
                      >
                        Aprovar esta versão
                      </button>
                    </div>
                  )}
                  {visibleCurrent.status === "APPROVED" && manage && (
                    <div className={styles.actions}>
                      <button
                        className="btn btn-primary"
                        disabled={busy}
                        onClick={() => void action("simulate")}
                      >
                        Autorizar simulação local
                      </button>
                    </div>
                  )}
                  {!manage && visibleCurrent.status === "DRAFT" && (
                    <p>A aprovação exige um gerente.</p>
                  )}
                </section>
              )}
              {visibleCurrent && (
                <section
                  className={styles.result}
                  aria-label="Resultado da campanha"
                >
                  <h3>Comparação por pessoa alocada</h3>
                  {visibleCurrent.deliveries && (
                    <p className={styles.muted}>
                      {visibleCurrent.deliveries.SIMULATED ?? 0} simulações
                      aceitas · {visibleCurrent.deliveries.BLOCKED ?? 0}{" "}
                      bloqueadas · {visibleCurrent.deliveries.UNCERTAIN ?? 0}{" "}
                      incertas. Aceite não comprova leitura.
                    </p>
                  )}
                  {result?.status === "WAITING_WINDOW" && (
                    <p className={styles.empty}>
                      Aguardando janela. A comparação fica disponível após{" "}
                      {crmDate(result.endAt ?? null)}.
                    </p>
                  )}
                  {result?.status === "WAITING_AGGREGATION" && (
                    <p className={styles.empty}>
                      Janela encerrada. Aguardando o processamento dos
                      resultados.
                    </p>
                  )}
                  {result?.status === "READY" &&
                    result.treatment &&
                    result.control && (
                      <>
                        <table className={styles.comparison}>
                          <thead>
                            <tr>
                              <th>Indicador</th>
                              <th>Tratamento</th>
                              <th>Controle</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(
                              [
                                ["Pessoas alocadas", "assigned"],
                                ["Pessoas que voltaram", "returned"],
                                ["Visitas na janela", "visits"],
                                ["Simulações aceitas", "simulated"],
                                ["Bloqueadas", "blocked"],
                                ["Incertas", "uncertain"],
                                ["Expostas a outra campanha", "contaminated"],
                              ] as const
                            ).map(([label, key]) => (
                              <tr key={key}>
                                <td>{label}</td>
                                <td>{result.treatment![key]}</td>
                                <td>{result.control![key]}</td>
                              </tr>
                            ))}
                            <tr>
                              <td>Taxa de retorno</td>
                              <td>
                                {result.treatmentRate == null
                                  ? "Indisponível"
                                  : `${(result.treatmentRate * 100).toFixed(1)}%`}
                              </td>
                              <td>
                                {result.controlRate == null
                                  ? "Indisponível"
                                  : `${(result.controlRate * 100).toFixed(1)}%`}
                              </td>
                            </tr>
                            <tr>
                              <td>Receita líquida na janela</td>
                              <td>
                                {crmMoney(result.treatment.netRevenueCents)}
                              </td>
                              <td>
                                {crmMoney(result.control.netRevenueCents)}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                        <p className={styles.uplift}>
                          {result.upliftPoints == null
                            ? "Comparação indisponível"
                            : `${result.upliftPoints > 0 ? "+" : ""}${result.upliftPoints.toLocaleString("pt-BR")} p.p.`}
                        </p>
                        <div className={styles.facts}>
                          <div>
                            Receita incremental estimada
                            <strong>
                              {crmMoney(result.incrementalRevenueCents ?? null)}
                            </strong>
                          </div>
                          <div>
                            Custo considerado
                            <strong>
                              {crmMoney(result.costCents ?? null)}
                            </strong>
                          </div>
                          <div>
                            Estimativa após esse custo
                            <strong>
                              {crmMoney(
                                result.contributionAfterCampaignCents ?? null,
                              )}
                            </strong>
                          </div>
                        </div>
                        <p className={styles.muted}>
                          {result.note} Resultado após custo não é lucro
                          líquido. Atualização:{" "}
                          {crmDate(result.calculatedAt ?? null)}.
                        </p>
                      </>
                    )}
                  <div className={styles.actions}>
                    <button
                      className="btn btn-ghost"
                      disabled={busy}
                      onClick={() => void select(visibleCurrent.id, false)}
                    >
                      Atualizar resultado
                    </button>
                    <button
                      className="btn btn-ghost"
                      onClick={() => void exportResult()}
                    >
                      Exportar IDs e resultados
                    </button>
                  </div>
                </section>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
