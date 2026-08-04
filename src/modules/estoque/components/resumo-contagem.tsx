import { formatarMoeda, formatarQuantidade } from "@/lib/numero";
import { sigla } from "@/lib/unidades";

/** O valor de uma linha, em centavos fechados — do jeito que aparece na tela. */
function valorDaLinha(item: {
  quantidade: string | null;
  custoUnitario: string;
}) {
  if (item.quantidade === null) return 0;
  return (
    Math.round(Number(item.quantidade) * Number(item.custoUnitario) * 100) / 100
  );
}

type ItemDoResumo = {
  insumoId: string;
  nome: string;
  categoria: string | null;
  unidadeMedida: string;
  quantidade: string | null;
  custoUnitario: string;
};

/**
 * A contagem depois de fechada.
 *
 * Só leitura, e de propósito: este número já pode ter servido de base para um
 * CMV que alguém leu e usou para decidir. Deixar editar aqui reescreveria o
 * passado em silêncio.
 *
 * O valor só aparece para quem tem permissão de custos. Quem conta a câmara
 * fria vê quilos; não precisa saber quanto a mussarela custa.
 */
export function ResumoContagem({
  itens,
  podeVerCustos,
}: {
  itens: ItemDoResumo[];
  podeVerCustos: boolean;
}) {
  const contados = itens.filter((i) => i.quantidade !== null);
  const emBranco = itens.length - contados.length;

  // O total soma os valores JÁ ARREDONDADOS de cada linha, não os valores
  // cheios. Somando os cheios, 12,75 × 38,90 entra como 495,975 e o total
  // fecha um centavo acima da soma das linhas que estão na tela — quem
  // confere na calculadora encontra a diferença e para de confiar no número.
  const total = contados.reduce((soma, i) => soma + valorDaLinha(i), 0);

  return (
    <div className="flex flex-col gap-4">
      {podeVerCustos && (
        <div className="border-line bg-surface-2 flex flex-wrap items-baseline gap-x-6 gap-y-1 rounded-xl border px-5 py-4">
          <div>
            <p className="text-ink-3 font-mono text-[11px] tracking-[0.14em] uppercase">
              Valor do estoque contado
            </p>
            <p className="text-2xl font-semibold tabular-nums">
              {formatarMoeda(total)}
            </p>
          </div>
          <p className="text-ink-3 text-sm">
            {contados.length} {contados.length === 1 ? "item" : "itens"}
            {emBranco > 0 && ` · ${emBranco} em branco, fora da conta`}
          </p>
        </div>
      )}

      <div className="border-line overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="bg-surface-2 border-line border-b">
              <th className="text-ink-3 px-4 py-2.5 text-left text-xs font-semibold tracking-wider uppercase">
                Insumo
              </th>
              <th className="text-ink-3 px-4 py-2.5 text-right text-xs font-semibold tracking-wider uppercase">
                Contado
              </th>
              {podeVerCustos && (
                <>
                  <th className="text-ink-3 px-4 py-2.5 text-right text-xs font-semibold tracking-wider uppercase">
                    Custo
                  </th>
                  <th className="text-ink-3 px-4 py-2.5 text-right text-xs font-semibold tracking-wider uppercase">
                    Valor
                  </th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {itens.map((i) => (
              <tr
                key={i.insumoId}
                className="border-line border-b last:border-b-0"
              >
                <td className="px-4 py-2.5">
                  <span className="text-ink block font-medium">{i.nome}</span>
                  {i.categoria && (
                    <span className="text-ink-3 block text-xs">
                      {i.categoria}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {i.quantidade === null ? (
                    // Não é zero. É "ninguém contou" — e a diferença muda o CMV.
                    <span className="text-ink-3">não contado</span>
                  ) : (
                    <>
                      {formatarQuantidade(i.quantidade)}{" "}
                      <span className="text-ink-3">
                        {sigla(i.unidadeMedida)}
                      </span>
                    </>
                  )}
                </td>
                {podeVerCustos && (
                  <>
                    <td className="text-ink-2 px-4 py-2.5 text-right tabular-nums">
                      {formatarMoeda(i.custoUnitario)}
                    </td>
                    <td className="text-ink px-4 py-2.5 text-right font-medium tabular-nums">
                      {i.quantidade === null
                        ? "—"
                        : formatarMoeda(valorDaLinha(i))}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
