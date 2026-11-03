"use client";

import { FormEvent, useEffect, useState } from "react";
import { api } from "../client/api";
import { useAuth } from "../client/context";
import { useVirtualAccount } from "../client/virtual-channel-context";
import type { VirtualFacts } from "../services/virtual-knowledge";
import { VirtualCredit, VirtualHeader } from "./virtual-header";
import VirtualSettings from "./virtual-settings";
import styles from "./virtual.module.css";

type Version = {
  id: string;
  version: number;
  status: string;
  authorId: string;
  approvedById: string | null;
  approvedAt: string | null;
  validFrom: string;
  validUntil: string;
  createdAt: string;
  facts: VirtualFacts;
};
type Knowledge = {
  accountId: string | null;
  versions: Version[];
  slots: {
    id: string;
    date: string;
    time: string;
    capacity: number;
    enabled: boolean;
    version: number;
  }[];
};
const DAYS = [
  "Domingo",
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
];
const LINK_NAMES = {
  menu: "Cardápio",
  booking: "Reserva",
  location: "Localização",
  support: "Suporte",
};
function localInput(value: Date) {
  return new Date(value.getTime() - value.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}
const when = (value: string) => new Date(value).toLocaleString("pt-BR");
const failureText = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Não foi possível salvar a configuração.";

export default function VirtualKnowledgePage({
  embedded = false,
}: {
  embedded?: boolean;
}) {
  const { selectedAccountId, account } = useVirtualAccount();
  if (!selectedAccountId)
    return (
      <section className={styles.panel}>
        <h2>Informações da conta</h2>
        <p>
          Configure ou selecione uma conta de canal para cadastrar a base
          operacional.
        </p>
      </section>
    );
  return (
    <VirtualKnowledgeForAccount
      key={selectedAccountId}
      embedded={embedded}
      accountId={selectedAccountId}
      demo={account?.provider === "DEMO"}
    />
  );
}

function VirtualKnowledgeForAccount({
  embedded,
  accountId,
  demo,
}: {
  embedded: boolean;
  accountId: string;
  demo: boolean;
}) {
  const { selectedStoreId: storeId, user } = useAuth();
  const manageable = user.role === "MANAGER";
  const unitName =
    user.stores.find((store) => store.id === storeId)?.name ?? "Unidade";
  const [data, setData] = useState<Knowledge | null>(null);
  const [revision, setRevision] = useState(0);
  const [checkedAt, setCheckedAt] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [reviewId, setReviewId] = useState("");
  const [facts, setFacts] = useState<VirtualFacts>({
    name: unitName,
    address: "",
    hours: [],
    exceptions: [],
    menu: [],
    links: [],
    reservationPolicy: "",
    supportContact: "",
  });
  const [validFrom, setValidFrom] = useState(() => localInput(new Date()));
  const [validUntil, setValidUntil] = useState(() =>
    localInput(new Date(Date.now() + 30 * 86_400_000)),
  );
  const [slot, setSlot] = useState({
    date: "",
    time: "19:00",
    capacity: "8",
    enabled: true,
  });
  const reviewed = data?.versions.find((version) => version.id === reviewId);
  const hasUnsavedEdits = Boolean(
    reviewed &&
    (JSON.stringify(facts) !== JSON.stringify(reviewed.facts) ||
      validFrom !== localInput(new Date(reviewed.validFrom)) ||
      validUntil !== localInput(new Date(reviewed.validUntil))),
  );
  const active = data?.versions.find(
    (version) =>
      version.status === "APPROVED" &&
      new Date(version.validFrom).getTime() <= checkedAt &&
      new Date(version.validUntil).getTime() > checkedAt,
  );

  useEffect(() => {
    let alive = true;
    void api
      .get<Knowledge>(
        `/api/crm/virtual/knowledge?${new URLSearchParams({ storeId, accountId })}`,
      )
      .then((result) => {
        if (alive) {
          setData(result);
          setCheckedAt(Date.now());
        }
      })
      .catch((failure) => {
        if (alive) setError(failureText(failure));
      });
    return () => {
      alive = false;
    };
  }, [storeId, revision, accountId]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) setRevision((value) => value + 1);
    }, 60_000);
    return () => clearInterval(timer);
  }, []);

  function edit(version: Version) {
    setFacts(structuredClone(version.facts));
    setValidFrom(localInput(new Date(version.validFrom)));
    setValidUntil(localInput(new Date(version.validUntil)));
    setReviewId(version.id);
    setNotice(
      `Versão ${version.version} carregada para revisão. Salvar cria um novo rascunho.`,
    );
  }

  async function save(body: Record<string, unknown>, message: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api.post("/api/crm/virtual/knowledge", {
        storeId,
        accountId,
        ...body,
      });
      setNotice(message);
      setRevision((value) => value + 1);
    } catch (failure) {
      setError(failureText(failure));
    } finally {
      setBusy(false);
    }
  }

  function draft(event: FormEvent) {
    event.preventDefault();
    void save(
      {
        action: "draft",
        facts,
        validFrom: new Date(validFrom).toISOString(),
        validUntil: new Date(validUntil).toISOString(),
      },
      "Rascunho salvo. Revise a versão no histórico antes de aprovar.",
    );
  }

  const Container = embedded ? "section" : "main";
  return (
    <Container className={embedded ? undefined : styles.page}>
      {!embedded && <VirtualHeader section="base" />}
      {manageable && <VirtualSettings />}
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
      {!data && !error && (
        <p className={styles.empty}>Carregando informações da unidade…</p>
      )}
      {data && (
        <>
          <section className={styles.panel}>
            <div className={styles.sectionHeading}>
              <h2>Conteúdo que o atendimento pode consultar</h2>
              <span
                className={`${styles.badge} ${active ? styles.success : styles.warning}`}
              >
                {active
                  ? `Versão ${active.version} aprovada e vigente`
                  : "Sem versão aprovada vigente"}
              </span>
            </div>
            <p>
              Horários, cardápio, links e regras pertencem a esta unidade.
              Alterações ficam em rascunho até uma pessoa com permissão de
              gestão aprovar.{" "}
              {demo
                ? "O canal local continua sendo uma demonstração mesmo ao aprovar informações."
                : "A versão aprovada será usada somente na conta selecionada."}
            </p>
            {!data.accountId && (
              <p className={styles.warning}>
                Prepare os exemplos fictícios no inbox para iniciar a conta de
                demonstração desta unidade.
              </p>
            )}
            {active && (
              <p className={styles.muted}>
                Validade: {when(active.validFrom)} até {when(active.validUntil)}
                . A versão aprovada mais recente em validade é a fonte da IA.
              </p>
            )}
          </section>
          <section className={styles.panel}>
            <h2>Histórico de versões</h2>
            {data.versions.length ? (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Versão</th>
                      <th>Situação</th>
                      <th>Validade</th>
                      <th>Autoria</th>
                      <th>Revisão</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.versions.map((version) => (
                      <tr key={version.id}>
                        <td>{version.version}</td>
                        <td>
                          {version.status === "APPROVED"
                            ? "Aprovada"
                            : "Rascunho"}
                        </td>
                        <td>
                          {when(version.validFrom)}
                          <br />
                          até {when(version.validUntil)}
                        </td>
                        <td>
                          {version.authorId}
                          <br />
                          <span className={styles.metadata}>
                            {version.approvedAt
                              ? `Aprovada em ${when(version.approvedAt)}`
                              : "Aguardando aprovação"}
                          </span>
                        </td>
                        <td>
                          <button className="btn" onClick={() => edit(version)}>
                            {manageable ? "Revisar versão" : "Consultar versão"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p>Nenhuma versão cadastrada.</p>
            )}
          </section>
          <form onSubmit={draft}>
            <fieldset
              disabled={!manageable || busy || !data.accountId}
              style={{ border: 0, minWidth: 0 }}
            >
              <section className={styles.panel}>
                <h2>
                  {reviewed
                    ? `Revisão da versão ${reviewed.version}`
                    : "Novo rascunho"}
                </h2>
                <p>
                  Revise fatos públicos. Nunca inclua senhas, dados de clientes
                  ou notas internas. Datas de validade usam o fuso deste
                  navegador: {Intl.DateTimeFormat().resolvedOptions().timeZone}.
                </p>
                <div className={styles.fields}>
                  <div className={styles.field}>
                    <label htmlFor="knowledge-name">
                      Nome público da unidade
                    </label>
                    <input
                      id="knowledge-name"
                      value={facts.name}
                      required
                      minLength={2}
                      maxLength={160}
                      onChange={(event) =>
                        setFacts({ ...facts, name: event.target.value })
                      }
                    />
                  </div>
                  <div className={styles.field}>
                    <label htmlFor="knowledge-address">Endereço público</label>
                    <input
                      id="knowledge-address"
                      value={facts.address}
                      maxLength={500}
                      onChange={(event) =>
                        setFacts({ ...facts, address: event.target.value })
                      }
                    />
                  </div>
                  <div className={styles.field}>
                    <label htmlFor="knowledge-from">Válido a partir de</label>
                    <input
                      id="knowledge-from"
                      type="datetime-local"
                      value={validFrom}
                      required
                      onChange={(event) => setValidFrom(event.target.value)}
                    />
                  </div>
                  <div className={styles.field}>
                    <label htmlFor="knowledge-until">Válido até</label>
                    <input
                      id="knowledge-until"
                      type="datetime-local"
                      value={validUntil}
                      required
                      min={validFrom}
                      onChange={(event) => setValidUntil(event.target.value)}
                    />
                  </div>
                  <div className={styles.field}>
                    <label htmlFor="knowledge-policy">
                      Política de reserva
                    </label>
                    <textarea
                      id="knowledge-policy"
                      value={facts.reservationPolicy}
                      maxLength={1500}
                      onChange={(event) =>
                        setFacts({
                          ...facts,
                          reservationPolicy: event.target.value,
                        })
                      }
                      placeholder="Informe as regras reais da unidade. A grade de reservas é configurada separadamente."
                    />
                  </div>
                  <div className={styles.field}>
                    <label htmlFor="knowledge-support">
                      Contato público de suporte
                    </label>
                    <input
                      id="knowledge-support"
                      value={facts.supportContact}
                      maxLength={200}
                      onChange={(event) =>
                        setFacts({
                          ...facts,
                          supportContact: event.target.value,
                        })
                      }
                      placeholder="Contato aprovado para informar ao cliente"
                    />
                  </div>
                </div>
              </section>
              <section className={styles.panel}>
                <div className={styles.sectionHeading}>
                  <h2>Horários de funcionamento</h2>
                  <button
                    type="button"
                    className="btn"
                    disabled={facts.hours.length >= 21}
                    onClick={() =>
                      setFacts({
                        ...facts,
                        hours: [
                          ...facts.hours,
                          { day: 0, opens: "18:00", closes: "23:00" },
                        ],
                      })
                    }
                  >
                    Adicionar período
                  </button>
                </div>
                <p>
                  Cadastre os períodos publicados. Eles não criam vagas na grade
                  de reserva.
                </p>
                {facts.hours.map((hours, index) => (
                  <div className={styles.fields} key={index}>
                    <label className={styles.field}>
                      Dia da semana
                      <select
                        value={hours.day}
                        onChange={(event) =>
                          setFacts({
                            ...facts,
                            hours: facts.hours.map((item, i) =>
                              i === index
                                ? { ...item, day: Number(event.target.value) }
                                : item,
                            ),
                          })
                        }
                      >
                        {DAYS.map((day, i) => (
                          <option value={i} key={day}>
                            {day}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className={styles.actions}>
                      <label className={styles.field}>
                        Abre
                        <input
                          type="time"
                          value={hours.opens}
                          required
                          onChange={(event) =>
                            setFacts({
                              ...facts,
                              hours: facts.hours.map((item, i) =>
                                i === index
                                  ? { ...item, opens: event.target.value }
                                  : item,
                              ),
                            })
                          }
                        />
                      </label>
                      <label className={styles.field}>
                        Fecha
                        <input
                          type="time"
                          value={hours.closes}
                          required
                          onChange={(event) =>
                            setFacts({
                              ...facts,
                              hours: facts.hours.map((item, i) =>
                                i === index
                                  ? { ...item, closes: event.target.value }
                                  : item,
                              ),
                            })
                          }
                        />
                      </label>
                      <button
                        type="button"
                        className="btn"
                        aria-label={`Remover período de ${DAYS[hours.day]}`}
                        onClick={() =>
                          setFacts({
                            ...facts,
                            hours: facts.hours.filter((_, i) => i !== index),
                          })
                        }
                      >
                        Remover
                      </button>
                    </div>
                  </div>
                ))}
              </section>
              <section className={styles.panel}>
                <div className={styles.sectionHeading}>
                  <h2>Exceções e feriados</h2>
                  <button
                    type="button"
                    className="btn"
                    disabled={facts.exceptions.length >= 100}
                    onClick={() =>
                      setFacts({
                        ...facts,
                        exceptions: [
                          ...facts.exceptions,
                          { date: "", closed: true, description: "" },
                        ],
                      })
                    }
                  >
                    Adicionar exceção
                  </button>
                </div>
                {facts.exceptions.map((exception, index) => (
                  <div className={styles.fields} key={index}>
                    <label className={styles.field}>
                      Data
                      <input
                        type="date"
                        value={exception.date}
                        required
                        onChange={(event) =>
                          setFacts({
                            ...facts,
                            exceptions: facts.exceptions.map((item, i) =>
                              i === index
                                ? { ...item, date: event.target.value }
                                : item,
                            ),
                          })
                        }
                      />
                    </label>
                    <label className={styles.field}>
                      Orientação pública
                      <input
                        value={exception.description}
                        maxLength={300}
                        onChange={(event) =>
                          setFacts({
                            ...facts,
                            exceptions: facts.exceptions.map((item, i) =>
                              i === index
                                ? { ...item, description: event.target.value }
                                : item,
                            ),
                          })
                        }
                      />
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={exception.closed}
                        onChange={(event) =>
                          setFacts({
                            ...facts,
                            exceptions: facts.exceptions.map((item, i) =>
                              i === index
                                ? { ...item, closed: event.target.checked }
                                : item,
                            ),
                          })
                        }
                      />{" "}
                      Unidade fechada
                    </label>
                    <button
                      type="button"
                      className="btn"
                      onClick={() =>
                        setFacts({
                          ...facts,
                          exceptions: facts.exceptions.filter(
                            (_, i) => i !== index,
                          ),
                        })
                      }
                    >
                      Remover exceção
                    </button>
                  </div>
                ))}
              </section>
              <section className={styles.panel}>
                <div className={styles.sectionHeading}>
                  <h2>Cardápio publicado</h2>
                  <button
                    type="button"
                    className="btn"
                    disabled={facts.menu.length >= 200}
                    onClick={() =>
                      setFacts({
                        ...facts,
                        menu: [
                          ...facts.menu,
                          {
                            id: crypto.randomUUID(),
                            name: "",
                            description: "",
                            priceCents: 0,
                            vegetarian: false,
                          },
                        ],
                      })
                    }
                  >
                    Adicionar item
                  </button>
                </div>
                <p>
                  Preços e fotos devem vir do catálogo autorizado. Uma foto
                  ausente permanece ausente.
                </p>
                {facts.menu.map((item, index) => (
                  <article className={styles.panel} key={item.id}>
                    <div className={styles.fields}>
                      <label className={styles.field}>
                        Nome do item
                        <input
                          value={item.name}
                          required
                          maxLength={160}
                          onChange={(event) =>
                            setFacts({
                              ...facts,
                              menu: facts.menu.map((entry, i) =>
                                i === index
                                  ? { ...entry, name: event.target.value }
                                  : entry,
                              ),
                            })
                          }
                        />
                      </label>
                      <label className={styles.field}>
                        Preço em reais
                        <input
                          type="number"
                          min="0"
                          max="100000"
                          step="0.01"
                          required
                          value={item.priceCents / 100}
                          onChange={(event) =>
                            setFacts({
                              ...facts,
                              menu: facts.menu.map((entry, i) =>
                                i === index
                                  ? {
                                      ...entry,
                                      priceCents: Math.round(
                                        Number(event.target.value) * 100,
                                      ),
                                    }
                                  : entry,
                              ),
                            })
                          }
                        />
                      </label>
                      <label className={styles.field}>
                        Descrição
                        <textarea
                          value={item.description}
                          maxLength={500}
                          onChange={(event) =>
                            setFacts({
                              ...facts,
                              menu: facts.menu.map((entry, i) =>
                                i === index
                                  ? {
                                      ...entry,
                                      description: event.target.value,
                                    }
                                  : entry,
                              ),
                            })
                          }
                        />
                      </label>
                      <label className={styles.field}>
                        URL HTTPS da foto autorizada, se houver
                        <input
                          type="url"
                          value={item.photoUrl ?? ""}
                          onChange={(event) =>
                            setFacts({
                              ...facts,
                              menu: facts.menu.map((entry, i) =>
                                i === index
                                  ? {
                                      ...entry,
                                      photoUrl: event.target.value || undefined,
                                    }
                                  : entry,
                              ),
                            })
                          }
                        />
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={item.vegetarian}
                          onChange={(event) =>
                            setFacts({
                              ...facts,
                              menu: facts.menu.map((entry, i) =>
                                i === index
                                  ? {
                                      ...entry,
                                      vegetarian: event.target.checked,
                                    }
                                  : entry,
                              ),
                            })
                          }
                        />{" "}
                        Opção vegetariana
                      </label>
                      <button
                        type="button"
                        className="btn"
                        onClick={() =>
                          setFacts({
                            ...facts,
                            menu: facts.menu.filter((_, i) => i !== index),
                          })
                        }
                      >
                        Remover item
                      </button>
                    </div>
                  </article>
                ))}
              </section>
              <section className={styles.panel}>
                <div className={styles.sectionHeading}>
                  <h2>Links oficiais</h2>
                  <button
                    type="button"
                    className="btn"
                    disabled={facts.links.length >= 12}
                    onClick={() =>
                      setFacts({
                        ...facts,
                        links: [
                          ...facts.links,
                          { kind: "menu", url: "", available: true },
                        ],
                      })
                    }
                  >
                    Adicionar link
                  </button>
                </div>
                {facts.links.map((link, index) => (
                  <div className={styles.fields} key={index}>
                    <label className={styles.field}>
                      Finalidade
                      <select
                        value={link.kind}
                        onChange={(event) =>
                          setFacts({
                            ...facts,
                            links: facts.links.map((item, i) =>
                              i === index
                                ? {
                                    ...item,
                                    kind: event.target
                                      .value as typeof link.kind,
                                  }
                                : item,
                            ),
                          })
                        }
                      >
                        {Object.entries(LINK_NAMES).map(([key, label]) => (
                          <option value={key} key={key}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={styles.field}>
                      Endereço HTTPS
                      <input
                        type="url"
                        required
                        value={link.url}
                        onChange={(event) =>
                          setFacts({
                            ...facts,
                            links: facts.links.map((item, i) =>
                              i === index
                                ? { ...item, url: event.target.value }
                                : item,
                            ),
                          })
                        }
                      />
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={link.available}
                        onChange={(event) =>
                          setFacts({
                            ...facts,
                            links: facts.links.map((item, i) =>
                              i === index
                                ? { ...item, available: event.target.checked }
                                : item,
                            ),
                          })
                        }
                      />{" "}
                      Link disponível e conferido
                    </label>
                    <button
                      type="button"
                      className="btn"
                      onClick={() =>
                        setFacts({
                          ...facts,
                          links: facts.links.filter((_, i) => i !== index),
                        })
                      }
                    >
                      Remover link
                    </button>
                  </div>
                ))}
                <div className={styles.actions} style={{ marginTop: 24 }}>
                  <button type="submit" className="btn btn-primary">
                    {busy ? "Salvando…" : "Salvar novo rascunho"}
                  </button>
                  {reviewed?.status === "DRAFT" && (
                    <button
                      type="button"
                      className="btn"
                      onClick={() =>
                        void save(
                          { action: "approve", versionId: reviewed.id },
                          `Versão ${reviewed.version} aprovada. Sua validade define quando a IA pode usá-la.`,
                        )
                      }
                      disabled={hasUnsavedEdits}
                    >
                      Aprovar versão {reviewed.version} salva
                    </button>
                  )}
                </div>
                {reviewed?.status === "DRAFT" && (
                  <p className={styles.muted} style={{ marginTop: 12 }}>
                    {hasUnsavedEdits
                      ? "Há alterações no formulário. Salve um novo rascunho e revise essa versão para aprovar."
                      : "A aprovação usa exatamente esta versão salva no histórico."}
                  </p>
                )}
              </section>
            </fieldset>
          </form>
          <section className={styles.panel}>
            <h2>Grade de reservas</h2>
            <p>
              Cada horário tem capacidade própria. Mostrar uma opção não
              bloqueia vagas; a criação revalida a capacidade na transação.
            </p>
            {manageable && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void save(
                    {
                      action: "slot",
                      ...slot,
                      capacity: Number(slot.capacity),
                    },
                    "Horário da grade salvo.",
                  );
                }}
              >
                <fieldset
                  disabled={busy || !data.accountId}
                  className={styles.fields}
                  style={{ border: 0, minWidth: 0 }}
                >
                  <label className={styles.field}>
                    Data
                    <input
                      type="date"
                      value={slot.date}
                      required
                      onChange={(event) =>
                        setSlot({ ...slot, date: event.target.value })
                      }
                    />
                  </label>
                  <label className={styles.field}>
                    Horário
                    <input
                      type="time"
                      value={slot.time}
                      required
                      onChange={(event) =>
                        setSlot({ ...slot, time: event.target.value })
                      }
                    />
                  </label>
                  <label className={styles.field}>
                    Capacidade em pessoas
                    <input
                      type="number"
                      min="1"
                      max="500"
                      value={slot.capacity}
                      required
                      onChange={(event) =>
                        setSlot({ ...slot, capacity: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={slot.enabled}
                      onChange={(event) =>
                        setSlot({ ...slot, enabled: event.target.checked })
                      }
                    />{" "}
                    Disponível para consulta
                  </label>
                  <button className="btn" type="submit">
                    Salvar horário
                  </button>
                </fieldset>
              </form>
            )}
            {data.slots.length > 0 && (
              <div className={styles.tableWrap} style={{ marginTop: 16 }}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Horário</th>
                      <th>Capacidade</th>
                      <th>Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.slots.map((item) => (
                      <tr key={item.id}>
                        <td>{item.date}</td>
                        <td>{item.time}</td>
                        <td>{item.capacity} pessoas</td>
                        <td>{item.enabled ? "Ativo" : "Pausado"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          {!manageable && (
            <p className={styles.muted}>
              Seu perfil pode consultar as versões. A gestão da unidade aprova o
              conteúdo e configura a grade.
            </p>
          )}
        </>
      )}
      {!embedded && <VirtualCredit />}
    </Container>
  );
}
