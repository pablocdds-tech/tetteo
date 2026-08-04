import Link from "next/link";

import { Botao } from "@/design-system/botao";

import { desativarRotinaAcao, executarRotinaAcao } from "../acoes";
import type { RotinaDoDia } from "../services/rotinas";

const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

const data = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
});

function agendaEmTexto(r: RotinaDoDia) {
  const hora = r.horario ? ` às ${r.horario}` : "";
  if (r.recorrencia === "DIARIA") return `Todo dia${hora}`;
  if (r.recorrencia === "SEMANAL")
    return `Toda ${DIAS[r.diaDaSemana ?? 1]}${hora}`;
  return `Todo dia ${r.diaDoMes ?? 1}${hora}`;
}

function Selo({ status }: { status: RotinaDoDia["status"] }) {
  const texto = {
    feita: "Feito",
    aguardando: "Aguardando",
    atrasada: "Atrasado",
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
 * A LISTA DO DIA — a tela inicial do módulo.
 *
 * Não é um cadastro, é uma fila de trabalho. Atrasado em cima, depois o que
 * vence hoje, depois o que já foi feito; dentro de cada grupo, a ordem é a do
 * relógio. Quem chega às 7h lê de cima para baixo e sabe o que fazer sem
 * perguntar a ninguém.
 *
 * A nota do último fechamento aparece ao lado do "Feito" de propósito: sem
 * ela, "feito" e "feito com 60%" seriam a mesma linha verde, e a tela
 * premiaria quem só marca caixinha.
 */
export function PainelDoDia({
  rotinas,
  podeResponder,
  podeEditar,
}: {
  rotinas: RotinaDoDia[];
  podeResponder: boolean;
  podeEditar: boolean;
}) {
  if (rotinas.length === 0) {
    return (
      <div className="border-line-2 bg-surface-2 rounded-xl border border-dashed px-6 py-10 text-center">
        <p aria-hidden className="text-2xl opacity-50">
          ✅
        </p>
        <p className="mt-2 font-semibold">Nenhum checklist agendado ainda</p>
        <p className="text-ink-3 mx-auto mt-1 max-w-md text-sm">
          Escreva um modelo — &quot;Abertura da Pizzaria&quot;, com as perguntas
          na ordem em que se anda pela loja — e depois agende para esta unidade.
          A partir daí a tela cobra sozinha o que estiver atrasado.
        </p>
        {podeEditar && (
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Link href="/checklists/modelos/novo">
              <Botao>Criar o primeiro checklist</Botao>
            </Link>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="border-line divide-line divide-y rounded-xl border">
      {rotinas.map((r) => (
        <div
          key={r.id}
          className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3"
        >
          <div className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{r.nome}</span>
            <span className="text-ink-3 block truncate text-xs">
              {agendaEmTexto(r)}
              {r.responsavel ? ` · ${r.responsavel.nome}` : ""} · {r.totalItens}{" "}
              {r.totalItens === 1 ? "item" : "itens"}
            </span>
          </div>

          <div className="text-ink-3 hidden text-right text-xs tabular-nums sm:block">
            <span className="block">
              última {r.ultimaFechadaEm ? data.format(r.ultimaFechadaEm) : "—"}
              {r.ultimaPontuacao !== null && (
                <span
                  className={
                    r.ultimaPontuacao >= 90
                      ? "text-ok font-semibold"
                      : r.ultimaPontuacao >= 70
                        ? "text-warn font-semibold"
                        : "text-bad font-semibold"
                  }
                >
                  {" "}
                  · {r.ultimaPontuacao.toLocaleString("pt-BR")}%
                </span>
              )}
            </span>
            <span className="block">próxima {data.format(r.proxima)}</span>
          </div>

          <Selo status={r.status} />

          <div className="flex items-center gap-1">
            {podeResponder && (
              <form action={executarRotinaAcao}>
                <input type="hidden" name="rotinaId" value={r.id} />
                <Botao
                  tamanho="pequeno"
                  peso={r.status === "feita" ? "secundario" : "primario"}
                  type="submit"
                >
                  {r.respostaAbertaId ? "Continuar" : "Responder"}
                </Botao>
              </form>
            )}
            {podeEditar && (
              <form action={desativarRotinaAcao}>
                <input type="hidden" name="rotinaId" value={r.id} />
                <Botao peso="fantasma" tamanho="pequeno" type="submit">
                  Remover
                </Botao>
              </form>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
