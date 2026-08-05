import { notFound, redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { AvisoUnidade } from "@/modules/financeiro/components/aviso-unidade";
import { PaginaDeContas } from "@/modules/financeiro/components/pagina-de-contas";
import {
  listarCategorias,
  listarContas,
} from "@/modules/financeiro/services/cadastros";
import { listarLancamentos } from "@/modules/financeiro/services/lancamentos";
import { listarFornecedores } from "@/modules/compras/services/fornecedores";

export default async function PaginaPagar({
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
        <AvisoUnidade acao="Ver contas a pagar" />
      </div>
    );
  }

  const { status: bruto } = await searchParams;
  const status = bruto === "quitado" ? "QUITADO" : "ABERTO";

  const [lancamentos, categorias, contas, fornecedores] = await Promise.all([
    listarLancamentos(contexto, { direcao: "PAGAR", status }),
    listarCategorias(contexto),
    listarContas(contexto),
    // Fornecedor é vocabulário compartilhado — o mesmo cadastro que Compras
    // mantém e que o Estoque usa para lançar nota.
    pode(contexto, "compras.ver")
      ? listarFornecedores(contexto)
      : Promise.resolve([]),
  ]);

  return (
    <PaginaDeContas
      direcao="PAGAR"
      lancamentos={lancamentos}
      categorias={categorias}
      contas={contas.filter((c) => c.ativa)}
      fornecedores={fornecedores.map((f) => ({ id: f.id, nome: f.nome }))}
      unidade={contexto.unidadeAtiva.nome}
      podeLancar={pode(contexto, "financeiro.lancar")}
      podeQuitar={pode(contexto, "financeiro.quitar")}
      status={status}
    />
  );
}
