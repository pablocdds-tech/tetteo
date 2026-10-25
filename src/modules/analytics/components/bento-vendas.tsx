import type { consultarVendas } from "../services/vendas";
import type { consultarPulso } from "../services/pulso";
import { variacao } from "../schemas/pulso";
const moeda = (centavos: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    centavos / 100,
  );
const dia = (d: string) => d.split("-").reverse().join("/");
const horario = (data: Date) =>
  data.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
const bloco =
  "bg-surface border-line rounded-2xl border p-5 sm:rounded-3xl sm:p-6";
export function BentoVendas({
  dados,
  pulso,
  de,
  ate,
}: {
  dados: Awaited<ReturnType<typeof consultarVendas>>;
  pulso: Awaited<ReturnType<typeof consultarPulso>>;
  de: string;
  ate: string;
}) {
  const comparavel =
    !dados.incompleto &&
    dados.vinculos.every(
      (v) => !!v.coberturaDesde && v.coberturaDesde <= pulso.anteriorDe,
    );
  const diferenca = comparavel
    ? variacao(dados.centavos, pulso.anteriorCentavos)
    : null;
  const maior = Math.max(
    1,
    ...pulso.horas.map((h) => h.centavos),
    ...(comparavel ? pulso.horasAnteriores.map((h) => h.centavos) : []),
  );
  const sucessos = dados.vinculos.flatMap((v) =>
    v.ultimoSucessoEm ? [v.ultimoSucessoEm.getTime()] : [],
  );
  const ultimoSucesso = sucessos.length
    ? new Date(Math.min(...sucessos))
    : null;
  return (
    <section
      aria-label="Dashboard de vendas"
      className="grid min-w-0 gap-4 lg:grid-cols-12"
    >
      <div className={`${bloco} lg:col-span-8`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-ink-2 text-sm font-medium">
              Faturamento{" "}
              {de === ate ? `do turno de ${dia(ate)}` : "no período"}
            </h2>
            <p className="mt-3 text-4xl font-semibold tracking-tight tabular-nums sm:text-5xl">
              {dados.incompleto ? "—" : moeda(dados.centavos)}
            </p>
          </div>
          <span className="bg-warn-sub text-warn rounded-full px-3 py-1 text-xs font-medium">
            {pulso.hoje ? "Hoje · parcial" : "Dados importados"}
          </span>
        </div>
        <p className="text-ink-3 mt-3 text-sm">
          {dia(de)} a {dia(ate)} · canceladas excluídas
        </p>
        <div className="border-line mt-6 border-t pt-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-semibold">Ritmo por hora</h3>
            <span className="text-ink-3 text-xs">
              Turno de {dia(ate)} · hora de criação, Brasília
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-4 text-xs">
            <span className="text-accent">▰ Turno selecionado</span>
            <span className="text-ink-3">
              ▰{" "}
              {comparavel
                ? `Semana anterior (${dia(pulso.anteriorAte)})`
                : "Comparação indisponível"}
            </span>
          </div>
          <div
            role="img"
            aria-label={`Faturamento por hora no turno de ${dia(ate)}. Valores disponíveis na tabela abaixo. Dados importados podem estar atrasados.`}
            className="mt-5 grid h-44 grid-cols-24 items-end gap-0.5 sm:h-56 sm:gap-1"
          >
            {pulso.horas.map((h, i) => (
              <div
                key={h.hora}
                className="flex h-full items-end justify-center gap-px"
                title={`${h.hora}h: ${moeda(h.centavos)}; semana anterior: ${comparavel ? moeda(pulso.horasAnteriores[i].centavos) : "sem cobertura"}`}
              >
                <div
                  className="bg-accent w-1/2 rounded-t"
                  style={{ height: `${(h.centavos / maior) * 100}%` }}
                />
                {comparavel && (
                  <div
                    className="bg-ink-3 w-1/2 rounded-t opacity-40"
                    style={{
                      height: `${(pulso.horasAnteriores[i].centavos / maior) * 100}%`,
                    }}
                  />
                )}
              </div>
            ))}
          </div>
          <div className="text-ink-3 border-line mt-1 flex justify-between border-t pt-2 text-xs tabular-nums">
            <span>00h</span>
            <span>06h</span>
            <span>12h</span>
            <span>18h</span>
            <span>23h</span>
          </div>
          <details className="mt-4 text-sm">
            <summary className="text-accent cursor-pointer py-2">
              Ver valores por hora
            </summary>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <caption className="sr-only">
                  Faturamento por hora de criação da venda, agrupado pela data
                  do turno
                </caption>
                <thead>
                  <tr>
                    <th scope="col" className="py-2">
                      Hora
                    </th>
                    <th scope="col">Selecionado</th>
                    <th scope="col">Semana anterior</th>
                  </tr>
                </thead>
                <tbody>
                  {pulso.horas.map((h, i) => (
                    <tr key={h.hora} className="border-line border-t">
                      <th scope="row" className="py-2 font-normal">
                        {h.hora}h
                      </th>
                      <td>{dados.incompleto ? "—" : moeda(h.centavos)}</td>
                      <td>
                        {comparavel
                          ? moeda(pulso.horasAnteriores[i].centavos)
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          {!pulso.horas.some((h) => h.quantidade) && (
            <p className="text-ink-3 mt-2 text-sm">
              Nenhuma venda importada para este turno. Isso não confirma
              ausência de vendas no caixa.
            </p>
          )}
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:col-span-4 lg:grid-cols-1">
        <div className={`${bloco} bg-accent-sub`}>
          <h2 className="text-sm font-medium">Em relação à semana anterior</h2>
          <p className="mt-3 text-3xl font-semibold tabular-nums">
            {diferenca === null
              ? "Sem comparação"
              : `${diferenca > 0 ? "+" : ""}${diferenca.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}
          </p>
          <p className="text-ink-2 mt-3 text-sm">
            {comparavel
              ? `${moeda(pulso.anteriorCentavos)} em ${dia(pulso.anteriorDe)} a ${dia(pulso.anteriorAte)}${pulso.hoje ? ", até o mesmo horário" : ""}.`
              : "Histórico insuficiente para comparar os mesmos dias."}
          </p>
          <p className="text-ink-3 mt-2 text-xs">
            Atrasos da fonte podem afetar a comparação. Base zero não gera
            percentual.
          </p>
        </div>
        <div className={bloco}>
          <h2 className="text-ink-2 text-sm font-medium">
            Vendas não canceladas
          </h2>
          <p className="mt-3 text-4xl font-semibold tabular-nums">
            {dados.incompleto ? "—" : dados.quantidade.toLocaleString("pt-BR")}
          </p>
          <p className="text-ink-3 mt-2 text-sm">
            {dados.canceladas} canceladas excluídas
          </p>
        </div>
        <div className={bloco}>
          <h2 className="text-ink-2 text-sm font-medium">Ticket médio</h2>
          <p className="mt-3 text-4xl font-semibold tabular-nums">
            {dados.incompleto || !dados.quantidade
              ? "—"
              : moeda(dados.centavos / dados.quantidade)}
          </p>
          <p className="text-ink-3 mt-2 text-sm">
            Faturamento ÷ vendas válidas
          </p>
        </div>
      </div>
      <div className={`${bloco} lg:col-span-12`} role="status">
        <div className="grid gap-5 md:grid-cols-3">
          <div>
            <h2 className="font-semibold">Atualização dos dados</h2>
            <p className="text-ink-2 mt-2 text-sm">
              {ultimoSucesso
                ? `Última importação: ${horario(ultimoSucesso)}`
                : "Primeira importação pendente"}
            </p>
            <p className="text-ink-3 mt-1 text-xs">
              {dados.automatico
                ? "Saipos consultado a cada 15 minutos. Falhas temporárias aguardam 30 minutos; erros de acesso ou formato exigem intervenção."
                : "Importação automática pausada."}
            </p>
          </div>
          <div>
            <h3 className="font-semibold">Venda mais recente recebida</h3>
            <p className="text-ink-2 mt-2 text-sm">
              {pulso.ultimaVendaEm
                ? horario(pulso.ultimaVendaEm)
                : "Nenhuma venda recebida"}
            </p>
            <p className="text-ink-3 mt-1 text-xs">
              Horário da venda na origem; não é garantia de sincronização em
              tempo real.
            </p>
          </div>
          <div>
            <h3 className="font-semibold">Fonte com possível atraso</h3>
            <p className="text-ink-2 mt-2 text-sm">
              API de Dados Saipos · pode disponibilizar dados somente no dia
              seguinte (D+1).
            </p>
            <p className="text-ink-3 mt-1 text-xs">
              Hoje é parcial. Uma consulta bem-sucedida não garante todas as
              vendas do caixa.
            </p>
          </div>
        </div>
        {dados.incompleto && (
          <p className="text-warn mt-4">
            Sem cobertura completa do período. Os indicadores ficam sem valor; o
            gráfico pode conter dados parciais.
          </p>
        )}
        {!dados.vinculos.length && (
          <p className="text-warn mt-4">
            Integração não configurada para a unidade selecionada.
          </p>
        )}
        {dados.vinculos.map((v) => (
          <div key={v.unidadeId} className="text-ink-3 mt-3 text-sm">
            <p>
              {v.unidade.nome}: histórico{" "}
              {v.coberturaDesde ? `desde ${dia(v.coberturaDesde)}` : "pendente"}
              .{!v.habilitado ? " Vínculo pausado." : ""}
              {v.solicitadaEm &&
              (!v.ultimaTentativaEm || v.solicitadaEm > v.ultimaTentativaEm)
                ? " Atualização solicitada."
                : ""}
            </p>
            {v.ultimoErro && (
              <p className="text-warn">
                Última tentativa: {v.ultimoErro} Os dados anteriores foram
                preservados.
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
