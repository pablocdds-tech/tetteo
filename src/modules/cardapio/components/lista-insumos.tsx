import Link from "next/link";

import { Botao } from "@/design-system/botao";

import { removerInsumo } from "../acoes";
import { UNIDADES } from "../schemas/insumo";

type Linha = {
  id: string;
  nome: string;
  categoria: string | null;
  unidadeMedida: string;
  custoMedio: string;
  estoqueMinimo: string;
};

const moeda = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function sigla(valor: string) {
  return (
    UNIDADES.find((u) => u.valor === valor)?.rotulo.match(/\(([^)]+)\)/)?.[1] ??
    valor
  );
}

/**
 * A lista de insumos.
 *
 * Números alinhados à direita e tabulares: é o que permite comparar grandeza
 * batendo o olho, com as vírgulas alinhadas sozinhas.
 */
export function ListaInsumos({
  insumos,
  podeEditar,
  podeExcluir,
}: {
  insumos: Linha[];
  podeEditar: boolean;
  podeExcluir: boolean;
}) {
  // O estado vazio é o primeiro que TODO usuário encontra. "Nenhum registro"
  // desperdiça o único momento em que a pessoa está olhando e disposta a agir.
  if (insumos.length === 0) {
    return (
      <div className="border-line-2 bg-surface-2 rounded-xl border border-dashed px-6 py-10 text-center">
        <p aria-hidden className="text-2xl opacity-50">
          📦
        </p>
        <p className="mt-2 font-semibold">Nenhum insumo cadastrado ainda</p>
        <p className="text-ink-3 mx-auto mt-1 max-w-md text-sm">
          Cadastre os insumos que a pizzaria compra. Eles são a base das fichas
          técnicas — é a partir deles que o sistema calcula o custo real de cada
          prato.
        </p>
        {podeEditar && (
          <Link href="/cardapio/novo" className="mt-4 inline-block">
            <Botao>Cadastrar primeiro insumo</Botao>
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="border-line overflow-x-auto rounded-xl border">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="bg-surface-2 border-line border-b">
            <th className="text-ink-3 px-4 py-2.5 text-left text-xs font-semibold tracking-wider uppercase">
              Insumo
            </th>
            <th className="text-ink-3 px-4 py-2.5 text-left text-xs font-semibold tracking-wider uppercase">
              Categoria
            </th>
            <th className="text-ink-3 px-4 py-2.5 text-right text-xs font-semibold tracking-wider uppercase">
              Custo
            </th>
            <th className="text-ink-3 px-4 py-2.5 text-right text-xs font-semibold tracking-wider uppercase">
              Mínimo
            </th>
            <th className="w-px px-4 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {insumos.map((i) => (
            <tr
              key={i.id}
              className="border-line hover:bg-surface-2 border-b last:border-b-0"
            >
              <td className="text-ink px-4 py-2.5 font-medium">{i.nome}</td>
              <td className="text-ink-2 px-4 py-2.5">{i.categoria ?? "—"}</td>
              <td className="text-ink px-4 py-2.5 text-right tabular-nums">
                {moeda.format(Number(i.custoMedio))}
                <span className="text-ink-3">/{sigla(i.unidadeMedida)}</span>
              </td>
              <td className="text-ink px-4 py-2.5 text-right tabular-nums">
                {Number(i.estoqueMinimo).toLocaleString("pt-BR", {
                  minimumFractionDigits: 3,
                })}{" "}
                <span className="text-ink-3">{sigla(i.unidadeMedida)}</span>
              </td>
              <td className="px-4 py-2.5">
                <div className="flex items-center justify-end gap-1">
                  {podeEditar && (
                    <Link href={`/cardapio/${i.id}`}>
                      <Botao peso="secundario" tamanho="pequeno">
                        Editar
                      </Botao>
                    </Link>
                  )}
                  {podeExcluir && (
                    <form action={removerInsumo}>
                      <input type="hidden" name="id" value={i.id} />
                      <Botao peso="fantasma" tamanho="pequeno" type="submit">
                        Excluir
                      </Botao>
                    </form>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
