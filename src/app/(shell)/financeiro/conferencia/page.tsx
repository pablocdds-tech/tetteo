import { notFound, redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { AvisoUnidade } from "@/modules/financeiro/components/aviso-unidade";
import { PainelConferencia } from "@/modules/financeiro/components/painel-conferencia";

export default async function PaginaConferencia() {
  const ctx = await obterContexto();
  if (!ctx) redirect("/login");
  if (!pode(ctx, "financeiro.ver")) notFound();
  if (!ctx.unidadeAtiva) return <AvisoUnidade acao="Conferir recebimentos" />;
  const hoje = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return (
    <PainelConferencia
      key={`${ctx.organizacao.id}:${ctx.unidadeAtiva.id}`}
      unidade={ctx.unidadeAtiva.nome}
      deInicial={hoje.slice(0, 8) + "01"}
      ateInicial={hoje}
      podeImportar={pode(ctx, "financeiro.lancar")}
      podeDecidir={pode(ctx, "financeiro.quitar")}
    />
  );
}
