"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";

import { ControleSegmentado } from "@/design-system/controle-segmentado";
import { Icone } from "@/design-system/icones";

import type { Periodo, RotinaDoDia } from "../services/rotinas";

import { ContextoDoProgresso } from "./progresso-ao-vivo";

const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

const diaEMes = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "America/Sao_Paulo",
});

/**
 * A largura a partir da qual lista e detalhe ficam LADO A LADO.
 *
 * É o `--breakpoint-desk` do globals.css, repetido aqui porque uma media
 * query de JavaScript não lê variável de CSS. Se um mudar, o outro muda junto.
 */
const LADO_A_LADO = "(min-width: 73.75rem)";

function agendaEmTexto(r: RotinaDoDia) {
  const hora = r.horario ? ` às ${r.horario}` : "";
  if (r.recorrencia === "DIARIA") return `Todo dia${hora}`;
  if (r.recorrencia === "SEMANAL")
    return `Toda ${DIAS[r.diaDaSemana ?? 1]}${hora}`;
  return `Todo dia ${r.diaDoMes ?? 1}${hora}`;
}

/** Sem acento e em minúscula: quem procura "camara" acha "Câmara". */
function achatar(texto: string) {
  return texto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function corDaNota(nota: number) {
  if (nota >= 90) return "text-ok font-semibold";
  if (nota >= 70) return "text-warn font-semibold";
  return "text-bad font-semibold";
}

const ROTULO_DO_STATUS = {
  atrasada: "Atrasado",
  aguardando: "Aguardando",
  feita: "Feito",
} as const;

/**
 * A FILA DE TRABALHO, e a barra que a comanda.
 *
 * Toolbar e lista moram no MESMO componente porque compartilham a busca. Se a
 * caixa de busca ficasse na página (servidor) e a lista aqui, cada tecla
 * digitada teria que dar a volta pelo servidor para filtrar o que já está na
 * tela — uma requisição por letra, e uma tela que pisca enquanto se procura.
 *
 * ONDE CADA FILTRO MORA é a mesma regra do resto do sistema:
 *
 *   PERÍODO fica no ENDEREÇO. Ele troca o conjunto de dados — "semana" traz
 *   rotinas que "hoje" nem buscou. Estando na URL, o botão Voltar funciona e
 *   o link colado no grupo do WhatsApp abre a mesma tela.
 *
 *   BUSCA fica na MEMÓRIA. Ela só esconde parte do que já veio. Por isso ela
 *   sobrevive à troca de rotina: a navegação é suave, este componente não é
 *   remontado, e quem procurou "câmara" continua com "câmara" escrito ao
 *   voltar do detalhe.
 *
 * DUAS FORMAS, UMA LÓGICA.
 *
 *   A partir de 1180px, lista e detalhe ficam lado a lado — a lista presa à
 *   esquerda, o detalhe rolando à direita.
 *
 *   Abaixo disso, eles se REVEZAM: o detalhe vira uma página, com "voltar"
 *   no topo. A lista não é desmontada, só escondida — por isso a busca, o
 *   período e a posição de rolagem estão lá quando a pessoa volta. Empilhar
 *   os dois no celular deixaria a folha a três telas de distância do toque
 *   que a abriu.
 *
 * O DETALHE ENTRA COMO `children`. Ele é desenhado no servidor e só passa por
 * aqui para ocupar o lugar dele. É o que permite a lista ser de cliente (com
 * busca instantânea) e o detalhe ser de servidor (com dados frescos), sem um
 * transformar o outro.
 */
export function PainelDeRotinas({
  rotinas,
  periodo,
  selecionada,
  detalheAberto,
  children,
}: {
  rotinas: RotinaDoDia[];
  periodo: Periodo;
  /** O id da rotina destacada na lista, ou `null`. */
  selecionada: string | null;
  /**
   * Se o endereço pede um detalhe. Não é o mesmo que `selecionada`: uma
   * rotina fora do período é pedida, não encontrada — e o aviso disso também
   * precisa aparecer no celular, onde ele ocupa o lugar do detalhe.
   */
  detalheAberto: boolean;
  children: React.ReactNode;
}) {
  const [busca, setBusca] = useState("");
  const [trocandoPeriodo, iniciarTroca] = useTransition();
  const router = useRouter();
  const caminho = usePathname();
  const idBusca = useId();

  // O período ESCOLHIDO aparece marcado na hora, antes de o servidor
  // responder. Sem isto, o rádio controlado voltaria para "Hoje" durante a
  // viagem e só pularia para "Semana" quando a lista nova chegasse — um
  // piscar que faz a pessoa achar que o clique não pegou, e clicar de novo.
  const [periodoNaTela, marcarPeriodo] = useOptimistic(periodo);

  // Quantos itens a folha aberta já gravou, contados no navegador. Sobrepõe o
  // número do servidor só para a rotina que está aberta — ver
  // `progresso-ao-vivo.tsx`.
  const [aoVivo, setAoVivo] = useState<Record<string, number>>({});
  const informarProgresso = useCallback(
    (rotinaId: string, gravados: number | null) =>
      setAoVivo((antes) => {
        if (gravados === null) {
          if (!(rotinaId in antes)) return antes;
          const resto = { ...antes };
          delete resto[rotinaId];
          return resto;
        }
        return antes[rotinaId] === gravados
          ? antes
          : { ...antes, [rotinaId]: gravados };
      }),
    [],
  );

  /** Onde a pessoa estava na lista, no celular, antes de abrir uma rotina. */
  const posicaoNaLista = useRef<number | null>(null);

  // A ROLAGEM, quando lista e detalhe se revezam.
  //
  // Abrir uma rotina leva ao TOPO do detalhe — senão a pessoa cairia no meio
  // da folha, na altura em que estava a linha que ela tocou. Voltar devolve à
  // posição exata da lista, que foi guardada no toque. No computador nada
  // disso roda: os dois estão lado a lado e a rolagem é da pessoa.
  //
  // Mexer na rolagem da janela é falar com um sistema de fora do React, que é
  // o uso legítimo de um efeito — nenhum estado é tocado aqui.
  useEffect(() => {
    if (window.matchMedia(LADO_A_LADO).matches) return;

    if (detalheAberto) {
      window.scrollTo({ top: 0 });
    } else if (posicaoNaLista.current !== null) {
      window.scrollTo({ top: posicaoNaLista.current });
      posicaoNaLista.current = null;
    }
  }, [detalheAberto, selecionada]);

  function lembrarPosicao() {
    posicaoNaLista.current = window.scrollY;
  }

  const filtradas = useMemo(() => {
    const alvo = achatar(busca.trim());
    if (!alvo) return rotinas;
    return rotinas.filter(
      (r) =>
        achatar(r.nome).includes(alvo) ||
        achatar(r.responsavel?.nome ?? "").includes(alvo),
    );
  }, [rotinas, busca]);

  const atrasadas = rotinas.filter((r) => r.status === "atrasada").length;

  function irPara(novoPeriodo: Periodo, rotinaId: string | null) {
    const params = new URLSearchParams();
    if (novoPeriodo === "semana") params.set("periodo", novoPeriodo);
    if (rotinaId) params.set("rotina", rotinaId);
    const consulta = params.toString();
    iniciarTroca(() => {
      marcarPeriodo(novoPeriodo);
      router.push(consulta ? `${caminho}?${consulta}` : caminho, {
        scroll: false,
      });
    });
  }

  const enderecoDaLista =
    periodo === "semana" ? `${caminho}?periodo=semana` : caminho;

  // Abaixo de 1180px, com um detalhe aberto, a lista e a barra dela saem de
  // cena. `hidden` e não desmontar: o que a pessoa digitou continua aqui.
  const soNoComputadorSeAberto = detalheAberto ? "desk:flex hidden" : "flex";

  return (
    <>
      {/* ---------------- A barra de ferramentas, 56px ---------------- */}
      <div
        className={`min-h-14 flex-wrap items-center gap-x-4 gap-y-3 ${soNoComputadorSeAberto}`}
      >
        <div className="min-w-[min(100%,16rem)] flex-1">
          <label htmlFor={idBusca} className="sr-only">
            Buscar rotina por nome ou responsável
          </label>
          <div className="relative">
            <span
              aria-hidden="true"
              className="text-ink-3 pointer-events-none absolute top-1/2 left-3 -translate-y-1/2"
            >
              <Icone nome="lupa" tamanho={16} />
            </span>
            <input
              id={idBusca}
              type="search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar rotina ou responsável"
              className="bg-surface border-line-2 text-ink placeholder:text-ink-3 hover:border-ink-3 focus:border-accent text-corpo h-11 w-full rounded-md border pr-3 pl-9 transition-[border-color,box-shadow] duration-150 focus:shadow-[0_0_0_3px_var(--accent-sub)] focus:outline-none md:h-[42px]"
            />
          </div>
        </div>

        <ControleSegmentado
          nome="Período da lista"
          segmentos={[
            { valor: "hoje", rotulo: "Hoje" },
            { valor: "semana", rotulo: "Semana" },
          ]}
          selecionado={periodoNaTela}
          aoSelecionar={(valor) => irPara(valor, selecionada)}
          ocupado={trocandoPeriodo}
        />
      </div>

      {/* ---------------- Lista à esquerda, detalhe à direita ---------------- */}
      <div className="desk:grid-cols-[var(--shell-lista)_minmax(0,1fr)] grid items-start gap-4">
        <section
          aria-label="Rotinas do período"
          className={`desk:sticky desk:top-[calc(var(--shell-header)+1.75rem)] desk:max-h-[calc(100dvh-var(--shell-header)-3.5rem)] bg-surface border-line flex-col overflow-hidden rounded-lg border ${soNoComputadorSeAberto}`}
        >
          <header className="border-line flex flex-none items-baseline justify-between gap-2 border-b px-4 py-2.5">
            <h2 className="text-sm font-semibold">
              {periodo === "hoje" ? "Hoje" : "Próximos sete dias"}
            </h2>
            <p aria-live="polite" className="text-ink-3 text-xs tabular-nums">
              {busca.trim()
                ? `${filtradas.length} de ${rotinas.length}`
                : atrasadas > 0
                  ? `${atrasadas} ${atrasadas === 1 ? "atrasada" : "atrasadas"}`
                  : `${rotinas.length} ${rotinas.length === 1 ? "rotina" : "rotinas"}`}
            </p>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {filtradas.length === 0 ? (
              <SemResultado
                buscou={busca.trim() !== ""}
                aoLimpar={() => setBusca("")}
                periodo={periodo}
                aoVerSemana={() => irPara("semana", selecionada)}
              />
            ) : (
              <ul className="flex flex-col gap-0.5">
                {filtradas.map((r) => (
                  <li key={r.id}>
                    <LinhaDeRotina
                      rotina={
                        r.id in aoVivo ? { ...r, respondidos: aoVivo[r.id] } : r
                      }
                      periodo={periodo}
                      ativa={selecionada === r.id}
                      aoAbrir={lembrarPosicao}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <div className={`min-w-0 ${detalheAberto ? "" : "desk:block hidden"}`}>
          {/* O "voltar" do celular. No computador a lista está ao lado e ele
              não teria para onde voltar — por isso some a partir de 1180px. */}
          {detalheAberto && (
            <Link
              href={enderecoDaLista}
              scroll={false}
              className="desk:hidden text-accent focus-visible:outline-accent mb-3 inline-flex min-h-11 items-center gap-1.5 rounded-md pr-2 text-base font-semibold focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <Icone nome="seta-esquerda" tamanho={16} />
              {periodo === "hoje" ? "Rotinas de hoje" : "Rotinas da semana"}
            </Link>
          )}
          <ContextoDoProgresso.Provider value={informarProgresso}>
            {children}
          </ContextoDoProgresso.Provider>
        </div>
      </div>
    </>
  );
}

/**
 * Uma linha da fila.
 *
 * É um LINK, não um botão: seleciona ao mudar o endereço, e por isso abre em
 * nova aba com o meio do mouse, aparece no histórico e pode ser colada num
 * grupo. Um `<button onClick>` com o mesmo visual não faz nada disso.
 *
 * O selecionado não é só a cor de fundo. Ele ganha `aria-current`, uma barra
 * azul à esquerda e o nome em negrito — três sinais, porque num turno de
 * cozinha a tela é olhada de lado, com a luz batendo.
 */
function LinhaDeRotina({
  rotina,
  periodo,
  ativa,
  aoAbrir,
}: {
  rotina: RotinaDoDia;
  periodo: Periodo;
  ativa: boolean;
  aoAbrir: () => void;
}) {
  const params = new URLSearchParams();
  if (periodo === "semana") params.set("periodo", periodo);
  params.set("rotina", rotina.id);

  const emAndamento = rotina.respostaAbertaId !== null;

  return (
    <Link
      href={`/checklists?${params.toString()}`}
      scroll={false}
      onClick={aoAbrir}
      aria-current={ativa ? "true" : undefined}
      className={[
        "focus-visible:outline-accent relative flex flex-col gap-1 rounded-[var(--radius-linha)] py-2.5 pr-3 pl-4",
        "transition-colors duration-150 focus-visible:outline-2 focus-visible:-outline-offset-2",
        ativa ? "bg-accent-sub" : "hover:bg-surface-2",
      ].join(" ")}
    >
      {/* O indicador da seleção. Fica FORA do texto para não ser lido em voz
          alta — quem usa leitor de tela recebe o aria-current. */}
      <span
        aria-hidden="true"
        className={`absolute top-2.5 bottom-2.5 left-1 w-[3px] rounded-full ${
          ativa ? "bg-accent" : "bg-transparent"
        }`}
      />

      <span className="flex items-start gap-2">
        <span
          className={`text-ink min-w-0 flex-1 truncate text-base ${
            ativa ? "font-semibold" : "font-medium"
          }`}
        >
          {rotina.nome}
        </span>
        <PontoDeStatus status={rotina.status} />
      </span>

      <span className="text-ink-3 flex flex-wrap items-center gap-x-1.5 text-xs">
        <span>{ROTULO_DO_STATUS[rotina.status]}</span>
        <span aria-hidden="true">·</span>
        <span className="truncate">{agendaEmTexto(rotina)}</span>
        {rotina.responsavel && (
          <>
            <span aria-hidden="true">·</span>
            <span className="truncate">{rotina.responsavel.nome}</span>
          </>
        )}
      </span>

      <span className="text-ink-3 flex items-center gap-1.5 text-xs tabular-nums">
        {emAndamento ? (
          <>
            <span className="text-accent font-semibold">Em andamento</span>
            <span aria-hidden="true">·</span>
            <span>
              {rotina.respondidos} de {rotina.totalItens} itens
            </span>
          </>
        ) : rotina.ultimaFechadaEm ? (
          <>
            <span>última {diaEMes.format(rotina.ultimaFechadaEm)}</span>
            {rotina.ultimaPontuacao !== null && (
              <>
                <span aria-hidden="true">·</span>
                <span className={corDaNota(rotina.ultimaPontuacao)}>
                  {rotina.ultimaPontuacao.toLocaleString("pt-BR")}%
                </span>
              </>
            )}
          </>
        ) : (
          <span>{rotina.totalItens} itens · nunca respondida</span>
        )}
      </span>
    </Link>
  );
}

/**
 * O ponto de status.
 *
 * Redundante de propósito: a palavra ("Atrasado") já está na linha de baixo. O
 * ponto é o que se enxerga ao VARRER a coluna de cima a baixo sem ler — e a
 * palavra é o que confirma para quem não distingue as cores.
 */
function PontoDeStatus({ status }: { status: RotinaDoDia["status"] }) {
  const cor = {
    atrasada: "bg-bad",
    aguardando: "bg-warn",
    feita: "bg-ok",
  }[status];

  return (
    <span
      aria-hidden="true"
      className={`mt-1.5 size-2 flex-none rounded-full ${cor}`}
    />
  );
}

/**
 * A lista vazia — e são DOIS vazios diferentes.
 *
 * Quem buscou e não achou precisa do texto preservado e de um jeito de
 * limpar. Quem não buscou e não tem nada em "Hoje" recebeu uma boa notícia, e
 * a tela precisa parecer uma — com o caminho para conferir a semana ao lado.
 */
function SemResultado({
  buscou,
  aoLimpar,
  periodo,
  aoVerSemana,
}: {
  buscou: boolean;
  aoLimpar: () => void;
  periodo: Periodo;
  aoVerSemana: () => void;
}) {
  if (buscou) {
    return (
      <div className="px-4 py-8 text-center">
        <p className="text-base font-semibold">Nenhuma rotina com esse nome</p>
        <p className="text-ink-3 mt-1 text-sm">
          A busca continua escrita na caixa acima.
        </p>
        <button
          type="button"
          onClick={aoLimpar}
          className="text-accent focus-visible:outline-accent mt-3 inline-flex h-10 items-center gap-1.5 rounded-md px-3 text-base font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <Icone nome="fechar" tamanho={14} />
          Limpar a busca
        </button>
      </div>
    );
  }

  return (
    <div className="px-4 py-8 text-center">
      <span className="bg-ok-sub text-ok mx-auto grid size-11 place-items-center rounded-xl">
        <Icone nome="check" tamanho={20} />
      </span>
      <p className="mt-3 text-base font-semibold">
        {periodo === "hoje" ? "Nada pendente hoje" : "Nada pendente na semana"}
      </p>
      <p className="text-ink-3 mt-1 text-sm">
        {periodo === "hoje"
          ? "Tudo que vencia hoje já foi respondido."
          : "Nenhuma rotina vence nos próximos sete dias."}
      </p>
      {periodo === "hoje" && (
        <button
          type="button"
          onClick={aoVerSemana}
          className="text-accent focus-visible:outline-accent mt-3 inline-flex h-10 items-center rounded-md px-3 text-base font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          Ver a semana
        </button>
      )}
    </div>
  );
}
