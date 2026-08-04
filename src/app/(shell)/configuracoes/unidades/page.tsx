import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { alternarUnidadeAcao } from "@/core/configuracoes/acoes";
import { listarUnidades } from "@/core/configuracoes/servicos";
import { obterContexto, pode } from "@/core/sessao/contexto";
import { Botao } from "@/design-system/botao";

export default async function PaginaUnidades() {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");
  if (!pode(contexto, "configuracoes.ver")) notFound();

  const podeEditar = pode(contexto, "configuracoes.editar");
  const unidades = await listarUnidades(contexto);

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Unidades</h1>
          <p className="text-ink-3 mt-1 text-sm">
            As lojas da rede · {unidades.filter((u) => u.ativa).length} ativa
            {unidades.filter((u) => u.ativa).length === 1 ? "" : "s"}
          </p>
        </div>

        {podeEditar && (
          <Link href="/configuracoes/unidades/nova">
            <Botao>Nova loja</Botao>
          </Link>
        )}
      </div>

      {/* O estoque, as contagens e o CMV são POR LOJA. Deixar isso escrito
          aqui evita a pergunta "por que meu estoque sumiu?" ao trocar de
          unidade no seletor do topo. */}
      <p className="text-ink-3 mt-5 text-sm">
        Cada loja tem estoque, contagens e CMV próprios. O seletor no topo da
        tela é o que decide em qual delas você está trabalhando.
      </p>

      <div className="border-line divide-line mt-4 divide-y rounded-xl border">
        {unidades.map((u) => (
          <div
            key={u.id}
            className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 ${u.ativa ? "" : "opacity-55"}`}
          >
            <div className="min-w-0 flex-1">
              <span className="block text-sm font-medium">
                {u.nome}
                <span className="text-ink-3 ml-2 font-mono text-xs">
                  {u.codigo}
                </span>
                {!u.ativa && (
                  <span className="bg-warn-sub text-warn ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold">
                    desativada
                  </span>
                )}
              </span>
              <span className="text-ink-3 block truncate text-xs">
                {[u.cidade, u.estado].filter(Boolean).join(" · ") ||
                  "sem endereço"}
                {u._count.acessos > 0 &&
                  ` · ${u._count.acessos} ${u._count.acessos === 1 ? "pessoa" : "pessoas"}`}
              </span>
            </div>

            {podeEditar && (
              <div className="flex items-center gap-1">
                <Link href={`/configuracoes/unidades/${u.id}`}>
                  <Botao peso="secundario" tamanho="pequeno">
                    Editar
                  </Botao>
                </Link>
                <form action={alternarUnidadeAcao}>
                  <input type="hidden" name="id" value={u.id} />
                  <Botao peso="fantasma" tamanho="pequeno" type="submit">
                    {u.ativa ? "Desativar" : "Reativar"}
                  </Botao>
                </form>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
