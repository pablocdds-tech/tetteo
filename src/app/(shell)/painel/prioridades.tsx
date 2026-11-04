"use client";

import Link from "next/link";
import { useState } from "react";

import { Botao, estiloDeBotao } from "@/design-system/botao";
import { Cartao, TituloDeSecao } from "@/design-system/cartao";
import { Etiqueta } from "@/design-system/etiqueta";
import { Icone } from "@/design-system/icones";
import { LinhaDeDetalhe, PainelLateral } from "@/design-system/painel-lateral";
import { Vazio } from "@/design-system/vazio";

/** A ordem de urgência pertence ao serviço; filtros só removem linhas. */
export type PrioridadeNoPainel = {
  id: string;
  descricao: string;
  prazo: Date | null;
  atrasada: boolean;
  responsavel: { id: string; nome: string } | null;
  origem: { modelo: string } | null;
};

type Filtro = "todas" | "atrasadas" | "sem-responsavel";

const FILTROS: { valor: Filtro; rotulo: string }[] = [
  { valor: "todas", rotulo: "Todas" },
  { valor: "atrasadas", rotulo: "Atrasadas" },
  { valor: "sem-responsavel", rotulo: "Sem responsável" },
];

const dataCurta = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "America/Sao_Paulo",
});

const dataLonga = new Intl.DateTimeFormat("pt-BR", {
  weekday: "long",
  day: "2-digit",
  month: "long",
  year: "numeric",
  timeZone: "America/Sao_Paulo",
});

const dataCivil = new Intl.DateTimeFormat("pt-BR", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "America/Sao_Paulo",
});

function diaEmBrasilia(data: Date) {
  const partes = dataCivil.formatToParts(data);
  const parte = (tipo: Intl.DateTimeFormatPartTypes) =>
    Number(partes.find((p) => p.type === tipo)?.value);
  return Date.UTC(parte("year"), parte("month") - 1, parte("day"));
}

function emPalavras(prazo: Date, hoje: Date) {
  const dias = Math.round(
    (diaEmBrasilia(prazo) - diaEmBrasilia(hoje)) / 86_400_000,
  );
  if (dias === 0) return "vence hoje";
  if (dias === 1) return "vence amanhã";
  if (dias === -1) return "venceu ontem";
  if (dias < 0) return `venceu há ${Math.abs(dias)} dias`;
  return `vence em ${dias} dias`;
}

function Situacao({
  pendencia,
  hoje,
}: {
  pendencia: PrioridadeNoPainel;
  hoje: Date;
}) {
  if (pendencia.atrasada) return <Etiqueta tom="ruim">Atrasada</Etiqueta>;
  if (!pendencia.responsavel)
    return <Etiqueta tom="aviso">Sem responsável</Etiqueta>;
  return (
    <Etiqueta tom="neutro">
      {pendencia.prazo ? emPalavras(pendencia.prazo, hoje) : "Sem prazo"}
    </Etiqueta>
  );
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
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [selecionada, setSelecionada] = useState<string | null>(null);
  const aberta = pendencias.find((p) => p.id === selecionada) ?? null;
  const contagens: Record<Filtro, number> = {
    todas: totalAbertas,
    atrasadas: pendencias.filter((p) => p.atrasada).length,
    "sem-responsavel": pendencias.filter((p) => !p.responsavel).length,
  };
  const filtradas = pendencias.filter((p) => {
    if (filtro === "atrasadas") return p.atrasada;
    if (filtro === "sem-responsavel") return !p.responsavel;
    return true;
  });
  const mostradas = filtradas.slice(0, 6);

  return (
    <Cartao como="section" className="flex h-full min-w-0 flex-col">
      <TituloDeSecao
        apoio="O que precisa de atenção nos checklists"
        acao={
          <Link
            href="/checklists/pendencias"
            className="text-accent hover:bg-accent-sub focus-visible:outline-accent inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-sm font-semibold transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-3 sm:min-h-9"
          >
            Ver todas
            <Icone nome="seta-direita" tamanho={14} />
          </Link>
        }
      >
        Prioridades
      </TituloDeSecao>

      {pendencias.length > 0 && (
        <div
          role="group"
          aria-label="Filtrar prioridades"
          className="border-line flex flex-wrap gap-1 border-b px-3 py-2"
        >
          {FILTROS.map(({ valor, rotulo }) => (
            <button
              key={valor}
              type="button"
              aria-pressed={filtro === valor}
              onClick={() => setFiltro(valor)}
              className={`focus-visible:outline-accent inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-xs font-semibold transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 sm:min-h-9 ${filtro === valor ? "bg-accent-sub text-accent" : "text-ink-2 hover:bg-surface-2 hover:text-ink"}`}
            >
              {rotulo}
              <span className="tabular-nums">{contagens[valor]}</span>
            </button>
          ))}
        </div>
      )}

      {pendencias.length === 0 ? (
        <Vazio
          tom="bom"
          titulo="Nenhuma pendência aberta"
          explicacao="Quando um checklist apontar algo a resolver, a pendência aparece aqui com responsável e prazo."
        />
      ) : mostradas.length === 0 ? (
        <Vazio
          icone="lista-conferida"
          titulo={
            filtro === "atrasadas"
              ? "Nenhuma pendência atrasada"
              : "Todas têm responsável"
          }
          explicacao="Veja as outras prioridades para acompanhar o que continua em aberto."
          acao={
            <Botao
              peso="secundario"
              tamanho="pequeno"
              className="min-h-11 sm:min-h-9"
              onClick={() => setFiltro("todas")}
            >
              Limpar filtros
            </Botao>
          }
        />
      ) : (
        <ul className="divide-line min-w-0 flex-1 divide-y">
          {mostradas.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => setSelecionada(p.id)}
                aria-label={`Ver detalhe: ${p.descricao}`}
                aria-haspopup="dialog"
                className="group hover:bg-surface-2 focus-visible:outline-accent flex w-full items-start gap-3 px-4 py-3 text-left transition-colors duration-150 focus-visible:outline-2 focus-visible:-outline-offset-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="text-ink line-clamp-2 text-sm leading-5 font-medium break-words">
                    {p.descricao}
                  </span>
                  <span className="mt-2 flex flex-wrap items-center gap-2">
                    <Situacao pendencia={p} hoje={hoje} />
                    {p.prazo && (
                      <span className="text-ink-3 text-xs">
                        {p.atrasada
                          ? emPalavras(p.prazo, hoje)
                          : dataCurta.format(p.prazo)}
                      </span>
                    )}
                  </span>
                  <span className="text-ink-3 mt-2 flex items-start gap-1.5 text-xs leading-[18px]">
                    <Icone
                      nome="pessoa"
                      tamanho={14}
                      className="mt-0.5 shrink-0"
                    />
                    <span className="break-words">
                      {p.responsavel?.nome ?? "Aguardando responsável"}
                    </span>
                  </span>
                </span>
                <Icone
                  nome="seta-direita"
                  tamanho={16}
                  className="text-ink-3 group-hover:text-accent mt-0.5 shrink-0"
                />
              </button>
            </li>
          ))}
        </ul>
      )}

      {pendencias.length > 0 && (
        <p
          role="status"
          className="border-line text-ink-3 border-t px-4 py-3 text-xs leading-[18px] tabular-nums"
        >
          {mostradas.length} de {contagens[filtro]}{" "}
          {contagens[filtro] === 1 ? "prioridade" : "prioridades"}
          {filtro === "todas" ? " abertas" : " neste filtro"}. Ordem de
          urgência.
        </p>
      )}

      <PainelLateral
        aberto={aberta !== null}
        aoFechar={() => setSelecionada(null)}
        titulo="Detalhe da pendência"
        apoio="Prioridade dos checklists"
        rodape={
          <Link
            href="/checklists/pendencias"
            className={`${estiloDeBotao("primario", "medio")} min-h-11 sm:min-h-10`}
          >
            Abrir fila de pendências
            <Icone nome="seta-direita" tamanho={16} />
          </Link>
        }
      >
        {aberta && (
          <>
            <p className="text-ink mb-4 text-base leading-6 font-medium break-words">
              {aberta.descricao}
            </p>
            <dl>
              <LinhaDeDetalhe rotulo="Situação">
                <Situacao pendencia={aberta} hoje={hoje} />
              </LinhaDeDetalhe>
              <LinhaDeDetalhe rotulo="Responsável">
                <span className="break-words">
                  {aberta.responsavel?.nome ?? "Ainda não atribuído"}
                </span>
              </LinhaDeDetalhe>
              <LinhaDeDetalhe rotulo="Prazo">
                {aberta.prazo ? (
                  <>
                    {dataLonga.format(aberta.prazo)}
                    <span className="text-ink-3 mt-1 block">
                      {emPalavras(aberta.prazo, hoje)}
                    </span>
                  </>
                ) : (
                  "Sem prazo definido"
                )}
              </LinhaDeDetalhe>
              <LinhaDeDetalhe rotulo="Origem">
                <span className="break-words">
                  {aberta.origem?.modelo ?? "Aberta manualmente"}
                </span>
              </LinhaDeDetalhe>
            </dl>
            <p className="text-ink-3 mt-5 text-sm leading-5">
              Para atribuir um responsável ou registrar a resolução, abra a fila
              de pendências e localize este item.
            </p>
          </>
        )}
      </PainelLateral>
    </Cartao>
  );
}
