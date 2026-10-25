"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { Botao, estiloDeBotao } from "@/design-system/botao";
import { apiJson } from "@/lib/api";

import {
  estados,
  fontes,
  rotuloFonte,
  type Cobertura,
  type Fonte,
  type Linha,
} from "../schemas/conferencia";
import type {
  consultarConferencia,
  detalharCorrespondencia,
  detalheImportacao,
} from "../services/conferencia";

type Painel = Awaited<ReturnType<typeof consultarConferencia>>;
type Detalhe = Awaited<ReturnType<typeof detalharCorrespondencia>>;
type Importacao = Awaited<ReturnType<typeof detalheImportacao>>;
type Previa = {
  id: string;
  arquivoHash: string;
  nomeArquivo: string;
  lidas: number;
  aceitas: number;
  rejeitadas: number;
  ignoradas: number;
  estado: string;
  colunas: string[];
  avisos: string[];
  amostra: {
    numero: number;
    bruto: unknown;
    normalizado: Linha | null;
    erros: string[];
  }[];
  erros: { numero: number; erros: string[] }[];
};
const moeda = (c: number | null | undefined) =>
  c == null
    ? "Desconhecido"
    : new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
      }).format(c / 100);
const dataHora = (d: unknown) =>
  new Date(String(d)).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
  });
const campo =
  "border-line-2 bg-surface text-ink min-h-11 w-full rounded-lg border px-3 py-2 text-base sm:min-h-10 sm:text-sm";
const raiz = "/api/finance";
const mensagemErro = (e: unknown) =>
  e instanceof Error
    ? e.message
    : "Não foi possível concluir. Tente novamente.";
const chave = () => crypto.randomUUID();
async function arquivoBase64(arquivo: File) {
  if (arquivo.size > 2 * 1024 * 1024 || arquivo.size === 0)
    throw new Error("Envie um arquivo com conteúdo, de até 2 MB.");
  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  let binario = "";
  for (let i = 0; i < bytes.length; i += 32768)
    binario += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(binario);
}

function Estado({ estado }: { estado: string }) {
  const tom =
    estado === "RECONCILED"
      ? "bg-ok-sub text-ok"
      : [
            "FEE_DIFFERENCE",
            "GROSS_DIFFERENCE",
            "BANK_DIFFERENCE",
            "CHARGEBACK",
          ].includes(estado)
        ? "bg-bad-sub text-bad"
        : "bg-warn-sub text-warn";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold ${tom}`}
    >
      <span aria-hidden>●</span>
      {estados[estado] ?? estado}
    </span>
  );
}
function Rotulo({
  texto,
  children,
}: {
  texto: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1.5 text-sm font-medium">
      <span>{texto}</span>
      {children}
    </label>
  );
}
function Numero({
  titulo,
  valor,
  descricao,
}: {
  titulo: string;
  valor: number | null;
  descricao: string;
}) {
  return (
    <div className="border-line bg-surface min-w-0 rounded-xl border p-4">
      <p className="text-ink-2 text-sm font-medium">{titulo}</p>
      <p className="mt-2 text-xl font-semibold tracking-tight tabular-nums lg:text-2xl">
        {moeda(valor)}
      </p>
      <p className="text-ink-3 mt-2 text-xs leading-relaxed">{descricao}</p>
    </div>
  );
}

export function PainelConferencia({
  unidade,
  deInicial,
  ateInicial,
  podeImportar,
  podeDecidir,
}: {
  unidade: string;
  deInicial: string;
  ateInicial: string;
  podeImportar: boolean;
  podeDecidir: boolean;
}) {
  const [periodo, setPeriodo] = useState({ de: deInicial, ate: ateInicial });
  const [filtro, setFiltro] = useState({
    estado: "",
    categoria: "",
    pagina: 1,
    execucaoId: "",
  });
  const [aba, setAba] = useState<"conferencia" | "importacoes" | "contratos">(
    "conferencia",
  );
  const [painel, setPainel] = useState<Painel | null>(null);
  const [atualizacao, setAtualizacao] = useState(0);
  const [carregando, setCarregando] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [detalhe, setDetalhe] = useState<Detalhe | null>(null);
  const [arquivoDetalhe, setArquivoDetalhe] = useState<Importacao | null>(null);
  const [demonstracao, setDemonstracao] = useState(false);
  const [contratoBase, setContratoBase] = useState<
    Painel["contratos"][number] | null
  >(null);
  const dialogo = useRef<HTMLDialogElement>(null);
  const lock = useRef(false);
  const revisaoForm = useRef<HTMLFormElement>(null);
  const query = new URLSearchParams({
    ...periodo,
    ...(filtro.estado ? { estado: filtro.estado } : {}),
    ...(filtro.categoria ? { categoria: filtro.categoria } : {}),
    ...(filtro.execucaoId ? { execucaoId: filtro.execucaoId } : {}),
    pagina: String(filtro.pagina),
  }).toString();
  const carregar = useCallback(async () => {
    setAtualizacao((v) => v + 1);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    apiJson<Painel>(
      `${raiz}/reconciliation?${query}`,
      undefined,
      controller.signal,
    )
      .then((retorno) => {
        setPainel(retorno);
        setCarregando(false);
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setErro(mensagemErro(e));
          setCarregando(false);
        }
      });
    return () => controller.abort();
  }, [query, atualizacao]);
  useEffect(() => {
    if (detalhe && !dialogo.current?.open) dialogo.current?.showModal();
  }, [detalhe]);
  async function operar(acao: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setOcupado(true);
    setErro("");
    setAviso("");
    try {
      await acao();
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      lock.current = false;
      setOcupado(false);
    }
  }
  const executar = () =>
    operar(async () => {
      const resultado = await apiJson<{ id: string }>(
        `${raiz}/reconciliation/runs`,
        {
          ...periodo,
          requestKey: chave(),
        },
      );
      setFiltro((f) => ({ ...f, execucaoId: resultado.id, pagina: 1 }));
      await carregar();
      setAviso(
        "Conferência concluída. As fontes e decisões anteriores foram preservadas.",
      );
    });
  async function importar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const form = new FormData(evento.currentTarget);
    await operar(async () => {
      const arquivo = form.get("arquivo");
      if (!(arquivo instanceof File)) throw new Error("Escolha um arquivo.");
      const config = {
        fonte: form.get("fonte"),
        contaRef: form.get("contaRef"),
        de: form.get("de"),
        ate: form.get("ate"),
        separador: form.get("separador"),
        moeda: "BRL",
        formatoData: form.get("formatoData"),
      };
      setPrevia(
        await apiJson<Previa>(`${raiz}/imports/preview`, {
          nome: arquivo.name,
          arquivo: await arquivoBase64(arquivo),
          configuracao: config,
        }),
      );
      await carregar();
    });
  }
  async function confirmar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (!previa) return;
    const form = new FormData(evento.currentTarget);
    await operar(async () => {
      const resultado = await apiJson<{ estado: string; aviso?: string }>(
        `${raiz}/imports/confirm`,
        {
          previewId: previa.id,
          expectedHash: previa.arquivoHash,
          requestKey: chave(),
          revisado: form.get("revisado") === "on",
          motivo: String(form.get("motivo") ?? ""),
          substituirConflitos: form.get("substituirConflitos") === "on",
        },
      );
      setAviso(
        resultado.aviso ??
          (resultado.estado === "CONFIRMADA"
            ? "Arquivo confirmado. Execute uma nova conferência para usar estas linhas."
            : "Arquivo preservado em revisão."),
      );
      if (resultado.estado === "CONFIRMADA") setPrevia(null);
      await carregar();
    });
  }
  async function abrir(id: string) {
    await operar(async () => {
      setDetalhe(await apiJson<Detalhe>(`${raiz}/reconciliation/${id}`));
    });
  }
  async function abrirArquivo(id: string, pagina = 1) {
    await operar(async () => {
      setArquivoDetalhe(
        await apiJson<Importacao>(`${raiz}/imports/${id}?pagina=${pagina}`),
      );
      setAba("importacoes");
    });
  }
  const totais = painel?.execucao?.totais as
    | {
        vendidoCentavos: number;
        previstoCentavos: number | null;
        liquidadoCentavos: number;
        creditadoCentavos: number;
        contratosDesconhecidos: number;
        debitadoCentavos: number;
      }
    | undefined;
  const cobertura = painel?.execucao?.cobertura as Cobertura | undefined;
  const resultados = painel?.resultados ?? [];

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight lg:text-[1.75rem]">
            Conferência de recebimentos
          </h1>
          <p className="text-ink-3 mt-1 text-sm">
            {unidade} · Vendas, adquirente e banco no mesmo lugar.
          </p>
        </div>
        {podeImportar && (
          <Botao
            onClick={() => {
              setAba("importacoes");
              setArquivoDetalhe(null);
            }}
          >
            Importar arquivo
          </Botao>
        )}
      </header>
      <p className="border-line bg-info-sub text-info rounded-xl border px-4 py-3 text-sm">
        Modo de observação. A conferência aponta diferenças e guarda decisões;
        não dá baixa em contas nem movimenta dinheiro.
      </p>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setCarregando(true);
          setPainel(null);
          setPeriodo({ de: String(f.get("de")), ate: String(f.get("ate")) });
          setFiltro({ estado: "", categoria: "", pagina: 1, execucaoId: "" });
          void carregar();
        }}
      >
        <Rotulo texto="De">
          <input
            className={campo}
            type="date"
            name="de"
            required
            defaultValue={deInicial}
          />
        </Rotulo>
        <Rotulo texto="Até">
          <input
            className={campo}
            type="date"
            name="ate"
            required
            defaultValue={ateInicial}
          />
        </Rotulo>
        <Botao peso="secundario" type="submit" disabled={ocupado}>
          Ver período
        </Botao>
        <div className="ml-auto flex flex-wrap gap-2">
          {podeImportar && (
            <Botao
              peso="secundario"
              type="button"
              onClick={executar}
              carregando={ocupado}
              disabled={
                !painel?.importacoes.some((i) => i.estado === "CONFIRMADA")
              }
            >
              Conferir período
            </Botao>
          )}
          {painel?.execucao && (
            <a
              className={estiloDeBotao("fantasma")}
              href={`${raiz}/reconciliation/export?${query}`}
            >
              Exportar CSV
            </a>
          )}
        </div>
      </form>
      {erro && (
        <div className="bg-bad-sub text-bad rounded-xl p-4" role="alert">
          {erro}
          <button
            className="ml-3 underline"
            onClick={() => {
              setErro("");
              void operar(() => carregar());
            }}
          >
            Tentar novamente
          </button>
        </div>
      )}
      {aviso && (
        <p
          className="bg-info-sub text-info rounded-xl p-4 text-sm"
          role="status"
        >
          {aviso}
        </p>
      )}
      <nav
        aria-label="Seções da conferência"
        className="border-line flex gap-1 overflow-auto border-b"
      >
        {(
          [
            ["conferencia", "Conferência"],
            ["importacoes", "Arquivos e cobertura"],
            ["contratos", "Contratos de taxa"],
          ] as const
        ).map(([id, nome]) => (
          <button
            key={id}
            aria-current={aba === id ? "page" : undefined}
            className={`min-h-11 shrink-0 border-b-2 px-3 text-sm font-semibold ${aba === id ? "border-accent text-accent" : "text-ink-3 border-transparent"}`}
            onClick={() => setAba(id)}
          >
            {nome}
          </button>
        ))}
      </nav>
      {carregando && (
        <p className="text-ink-3" role="status">
          Carregando os arquivos e o histórico…
        </p>
      )}
      {aba === "conferencia" && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Numero
              titulo="Vendido bruto"
              valor={totais?.vendidoCentavos ?? null}
              descricao="Vendas não canceladas nos arquivos do PDV."
            />
            <Numero
              titulo="Líquido previsto"
              valor={totais?.previstoCentavos ?? null}
              descricao={
                totais?.contratosDesconhecidos
                  ? `${totais.contratosDesconhecidos} venda(s) sem contrato conhecido.`
                  : "Bruto menos a taxa contratada na data da venda."
              }
            />
            <Numero
              titulo="Liquidado pela adquirente"
              valor={totais?.liquidadoCentavos ?? null}
              descricao="Recebíveis marcados como liquidados. Ainda exige banco."
            />
            <Numero
              titulo="Creditado no banco"
              valor={totais?.creditadoCentavos ?? null}
              descricao="Créditos no período efetivo do extrato, contados uma única vez."
            />
          </div>
          <p className="text-ink-3 text-xs">
            São quatro etapas do mesmo dinheiro. Somá-las duplicaria a receita.
            Débitos bancários no período: {moeda(totais?.debitadoCentavos)}.
          </p>
          {painel?.execucao && (
            <section
              className="border-line bg-surface grid gap-3 rounded-xl border p-4 lg:grid-cols-3"
              aria-label="Cobertura das fontes"
            >
              {fontes.map((f) => (
                <div key={f}>
                  <p className="font-semibold">{rotuloFonte[f]}</p>
                  <p
                    className={`mt-1 text-sm ${cobertura?.[f].completa ? "text-ok" : "text-warn"}`}
                  >
                    {cobertura?.[f].completa
                      ? "Cobertura declarada completa"
                      : "Cobertura parcial"}
                  </p>
                  <p className="text-ink-3 mt-1 text-xs">
                    {cobertura?.[f].de} a {cobertura?.[f].ate} ·{" "}
                    {cobertura?.[f].importacoes.length ?? 0} arquivo(s)
                  </p>
                </div>
              ))}
            </section>
          )}
          {painel && "desatualizada" in painel && painel.desatualizada && (
            <p className="bg-warn-sub text-warn rounded-xl p-4 text-sm">
              Há fontes ou contratos posteriores a esta execução. Rode uma nova
              conferência para comparar as evidências.
            </p>
          )}
          <div className="flex flex-wrap items-end gap-3">
            <div className="mr-auto">
              <h2 className="text-lg font-semibold">Fila de conferência</h2>
              <p className="text-ink-3 text-sm">
                {painel?.total ?? 0} ocorrência(s). Ausência de registro não
                comprova perda.
              </p>
            </div>
            <Rotulo texto="Correspondência">
              <select
                className={campo}
                value={filtro.categoria}
                onChange={(e) => {
                  setCarregando(true);
                  setFiltro((f) => ({
                    ...f,
                    categoria: e.target.value,
                    pagina: 1,
                  }));
                }}
              >
                <option value="">Todas</option>
                {["EXATA", "PROVAVEL", "AMBIGUA", "AUSENTE"].map((c) => (
                  <option key={c} value={c}>
                    {
                      {
                        EXATA: "Exata",
                        PROVAVEL: "Provável",
                        AMBIGUA: "Ambígua",
                        AUSENTE: "Ausente",
                      }[c]
                    }
                  </option>
                ))}
              </select>
            </Rotulo>
            <Rotulo texto="Etapa">
              <select
                className={campo}
                value={filtro.estado}
                onChange={(e) => {
                  setCarregando(true);
                  setFiltro((f) => ({
                    ...f,
                    estado: e.target.value,
                    pagina: 1,
                  }));
                }}
              >
                <option value="">Todas as etapas</option>
                {Object.entries(estados).map(([s, l]) => (
                  <option key={s} value={s}>
                    {l}
                  </option>
                ))}
              </select>
            </Rotulo>
          </div>
          {!painel?.execucao && !carregando ? (
            <div className="border-line bg-surface rounded-xl border p-8">
              <h3 className="text-lg font-semibold">
                Comece pelos três arquivos
              </h3>
              <p className="text-ink-3 mt-2 max-w-2xl text-sm">
                Importe as vendas do PDV, os recebíveis da adquirente e o
                extrato do banco. Confira as colunas e confirme cada leitura
                antes de rodar a conferência.
              </p>
              <p className="text-ink-3 mt-2 max-w-2xl text-sm">
                As vendas Saipos do Analytics não incluem NSU, taxas e lotes
                bancários. Este fluxo começa pelos arquivos originais.
              </p>
              <button
                className="text-accent mt-4 min-h-11 font-semibold"
                onClick={() => setDemonstracao((v) => !v)}
              >
                Ver exemplo fictício de R$ 1.250,00
              </button>
              {demonstracao && <Exemplo />}
            </div>
          ) : (
            <div className="space-y-2">
              {resultados.map((r) => (
                <button
                  key={r.id}
                  onClick={() => abrir(r.id)}
                  className="border-line bg-surface hover:bg-surface-2 grid w-full gap-3 rounded-xl border p-4 text-left lg:grid-cols-[1fr_180px_180px_100px]"
                >
                  <div>
                    <Estado estado={r.estado} />
                    <p className="text-ink-3 mt-2 text-xs">
                      {r.categoria === "EXATA"
                        ? "Referência forte"
                        : r.categoria === "PROVAVEL"
                          ? "Sugestão; exige revisão"
                          : r.categoria === "AMBIGUA"
                            ? "Há mais de uma candidata"
                            : "Vínculo ausente"}
                    </p>
                  </div>
                  <div className="text-sm">
                    <span className="text-ink-3 block text-xs">
                      Bruto da venda
                    </span>
                    <strong>{moeda(r.brutoCentavos)}</strong>
                  </div>
                  <div className="text-sm">
                    <span className="text-ink-3 block text-xs">
                      Diferença de taxa
                    </span>
                    <strong>{moeda(r.diferencaTaxaCentavos)}</strong>
                    {r.decisao && (
                      <p className="text-ink-3 mt-1 text-xs">
                        {r.revisaoAdicional
                          ? "Revisão adicional"
                          : "Decisão preservada"}{" "}
                        · v{r.versao}
                      </p>
                    )}
                  </div>
                  <span className="text-accent self-center text-sm font-semibold">
                    Ver detalhe
                  </span>
                </button>
              ))}
              {painel?.execucao && resultados.length === 0 && (
                <p className="border-line rounded-xl border p-6 text-sm">
                  Nenhuma ocorrência neste filtro. Confira as fontes e
                  experimente outra etapa.
                </p>
              )}
            </div>
          )}
          {!!painel?.execucao && (
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <p className="text-ink-3">
                Execução de {dataHora(painel.execucao.criadoEm)} ·{" "}
                {painel.execucao.regrasVersao}
              </p>
              <div className="flex gap-2">
                <Botao
                  peso="fantasma"
                  disabled={filtro.pagina <= 1}
                  onClick={() =>
                    setFiltro((f) => ({ ...f, pagina: f.pagina - 1 }))
                  }
                >
                  Anterior
                </Botao>
                <span className="self-center">Página {filtro.pagina}</span>
                <Botao
                  peso="fantasma"
                  disabled={filtro.pagina * 50 >= painel.total}
                  onClick={() =>
                    setFiltro((f) => ({ ...f, pagina: f.pagina + 1 }))
                  }
                >
                  Próxima
                </Botao>
              </div>
              <Rotulo texto="Histórico de execuções">
                <select
                  className={campo}
                  value={painel.execucao.id}
                  onChange={(e) =>
                    setFiltro((f) => ({
                      ...f,
                      execucaoId: e.target.value,
                      pagina: 1,
                    }))
                  }
                >
                  {painel.historico.map((h) => (
                    <option key={h.id} value={h.id}>
                      {dataHora(h.criadoEm)}
                    </option>
                  ))}
                </select>
              </Rotulo>
            </div>
          )}
        </>
      )}
      {aba === "importacoes" && (
        <>
          {podeImportar && (
            <section className="border-line bg-surface rounded-xl border p-4 sm:p-6">
              <h2 className="text-lg font-semibold">
                Importar e conferir a leitura
              </h2>
              <p className="text-ink-3 mt-1 text-sm">
                CSV/JSON em UTF-8, até 2 MB e 5.000 linhas. BRL; campos
                terminados em Cents são centavos inteiros. O original será
                preservado em privado.
              </p>
              <form
                onSubmit={importar}
                className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
              >
                <Rotulo texto="Origem">
                  <select name="fonte" className={campo}>
                    {fontes.map((f) => (
                      <option key={f} value={f}>
                        {rotuloFonte[f]}
                      </option>
                    ))}
                  </select>
                </Rotulo>
                <Rotulo texto="Conta de destino (referência)">
                  <input
                    className={campo}
                    name="contaRef"
                    placeholder="Ex.: conta-matriz"
                    required
                    maxLength={120}
                  />
                </Rotulo>
                <Rotulo texto="Arquivo original">
                  <input
                    className={campo}
                    type="file"
                    name="arquivo"
                    accept=".csv,.json"
                    required
                  />
                </Rotulo>
                <Rotulo texto="Cobertura do arquivo: de">
                  <input
                    className={campo}
                    name="de"
                    type="date"
                    defaultValue={periodo.de}
                    required
                  />
                </Rotulo>
                <Rotulo texto="Cobertura do arquivo: até">
                  <input
                    className={campo}
                    name="ate"
                    type="date"
                    defaultValue={periodo.ate}
                    required
                  />
                </Rotulo>
                <div className="grid grid-cols-2 gap-3">
                  <Rotulo texto="Separador CSV">
                    <select className={campo} name="separador">
                      <option value=";">Ponto e vírgula</option>
                      <option value=",">Vírgula</option>
                      <option value={"\t"}>Tabulação</option>
                    </select>
                  </Rotulo>
                  <Rotulo texto="Datas">
                    <select className={campo} name="formatoData">
                      <option value="ISO">AAAA-MM-DD</option>
                      <option value="BR">DD/MM/AAAA</option>
                    </select>
                  </Rotulo>
                </div>
                <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-3">
                  <Botao type="submit" peso="secundario" carregando={ocupado}>
                    Analisar arquivo
                  </Botao>
                  {fontes.map((f) => (
                    <a
                      className="text-accent min-h-11 content-center text-sm font-semibold"
                      key={f}
                      href={`${raiz}/models/${f}`}
                    >
                      Modelo: {rotuloFonte[f]}
                    </a>
                  ))}
                </div>
              </form>
            </section>
          )}
          {previa && (
            <section className="border-accent bg-surface rounded-xl border p-4 sm:p-6">
              <h2 className="text-lg font-semibold">
                Prévia: {previa.nomeArquivo}
              </h2>
              <p className="mt-2 text-sm">
                {previa.lidas} lidas · {previa.aceitas} aceitas ·{" "}
                {previa.rejeitadas} rejeitadas · {previa.ignoradas} ignoradas
              </p>
              <p className="text-ink-3 mt-2 text-xs break-all">
                SHA-256: {previa.arquivoHash}
              </p>
              <p className="text-ink-3 mt-2 text-sm">
                Colunas: {previa.colunas.join(", ")}
              </p>
              {previa.avisos.map((a) => (
                <p className="text-warn mt-2 text-sm" key={a}>
                  {a}
                </p>
              ))}
              <div className="mt-3 max-h-72 space-y-2 overflow-auto">
                {previa.amostra.map((l) => (
                  <details
                    className="bg-surface-2 rounded-lg p-3 text-sm"
                    key={l.numero}
                  >
                    <summary>
                      Linha {l.numero} ·{" "}
                      {l.erros.length ? "Rejeitada" : "Aceita"}
                    </summary>
                    <pre className="mt-2 text-xs break-words whitespace-pre-wrap">
                      {JSON.stringify(l.normalizado ?? l.bruto, null, 2)}
                    </pre>
                    {l.erros.map((e, i) => (
                      <p className="text-bad" key={i}>
                        {e}
                      </p>
                    ))}
                  </details>
                ))}
              </div>
              {previa.erros.length > 0 && (
                <p className="text-warn mt-3 text-sm">
                  Há linhas rejeitadas. Confirmar guarda o lote em revisão; as
                  linhas não entram na conferência.
                </p>
              )}
              <form className="mt-4 space-y-3" onSubmit={confirmar}>
                {podeDecidir && (
                  <>
                    <label className="flex gap-2 text-sm">
                      <input
                        className="size-5 shrink-0"
                        type="checkbox"
                        name="revisado"
                      />
                      Revisei colunas não interpretadas e confirmei que
                      ocorrências sem identificador são distintas.
                    </label>
                    <label className="flex gap-2 text-sm">
                      <input
                        className="size-5 shrink-0"
                        type="checkbox"
                        name="substituirConflitos"
                      />
                      Substituir a interpretação anterior de identificadores
                      alterados, preservando seu histórico.
                    </label>
                    <Rotulo texto="Motivo da revisão, quando houver conflito">
                      <textarea
                        className={campo}
                        name="motivo"
                        maxLength={2000}
                      />
                    </Rotulo>
                  </>
                )}
                <Botao type="submit" peso="secundario" carregando={ocupado}>
                  Confirmar leitura
                </Botao>
              </form>
            </section>
          )}
          <section>
            <h2 className="text-lg font-semibold">Arquivos do período</h2>
            <p className="text-ink-3 mt-1 text-sm">
              A cobertura é declarada por quem importa e validada no período. Um
              arquivo em revisão mantém a cobertura parcial.
            </p>
            <div className="mt-4 space-y-3">
              {painel?.importacoes.map((i) => (
                <article
                  key={i.id}
                  className="border-line bg-surface rounded-xl border p-4"
                >
                  <div className="flex flex-wrap justify-between gap-2">
                    <h3 className="font-semibold break-all">{i.nomeArquivo}</h3>
                    <span
                      className={`text-xs font-semibold ${i.estado === "CONFIRMADA" ? "text-ok" : "text-warn"}`}
                    >
                      {i.estado}
                    </span>
                  </div>
                  <p className="text-ink-3 mt-1 text-sm">
                    {rotuloFonte[i.fonte as Fonte]} · {i.contaRef} · {i.de} a{" "}
                    {i.ate}
                  </p>
                  <p className="mt-2 text-sm">
                    {i.lidas} lidas · {i.aceitas} aceitas · {i.rejeitadas}{" "}
                    rejeitadas · {i.ignoradas} ignoradas
                  </p>
                  <p className="text-ink-3 mt-1 text-xs">
                    Importado em {dataHora(i.criadoEm)} · {i.parserVersao}
                  </p>
                  {i.motivoRevisao && (
                    <p className="text-warn mt-2 text-sm">{i.motivoRevisao}</p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-3">
                    <button
                      className="text-accent min-h-11 text-sm font-semibold"
                      onClick={() => abrirArquivo(i.id)}
                    >
                      Ver linhas e erros
                    </button>
                    <a
                      href={`${raiz}/imports/${i.id}/original`}
                      className="text-accent min-h-11 content-center text-sm font-semibold"
                    >
                      Baixar original
                    </a>
                    {["PREVIA", "REVISAO"].includes(i.estado) &&
                      podeImportar && (
                        <button
                          className="text-accent min-h-11 text-sm font-semibold"
                          onClick={() =>
                            operar(async () => {
                              const r = await apiJson<Importacao>(
                                `${raiz}/imports/${i.id}?pagina=1`,
                              );
                              setPrevia({
                                ...r,
                                arquivoHash: r.arquivoHash,
                                colunas: Object.keys(
                                  (r.linhas[0]?.bruto ?? {}) as object,
                                ),
                                avisos: r.motivoRevisao
                                  ? [r.motivoRevisao]
                                  : [],
                                amostra: r.linhas.slice(0, 8).map((l) => ({
                                  numero: l.numero,
                                  bruto: l.bruto,
                                  normalizado: l.normalizado as Linha | null,
                                  erros: l.erros as string[],
                                })),
                                erros: r.linhas
                                  .filter((l) => (l.erros as string[]).length)
                                  .map((l) => ({
                                    numero: l.numero,
                                    erros: l.erros as string[],
                                  })),
                              });
                            })
                          }
                        >
                          Revisar leitura
                        </button>
                      )}
                  </div>
                  {["PREVIA", "REVISAO"].includes(i.estado) && podeDecidir && (
                    <details className="mt-3 text-sm">
                      <summary className="text-ink-3 cursor-pointer">
                        Descartar esta leitura pendente
                      </summary>
                      <form
                        className="mt-3 space-y-3"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const f = new FormData(e.currentTarget);
                          void operar(async () => {
                            await apiJson(`${raiz}/imports/${i.id}/discard`, {
                              motivo: f.get("motivo"),
                            });
                            setPrevia(null);
                            setAviso(
                              "Leitura descartada com motivo. O original foi preservado.",
                            );
                            await carregar();
                          });
                        }}
                      >
                        <Rotulo texto="Motivo do descarte">
                          <textarea
                            className={campo}
                            name="motivo"
                            minLength={10}
                            maxLength={2000}
                            required
                          />
                        </Rotulo>
                        <Botao peso="secundario" carregando={ocupado}>
                          Descartar leitura e preservar original
                        </Botao>
                      </form>
                    </details>
                  )}
                </article>
              ))}
              {painel?.importacoes.length === 0 && (
                <p className="text-ink-3 border-line rounded-xl border p-6 text-sm">
                  Nenhum arquivo importado neste período.
                </p>
              )}
            </div>
          </section>
          {arquivoDetalhe && (
            <section className="border-line bg-surface rounded-xl border p-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-semibold">
                  Linhas: {arquivoDetalhe.nomeArquivo}
                </h2>
                <Botao peso="fantasma" onClick={() => setArquivoDetalhe(null)}>
                  Fechar linhas
                </Botao>
              </div>
              {arquivoDetalhe.linhas.map((l) => (
                <details
                  key={l.id}
                  id={`linha-${l.numero}`}
                  className="border-line border-b py-3"
                >
                  <summary>
                    Linha {l.numero} ·{" "}
                    {l.ativa
                      ? "Em uso"
                      : (l.erros as string[]).length
                        ? "Rejeitada"
                        : "Preservada"}
                  </summary>
                  <div className="mt-2 grid gap-3 lg:grid-cols-2">
                    <div>
                      <h3 className="text-sm font-semibold">Original</h3>
                      <pre className="text-ink-3 mt-1 text-xs break-words whitespace-pre-wrap">
                        {JSON.stringify(l.bruto, null, 2)}
                      </pre>
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold">Interpretação</h3>
                      <pre className="text-ink-3 mt-1 text-xs break-words whitespace-pre-wrap">
                        {JSON.stringify(l.normalizado, null, 2)}
                      </pre>
                      {(l.erros as string[]).map((e, j) => (
                        <p className="text-bad text-sm" key={j}>
                          {e}
                        </p>
                      ))}
                    </div>
                  </div>
                </details>
              ))}
              <div className="mt-3 flex justify-between">
                <Botao
                  peso="fantasma"
                  disabled={arquivoDetalhe.pagina <= 1}
                  onClick={() =>
                    abrirArquivo(arquivoDetalhe.id, arquivoDetalhe.pagina - 1)
                  }
                >
                  Anterior
                </Botao>
                <Botao
                  peso="fantasma"
                  disabled={arquivoDetalhe.linhas.length < 50}
                  onClick={() =>
                    abrirArquivo(arquivoDetalhe.id, arquivoDetalhe.pagina + 1)
                  }
                >
                  Próxima
                </Botao>
              </div>
            </section>
          )}
        </>
      )}
      {aba === "contratos" && (
        <>
          <section>
            <h2 className="text-lg font-semibold">A taxa que foi combinada</h2>
            <p className="text-ink-3 mt-1 text-sm">
              A vigência, o método, a bandeira e as parcelas precisam
              corresponder à venda. Contrato ausente continua desconhecido. O
              prazo vem do arquivo da adquirente, sem atraso presumido.
            </p>
          </section>
          {podeImportar && (
            <form
              key={contratoBase?.id ?? "novo"}
              className="border-line bg-surface grid gap-4 rounded-xl border p-4 sm:grid-cols-2 lg:grid-cols-4"
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const dados = new FormData(form);
                void operar(async () => {
                  await apiJson(`${raiz}/contracts`, {
                    substituiId: contratoBase?.id,
                    provedor: dados.get("provedor"),
                    estabelecimento: dados.get("estabelecimento"),
                    bandeira: String(dados.get("bandeira")).toUpperCase(),
                    metodo: dados.get("metodo"),
                    parcelasDe: Number(dados.get("parcelasDe")),
                    parcelasAte: Number(dados.get("parcelasAte")),
                    de: dados.get("de"),
                    ate: dados.get("ate") || null,
                    taxaBps: Number(dados.get("taxaBps")),
                    fixaCentavos: Number(dados.get("fixaCentavos")),
                    toleranciaCentavos: Number(dados.get("toleranciaCentavos")),
                  });
                  setAviso(
                    "Contrato cadastrado. A nova conferência usará esta vigência.",
                  );
                  await carregar();
                  setContratoBase(null);
                  form.reset();
                });
              }}
            >
              <Rotulo texto="Provedor">
                <input
                  className={campo}
                  name="provedor"
                  defaultValue={contratoBase?.provedor}
                  maxLength={120}
                  required
                />
              </Rotulo>
              <Rotulo texto="Estabelecimento">
                <input
                  className={campo}
                  name="estabelecimento"
                  defaultValue={contratoBase?.estabelecimento}
                  maxLength={120}
                  required
                />
              </Rotulo>
              <Rotulo texto="Bandeira">
                <input
                  className={campo}
                  name="bandeira"
                  defaultValue={contratoBase?.bandeira}
                  placeholder="VISA"
                  maxLength={120}
                  required
                />
              </Rotulo>
              <Rotulo texto="Método">
                <select
                  className={campo}
                  name="metodo"
                  defaultValue={contratoBase?.metodo ?? "CREDIT"}
                >
                  <option value="CREDIT">Crédito</option>
                  <option value="DEBIT">Débito</option>
                  <option value="PIX">Pix</option>
                </select>
              </Rotulo>
              <Rotulo texto="Vigência: início">
                <input
                  className={campo}
                  name="de"
                  type="date"
                  required
                  defaultValue={contratoBase?.de}
                />
              </Rotulo>
              <Rotulo texto="Vigência: fim (opcional)">
                <input
                  className={campo}
                  name="ate"
                  type="date"
                  defaultValue={contratoBase?.ate ?? ""}
                />
              </Rotulo>
              <Rotulo texto="Parcelas: de">
                <input
                  className={campo}
                  type="number"
                  name="parcelasDe"
                  defaultValue={contratoBase?.parcelasDe ?? 1}
                  min={1}
                  max={48}
                  required
                />
              </Rotulo>
              <Rotulo texto="Parcelas: até">
                <input
                  className={campo}
                  type="number"
                  name="parcelasAte"
                  defaultValue={contratoBase?.parcelasAte ?? 1}
                  min={1}
                  max={48}
                  required
                />
              </Rotulo>
              <Rotulo texto="Taxa em pontos-base (300 = 3%)">
                <input
                  className={campo}
                  type="number"
                  name="taxaBps"
                  defaultValue={contratoBase?.taxaBps ?? 300}
                  min={0}
                  max={10000}
                  required
                />
              </Rotulo>
              <Rotulo texto="Taxa fixa em centavos">
                <input
                  className={campo}
                  type="number"
                  name="fixaCentavos"
                  defaultValue={contratoBase?.fixaCentavos ?? 0}
                  min={0}
                  max={2000000000}
                  required
                />
              </Rotulo>
              <Rotulo texto="Tolerância em centavos">
                <input
                  className={campo}
                  type="number"
                  name="toleranciaCentavos"
                  defaultValue={contratoBase?.toleranciaCentavos ?? 0}
                  min={0}
                  max={10000}
                  required
                />
              </Rotulo>
              <div className="self-end">
                <Botao peso="secundario" carregando={ocupado}>
                  {contratoBase ? "Salvar nova versão" : "Cadastrar contrato"}
                </Botao>
              </div>
              {contratoBase && (
                <p className="text-info text-sm sm:col-span-2 lg:col-span-4">
                  Revisando a versão {contratoBase.versao}. A versão anterior
                  ficará preservada no histórico.{" "}
                  <button
                    type="button"
                    className="underline"
                    onClick={() => setContratoBase(null)}
                  >
                    Cancelar revisão
                  </button>
                </p>
              )}
            </form>
          )}
          <div className="space-y-3">
            {painel?.contratos.map((c) => (
              <div
                className="border-line bg-surface rounded-xl border p-4"
                key={c.id}
              >
                <h3 className="font-semibold">
                  {c.provedor} · {c.estabelecimento}
                </h3>
                <p className="text-ink-3 mt-1 text-sm">
                  {c.bandeira} / {c.metodo} · {c.parcelasDe} a {c.parcelasAte}{" "}
                  parcela(s) · {c.de} a {c.ate ?? "sem fim definido"}
                </p>
                <p className="mt-2 text-sm">
                  {c.taxaBps / 100}% + {moeda(c.fixaCentavos)} · tolerância{" "}
                  {moeda(c.toleranciaCentavos)} · versão {c.versao}
                </p>
                {c.ativa && podeImportar ? (
                  <Botao peso="fantasma" onClick={() => setContratoBase(c)}>
                    Revisar contrato
                  </Botao>
                ) : !c.ativa ? (
                  <p className="text-ink-3 mt-2 text-xs">
                    Versão substituída; preservada para consulta.
                  </p>
                ) : null}
              </div>
            ))}
            {painel?.contratos.length === 0 && (
              <p className="text-ink-3">
                Nenhum contrato cadastrado. Taxas não serão presumidas como
                zero.
              </p>
            )}
          </div>
        </>
      )}
      <dialog
        ref={dialogo}
        onClose={() => setDetalhe(null)}
        className="border-line bg-surface text-ink fixed inset-0 m-auto max-h-[92dvh] w-[calc(100%-24px)] max-w-4xl overflow-auto rounded-2xl border p-4 backdrop:bg-black/40 sm:p-6"
      >
        {detalhe && (
          <>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">
                  De onde veio a diferença
                </h2>
                <p className="text-ink-3 mt-1 text-xs">
                  Execução {dataHora(detalhe.execucao.criadoEm)} ·{" "}
                  {detalhe.execucao.regrasVersao}
                </p>
              </div>
              <Botao peso="fantasma" onClick={() => dialogo.current?.close()}>
                Fechar
              </Botao>
            </div>
            <div className="mt-4">
              <Estado estado={detalhe.resultado.estado} />
            </div>
            {detalhe.revisaoAdicional && (
              <p className="bg-warn-sub text-warn mt-3 rounded-lg p-3 text-sm">
                A decisão anterior foi preservada. As novas evidências pedem
                revisão adicional.
              </p>
            )}
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {fontes.map((f) => (
                <section key={f} className="border-line rounded-xl border p-3">
                  <h3 className="font-semibold">{rotuloFonte[f]}</h3>
                  {detalhe.linhas
                    .filter((l) => l.fonte === f)
                    .map((l) => {
                      const n = l.normalizado as unknown as Linha;
                      return (
                        <div className="mt-3 text-sm" key={l.id}>
                          <strong>
                            {moeda(
                              f === "BANCO" ? n.amountCents : n.grossCents,
                            )}
                          </strong>
                          <p className="text-ink-3 mt-1 text-xs break-words">
                            {n.provider} · {n.merchantRef}
                            <br />
                            {n.businessDay} · NSU {n.nsu ?? "ausente"}
                            <br />
                            Conta {n.accountRef}
                            <br />
                            Lote {n.payoutRef ?? "ausente"}
                          </p>
                          {f === "ADQUIRENTE" && (
                            <p className="mt-2 text-xs">
                              Taxa: {moeda(n.feeCents)}
                              <br />
                              Líquido: {moeda(n.netCents)}
                              <br />
                              Ajustes: {moeda(n.adjustmentCents)}{" "}
                              {n.adjustmentReason}
                            </p>
                          )}
                          <button
                            className="text-accent mt-2 min-h-11 text-left text-xs font-semibold break-all"
                            onClick={() => {
                              dialogo.current?.close();
                              void abrirArquivo(
                                l.importacaoId,
                                Math.floor((l.numero - 1) / 50) + 1,
                              );
                            }}
                          >
                            Arquivo {l.importacao.nomeArquivo} · linha{" "}
                            {l.numero}
                          </button>
                          <a
                            className="text-accent block min-h-11 content-center text-xs"
                            href={`${raiz}/imports/${l.importacaoId}/original`}
                          >
                            Baixar original
                          </a>
                          <details className="text-ink-3 mt-1 text-xs">
                            <summary>Ver linha e hashes</summary>
                            <pre className="mt-2 break-words whitespace-pre-wrap">
                              {JSON.stringify(l.bruto, null, 2)}
                            </pre>
                            <p className="mt-2 break-all">
                              SHA-256 arquivo: {l.importacao.arquivoHash}
                              <br />
                              SHA-256 linha: {l.hash}
                            </p>
                          </details>
                        </div>
                      );
                    })}
                  {!detalhe.linhas.some((l) => l.fonte === f) && (
                    <p className="text-ink-3 mt-3 text-sm">
                      Sem vínculo nesta fonte.
                    </p>
                  )}
                </section>
              ))}
            </div>
            <dl className="divide-line mt-5 divide-y text-sm">
              {(
                [
                  ["Bruto da venda", detalhe.resultado.brutoCentavos],
                  ["Líquido previsto", detalhe.resultado.previstoCentavos],
                  [
                    "Taxa prevista pelo contrato",
                    detalhe.resultado.taxaPrevistaCentavos,
                  ],
                  ["Taxa cobrada", detalhe.resultado.taxaCobradaCentavos],
                  [
                    "Diferença de taxa",
                    detalhe.resultado.diferencaTaxaCentavos,
                  ],
                  [
                    "Crédito atribuído à venda pelo lote",
                    detalhe.resultado.creditoAlocadoCentavos,
                  ],
                  [
                    "Diferença de bruto",
                    detalhe.resultado.diferencaBrutoCentavos,
                  ],
                  [
                    "Diferença do lote no banco",
                    detalhe.resultado.diferencaBancoCentavos,
                  ],
                  [
                    "Tolerância contratada",
                    detalhe.resultado.toleranciaCentavos,
                  ],
                ] as const
              ).map(([l, v]) => (
                <div key={l} className="flex justify-between gap-4 py-2">
                  <dt className="text-ink-3">{l}</dt>
                  <dd className="font-semibold tabular-nums">{moeda(v)}</dd>
                </div>
              ))}
            </dl>
            {detalhe.contratos.map((c) => (
              <p className="text-ink-3 mt-2 text-sm" key={c.id}>
                Contrato v{c.versao}: {c.taxaBps} pontos-base ({c.taxaBps / 100}
                %) + {moeda(c.fixaCentavos)}, vigência {c.de} a{" "}
                {c.ate ?? "sem fim"}, {c.parcelasDe} a {c.parcelasAte} parcelas.
              </p>
            ))}
            {detalhe.resultado.notas.map((n) => (
              <p
                key={n}
                className="bg-info-sub text-info mt-2 rounded-lg p-3 text-sm"
              >
                {n}
              </p>
            ))}
            {detalhe.lotes.map((l) => (
              <p key={l.id} className="text-ink-3 mt-3 text-sm">
                Lote: {l.liquidoCentavos / 100} BRL ·{" "}
                {(l.componentes as string[]).length} componente(s) · alocado no
                banco {moeda(l.alocacoes.reduce((s, a) => s + a.centavos, 0))}.
                O crédito integral é usado uma vez por lote nesta execução.
              </p>
            ))}
            <section className="mt-6">
              <h3 className="font-semibold">Evidências e decisões</h3>
              {detalhe.evidencias.map((e) => (
                <a
                  key={e.id}
                  className="text-accent mt-2 block min-h-11 content-center text-sm"
                  href={`${raiz}/evidence/${e.id}`}
                >
                  {e.nome} · {dataHora(e.criadoEm)}
                </a>
              ))}
              {podeDecidir && (
                <>
                  <form
                    className="mt-3 flex flex-wrap items-end gap-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      void operar(async () => {
                        const a = f.get("arquivo");
                        if (!(a instanceof File))
                          throw new Error("Escolha uma evidência.");
                        const d = await apiJson<{ id: string }>(
                          `${raiz}/reconciliation/${detalhe.id}/evidence`,
                          { nome: a.name, arquivo: await arquivoBase64(a) },
                        );
                        const novo = await apiJson<Detalhe>(
                          `${raiz}/reconciliation/${detalhe.id}`,
                        );
                        setDetalhe(novo);
                        setAviso(
                          `Evidência anexada (${d.id}). Selecione-a na decisão.`,
                        );
                      });
                    }}
                  >
                    <Rotulo texto="Anexar PDF, JPG ou PNG (até 2 MB)">
                      <input
                        className={campo}
                        type="file"
                        name="arquivo"
                        accept=".pdf,.png,.jpg,.jpeg"
                        required
                      />
                    </Rotulo>
                    <Botao peso="secundario" carregando={ocupado}>
                      Anexar evidência
                    </Botao>
                  </form>
                  <form
                    ref={revisaoForm}
                    className="mt-4 space-y-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const form = e.currentTarget;
                      const f = new FormData(form);
                      void operar(async () => {
                        await apiJson(
                          `${raiz}/reconciliation/${detalhe.id}/reviews`,
                          {
                            expectedVersion: detalhe.versao,
                            decisao: f.get("decisao"),
                            motivo: f.get("motivo"),
                            evidenciaIds: f.getAll("evidenciaIds"),
                          },
                        );
                        setDetalhe(
                          await apiJson<Detalhe>(
                            `${raiz}/reconciliation/${detalhe.id}`,
                          ),
                        );
                        await carregar();
                        form.reset();
                        setAviso(
                          "Decisão registrada no histórico. Nenhuma conta foi baixada.",
                        );
                      });
                    }}
                  >
                    <Rotulo texto="Registrar decisão">
                      <select name="decisao" className={campo}>
                        <option value="COMENTARIO">Comentar</option>
                        <option value="CONTESTAR_TAXA">Contestar taxa</option>
                        <option value="AGUARDAR">Aguardar evidência</option>
                        <option value="CONFERIDO_MANUALMENTE">
                          Conferido manualmente
                        </option>
                        <option value="DESCARTAR_SUGESTAO">
                          Descartar sugestão
                        </option>
                      </select>
                    </Rotulo>
                    <Rotulo texto="Motivo (mínimo de 10 caracteres)">
                      <textarea
                        className={campo}
                        name="motivo"
                        minLength={10}
                        maxLength={2000}
                        required
                      />
                    </Rotulo>
                    {detalhe.evidencias.map((e) => (
                      <label key={e.id} className="flex gap-2 text-sm">
                        <input
                          className="size-5"
                          name="evidenciaIds"
                          type="checkbox"
                          value={e.id}
                        />
                        {e.nome}
                      </label>
                    ))}
                    <Botao peso="secundario" carregando={ocupado}>
                      Registrar no histórico
                    </Botao>
                  </form>
                </>
              )}
              {detalhe.decisoes.map((d) => (
                <article key={d.id} className="border-line mt-4 border-t pt-3">
                  <p className="text-sm font-semibold">
                    {d.decisao.replaceAll("_", " ")} · versão {d.versao}
                  </p>
                  <p className="mt-1 text-sm whitespace-pre-wrap">{d.motivo}</p>
                  <p className="text-ink-3 mt-1 text-xs">
                    {dataHora(d.criadoEm)} · autor {d.autorId}
                  </p>
                </article>
              ))}
              {detalhe.decisoes.length === 0 && (
                <p className="text-ink-3 mt-3 text-sm">
                  Ainda não há decisões neste caso.
                </p>
              )}
            </section>
            {erro && (
              <p role="alert" className="text-bad mt-4">
                {erro}
              </p>
            )}
            {aviso && (
              <p role="status" className="text-info mt-4">
                {aviso}
              </p>
            )}
          </>
        )}
      </dialog>
    </div>
  );
}

function Exemplo() {
  return (
    <div className="border-line mt-4 border-t pt-4">
      <p className="text-info text-sm font-semibold">
        Exemplo fictício, sem gravação no banco
      </p>
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-ink-3">Venda no cartão</dt>
          <dd className="font-semibold">R$ 1.250,00</dd>
        </div>
        <div>
          <dt className="text-ink-3">Contrato de 3% (300 bps)</dt>
          <dd className="font-semibold">
            R$ 37,50 de taxa · R$ 1.212,50 previstos
          </dd>
        </div>
        <div>
          <dt className="text-ink-3">Adquirente</dt>
          <dd className="font-semibold">
            R$ 43,75 de taxa · R$ 1.206,25 líquidos
          </dd>
        </div>
        <div>
          <dt className="text-ink-3">Crédito com lote único no banco</dt>
          <dd className="font-semibold">R$ 1.206,25</dd>
        </div>
      </dl>
      <p className="text-bad mt-4 text-sm font-semibold">
        Taxa divergente: R$ 6,25 para conferir.
      </p>
      <p className="text-ink-3 mt-1 text-sm">
        O banco confirma o líquido recebido. A diferença entre a taxa cobrada e
        a contratada continua aberta.
      </p>
      <Link
        href="/financeiro/conferencia"
        className="text-accent mt-2 inline-block text-sm"
      >
        Voltar à conferência da loja
      </Link>
    </div>
  );
}
