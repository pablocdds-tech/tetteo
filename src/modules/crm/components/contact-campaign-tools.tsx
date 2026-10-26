"use client";

import { FormEvent, useEffect, useState } from "react";
import { api } from "@/modules/crm/client/api";
import { useAuth } from "@/modules/crm/client/context";
import { crmDate, crmError, useCrmMutation } from "./campaign-client";
import styles from "./crm.module.css";

type Profile = {
  identities: { id: string; type: string; verifiedAt: string }[];
  consents: { status: string; source: string; effectiveAt: string }[];
};
export default function ContactCampaignTools({
  contactId,
  storeId,
  onChanged,
}: {
  contactId: string;
  storeId: string;
  onChanged: () => Promise<void>;
}) {
  const { user, can } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [proof, setProof] = useState(""),
    [externalId, setExternalId] = useState(""),
    [verified, setVerified] = useState(false),
    [busy, setBusy] = useState(false);
  const [search, setSearch] = useState(""),
    [candidates, setCandidates] = useState<
      { id: string; name: string; phone: string }[]
    >([]),
    [target, setTarget] = useState(""),
    [reason, setReason] = useState(""),
    [mergeConfirmed, setMergeConfirmed] = useState(false);
  const mutate = useCrmMutation();
  const query = `?storeId=${encodeURIComponent(storeId)}`;
  const path = `/api/crm/contacts/${contactId}`;
  const manager = ["SUPER_ADMIN", "MANAGER"].includes(user?.role ?? "");
  useEffect(() => {
    let active = true;
    api
      .get<Profile>(`${path}/campaign-profile${query}`)
      .then((value) => {
        if (active) setProfile(value);
      })
      .catch((cause) => {
        if (active) setError(crmError(cause));
      });
    return () => {
      active = false;
    };
  }, [path, query]);
  async function perform(
    action: "consents" | "identities" | "merge",
    body: unknown,
  ) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await mutate(`${path}/${action}${query}`, body);
      if (action !== "merge")
        setProfile(await api.get<Profile>(`${path}/campaign-profile${query}`));
      setNotice(
        action === "consents"
          ? "Preferência registrada no histórico."
          : action === "identities"
            ? "Identificador verificado e vinculado."
            : "Fichas unificadas. Confira a ficha de destino e registre um novo consentimento quando houver autorização.",
      );
      setExternalId("");
      setVerified(false);
      await onChanged();
    } catch (cause) {
      setError(crmError(cause));
    } finally {
      setBusy(false);
    }
  }
  async function findDuplicate(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const result = await api.get<{
        items: { id: string; name: string; phone: string }[];
      }>(
        `/api/crm/contacts${query}&search=${encodeURIComponent(search)}&pageSize=10`,
      );
      setCandidates(result.items.filter((c) => c.id !== contactId));
    } catch (cause) {
      setError(crmError(cause));
    }
  }
  if (!can("CRM", "EDIT")) return null;
  return (
    <div className={styles.history}>
      <h3>Campanhas e consentimento</h3>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      )}
      <p>
        Canal de simulação local.{" "}
        {profile?.consents[0]
          ? `Último evento: ${profile.consents[0].status === "OPT_IN" ? "autorização" : "recusa"} em ${crmDate(profile.consents[0].effectiveAt)}.`
          : "Ainda não há consentimento comprovado para este canal."}
      </p>
      <form
        className={styles.activityForm}
        onSubmit={(event) => {
          event.preventDefault();
          void perform("consents", {
            status: "OPT_IN",
            source: "MANUAL_VERIFIED",
            proofRef: proof,
          });
        }}
      >
        <label>
          Referência da autorização
          <input
            required
            minLength={2}
            maxLength={200}
            value={proof}
            onChange={(event) => setProof(event.target.value)}
            placeholder="Ex.: formulário autorizado em 26/10"
          />
        </label>
        <button className="btn btn-ghost" disabled={busy}>
          Registrar autorização
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={busy}
          onClick={() =>
            void perform("consents", {
              status: "OPT_OUT",
              source: "MANUAL_REQUEST",
            })
          }
        >
          Bloquear campanhas
        </button>
      </form>
      {manager && (
        <details>
          <summary>Identificador do cliente na origem</summary>
          <p>
            {profile?.identities.length ?? 0} identificadores verificados. Nomes
            parecidos não unificam pessoas.
          </p>
          <form
            className={styles.activityForm}
            onSubmit={(event) => {
              event.preventDefault();
              void perform("identities", {
                type: "LOCAL_JSON",
                value: externalId,
                confirmedVerified: true,
              });
            }}
          >
            <label>
              Código do cliente no arquivo de visitas
              <input
                required
                maxLength={150}
                value={externalId}
                onChange={(event) => setExternalId(event.target.value)}
              />
            </label>
            <label>
              <input
                type="checkbox"
                required
                checked={verified}
                onChange={(event) => setVerified(event.target.checked)}
              />{" "}
              Conferi na origem que este código pertence à pessoa desta ficha.
            </label>
            <button className="btn btn-ghost" disabled={busy || !verified}>
              Vincular identificador verificado
            </button>
          </form>
        </details>
      )}
      {manager && (
        <details>
          <summary>Unificar uma ficha duplicada</summary>
          <p>
            As duas fichas precisam pertencer à mesma pessoa e loja. Públicos
            congelados bloqueiam a unificação para preservar o experimento.
          </p>
          <form className={styles.activityForm} onSubmit={findDuplicate}>
            <label>
              Buscar a ficha que será mantida
              <input
                required
                minLength={3}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <button className="btn btn-ghost" disabled={busy}>
              Buscar ficha
            </button>
          </form>
          <form
            className={styles.activityForm}
            onSubmit={(event) => {
              event.preventDefault();
              void perform("merge", {
                targetId: target,
                confirmed: true,
                reason,
              });
            }}
          >
            <label>
              Ficha de destino
              <select
                required
                value={target}
                onChange={(event) => setTarget(event.target.value)}
              >
                <option value="">Selecione a ficha conferida</option>
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {c.phone}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Motivo da unificação
              <textarea
                required
                minLength={10}
                maxLength={300}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
            <label>
              <input
                type="checkbox"
                required
                checked={mergeConfirmed}
                onChange={(event) => setMergeConfirmed(event.target.checked)}
              />{" "}
              Conferi que as duas fichas pertencem à mesma pessoa. O
              consentimento precisará ser revisto.
            </label>
            <button
              className="btn btn-ghost"
              disabled={busy || !mergeConfirmed || !target}
            >
              Unificar fichas conferidas
            </button>
          </form>
        </details>
      )}
    </div>
  );
}
