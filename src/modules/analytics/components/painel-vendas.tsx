import Link from "next/link";
import { obterContexto, pode } from "@/core/sessao/contexto";
import { Cartao } from "@/design-system/cartao";
import { Indicador } from "@/design-system/indicador";
import { consultarVendas } from "../services/vendas";

const moeda = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
const dia = (d: string) => d.split("-").reverse().join("/");
export async function PainelVendas({
  de,
  ate,
  compacto = false,
}: {
  de: string;
  ate: string;
  compacto?: boolean;
}) {
  const contexto = await obterContexto();
  if (!contexto || !pode(contexto, "analytics.ver")) return null;
  let dados;
  try {
    dados = await consultarVendas(contexto, de, ate);
  } catch {
    return (
      <Cartao className="p-4">
        <h2 className="font-semibold">Vendas Saipos</h2>
        <p role="status" className="text-ink-3 mt-2 text-sm">
          Não foi possível carregar as vendas. A importação pode estar pendente;
          tente novamente mais tarde.
        </p>
      </Cartao>
    );
  }
  const apoio = `${dia(de)} a ${dia(ate)} · Saipos · data do turno`;
  return (
    <section aria-label="Vendas Saipos" className="flex flex-col gap-3">
      {compacto && (
        <div className="flex justify-between gap-3">
          <h2 className="text-sm font-semibold">Vendas da operação</h2>
          <Link
            href={`/analytics/vendas?de=${de}&ate=${ate}`}
            className="text-brand text-sm underline"
          >
            Conferir vendas
          </Link>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <Indicador
          rotulo="Faturamento"
          valor={dados.incompleto ? null : moeda.format(dados.centavos / 100)}
          apoio={apoio}
        />
        <Indicador
          rotulo="Vendas não canceladas"
          valor={dados.incompleto ? null : String(dados.quantidade)}
          apoio={apoio}
        />
        <Indicador
          rotulo="Ticket médio"
          valor={
            dados.incompleto || !dados.quantidade
              ? null
              : moeda.format(dados.centavos / dados.quantidade / 100)
          }
          apoio={apoio}
        />
      </div>
      <div role="status" className="text-ink-3 space-y-1 text-sm">
        {dados.incompleto && (
          <p className="text-warn">
            Ainda não há cobertura completa deste período. Os indicadores ficam
            sem valor para evitar um total incompleto.
          </p>
        )}
        {dados.vinculos.length === 0 && (
          <p>
            Integração Saipos ainda não configurada para a unidade selecionada.
          </p>
        )}
        {dados.vinculos.map((v) => (
          <p key={v.unidadeId}>
            {v.unidade.nome}:{" "}
            {v.ultimoSucessoEm
              ? `atualizado em ${v.ultimoSucessoEm.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} (Brasília).`
              : "Primeira importação pendente."}{" "}
            {v.coberturaDesde
              ? `Histórico desde ${dia(v.coberturaDesde)}. `
              : ""}
            {v.ultimoErro
              ? `A última tentativa falhou: ${v.ultimoErro} Os dados anteriores foram preservados. `
              : ""}
            {v.solicitadaEm &&
            (!v.ultimaTentativaEm || v.solicitadaEm > v.ultimaTentativaEm)
              ? "Atualização solicitada; aguardando processamento. "
              : ""}
            {dados.automatico && v.habilitado
              ? "Atualização diária às 05h15 de Brasília."
              : "Atualização automática pausada."}
          </p>
        ))}
        <p>
          {dados.canceladas} vendas canceladas excluídas do total. A fonte pode
          apresentar atraso D+1.
        </p>
      </div>
      {!compacto && (
        <Cartao className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="text-ink-3 p-4 text-left">
              Vendas por turno — {apoio}
              {dados.incompleto ? " (dados parciais)" : ""}
            </caption>
            <thead className="border-line border-b">
              <tr>
                <th scope="col" className="px-4 py-3">
                  Data do turno
                </th>
                <th scope="col" className="px-4 py-3 text-right">
                  Vendas
                </th>
                <th scope="col" className="px-4 py-3 text-right">
                  Canceladas
                </th>
                <th scope="col" className="px-4 py-3 text-right">
                  Faturamento
                </th>
              </tr>
            </thead>
            <tbody>
              {dados.dias.map((d) => (
                <tr key={d.data} className="border-line border-b">
                  <th scope="row" className="px-4 py-3 font-normal">
                    {dia(d.data)}
                  </th>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {d.quantidade}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {d.canceladas}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {moeda.format(d.centavos / 100)}
                  </td>
                </tr>
              ))}
              {dados.dias.length === 0 && (
                <tr>
                  <td colSpan={4} className="text-ink-3 px-4 py-6">
                    Nenhuma venda importada para este período.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Cartao>
      )}
    </section>
  );
}
