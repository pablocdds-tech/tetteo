import { notFound, redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { CabecalhoDePagina } from "@/design-system/cabecalho-de-pagina";
import { FormularioRodada } from "@/modules/compras/components/formulario-rodada";
import { ocorrenciaDaSemana } from "@/modules/compras/schemas/rodada";

/** Os campos de data no fuso de Brasília, do jeito que o `<input>` lê. */
function campo(d: Date, comHora: boolean) {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  return comHora ? `${partes}T10:00` : partes;
}

export default async function NovaRodada() {
  const ctx = await obterContexto();
  if (!ctx) redirect("/login");
  if (!pode(ctx, "compras.rodadas")) notFound();

  const agora = new Date();
  const dias = (n: number) => new Date(agora.getTime() + n * 86_400_000);
  const semana = ocorrenciaDaSemana(agora, "America/Sao_Paulo").split("-W")[1];

  return (
    <div className="mx-auto flex w-full max-w-[var(--width-data)] flex-col gap-4">
      <CabecalhoDePagina
        titulo="Nova rodada"
        contexto="Escolha as lojas e os prazos. Depois, abra a coleta das requisições."
      />
      <FormularioRodada
        lojas={ctx.unidadesVisiveis}
        sugestao={{
          nome: `Semana ${semana}`,
          prazoRequisicao: campo(dias(1), true),
          prazoCotacao: campo(dias(2), true),
          entregaDe: campo(dias(3), false),
          entregaAte: campo(dias(4), false),
        }}
      />
    </div>
  );
}
