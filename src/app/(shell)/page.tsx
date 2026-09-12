import Link from "next/link";
import { Suspense } from "react";

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
import { Indicador, IndicadorCarregando } from "@/design-system/indicador";
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

/**
 * O PAINEL DA OPERAÇÃO.
 *
 * Responde, sem abrir mais nenhuma tela: quanto tem em caixa, o que já venceu,
 * o que vence no período, e o que está pendente com quem.
 *
 * ---------------------------------------------------------------------------
 * O QUE ESTA TELA ERA, E POR QUE MUDOU.
 *
 * Era "Bom dia, Pablo ☀️" seguido de uma grade de ícones. A saudação ocupava o
 * topo sem informar nada, e a grade de módulos hoje mora na barra lateral, que
 * está em TODAS as telas. Sobrava, na primeira tela do sistema, zero trabalho.
 *
 * A regra que continua valendo, e que era o bom instinto da versão antiga: o
 * painel NUNCA vira o "App de tudo". Toda vez que alguém quiser somar mais um
 * número aqui, a resposta padrão é "isso mora no App X". Sem essa disciplina,
 * em um ano é um painel poluído que ninguém lê.
 *
 * O que ganhou o direito de estar aqui tem que passar em dois testes: é do DIA
 * (não do mês passado) e é ACIONÁVEL (dá para fazer algo hoje a respeito).
 * ---------------------------------------------------------------------------
 *
 * NÃO HÁ VENDAS AQUI, e a ausência é honesta: o Tetteo ainda não tem módulo de
 * pedidos de cliente — Delivery e Analytics estão em construção. Um painel com
 * "ticket médio" inventado seria mais bonito e valeria menos que nada.
 *
 * O cartão do ASSISTENTE PRIVADO passa nos dois testes sem trazer número de
 * venda: diz se o assistente da VPS está ligado, o que fez por último e o que
 * espera decisão. Os números do fechamento moram no relatório, não aqui.
 */

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
  searchParams: Promise<{ periodo?: string }>;
}) {
  const contexto = await obterContexto();
  if (!contexto) return null;

  const { periodo: bruto } = await searchParams;
  const periodo = lerPeriodo(bruto);

  const onde = contexto.unidadeAtiva
    ? contexto.unidadeAtiva.nome
    : `Rede completa — ${contexto.unidadesVisiveis.length} ${
        contexto.unidadesVisiveis.length === 1 ? "unidade" : "unidades"
      }`;

  return (
    <div className="mx-auto flex w-full max-w-[var(--width-data)] flex-col gap-4">
      <CabecalhoDePagina
        titulo="Painel da operação"
        contexto={`${dataPorExtenso.format(new Date())} · ${onde}`}
        controles={<FiltroDePeriodo atual={periodo} />}
      />

      {/* A chave força um esqueleto novo a cada troca de período: sem ela, o
          React reaproveitaria a árvore e a tela ficaria com os números velhos
          parados enquanto os novos vêm — o pior dos dois mundos, porque
          parece atualizado e não está. */}
      <Suspense key={periodo} fallback={<EsqueletoDoPainel />}>
        <CorpoDoPainel periodo={periodo} />
      </Suspense>
    </div>
  );
}

async function CorpoDoPainel({ periodo }: { periodo: Periodo }) {
  const contexto = await obterContexto();
  if (!contexto) return null;

  const podeFinanceiro = pode(contexto, "financeiro.ver");
  const podeChecklists = pode(contexto, "checklists.ver");
  const podeVerAssistente = pode(contexto, PERMISSAO_VER_ASSISTENTE_PRIVADO);

  // Caixa e checklists são de uma LOJA. Farinha na câmara fria de uma unidade
  // não vira pizza na outra, e o boleto vence num CNPJ só. Consolidar a rede
  // aqui produziria um número que não corresponde a nenhuma realidade.
  if (!contexto.unidadeAtiva) return <PrecisaDeUnidade contexto={contexto} />;

  if (!podeFinanceiro && !podeChecklists) {
    return <SemBlocosParaVer contexto={contexto} />;
  }

  const agora = new Date();
  const fimDoPeriodo = new Date(agora);
  fimDoPeriodo.setDate(fimDoPeriodo.getDate() + periodo - 1);
  fimDoPeriodo.setHours(23, 59, 59, 999);

  const [caixa, contas, pendencias, assistente] = await Promise.all([
    podeFinanceiro ? visaoDoCaixa(contexto, periodo) : null,
    podeFinanceiro ? listarLancamentos(contexto, { ate: fimDoPeriodo }) : [],
    podeChecklists ? listarPendencias(contexto) : [],
    podeVerAssistente ? cartaoDoAssistente(contexto) : null,
  ]);

  const numeros = numerosDoPainel(contas);
  const abertas = pendencias.filter((p) => p.status === "ABERTA");
  const atrasadas = abertas.filter((p) => p.atrasada).length;

  const indicadores = [
    podeFinanceiro && caixa ? (
      <Indicador
        key="caixa"
        rotulo="Saldo em caixa"
        valor={formatarMoeda(caixa.saldoAtual)}
        apoio={`Soma das ${caixa.contas.length} ${
          caixa.contas.length === 1 ? "conta ativa" : "contas ativas"
        } · hoje`}
      />
    ) : null,

    podeFinanceiro ? (
      <Indicador
        key="vencido"
        rotulo="Vencido a pagar"
        valor={formatarMoeda(numeros.vencidoAPagar)}
        tom={numeros.contasVencidas > 0 ? "critico" : "positivo"}
        apoio={
          numeros.contasVencidas > 0
            ? `${numeros.contasVencidas} ${
                numeros.contasVencidas === 1 ? "conta" : "contas"
              } fora do prazo · em aberto`
            : "Nenhuma conta fora do prazo"
        }
      />
    ) : null,

    podeFinanceiro ? (
      <Indicador
        key="a-pagar"
        rotulo="A pagar no período"
        valor={formatarMoeda(numeros.aPagarNoPeriodo)}
        apoio={`${numeros.contasAPagar} ${
          numeros.contasAPagar === 1 ? "conta" : "contas"
        } · vence até ${dataCurta.format(fimDoPeriodo)}`}
      />
    ) : null,

    podeChecklists ? (
      <Indicador
        key="pendencias"
        rotulo="Pendências abertas"
        valor={String(abertas.length)}
        tom={atrasadas > 0 ? "atencao" : "normal"}
        apoio={
          atrasadas > 0
            ? `${atrasadas} ${atrasadas === 1 ? "atrasada" : "atrasadas"} · dos checklists`
            : "Nenhuma atrasada · dos checklists"
        }
      />
    ) : null,
  ].filter(Boolean);

  const colunas =
    indicadores.length >= 4
      ? "sm:grid-cols-2 desk:grid-cols-4"
      : indicadores.length === 3
        ? "sm:grid-cols-3"
        : indicadores.length === 2
          ? "sm:grid-cols-2"
          : "";

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className={`grid min-w-0 grid-cols-1 gap-4 ${colunas}`}>
        {indicadores}
      </div>

      <div className="desk:grid-cols-3 grid min-w-0 grid-cols-1 gap-4">
        {podeFinanceiro && caixa && (
          <div className="desk:col-span-2 min-w-0">
            <GraficoDeCaixa
              projecao={caixa.projecao}
              saldoAtual={caixa.saldoAtual}
              periodoEmDias={periodo}
            />
          </div>
        )}

        {podeChecklists && (
          <div className={`min-w-0 ${podeFinanceiro ? "" : "desk:col-span-3"}`}>
            <Prioridades
              pendencias={abertas}
              totalAbertas={abertas.length}
              hoje={agora}
            />
          </div>
        )}
      </div>

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
    <div className="flex min-w-0 flex-col gap-4">
      <span className="sr-only" role="status">
        Carregando os números do painel.
      </span>

      <div className="desk:grid-cols-4 grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <IndicadorCarregando key={i} />
        ))}
      </div>

      <div className="desk:grid-cols-3 grid min-w-0 grid-cols-1 gap-4">
        <Cartao className="desk:col-span-2 min-w-0 p-4">
          <Esqueleto className="h-5 w-40" />
          <Esqueleto className="mt-4 h-[200px] w-full" arredondado="md" />
        </Cartao>
        <Cartao className="min-w-0 p-4">
          <Esqueleto className="h-5 w-28" />
          <div className="mt-4 flex flex-col gap-3">
            {[0, 1, 2, 3].map((i) => (
              <Esqueleto key={i} className="h-10 w-full" arredondado="md" />
            ))}
          </div>
        </Cartao>
      </div>

      <Cartao className="min-w-0 overflow-hidden">
        <div className="border-line border-b px-4 py-3">
          <Esqueleto className="h-5 w-44" />
        </div>
        <LinhasCarregando linhas={6} />
      </Cartao>
    </div>
  );
}
