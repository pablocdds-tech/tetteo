import { notFound, redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { AvisoUnidade } from "@/modules/financeiro/components/aviso-unidade";
import { PaginaDeContas } from "@/modules/financeiro/components/pagina-de-contas";
import {
  listarCategorias,
  listarContas,
} from "@/modules/financeiro/services/cadastros";
import { listarLancamentos } from "@/modules/financeiro/services/lancamentos";

export default async function PaginaReceber({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");
  if (!pode(contexto, "financeiro.ver")) notFound();

  if (!contexto.unidadeAtiva) {
    return (
      <div className="mx-auto w-full max-w-4xl">
        <AvisoUnidade acao="Ver contas a receber" />
      </div>
    );
  }

  const { status: bruto } = await searchParams;
  const status = bruto === "quitado" ? "QUITADO" : "ABERTO";

  const [lancamentos, categorias, contas] = await Promise.all([
    listarLancamentos(contexto, { direcao: "RECEBER", status }),
    listarCategorias(contexto),
    listarContas(contexto),
  ]);

  return (
    <PaginaDeContas
      direcao="RECEBER"
      lancamentos={lancamentos}
      categorias={categorias}
      contas={contas.filter((c) => c.ativa)}
      fornecedores={[]}
      unidade={contexto.unidadeAtiva.nome}
      podeLancar={pode(contexto, "financeiro.lancar")}
      podeQuitar={pode(contexto, "financeiro.quitar")}
      status={status}
    />
  );
}
