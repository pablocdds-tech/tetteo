import Link from "next/link";
import { obterContexto, pode } from "@/core/sessao/contexto";
import { Cartao } from "@/design-system/cartao";
import { Etiqueta } from "@/design-system/etiqueta";
import { Icone } from "@/design-system/icones";
import { formatarMoeda } from "@/lib/numero";
import { consultarOperacaoSaiposHoje } from "@/modules/analytics/services/operacao-hoje";

const dataHora = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZone: "America/Sao_Paulo",
});
const diaBrasilia = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "America/Sao_Paulo",
});

export async function SaiposHoje() {
  const contexto = await obterContexto();
  if (!contexto?.unidadeAtiva || !pode(contexto, "analytics.ver")) return null;

  let dados;
  try {
    dados = await consultarOperacaoSaiposHoje(contexto);
  } catch {
    return (
      <Cartao className="p-5">
        <h3 className="font-semibold">Saipos hoje</h3>
        <p role="status" className="text-ink-2 mt-2 text-sm">
          Não foi possível consultar as vendas importadas. Use Atualizar tela
          para tentar novamente.
        </p>
      </Cartao>
    );
  }

  const href = `/analytics/vendas?de=${dados.hoje}&ate=${dados.hoje}`;
  const vinculo = dados.vinculo;
  const temDadosHoje =
    dados.recentes.length > 0 ||
    (vinculo?.ultimoSucessoEm &&
      diaBrasilia.format(new Date(vinculo.ultimoSucessoEm)) === dados.hoje);
  const aguardando =
    vinculo?.solicitadaEm &&
    (!vinculo.ultimaTentativaEm ||
      vinculo.solicitadaEm > vinculo.ultimaTentativaEm);

  return (
    <section
      aria-label="Pedidos e faturamento importados da Saipos hoje"
      className="flex min-w-0 flex-col gap-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Saipos hoje</h3>
        <Etiqueta tom="aviso">Parcial · pode atrasar até D+1</Etiqueta>
      </div>
      <Cartao className="min-w-0 overflow-hidden">
        {!vinculo ? (
          <div className="p-5">
            <p className="text-sm font-medium">
              Saipos não conectado nesta unidade
            </p>
            <p className="text-ink-3 mt-1 text-sm">
              Os pedidos e o faturamento aparecerão após configurar a integração
              da unidade selecionada.
            </p>
          </div>
        ) : (
          <>
            <div className="divide-line grid divide-y sm:grid-cols-2 sm:divide-x sm:divide-y-0">
              <div className="flex min-w-0 flex-col gap-2 p-4 sm:p-5">
                <p className="text-ink-2 text-sm font-medium">
                  Faturamento Saipos hoje
                </p>
                <p className="text-2xl leading-8 font-semibold tracking-tight break-words tabular-nums">
                  {temDadosHoje ? formatarMoeda(dados.centavos / 100) : "—"}
                </p>
                <p className="text-ink-3 text-xs leading-5">
                  Total importado · sem canceladas
                </p>
              </div>
              <div className="flex min-w-0 flex-col gap-2 p-4 sm:p-5">
                <p className="text-ink-2 text-sm font-medium">
                  Vendas importadas hoje
                </p>
                <p className="text-2xl leading-8 font-semibold tabular-nums">
                  {temDadosHoje ? dados.quantidade : "—"}
                </p>
                <p className="text-ink-3 text-xs leading-5">
                  {temDadosHoje
                    ? `${dados.canceladas} ${dados.canceladas === 1 ? "cancelada" : "canceladas"} fora do total`
                    : "Aguardando dados do turno de hoje"}
                </p>
              </div>
            </div>
            <div className="border-line border-t px-4 py-3 text-xs leading-5 sm:px-5">
              <p className="text-ink-2">
                {vinculo.ultimoSucessoEm ? (
                  <>
                    Última importação:{" "}
                    <time dateTime={vinculo.ultimoSucessoEm}>
                      {dataHora.format(new Date(vinculo.ultimoSucessoEm))}
                    </time>
                    .
                  </>
                ) : (
                  "Primeira importação pendente."
                )}{" "}
                {dados.automatico && vinculo.habilitado
                  ? "Importação programada a cada 15 min."
                  : "Importação automática pausada."}
              </p>
              {aguardando && (
                <p role="status" className="text-ink-2 mt-1">
                  Atualização solicitada; aguardando processamento.
                </p>
              )}
              {vinculo.ultimoErro && (
                <p role="status" className="text-warn mt-1">
                  A última importação falhou. Os dados anteriores foram
                  preservados; confira a integração no Analytics.
                </p>
              )}
            </div>
            {dados.recentes.length > 0 && (
              <details className="border-line border-t">
                <summary className="hover:bg-surface-2 focus-visible:outline-accent min-h-11 cursor-pointer px-4 py-3 text-sm font-medium focus-visible:outline-2 focus-visible:-outline-offset-2 sm:px-5">
                  {dados.recentes.length === 1
                    ? "Ver última venda importada"
                    : `Ver últimas ${dados.recentes.length} vendas importadas`}
                </summary>
                <ul className="divide-line divide-y px-4 sm:px-5">
                  {dados.recentes.map((venda) => (
                    <li
                      key={venda.id}
                      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 text-sm"
                    >
                      <div className="min-w-0 flex-1 basis-36">
                        <p className="font-medium break-all">
                          Venda #{venda.vendaExternaId}
                        </p>
                        <p className="text-ink-3 mt-1 text-xs break-words">
                          <time dateTime={venda.criadaNoSaiposEm}>
                            {dataHora.format(new Date(venda.criadaNoSaiposEm))}
                          </time>
                          {" · "}
                          {venda.origem ?? "Canal não informado"}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium tabular-nums">
                          {formatarMoeda(venda.totalCentavos / 100)}
                        </span>
                        <Etiqueta tom={venda.cancelada ? "ruim" : "neutro"}>
                          {venda.cancelada ? "Cancelada" : "Importada"}
                        </Etiqueta>
                      </div>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {temDadosHoje && dados.recentes.length === 0 && (
              <p className="text-ink-3 border-line border-t px-4 py-3 text-sm sm:px-5">
                Nenhuma venda recebida para este turno até a última importação.
                Novas vendas podem chegar com atraso.
              </p>
            )}
          </>
        )}
        <div className="border-line bg-warn-sub text-warn border-t px-4 py-3 text-xs leading-5 sm:px-5">
          <strong>Hoje ainda é parcial.</strong> A API pode entregar vendas até
          o dia seguinte. A lista mostra vendas importadas, sem indicar a etapa
          atual de preparo ou entrega. Período por turno Saipos, que pode
          atravessar a meia-noite.
        </div>
        <Link
          href={href}
          className="text-accent hover:bg-accent-sub flex min-h-11 items-center justify-between gap-2 px-4 py-3 text-sm font-semibold sm:px-5"
        >
          Conferir o turno de hoje no Analytics
          <Icone nome="seta-direita" tamanho={16} />
        </Link>
      </Cartao>
    </section>
  );
}
