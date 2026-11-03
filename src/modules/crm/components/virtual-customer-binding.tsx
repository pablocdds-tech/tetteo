"use client";

import { useRef, useState } from "react";
import { api } from "../client/api";
import { useAuth } from "../client/context";
import styles from "./virtual.module.css";

type ContactList = {
  items: { id: string; name: string; phone: string | null; storeId: string }[];
  total: number;
};

export default function VirtualCustomerBinding({
  conversationId,
  version,
  onBound,
}: {
  conversationId: string;
  version: number;
  onBound: () => void;
}) {
  const { selectedStoreId: storeId } = useAuth();
  const [search, setSearch] = useState("");
  const [contacts, setContacts] = useState<
    { id: string; name: string; phoneSuffix: string | null }[]
  >([]);
  const [contactId, setContactId] = useState("");
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);
  const pending = useRef<{
    contactId: string;
    body: Record<string, unknown>;
  } | null>(null);
  async function find() {
    if (busy || !search.trim()) return;
    setBusy(true);
    setError("");
    setVerified(false);
    setContactId("");
    try {
      const result = await api.get<ContactList>(
        `/api/crm/contacts?${new URLSearchParams({ storeId, search: search.trim(), page: "1", pageSize: "10" })}`,
      );
      setContacts(
        result.items
          .filter((item) => item.storeId === storeId)
          .map((item) => ({
            id: item.id,
            name: item.name,
            phoneSuffix: item.phone
              ? item.phone.replace(/\D/g, "").slice(-4)
              : null,
          })),
      );
      setSearched(true);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Não foi possível buscar cadastros nesta unidade.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function bind() {
    if (busy || !contactId || !verified) return;
    setBusy(true);
    setError("");
    if (pending.current?.contactId !== contactId)
      pending.current = {
        contactId,
        body: {
          storeId,
          conversationId,
          contactId,
          version,
          requestId: crypto.randomUUID(),
          confirmedVerified: true,
        },
      };
    try {
      await api.post("/api/crm/virtual/bind-customer", pending.current.body);
      pending.current = null;
      onBound();
    } catch (failure) {
      const message =
        failure instanceof Error
          ? failure.message
          : "Não foi possível confirmar o vínculo com o cadastro.";
      if (
        message ===
        "O atendimento mudou. Atualize a conversa antes de continuar."
      )
        pending.current = null;
      setError(message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details>
      <summary>Vincular cadastro verificado</summary>
      <p className={styles.muted}>
        Nome semelhante ou telefone digitado na conversa não confirmam
        identidade. Vincule somente após conferir a identidade do remetente.
      </p>
      {error && (
        <p className={styles.danger} role="alert">
          {error}
        </p>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void find();
        }}
        style={{ marginTop: 12 }}
      >
        <label className={styles.field}>
          Buscar cadastro desta unidade
          <input
            value={search}
            maxLength={100}
            disabled={busy}
            onChange={(event) => {
              setSearch(event.target.value);
              setVerified(false);
            }}
            required
          />
        </label>
        <button
          type="submit"
          className="btn"
          style={{ marginTop: 8 }}
          disabled={busy || !search.trim()}
        >
          Buscar cadastro
        </button>
      </form>
      {contacts.length > 0 && (
        <>
          <label className={styles.field} style={{ marginTop: 12 }}>
            Cadastro confirmado
            <select
              value={contactId}
              disabled={busy}
              onChange={(event) => {
                setContactId(event.target.value);
                setVerified(false);
              }}
            >
              <option value="">Selecione o cadastro</option>
              {contacts.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.name}
                  {contact.phoneSuffix
                    ? ` · telefone final ${contact.phoneSuffix}`
                    : ""}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.checkboxLabel} style={{ marginTop: 12 }}>
            <input
              type="checkbox"
              checked={verified}
              disabled={busy || !contactId}
              onChange={(event) => setVerified(event.target.checked)}
            />{" "}
            Conferi a identidade do remetente com a equipe e confirmei que este
            cadastro pertence a ele.
          </label>
          <button
            className="btn"
            disabled={busy || !contactId || !verified}
            style={{ marginTop: 8 }}
            onClick={() => void bind()}
          >
            Confirmar vínculo verificado
          </button>
        </>
      )}
      {searched && contacts.length === 0 && (
        <p className={styles.muted}>
          Nenhum cadastro encontrado. Ajuste a busca para localizar a pessoa
          correta.
        </p>
      )}
    </details>
  );
}
