import Link from "next/link";
import { redirect } from "next/navigation";
import { superficiePublica } from "@/core/superficie";
import { Suspense } from "react";
import { PainelVendas } from "@/modules/analytics/components/painel-vendas";
import { diaDeslocado, horarioBrasilia } from "@/connectors/saipos/tempo";

import {
  obterContexto,
  pode,
  type ContextoSessao,
} from "@/core/sessao/contexto";
import { appsVisiveis } from "@/core/shell/apps-visiveis";
import { CabecalhoDePagina } from "@/design-system/cabecalho-de-pagina";
import { Cartao } from "@/design-system/cartao";
import { Esqueleto, LinhasCarregando } from "@/design-system/esqueleto";
import { Icone } from "@/design-system/icones";
import { IndicadorCarregando } from "@/design-system/indicador";
import { Vazio } from "@/design-system/vazio";
import { formatarMoeda } from "@/lib/numero";
import { CartaoDoAssistente } from "@/modules/assistente-privado/components/cartao-do-assistente";
import { PERMISSAO_VER_ASSISTENTE_PRIVADO } from "@/modules/assistente-privado/permissoes";
import { cartaoDoAssistente } from "@/modules/assistente-privado/services/registros";
import { listarPendencias } from "@/modules/checklists/services/pendencias";
import {
  listarLancamentos,
  visaoDoCaixa,
} from "@/modules/financeiro/services/lancamentos";

import { ContasDoPeriodo } from "./painel/contas-do-periodo";
import {
  FiltroDePeriodo,
  lerPeriodo,
  type Periodo,
} from "./painel/filtro-de-periodo";
import { GraficoDeCaixa } from "./painel/grafico-de-caixa";
import { numerosDoPainel } from "./painel/numeros";
import { Prioridades } from "./painel/prioridades";
import {
  ResumoFinanceiro,
  type IndicadorDeAcao,
} from "./painel/resumo-financeiro";
import { VendasDaOperacao } from "./painel/vendas-da-operacao";

/** Visão acionável do dia; cada módulo continua responsável por suas operações. */

const dataPorExtenso = new Intl.DateTimeFormat("pt-BR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "America/Sao_Paulo",
});

const dataCurta = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "America/Sao_Paulo",
});

export default async function PainelDaOperacao({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string; situacao?: string }>;
}) {
  const superficie = await superficiePublica();
  if (superficie.operacional && superficie.config)
    redirect(superficie.config.rotaAplicativo);
  const contexto = await obterContexto();
  if (!contexto) return null;

  const { periodo: bruto } = await searchParams;
  const periodo = lerPeriodo(bruto);

  const onde = contexto.unidadeAtiva
    ? contexto.unidadeAtiva.nome
    : `Rede completa — ${contexto.unidadesVisiveis.length} ${
        contexto.unidadesVisiveis.length === 1 ? "unidade" : "unidades"
      }`;

  const temVendas = pode(contexto, "pdv.ver");
  const temFinanceiro = pode(contexto, "financeiro.ver");
  const temPrioridades = pode(contexto, "checklists.ver");

  return (
    <div className="mx-auto flex w-full max-w-[var(--width-data)] flex-col gap-6">
      <CabecalhoDePagina
        titulo="Painel da operação"
        contexto={`${dataPorExtenso.format(new Date())} · ${onde}`}
      />
      {contexto.unidadeAtiva && (
        <nav
          aria-label="Áreas do painel"
          className="border-line flex flex-wrap items-center gap-2 border-b pb-4"
        >
          {temVendas && (
            <a
              href="#pedidos-e-vendas"
              className="border-line-2 bg-surface hover:bg-surface-2 focus-visible:outline-accent inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-3"
            >
              <Icone nome="prato" tamanho={16} />
              Pedidos e vendas
            </a>
          )}
          {temPrioridades && (
            <a
              href="#prioridades-do-dia"
              className="border-line-2 bg-surface hover:bg-surface-2 focus-visible:outline-accent inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-3"
            >
              <Icone nome="lista-conferida" tamanho={16} />
              Prioridades do dia
            </a>
          )}
          {temFinanceiro && (
            <a
              href="#contas-do-periodo"
              className="border-line-2 bg-surface hover:bg-surface-2 focus-visible:outline-accent inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-3"
            >
              <Icone nome="moeda" tamanho={16} />
              Contas e caixa
            </a>
          )}
          {pode(contexto, "analytics.ver") && (
            <a
              href="#vendas-saipos"
              className="border-line-2 bg-surface hover:bg-surface-2 focus-visible:outline-accent inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-3"
            >
              <Icone nome="grafico" tamanho={16} />
              Vendas Saipos
            </a>
          )}
        </nav>
      )}

      {contexto.unidadeAtiva && (temPrioridades || temVendas) && (
        <div
          className={`grid min-w-0 grid-cols-1 items-start gap-4 ${temPrioridades && temVendas ? "xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]" : ""}`}
        >
          {temPrioridades && (
            <div id="prioridades-do-dia" className="min-w-0 scroll-mt-20">
              <Suspense
                fallback={
                  <Cartao>
                    <LinhasCarregando linhas={4} />
                  </Cartao>
                }
              >
                <PrioridadesDoDia />
              </Suspense>
            </div>
          )}
          {temVendas && (
            <div id="pedidos-e-vendas" className="min-w-0 scroll-mt-20">
              <Suspense
                fallback={
                  <Cartao>
                    <LinhasCarregando linhas={3} />
                  </Cartao>
                }
              >
                <VendasDaOperacao />
              </Suspense>
            </div>
          )}
        </div>
      )}

      {pode(contexto, "analytics.ver") && (
        <section
          id="vendas-saipos"
          aria-labelledby="titulo-vendas-saipos"
          className="flex min-w-0 scroll-mt-20 flex-col gap-3"
        >
          <div>
            <h2 id="titulo-vendas-saipos" className="text-lg font-semibold">
              Vendas Saipos
            </h2>
            <p className="text-ink-3 mt-1 text-sm">
              Últimos 7 dias encerrados. A importação Saipos é separada dos
              pedidos ao vivo do PDV.
            </p>
          </div>
          <Suspense
            fallback={
              <Cartao>
                <LinhasCarregando linhas={3} />
              </Cartao>
            }
          >
            <PainelVendas
              de={diaDeslocado(horarioBrasilia().slice(0, 10), -7)}
              ate={diaDeslocado(horarioBrasilia().slice(0, 10), -1)}
              compacto
            />
          </Suspense>
        </section>
      )}

      <Suspense
        key={`${contexto.unidadeAtiva?.id ?? "rede"}-${periodo}`}
        fallback={<EsqueletoDoPainel />}
      >
        <CorpoDoPainel periodo={periodo} />
      </Suspense>
    </div>
  );
}

async function PrioridadesDoDia() {
  const contexto = await obterContexto();
  if (!contexto?.unidadeAtiva || !pode(contexto, "checklists.ver")) return null;
  const pendencias = await listarPendencias(contexto);
  const abertas = pendencias.filter((p) => p.status === "ABERTA");
  return (
    <Prioridades
      pendencias={abertas}
      totalAbertas={abertas.length}
      hoje={new Date()}
    />
  );
}

async function CorpoDoPainel({ periodo }: { periodo: Periodo }) {
  const contexto = await obterContexto();
  if (!contexto) return null;

  const podeFinanceiro = pode(contexto, "financeiro.ver");
  const podeVerAssistente = pode(contexto, PERMISSAO_VER_ASSISTENTE_PRIVADO);

  // Caixa e checklists são de uma LOJA. Farinha na câmara fria de uma unidade
  // não vira pizza na outra, e o boleto vence num CNPJ só. Consolidar a rede
  // aqui produziria um número que não corresponde a nenhuma realidade.
  if (!contexto.unidadeAtiva) return <PrecisaDeUnidade contexto={contexto} />;

  if (!podeFinanceiro && !podeVerAssistente) {
    return pode(contexto, "checklists.ver") ||
      pode(contexto, "pdv.ver") ||
      pode(contexto, "analytics.ver") ? null : (
      <SemBlocosParaVer contexto={contexto} />
    );
  }

  const agora = new Date();
  const fimDoPeriodo = new Date(
    `${diaDeslocado(horarioBrasilia(agora).slice(0, 10), periodo - 1)}T23:59:59.999-03:00`,
  );

  const [caixa, contas, assistente] = await Promise.all([
    podeFinanceiro && contexto.ehDiretor
      ? visaoDoCaixa(contexto, periodo)
      : null,
    podeFinanceiro ? listarLancamentos(contexto, { ate: fimDoPeriodo }) : [],
    podeVerAssistente ? cartaoDoAssistente(contexto) : null,
  ]);

  const numeros = numerosDoPainel(contas);

  const base = `/?periodo=${periodo}`;
  const indicadores: IndicadorDeAcao[] = [];
  if (podeFinanceiro && caixa)
    indicadores.push({
      rotulo: "Saldo em caixa",
      valor: formatarMoeda(caixa.saldoAtual),
      apoio:
        caixa.saldoSemConta !== 0
          ? "Inclui baixas sem conta vinculada · hoje"
          : `${caixa.contas.length} contas cadastradas · hoje`,
      icone: "moeda",
      href: "/financeiro/contas",
      acao: "Consultar contas",
    });
  if (podeFinanceiro)
    indicadores.push(
      {
        rotulo: "Vencido a pagar",
        valor: formatarMoeda(numeros.vencidoAPagar),
        apoio: `${numeros.contasVencidas} contas abertas fora do prazo`,
        icone: "alerta",
        tom: numeros.contasVencidas ? "critico" : "positivo",
        href: `${base}&situacao=pagar-vencidas#contas-do-periodo`,
        acao: "Conferir vencidas",
      },
      {
        rotulo: "A pagar no período",
        valor: formatarMoeda(numeros.aPagarNoPeriodo),
        apoio: `${numeros.contasAPagar} contas a vencer até ${dataCurta.format(fimDoPeriodo)}`,
        icone: "relogio",
        href: `${base}&situacao=pagar-a-vencer#contas-do-periodo`,
        acao: "Planejar pagamentos",
      },
    );

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {podeFinanceiro && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Planeje os próximos dias</h2>
            <p className="text-ink-3 mt-1 text-sm">
              O período abaixo filtra contas e projeção de caixa.
            </p>
          </div>
          <FiltroDePeriodo atual={periodo} />
        </div>
      )}
      {indicadores.length > 0 && <ResumoFinanceiro indicadores={indicadores} />}
      {contas.length >= 300 && (
        <p className="text-warn text-xs">
          Os indicadores financeiros consideram as 300 contas exibidas. Confira
          a visão completa no Financeiro.
        </p>
      )}

      {podeFinanceiro && caixa && (
        <GraficoDeCaixa
          projecao={caixa.projecao}
          saldoAtual={caixa.saldoAtual}
          periodoEmDias={periodo}
        />
      )}

      {assistente && <CartaoDoAssistente cartao={assistente} />}

      {podeFinanceiro && (
        <ContasDoPeriodo
          contas={contas}
          fimDoPeriodo={fimDoPeriodo}
          podeLancar={pode(contexto, "financeiro.lancar")}
        />
      )}
    </div>
  );
}

/**
 * O painel visto da rede inteira.
 *
 * Não é um erro nem uma tela vazia: é uma escolha que ainda não foi feita.
 * Por isso ele diz ONDE fica o seletor, em vez de só informar que falta algo.
 */
function PrecisaDeUnidade({ contexto }: { contexto: ContextoSessao }) {
  return (
    <Cartao>
      <Vazio
        icone="casa"
        titulo="Escolha uma unidade para ver o painel"
        explicacao={
          <>
            Caixa, contas e checklists são de uma loja: o boleto vence num CNPJ
            e a coifa suja fica num endereço. Somar{" "}
            {contexto.unidadesVisiveis.length} unidades aqui daria um número que
            não corresponde a nenhuma delas. Use o seletor no alto do menu à
            esquerda.
          </>
        }
      />
    </Cartao>
  );
}

/**
 * Quem não enxerga nem o Financeiro nem os Checklists.
 *
 * O painel não tem o que mostrar — mas a pessoa tem para onde ir, e é isso que
 * a tela oferece. Uma tela vazia aqui deixaria alguém parado na porta do
 * sistema sem nenhuma pista do que fazer.
 */
function SemBlocosParaVer({ contexto }: { contexto: ContextoSessao }) {
  const apps = appsVisiveis(contexto).filter((a) => !a.emConstrucao);

  return (
    <Cartao className="p-4">
      <h2 className="text-[15px] leading-6 font-semibold">Seus módulos</h2>
      <p className="text-ink-3 mt-1 text-sm leading-5">
        O painel mostra caixa e pendências, e seu perfil não inclui nenhum dos
        dois. Estes são os módulos a que você tem acesso.
      </p>

      <ul className="desk:grid-cols-3 mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {apps.map((app) => (
          <li key={app.chave}>
            <Link
              href={app.rota}
              className="border-line hover:border-line-2 hover:bg-surface-2 focus-visible:outline-accent flex items-center gap-3 rounded-md border p-3 transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-3"
            >
              <span
                aria-hidden="true"
                className="grid size-9 flex-none place-items-center rounded-xl"
                style={{ background: app.cor.fundo, color: app.cor.frente }}
              >
                <Icone nome={app.icone} tamanho={18} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm leading-5 font-semibold">
                  {app.nome}
                </span>
                <span className="text-ink-3 block truncate text-xs leading-4">
                  {app.subtitulo}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Cartao>
  );
}

/** Do tamanho aproximado do que vem — a tela não pula quando o dado chega. */
function EsqueletoDoPainel() {
  return (
    <div
      aria-busy="true"
      aria-label="Carregando planejamento financeiro"
      className="flex min-w-0 flex-col gap-4"
    >
      <Esqueleto className="h-8 w-64" />
      <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <IndicadorCarregando key={i} />
        ))}
      </div>
      <Cartao className="min-w-0 p-4">
        <Esqueleto className="h-5 w-40" />
        <Esqueleto className="mt-4 h-64 w-full" arredondado="md" />
        <Esqueleto className="mt-4 h-20 w-full" arredondado="md" />
      </Cartao>
      <Cartao className="min-w-0 overflow-hidden">
        <div className="border-line border-b px-4 py-3">
          <Esqueleto className="h-5 w-44" />
        </div>
        <LinhasCarregando linhas={6} />
      </Cartao>
    </div>
  );
}
