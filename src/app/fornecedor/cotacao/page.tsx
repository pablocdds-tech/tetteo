import type { Metadata } from "next";

import { CotacaoDoFornecedor } from "./cotacao-do-fornecedor";

/**
 * A PÁGINA DO FORNECEDOR — a única de Compras aberta sem login.
 *
 * O código do link vem depois do "#": o navegador não manda essa parte ao
 * servidor, então ela não aparece em log de acesso, em cabeçalho Referer nem
 * em histórico de proxy. A página lê o código no navegador e o entrega a uma
 * ação do servidor, no corpo do POST.
 *
 * Sem casca, menu ou marca do sistema: o fornecedor vê o nome da pizzaria, os
 * itens pedidos a ele e o formulário. Nenhum preço de concorrente, nenhum
 * preço de referência, nenhuma outra loja.
 */
export const metadata: Metadata = {
  title: "Pedido de cotação",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default function PaginaDaCotacao() {
  return (
    <main className="flex-1 px-4 py-6 md:py-10">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <CotacaoDoFornecedor />
      </div>
    </main>
  );
}
