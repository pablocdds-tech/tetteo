import { notFound, redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { AvisoUnidade } from "@/modules/estoque/components/aviso-unidade";
import { FormularioImportacao } from "@/modules/estoque/components/formulario-importacao";

export default async function PaginaImportar() {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  // Importar cria insumo (vocabulário do Cardápio) e posição (do Estoque).
  // Exigir as duas permissões é honesto sobre o que a tela toca.
  if (!pode(contexto, "cardapio.editar") || !pode(contexto, "estoque.lancar")) {
    notFound();
  }

  return (
    <div className="mx-auto w-full max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight">
        Importar cadastro
      </h1>
      <p className="text-ink-3 mt-1 text-sm">
        {contexto.unidadeAtiva
          ? `Traz a planilha do sistema antigo para o Tetteo · ${contexto.unidadeAtiva.nome}`
          : "Traz a planilha do sistema antigo para o Tetteo"}
      </p>

      <div className="mt-6">
        {contexto.unidadeAtiva ? (
          <FormularioImportacao />
        ) : (
          <AvisoUnidade acao="Importar estoque" />
        )}
      </div>
    </div>
  );
}
