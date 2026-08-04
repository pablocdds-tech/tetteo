import Link from "next/link";
import { redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { Botao } from "@/design-system/botao";
import { AvisoUnidade } from "@/modules/estoque/components/aviso-unidade";
import { ListaContagens } from "@/modules/estoque/components/lista-contagens";
import { PainelDeRotinas } from "@/modules/estoque/components/painel-de-rotinas";
import { listarContagens } from "@/modules/estoque/services/contagens";
import { listarRotinas } from "@/modules/estoque/services/rotinas";

/** A rota só delega: quem sabe o que é uma contagem é o App, não o roteamento. */
export default async function PaginaContagens() {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const podeContar = pode(contexto, "estoque.contar");

  if (!contexto.unidadeAtiva) {
    return (
      <div className="mx-auto w-full max-w-5xl">
        <Cabecalho />
        <div className="mt-6">
          <AvisoUnidade acao="Contar estoque" />
        </div>
      </div>
    );
  }

  const [contagens, rotinas] = await Promise.all([
    listarContagens(contexto),
    listarRotinas(contexto),
  ]);
  const aberta = contagens.find((c) => c.status === "ABERTA");

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <Cabecalho unidade={contexto.unidadeAtiva.nome} />

        {podeContar && (
          <Link href="/estoque/contagens/nova">
            <Botao peso={rotinas.length > 0 ? "secundario" : "primario"}>
              Contagem avulsa
            </Botao>
          </Link>
        )}
      </div>

      <div className="mt-6">
        <PainelDeRotinas rotinas={rotinas} podeContar={podeContar} />
      </div>

      {/* Uma contagem aberta é trabalho pela metade. Vale um atalho: a pessoa
          quase sempre voltou para terminar aquilo. */}
      {aberta && (
        <Link
          href={`/estoque/contagens/${aberta.id}`}
          className="border-line bg-surface-2 hover:border-accent mt-5 flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors"
        >
          <span aria-hidden className="text-lg">
            ✏️
          </span>
          <span className="min-w-0 flex-1 text-sm">
            <span className="block font-semibold">
              Você tem uma contagem em andamento
              {aberta.descricao ? `: ${aberta.descricao}` : ""}
            </span>
            <span className="text-ink-3 block">
              {aberta.itensContados} de {aberta.totalItens} itens contados
            </span>
          </span>
          <span className="text-ink-3 flex-none text-sm">Continuar →</span>
        </Link>
      )}

      <section className="mt-8">
        <h2 className="mb-3 font-semibold">Histórico</h2>
        <ListaContagens contagens={contagens} podeContar={podeContar} />
      </section>
    </div>
  );
}

function Cabecalho({ unidade }: { unidade?: string }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Contagens</h1>
      <p className="text-ink-3 mt-1 text-sm">
        {unidade ? `Estoque físico · ${unidade}` : "Estoque físico"}
      </p>
    </div>
  );
}
