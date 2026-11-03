"use client";

import { useEffect, useState } from "react";
import { api } from "../client/api";
import { useAuth } from "../client/context";
import styles from "./virtual.module.css";

type AccountSettings = {
  active: boolean;
  debounceMs: number;
  maxWaitMs: number;
  maxTurnTokens: number;
  maxTurnCostMicros: number;
  dailyBudgetMicros: number;
  notificationUserId: string | null;
  circuitMinutes: number;
};
type SettingsResponse = {
  account:
    | (Omit<AccountSettings, "circuitMinutes"> & {
        id: string;
        circuitUntil: string | null;
      })
    | null;
  destinations: { id: string; name: string }[];
};

export default function VirtualSettings() {
  const { selectedStoreId: storeId } = useAuth();
  const [settings, setSettings] = useState<AccountSettings | null>(null);
  const [destinations, setDestinations] = useState<
    SettingsResponse["destinations"]
  >([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void api
      .get<SettingsResponse>(
        `/api/crm/virtual/settings?storeId=${encodeURIComponent(storeId)}`,
      )
      .then((result) => {
        if (!alive) return;
        setDestinations(result.destinations);
        if (result.account) {
          const {
            active,
            debounceMs,
            maxWaitMs,
            maxTurnTokens,
            maxTurnCostMicros,
            dailyBudgetMicros,
            notificationUserId,
            circuitUntil,
          } = result.account;
          setSettings({
            active,
            debounceMs,
            maxWaitMs,
            maxTurnTokens,
            maxTurnCostMicros,
            dailyBudgetMicros,
            notificationUserId,
            circuitMinutes: circuitUntil
              ? Math.max(
                  0,
                  Math.ceil(
                    (new Date(circuitUntil).getTime() - Date.now()) / 60_000,
                  ),
                )
              : 0,
          });
        }
      })
      .catch((failure) => {
        if (alive)
          setError(
            failure instanceof Error
              ? failure.message
              : "Não foi possível consultar a configuração do canal.",
          );
      });
    return () => {
      alive = false;
    };
  }, [storeId]);

  async function save() {
    if (!settings || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api.post("/api/crm/virtual/settings", { storeId, ...settings });
      setNotice("Configuração do canal local salva e auditada.");
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Não foi possível salvar a configuração do canal.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.panel}>
      <h2>Canal local e limites de operação</h2>
      <p>
        A configuração vale somente para o atendimento de demonstração desta
        unidade. O destino recebe notificações internas; a equipe registra o
        reconhecimento na conversa.
      </p>
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
      {!settings && !error && (
        <p className={styles.muted}>
          Prepare os exemplos no inbox para configurar a conta local.
        </p>
      )}
      {settings && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <fieldset
            disabled={busy}
            className={styles.fields}
            style={{ border: 0, minWidth: 0 }}
          >
            <label className={styles.field}>
              Funcionamento do canal
              <select
                value={settings.active ? "active" : "paused"}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    active: event.target.value === "active",
                  })
                }
              >
                <option value="active">Ativo no modo demonstração</option>
                <option value="paused">
                  Pausar todo o atendimento deste canal
                </option>
              </select>
            </label>
            <label className={styles.field}>
              Pessoa que recebe os alertas
              <select
                value={settings.notificationUserId ?? ""}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    notificationUserId: event.target.value || null,
                  })
                }
              >
                <option value="">Sem destino configurado</option>
                {destinations.map((destination) => (
                  <option key={destination.id} value={destination.id}>
                    {destination.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              Intervalo para agrupar mensagens, em segundos
              <input
                type="number"
                required
                min="0"
                max="10"
                step="0.001"
                value={settings.debounceMs / 1000}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    debounceMs: Math.round(Number(event.target.value) * 1000),
                  })
                }
              />
            </label>
            <label className={styles.field}>
              Espera máxima do agrupamento, em segundos
              <input
                type="number"
                required
                min={Math.max(0.25, settings.debounceMs / 1000)}
                max="60"
                step="0.001"
                value={settings.maxWaitMs / 1000}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    maxWaitMs: Math.round(Number(event.target.value) * 1000),
                  })
                }
              />
            </label>
            <label className={styles.field}>
              Limite de tokens por execução
              <input
                type="number"
                required
                min="128"
                max="16000"
                value={settings.maxTurnTokens}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    maxTurnTokens: Number(event.target.value),
                  })
                }
              />
            </label>
            <label className={styles.field}>
              Teto por execução, em US$
              <input
                type="number"
                required
                min="0.000001"
                max="100"
                step="0.000001"
                value={settings.maxTurnCostMicros / 1_000_000}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    maxTurnCostMicros: Math.round(
                      Number(event.target.value) * 1_000_000,
                    ),
                  })
                }
              />
            </label>
            <label className={styles.field}>
              Teto diário, em US$
              <input
                type="number"
                required
                min={settings.maxTurnCostMicros / 1_000_000}
                max="1000"
                step="0.000001"
                value={settings.dailyBudgetMicros / 1_000_000}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    dailyBudgetMicros: Math.round(
                      Number(event.target.value) * 1_000_000,
                    ),
                  })
                }
              />
            </label>
            <label className={styles.field}>
              Proteção temporária após salvar, em minutos
              <input
                type="number"
                required
                min="0"
                max="10080"
                value={settings.circuitMinutes}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    circuitMinutes: Number(event.target.value),
                  })
                }
              />
              <span className={styles.metadata}>
                Zero libera a proteção temporária. Um prazo positivo conta a
                partir do salvamento.
              </span>
            </label>
            <button className="btn btn-primary" type="submit">
              {busy ? "Salvando…" : "Salvar configuração do canal"}
            </button>
          </fieldset>
        </form>
      )}
    </section>
  );
}
