import Link from "next/link";

import type { LinhaDaFolha } from "./folha-de-checklist";

/**
 * O checklist FECHADO.
 *
 * Tela separada da folha de propósito. Um checklist fechado não é um
 * formulário travado: é um documento. Mostrar os mesmos campos, cinzentos e
 * desabilitados, convida a pessoa a tentar editar — e o que ela precisa aqui é
 * ler o que foi respondido e ver o que virou pendência.
 *
 * O veredito vem CONGELADO da linha, não recalculado: a faixa de temperatura
 * pode ter mudado desde então, e o checklist de terça continua sendo o de
 * terça.
 */
export function ResumoChecklist({
  linhas,
  pendencias,
}: {
  linhas: LinhaDaFolha[];
  pendencias: { id: string; descricao: string; status: string }[];
}) {
  const secoes = new Map<string, LinhaDaFolha[]>();
  for (const linha of linhas) {
    const chave = linha.secao ?? "";
    secoes.set(chave, [...(secoes.get(chave) ?? []), linha]);
  }

  return (
    <div className="flex flex-col gap-6">
      {[...secoes.entries()].map(([secao, itens]) => (
        <section key={secao || "geral"}>
          {secao && (
            <h2 className="text-ink-2 mb-2 text-sm font-semibold tracking-wide uppercase">
              {secao}
            </h2>
          )}

          <div className="border-line divide-line divide-y rounded-xl border">
            {itens.map((linha) => (
              <div
                key={linha.id}
                className="flex flex-wrap items-start gap-x-4 gap-y-1 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">
                    {linha.textoItem}
                  </span>

                  {linha.tipo === "NUMERO" && linha.valorNumero !== "" && (
                    <span className="text-ink-2 block text-sm tabular-nums">
                      {linha.valorNumero}
                      {linha.rotuloUnidade ? ` ${linha.rotuloUnidade}` : ""}
                      {linha.faixa && (
                        <span className="text-ink-3">
                          {" "}
                          (aceitável: {linha.faixa})
                        </span>
                      )}
                    </span>
                  )}

                  {linha.tipo === "TEXTO" && linha.valorTexto && (
                    <span className="text-ink-2 block text-sm">
                      {linha.valorTexto}
                    </span>
                  )}

                  {linha.observacao && (
                    <span className="text-ink-3 mt-0.5 block text-sm">
                      {linha.observacao}
                    </span>
                  )}
                </div>

                <Veredito linha={linha} />
              </div>
            ))}
          </div>
        </section>
      ))}

      {pendencias.length > 0 && (
        <section>
          <h2 className="font-semibold">
            O que este checklist deixou para resolver
          </h2>
          <div className="border-line divide-line mt-2 divide-y rounded-xl border">
            {pendencias.map((p) => (
              <div
                key={p.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm"
              >
                <span className="min-w-0 flex-1">{p.descricao}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                    p.status === "RESOLVIDA"
                      ? "bg-ok-sub text-ok"
                      : "bg-warn-sub text-warn"
                  }`}
                >
                  {p.status === "RESOLVIDA" ? "Resolvida" : "Aberta"}
                </span>
              </div>
            ))}
          </div>
          <Link
            href="/checklists/pendencias"
            className="text-accent mt-2 inline-block text-sm font-semibold"
          >
            Ver todas as pendências da loja →
          </Link>
        </section>
      )}
    </div>
  );
}

function Veredito({ linha }: { linha: LinhaDaFolha }) {
  if (linha.naoSeAplica) {
    return (
      <span className="text-ink-3 text-xs font-semibold">Não se aplica</span>
    );
  }

  if (linha.conforme === true) {
    return (
      <span className="bg-ok-sub text-ok rounded-full px-2 py-0.5 text-xs font-semibold">
        Conforme
      </span>
    );
  }

  if (linha.conforme === false) {
    return (
      <span className="bg-bad-sub text-bad rounded-full px-2 py-0.5 text-xs font-semibold">
        Não conforme
      </span>
    );
  }

  // Item de registro: texto, ou número sem faixa. Não tem veredito porque não
  // havia nada contra o que julgar.
  if (linha.tipo !== "SIM_NAO") return null;

  return <span className="text-ink-3 text-xs font-semibold">Sem resposta</span>;
}
