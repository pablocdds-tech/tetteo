import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { FormularioFornecedor } from "@/modules/compras/components/formulario-fornecedor";
import { obterFornecedor } from "@/modules/compras/services/fornecedores";

/** "novo" cria; qualquer outro id edita. Uma tela só para os dois gestos. */
export default async function PaginaFornecedor({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");
  if (!pode(contexto, "compras.fornecedores")) notFound();

  const { id } = await params;
  const novo = id === "novo";

  const fornecedor = novo ? null : await obterFornecedor(contexto, id);
  if (!novo && !fornecedor) notFound();

  return (
    <div className="mx-auto w-full max-w-2xl">
      <Link
        href="/compras/fornecedores"
        className="text-ink-3 hover:text-ink text-sm"
      >
        ← Fornecedores
      </Link>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">
        {novo ? "Novo fornecedor" : fornecedor!.nome}
      </h1>

      <div className="mt-6">
        <FormularioFornecedor
          fornecedor={
            fornecedor
              ? {
                  id: fornecedor.id,
                  nome: fornecedor.nome,
                  documento: fornecedor.documento,
                  telefone: fornecedor.telefone,
                  email: fornecedor.email,
                  contato: fornecedor.contato,
                  prazoEntregaDias: fornecedor.prazoEntregaDias,
                  condicaoPagamento: fornecedor.condicaoPagamento,
                  observacao: fornecedor.observacao,
                }
              : undefined
          }
        />
      </div>
    </div>
  );
}
