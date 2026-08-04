import Link from "next/link";

import { Botao } from "@/design-system/botao";

import { desativarRotinaAcao, executarRotinaAcao } from "../acoes";
import type { RotinaComStatus } from "../services/rotinas";

const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

const data = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
});

function agendaEmTexto(r: RotinaComStatus) {
  const hora = r.horario ? ` ${r.horario}` : "";
  if (r.recorrencia === "DIARIA") return `Diária${hora}`;
  if (r.recorrencia === "SEMANAL")
    return `Semanal (${DIAS[r.diaDaSemana ?? 1]})${hora}`;
  return `Mensal (dia ${r.diaDoMes ?? 1})${hora}`;
}

function escopoEmTexto(r: RotinaComStatus) {
  const partes = [];
  if (r.local) partes.push(r.local.nome);
  if (r.categorias.length > 0) partes.push(r.categorias.join(", "));
  return partes.length > 0 ? partes.join(" · ") : "Tudo";
}

function Selo({ status }: { status: RotinaComStatus["status"] }) {
  const texto = {
    feita: "Em dia",
    aguardando: "Aguardando",
    atrasada: "Atrasada",
  }[status];
  const estilo = {
    feita: "bg-ok-sub text-ok",
    aguardando: "bg-warn-sub text-warn",
    atrasada: "bg-bad-sub text-bad",
  }[status];

  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${estilo}`}
    >
      {texto}
    </span>
  );
}

/**
 * AS ROTINAS — a parte da tela que cobra.
 *
 * A ordem é por urgência, não alfabética: atrasada em cima, depois o que
 * vence hoje, depois o que está em dia. Quem abre a tela de manhã lê de cima
 * para baixo e sabe o que fazer.
 */
export function PainelDeRotinas({
  rotinas,
  podeContar,
}: {
  rotinas: RotinaComStatus[];
  podeContar: boolean;
}) {
  const peso = { atrasada: 0, aguardando: 1, feita: 2 };
  const ordenadas = [...rotinas].sort(
    (a, b) => peso[a.status] - peso[b.status],
  );

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Rotinas de contagem</h2>
        {podeContar && (
          <Link href="/estoque/contagens/rotinas/nova">
            <Botao peso="secundario" tamanho="pequeno">
              Nova rotina
            </Botao>
          </Link>
        )}
      </div>

      {ordenadas.length === 0 ? (
        <p className="text-ink-3 mt-2 text-sm">
          Nenhuma rotina ainda. Crie por exemplo &quot;Contagem da praça —
          diária às 7h&quot; ou &quot;Inventário completo — dia 1º&quot;: a tela
          passa a cobrar sozinha o que estiver atrasado.
        </p>
      ) : (
        <div className="border-line divide-line mt-3 divide-y rounded-xl border">
          {ordenadas.map((r) => (
            <div
              key={r.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <span className="text-ink block truncate text-sm font-medium">
                  {r.nome}
                </span>
                <span className="text-ink-3 block truncate text-xs">
                  {escopoEmTexto(r)} · {agendaEmTexto(r)}
                </span>
              </div>

              <div className="text-ink-3 hidden text-right text-xs tabular-nums sm:block">
                <span className="block">
                  última{" "}
                  {r.ultimaFechadaEm ? data.format(r.ultimaFechadaEm) : "—"}
                </span>
                <span className="block">próxima {data.format(r.proxima)}</span>
              </div>

              <Selo status={r.status} />

              {podeContar && (
                <div className="flex items-center gap-1">
                  <form action={executarRotinaAcao}>
                    <input type="hidden" name="rotinaId" value={r.id} />
                    <Botao
                      tamanho="pequeno"
                      peso={r.status === "feita" ? "secundario" : "primario"}
                      type="submit"
                    >
                      {r.contagemAbertaId ? "Continuar" : "Contar agora"}
                    </Botao>
                  </form>
                  <form action={desativarRotinaAcao}>
                    <input type="hidden" name="rotinaId" value={r.id} />
                    <Botao peso="fantasma" tamanho="pequeno" type="submit">
                      Remover
                    </Botao>
                  </form>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
