"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useRef, useState } from "react";

import { BarraDeFiltros } from "@/design-system/barra-de-filtros";
import { Botao, estiloDeBotao } from "@/design-system/botao";
import { Cartao, TituloDeSecao } from "@/design-system/cartao";
import { Etiqueta } from "@/design-system/etiqueta";
import { Icone } from "@/design-system/icones";
import { LinhaDeDetalhe, PainelLateral } from "@/design-system/painel-lateral";
import { Tabela, type Coluna } from "@/design-system/tabela";
import { Vazio } from "@/design-system/vazio";
import { formatarMoeda } from "@/lib/numero";
import { caiNaSituacao, lerSituacao, type Situacao } from "./filtros-contas";

/**
 * AS CONTAS DO PERÍODO.
 *
 * A lista de trabalho do painel: o que vence, o que venceu e o que já foi
 * pago, dentro do período escolhido lá em cima.
 *
 * ---------------------------------------------------------------------------
 * ONDE CADA FILTRO MORA — e por quê.
 *
 * PERÍODO fica no ENDEREÇO (`?periodo=30`). Ele muda o CONJUNTO de dados: o
 * servidor precisa buscar outras contas, e os indicadores e o gráfico têm que
 * mudar junto. Estando na URL, os três se atualizam de uma vez, o botão
 * Voltar funciona, e o link colado no WhatsApp abre a mesma tela.
 *
 * BUSCA é local; SITUAÇÃO acompanha a URL com a History API. Ambas filtram
 * somente os dados já carregados, sem nova consulta a cada alteração. A URL
 * permite que um indicador reaplique seu filtro, mesmo depois de mudanças
 * locais, e mantém a seleção coerente durante atualizações do painel.
 *
 * O detalhe também é local. Por isso voltar dele devolve a lista exatamente
 * como estava: mesma busca, mesmo filtro, mesma posição de rolagem. Não houve
 * navegação para desfazer.
 * ---------------------------------------------------------------------------
 */

export type ContaNoPainel = {
  id: string;
  direcao: "PAGAR" | "RECEBER";
  status: "ABERTO" | "QUITADO" | "CANCELADO";
  descricao: string;
  valor: number;
  vencimento: Date;
  quitadoEm: Date | null;
  valorQuitado: number | null;
  categoria: { id: string; nome: string } | null;
  fornecedor: { id: string; nome: string } | null;
  conta: { id: string; nome: string } | null;
  parcela: number | null;
  totalParcelas: number | null;
  daNota: boolean;
  atrasado: boolean;
};

const dataCurta = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
  timeZone: "America/Sao_Paulo",
});

const dataLonga = new Intl.DateTimeFormat("pt-BR", {
  weekday: "long",
  day: "2-digit",
  month: "long",
  year: "numeric",
  timeZone: "America/Sao_Paulo",
});

const dataDoArquivo = new Intl.DateTimeFormat("sv-SE", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "America/Sao_Paulo",
});

function normalizar(texto: string) {
  return texto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

export function ContasDoPeriodo({
  contas,
  fimDoPeriodo,
  podeLancar,
}: {
  contas: ContaNoPainel[];
  fimDoPeriodo: Date;
  /** Quem não pode lançar não vê o convite para lançar — ele não funcionaria. */
  podeLancar: boolean;
}) {
  const [busca, setBusca] = useState("");
  const parametros = useSearchParams();
  const situacao = lerSituacao(parametros.get("situacao") ?? undefined);
  const [abertaId, setAbertaId] = useState<string | null>(null);
  const aberta = contas.find((conta) => conta.id === abertaId) ?? null;
  const [exportando, setExportando] = useState(false);
  const ancora = useRef<HTMLAnchorElement>(null);

  const contagens = useMemo(
    () => ({
      todas: contas.length,
      vencidas: contas.filter((c) => c.atrasado).length,
      abertas: contas.filter((c) => c.status === "ABERTO").length,
      quitadas: contas.filter((c) => c.status === "QUITADO").length,
      pagarVencidas: contas.filter((c) => caiNaSituacao(c, "pagar-vencidas"))
        .length,
      pagarAVencer: contas.filter((c) => caiNaSituacao(c, "pagar-a-vencer"))
        .length,
    }),
    [contas],
  );

  const filtradas = useMemo(() => {
    const termo = normalizar(busca);

    return contas.filter((conta) => {
      if (!caiNaSituacao(conta, situacao)) return false;
      if (!termo) return true;

      const procuravel = normalizar(
        [
          conta.descricao,
          conta.fornecedor?.nome ?? "",
          conta.categoria?.nome ?? "",
          conta.conta?.nome ?? "",
        ].join(" "),
      );
      return procuravel.includes(termo);
    });
  }, [contas, busca, situacao]);

  const temFiltro = busca.trim() !== "" || situacao !== "todas";

  function setSituacao(nova: Situacao) {
    const url = new URL(window.location.href);
    if (nova === "todas") url.searchParams.delete("situacao");
    else url.searchParams.set("situacao", nova);
    window.history.replaceState(
      null,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  }

  function limpar() {
    setBusca("");
    setSituacao("todas");
  }

  /**
   * A exportação leva EXATAMENTE o que está na tela — os mesmos filtros, as
   * mesmas linhas. Um arquivo que traz mais do que a lista mostrava é a forma
   * mais silenciosa de vazar dado: a pessoa filtrou uma unidade, exportou, e
   * mandou por e-mail o que achava ser só aquilo.
   *
   * Ponto e vírgula e BOM porque quem abre isto abre no Excel em português, e
   * o Excel em português lê vírgula como decimal, não como separador.
   */
  function exportar() {
    if (exportando) return;
    setExportando(true);

    try {
      const cabecalho = [
        "Descrição",
        "Tipo",
        "Situação",
        "Vencimento",
        "Valor",
        "Fornecedor",
        "Categoria",
      ];

      const celula = (valor: string) => `"${valor.replace(/"/g, '""')}"`;

      const linhas = filtradas.map((c) =>
        [
          c.descricao,
          c.direcao === "PAGAR" ? "A pagar" : "A receber",
          c.status === "QUITADO"
            ? "Quitada"
            : c.atrasado
              ? "Vencida"
              : "Em aberto",
          dataCurta.format(c.vencimento),
          c.valor.toFixed(2).replace(".", ","),
          c.fornecedor?.nome ?? "",
          c.categoria?.nome ?? "",
        ]
          .map(celula)
          .join(";"),
      );

      const csv = `﻿${[cabecalho.map(celula).join(";"), ...linhas].join("\r\n")}`;
      const url = URL.createObjectURL(
        new Blob([csv], { type: "text/csv;charset=utf-8;" }),
      );

      const link = ancora.current;
      if (link) {
        link.href = url;
        link.download = `contas-ate-${dataDoArquivo.format(fimDoPeriodo)}.csv`;
        link.click();
      }

      // Devolve a memória do Blob depois que o navegador pegou o arquivo.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } finally {
      setExportando(false);
    }
  }

  const colunas: Coluna<ContaNoPainel>[] = [
    {
      chave: "descricao",
      titulo: "Conta",
      principal: true,
      celula: (c) => (
        <span className="block">
          <span className="block truncate">{c.descricao}</span>
          {c.parcela && c.totalParcelas ? (
            <span className="text-ink-3 block text-xs leading-4 font-normal">
              Parcela {c.parcela} de {c.totalParcelas}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      chave: "tipo",
      titulo: "Tipo",
      celula: (c) => (
        <Etiqueta tom={c.direcao === "PAGAR" ? "neutro" : "info"}>
          {c.direcao === "PAGAR" ? "A pagar" : "A receber"}
        </Etiqueta>
      ),
    },
    {
      chave: "situacao",
      titulo: "Situação",
      celula: (c) =>
        c.status === "QUITADO" ? (
          <Etiqueta tom="ok">Quitada</Etiqueta>
        ) : c.atrasado ? (
          <Etiqueta tom="ruim">Vencida</Etiqueta>
        ) : (
          <Etiqueta tom="aviso">Em aberto</Etiqueta>
        ),
    },
    {
      chave: "vencimento",
      titulo: "Vencimento",
      numerica: true,
      celula: (c) => dataCurta.format(c.vencimento),
    },
    {
      chave: "valor",
      titulo: "Valor",
      numerica: true,
      celula: (c) => (
        <span className={c.direcao === "PAGAR" ? "" : "text-ok"}>
          {formatarMoeda(c.valor)}
        </span>
      ),
    },
  ];

  return (
    <div id="contas-do-periodo" className="scroll-mt-20">
      <Cartao como="section" className="min-w-0 overflow-hidden">
        <TituloDeSecao
          apoio={`Contas com vencimento até ${dataLonga.format(fimDoPeriodo)}. Selecione uma linha para ver o detalhe.`}
          acao={
            <Botao
              peso="secundario"
              tamanho="pequeno"
              onClick={exportar}
              disabled={filtradas.length === 0}
              carregando={exportando}
            >
              <Icone nome="baixar" tamanho={15} />
              Exportar
            </Botao>
          }
        >
          Contas do período
        </TituloDeSecao>

        {/* O `<a>` que recebe o arquivo. Escondido porque quem comanda é o
          botão acima — mas é um link de verdade, e é ele que baixa. */}
        <a ref={ancora} className="hidden" aria-hidden="true" tabIndex={-1} />

        {contas.length === 0 ? (
          <Vazio
            icone="moeda"
            titulo="Nenhuma conta neste período"
            explicacao={
              podeLancar
                ? "Não há contas a pagar nem a receber vencendo até o fim do período escolhido. Aumente o período ou lance uma conta no Financeiro."
                : "Não há contas a pagar nem a receber vencendo até o fim do período escolhido. Experimente aumentar o período."
            }
            acao={
              podeLancar ? (
                <Link
                  href="/financeiro/pagar"
                  className={estiloDeBotao("secundario", "pequeno")}
                >
                  Abrir contas a pagar
                </Link>
              ) : undefined
            }
          />
        ) : (
          <>
            <BarraDeFiltros
              busca={busca}
              aoBuscar={setBusca}
              rotuloBusca="Buscar por descrição, fornecedor ou categoria"
              nomeDoGrupo="Situação da conta"
              opcoes={[
                { valor: "todas", rotulo: "Todas", contagem: contagens.todas },
                ...(situacao === "pagar-vencidas"
                  ? [
                      {
                        valor: "pagar-vencidas",
                        rotulo: "A pagar vencidas",
                        contagem: contagens.pagarVencidas,
                      },
                    ]
                  : []),
                ...(situacao === "pagar-a-vencer"
                  ? [
                      {
                        valor: "pagar-a-vencer",
                        rotulo: "A pagar a vencer",
                        contagem: contagens.pagarAVencer,
                      },
                    ]
                  : []),
                {
                  valor: "vencidas",
                  rotulo: "Vencidas",
                  contagem: contagens.vencidas,
                },
                {
                  valor: "abertas",
                  rotulo: "Em aberto",
                  contagem: contagens.abertas,
                },
                {
                  valor: "quitadas",
                  rotulo: "Quitadas",
                  contagem: contagens.quitadas,
                },
              ]}
              selecionado={situacao}
              aoSelecionar={(v) => setSituacao(v as Situacao)}
              aoLimpar={temFiltro ? limpar : undefined}
              resumo={`${filtradas.length} de ${contas.length} ${
                contas.length === 1 ? "conta" : "contas"
              }`}
            />

            <p
              aria-live="polite"
              className="border-line text-ink-2 flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3 text-sm"
            >
              <span>
                {filtradas.length}{" "}
                {filtradas.length === 1
                  ? "conta encontrada"
                  : "contas encontradas"}
              </span>
              <span className="flex flex-wrap gap-x-4 gap-y-1">
                <span>
                  A pagar:{" "}
                  <strong className="text-ink font-semibold tabular-nums">
                    {formatarMoeda(
                      filtradas
                        .filter((c) => c.direcao === "PAGAR")
                        .reduce((total, c) => total + c.valor, 0),
                    )}
                  </strong>
                </span>
                <span>
                  A receber:{" "}
                  <strong className="text-ok font-semibold tabular-nums">
                    {formatarMoeda(
                      filtradas
                        .filter((c) => c.direcao === "RECEBER")
                        .reduce((total, c) => total + c.valor, 0),
                    )}
                  </strong>
                </span>
              </span>
            </p>
            <Tabela
              legenda="Contas a pagar e a receber do período"
              colunas={colunas}
              linhas={filtradas}
              chaveDaLinha={(c) => c.id}
              linhaAtiva={aberta?.id ?? null}
              aoAbrir={(conta) => setAbertaId(conta.id)}
              rotuloAbrir={(c) => `Ver detalhe de ${c.descricao}`}
              vazio={
                <Vazio
                  icone="lupa"
                  titulo="Nenhuma conta com esses filtros"
                  explicacao={
                    busca.trim()
                      ? `Nada encontrado para “${busca.trim()}” na situação escolhida. Sua busca continua aqui — limpe os filtros para ver as ${contas.length} contas do período.`
                      : `Nenhuma conta nessa situação. Limpe os filtros para ver as ${contas.length} contas do período.`
                  }
                  acao={
                    <Botao peso="secundario" tamanho="pequeno" onClick={limpar}>
                      Limpar filtros
                    </Botao>
                  }
                />
              }
            />
          </>
        )}

        {contas.length >= 300 && (
          <p className="border-line text-warn border-t px-4 py-3 text-xs">
            O painel exibe até 300 contas. Consulte o Financeiro para conferir
            todos os lançamentos.
          </p>
        )}

        <PainelLateral
          aberto={aberta !== null}
          aoFechar={() => setAbertaId(null)}
          titulo={aberta?.descricao ?? ""}
          apoio={
            aberta
              ? `${aberta.direcao === "PAGAR" ? "Conta a pagar" : "Conta a receber"} · vence ${dataLonga.format(aberta.vencimento)}`
              : undefined
          }
          rodape={
            aberta ? (
              <Link
                href={`/financeiro/lancamentos/${aberta.id}`}
                className={estiloDeBotao("secundario", "pequeno")}
              >
                Abrir no Financeiro
              </Link>
            ) : undefined
          }
        >
          {aberta && (
            <>
              <h3 className="text-ink-3 text-xs leading-[18px] font-semibold">
                O lançamento
              </h3>
              <dl className="mt-1">
                <LinhaDeDetalhe rotulo="Valor">
                  <span className="font-semibold tabular-nums">
                    {formatarMoeda(aberta.valor)}
                  </span>
                </LinhaDeDetalhe>
                <LinhaDeDetalhe rotulo="Situação">
                  {aberta.status === "QUITADO" ? (
                    <Etiqueta tom="ok">Quitada</Etiqueta>
                  ) : aberta.atrasado ? (
                    <Etiqueta tom="ruim">Vencida</Etiqueta>
                  ) : (
                    <Etiqueta tom="aviso">Em aberto</Etiqueta>
                  )}
                </LinhaDeDetalhe>
                <LinhaDeDetalhe rotulo="Vencimento">
                  <span className="tabular-nums">
                    {dataLonga.format(aberta.vencimento)}
                  </span>
                </LinhaDeDetalhe>
                {aberta.parcela && aberta.totalParcelas ? (
                  <LinhaDeDetalhe rotulo="Parcela">
                    {aberta.parcela} de {aberta.totalParcelas}
                  </LinhaDeDetalhe>
                ) : null}
              </dl>

              <h3 className="text-ink-3 mt-5 text-xs leading-[18px] font-semibold">
                De onde veio
              </h3>
              <dl className="mt-1">
                <LinhaDeDetalhe rotulo="Fornecedor">
                  {aberta.fornecedor?.nome ?? (
                    <span className="text-ink-3">não informado</span>
                  )}
                </LinhaDeDetalhe>
                <LinhaDeDetalhe rotulo="Categoria">
                  {aberta.categoria?.nome ?? (
                    <span className="text-ink-3">sem categoria</span>
                  )}
                </LinhaDeDetalhe>
                <LinhaDeDetalhe rotulo="Conta">
                  {aberta.conta?.nome ?? (
                    <span className="text-ink-3">não vinculada</span>
                  )}
                </LinhaDeDetalhe>
                <LinhaDeDetalhe rotulo="Origem">
                  {aberta.daNota
                    ? "Gerada por uma nota de entrada do Estoque"
                    : "Lançada à mão no Financeiro"}
                </LinhaDeDetalhe>
              </dl>

              <h3 className="text-ink-3 mt-5 text-xs leading-[18px] font-semibold">
                Histórico
              </h3>
              <dl className="mt-1">
                {aberta.quitadoEm ? (
                  <>
                    <LinhaDeDetalhe rotulo="Quitada em">
                      <span className="tabular-nums">
                        {dataLonga.format(aberta.quitadoEm)}
                      </span>
                    </LinhaDeDetalhe>
                    <LinhaDeDetalhe rotulo="Valor pago">
                      <span className="tabular-nums">
                        {aberta.valorQuitado === null
                          ? "—"
                          : formatarMoeda(aberta.valorQuitado)}
                      </span>
                    </LinhaDeDetalhe>
                  </>
                ) : (
                  <LinhaDeDetalhe rotulo="Quitação">
                    <span className="text-ink-3">ainda não foi quitada</span>
                  </LinhaDeDetalhe>
                )}
              </dl>

              <p className="text-ink-3 mt-5 text-xs leading-[18px]">
                Para quitar, estornar ou cancelar esta conta, abra o Financeiro.
                O painel é só de leitura — mexer no dinheiro acontece onde ficam
                as travas e o histórico de quem mexeu.
              </p>
            </>
          )}
        </PainelLateral>
      </Cartao>
    </div>
  );
}
