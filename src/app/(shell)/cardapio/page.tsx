import Link from "next/link";
import { redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { Botao } from "@/design-system/botao";
import { ListaInsumos } from "@/modules/cardapio/components/lista-insumos";
import { listarInsumos } from "@/modules/cardapio/services/insumos";

/** A rota só delega: quem sabe o que é um insumo é o App, não o roteamento. */
export default async function PaginaCardapio() {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const podeEditar = pode(contexto, "cardapio.editar");
  const insumos = await listarInsumos(contexto);

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Cardápio</h1>
          <p className="text-ink-3 mt-1 text-sm">
            Insumos da rede · {insumos.length}{" "}
            {insumos.length === 1 ? "cadastrado" : "cadastrados"}
          </p>
        </div>

        {podeEditar && insumos.length > 0 && (
          <Link href="/cardapio/novo">
            <Botao>Novo insumo</Botao>
          </Link>
        )}
      </div>

      <div className="mt-6">
        <ListaInsumos
          insumos={insumos.map((i) => ({
            id: i.id,
            nome: i.nome,
            categoria: i.categoria,
            unidadeMedida: i.unidadeMedida,
            custoMedio: i.custoMedio.toString(),
            estoqueMinimo: i.estoqueMinimo.toString(),
          }))}
          podeEditar={podeEditar}
          podeExcluir={pode(contexto, "cardapio.excluir")}
        />
      </div>
    </div>
  );
}
