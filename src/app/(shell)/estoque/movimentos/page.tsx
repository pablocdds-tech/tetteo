import { notFound, redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { formatarMoeda } from "@/lib/numero";
import { AvisoUnidade } from "@/modules/estoque/components/aviso-unidade";
import { PainelDeMovimentos } from "@/modules/estoque/components/painel-de-movimentos";
import { listarInsumos } from "@/modules/cardapio/services/insumos";
import {
  listarMovimentos,
  perdasDoPeriodo,
} from "@/modules/estoque/services/movimentos";
import { listarLocais } from "@/modules/estoque/services/rotinas";

export default async function PaginaMovimentos() {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");
  if (!pode(contexto, "estoque.ver")) notFound();

  if (!contexto.unidadeAtiva) {
    return (
      <div className="mx-auto w-full max-w-4xl">
        <Cabecalho />
        <div className="mt-6">
          <AvisoUnidade acao="Movimentar estoque" />
        </div>
      </div>
    );
  }

  const podeVerValor = pode(contexto, "estoque.custos");
  const agora = new Date();
  const inicioDoMes = new Date(agora.getFullYear(), agora.getMonth(), 1);

  const [movimentos, insumos, locais, perdas] = await Promise.all([
    listarMovimentos(contexto),
    listarInsumos(contexto),
    listarLocais(contexto),
    podeVerValor
      ? perdasDoPeriodo(contexto, inicioDoMes, agora)
      : Promise.resolve(null),
  ]);

  return (
    <div className="mx-auto w-full max-w-4xl">
      <Cabecalho unidade={contexto.unidadeAtiva.nome} />

      {/* O número que a tela existe para produzir. Perda anotada e não somada
          continua invisível — e o que é invisível não muda comportamento. */}
      {perdas && perdas.total > 0 && (
        <div className="border-line bg-surface-2 mt-6 rounded-xl border p-4">
          <span className="text-ink-3 block text-xs font-semibold tracking-wide uppercase">
            Foi para o lixo neste mês
          </span>
          <span className="text-bad mt-1 block text-3xl font-semibold tabular-nums">
            {formatarMoeda(perdas.total)}
          </span>
          <div className="text-ink-3 mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {perdas.porMotivo.slice(0, 4).map((l) => (
              <span key={l.chave}>
                {l.chave}: <strong>{formatarMoeda(l.valor)}</strong>
                {l.percentual !== null
                  ? ` (${l.percentual.toLocaleString("pt-BR")}%)`
                  : ""}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-6">
        <PainelDeMovimentos
          movimentos={movimentos}
          insumos={insumos.map((i) => ({
            id: i.id,
            nome: i.nome,
            unidade: i.unidadeRotulo ?? i.unidadeMedida,
          }))}
          locais={locais}
          podeRegistrar={pode(contexto, "estoque.contar")}
          podeVerValor={podeVerValor}
        />
      </div>
    </div>
  );
}

function Cabecalho({ unidade }: { unidade?: string }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Movimentos</h1>
      <p className="text-ink-3 mt-1 text-sm">
        {unidade
          ? `Tudo que entrou, saiu e mudou de lugar · ${unidade}`
          : "Tudo que entrou, saiu e mudou de lugar"}
      </p>
    </div>
  );
}
