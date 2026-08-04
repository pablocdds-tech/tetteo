import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { excluirPapelAcao } from "@/core/configuracoes/acoes";
import { ListaPessoas } from "@/core/configuracoes/componentes/lista-pessoas";
import {
  listarPapeis,
  listarPessoas,
} from "@/core/configuracoes/servicos";
import { obterContexto, pode } from "@/core/sessao/contexto";
import { Botao } from "@/design-system/botao";

export default async function PaginaUsuarios() {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");
  if (!pode(contexto, "configuracoes.ver")) notFound();

  const podeEditar = pode(contexto, "configuracoes.editar");
  const [pessoas, papeis] = await Promise.all([
    listarPessoas(contexto),
    listarPapeis(contexto),
  ]);

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Usuários e papéis
          </h1>
          <p className="text-ink-3 mt-1 text-sm">
            Quem entra no Tetteo e o que cada um enxerga
          </p>
        </div>

        {podeEditar && (
          <Link href="/configuracoes/usuarios/novo">
            <Botao>Nova pessoa</Botao>
          </Link>
        )}
      </div>

      <section className="mt-6">
        <ListaPessoas
          pessoas={pessoas}
          papeis={papeis.map((p) => ({ id: p.id, nome: p.nome }))}
          podeEditar={podeEditar}
        />
        {pessoas.length === 1 && (
          <p className="text-ink-3 mt-3 text-sm">
            Só você usa o sistema hoje. Cadastrar a equipe é o que faz a
            contagem sair da sua mão — o pizzaiolo conta a praça sem ver preço
            de nada.
          </p>
        )}
      </section>

      <section className="mt-10">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold">Papéis</h2>
            <p className="text-ink-3 mt-1 text-sm">
              Um papel é um conjunto de permissões. Mudar o papel muda o que
              todas as pessoas nele enxergam, de uma vez.
            </p>
          </div>
          {podeEditar && (
            <Link href="/configuracoes/papeis/novo">
              <Botao peso="secundario" tamanho="pequeno">
                Novo papel
              </Botao>
            </Link>
          )}
        </div>

        <div className="border-line divide-line mt-3 divide-y rounded-xl border">
          {papeis.map((p) => (
            <div
              key={p.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <span className="block text-sm font-medium">
                  {p.nome}
                  {p.temCoringa && (
                    <span className="bg-accent-sub text-accent ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold">
                      acesso total
                    </span>
                  )}
                </span>
                <span className="text-ink-3 block truncate text-xs">
                  {p.descricao ??
                    (p.temCoringa
                      ? "Pode tudo, inclusive o que ainda não existe"
                      : `${p.permissoes.length} ${p.permissoes.length === 1 ? "permissão" : "permissões"}`)}
                </span>
              </div>

              <span className="text-ink-3 text-xs tabular-nums">
                {p.pessoas} {p.pessoas === 1 ? "pessoa" : "pessoas"}
              </span>

              {podeEditar && (
                <div className="flex items-center gap-1">
                  <Link href={`/configuracoes/papeis/${p.id}`}>
                    <Botao peso="secundario" tamanho="pequeno">
                      {p.temCoringa ? "Ver" : "Editar"}
                    </Botao>
                  </Link>
                  {!p.ehSistema && p.pessoas === 0 && (
                    <form action={excluirPapelAcao}>
                      <input type="hidden" name="id" value={p.id} />
                      <Botao peso="fantasma" tamanho="pequeno" type="submit">
                        Excluir
                      </Botao>
                    </form>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
