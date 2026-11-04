import Link from "next/link";
import { obterContexto, pode } from "@/core/sessao/contexto";
import { Cartao } from "@/design-system/cartao";
import { Etiqueta } from "@/design-system/etiqueta";
import { Icone } from "@/design-system/icones";
import { formatarMoeda } from "@/lib/numero";
import { consultarResumoOperacao } from "@/modules/pdv/services/resumo-operacao";
import { AtualizacaoDasVendas } from "./vendas-atualizacao";

const ETAPAS = [
  { status: "COZINHA", nome: "Na cozinha", icone: "prato" },
  {
    status: "AGUARDANDO_COLETA",
    nome: "Prontos para coleta",
    icone: "lista-conferida",
  },
  { status: "SAIU_ENTREGA", nome: "Em entrega", icone: "entrega" },
] as const;
const dia = (valor: string) => valor.slice(5).split("-").reverse().join("/");
const link =
  "text-accent hover:bg-accent-sub inline-flex min-h-11 items-center gap-2 rounded-md px-2 text-sm font-semibold sm:min-h-9";

export async function VendasDaOperacao() {
  const contexto = await obterContexto();
  if (!contexto?.unidadeAtiva || !pode(contexto, "pdv.ver")) return null;
  let dados;
  try {
    dados = await consultarResumoOperacao(contexto);
  } catch {
    return (
      <Cartao
        como="section"
        className="flex flex-wrap items-center justify-between gap-4 p-5"
      >
        <div>
          <h2 className="font-semibold">Pedidos e faturamento</h2>
          <p role="status" className="text-ink-2 mt-1 text-sm">
            Não foi possível consultar o PDV. Tente atualizar a operação.
          </p>
        </div>
        <AtualizacaoDasVendas />
      </Cartao>
    );
  }

  const historico = `/pdv/vendas?de=${dados.de}&ate=${dados.hoje}`;
  const indicadores = [
    {
      titulo: "Faturamento PDV hoje",
      valor: formatarMoeda(dados.faturamentoHoje / 100),
      apoio: `${dados.vendasHoje} vendas concluídas no PDV`,
      href: `/pdv/vendas?de=${dados.hoje}&ate=${dados.hoje}&status=CONCLUIDA`,
      icone: "moeda",
    },
    {
      titulo: "Faturamento PDV em 7 dias",
      valor: formatarMoeda(dados.faturamentoSemana / 100),
      apoio: `${dia(dados.de)} a ${dia(dados.hoje)} · inclui hoje`,
      href: `${historico}&status=CONCLUIDA`,
      icone: "grafico",
    },
    {
      titulo: "Pedidos em 7 dias",
      valor: String(dados.pedidosSemana),
      apoio: "Registrados no PDV · sem cancelados",
      href: `/pdv/desempenho?de=${dados.de}&ate=${dados.hoje}`,
      icone: "lista-conferida",
    },
  ];

  return (
    <section
      aria-label="Pedidos e faturamento da operação"
      className="flex min-w-0 flex-col gap-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">
          Pedidos e faturamento
        </h2>
        <AtualizacaoDasVendas atualizadoEm={dados.atualizadoEm} />
      </div>

      <Cartao className="min-w-0 overflow-hidden">
        <div className="divide-line grid divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {indicadores.map((indicador) => (
            <Link
              key={indicador.titulo}
              href={indicador.href}
              className="group hover:bg-surface-2 flex min-w-0 flex-col gap-2 p-4 transition-colors sm:p-5"
            >
              <span className="text-ink-2 flex items-center gap-2 text-sm font-medium">
                <Icone nome={indicador.icone} tamanho={17} />
                {indicador.titulo}
              </span>
              <span className="text-ink text-2xl leading-8 font-semibold tracking-tight break-words tabular-nums">
                {indicador.valor}
              </span>
              <span className="text-ink-3 flex items-center justify-between gap-2 text-xs leading-5">
                {indicador.apoio}
                <span className="text-accent shrink-0">
                  <Icone nome="seta-direita" tamanho={16} />
                </span>
              </span>
            </Link>
          ))}
        </div>
        <div className="border-line bg-surface-2/50 flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 sm:px-5">
          <div className="flex items-center gap-2">
            <span className="bg-ok size-2 rounded-full" aria-hidden="true" />
            <h3 className="text-sm font-semibold">Pedidos ao vivo no PDV</h3>
            <span className="text-ink-2 text-sm tabular-nums">
              {dados.aoVivo} em andamento
            </span>
          </div>
          <Link href="/pdv" className={link}>
            Gerenciar pedidos <Icone nome="seta-direita" tamanho={16} />
          </Link>
        </div>
        <div className="grid min-w-0 lg:grid-cols-[1fr_1.4fr]">
          <div className="grid grid-cols-3 gap-2 px-4 py-4 sm:px-5">
            {ETAPAS.map((etapa) => (
              <div key={etapa.status} className="min-w-0">
                <span className="text-ink-3 mb-2 block">
                  <Icone nome={etapa.icone} tamanho={18} />
                </span>
                <p className="text-xl font-semibold tabular-nums">
                  {dados.etapas.find((e) => e.status === etapa.status)
                    ?.quantidade ?? 0}
                </p>
                <p className="text-ink-2 mt-1 text-xs leading-5">
                  {etapa.nome}
                </p>
              </div>
            ))}
          </div>
          {dados.recentes.length > 0 ? (
            <div className="border-line border-t px-4 py-4 lg:border-t-0 lg:border-l">
              <p className="text-ink-3 mb-2 text-xs">
                Há mais tempo em andamento
              </p>
              <ul className="flex flex-wrap gap-2">
                {dados.recentes.map((pedido) => (
                  <li key={pedido.id}>
                    <Link
                      href="/pdv"
                      className="border-line-2 hover:bg-surface-2 flex min-h-11 items-center gap-2 rounded-md border px-3 py-2 text-sm"
                    >
                      <span className="font-semibold tabular-nums">
                        #{pedido.numero}
                      </span>
                      <Etiqueta
                        tom={pedido.status === "COZINHA" ? "aviso" : "info"}
                      >
                        {ETAPAS.find((e) => e.status === pedido.status)?.nome}
                      </Etiqueta>
                      <span className="text-ink-3 text-xs tabular-nums">
                        {pedido.minutos} min
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="border-line flex items-center gap-3 border-t px-4 py-4 lg:border-t-0 lg:border-l">
              <span className="text-ok">
                <Icone nome="lista-conferida" tamanho={22} />
              </span>
              <div>
                <p className="text-sm font-medium">
                  Nenhum pedido em andamento
                </p>
                <p className="text-ink-3 mt-1 text-xs leading-5">
                  Pedidos recebidos no PDV aparecem aqui durante o preparo e a
                  entrega.
                </p>
              </div>
            </div>
          )}
        </div>
      </Cartao>
      <p className="text-ink-3 text-xs leading-5">
        Atualização a cada 30 s. Faturamento de vendas concluídas no PDV Tetteo,
        sem pendentes ou canceladas. Pedidos importados e vendas Saipos não
        entram neste faturamento; os pagamentos são consultados na origem.
        Horários de Brasília.
      </p>
    </section>
  );
}
