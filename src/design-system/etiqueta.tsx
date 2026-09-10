import type { ReactNode } from "react";

/**
 * A ETIQUETA DE ESTADO.
 *
 * Sempre PONTO + TEXTO, nunca só cor.
 *
 * Oito por cento dos homens não distinguem vermelho de verde. Num sistema em
 * que "vencido" e "quitado" se diferenciam só pela cor da bolinha, essas
 * pessoas não usam o sistema — elas adivinham. E antes de ser acessibilidade,
 * é legibilidade para todo mundo: numa tabela com trinta linhas, ler a palavra
 * é mais rápido do que decodificar a cor.
 *
 * O ponto continua existindo porque ele é o que se enxerga de longe, ao
 * varrer a coluna. Os dois juntos: o ponto acha, a palavra confirma.
 */

type Tom = "neutro" | "ok" | "aviso" | "ruim" | "info" | "acento";

const TONS: Record<Tom, { caixa: string; ponto: string }> = {
  neutro: { caixa: "bg-surface-2 text-ink-2 border-line", ponto: "bg-ink-3" },
  ok: { caixa: "bg-ok-sub text-ok border-ok/25", ponto: "bg-ok" },
  aviso: { caixa: "bg-warn-sub text-warn border-warn/25", ponto: "bg-warn" },
  ruim: { caixa: "bg-bad-sub text-bad border-bad/25", ponto: "bg-bad" },
  info: { caixa: "bg-info-sub text-info border-info/25", ponto: "bg-info" },
  acento: {
    caixa: "bg-accent-sub text-accent border-accent/25",
    ponto: "bg-accent",
  },
};

export function Etiqueta({
  tom = "neutro",
  children,
  semPonto = false,
  className = "",
}: {
  tom?: Tom;
  children: ReactNode;
  /** Para rótulos que não são estado — uma contagem, uma categoria. */
  semPonto?: boolean;
  className?: string;
}) {
  const estilo = TONS[tom];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-xs leading-[18px] font-semibold whitespace-nowrap ${estilo.caixa} ${className}`}
    >
      {!semPonto && (
        <span
          aria-hidden="true"
          className={`size-1.5 flex-none rounded-full ${estilo.ponto}`}
        />
      )}
      {children}
    </span>
  );
}
