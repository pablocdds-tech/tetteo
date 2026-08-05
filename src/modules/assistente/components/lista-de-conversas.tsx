import type { ConversaNaLista } from "../services/conversas";

function quando(data: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(data);
}

/**
 * O que a Severina andou fazendo.
 *
 * A ordem NÃO é cronológica: falha primeiro, fila parada depois, e só então
 * por data. Aviso que não saiu é o defeito mais caro desta fase e o mais
 * silencioso — uma tela ordenada por data o esconderia no meio do histórico
 * exatamente quando ele importa.
 */
export function ListaDeConversas({
  conversas,
}: {
  conversas: ConversaNaLista[];
}) {
  if (conversas.length === 0) {
    return (
      <div className="border-line text-ink-3 rounded-xl border border-dashed px-4 py-10 text-center text-sm">
        Nenhuma conversa ainda. Assim que um agente ligado vencer, ela aparece
        aqui.
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {conversas.map((c) => (
        <li
          key={c.id}
          className={`bg-surface-2 flex flex-wrap items-start gap-3 rounded-xl border px-4 py-3 ${
            c.falhas > 0 ? "border-bad/50" : "border-line"
          }`}
        >
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{c.pessoa}</span>
              <span className="text-ink-3 text-sm">
                {c.agenteNome}
                {c.unidadeNome ? ` · ${c.unidadeNome}` : ""}
              </span>
            </span>

            {c.ultimoTexto && (
              <span className="text-ink-2 mt-1 block text-sm">
                {c.ultimoTexto}
              </span>
            )}

            <span className="mt-1.5 flex flex-wrap items-center gap-2">
              {c.falhas > 0 && (
                <span className="border-bad/40 bg-bad/10 text-bad rounded border px-1.5 py-0.5 text-xs font-semibold">
                  {c.falhas} não saiu
                </span>
              )}
              {c.pendentes > 0 && (
                <span className="border-line-2 text-ink-3 rounded border px-1.5 py-0.5 text-xs">
                  {c.pendentes} na fila
                </span>
              )}
            </span>
          </span>

          <span className="text-ink-3 flex-none text-sm">
            {quando(c.ultimaMensagemEm)}
          </span>
        </li>
      ))}
    </ul>
  );
}
