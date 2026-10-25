import type { consultarVendas } from "../services/vendas";
import { ReferenciaForm, type SalvarReferencia } from "./referencia-form";
const moeda = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    v / 100,
  );
const dia = (v: string) => v.split("-").reverse().join("/");
const bloco =
  "bg-surface border-line rounded-2xl border p-5 sm:rounded-3xl sm:p-6";
export function ConferenciaCanais({
  dados,
  de,
  ate,
  diretor,
  salvarReferencia,
}: {
  dados: Awaited<ReturnType<typeof consultarVendas>>;
  de: string;
  ate: string;
  diretor: boolean;
  salvarReferencia?: SalvarReferencia;
}) {
  const estado = dados.conferencia.estado;
  const titulos = {
    sem_referencia: "Sem referência do relatório",
    sem_cobertura: "Cobertura da API incompleta",
    bateu: "Bateu com a referência",
    divergente: "Diferença a conferir",
  };
  return (
    <>
      <section
        aria-label="Conciliação com o relatório Saipos"
        className={bloco}
      >
        <div className="flex flex-wrap justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Conferência do fechamento</h2>
            <p className="text-ink-3 mt-1 text-sm">
              {dia(de)} a {dia(ate)} · mesma unidade e data do turno
            </p>
          </div>
          <span
            className={`self-start rounded-full px-3 py-1 text-sm font-medium ${estado === "bateu" ? "bg-ok-sub text-ok" : "bg-warn-sub text-warn"}`}
          >
            {titulos[estado]}
          </span>
        </div>
        <dl className="mt-5 grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-ink-3 text-sm">
              Total importado, sem canceladas
            </dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums">
              {dados.incompleto ? "—" : moeda(dados.centavos)}
            </dd>
          </div>
          <div>
            <dt className="text-ink-3 text-sm">Referência do relatório</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums">
              {dados.referencia
                ? moeda(dados.referencia.totalCentavos)
                : "Não informada"}
            </dd>
          </div>
          <div>
            <dt className="text-ink-3 text-sm">
              Diferença: importado − referência
            </dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums">
              {dados.conferencia.diferenca === null
                ? "—"
                : moeda(dados.conferencia.diferenca)}
            </dd>
          </div>
        </dl>
        <p className="text-ink-3 mt-4 text-sm">
          A comparação usa centavos, sem tolerância de arredondamento. Igualdade
          confirma esta referência no momento da consulta; vendas e
          cancelamentos posteriores podem mudar o resultado.
        </p>
        {dados.referencia && (
          <p className="text-ink-3 mt-2 text-xs">
            Referência informada por {dados.referencia.informadaPor.nome} em{" "}
            {dados.referencia.atualizadoEm.toLocaleString("pt-BR", {
              timeZone: "America/Sao_Paulo",
            })}{" "}
            · versão {dados.referencia.versao}.
          </p>
        )}
        {diretor && salvarReferencia && (
          <details className="mt-4">
            <summary className="text-accent cursor-pointer py-2 font-medium">
              {dados.referencia
                ? "Corrigir referência do relatório"
                : "Registrar referência do relatório"}
            </summary>
            <ReferenciaForm
              key={`${de}:${ate}:${dados.vinculos
                .map((v) => v.unidadeId)
                .sort()
                .join(",")}`}
              de={de}
              ate={ate}
              totalInicial={
                dados.referencia
                  ? (dados.referencia.totalCentavos / 100)
                      .toFixed(2)
                      .replace(".", ",")
                  : ""
              }
              versao={dados.referencia?.versao ?? 0}
              salvarAction={salvarReferencia}
            />
          </details>
        )}
      </section>
      <section
        aria-label="Vendas por canal e modalidade"
        className="grid min-w-0 gap-4 lg:grid-cols-2"
      >
        <Resumo
          titulo="Origem do pedido"
          grupos={dados.origens}
          total={dados.centavos}
        />
        <Resumo
          titulo="Modalidade da venda"
          grupos={dados.modalidades}
          total={dados.centavos}
        />
        <p className="text-ink-3 text-sm lg:col-span-2">
          Origem vem do parceiro de pedido informado pela API; modalidade indica
          entrega, balcão, salão ou ficha. Não informado não é classificado como
          telefone ou canal próprio. Totais excluem canceladas e podem estar
          sujeitos a atraso da fonte.
          {dados.semDetalhamento > 0
            ? ` ${dados.semDetalhamento} vendas válidas ainda aguardam detalhamento histórico.`
            : ""}
          {dados.vinculos.some((v) => v.ultimoErroCanais)
            ? " O detalhamento histórico teve uma falha; o checkpoint foi preservado e as vendas já importadas continuam disponíveis."
            : ""}
        </p>
      </section>
    </>
  );
}
function Resumo({
  titulo,
  grupos,
  total,
}: {
  titulo: string;
  grupos: {
    nome: string;
    quantidade: number;
    canceladas: number;
    centavos: number;
  }[];
  total: number;
}) {
  return (
    <div className={`${bloco} min-w-0 overflow-x-auto`}>
      <h2 className="mb-4 text-lg font-semibold">{titulo}</h2>
      <table className="w-full text-left text-sm">
        <caption className="sr-only">
          {titulo}: faturamento, vendas válidas, canceladas e participação no
          faturamento importado
        </caption>
        <thead>
          <tr className="border-line border-b">
            <th scope="col" className="py-3 pr-2">
              {titulo === "Origem do pedido" ? "Origem" : "Modalidade"}
            </th>
            <th scope="col" className="px-2 text-right">
              Válidas
            </th>
            <th scope="col" className="px-2 text-right">
              Canceladas
            </th>
            <th scope="col" className="px-2 text-right">
              Faturamento
            </th>
            <th scope="col" className="pl-2 text-right">
              Participação
            </th>
          </tr>
        </thead>
        <tbody>
          {grupos.map((g) => (
            <tr key={g.nome} className="border-line border-b">
              <th scope="row" className="py-4 pr-2 font-medium">
                {g.nome}
              </th>
              <td className="px-2 text-right tabular-nums">{g.quantidade}</td>
              <td className="px-2 text-right tabular-nums">{g.canceladas}</td>
              <td className="px-2 text-right whitespace-nowrap tabular-nums">
                {moeda(g.centavos)}
              </td>
              <td className="pl-2 text-right tabular-nums">
                {total > 0
                  ? `${((g.centavos / total) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`
                  : "—"}
              </td>
            </tr>
          ))}
          {!grupos.length && (
            <tr>
              <td colSpan={5} className="text-ink-3 py-4">
                Nenhuma venda importada para este período.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
