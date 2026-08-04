import Link from "next/link";

import { Botao } from "@/design-system/botao";
import { formatarMoeda } from "@/lib/numero";

type Linha = {
  id: string;
  recebidaEm: Date;
  numero: string | null;
  serie: string | null;
  status: string;
  valorTotal: string;
  totalItens: number;
  fornecedor: { nome: string };
};

const data = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

function Selo({ status }: { status: string }) {
  const estilo =
    status === "LANCADA" ? "bg-ok-sub text-ok" : "bg-warn-sub text-warn";
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${estilo}`}
    >
      {status === "LANCADA" ? "Lançada" : "Rascunho"}
    </span>
  );
}

export function ListaNotas({
  notas,
  podeLancar,
}: {
  notas: Linha[];
  podeLancar: boolean;
}) {
  if (notas.length === 0) {
    return (
      <div className="border-line-2 bg-surface-2 rounded-xl border border-dashed px-6 py-10 text-center">
        <p aria-hidden className="text-2xl opacity-50">
          🧾
        </p>
        <p className="mt-2 font-semibold">Nenhuma nota lançada ainda</p>
        <p className="text-ink-3 mx-auto mt-1 max-w-md text-sm">
          É a segunda metade do CMV. Com as contagens de um lado e as compras do
          período do outro, o sistema calcula quanto foi consumido de verdade —
          sem depender de ficha técnica nem do PDV.
        </p>
        {podeLancar && (
          <Link href="/estoque/entradas/nova" className="mt-4 inline-block">
            <Botao>Lançar a primeira nota</Botao>
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="border-line overflow-x-auto rounded-xl border">
      <table className="w-full min-w-[620px] text-sm">
        <thead>
          <tr className="bg-surface-2 border-line border-b">
            <th className="text-ink-3 px-4 py-2.5 text-left text-xs font-semibold tracking-wider uppercase">
              Chegou
            </th>
            <th className="text-ink-3 px-4 py-2.5 text-left text-xs font-semibold tracking-wider uppercase">
              Fornecedor
            </th>
            <th className="text-ink-3 px-4 py-2.5 text-right text-xs font-semibold tracking-wider uppercase">
              Itens
            </th>
            <th className="text-ink-3 px-4 py-2.5 text-right text-xs font-semibold tracking-wider uppercase">
              Valor
            </th>
            <th className="text-ink-3 px-4 py-2.5 text-left text-xs font-semibold tracking-wider uppercase">
              Situação
            </th>
            <th className="w-px px-4 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {notas.map((n) => (
            <tr
              key={n.id}
              className="border-line hover:bg-surface-2 border-b last:border-b-0"
            >
              <td className="text-ink px-4 py-2.5 font-medium tabular-nums">
                {data.format(n.recebidaEm)}
              </td>
              <td className="px-4 py-2.5">
                <span className="text-ink block">{n.fornecedor.nome}</span>
                {n.numero && (
                  <span className="text-ink-3 block text-xs tabular-nums">
                    nº {n.numero}
                    {n.serie ? `/${n.serie}` : ""}
                  </span>
                )}
              </td>
              <td className="text-ink-2 px-4 py-2.5 text-right tabular-nums">
                {n.totalItens}
              </td>
              <td className="text-ink px-4 py-2.5 text-right font-medium tabular-nums">
                {formatarMoeda(n.valorTotal)}
              </td>
              <td className="px-4 py-2.5">
                <Selo status={n.status} />
              </td>
              <td className="px-4 py-2.5 text-right">
                <Link href={`/estoque/entradas/${n.id}`}>
                  <Botao peso="secundario" tamanho="pequeno">
                    {n.status === "RASCUNHO" ? "Continuar" : "Ver"}
                  </Botao>
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
