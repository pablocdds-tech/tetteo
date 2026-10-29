import { notFound, redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { AvisoUnidade } from "@/modules/financeiro/components/aviso-unidade";
import { PainelConferencia } from "@/modules/financeiro/components/painel-conferencia";
import { db } from "@/server/db";

export default async function PaginaConferencia() {
  const ctx = await obterContexto();
  if (!ctx) redirect("/login");
  if (!pode(ctx, "financeiro.ver")) notFound();
  if (!ctx.unidadeAtiva) return <AvisoUnidade acao="Conferir recebimentos" />;
  const unidade = await db.unidade.findFirst({
    where: {
      id: ctx.unidadeAtiva.id,
      organizacaoId: ctx.organizacao.id,
      ativa: true,
      excluidoEm: null,
    },
    select: { fusoHorario: true },
  });
  if (!unidade) notFound();
  const hoje = new Intl.DateTimeFormat("en-CA", {
    timeZone: unidade.fusoHorario,
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
