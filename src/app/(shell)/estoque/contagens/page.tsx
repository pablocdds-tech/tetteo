import Link from "next/link";
import { redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { Botao } from "@/design-system/botao";
import { AvisoUnidade } from "@/modules/estoque/components/aviso-unidade";
import { ListaContagens } from "@/modules/estoque/components/lista-contagens";
import { listarContagens } from "@/modules/estoque/services/contagens";

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

  const contagens = await listarContagens(contexto);
  const aberta = contagens.find((c) => c.status === "ABERTA");

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <Cabecalho unidade={contexto.unidadeAtiva.nome} />

        {podeContar && contagens.length > 0 && (
          <Link href="/estoque/contagens/nova">
            <Botao>Nova contagem</Botao>
          </Link>
        )}
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
            </span>
            <span className="text-ink-3 block">
              {aberta.itensContados} de {aberta.totalItens} itens contados
            </span>
          </span>
          <span className="text-ink-3 flex-none text-sm">Continuar →</span>
        </Link>
      )}

      <div className="mt-6">
        <ListaContagens contagens={contagens} podeContar={podeContar} />
      </div>
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
