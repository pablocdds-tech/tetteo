import Link from "next/link";

import { Botao } from "@/design-system/botao";

type Linha = {
  id: string;
  referencia: Date;
  descricao: string | null;
  categorias: string[];
  status: string;
  totalItens: number;
  itensContados: number;
};

const dataHora = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function Selo({ status }: { status: string }) {
  const estilo =
    status === "FECHADA" ? "bg-ok-sub text-ok" : "bg-warn-sub text-warn";

  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${estilo}`}
    >
      {status === "FECHADA" ? "Fechada" : "Aberta"}
    </span>
  );
}

/**
 * A lista de contagens.
 *
 * A coluna que mais importa é a de progresso: uma contagem aberta pela metade
 * é a situação normal — começa na câmara fria, para para atender, volta
 * depois. A tela precisa dizer de longe onde a pessoa parou.
 */
export function ListaContagens({
  contagens,
  podeContar,
}: {
  contagens: Linha[];
  podeContar: boolean;
}) {
  if (contagens.length === 0) {
    return (
      <div className="border-line-2 bg-surface-2 rounded-xl border border-dashed px-6 py-10 text-center">
        <p aria-hidden className="text-2xl opacity-50">
          📋
        </p>
        <p className="mt-2 font-semibold">Nenhuma contagem ainda</p>
        <p className="text-ink-3 mx-auto mt-1 max-w-md text-sm">
          A primeira contagem é o ponto de partida do CMV: sem ela o sistema não
          tem de onde começar a contar o que foi consumido. Quanto antes ela for
          feita, antes você tem o primeiro número.
        </p>
        {podeContar && (
          <Link href="/estoque/contagens/nova" className="mt-4 inline-block">
            <Botao>Abrir a primeira contagem</Botao>
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
              Referência
            </th>
            <th className="text-ink-3 px-4 py-2.5 text-left text-xs font-semibold tracking-wider uppercase">
              Escopo
            </th>
            <th className="text-ink-3 px-4 py-2.5 text-right text-xs font-semibold tracking-wider uppercase">
              Contados
            </th>
            <th className="text-ink-3 px-4 py-2.5 text-left text-xs font-semibold tracking-wider uppercase">
              Situação
            </th>
            <th className="w-px px-4 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {contagens.map((c) => (
            <tr
              key={c.id}
              className="border-line hover:bg-surface-2 border-b last:border-b-0"
            >
              <td className="px-4 py-2.5">
                <span className="text-ink block font-medium tabular-nums">
                  {dataHora.format(c.referencia)}
                </span>
                {c.descricao && (
                  <span className="text-ink-3 block text-xs">
                    {c.descricao}
                  </span>
                )}
              </td>
              <td className="text-ink-2 px-4 py-2.5">
                {c.categorias.length === 0
                  ? "Contagem cheia"
                  : c.categorias.join(", ")}
              </td>
              <td className="text-ink px-4 py-2.5 text-right tabular-nums">
                {c.itensContados}
                <span className="text-ink-3"> / {c.totalItens}</span>
              </td>
              <td className="px-4 py-2.5">
                <Selo status={c.status} />
              </td>
              <td className="px-4 py-2.5 text-right">
                <Link href={`/estoque/contagens/${c.id}`}>
                  <Botao peso="secundario" tamanho="pequeno">
                    {c.status === "ABERTA" ? "Continuar" : "Ver"}
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
