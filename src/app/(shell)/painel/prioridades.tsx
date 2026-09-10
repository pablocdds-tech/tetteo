import Link from "next/link";

import { Cartao, TituloDeSecao } from "@/design-system/cartao";
import { Etiqueta } from "@/design-system/etiqueta";
import { Vazio } from "@/design-system/vazio";

/**
 * AS PRIORIDADES.
 *
 * As pendências que os checklists deixaram para consertar, com DONO e PRAZO.
 *
 * A ordem vem pronta do serviço de pendências e é a fila de trabalho do
 * gerente, não a cronologia:
 *
 *   1. atrasada         o prazo passou
 *   2. sem responsável  ninguém assumiu — é o estado que mais apodrece
 *   3. com prazo        as próximas a vencer
 *   4. sem prazo        o resto
 *
 * Reordenar aqui por cor, ou por qualquer outra coisa, quebraria a regra que
 * já foi decidida uma vez no lugar certo. O painel MOSTRA a urgência; quem a
 * define é o módulo dono do assunto.
 */

export type PrioridadeNoPainel = {
  id: string;
  descricao: string;
  prazo: Date | null;
  atrasada: boolean;
  responsavel: { id: string; nome: string } | null;
  origem: { modelo: string } | null;
};

const dataCurta = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "America/Sao_Paulo",
});

/** "há 3 dias", "hoje", "em 5 dias" — o prazo lido do jeito que se fala. */
function emPalavras(prazo: Date, hoje: Date) {
  const umDia = 86_400_000;
  const dias = Math.round(
    (Date.UTC(prazo.getFullYear(), prazo.getMonth(), prazo.getDate()) -
      Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate())) /
      umDia,
  );

  if (dias === 0) return "vence hoje";
  if (dias === 1) return "vence amanhã";
  if (dias === -1) return "venceu ontem";
  if (dias < 0) return `venceu há ${Math.abs(dias)} dias`;
  return `vence em ${dias} dias`;
}

export function Prioridades({
  pendencias,
  totalAbertas,
  hoje,
}: {
  /** Já ordenadas por urgência pelo serviço. Não reordene. */
  pendencias: PrioridadeNoPainel[];
  totalAbertas: number;
  hoje: Date;
}) {
  const mostradas = pendencias.slice(0, 6);
  const restantes = totalAbertas - mostradas.length;

  return (
    <Cartao como="section" className="flex min-w-0 flex-col">
      <TituloDeSecao
        apoio="Do mais urgente para o menos · abertas agora"
        acao={
          <Link
            href="/checklists/pendencias"
            className="text-accent hover:bg-accent-sub focus-visible:outline-accent rounded-md px-2 py-1 text-sm font-semibold transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-3"
          >
            Ver todas
          </Link>
        }
      >
        Prioridades
      </TituloDeSecao>

      {mostradas.length === 0 ? (
        <Vazio
          tom="bom"
          titulo="Nenhuma pendência aberta"
          explicacao="Tudo que os checklists apontaram já foi resolvido. Quando alguém marcar um item como não conforme, a pendência aparece aqui com dono e prazo."
        />
      ) : (
        <>
          <ul className="divide-line min-w-0 flex-1 divide-y">
            {mostradas.map((p) => (
              <li key={p.id} className="px-4 py-3">
                <p className="text-ink text-sm leading-5 font-medium">
                  {p.descricao}
                </p>

                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                  {p.atrasada ? (
                    <Etiqueta tom="ruim">
                      Atrasada
                      {p.prazo ? ` · ${emPalavras(p.prazo, hoje)}` : ""}
                    </Etiqueta>
                  ) : !p.responsavel ? (
                    <Etiqueta tom="aviso">Sem responsável</Etiqueta>
                  ) : p.prazo ? (
                    <Etiqueta tom="neutro">
                      {emPalavras(p.prazo, hoje)}
                    </Etiqueta>
                  ) : (
                    <Etiqueta tom="neutro">Sem prazo</Etiqueta>
                  )}

                  <span className="text-ink-3 text-xs leading-[18px]">
                    {p.responsavel ? p.responsavel.nome : "ninguém assumiu"}
                    {p.prazo ? ` · ${dataCurta.format(p.prazo)}` : ""}
                  </span>
                </div>

                {p.origem && (
                  <p className="text-ink-3 mt-1 text-xs leading-[18px]">
                    De: {p.origem.modelo}
                  </p>
                )}
              </li>
            ))}
          </ul>

          {restantes > 0 && (
            <p className="border-line text-ink-3 border-t px-4 py-2.5 text-xs leading-[18px] tabular-nums">
              e mais {restantes} {restantes === 1 ? "pendência" : "pendências"}{" "}
              aberta{restantes === 1 ? "" : "s"}
            </p>
          )}
        </>
      )}
    </Cartao>
  );
}
