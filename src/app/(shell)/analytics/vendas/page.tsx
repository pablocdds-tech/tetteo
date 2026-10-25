import { notFound, redirect } from "next/navigation";
import { obterContexto, pode } from "@/core/sessao/contexto";
import { CabecalhoDePagina } from "@/design-system/cabecalho-de-pagina";
import { PainelVendas } from "@/modules/analytics/components/painel-vendas";
import { periodoVendas } from "@/modules/analytics/schemas/vendas";
import { solicitarAtualizacao } from "./acoes";
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
  const de = filtro.de ?? diaDeslocado(hoje, -7),
    ate = filtro.ate ?? diaDeslocado(hoje, -1);
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
        titulo="Vendas"
        contexto={contexto.unidadeAtiva?.nome ?? "Unidades autorizadas"}
      />
      <form className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          De
          <input
            type="date"
            name="de"
            defaultValue={de}
            required
            className="border-line bg-surface mt-1 block rounded-md border px-3 py-2"
          />
        </label>
        <label className="text-sm">
          Até
          <input
            type="date"
            name="ate"
            defaultValue={ate}
            required
            className="border-line bg-surface mt-1 block rounded-md border px-3 py-2"
          />
        </label>
        <button
          type="submit"
          className="bg-brand rounded-md px-4 py-2 text-sm font-semibold text-white"
        >
          Consultar período
        </button>
      </form>
      {contexto.ehDiretor && contexto.unidadeAtiva && (
        <form action={solicitarAtualizacao}>
          <button type="submit" className="text-brand text-sm underline">
            Solicitar atualização do Saipos
          </button>
          <p className="text-ink-3 mt-1 text-xs">
            O processamento começa em até um minuto. Recarregue esta página
            depois de alguns minutos para conferir o resultado.
          </p>
        </form>
      )}
      <PainelVendas de={de} ate={ate} />
    </div>
  );
}
