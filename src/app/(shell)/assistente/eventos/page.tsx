import { redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { CabecalhoDePagina } from "@/design-system/cabecalho-de-pagina";
import { Cartao } from "@/design-system/cartao";
import { Indicador } from "@/design-system/indicador";
import { FiltroPorLink } from "@/modules/assistente/components/filtro-por-link";
import { ListaDeEventos } from "@/modules/assistente/components/lista-de-eventos";
import {
  contarEventos,
  listarEventos,
  type FiltroDeEventos,
} from "@/modules/assistente/services/eventos";

/**
 * A TELA "EVENTOS" — o painel de saúde da integração.
 *
 * Os dois filtros moram no ENDEREÇO porque mudam o conjunto que o servidor
 * busca: voltar funciona, e o link colado abre a mesma visão.
 *
 * Aqui não há conteúdo pessoal para mostrar, porque não há conteúdo pessoal
 * guardado: o resumo de cada evento é uma lista fechada de campos técnicos.
 */

const PERIODOS = {
  "24h": { rotulo: "24 horas", ms: 24 * 60 * 60_000 },
  "7d": { rotulo: "7 dias", ms: 7 * 24 * 60 * 60_000 },
  "30d": { rotulo: "30 dias", ms: 30 * 24 * 60 * 60_000 },
} as const;
type Periodo = keyof typeof PERIODOS;

const TIPOS: { valor: FiltroDeEventos; rotulo: string }[] = [
  { valor: "todos", rotulo: "Todos" },
  { valor: "ignorados", rotulo: "Ignorados" },
  { valor: "duplicados", rotulo: "Duplicados" },
  { valor: "falhas", rotulo: "Falhas" },
];

function ehPeriodo(valor: string | undefined): valor is Periodo {
  return valor !== undefined && valor in PERIODOS;
}

function ehTipo(valor: string | undefined): valor is FiltroDeEventos {
  return TIPOS.some((t) => t.valor === valor);
}

export default async function PaginaEventos({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string; tipo?: string }>;
}) {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");
  if (!pode(contexto, "assistente.ver")) redirect("/assistente");

  const { periodo: periodoPedido, tipo: tipoPedido } = await searchParams;
  const periodo: Periodo = ehPeriodo(periodoPedido) ? periodoPedido : "24h";
  const tipo: FiltroDeEventos = ehTipo(tipoPedido) ? tipoPedido : "todos";

  const agora = new Date();
  const desde = new Date(agora.getTime() - PERIODOS[periodo].ms);
  const anteriorDesde = new Date(desde.getTime() - PERIODOS[periodo].ms);

  const [contagem, anterior, eventos] = await Promise.all([
    contarEventos(contexto, desde),
    contarEventos(contexto, anteriorDesde, desde),
    listarEventos(contexto, { desde, tipo }),
  ]);

  const href = (p: Periodo, t: FiltroDeEventos) =>
    `/assistente/eventos?periodo=${p}&tipo=${t}`;
  const apoio = `últimas ${PERIODOS[periodo].rotulo} · o que a Evolution contou`;
  const comparar = (n: number) => `${n} no período anterior`;

  return (
    <div className="mx-auto w-full max-w-5xl">
      <CabecalhoDePagina
        titulo="Eventos"
        contexto="O que a Evolution contou ao Tetteo — e o que ele fez com cada aviso"
        controles={
          <FiltroPorLink
            nome="Período dos eventos"
            selecionado={periodo}
            opcoes={(Object.keys(PERIODOS) as Periodo[]).map((p) => ({
              valor: p,
              rotulo: PERIODOS[p].rotulo,
              href: href(p, tipo),
            }))}
          />
        }
      />

      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicador
          rotulo="Recebidos"
          valor={String(contagem.recebidos)}
          apoio={apoio}
          comparacao={comparar(anterior.recebidos)}
        />
        <Indicador
          rotulo="Ignorados"
          valor={String(contagem.ignorados)}
          apoio="mensagem própria, grupo, não autorizado, fora do Tetteo"
          comparacao={comparar(anterior.ignorados)}
        />
        <Indicador
          rotulo="Duplicados"
          valor={String(contagem.duplicados)}
          apoio="a Evolution reenviou; o trabalho não se repetiu"
          comparacao={comparar(anterior.duplicados)}
        />
        <Indicador
          rotulo="Falhas"
          valor={String(contagem.falhas)}
          apoio="o Tetteo não conseguiu processar"
          comparacao={comparar(anterior.falhas)}
          tom={contagem.falhas > 0 ? "critico" : "normal"}
        />
      </div>

      <Cartao className="mt-4" como="section">
        <div className="border-line flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          <h2 className="text-[15px] leading-6 font-semibold">
            Lista{" "}
            <span className="text-ink-3 font-normal">({eventos.length})</span>
          </h2>
          <FiltroPorLink
            nome="Tipo de evento"
            selecionado={tipo}
            opcoes={TIPOS.map((t) => ({
              valor: t.valor,
              rotulo: t.rotulo,
              href: href(periodo, t.valor),
            }))}
          />
        </div>
        <ListaDeEventos eventos={eventos} />
      </Cartao>
    </div>
  );
}
