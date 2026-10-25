import Link from "next/link";
import { Botao, estiloDeBotao } from "@/design-system/botao";
import { AtualizacaoAutomatica } from "@/modules/analytics/components/atualizacao-automatica";
import { notFound, redirect } from "next/navigation";
import { obterContexto, pode } from "@/core/sessao/contexto";
import { CabecalhoDePagina } from "@/design-system/cabecalho-de-pagina";
import { PainelVendas } from "@/modules/analytics/components/painel-vendas";
import { periodoVendas } from "@/modules/analytics/schemas/vendas";
import { salvarReferencia, solicitarAtualizacao } from "./acoes";
import { diaDeslocado, horarioBrasilia } from "@/connectors/saipos/tempo";

export default async function Vendas({
  searchParams,
}: {
  searchParams: Promise<{ de?: string; ate?: string }>;
}) {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");
  if (!pode(contexto, "analytics.ver")) notFound();
  const filtro = await searchParams,
    hoje = horarioBrasilia().slice(0, 10);
  const de = filtro.de ?? hoje,
    ate = filtro.ate ?? hoje;
  try {
    periodoVendas(de, ate);
  } catch {
    return (
      <p role="alert">
        Período inválido. Informe datas válidas em ordem, com até 366 dias.
      </p>
    );
  }
  return (
    <div className="mx-auto flex w-full max-w-[var(--width-data)] flex-col gap-4">
      <CabecalhoDePagina
        titulo="Pulso de vendas"
        contexto={contexto.unidadeAtiva?.nome ?? "Unidades autorizadas"}
      />
      <div className="flex flex-wrap gap-2">
        <Link className={estiloDeBotao("secundario")} href="/analytics/vendas">
          Hoje
        </Link>
        <Link
          className={estiloDeBotao("secundario")}
          href={`/analytics/vendas?de=${diaDeslocado(hoje, -1)}&ate=${diaDeslocado(hoje, -1)}`}
        >
          Ontem
        </Link>
        <Link
          className={estiloDeBotao("secundario")}
          href={`/analytics/vendas?de=${diaDeslocado(hoje, -7)}&ate=${diaDeslocado(hoje, -1)}`}
        >
          Últimos 7 dias completos
        </Link>
      </div>
      <AtualizacaoAutomatica />
      <form className="bg-surface border-line flex flex-wrap items-end gap-3 rounded-2xl border p-4">
        <label className="text-sm">
          De
          <input
            type="date"
            name="de"
            defaultValue={de}
            required
            className="border-line-2 bg-surface mt-1 block rounded-md border px-3 py-2"
          />
        </label>
        <label className="text-sm">
          Até
          <input
            type="date"
            name="ate"
            defaultValue={ate}
            required
            className="border-line-2 bg-surface mt-1 block rounded-md border px-3 py-2"
          />
        </label>
        <Botao type="submit">Consultar período</Botao>
      </form>
      {contexto.ehDiretor && contexto.unidadeAtiva && (
        <form action={solicitarAtualizacao}>
          <button type="submit" className="text-brand text-sm underline">
            Solicitar atualização do Saipos
          </button>
          <p className="text-ink-3 mt-1 text-xs">
            A importação começa em até um minuto. O painel acompanha o resultado
            automaticamente.
          </p>
        </form>
      )}
      <PainelVendas de={de} ate={ate} salvarReferencia={salvarReferencia} />
    </div>
  );
}
