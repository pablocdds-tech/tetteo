import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { Botao, estiloDeBotao } from "@/design-system/botao";
import { alternarModeloAcao } from "@/modules/checklists/acoes";
import { listarModelos } from "@/modules/checklists/services/modelos";

/**
 * Os modelos são da REDE, não da loja — por isso esta é a única tela do módulo
 * que funciona com o seletor em "Rede Completa". Escrever o checklist é
 * trabalho de escritório; respondê-lo é trabalho de loja.
 */
export default async function PaginaModelos() {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");
  if (!pode(contexto, "checklists.editar")) notFound();

  const modelos = await listarModelos(contexto);

  return (
    <div className="mx-auto w-full max-w-4xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Modelos</h1>
          <p className="text-ink-3 mt-1 text-sm">
            As perguntas. Valem para a rede inteira — a mesma abertura nas duas
            lojas é o que torna a comparação honesta.
          </p>
        </div>

        <Link href="/checklists/modelos/novo" className={estiloDeBotao()}>
          Novo checklist
        </Link>
      </div>

      {modelos.length === 0 ? (
        <div className="border-line-2 bg-surface-2 mt-6 rounded-xl border border-dashed px-6 py-10 text-center">
          <p className="font-semibold">Nenhum checklist escrito ainda</p>
          <p className="text-ink-3 mx-auto mt-1 max-w-md text-sm">
            Comece pelo que já se faz todo dia sem estar no papel: a abertura da
            loja. Escreva as perguntas na ordem em que se anda pela cozinha.
          </p>
        </div>
      ) : (
        <div className="border-line divide-line mt-6 divide-y rounded-xl border">
          {modelos.map((m) => (
            <div
              key={m.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <span className="block text-sm font-medium">
                  {m.nome}
                  {!m.ativo && (
                    <span className="bg-surface-3 text-ink-3 ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold">
                      desativado
                    </span>
                  )}
                </span>
                <span className="text-ink-3 block truncate text-xs">
                  {m.descricao ??
                    `${m._count.itens} ${m._count.itens === 1 ? "pergunta" : "perguntas"}`}
                </span>
              </div>

              <span className="text-ink-3 hidden text-xs tabular-nums sm:block">
                {m._count.itens}{" "}
                {m._count.itens === 1 ? "pergunta" : "perguntas"} ·{" "}
                {m._count.rotinas} {m._count.rotinas === 1 ? "loja" : "lojas"}
              </span>

              <div className="flex items-center gap-1">
                <Link
                  href={`/checklists/modelos/${m.id}`}
                  className={estiloDeBotao("secundario", "pequeno")}
                >
                  Editar
                </Link>
                <form action={alternarModeloAcao}>
                  <input type="hidden" name="id" value={m.id} />
                  <Botao peso="fantasma" tamanho="pequeno" type="submit">
                    {m.ativo ? "Desativar" : "Reativar"}
                  </Botao>
                </form>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
