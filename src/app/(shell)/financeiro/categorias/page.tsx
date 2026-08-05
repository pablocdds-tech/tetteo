import { notFound, redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { AvisoUnidade } from "@/modules/financeiro/components/aviso-unidade";
import { Cadastros } from "@/modules/financeiro/components/cadastros";
import {
  listarCategorias,
  listarContas,
} from "@/modules/financeiro/services/cadastros";

export default async function PaginaCadastros() {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");
  if (!pode(contexto, "financeiro.lancar")) notFound();

  if (!contexto.unidadeAtiva) {
    return (
      <div className="mx-auto w-full max-w-5xl">
        <AvisoUnidade acao="Cadastrar contas" />
      </div>
    );
  }

  const [categorias, contas] = await Promise.all([
    listarCategorias(contexto),
    listarContas(contexto),
  ]);

  return (
    <div className="mx-auto w-full max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight">
        Categorias e contas
      </h1>
      <p className="text-ink-3 mt-1 text-sm">
        Onde o dinheiro fica, e em que gaveta cada movimento cai
      </p>

      <div className="mt-6">
        <Cadastros
          categorias={categorias}
          contas={contas.map((c) => ({
            id: c.id,
            nome: c.nome,
            tipo: c.tipo,
            saldoInicial: Number(c.saldoInicial),
            ativa: c.ativa,
          }))}
        />
      </div>
    </div>
  );
}
