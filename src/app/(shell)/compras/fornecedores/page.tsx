import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { Botao } from "@/design-system/botao";
import { alternarFornecedorAcao } from "@/modules/compras/acoes";
import { listarFornecedores } from "@/modules/compras/services/fornecedores";

/**
 * Fornecedor é da REDE, não da loja — por isso esta tela funciona também com o
 * seletor em "Rede Completa". A distribuidora atende as duas casas, e
 * cadastrá-la duas vezes tornaria impossível comparar preço entre elas.
 */
export default async function PaginaFornecedores() {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");
  if (!pode(contexto, "compras.ver")) notFound();

  const fornecedores = await listarFornecedores(contexto, true);
  const podeEditar = pode(contexto, "compras.fornecedores");

  return (
    <div className="mx-auto w-full max-w-4xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Fornecedores
          </h1>
          <p className="text-ink-3 mt-1 text-sm">
            De quem se compra. Vale para a rede inteira.
          </p>
        </div>

        {podeEditar && (
          <Link href="/compras/fornecedores/novo">
            <Botao>Novo fornecedor</Botao>
          </Link>
        )}
      </div>

      {fornecedores.length === 0 ? (
        <div className="border-line-2 bg-surface-2 mt-6 rounded-xl border border-dashed px-6 py-10 text-center">
          <p className="font-semibold">Nenhum fornecedor cadastrado</p>
          <p className="text-ink-3 mx-auto mt-1 max-w-md text-sm">
            Cadastre os que você já usa — inclusive o da feira. Um fornecedor
            fora do sistema é um preço que nunca entra na comparação.
          </p>
        </div>
      ) : (
        <div className="border-line divide-line mt-6 divide-y rounded-xl border">
          {fornecedores.map((f) => (
            <div
              key={f.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {f.nome}
                  {!f.ativo && (
                    <span className="bg-surface-3 text-ink-3 ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold">
                      inativo
                    </span>
                  )}
                </span>
                <span className="text-ink-3 block truncate text-xs">
                  {[
                    f.contato,
                    f.telefone,
                    f.condicaoPagamento,
                    f.prazoEntregaDias !== null
                      ? `entrega em ${f.prazoEntregaDias}d`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "sem contato cadastrado"}
                </span>
              </div>

              <span className="text-ink-3 hidden text-xs tabular-nums sm:block">
                {f.cotacoes} {f.cotacoes === 1 ? "cotação" : "cotações"} ·{" "}
                {f.notas} {f.notas === 1 ? "nota" : "notas"}
              </span>

              {podeEditar && (
                <div className="flex items-center gap-1">
                  <Link href={`/compras/fornecedores/${f.id}`}>
                    <Botao peso="secundario" tamanho="pequeno">
                      Editar
                    </Botao>
                  </Link>
                  <form action={alternarFornecedorAcao}>
                    <input type="hidden" name="id" value={f.id} />
                    <Botao peso="fantasma" tamanho="pequeno" type="submit">
                      {f.ativo ? "Desativar" : "Reativar"}
                    </Botao>
                  </form>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
