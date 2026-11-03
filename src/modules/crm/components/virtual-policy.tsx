"use client";

import { useEffect, useState } from "react";
import { api } from "../client/api";
import { useAuth } from "../client/context";
import { VirtualCredit, VirtualHeader } from "./virtual-header";
import styles from "./virtual.module.css";

type PolicyFields = {
  instructions: string;
  tone: "ACOLHEDOR" | "OBJETIVO";
  greeting: string;
  fallbackMessage: string;
};
type PolicyVersion = PolicyFields & {
  id: string;
  version: number;
  status: string;
  authorId: string;
  approvedById: string | null;
  approvedAt: string | null;
  createdAt: string;
};
type Policy = { versions: PolicyVersion[]; current: PolicyVersion | null };

export default function VirtualPolicy() {
  const { selectedStoreId: storeId, user } = useAuth();
  const manageable = user.role === "MANAGER";
  const [data, setData] = useState<Policy | null>(null);
  const [revision, setRevision] = useState(0);
  const [form, setForm] = useState<PolicyFields>({
    instructions: "",
    tone: "ACOLHEDOR",
    greeting: "",
    fallbackMessage: "",
  });
  const [reviewId, setReviewId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const reviewed = data?.versions.find((version) => version.id === reviewId);
  const unchanged = Boolean(
    reviewed &&
    form.instructions === reviewed.instructions &&
    form.tone === reviewed.tone &&
    form.greeting === reviewed.greeting &&
    form.fallbackMessage === reviewed.fallbackMessage,
  );
  useEffect(() => {
    let alive = true;
    void api
      .get<Policy>(
        `/api/crm/virtual/policy?storeId=${encodeURIComponent(storeId)}`,
      )
      .then((value) => {
        if (alive) setData(value);
      })
      .catch((failure) => {
        if (alive)
          setError(
            failure instanceof Error
              ? failure.message
              : "Não foi possível consultar as orientações.",
          );
      });
    return () => {
      alive = false;
    };
  }, [storeId, revision]);
  function review(version: PolicyVersion) {
    setReviewId(version.id);
    setForm({
      instructions: version.instructions,
      tone: version.tone,
      greeting: version.greeting,
      fallbackMessage: version.fallbackMessage,
    });
    setNotice(`Versão ${version.version} carregada para revisão.`);
  }
  async function save(approve: boolean) {
    if (busy || (approve && !reviewed)) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api.post(
        "/api/crm/virtual/policy",
        approve
          ? { storeId, action: "approve", versionId: reviewed!.id }
          : { storeId, action: "draft", ...form },
      );
      setNotice(
        approve
          ? `Versão ${reviewed!.version} aprovada para as próximas execuções.`
          : "Rascunho salvo. Revise a versão no histórico antes de aprovar.",
      );
      setRevision((value) => value + 1);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Não foi possível salvar as orientações.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className={styles.page}>
      <VirtualHeader section="skills" />
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
        <div className={styles.sectionHeading}>
          <h2>Orientação do atendimento</h2>
          <span
            className={`${styles.badge} ${data?.current ? styles.success : styles.warning}`}
          >
            {data?.current
              ? `Versão ${data.current.version} aprovada`
              : "Orientação padrão do sistema"}
          </span>
        </div>
        <p>
          Defina o tom e as orientações da Severina para esta unidade. Horários,
          cardápio e regras comerciais ficam na base operacional. Permissões,
          confirmações e limites do sistema continuam obrigatórios.
        </p>
        {data?.current && (
          <button
            className="btn"
            style={{ marginTop: 12 }}
            onClick={() => review(data.current!)}
          >
            Carregar versão vigente
          </button>
        )}
      </section>
      {!data && !error && <p className={styles.empty}>Carregando versões…</p>}
      {data && (
        <>
          <section className={styles.panel}>
            <h2>
              {reviewed
                ? `Revisão da versão ${reviewed.version}`
                : "Novo rascunho"}
            </h2>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void save(false);
              }}
            >
              <fieldset
                disabled={!manageable || busy}
                className={styles.fields}
                style={{ border: 0, minWidth: 0 }}
              >
                <label className={styles.field}>
                  Tom de voz
                  <select
                    value={form.tone}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        tone: event.target.value as PolicyFields["tone"],
                      })
                    }
                  >
                    <option value="ACOLHEDOR">Acolhedor e cordial</option>
                    <option value="OBJETIVO">Objetivo e direto</option>
                  </select>
                </label>
                <label className={styles.field}>
                  Saudação aprovada
                  <input
                    value={form.greeting}
                    maxLength={500}
                    onChange={(event) =>
                      setForm({ ...form, greeting: event.target.value })
                    }
                    placeholder="Como iniciar o atendimento"
                  />
                </label>
                <label className={styles.field}>
                  Orientações do atendimento
                  <textarea
                    value={form.instructions}
                    maxLength={4000}
                    onChange={(event) =>
                      setForm({ ...form, instructions: event.target.value })
                    }
                    placeholder="Orientações de linguagem e de atendimento para a unidade"
                  />
                </label>
                <label className={styles.field}>
                  Mensagem quando precisar de ajuda
                  <textarea
                    value={form.fallbackMessage}
                    maxLength={500}
                    onChange={(event) =>
                      setForm({ ...form, fallbackMessage: event.target.value })
                    }
                    placeholder="Texto para pedir esclarecimento sem afirmar uma ação que não aconteceu"
                  />
                </label>
                <div className={styles.actions}>
                  <button className="btn btn-primary" type="submit">
                    Salvar novo rascunho
                  </button>
                  {reviewed?.status === "DRAFT" && (
                    <button
                      className="btn"
                      type="button"
                      disabled={!unchanged}
                      onClick={() => void save(true)}
                    >
                      Aprovar versão {reviewed.version} salva
                    </button>
                  )}
                </div>
              </fieldset>
            </form>
            {reviewed?.status === "DRAFT" && !unchanged && (
              <p className={styles.muted}>
                Há alterações no formulário. Salve outro rascunho e revise essa
                versão para aprovar.
              </p>
            )}
            {!manageable && (
              <p className={styles.muted}>
                A gestão da unidade pode salvar e aprovar orientações.
              </p>
            )}
          </section>
          <section className={styles.panel}>
            <h2>Histórico de orientações</h2>
            {data.versions.length ? (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Versão</th>
                      <th>Tom</th>
                      <th>Situação</th>
                      <th>Criação</th>
                      <th>Revisão</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.versions.map((version) => (
                      <tr key={version.id}>
                        <td>{version.version}</td>
                        <td>
                          {version.tone === "ACOLHEDOR"
                            ? "Acolhedor"
                            : "Objetivo"}
                        </td>
                        <td>
                          {version.status === "APPROVED"
                            ? "Aprovada"
                            : "Rascunho"}
                        </td>
                        <td>
                          {new Date(version.createdAt).toLocaleString("pt-BR")}
                        </td>
                        <td>
                          <button
                            className="btn"
                            onClick={() => review(version)}
                          >
                            Revisar versão {version.version}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p>Nenhuma orientação personalizada salva.</p>
            )}
          </section>
        </>
      )}
      <VirtualCredit />
    </main>
  );
}
