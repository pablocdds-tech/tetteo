import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { Botao } from "@/design-system/botao";
import { paraCampo } from "@/lib/numero";
import { alternarFichaAcao } from "@/modules/cardapio/acoes";
import {
  EditorDeReceita,
  type LinhaDaReceita,
} from "@/modules/cardapio/components/editor-de-receita";
import { FormularioFicha } from "@/modules/cardapio/components/formulario-ficha";
import { PainelDeCusto } from "@/modules/cardapio/components/painel-de-custo";
import { obterFicha, opcoesDeItem } from "@/modules/cardapio/services/fichas";

export default async function PaginaFicha({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");
  if (!pode(contexto, "cardapio.ver")) notFound();

  const { id } = await params;
  const ficha = await obterFicha(contexto, id);
  if (!ficha) notFound();

  const podeEditar = pode(contexto, "cardapio.editar");
  const podeVerCustos = pode(contexto, "cardapio.custos");
  const opcoes = await opcoesDeItem(contexto, id);

  /**
   * As linhas do banco e as linhas do cálculo andam pelo ÍNDICE: a conta
   * recebeu os itens na mesma ordem em que vieram, então a posição casa. Casar
   * por nome quebraria no dia em que dois ingredientes tivessem o mesmo — e
   * "Molho" de tomate e "Molho" branco convivem em qualquer cozinha.
   */
  const linhas: LinhaDaReceita[] = ficha.itens.map((item, indice) => {
    const custo = ficha.custoMedio.linhas[indice];
    return {
      itemId: item.id,
      nome: custo?.nome ?? "—",
      ehSubFicha: custo?.ehSubFicha ?? false,
      quantidade: item.quantidade,
      unidade: item.unidade,
      quantidadeBruta: custo?.quantidadeBruta ?? item.quantidade,
      perdaPercentual: item.perdaPercentual,
      custo: custo?.custo ?? 0,
      observacao: item.observacao,
      problema: custo?.problema ?? null,
    };
  });

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href="/cardapio/fichas"
            className="text-ink-3 hover:text-ink text-sm"
          >
            ← Fichas técnicas
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {ficha.nome}
            {!ficha.ativo && (
              <span className="bg-surface-3 text-ink-3 ml-2 rounded-full px-2 py-1 align-middle text-xs font-semibold">
                desativada
              </span>
            )}
          </h1>
          <p className="text-ink-3 mt-1 text-sm">
            {ficha.tipo === "PRATO" ? "Prato" : "Preparo"}
            {ficha.categoria ? ` · ${ficha.categoria}` : ""}
          </p>
        </div>

        {podeEditar && (
          <form action={alternarFichaAcao}>
            <input type="hidden" name="id" value={ficha.id} />
            <Botao peso="secundario" tamanho="pequeno" type="submit">
              {ficha.ativo ? "Desativar" : "Reativar"}
            </Botao>
          </form>
        )}
      </div>

      {podeVerCustos && (
        <div className="mt-6">
          <PainelDeCusto ficha={ficha} />
        </div>
      )}

      <div className="mt-8">
        <EditorDeReceita
          fichaId={ficha.id}
          linhas={linhas}
          opcoes={opcoes}
          podeVerCustos={podeVerCustos}
          podeEditar={podeEditar}
        />
      </div>

      {ficha.modoDePreparo && (
        <section className="mt-10">
          <h2 className="font-semibold">Modo de preparo</h2>
          <p className="text-ink-2 border-line mt-2 rounded-xl border px-4 py-3 text-sm whitespace-pre-line">
            {ficha.modoDePreparo}
          </p>
        </section>
      )}

      {podeEditar && (
        <section className="mt-10">
          <h2 className="font-semibold">Dados da ficha</h2>
          <div className="mt-3">
            <FormularioFicha
              ficha={{
                id: ficha.id,
                nome: ficha.nome,
                categoria: ficha.categoria,
                tipo: ficha.tipo,
                modoDePreparo: ficha.modoDePreparo,
                rendimento: paraCampo(ficha.rendimento),
                unidadeRendimento: ficha.unidadeRendimento,
                precoVenda: paraCampo(ficha.precoVenda, 2),
              }}
              podeVerCustos={podeVerCustos}
            />
          </div>
        </section>
      )}
    </div>
  );
}
