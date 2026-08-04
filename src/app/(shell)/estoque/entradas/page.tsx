import Link from "next/link";
import { redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { Botao } from "@/design-system/botao";
import { AvisoUnidade } from "@/modules/estoque/components/aviso-unidade";
import { ListaNotas } from "@/modules/estoque/components/lista-notas";
import { listarNotas } from "@/modules/estoque/services/notas";

export default async function PaginaEntradas() {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const podeLancar = pode(contexto, "estoque.lancar");

  if (!contexto.unidadeAtiva) {
    return (
      <div className="mx-auto w-full max-w-5xl">
        <Cabecalho />
        <div className="mt-6">
          <AvisoUnidade acao="Lançar entrada de mercadoria" />
        </div>
      </div>
    );
  }

  const notas = await listarNotas(contexto);
  const rascunho = notas.find((n) => n.status === "RASCUNHO");

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <Cabecalho unidade={contexto.unidadeAtiva.nome} />
        {podeLancar && notas.length > 0 && (
          <Link href="/estoque/entradas/nova">
            <Botao>Nova nota</Botao>
          </Link>
        )}
      </div>

      {/* Nota pela metade é o estado normal de quem foi interrompido no meio
          da digitação. Merece atalho. */}
      {rascunho && (
        <Link
          href={`/estoque/entradas/${rascunho.id}`}
          className="border-line bg-surface-2 hover:border-accent mt-5 flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors"
        >
          <span aria-hidden className="text-lg">
            🧾
          </span>
          <span className="min-w-0 flex-1 text-sm">
            <span className="block font-semibold">
              Nota de {rascunho.fornecedor.nome} ainda em rascunho
            </span>
            <span className="text-ink-3 block">
              {rascunho.totalItens}{" "}
              {rascunho.totalItens === 1 ? "item" : "itens"} · não entrou no
              estoque ainda
            </span>
          </span>
          <span className="text-ink-3 flex-none text-sm">Continuar →</span>
        </Link>
      )}

      <div className="mt-6">
        <ListaNotas
          notas={notas.map((n) => ({
            id: n.id,
            recebidaEm: n.recebidaEm,
            numero: n.numero,
            serie: n.serie,
            status: n.status,
            // Decimal não atravessa para o navegador: vira texto aqui.
            valorTotal: n.valorTotal.toString(),
            totalItens: n.totalItens,
            fornecedor: n.fornecedor,
          }))}
          podeLancar={podeLancar}
        />
      </div>
    </div>
  );
}

function Cabecalho({ unidade }: { unidade?: string }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Entradas</h1>
      <p className="text-ink-3 mt-1 text-sm">
        {unidade ? `Notas de compra · ${unidade}` : "Notas de compra"}
      </p>
    </div>
  );
}
