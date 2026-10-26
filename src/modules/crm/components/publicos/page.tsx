/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/modules/crm/client/api";
import { useAuth } from "@/modules/crm/client/context";
import {
  crmDate,
  crmError,
  retentionRules,
  useCrmMutation,
} from "../campaign-client";
import styles from "../campaigns.module.css";

type Overview = {
  counts: Record<string, number>;
  total: number;
  covered: number;
  oldestSnapshotAt: string | null;
  latestSnapshotAt: string | null;
  ruleVersion: string;
  source: string;
  jobsEnabled: boolean;
  simulationEnabled: boolean;
  job: { id: string; status: string; processed: number } | null;
  latestImport: {
    id: string;
    status: string;
    applied: number;
    errors: { code: string; line?: number }[];
    durationMs: number | null;
    updatedAt: string;
  } | null;
};

export default function AudiencesPage() {
  const { selectedStoreId, setSelectedStoreId, can, user } = useAuth();
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [data, setData] = useState<Overview | null>(null);
  const [dataStore, setDataStore] = useState("");
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false);
  const activeStore = useRef(selectedStoreId);
  useEffect(() => {
    activeStore.current = selectedStoreId;
  }, [selectedStoreId]);
  const mutate = useCrmMutation();
  const view = dataStore === selectedStoreId ? data : null;
  const scoped = selectedStoreId !== "all";
  const query = `?storeId=${encodeURIComponent(selectedStoreId)}`;
  const load = useCallback(async () => {
    if (selectedStoreId === "all" || !can("CRM", "VIEW")) return;
    const store = selectedStoreId;
    setLoading(true);
    try {
      const next = await api.get<Overview>(
        `/api/crm/audiences?storeId=${encodeURIComponent(store)}`,
      );
      if (activeStore.current === store) {
        setData(next);
        setDataStore(store);
        setError("");
      }
    } catch (cause) {
      if (activeStore.current === store) setError(crmError(cause));
    } finally {
      if (activeStore.current === store) setLoading(false);
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
    if (!view?.job || !["ACCEPTED", "RUNNING"].includes(view.job.status))
      return;
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [load, view?.job]);

  async function refresh() {
    setBusy(true);
    setError("");
    try {
      await mutate(`/api/crm/audiences/refresh${query}`, {});
      setNotice("Atualização solicitada. O processamento acontece em lotes.");
      await load();
    } catch (cause) {
      setError(crmError(cause));
    } finally {
      setBusy(false);
    }
  }
  async function importFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 180_000) {
      setError("Use um arquivo JSON de até 180 KB e 500 visitas por lote.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const content = JSON.parse(await file.text());
      const result = await mutate<{ importId: string; status: string }>(
        `/api/crm/imports${query}`,
        { rows: Array.isArray(content) ? content : content.rows },
      );
      setNotice(
        `Importação ${result.importId}: ${result.status}. Consulte o estado abaixo após o processamento.`,
      );
      await load();
    } catch (cause) {
      setError(crmError(cause));
    } finally {
      setBusy(false);
    }
  }

  if (!can("CRM", "VIEW"))
    return <div className={styles.page}>Sem permissão para acessar o CRM.</div>;
  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <h1>Públicos para a próxima visita</h1>
          <p>
            Frequência e recência das compras identificadas, com regras visíveis
            antes de preparar uma campanha.
          </p>
        </div>
        {scoped && can("CRM", "EDIT") && (
          <button
            className="btn btn-primary"
            onClick={refresh}
            disabled={busy || loading}
          >
            Atualizar públicos
          </button>
        )}
      </header>
      <label className={styles.store}>
        Loja do público
        <select
          value={selectedStoreId}
          onChange={(e) => {
            setSelectedStoreId(e.target.value);
            setError("");
            setNotice("");
          }}
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
          Selecione uma loja para conferir a origem das visitas e preparar seu
          público.
        </p>
      ) : (
        <>
          {loading && !view && <p role="status">Carregando públicos…</p>}
          {view && (
            <>
              <div className={styles.info}>
                {view.source}
                <br />
                {view.covered} de {view.total} contatos classificados.
                Atualização mais antiga: {crmDate(view.oldestSnapshotAt)}{" "}
                (America/Sao_Paulo). Regra {view.ruleVersion}.
              </div>
              {!view.jobsEnabled && (
                <div className={styles.info}>
                  O processamento está pausado no servidor. Solicitações ficam
                  na fila até a ativação dos jobs.
                </div>
              )}
              {view.job &&
                ["ACCEPTED", "RUNNING"].includes(view.job.status) && (
                  <p role="status" className={styles.muted}>
                    Atualizando públicos: {view.job.processed} contatos
                    processados.
                  </p>
                )}
              {!view.total && (
                <p className={styles.empty}>
                  Ainda não há contatos nesta loja.{" "}
                  <Link href="/crm">Cadastre ou confira os contatos.</Link>
                </p>
              )}
              <section
                className={styles.grid}
                aria-label="Segmentos de retenção"
              >
                {retentionRules.map((rule) => (
                  <article className={styles.segment} key={rule.key}>
                    <h2>{rule.label}</h2>
                    <strong>{view.counts[rule.key] ?? 0}</strong>
                    <p>{rule.rule}</p>
                  </article>
                ))}
              </section>
              <p className={styles.muted}>
                Regras aplicadas por prioridade: VIP, regular, ocasional, em
                risco e perdido.
              </p>
              <p className={styles.muted}>
                As visitas são históricas. A receita de uma campanha usa uma
                janela própria. Contatos sem autorização válida para o canal
                ficam fora do envio.
              </p>
              <div className={styles.actions}>
                <Link href="/crm/campanhas" className="btn btn-primary">
                  Preparar campanha
                </Link>
                <Link href="/crm">Conferir fichas</Link>
              </div>
              {["SUPER_ADMIN", "MANAGER"].includes(user?.role ?? "") && (
                <details className={styles.panel} style={{ marginTop: 28 }}>
                  <summary>Importar visitas de um arquivo local</summary>
                  <p className={styles.muted}>
                    JSON com até 500 visitas. Cada identificador de cliente
                    precisa ter sido conferido e vinculado em sua ficha. O
                    arquivo informa ID externo da visita, cliente da origem,
                    instante com fuso, receita líquida em centavos, revisão e
                    motivo.
                  </p>
                  <label className={styles.field}>
                    Arquivo de visitas
                    <input
                      className={styles.file}
                      type="file"
                      accept="application/json,.json"
                      disabled={busy}
                      onChange={(e) => {
                        void importFile(e.target.files?.[0]);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  {view.latestImport && (
                    <div className={styles.info}>
                      Último lote: {view.latestImport.status}.{" "}
                      {view.latestImport.applied} alterações aplicadas.{" "}
                      {view.latestImport.errors.length} erros. Atualizado em{" "}
                      {crmDate(view.latestImport.updatedAt)}.
                      {view.latestImport.errors
                        .slice(0, 8)
                        .map((error, index) => (
                          <p key={index}>
                            {error.line ? `Linha ${error.line}: ` : ""}
                            {error.code}
                          </p>
                        ))}
                      <button
                        className="btn btn-ghost"
                        onClick={() => void load()}
                      >
                        Conferir processamento
                      </button>
                    </div>
                  )}
                </details>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
