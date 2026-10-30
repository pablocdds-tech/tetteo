"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { Prisma } from "@prisma/client";
import type {
  consultarFinanceiro,
  detalheFinanceiro,
} from "../services/integrado";

type Serial<T> = T extends Date
  ? string
  : T extends bigint | Prisma.Decimal
    ? string
    : T extends (infer U)[]
      ? Serial<U>[]
      : T extends object
        ? { [K in keyof T]: Serial<T[K]> }
        : T;
export type DadosFinanceiroIntegrado = Serial<
  Awaited<ReturnType<typeof consultarFinanceiro>>
>;
type Lancamento = Serial<Awaited<ReturnType<typeof detalheFinanceiro>>>;
type LinhaSimples = { id: string; nome: string };
type Campo = {
  nome: string;
  rotulo: string;
  tipo?: string;
  opcoes?: { id: string; nome: string }[];
  valor?: string | number | boolean | null;
  opcional?: boolean;
};
const input =
  "border-line-2 bg-surface text-ink focus:outline-accent h-10 w-full min-w-0 rounded-md border px-3 text-sm focus:outline-2 focus:outline-offset-2";
const botao =
  "border-line-2 hover:bg-surface-2 rounded-md border px-3 py-2 text-sm font-semibold disabled:opacity-50";
const primario =
  "bg-accent text-accent-ink rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-50";
const moeda = (v: string | number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    Number(v),
  );
const dia = (v: string | null | undefined) =>
  v
    ? new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(v))
    : "—";
const hoje = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const pagamentos = [
  "PIX",
  "BOLETO",
  "DINHEIRO",
  "CREDITO",
  "DEBITO",
  "TED",
  "DEBITO_CONTA",
  "VA",
  "VR",
  "OUTRO",
].map((id) => ({ id, nome: id.replaceAll("_", " ") }));
const operacoes = [
  { id: "PAGAR", nome: "Despesa" },
  { id: "RECEBER", nome: "Receita" },
];
function dinheiroTexto(v: string) {
  const n = Number(
    v
      .replace(/^R\$\s*/, "")
      .replace(/\./g, "")
      .replace(",", "."),
  );
  return Number.isFinite(n)
    ? n.toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : v;
}
function CampoFormulario({ campo }: { campo: Campo }) {
  if (campo.tipo === "checkbox")
    return (
      <label className="flex items-center gap-2 text-sm">
        <input
          name={campo.nome}
          type="checkbox"
          defaultChecked={Boolean(campo.valor)}
        />
        {campo.rotulo}
      </label>
    );
  return (
    <label className="flex min-w-0 flex-col gap-1 text-sm font-semibold">
      {campo.rotulo}
      {campo.opcoes ? (
        <select
          className={input}
          name={campo.nome}
          required={!campo.opcional}
          defaultValue={String(campo.valor ?? "")}
        >
          <option value="">Selecione</option>
          {campo.opcoes.map((o) => (
            <option key={o.id} value={o.id}>
              {o.nome}
            </option>
          ))}
        </select>
      ) : (
        <input
          className={input}
          name={campo.nome}
          type={campo.tipo === "money" ? "text" : (campo.tipo ?? "text")}
          inputMode={campo.tipo === "money" ? "decimal" : undefined}
          required={!campo.opcional}
          maxLength={campo.tipo === "date" ? undefined : 2000}
          defaultValue={
            campo.tipo === "money"
              ? Number(campo.valor ?? 0).toLocaleString("pt-BR", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })
              : String(campo.valor ?? "")
          }
          onBlur={
            campo.tipo === "money"
              ? (e) => {
                  e.target.value = dinheiroTexto(e.target.value);
                }
              : undefined
          }
        />
      )}
    </label>
  );
}
function Formulario({
  campos,
  enviar,
  children,
  rotulo = "Salvar",
}: {
  campos: Campo[];
  enviar: (d: Record<string, unknown>) => Promise<boolean>;
  children?: ReactNode;
  rotulo?: string;
}) {
  const [ocupado, setOcupado] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const dados: Record<string, unknown> = Object.fromEntries(
      new FormData(form),
    );
    for (const c of campos)
      if (c.tipo === "checkbox")
        dados[c.nome] = (
          form.elements.namedItem(c.nome) as HTMLInputElement
        ).checked;
    setOcupado(true);
    try {
      await enviar(dados);
    } finally {
      setOcupado(false);
    }
  }
  return (
    <form className="grid gap-4" onSubmit={submit}>
      <fieldset disabled={ocupado} className="grid gap-4 md:grid-cols-2">
        {campos.map((c) => (
          <CampoFormulario key={c.nome} campo={c} />
        ))}
        {children}
      </fieldset>
      <button className={primario} disabled={ocupado}>
        {ocupado ? "Salvando..." : rotulo}
      </button>
    </form>
  );
}
function Vazio({ children }: { children: ReactNode }) {
  return (
    <p className="text-ink-3 rounded-lg p-8 text-center text-sm">{children}</p>
  );
}
function Tabela({
  colunas,
  children,
}: {
  colunas: string[];
  children: ReactNode;
}) {
  return (
    <div className="border-line bg-surface max-w-full min-w-0 overflow-x-auto rounded-xl border">
      <table className="w-full min-w-[650px] text-left text-sm">
        <thead className="bg-surface-2 text-ink-3">
          <tr>
            {colunas.map((c) => (
              <th className="px-4 py-3 font-semibold" key={c}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-line divide-y [&_td]:px-4 [&_td]:py-3">
          {children}
        </tbody>
      </table>
    </div>
  );
}

export function FinanceiroIntegrado({
  inicial,
  secao = "lancamentos",
  detalheInicial,
  novo = false,
  children,
}: {
  inicial: DadosFinanceiroIntegrado;
  secao?: string;
  detalheInicial?: Lancamento;
  novo?: boolean;
  children?: ReactNode;
}) {
  const router = useRouter();
  const [dados, setDados] = useState(inicial);
  const [mensagem, setMensagem] = useState("");
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [form, setForm] = useState(novo ? "lancamento" : "");
  const [selecionado, setSelecionado] = useState<Lancamento | null>(
    detalheInicial ?? null,
  );
  const [edicao, setEdicao] = useState<Record<string, unknown> | null>(null);
  const [marcadas, setMarcadas] = useState<string[]>([]);
  const [chaveBaixa, setChaveBaixa] = useState(() => crypto.randomUUID());
  const detalheRef = useRef<HTMLElement>(null);
  const { permissoes: p } = dados;
  async function carregar(filtro: Record<string, unknown> = dados.filtro) {
    const qs = new URLSearchParams(
      Object.entries(filtro)
        .filter(([, v]) => v !== undefined && v !== "")
        .map(([k, v]) => [k, String(v)]),
    );
    const r = await fetch(`/api/financeiro/base?${qs}`, { cache: "no-store" });
    const d = await r.json();
    if (!r.ok) throw new Error(d.erro);
    setDados(d);
    return d as DadosFinanceiroIntegrado;
  }
  async function executar(rota: string, d: unknown) {
    setErro("");
    setMensagem("");
    setOcupado(true);
    try {
      const r = await fetch(
        rota.startsWith("/api/") ? rota : `/api/financeiro/${rota}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(d),
        },
      );
      const json = await r.json();
      if (!r.ok) throw new Error(json.erro ?? "Não foi possível salvar.");
      setMensagem(
        json.mensagem ??
          (json.baixadasAutomatico !== undefined
            ? `${json.baixadasAutomatico} baixas automáticas; ${json.manuaisAmbiguas} ambíguas; ${json.semCorrespondencia} sem lançamento; ${json.jaConciliadas} já processadas.`
            : "Operação concluída."),
      );
      await carregar();
      return true;
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Operação indisponível.");
      return false;
    } finally {
      setOcupado(false);
    }
  }
  async function salvar(rota: string, d: Record<string, unknown>) {
    const ok = await executar(rota, d);
    if (ok) {
      setForm("");
      setEdicao(null);
      setSelecionado(null);
    }
    return ok;
  }
  async function abrir(id: string) {
    setErro("");
    try {
      const r = await fetch(`/api/financeiro/lancamentos/${id}`, {
        cache: "no-store",
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.erro);
      setSelecionado(d);
      setChaveBaixa(crypto.randomUUID());
      requestAnimationFrame(() => detalheRef.current?.focus());
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível abrir.");
    }
  }
  const titulos: Record<string, string> = {
    lancamentos: "Lançamentos",
    pessoas: "Pessoas",
    planos: "Plano de contas",
    centros: "Centros de custo",
    integracoes: "Integrações bancárias",
    conciliacao: "Conciliação Inter",
    transferencias: "Transferências",
    contas: "Empresas e contas",
    dre: "Resultado por competência",
    fluxo: "Fluxo de caixa",
    relatorios: "Relatórios",
  };
  function abrirForm(nome: string, linha?: object) {
    setForm(nome);
    setEdicao(linha ? (linha as Record<string, unknown>) : null);
    setSelecionado(null);
    setErro("");
    requestAnimationFrame(() => {
      const el = document.getElementById("financeiro-form");
      el?.scrollIntoView({ block: "start" });
      el?.focus();
    });
  }
  const emAberto = (direcao: string) =>
    dados.grupos
      .filter((g) => g.status === "ABERTO" && g.direcao === direcao)
      .reduce((s, g) => s + Number(g.liquido) - Number(g.pago), 0);
  return (
    <div
      className="mx-auto w-full max-w-[1440px] space-y-5"
      aria-busy={ocupado}
    >
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-ink-3 text-sm">Financeiro · {dados.unidade}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {titulos[secao] ?? "Financeiro"}
          </h1>
        </div>
        <div className="flex gap-2">
          {secao === "lancamentos" && p.editar && (
            <button
              className={primario}
              onClick={() => abrirForm("lancamento")}
            >
              + Novo lançamento
            </button>
          )}
          {["pessoas", "planos", "centros"].includes(secao) && p.editar && (
            <button className={primario} onClick={() => abrirForm(secao)}>
              + Novo cadastro
            </button>
          )}
          {secao === "integracoes" && p.diretor && (
            <button
              className={primario}
              onClick={() => abrirForm("integracoes")}
            >
              + Integração
            </button>
          )}
          {secao === "transferencias" && p.baixar && (
            <button
              className={primario}
              onClick={() => abrirForm("transferencias")}
            >
              + Transferência
            </button>
          )}
        </div>
      </header>
      <nav
        className="border-line flex flex-wrap gap-1 border-b pb-3"
        aria-label="Financeiro"
      >
        {[
          ["lancamentos", "Lançamentos"],
          ["conciliacao", "Conciliação"],
          ["pessoas", "Pessoas"],
          ["planos", "Plano de contas"],
          ["contas", "Contas"],
          ["transferencias", "Transferências"],
          ["centros", "Centros de custo"],
          ...(p.diretor ? [["integracoes", "Inter"]] : []),
          ...(p.resultado ? [["dre", "Resultado"]] : []),
        ].map(([id, nome]) => (
          <Link
            className={`rounded-md px-3 py-2 text-sm font-semibold ${secao === id ? "bg-accent-sub text-accent" : "hover:bg-surface-2"}`}
            key={id}
            href={`/financeiro/${id}`}
          >
            {nome}
          </Link>
        ))}
      </nav>
      <div aria-live="polite">
        {erro && (
          <p
            role="alert"
            className="bg-bad-sub text-bad rounded-lg p-3 text-sm"
          >
            {erro}
          </p>
        )}
        {mensagem && (
          <p role="status" className="bg-ok-sub text-ok rounded-lg p-3 text-sm">
            {mensagem}
          </p>
        )}
      </div>
      {secao === "lancamentos" && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              ["A pagar em aberto", emAberto("PAGAR")],
              ["A receber em aberto", emAberto("RECEBER")],
              ["Saldo em aberto", emAberto("RECEBER") - emAberto("PAGAR")],
            ].map(([titulo, v]) => (
              <div
                className="border-line bg-surface rounded-xl border p-4"
                key={titulo}
              >
                <p className="text-ink-3 text-sm">{titulo}</p>
                <p className="mt-2 text-2xl font-semibold tabular-nums">
                  {moeda(v)}
                </p>
              </div>
            ))}
          </div>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const d = Object.fromEntries(new FormData(e.currentTarget));
              setSelecionado(null);
              setOcupado(true);
              try {
                await carregar({ ...d, pagina: 1 });
              } catch (e) {
                setErro(
                  e instanceof Error ? e.message : "Não foi possível filtrar.",
                );
              } finally {
                setOcupado(false);
              }
            }}
          >
            <label className="min-w-[230px] flex-1 text-sm">
              Buscar pessoa, complemento, NF, pedido ou valor
              <input
                className={`${input} mt-1`}
                name="q"
                defaultValue={dados.filtro.q}
                placeholder="Buscar lançamentos"
              />
            </label>
            <CampoFormulario
              campo={{
                nome: "direcao",
                rotulo: "Operação",
                opcional: true,
                opcoes: [
                  { id: "PAGAR", nome: "A pagar" },
                  { id: "RECEBER", nome: "A receber" },
                ],
                valor: dados.filtro.direcao,
              }}
            />
            <CampoFormulario
              campo={{
                nome: "status",
                rotulo: "Situação",
                opcional: true,
                opcoes: [
                  { id: "ABERTO", nome: "Aberto" },
                  { id: "QUITADO", nome: "Baixado" },
                  { id: "CANCELADO", nome: "Cancelado" },
                ],
                valor: dados.filtro.status,
              }}
            />
            <CampoFormulario
              campo={{
                nome: "empresaId",
                rotulo: "Empresa",
                opcional: true,
                opcoes: dados.empresas,
                valor: dados.filtro.empresaId,
              }}
            />
            <CampoFormulario
              campo={{
                nome: "de",
                rotulo: "Vence de",
                tipo: "date",
                opcional: true,
                valor: dados.filtro.de,
              }}
            />
            <CampoFormulario
              campo={{
                nome: "ate",
                rotulo: "Até",
                tipo: "date",
                opcional: true,
                valor: dados.filtro.ate,
              }}
            />
            <button className={botao} disabled={ocupado}>
              Filtrar
            </button>
          </form>
          <div
            className={`grid min-w-0 grid-cols-1 gap-4 ${selecionado ? "xl:grid-cols-[minmax(0,1fr)_400px]" : ""}`}
          >
            <section className="min-w-0">
              <Tabela
                colunas={[
                  "Vencimento",
                  "Pessoa / complemento",
                  "Plano de contas",
                  "Líquido",
                  "Em aberto",
                  "Situação",
                ]}
              >
                {dados.lancamentos.map((l) => (
                  <tr key={l.id} className="hover:bg-surface-2">
                    <td>{dia(l.vencimento)}</td>
                    <td>
                      <button
                        className="text-accent text-left font-semibold"
                        onClick={() => abrir(l.id)}
                      >
                        {l.pessoa?.nome ?? l.fornecedor?.nome ?? l.descricao}
                      </button>
                      <p className="text-ink-3 mt-1 text-xs">
                        {l.descricao} ·{" "}
                        {l.empresa?.nome ?? "CNPJ pendente de revisão"}
                        {l.restritoMaster ? " · restrito" : ""}
                      </p>
                    </td>
                    <td>{l.categoria?.nome ?? "Sem classificação"}</td>
                    <td className="tabular-nums">{moeda(l.valorLiquido)}</td>
                    <td className="tabular-nums">{moeda(l.saldo)}</td>
                    <td>
                      <span
                        className={`rounded-md px-2 py-1 text-xs font-semibold ${l.status === "QUITADO" ? "bg-ok-sub text-ok" : l.status === "CANCELADO" ? "text-ink-3 line-through" : "bg-warn-sub text-warn"}`}
                      >
                        {l.status === "QUITADO"
                          ? "Baixado"
                          : l.status === "ABERTO"
                            ? "Aberto"
                            : "Cancelado"}
                      </span>
                    </td>
                  </tr>
                ))}
              </Tabela>
              {!dados.lancamentos.length && (
                <Vazio>
                  Nenhum lançamento encontrado. Cadastre pessoas, plano de
                  contas e contas bancárias para começar.
                </Vazio>
              )}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm">
                <span>
                  {dados.total} lançamentos · página {dados.filtro.pagina} de{" "}
                  {Math.max(1, Math.ceil(dados.total / 50))}
                </span>
                <div className="flex gap-2">
                  <button
                    className={botao}
                    disabled={ocupado || dados.filtro.pagina <= 1}
                    onClick={() => {
                      void carregar({
                        ...dados.filtro,
                        pagina: dados.filtro.pagina - 1,
                      }).catch((e) => setErro(String(e)));
                    }}
                  >
                    Anterior
                  </button>
                  <button
                    className={botao}
                    disabled={
                      ocupado || dados.filtro.pagina * 50 >= dados.total
                    }
                    onClick={() => {
                      void carregar({
                        ...dados.filtro,
                        pagina: dados.filtro.pagina + 1,
                      }).catch((e) => setErro(String(e)));
                    }}
                  >
                    Próxima
                  </button>
                </div>
              </div>
            </section>
            {selecionado && (
              <aside
                ref={detalheRef}
                tabIndex={-1}
                aria-label="Detalhe do lançamento"
                onKeyDown={(e) => {
                  if (e.key === "Escape") setSelecionado(null);
                }}
                className="border-line bg-surface self-start rounded-xl border p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-lg font-semibold">
                    {selecionado.descricao}
                  </h2>
                  <button
                    className={botao}
                    onClick={() => setSelecionado(null)}
                    aria-label="Fechar detalhe"
                  >
                    ×
                  </button>
                </div>
                <p className="text-ink-3 mt-2 text-sm">
                  {selecionado.empresa?.nome ??
                    "Revise a empresa do lançamento"}{" "}
                  ·{" "}
                  {selecionado.pessoa?.nome ??
                    selecionado.fornecedor?.nome ??
                    "Sem pessoa"}
                </p>
                <dl className="my-4 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt>Líquido</dt>
                    <dd className="text-lg font-semibold">
                      {moeda(selecionado.valorLiquido)}
                    </dd>
                  </div>
                  <div>
                    <dt>Em aberto</dt>
                    <dd className="text-lg font-semibold">
                      {moeda(selecionado.saldo)}
                    </dd>
                  </div>
                  <div>
                    <dt>Competência</dt>
                    <dd>{dia(selecionado.competencia)}</dd>
                  </div>
                  <div>
                    <dt>Vencimento</dt>
                    <dd>{dia(selecionado.vencimento)}</dd>
                  </div>
                </dl>
                <p className="text-ink-3 text-sm">
                  {selecionado.composeDre
                    ? "Compõe o resultado"
                    : "Fora do resultado; permanece no caixa"}
                </p>
                {selecionado.observacao && (
                  <p className="mt-3 text-sm">{selecionado.observacao}</p>
                )}
                <h3 className="mt-5 font-semibold">Histórico de baixas</h3>
                {!selecionado.baixas.length && (
                  <p className="text-ink-3 mt-2 text-sm">
                    {selecionado.valorQuitado
                      ? `Baixa histórica: ${moeda(selecionado.valorQuitado)}`
                      : "Nenhuma baixa registrada."}
                  </p>
                )}
                {selecionado.baixas.map((b) => (
                  <div
                    className="border-line mt-2 border-t py-3 text-sm"
                    key={b.id}
                  >
                    <p>
                      {dia(b.dataPagamento)} · {moeda(b.valor)} ·{" "}
                      {b.origem === "inter" ? "Inter" : "Manual"}
                    </p>
                    <p className="text-ink-3">
                      {dados.contas.find((c) => c.id === b.contaId)?.nome} ·{" "}
                      {b.tipoPagamento}
                    </p>
                    {p.diretor && (
                      <button
                        disabled={ocupado}
                        className="text-bad mt-2 font-semibold"
                        onClick={async () => {
                          if (
                            window.confirm(
                              "Estornar esta baixa? O histórico será preservado.",
                            )
                          ) {
                            if (await executar("estornar", { id: b.id }))
                              await abrir(selecionado.id);
                          }
                        }}
                      >
                        Estornar baixa
                      </button>
                    )}
                  </div>
                ))}
                {selecionado.status === "ABERTO" && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {p.editar && Number(selecionado.totalPago) === 0 && (
                      <>
                        <button
                          className={botao}
                          onClick={() => abrirForm("lancamento", selecionado)}
                        >
                          Editar
                        </button>
                        <button
                          className={botao}
                          disabled={ocupado}
                          onClick={async () => {
                            if (window.confirm("Cancelar este lançamento?")) {
                              if (
                                await executar("cancelar", {
                                  id: selecionado.id,
                                })
                              )
                                setSelecionado(null);
                            }
                          }}
                        >
                          Cancelar
                        </button>
                      </>
                    )}
                    {p.baixar && (
                      <button
                        className={primario}
                        onClick={() => setForm(form === "baixa" ? "" : "baixa")}
                      >
                        Dar baixa
                      </button>
                    )}
                  </div>
                )}
                {form === "baixa" && p.baixar && (
                  <div className="border-line mt-5 border-t pt-4">
                    <Formulario
                      key={selecionado.id + chaveBaixa}
                      rotulo="Confirmar baixa"
                      campos={[
                        {
                          nome: "contaId",
                          rotulo: "Conta",
                          opcoes: dados.contas.filter(
                            (c) =>
                              c.ativa && c.empresaId === selecionado.empresaId,
                          ),
                        },
                        {
                          nome: "dataPagamento",
                          rotulo: "Data do pagamento",
                          tipo: "date",
                          valor: hoje(),
                        },
                        {
                          nome: "valor",
                          rotulo: "Valor pago",
                          tipo: "money",
                          valor: selecionado.saldo,
                        },
                        {
                          nome: "tipoPagamento",
                          rotulo: "Pagamento",
                          opcoes: pagamentos,
                          valor: selecionado.tipoPagamento ?? "PIX",
                        },
                        {
                          nome: "complemento",
                          rotulo: "Complemento",
                          opcional: true,
                        },
                      ]}
                      enviar={async (d) => {
                        const ok = await executar("baixas", {
                          ...d,
                          lancamentoId: selecionado.id,
                          chave: chaveBaixa,
                        });
                        if (ok) {
                          setForm("");
                          await abrir(selecionado.id);
                        }
                        return ok;
                      }}
                    />
                  </div>
                )}
              </aside>
            )}
          </div>
        </>
      )}
      {secao === "pessoas" && (
        <>
          <Tabela
            colunas={[
              "Nome",
              "Documento",
              "Operação padrão",
              "Plano padrão",
              "Ações",
            ]}
          >
            {dados.pessoas.map((x) => (
              <tr key={x.id}>
                <td className="font-semibold">{x.nome}</td>
                <td>{x.documento ?? "—"}</td>
                <td>{x.operacaoPadrao === "PAGAR" ? "Despesa" : "Receita"}</td>
                <td>
                  {dados.planos.find((p) => p.id === x.categoriaId)?.nome ??
                    "Não definido"}
                </td>
                <td>
                  <div className="flex gap-3">
                    {p.editar && (
                      <button
                        className="text-accent"
                        onClick={() => abrirForm("pessoas", x)}
                      >
                        Editar
                      </button>
                    )}
                    <Link
                      className="text-accent"
                      href={`/financeiro/pessoas/${x.id}/documentos`}
                    >
                      Documentos
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
          </Tabela>
          {!dados.pessoas.length && <Vazio>Nenhuma pessoa cadastrada.</Vazio>}
        </>
      )}
      {secao === "planos" && (
        <>
          <p className="text-ink-3 text-sm">
            Planos compartilhados pela organização. Cada plano pode ter um pai
            da mesma operação.
          </p>
          <Tabela
            colunas={[
              "Código",
              "Nome",
              "Pai",
              "Operação",
              "Resultado",
              "Ações",
            ]}
          >
            {dados.planos.map((x) => (
              <tr key={x.id}>
                <td>{x.codigo ?? "—"}</td>
                <td>{x.nome}</td>
                <td>
                  {dados.planos.find((p) => p.id === x.paiId)?.nome ?? "Raiz"}
                </td>
                <td>{x.tipo === "DESPESA" ? "Despesa" : "Receita"}</td>
                <td>{x.entraDre ? "Incluído" : "Fora"}</td>
                <td>
                  {p.editar && (
                    <button
                      className="text-accent"
                      onClick={() => abrirForm("planos", x)}
                    >
                      Editar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </Tabela>
          {!dados.planos.length && (
            <Vazio>Nenhum plano de contas cadastrado.</Vazio>
          )}
        </>
      )}
      {secao === "centros" && (
        <Tabela colunas={["Centro de custo"]}>
          {dados.centros.map((x) => (
            <tr key={x.id}>
              <td>{x.nome}</td>
            </tr>
          ))}
        </Tabela>
      )}
      {secao === "integracoes" && p.diretor && (
        <>
          <p className="text-ink-3 text-sm">
            Credenciais configuradas somente no host. Comece pelo sandbox;
            testar a conexão apenas consulta o saldo.
          </p>
          <Tabela
            colunas={[
              "Empresa / conta",
              "Ambiente",
              "Credenciais",
              "Última sincronização",
              "Ações",
            ]}
          >
            {dados.integracoes.map((x) => (
              <tr key={x.id}>
                <td>
                  {x.empresa.nome}
                  <p className="text-ink-3 text-xs">{x.conta.nome}</p>
                </td>
                <td>
                  {x.ambiente}
                  {!x.ativa ? " · inativa" : ""}
                </td>
                <td>{x.envKey}</td>
                <td>
                  {dia(x.ultimaSincronizacao)}
                  {x.ultimoErro && (
                    <p className="text-bad mt-1 max-w-xs text-xs">
                      {x.ultimoErro}
                    </p>
                  )}
                </td>
                <td>
                  <div className="flex flex-wrap gap-2">
                    <button
                      className={botao}
                      disabled={ocupado || !x.ativa}
                      onClick={() =>
                        executar(`/api/inter/teste?id=${x.id}`, {})
                      }
                    >
                      Testar conexão
                    </button>
                    <button
                      className={botao}
                      disabled={ocupado || !x.ativa}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Sincronizar ${x.empresa.nome} (${x.ambiente})? Transações compatíveis darão baixa em lançamentos existentes.`,
                          )
                        )
                          void executar(
                            `/api/inter/sincronizar?id=${x.id}`,
                            {},
                          );
                      }}
                    >
                      Sincronizar agora
                    </button>
                    <button
                      className={botao}
                      onClick={() => abrirForm("integracoes", x)}
                    >
                      Editar
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </Tabela>
          {!dados.integracoes.length && (
            <Vazio>
              Nenhuma integração cadastrada. Cadastre a empresa com CNPJ e a
              conta bancária primeiro.
            </Vazio>
          )}
        </>
      )}
      {secao === "conciliacao" && (
        <>
          <p className="text-ink-3 text-sm">
            O extrato não cria lançamentos. Cadastre a obrigação e vincule-a
            aqui, ou reavalie as pendências. Exibidas até 200 por vez.
          </p>
          <div className="flex flex-wrap gap-2">
            {p.baixar && (
              <button
                className={botao}
                disabled={ocupado || !dados.pendencias.length}
                onClick={() =>
                  executar("pendencias", {
                    ids: p.diretor
                      ? dados.pendencias.map((x) => x.id)
                      : dados.pendencias.slice(0, 1).map((x) => x.id),
                    acao: "reavaliar",
                  })
                }
              >
                {p.diretor
                  ? "Reavaliar pendentes"
                  : "Reavaliar primeira pendência"}
              </button>
            )}
            {p.diretor && (
              <>
                <button
                  className={botao}
                  disabled={ocupado || !marcadas.length}
                  onClick={() => {
                    if (window.confirm("Ignorar as transações selecionadas?"))
                      void executar("pendencias", {
                        ids: marcadas,
                        acao: "ignorar",
                      }).then((ok) => {
                        if (ok) setMarcadas([]);
                      });
                  }}
                >
                  Ignorar selecionadas
                </button>
                <button
                  className={botao}
                  disabled={ocupado || !marcadas.length}
                  onClick={() => {
                    if (
                      window.confirm(
                        "Retirar as pendências selecionadas? O histórico e os identificadores serão preservados.",
                      )
                    )
                      void executar("pendencias", {
                        ids: marcadas,
                        acao: "excluir",
                      }).then((ok) => {
                        if (ok) setMarcadas([]);
                      });
                  }}
                >
                  Apagar selecionadas
                </button>
              </>
            )}
          </div>
          <Tabela
            colunas={[
              "Selecionar",
              "Data / contraparte",
              "Transação",
              "Valor",
              "Pendência",
              "Ações",
            ]}
          >
            {dados.pendencias.map((x) => (
              <tr key={x.id}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Selecionar transação de ${dia(x.data)}`}
                    checked={marcadas.includes(x.id)}
                    onChange={(e) =>
                      setMarcadas(
                        e.target.checked
                          ? [...marcadas, x.id]
                          : marcadas.filter((id) => id !== x.id),
                      )
                    }
                  />
                </td>
                <td>
                  {dia(x.data)}
                  <p className="mt-1 font-semibold">
                    {x.contraparteNome ?? "Contraparte não informada"}
                  </p>
                  <p className="text-ink-3 text-xs">
                    {x.contraparteDocumento ?? "Sem documento"}
                  </p>
                </td>
                <td>
                  {x.tipoTransacao} ·{" "}
                  {x.direcao === "PAGAR" ? "Saída" : "Entrada"}
                  <p className="text-ink-3 max-w-xs text-xs">
                    {x.titulo} {x.descricao}
                  </p>
                </td>
                <td>{moeda(String(x.valor))}</td>
                <td>{x.tipo === "ambiguo" ? "Ambígua" : "Sem lançamento"}</td>
                <td>
                  {p.baixar && (
                    <div className="flex flex-col gap-2">
                      <button
                        className={botao}
                        disabled={ocupado}
                        onClick={() => abrirForm("vincular", x)}
                      >
                        Vincular lançamento
                      </button>
                      <button
                        className={botao}
                        disabled={ocupado}
                        onClick={() => {
                          if (window.confirm("Ignorar esta transação?"))
                            void executar("pendencias", {
                              ids: [x.id],
                              acao: "ignorar",
                            });
                        }}
                      >
                        Ignorar
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </Tabela>
          {!dados.pendencias.length && (
            <Vazio>
              Nenhuma pendência. As transações aparecem após a sincronização do
              Inter.
            </Vazio>
          )}
        </>
      )}
      {secao === "transferencias" && (
        <>
          <p className="text-ink-3 text-sm">
            Movimentações entre contas da unidade ativa, inclusive entre CNPJs.
            Não compõem receitas, despesas ou resultado.
          </p>
          <Tabela colunas={["Data", "Origem", "Destino", "Descrição", "Valor"]}>
            {dados.transferencias.map((x) => (
              <tr key={x.id}>
                <td>{dia(x.data)}</td>
                <td>{dados.contas.find((c) => c.id === x.origemId)?.nome}</td>
                <td>{dados.contas.find((c) => c.id === x.destinoId)?.nome}</td>
                <td>{x.descricao}</td>
                <td>{moeda(String(x.valor))}</td>
              </tr>
            ))}
          </Tabela>
          {!dados.transferencias.length && (
            <Vazio>Nenhuma transferência registrada.</Vazio>
          )}
        </>
      )}
      {secao === "contas" && (
        <>
          <Tabela colunas={["Conta", "Empresa", "Tipo", "Saldo do sistema"]}>
            {dados.contas.map((x) => (
              <tr key={x.id}>
                <td>
                  {x.nome}
                  {!x.ativa ? " · inativa" : ""}
                </td>
                <td>
                  {dados.empresas.find((e) => e.id === x.empresaId)?.nome ??
                    "Vínculo pendente"}
                </td>
                <td>{x.tipo === "CAIXA" ? "Caixa" : "Banco"}</td>
                <td>
                  {x.saldo === null ? "Restrito ao diretor" : moeda(x.saldo)}
                </td>
              </tr>
            ))}
          </Tabela>
          {children}
        </>
      )}
      {["dre", "fluxo", "relatorios"].includes(secao) && p.resultado && (
        <>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const d = Object.fromEntries(new FormData(e.currentTarget));
              try {
                await carregar({ ...d, pagina: 1 });
              } catch (e) {
                setErro(e instanceof Error ? e.message : "Falha ao filtrar.");
              }
            }}
          >
            <CampoFormulario
              campo={{
                nome: "de",
                rotulo: secao === "dre" ? "Competência de" : "Pagamento de",
                tipo: "date",
                opcional: true,
                valor: dados.filtro.de,
              }}
            />
            <CampoFormulario
              campo={{
                nome: "ate",
                rotulo: "Até",
                tipo: "date",
                opcional: true,
                valor: dados.filtro.ate,
              }}
            />
            <button className={botao}>Aplicar período</button>
          </form>
          <p className="text-ink-3 text-sm">
            Resumo dos lançamentos{" "}
            {secao === "dre"
              ? "por competência, com as exclusões do plano e do lançamento"
              : "e das baixas registradas"}
            . Não representa lucro contábil nem recalcula o CMV do estoque.
          </p>
          {secao === "dre" ? (
            <ResumoResultado dados={dados} />
          ) : (
            <Tabela colunas={["Movimento de caixa", "Valor"]}>
              <tr>
                <td>Recebimentos (inclui lançamentos fora do resultado)</td>
                <td>{moeda(dados.fluxo.entradas)}</td>
              </tr>
              <tr>
                <td>Pagamentos (inclui baixas parciais)</td>
                <td>{moeda(dados.fluxo.saidas)}</td>
              </tr>
              <tr>
                <td>Movimento líquido</td>
                <td>
                  {moeda(
                    Number(dados.fluxo.entradas) - Number(dados.fluxo.saidas),
                  )}
                </td>
              </tr>
            </Tabela>
          )}
          <Link
            className="text-accent text-sm font-semibold"
            href="/financeiro/lancamentos"
          >
            Consultar lançamentos e histórico →
          </Link>
        </>
      )}
      {form && form !== "baixa" && (
        <section
          id="financeiro-form"
          tabIndex={-1}
          className="border-line bg-surface rounded-xl border p-5"
          aria-label="Formulário financeiro"
        >
          <div className="mb-5 flex items-center justify-between gap-4">
            <h2 className="text-lg font-semibold">
              {form === "lancamento"
                ? edicao
                  ? "Editar lançamento"
                  : "Novo lançamento"
                : "Cadastro financeiro"}
            </h2>
            <button
              className={botao}
              onClick={() => {
                setForm("");
                setEdicao(null);
                if (novo) router.replace("/financeiro/lancamentos");
              }}
            >
              Fechar
            </button>
          </div>
          {form === "lancamento" && (
            <FormLancamento
              key={String(edicao?.id ?? "novo")}
              dados={dados}
              edicao={edicao}
              salvar={(d) => salvar("lancamentos", d)}
            />
          )}
          {form === "pessoas" && (
            <Formulario
              key={String(edicao?.id ?? "novo")}
              campos={[
                {
                  nome: "nome",
                  rotulo: "Nome",
                  valor: String(edicao?.nome ?? ""),
                },
                {
                  nome: "tipoDocumento",
                  rotulo: "Tipo de documento",
                  opcoes: [
                    { id: "cpf", nome: "CPF" },
                    { id: "cnpj", nome: "CNPJ" },
                  ],
                  valor: String(edicao?.tipoDocumento ?? "cnpj"),
                },
                {
                  nome: "documento",
                  rotulo: "Documento",
                  opcional: true,
                  valor: String(edicao?.documento ?? ""),
                },
                ...[
                  "telefone",
                  "email",
                  "categoria",
                  "contato",
                  "endereco",
                  "cidade",
                  "chavePix",
                  "observacoes",
                ].map((nome) => ({
                  nome,
                  rotulo:
                    (
                      {
                        chavePix: "Chave PIX",
                        observacoes: "Observações",
                        endereco: "Endereço",
                      } as Record<string, string>
                    )[nome] ?? nome[0].toUpperCase() + nome.slice(1),
                  opcional: true,
                  valor: String(edicao?.[nome] ?? ""),
                })),
                {
                  nome: "categoriaId",
                  rotulo: "Plano de contas padrão",
                  opcoes: dados.planos,
                  opcional: true,
                  valor: String(edicao?.categoriaId ?? ""),
                },
                {
                  nome: "operacaoPadrao",
                  rotulo: "Operação padrão",
                  opcoes: operacoes,
                  valor: String(edicao?.operacaoPadrao ?? "PAGAR"),
                },
                {
                  nome: "prazoDias",
                  rotulo: "Prazo em dias",
                  tipo: "number",
                  valor: Number(edicao?.prazoDias ?? 0),
                },
                {
                  nome: "ehFuncionario",
                  rotulo: "Funcionário",
                  tipo: "checkbox",
                  valor: Boolean(edicao?.ehFuncionario),
                },
              ]}
              enviar={(d) =>
                salvar("pessoas", { ...d, id: edicao?.id ?? null })
              }
            />
          )}
          {form === "planos" && (
            <Formulario
              key={String(edicao?.id ?? "novo")}
              campos={[
                {
                  nome: "codigo",
                  rotulo: "Código",
                  valor: String(edicao?.codigo ?? ""),
                },
                {
                  nome: "nome",
                  rotulo: "Nome",
                  valor: String(edicao?.nome ?? ""),
                },
                {
                  nome: "tipo",
                  rotulo: "Operação",
                  opcoes: [
                    { id: "DESPESA", nome: "Despesa" },
                    { id: "RECEITA", nome: "Receita" },
                  ],
                  valor: String(edicao?.tipo ?? "DESPESA"),
                },
                {
                  nome: "paiId",
                  rotulo: "Plano pai",
                  opcoes: dados.planos.filter((x) => x.id !== edicao?.id),
                  opcional: true,
                  valor: String(edicao?.paiId ?? ""),
                },
                {
                  nome: "entraDre",
                  rotulo: "Compõe o resultado",
                  tipo: "checkbox",
                  valor:
                    edicao?.entraDre === undefined
                      ? true
                      : Boolean(edicao.entraDre),
                },
              ]}
              enviar={(d) => salvar("planos", { ...d, id: edicao?.id ?? null })}
            />
          )}
          {form === "centros" && (
            <Formulario
              campos={[{ nome: "nome", rotulo: "Nome" }]}
              enviar={(d) => salvar("centros", d)}
            />
          )}
          {form === "integracoes" && (
            <Formulario
              key={String(edicao?.id ?? "novo")}
              campos={[
                {
                  nome: "empresaId",
                  rotulo: "Empresa / CNPJ",
                  opcoes: dados.empresas.map((e) => ({
                    id: e.id,
                    nome: `${e.nome} · ${e.cnpj}`,
                  })),
                  valor: String(edicao?.empresaId ?? ""),
                },
                {
                  nome: "contaId",
                  rotulo: "Conta bancária do sistema",
                  opcoes: dados.contas.filter(
                    (c) => c.tipo === "BANCO" && c.ativa,
                  ),
                  valor: String(edicao?.contaId ?? ""),
                },
                {
                  nome: "envKey",
                  rotulo: "Identificador das credenciais (ex.: LOJA_CENTRO)",
                  valor: String(edicao?.envKey ?? ""),
                },
                {
                  nome: "ambiente",
                  rotulo: "Ambiente",
                  opcoes: [
                    { id: "sandbox", nome: "Sandbox — teste" },
                    { id: "producao", nome: "Produção" },
                  ],
                  valor: String(edicao?.ambiente ?? "sandbox"),
                },
                {
                  nome: "ativa",
                  rotulo: "Integração ativa",
                  tipo: "checkbox",
                  valor:
                    edicao?.ativa === undefined ? true : Boolean(edicao.ativa),
                },
              ]}
              enviar={(d) =>
                salvar("integracoes", { ...d, id: edicao?.id ?? null })
              }
            />
          )}
          {form === "transferencias" && (
            <FormTransferencia
              dados={dados}
              salvar={(d) => salvar("transferencias", d)}
            />
          )}
          {form === "vincular" && edicao && (
            <VincularPendencia
              pendenciaId={String(edicao.id)}
              executar={executar}
              aoSalvar={() => {
                setForm("");
                setEdicao(null);
              }}
            />
          )}
        </section>
      )}
    </div>
  );
}

function FormLancamento({
  dados,
  edicao,
  salvar,
}: {
  dados: DadosFinanceiroIntegrado;
  edicao: Record<string, unknown> | null;
  salvar: (d: Record<string, unknown>) => Promise<boolean>;
}) {
  const [pessoaId, setPessoaId] = useState(String(edicao?.pessoaId ?? ""));
  const [operacao, setOperacao] = useState(String(edicao?.direcao ?? "PAGAR"));
  const [plano, setPlano] = useState(String(edicao?.categoriaId ?? ""));
  const [valores, setValores] = useState({
    valor: String(edicao?.valor ?? "0"),
    desconto: String(edicao?.desconto ?? "0"),
    multa: String(edicao?.multa ?? "0"),
    juros: String(edicao?.juros ?? "0"),
  });
  const parse = (v: string) =>
    Number(v.includes(",") ? v.replace(/\./g, "").replace(",", ".") : v) || 0;
  const liquido =
    parse(valores.valor) -
    parse(valores.desconto) +
    parse(valores.multa) +
    parse(valores.juros);
  return (
    <Formulario
      campos={[
        {
          nome: "empresaId",
          rotulo: "Estabelecimento / CNPJ",
          opcoes: dados.empresas,
          valor: String(edicao?.empresaId ?? ""),
        },
        {
          nome: "centroCustoId",
          rotulo: "Centro de custo",
          opcoes: dados.centros,
          opcional: true,
          valor: String(edicao?.centroCustoId ?? ""),
        },
        {
          nome: "descricao",
          rotulo: "Complemento",
          valor: String(edicao?.descricao ?? ""),
        },
        {
          nome: "vencimento",
          rotulo: "Vencimento",
          tipo: "date",
          valor: String(edicao?.vencimento ?? hoje()).slice(0, 10),
        },
        {
          nome: "competencia",
          rotulo: "Competência",
          tipo: "date",
          valor: String(edicao?.competencia ?? hoje()).slice(0, 10),
        },
        {
          nome: "tipoPagamento",
          rotulo: "Tipo de pagamento",
          opcoes: pagamentos,
          valor: String(edicao?.tipoPagamento ?? "PIX"),
        },
        {
          nome: "historico",
          rotulo: "Histórico",
          opcoes: [
            "Pagamento",
            "Recebimento",
            "Sangria",
            "Transferência",
            "Suprimento",
          ].map((id) => ({ id, nome: id })),
          valor: String(edicao?.historico ?? "Pagamento"),
        },
        {
          nome: "numeroPedido",
          rotulo: "Número do pedido",
          opcional: true,
          valor: String(edicao?.numeroPedido ?? ""),
        },
        {
          nome: "numeroNotaFiscal",
          rotulo: "Nota fiscal",
          opcional: true,
          valor: String(edicao?.numeroNotaFiscal ?? ""),
        },
        {
          nome: "observacao",
          rotulo: "Informações complementares",
          opcional: true,
          valor: String(edicao?.observacao ?? ""),
        },
        {
          nome: "composeDre",
          rotulo: "Compõe o resultado",
          tipo: "checkbox",
          valor:
            edicao?.composeDre === undefined
              ? true
              : Boolean(edicao.composeDre),
        },
        ...(dados.permissoes.diretor
          ? [
              {
                nome: "restritoMaster",
                rotulo: "Restrito ao diretor",
                tipo: "checkbox",
                valor: Boolean(edicao?.restritoMaster),
              },
            ]
          : []),
      ]}
      enviar={(d) =>
        salvar({
          ...d,
          id: edicao?.id ?? null,
          versao: edicao?.versao ?? 0,
          pessoaId,
          categoriaId: plano,
          direcao: operacao,
          restritoMaster: !dados.permissoes.diretor ? false : d.restritoMaster,
        })
      }
    >
      <BuscaPessoa
        pessoas={dados.pessoas}
        valor={pessoaId}
        mudar={(id) => {
          setPessoaId(id);
          const p = dados.pessoas.find((x) => x.id === id);
          if (p) {
            setOperacao(p.operacaoPadrao);
            setPlano(p.categoriaId ?? "");
          }
        }}
      />
      <label className="text-sm font-semibold">
        Operação
        <select
          className={`${input} mt-1`}
          value={operacao}
          onChange={(e) => {
            setOperacao(e.target.value);
            setPlano("");
          }}
        >
          {operacoes.map((o) => (
            <option key={o.id} value={o.id}>
              {o.nome}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm font-semibold">
        Plano de contas
        <select
          className={`${input} mt-1`}
          required
          value={plano}
          onChange={(e) => setPlano(e.target.value)}
        >
          <option value="">Selecione</option>
          {dados.planos
            .filter(
              (p) => p.tipo === (operacao === "PAGAR" ? "DESPESA" : "RECEITA"),
            )
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.codigo} {p.nome}
              </option>
            ))}
        </select>
      </label>
      {Object.entries(valores).map(([nome, valor]) => (
        <label key={nome} className="text-sm font-semibold">
          {
            (
              {
                valor: "Valor",
                desconto: "Desconto",
                multa: "Multa",
                juros: "Juros",
              } as Record<string, string>
            )[nome]
          }
          <input
            className={`${input} mt-1`}
            name={nome}
            inputMode="decimal"
            required
            defaultValue={Number(valor).toLocaleString("pt-BR", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
            onChange={(e) =>
              setValores((v) => ({ ...v, [nome]: e.target.value }))
            }
            onBlur={(e) => {
              e.target.value = dinheiroTexto(e.target.value);
            }}
          />
        </label>
      ))}
      <p className="bg-surface-2 rounded-lg p-3 font-semibold md:col-span-2">
        Valor líquido: {moeda(liquido)}
      </p>
    </Formulario>
  );
}
function BuscaPessoa({
  pessoas,
  valor,
  mudar,
}: {
  pessoas: LinhaSimples[];
  valor: string;
  mudar: (id: string) => void;
}) {
  const id = useId();
  const [busca, setBusca] = useState(
    pessoas.find((p) => p.id === valor)?.nome ?? "",
  );
  return (
    <label className="text-sm font-semibold">
      Pessoa (cliente ou fornecedor)
      <input
        className={`${input} mt-1`}
        list={id}
        value={busca}
        placeholder="Digite para buscar"
        onChange={(e) => {
          setBusca(e.target.value);
          mudar(pessoas.find((p) => p.nome === e.target.value)?.id ?? "");
        }}
      />
      <datalist id={id}>
        {pessoas.map((p) => (
          <option key={p.id} value={p.nome} />
        ))}
      </datalist>
    </label>
  );
}
function FormTransferencia({
  dados,
  salvar,
}: {
  dados: DadosFinanceiroIntegrado;
  salvar: (d: Record<string, unknown>) => Promise<boolean>;
}) {
  const [chave] = useState(() => crypto.randomUUID());
  return (
    <Formulario
      campos={[
        {
          nome: "origemId",
          rotulo: "Conta de origem",
          opcoes: dados.contas.filter((c) => c.ativa),
        },
        {
          nome: "destinoId",
          rotulo: "Conta de destino",
          opcoes: dados.contas.filter((c) => c.ativa),
        },
        { nome: "data", rotulo: "Data", tipo: "date", valor: hoje() },
        { nome: "valor", rotulo: "Valor", tipo: "money" },
        { nome: "descricao", rotulo: "Descrição" },
      ]}
      enviar={(d) => salvar({ ...d, chave })}
    />
  );
}
function VincularPendencia({
  pendenciaId,
  executar,
  aoSalvar,
}: {
  pendenciaId: string;
  executar: (r: string, d: unknown) => Promise<boolean>;
  aoSalvar: () => void;
}) {
  const [linhas, setLinhas] = useState<Lancamento[]>([]);
  const [selecionado, setSelecionado] = useState("");
  const [falha, setFalha] = useState("");
  const [ocupado, setOcupado] = useState(false);
  return (
    <div className="space-y-4">
      <p className="text-ink-3 text-sm">
        Busque um lançamento existente. A vinculação exige a mesma empresa,
        unidade e direção, e saldo suficiente.
      </p>
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          setOcupado(true);
          try {
            const r = await fetch(
              `/api/financeiro/base?status=ABERTO&q=${encodeURIComponent(String(d.get("q")))}`,
            );
            const j = await r.json();
            if (!r.ok) throw new Error(j.erro);
            setLinhas(j.lancamentos);
            setSelecionado("");
          } catch (e) {
            setFalha(
              e instanceof Error ? e.message : "Não foi possível buscar.",
            );
          } finally {
            setOcupado(false);
          }
        }}
      >
        <input
          className={input}
          name="q"
          aria-label="Buscar lançamento para vincular"
          required
          placeholder="Pessoa, complemento, nota ou valor"
        />
        <button className={botao} disabled={ocupado}>
          Buscar
        </button>
      </form>
      {falha && <p role="alert">{falha}</p>}
      <select
        aria-label="Lançamento existente"
        className={input}
        value={selecionado}
        onChange={(e) => setSelecionado(e.target.value)}
      >
        <option value="">Selecione um lançamento</option>
        {linhas.map((l) => (
          <option key={l.id} value={l.id}>
            {l.descricao} · {l.empresa?.nome} · {dia(l.vencimento)} ·{" "}
            {moeda(l.saldo)}
          </option>
        ))}
      </select>
      <button
        disabled={!selecionado || ocupado}
        className={primario}
        onClick={async () => {
          if (
            !window.confirm(
              "Confirmar a baixa deste lançamento com a transação selecionada?",
            )
          )
            return;
          setOcupado(true);
          try {
            if (
              await executar("pendencias", {
                ids: [pendenciaId],
                acao: "vincular",
                lancamentoId: selecionado,
              })
            )
              aoSalvar();
          } finally {
            setOcupado(false);
          }
        }}
      >
        Confirmar vínculo e baixa
      </button>
    </div>
  );
}
function ResumoResultado({ dados }: { dados: DadosFinanceiroIntegrado }) {
  const grupos = dados.grupos.filter(
    (g) => g.status !== "CANCELADO" && g.composeDre,
  );
  const receitas = grupos
      .filter((g) => g.direcao === "RECEBER")
      .reduce((s, g) => s + Number(g.liquido), 0),
    despesas = grupos
      .filter((g) => g.direcao === "PAGAR")
      .reduce((s, g) => s + Number(g.liquido), 0);
  return (
    <Tabela colunas={["Indicador", "Valor"]}>
      <tr>
        <td>Receitas classificadas</td>
        <td>{moeda(receitas)}</td>
      </tr>
      <tr>
        <td>Despesas classificadas</td>
        <td>{moeda(despesas)}</td>
      </tr>
      <tr>
        <td>Resultado dos lançamentos</td>
        <td>{moeda(receitas - despesas)}</td>
      </tr>
    </Tabela>
  );
}
