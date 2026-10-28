"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import {
  LinkIntegrado as Link,
  useAmbienteProprio,
} from "@/core/shell/link-integrado";
import { Icone } from "@/design-system/icones";
import { lerNumeroBr } from "@/lib/numero";
import { abrirCaixaAcao, fecharCaixaAcao, movimentarCaixaAcao } from "../acoes";
import { historicoCaixasAcao } from "../caixa-acoes";
import {
  codigoCaixa,
  dataCaixa,
  formasCaixa,
  moedaCaixa,
  tiposLancamento,
  type DetalheCaixa,
  type HistoricoCaixas,
  type FormaCaixa,
} from "../caixa-types";
import { ModalCaixa } from "./modal-caixa";
import { ResumoCaixa } from "./resumo-caixa";
import styles from "./gestao-caixa.module.css";

type Operacao = "ABRIR" | "SANGRIA" | "SUPRIMENTO" | "FECHAR";
const titulos: Record<Operacao, string> = {
  ABRIR: "Abrir caixa",
  SANGRIA: "Nova sangria",
  SUPRIMENTO: "Novo suprimento",
  FECHAR: "Fechar caixa",
};

export function GestaoCaixa({
  caixa,
  caixaAtualId,
  historico: inicial,
  locais,
  podeOperar,
}: {
  caixa: DetalheCaixa | null;
  caixaAtualId: string | null;
  historico: HistoricoCaixas;
  locais: { id: string; nome: string }[];
  podeOperar: boolean;
}) {
  const router = useRouter();
  const proprio = useAmbienteProprio();
  const [operacao, setOperacao] = useState<Operacao | null>(null);
  const [valor, setValor] = useState("");
  const [motivo, setMotivo] = useState("");
  const [localId, setLocalId] = useState(
    locais.length === 1 ? locais[0].id : "",
  );
  const [erro, setErro] = useState("");
  const [incerto, setIncerto] = useState(false);
  const [sucesso, setSucesso] = useState("");
  const [pendente, iniciar] = useTransition();
  const enviando = useRef(false);
  const [historico, setHistorico] = useState(inicial);
  const [verHistorico, setVerHistorico] = useState(false);
  const [erroHistorico, setErroHistorico] = useState("");
  const [carregandoHistorico, iniciarHistorico] = useTransition();
  const [busca, setBusca] = useState("");
  const [forma, setForma] = useState("");
  const [tipo, setTipo] = useState("");
  const [ordem, setOrdem] = useState<{ campo: "data" | "valor"; asc: boolean }>(
    { campo: "data", asc: false },
  );
  const numero = lerNumeroBr(valor);
  const centavos = typeof numero === "number" ? Math.round(numero * 100) : null;
  const ativo = caixa && !caixa.fechadoEm;
  const termo = busca.trim().toLocaleLowerCase("pt-BR");
  const lancamentos = (caixa?.lancamentos ?? [])
    .filter(
      (l) =>
        (!termo || l.descricao.toLocaleLowerCase("pt-BR").includes(termo)) &&
        (!forma || l.forma === forma) &&
        (!tipo || l.tipo === tipo),
    )
    .sort(
      (a, b) =>
        (ordem.campo === "data"
          ? a.data.localeCompare(b.data)
          : a.valorCentavos - b.valorCentavos) * (ordem.asc ? 1 : -1),
    );
  function ordenar(campo: "data" | "valor") {
    setOrdem({ campo, asc: ordem.campo === campo ? !ordem.asc : false });
  }
  function abrir(op: Operacao) {
    if (pendente || enviando.current) return;
    setValor("");
    setMotivo(
      op === "SANGRIA" ? "Sangria" : op === "SUPRIMENTO" ? "Suprimento" : "",
    );
    setErro("");
    setSucesso("");
    setIncerto(false);
    setOperacao(op);
  }
  function carregarHistorico(pagina: number) {
    setErroHistorico("");
    iniciarHistorico(async () => {
      try {
        setHistorico(await historicoCaixasAcao(pagina));
      } catch {
        setErroHistorico(
          "Não foi possível carregar os caixas. Tente novamente.",
        );
      }
    });
  }
  function confirmar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!operacao || pendente || enviando.current || incerto) return;
    if (
      centavos === null ||
      !Number.isSafeInteger(centavos) ||
      centavos < 0 ||
      centavos > 100_000_000 ||
      (numero != null && Math.abs(numero * 100 - centavos) > 0.00001)
    ) {
      setErro("Informe um valor válido, com até duas casas decimais.");
      return;
    }
    if (operacao === "ABRIR" && !localId) {
      setErro("Selecione o local de estoque que atenderá este caixa.");
      return;
    }
    if (
      (operacao === "SANGRIA" || operacao === "SUPRIMENTO") &&
      (motivo.trim().length < 3 || centavos <= 0)
    ) {
      setErro(
        "Informe um valor maior que zero e uma descrição com pelo menos três caracteres.",
      );
      return;
    }
    if (operacao !== "ABRIR" && !ativo) {
      setErro("Este caixa já foi fechado. Atualize a tela.");
      return;
    }
    enviando.current = true;
    setErro("");
    iniciar(async () => {
      try {
        const resultado =
          operacao === "ABRIR"
            ? await abrirCaixaAcao({
                saldoInicialCentavos: centavos,
                localEstoqueId: localId,
              })
            : operacao === "FECHAR"
              ? await fecharCaixaAcao({
                  caixaId: caixa!.id,
                  valorContadoCentavos: centavos,
                  observacao: motivo.trim(),
                })
              : await movimentarCaixaAcao({
                  caixaId: caixa!.id,
                  tipo: operacao,
                  valorCentavos: centavos,
                  motivo: motivo.trim(),
                });
        if (resultado.erro) setErro(resultado.erro);
        else {
          setSucesso(resultado.ok ?? "Caixa atualizado.");
          setOperacao(null);
          if (operacao === "ABRIR") router.replace("/pdv/caixa");
          router.refresh();
        }
      } catch {
        setIncerto(true);
        setErro(
          "Não foi possível confirmar a operação. Atualize o caixa e confira os lançamentos antes de tentar novamente.",
        );
      } finally {
        enviando.current = false;
      }
    });
  }
  return (
    <div className={styles.pagina}>
      {!proprio && <h1 className={styles.titulo}>Caixa</h1>}
      <div className={styles.barra}>
        <div className={styles.filtros}>
          <label className={styles.busca}>
            <Icone nome="lupa" tamanho={20} />
            <input
              aria-label="Pesquisar pela descrição"
              placeholder="Pesquise pela descrição"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </label>
          <select
            aria-label="Formas de pagamento"
            value={forma}
            onChange={(e) => setForma(e.target.value)}
          >
            <option value="">Formas de pagamento</option>
            {Object.entries(formasCaixa).map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </select>
          <select
            aria-label="Tipo de operação"
            value={tipo}
            onChange={(e) => setTipo(e.target.value)}
          >
            <option value="">Tipo de operação</option>
            {Object.entries(tiposLancamento).map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.acoes}>
          {podeOperar && ativo && (
            <>
              <button
                className={styles.botaoRoxo}
                onClick={() => abrir("FECHAR")}
                disabled={pendente}
              >
                Fechar caixa
              </button>
              <button
                className={styles.botaoRoxo}
                onClick={() => abrir("SANGRIA")}
                disabled={pendente}
              >
                Sangria
              </button>
              <button
                className={styles.botaoRoxo}
                onClick={() => abrir("SUPRIMENTO")}
                disabled={pendente}
              >
                Suprimento
              </button>
            </>
          )}
          {podeOperar && !caixaAtualId && (
            <button
              className={styles.primario}
              disabled={!locais.length || pendente}
              onClick={() => abrir("ABRIR")}
            >
              Abrir caixa
            </button>
          )}
          {!!caixaAtualId && caixaAtualId !== caixa?.id && (
            <Link className={styles.botao} href="/pdv/caixa">
              Caixa atual
            </Link>
          )}
          <button
            className={styles.botao}
            onClick={() => {
              setVerHistorico(true);
              carregarHistorico(1);
            }}
          >
            Caixas anteriores
          </button>
        </div>
      </div>
      {sucesso && (
        <p className={styles.sucesso} role="status">
          {sucesso}
        </p>
      )}
      {caixa?.fechadoEm && (
        <p className={styles.aviso}>
          Consulta do caixa de {dataCaixa(caixa.abertoEm)} · Fechado
        </p>
      )}
      <div className={styles.grade}>
        <section
          className={styles.tabelaPainel}
          aria-label="Movimentações do caixa"
        >
          <div
            className={styles.rolagemTabela}
            tabIndex={0}
            aria-label="Tabela de movimentações"
          >
            <table className={styles.tabela}>
              <thead>
                <tr>
                  <th
                    aria-sort={
                      ordem.campo === "data"
                        ? ordem.asc
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                  >
                    <button onClick={() => ordenar("data")}>
                      Data/Hora{" "}
                      {ordem.campo === "data" && (ordem.asc ? "↑" : "↓")}
                    </button>
                  </th>
                  <th>Descrição</th>
                  <th
                    aria-sort={
                      ordem.campo === "valor"
                        ? ordem.asc
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                  >
                    <button onClick={() => ordenar("valor")}>
                      Valor {ordem.campo === "valor" && (ordem.asc ? "↑" : "↓")}
                    </button>
                  </th>
                  <th>Forma de pagamento</th>
                  <th>Tipo</th>
                  <th>Usuário</th>
                </tr>
              </thead>
              <tbody>
                {lancamentos.map((l) => (
                  <tr key={l.id}>
                    <td>{dataCaixa(l.data)}</td>
                    <td className={styles.descricao}>{l.descricao}</td>
                    <td
                      className={styles.valor}
                      data-negativo={l.valorCentavos < 0}
                    >
                      {moedaCaixa(l.valorCentavos)}
                    </td>
                    <td>{formasCaixa[l.forma]}</td>
                    <td>
                      <span className={styles.etiqueta} data-tipo={l.tipo}>
                        {tiposLancamento[l.tipo]}
                      </span>
                    </td>
                    <td>{l.usuario}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!lancamentos.length && (
              <div className={styles.vazio}>
                <Icone nome="moeda" tamanho={38} />
                <h2>
                  {caixa
                    ? "Nenhuma movimentação encontrada"
                    : "Seu caixa está fechado"}
                </h2>
                <p>
                  {caixa
                    ? "Altere a busca ou os filtros para consultar os lançamentos."
                    : "Abra o caixa para começar a registrar as vendas do expediente."}
                </p>
                {(busca || forma || tipo) && (
                  <button
                    className={styles.botao}
                    onClick={() => {
                      setBusca("");
                      setForma("");
                      setTipo("");
                    }}
                  >
                    Limpar filtros
                  </button>
                )}
                {!locais.length && !caixa && (
                  <Link href="/estoque">
                    Cadastre um local de estoque para abrir o caixa.
                  </Link>
                )}
              </div>
            )}
          </div>
          {(busca || forma || tipo) && (
            <p className={styles.rodapeTabela} role="status">
              {lancamentos.length} lançamento(s) encontrado(s). O resumo
              considera a sessão inteira.
            </p>
          )}
        </section>
        <aside className={styles.resumo} aria-label="Resumo da sessão">
          <header>
            <h2>Resumo</h2>
            {caixa && (
              <a
                href={`/pdv/caixa/imprimir/${caixa.id}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Imprimir resumo"
                title="Imprimir resumo"
              >
                <Icone nome="impressora" tamanho={20} />
              </a>
            )}
          </header>
          {caixa ? (
            <ResumoCaixa caixa={caixa} />
          ) : (
            <p className={styles.semResumo}>
              O resumo aparecerá após a abertura do caixa.
            </p>
          )}
        </aside>
      </div>
      <ModalCaixa
        aberto={operacao !== null}
        titulo={operacao ? titulos[operacao] : "Caixa"}
        ocupado={pendente}
        aoFechar={() => setOperacao(null)}
        amplo={operacao === "FECHAR"}
        rodape={
          <>
            <button
              className={styles.botao}
              disabled={pendente}
              onClick={() => setOperacao(null)}
            >
              Cancelar
            </button>
            {incerto ? (
              <button
                className={styles.primario}
                onClick={() => {
                  setOperacao(null);
                  router.refresh();
                }}
              >
                Atualizar caixa
              </button>
            ) : (
              <button
                type="submit"
                form="operacao-caixa"
                className={styles.primario}
                disabled={pendente}
              >
                {pendente
                  ? "Salvando…"
                  : operacao === "ABRIR"
                    ? "Abrir caixa"
                    : operacao === "FECHAR"
                      ? "Fechar caixa"
                      : "Salvar"}
              </button>
            )}
          </>
        }
      >
        <form
          id="operacao-caixa"
          onSubmit={confirmar}
          className={styles.formulario}
          aria-busy={pendente}
        >
          <fieldset disabled={pendente || incerto}>
            {operacao === "ABRIR" && (
              <label className={styles.campo}>
                <span className={styles.rotuloCampo}>Local de estoque</span>
                <select
                  required
                  value={localId}
                  onChange={(e) => setLocalId(e.target.value)}
                >
                  <option value="">Selecione o local</option>
                  {locais.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.nome}
                    </option>
                  ))}
                </select>
                <small>Estoque utilizado nas vendas deste caixa.</small>
              </label>
            )}
            {(operacao === "SANGRIA" || operacao === "SUPRIMENTO") && (
              <label className={styles.campo}>
                <span className={styles.rotuloCampo}>Descrição</span>
                <input
                  data-foco-inicial
                  required
                  minLength={3}
                  maxLength={300}
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                />
              </label>
            )}
            {operacao === "FECHAR" && caixa ? (
              <>
                <div className={styles.conferencia}>
                  <div />
                  <strong>Esperado</strong>
                  <strong>Em caixa</strong>
                  <strong>Diferença</strong>
                  <span>Dinheiro</span>
                  <span>{moedaCaixa(caixa.saldoEsperadoCentavos)}</span>
                  <label className={styles.dinheiro}>
                    <span>R$</span>
                    <input
                      aria-label="Dinheiro contado em caixa"
                      data-foco-inicial
                      inputMode="decimal"
                      placeholder="0,00"
                      required
                      value={valor}
                      onChange={(e) => setValor(e.target.value)}
                    />
                  </label>
                  <output
                    aria-live="polite"
                    className={
                      centavos !== null &&
                      centavos !== caixa.saldoEsperadoCentavos
                        ? styles.diferenca
                        : undefined
                    }
                  >
                    {centavos === null
                      ? "—"
                      : moedaCaixa(centavos - caixa.saldoEsperadoCentavos)}
                  </output>
                </div>
                <details className={styles.outrasFormas}>
                  <summary>Ver outras formas de pagamento</summary>
                  <dl>
                    {(Object.entries(formasCaixa) as [FormaCaixa, string][])
                      .filter(([f]) => f !== "DINHEIRO")
                      .map(([f, nome]) => (
                        <div key={f}>
                          <dt>{nome}</dt>
                          <dd>{moedaCaixa(caixa.resumo.pagamentos[f])}</dd>
                        </div>
                      ))}
                  </dl>
                </details>
                <p className={styles.apoio}>
                  Conte o dinheiro físico, incluindo o saldo inicial. Registre
                  uma sangria antes de fechar caso faça uma retirada.
                </p>
                <label className={styles.campo}>
                  <span className={styles.rotuloCampo}>Observações</span>
                  <textarea
                    maxLength={500}
                    rows={3}
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                  />
                </label>
              </>
            ) : (
              <label className={styles.campo}>
                <span className={styles.rotuloCampo}>
                  {operacao === "ABRIR" ? "Saldo inicial" : "Valor"}
                </span>
                <span className={styles.dinheiro}>
                  <span>R$</span>
                  <input
                    data-foco-inicial={operacao === "ABRIR" || undefined}
                    inputMode="decimal"
                    placeholder="0,00"
                    required
                    value={valor}
                    onChange={(e) => setValor(e.target.value)}
                  />
                </span>
                {operacao === "ABRIR" && (
                  <small>
                    Dinheiro disponível para troco no início do expediente.
                  </small>
                )}
              </label>
            )}
          </fieldset>
          {erro && (
            <p role="alert" className={styles.erro}>
              {erro}
            </p>
          )}
        </form>
      </ModalCaixa>
      <ModalCaixa
        aberto={verHistorico}
        titulo="Histórico de caixa"
        amplo
        aoFechar={() => setVerHistorico(false)}
        rodape={
          <div className={styles.paginacao}>
            <span>
              {historico.total
                ? `${(historico.pagina - 1) * historico.porPagina + 1}–${Math.min(historico.pagina * historico.porPagina, historico.total)}`
                : "0"}{" "}
              de {historico.total}
            </span>
            <button
              className={styles.botao}
              disabled={carregandoHistorico || historico.pagina <= 1}
              onClick={() => carregarHistorico(historico.pagina - 1)}
              aria-label="Página anterior"
            >
              ‹
            </button>
            <button
              className={styles.botao}
              disabled={
                carregandoHistorico ||
                historico.pagina * historico.porPagina >= historico.total
              }
              onClick={() => carregarHistorico(historico.pagina + 1)}
              aria-label="Próxima página"
            >
              ›
            </button>
          </div>
        }
      >
        {erroHistorico && (
          <p className={styles.erro} role="alert">
            {erroHistorico}{" "}
            <button onClick={() => carregarHistorico(historico.pagina)}>
              Tentar novamente
            </button>
          </p>
        )}
        {carregandoHistorico && (
          <p role="status" className={styles.semResumo}>
            Carregando caixas…
          </p>
        )}
        <div
          className={styles.historicoTabela}
          aria-busy={carregandoHistorico}
          hidden={carregandoHistorico}
        >
          <table className={styles.tabela}>
            <thead>
              <tr>
                <th>Sessão</th>
                <th>Aberto em</th>
                <th>Fechado em</th>
                <th>Saldo inicial</th>
                <th>Saldo final</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {historico.itens.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link
                      href={`/pdv/caixa?caixa=${c.id}`}
                      onClick={() => {
                        setVerHistorico(false);
                        setBusca("");
                        setForma("");
                        setTipo("");
                        setSucesso("");
                      }}
                      aria-label={`Consultar caixa ${codigoCaixa(c.id)}`}
                    >
                      {codigoCaixa(c.id)}
                    </Link>
                  </td>
                  <td>{dataCaixa(c.abertoEm)}</td>
                  <td>{c.fechadoEm ? dataCaixa(c.fechadoEm) : "—"}</td>
                  <td>{moedaCaixa(c.saldoInicialCentavos)}</td>
                  <td>
                    {c.valorContadoCentavos === null
                      ? "—"
                      : moedaCaixa(c.valorContadoCentavos)}
                  </td>
                  <td>
                    <span
                      className={styles.situacao}
                      data-fechado={!!c.fechadoEm}
                    >
                      {c.fechadoEm ? "Fechado" : "Aberto"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!historico.total && (
            <p className={styles.semResumo}>
              Nenhum caixa registrado nesta unidade.
            </p>
          )}
        </div>
      </ModalCaixa>
    </div>
  );
}
