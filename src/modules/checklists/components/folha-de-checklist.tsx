"use client";

import {
  startTransition,
  useActionState,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import { Botao } from "@/design-system/botao";
import { Icone } from "@/design-system/icones";
import { lerNumeroBr } from "@/lib/numero";

import {
  fecharFolhaAcao,
  salvarItemAcao,
  type EstadoChecklist,
} from "../acoes";
import {
  impedimentosParaFechar,
  type ItemRespondido,
} from "../schemas/pontuacao";

import { useInformarProgresso } from "./progresso-ao-vivo";

export type LinhaDaFolha = {
  id: string;
  textoItem: string;
  secao: string | null;
  tipo: "SIM_NAO" | "NUMERO" | "TEXTO";
  obrigatorio: boolean;
  exigeObservacaoSeNao: boolean;
  exigeFoto: boolean;
  rotuloUnidade: string | null;
  /** A faixa em texto, do jeito que se lê em voz alta: "-18 a -12 °C". */
  faixa: string | null;
  /** Os limites em número — é com eles que a tela julga a leitura. */
  minimo: number | null;
  maximo: number | null;
  conforme: boolean | null;
  naoSeAplica: boolean;
  valorNumero: string;
  valorTexto: string;
  observacao: string;
  /** Quando o servidor gravou este item, já no fuso da operação. */
  respondidoEm: string | null;
  respondidoPor: string | null;
};

type Marcacao = "sim" | "nao" | "na" | "";

/** O conteúdo de uma linha — o que se compara para saber se mudou. */
type Valores = {
  marcada: Marcacao;
  numero: string;
  texto: string;
  observacao: string;
};

type Situacao = "parado" | "salvando" | "salvo" | "falhou";

type EstadoDaLinha = {
  /** O que está na tela agora. */
  visivel: Valores;
  /** O que o servidor confirmou. É para cá que a tela volta se falhar. */
  confirmado: Valores;
  situacao: Situacao;
  quando: string | null;
  quem: string | null;
  erro: string | null;
};

const ESTILO_CAMPO =
  "border-line-2 bg-surface text-ink focus:border-accent text-corpo min-h-11 w-full rounded-md border px-3 py-2 focus:shadow-[0_0_0_3px_var(--accent-sub)] focus:outline-none disabled:bg-surface-2 disabled:text-ink-3 disabled:cursor-not-allowed";

function valoresIniciais(linha: LinhaDaFolha): Valores {
  return {
    marcada: linha.naoSeAplica
      ? "na"
      : linha.conforme === true
        ? "sim"
        : linha.conforme === false
          ? "nao"
          : "",
    numero: linha.valorNumero,
    texto: linha.valorTexto,
    observacao: linha.observacao,
  };
}

function iguais(a: Valores, b: Valores) {
  return (
    a.marcada === b.marcada &&
    a.numero.trim() === b.numero.trim() &&
    a.texto.trim() === b.texto.trim() &&
    a.observacao.trim() === b.observacao.trim()
  );
}

/**
 * Quando mostrar a caixa de explicação.
 *
 * Sempre que ela puder ser exigida no fechamento, e sempre que já houver algo
 * escrito — esconder um texto que a pessoa digitou seria apagá-lo sem avisar.
 */
function precisaObservar(linha: LinhaDaFolha, marcada: Marcacao) {
  if (linha.observacao) return true;
  if (marcada === "nao") return true;
  return linha.tipo === "NUMERO" && linha.faixa !== null;
}

/**
 * Traduz o que está gravado para o formato que a REGRA DE FECHAMENTO entende.
 *
 * A mesma função pura (`impedimentosParaFechar`) roda aqui e no servidor. É
 * o ponto inteiro de ela ser pura: a tela consegue dizer, ao vivo, o que
 * ainda falta — e diz exatamente o que o servidor diria, porque é a mesma
 * regra e não uma segunda cópia dela.
 */
function paraRegra(linha: LinhaDaFolha, valores: Valores): ItemRespondido {
  const numero = lerNumeroBr(valores.numero);

  return {
    textoItem: linha.textoItem,
    tipo: linha.tipo,
    obrigatorio: linha.obrigatorio,
    conforme:
      valores.marcada === "sim"
        ? true
        : valores.marcada === "nao"
          ? false
          : null,
    naoSeAplica: valores.marcada === "na",
    valorNumero: numero === undefined ? null : numero,
    valorTexto: valores.texto.trim() || null,
    minimo: linha.minimo,
    maximo: linha.maximo,
    observacao: valores.observacao.trim() || null,
    exigeObservacaoSeNao: linha.exigeObservacaoSeNao,
  };
}

/**
 * A FOLHA — a tela que a equipe usa de verdade.
 *
 * Ela é feita para um celular, de pé, com pressa e com a mão suja de farinha.
 *
 * CADA ITEM SALVA SOZINHO, no instante em que é marcado. Isso substituiu um
 * botão "Salvar" no fim da página, e a troca tem dois lados:
 *
 *   O QUE SE GANHA  ninguém perde meia hora de checklist porque a bateria
 *                   acabou, a aba fechou ou o gerente ligou no meio.
 *
 *   O QUE SE PAGA   a internet da cozinha cai. Uma gravação que falha PRECISA
 *                   aparecer como falha: o item VOLTA ao que estava e o aviso
 *                   fica do lado dele. Marcar na tela sem gravar no banco é a
 *                   única coisa que esta folha não pode fazer — um checklist
 *                   que mente é pior do que checklist nenhum.
 *
 * Os botões são grandes. Sim/Não/N/A ocupam a largura inteira porque errar o
 * alvo e marcar "não" sem querer gera pendência falsa — e pendência falsa
 * ensina a equipe a ignorar a lista.
 *
 * O que muda de valor por toque (o rádio) grava na hora. O que se digita (o
 * número, o texto, a observação) grava ao SAIR do campo: uma requisição por
 * tecla digitada seria uma tempestade, e a metade de uma palavra gravada não
 * é um dado melhor do que a palavra inteira um segundo depois.
 */
export function FolhaDeChecklist({
  respostaId,
  rotinaId,
  periodo,
  linhas,
  podeResponder,
}: {
  respostaId: string;
  /** Para onde voltar ao concluir. Nulo num checklist avulso. */
  rotinaId: string | null;
  periodo: string;
  linhas: LinhaDaFolha[];
  podeResponder: boolean;
}) {
  const [estados, setEstados] = useState<Record<string, EstadoDaLinha>>(() =>
    Object.fromEntries(
      linhas.map((linha) => {
        const valores = valoresIniciais(linha);
        return [
          linha.id,
          {
            visivel: valores,
            confirmado: valores,
            situacao: "parado" as Situacao,
            quando: linha.respondidoEm,
            quem: linha.respondidoPor,
            erro: null,
          },
        ];
      }),
    ),
  );

  const [aviso, setAviso] = useState("");
  const [verFaltas, setVerFaltas] = useState(false);
  const idDasFaltas = useId();
  const informarProgresso = useInformarProgresso();
  const [fechamento, acaoFechar, fechando] = useActionState<
    EstadoChecklist,
    FormData
  >(fecharFolhaAcao, {});

  /**
   * Uma fila por item.
   *
   * Marcar "não" e corrigir para "sim" em meio segundo dispara duas
   * gravações. Sem fila, elas correriam soltas e a resposta mais LENTA
   * poderia chegar por último — a tela mostraria "sim" e o banco guardaria
   * "não". Encadear por item custa nada e fecha essa porta.
   */
  const filas = useRef(new Map<string, Promise<unknown>>());

  /** O que a pessoa TENTOU gravar por último, item a item. */
  const tentativas = useRef(new Map<string, Valores>());

  /** Entre o clique em Concluir e o pedido sair: esperando a fila esvaziar. */
  const [preparando, iniciarPreparo] = useTransition();

  /** Trava contra o segundo clique que chega antes de a tela redesenhar. */
  const concluindo = useRef(false);

  function gravar(linha: LinhaDaFolha, proximos: Valores) {
    // Guardado ANTES de enviar. Se a gravação falhar, a tela volta ao que
    // estava gravado — mas "Tentar de novo" precisa reenviar o que a pessoa
    // QUIS marcar, e não o valor antigo para o qual a tela voltou. A primeira
    // versão reenviava o antigo: o botão parecia funcionar e não gravava nada.
    tentativas.current.set(linha.id, proximos);

    setEstados((antes) => ({
      ...antes,
      [linha.id]: {
        ...antes[linha.id],
        visivel: proximos,
        situacao: "salvando",
        erro: null,
      },
    }));

    const anterior = filas.current.get(linha.id) ?? Promise.resolve();

    const tarefa = anterior
      .catch(() => undefined)
      .then(async () => {
        const resultado = await salvarItemAcao({
          respostaId,
          itemId: linha.id,
          marcada: proximos.marcada,
          numero: proximos.numero,
          texto: proximos.texto,
          observacao: proximos.observacao,
        });

        setEstados((antes) => {
          const atual = antes[linha.id];

          if (!resultado.ok) {
            // DESFAZ. A tela volta ao que o servidor confirmou da última vez —
            // não ao que a pessoa acabou de marcar.
            return {
              ...antes,
              [linha.id]: {
                ...atual,
                visivel: atual.confirmado,
                situacao: "falhou",
                erro: resultado.erro,
              },
            };
          }

          return {
            ...antes,
            [linha.id]: {
              ...atual,
              confirmado: proximos,
              situacao: "salvo",
              quando: resultado.quando || atual.quando,
              quem: resultado.quem ?? atual.quem,
              erro: null,
            },
          };
        });

        setAviso(
          resultado.ok
            ? `${linha.textoItem}: salvo.`
            : `${linha.textoItem}: não deu para gravar. ${resultado.erro}`,
        );
      })
      .catch(() => {
        // A rede caiu no meio. Mesma regra: desfaz e avisa.
        setEstados((antes) => ({
          ...antes,
          [linha.id]: {
            ...antes[linha.id],
            visivel: antes[linha.id].confirmado,
            situacao: "falhou",
            erro: "Sem conexão com o servidor. Este item não foi gravado.",
          },
        }));
        setAviso(`${linha.textoItem}: não deu para gravar. Sem conexão.`);
      });

    filas.current.set(linha.id, tarefa);
    return tarefa;
  }

  /** Reenvia o que a pessoa quis marcar da última vez — não o que voltou. */
  function tentarDeNovo(linha: LinhaDaFolha) {
    void gravar(
      linha,
      tentativas.current.get(linha.id) ?? estados[linha.id].visivel,
    );
  }

  /** Só grava se mudou de verdade — sair de um campo sem tocar não é edição. */
  function gravarSeMudou(linha: LinhaDaFolha, proximos: Valores) {
    const atual = estados[linha.id];
    if (iguais(proximos, atual.confirmado) && atual.situacao !== "falhou") {
      setEstados((antes) => ({
        ...antes,
        [linha.id]: { ...antes[linha.id], visivel: proximos },
      }));
      return;
    }
    void gravar(linha, proximos);
  }

  /** Muda só o que está na tela, sem ir ao servidor — é o ato de digitar. */
  function digitar(id: string, parcial: Partial<Valores>) {
    setEstados((antes) => ({
      ...antes,
      [id]: { ...antes[id], visivel: { ...antes[id].visivel, ...parcial } },
    }));
  }

  const secoes = useMemo(() => {
    const mapa = new Map<string, LinhaDaFolha[]>();
    for (const linha of linhas) {
      const chave = linha.secao ?? "";
      const atual = mapa.get(chave) ?? [];
      atual.push(linha);
      mapa.set(chave, atual);
    }
    return [...mapa.entries()];
  }, [linhas]);

  /**
   * O QUE AINDA FALTA — calculado sobre o que o SERVIDOR confirmou.
   *
   * Não sobre o que está na tela. A diferença aparece justamente quando
   * importa: se a gravação falhou, a tela não pode dizer "pode concluir" só
   * porque o item parece marcado. O botão reflete o banco, que é o que vale
   * na hora de fechar.
   */
  const impedimentos = useMemo(
    () =>
      impedimentosParaFechar(
        linhas.map((linha) => paraRegra(linha, estados[linha.id].confirmado)),
      ),
    [linhas, estados],
  );

  const respondidos = linhas.filter((linha) => {
    const v = estados[linha.id].confirmado;
    return v.marcada !== "" || v.numero.trim() !== "" || v.texto.trim() !== "";
  }).length;

  /**
   * A LISTA DA ESQUERDA TAMBÉM PRECISA SABER.
   *
   * O "3 de 11 itens" da fila vem do servidor. Sem um aviso, a coluna da
   * esquerda continuaria dizendo 3 enquanto a folha, ao lado, já diz 5 — dois
   * números diferentes para a mesma coisa, lado a lado.
   *
   * O aviso vai pelo navegador (`ContextoDoProgresso`), e não pedindo ao
   * servidor para redesenhar a página: com a internet oscilando, a consulta
   * falhava e a tela inteira recarregava, apagando o "não gravado" e o
   * "Tentar de novo" — ver `progresso-ao-vivo.tsx`.
   *
   * Ao sair desta rotina, o aviso é retirado, e a lista volta a mostrar o
   * número do servidor, que a navegação acabou de trazer atualizado.
   */
  useEffect(() => {
    if (!rotinaId) return;
    informarProgresso(rotinaId, respondidos);
  }, [rotinaId, respondidos, informarProgresso]);

  useEffect(() => {
    if (!rotinaId) return;
    return () => informarProgresso(rotinaId, null);
  }, [rotinaId, informarProgresso]);

  const gravando = linhas.some(
    (linha) => estados[linha.id].situacao === "salvando",
  );
  const falhas = linhas.filter(
    (linha) => estados[linha.id].situacao === "falhou",
  ).length;

  /**
   * Concluir espera a fila esvaziar — e só então manda o fechamento.
   *
   * Quem preenche a última observação e vai direto no botão tem uma gravação
   * ainda no ar. Enviar por cima dela faria o servidor recusar o fechamento
   * por um item que a pessoa acabou de escrever.
   *
   * A primeira versão cancelava o envio, esperava a fila e reenviava o
   * formulário com `requestSubmit()`. Parecia certo e não funcionava: no
   * teste, o clique esperou a fila e o fechamento nunca saiu — nenhum pedido
   * chegou ao servidor, e a tela não disse nada. Agora o fechamento é
   * disparado direto, numa transição, com os campos lidos do formulário no
   * instante do clique.
   */
  function aoConcluir(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (concluindo.current) return;
    concluindo.current = true;

    const dados = new FormData(evento.currentTarget);
    iniciarPreparo(async () => {
      await Promise.allSettled([...filas.current.values()]);
      // Depois de um `await`, a atualização precisa de uma transição própria
      // para contar como parte dela — regra do React para ações assíncronas.
      startTransition(() => acaoFechar(dados));
    });
  }

  // Se o servidor recusar o fechamento (e não redirecionar), a trava sai e a
  // pessoa pode tentar de novo depois de corrigir o que ele apontou.
  useEffect(() => {
    concluindo.current = false;
  }, [fechamento]);

  return (
    <div className="flex flex-col gap-4">
      {/* Uma região viva só, para o leitor de tela. Doze delas, uma por item,
          transformariam responder um checklist numa metralhadora de avisos. */}
      <p aria-live="polite" className="sr-only">
        {aviso}
      </p>

      <Progresso
        respondidos={respondidos}
        total={linhas.length}
        gravando={gravando}
        falhas={falhas}
      />

      {secoes.map(([secao, itens]) => (
        <section key={secao || "geral"}>
          {secao && (
            <h3 className="text-ink-2 mb-2 text-sm font-semibold tracking-wide uppercase">
              {secao}
            </h3>
          )}

          <div className="bg-surface border-line divide-line divide-y rounded-lg border">
            {itens.map((linha) => (
              <ItemDaFolha
                key={linha.id}
                linha={linha}
                estado={estados[linha.id]}
                podeResponder={podeResponder}
                aoMarcar={(marcada) =>
                  gravar(linha, { ...estados[linha.id].visivel, marcada })
                }
                aoDigitar={(parcial) => digitar(linha.id, parcial)}
                aoSair={() => gravarSeMudou(linha, estados[linha.id].visivel)}
                aoTentarDeNovo={() => tentarDeNovo(linha)}
              />
            ))}
          </div>
        </section>
      ))}

      {fechamento.erro && (
        <p
          role="alert"
          className="bg-bad-sub text-bad rounded-md px-3 py-2 text-base whitespace-pre-line"
        >
          {fechamento.erro}
        </p>
      )}

      {/* A BARRA DE CONCLUIR fica presa ao rodapé da tela enquanto se rola a
          folha — o botão está sempre a um toque. Mas ela é UMA linha só.

          A primeira versão empilhava aqui a lista inteira do que faltava, e
          com sete itens pendentes a barra comia um terço da tela e cobria
          justamente os botões Sim/Não que a pessoa precisava apertar. Uma
          barra fixa que esconde o trabalho é pior do que barra nenhuma.

          Agora a lista abre sob demanda, POR CIMA da linha do botão, e o
          botão diz quantos faltam mesmo fechada. */}
      {podeResponder && (
        <form
          onSubmit={aoConcluir}
          className="bg-surface border-line sticky bottom-0 z-[1] rounded-lg border px-4 py-3 shadow-[var(--shadow-card)]"
        >
          <input type="hidden" name="respostaId" value={respostaId} />
          {rotinaId && <input type="hidden" name="rotinaId" value={rotinaId} />}
          <input type="hidden" name="periodo" value={periodo} />

          {impedimentos.length > 0 && (
            <OQueFalta
              id={idDasFaltas}
              motivos={impedimentos}
              visivel={verFaltas}
            />
          )}

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Botao
              type="submit"
              carregando={fechando || preparando}
              disabled={impedimentos.length > 0 || gravando}
            >
              Concluir checklist
            </Botao>

            {impedimentos.length > 0 ? (
              <button
                type="button"
                aria-expanded={verFaltas}
                aria-controls={idDasFaltas}
                onClick={() => setVerFaltas((v) => !v)}
                className="focus-visible:outline-accent inline-flex min-h-10 items-center gap-1.5 rounded-md px-1 text-base focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                <Icone nome="alerta" tamanho={15} className="text-warn" />
                <span className="text-warn font-semibold">
                  {impedimentos.length}{" "}
                  {impedimentos.length === 1 ? "item falta" : "itens faltam"}
                </span>
                <span className="text-accent font-semibold underline-offset-2 hover:underline">
                  {verFaltas ? "esconder" : "ver quais"}
                </span>
              </button>
            ) : (
              <span className="text-ink-3 text-sm">
                {gravando
                  ? "Aguardando a última gravação…"
                  : "Ao concluir, cada “não” vira uma pendência com dono."}
              </span>
            )}
          </div>
        </form>
      )}
    </div>
  );
}

/**
 * O progresso.
 *
 * Conta o que o SERVIDOR tem, não o que está na tela. Um "11 de 12" que
 * inclui um item cuja gravação falhou seria exatamente a mentira que a
 * gravação item a item existe para evitar.
 */
function Progresso({
  respondidos,
  total,
  gravando,
  falhas,
}: {
  respondidos: number;
  total: number;
  gravando: boolean;
  falhas: number;
}) {
  const porcento = total === 0 ? 0 : Math.round((respondidos / total) * 100);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-base font-semibold tabular-nums">
          {respondidos} de {total} itens gravados
        </p>

        <p className="text-ink-3 flex items-center gap-1.5 text-sm">
          {falhas > 0 ? (
            <span className="text-bad flex items-center gap-1.5 font-semibold">
              <Icone nome="alerta" tamanho={14} />
              {falhas}{" "}
              {falhas === 1 ? "item não gravado" : "itens não gravados"}
            </span>
          ) : gravando ? (
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="border-ink-3 size-3 animate-spin rounded-full border-2 border-r-transparent"
              />
              Gravando…
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              <Icone nome="check" tamanho={14} />
              Cada item é gravado ao ser marcado
            </span>
          )}
        </p>
      </div>

      {/* A barra é decorativa: o número acima já diz tudo, e é ele que um
          leitor de tela anuncia. */}
      <div
        aria-hidden="true"
        className="bg-surface-3 h-1.5 w-full overflow-hidden rounded-full"
      >
        <div
          className="bg-accent h-full rounded-full transition-[width] duration-150"
          style={{ width: `${porcento}%` }}
        />
      </div>
    </div>
  );
}

/**
 * A lista do que impede concluir — a mesma que o servidor usaria.
 *
 * Abre sob demanda, pelo "ver quais" da barra de concluir, POR CIMA da linha
 * do botão. Fica escondida com `hidden` em vez de desmontada: assim o
 * `aria-controls` do botão aponta sempre para um elemento que existe.
 *
 * Como agora ela só aparece quando pedida, não precisa mais cortar em cinco
 * itens: a pessoa pediu para ver, então vê tudo — com rolagem própria, para
 * nunca passar de 40% da altura da tela.
 */
function OQueFalta({
  id,
  motivos,
  visivel,
}: {
  id: string;
  motivos: string[];
  visivel: boolean;
}) {
  return (
    <div
      id={id}
      hidden={!visivel}
      className="border-warn/30 bg-warn-sub mb-3 max-h-[40vh] overflow-y-auto rounded-md border px-3 py-2.5"
    >
      <p className="text-warn flex items-center gap-1.5 text-base font-semibold">
        <Icone nome="alerta" tamanho={15} />
        Falta isto para concluir
      </p>
      <ul className="text-ink-2 mt-1.5 flex list-disc flex-col gap-0.5 pl-5 text-sm">
        {/* Índice na chave: duas perguntas iguais em seções diferentes
            ("Piso limpo?" na cozinha e no salão) dariam o mesmo texto. */}
        {motivos.map((motivo, indice) => (
          <li key={`${indice}-${motivo}`}>{motivo}</li>
        ))}
      </ul>
    </div>
  );
}

function ItemDaFolha({
  linha,
  estado,
  podeResponder,
  aoMarcar,
  aoDigitar,
  aoSair,
  aoTentarDeNovo,
}: {
  linha: LinhaDaFolha;
  estado: EstadoDaLinha;
  podeResponder: boolean;
  aoMarcar: (marcada: Marcacao) => void;
  aoDigitar: (parcial: Partial<Valores>) => void;
  aoSair: () => void;
  aoTentarDeNovo: () => void;
}) {
  const { visivel } = estado;
  const idObservacao = `obs-${linha.id}`;

  return (
    <div className="flex flex-col gap-2.5 px-4 py-3">
      <div className="flex items-start gap-2">
        <p className="flex-1 text-base font-medium">
          {linha.textoItem}
          {!linha.obrigatorio && (
            <span className="text-ink-3 font-normal"> (opcional)</span>
          )}
        </p>

        {linha.exigeFoto && (
          <span
            title="Este item pede foto. O envio de imagem ainda não está ligado no sistema."
            className="bg-surface-3 text-ink-2 inline-flex flex-none items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs font-semibold"
          >
            <Icone nome="olho" tamanho={12} />
            pede foto
          </span>
        )}
      </div>

      {linha.tipo === "SIM_NAO" && (
        <fieldset disabled={!podeResponder}>
          <legend className="sr-only">{linha.textoItem}</legend>
          <div className="grid grid-cols-3 gap-1.5">
            {(
              [
                // O texto do botão marcado é `--surface`, e não branco. No
                // tema escuro o verde, o vermelho e o cinza CLAREIAM, e branco
                // em cima deles dava 2,2:1, 2,8:1 e 2,0:1 — ilegível. A
                // superfície é quase branca no claro e quase preta no escuro:
                // o par se inverte sozinho, e o teste de contraste confere.
                { valor: "sim", texto: "Sim", cor: "bg-ok text-surface" },
                { valor: "nao", texto: "Não", cor: "bg-bad text-surface" },
                { valor: "na", texto: "N/A", cor: "bg-ink-2 text-surface" },
              ] as const
            ).map((opcao) => (
              <label
                key={opcao.valor}
                className={[
                  "focus-within:outline-accent flex h-11 cursor-pointer items-center justify-center rounded-md border text-base font-semibold",
                  "transition-colors duration-150 focus-within:outline-2 focus-within:outline-offset-2",
                  visivel.marcada === opcao.valor
                    ? `${opcao.cor} border-transparent`
                    : "border-line-2 bg-surface text-ink-2 hover:bg-surface-2",
                  podeResponder ? "" : "cursor-not-allowed opacity-60",
                ].join(" ")}
              >
                <input
                  type="radio"
                  name={`resp:${linha.id}`}
                  value={opcao.valor}
                  checked={visivel.marcada === opcao.valor}
                  onChange={() => aoMarcar(opcao.valor)}
                  className="sr-only"
                />
                {opcao.texto}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {linha.tipo === "NUMERO" && (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={`num-${linha.id}`} className="sr-only">
            {linha.textoItem}
            {linha.rotuloUnidade ? ` em ${linha.rotuloUnidade}` : ""}
          </label>
          <input
            id={`num-${linha.id}`}
            inputMode="decimal"
            value={visivel.numero}
            disabled={!podeResponder}
            placeholder={linha.faixa ?? ""}
            onChange={(e) => aoDigitar({ numero: e.target.value })}
            onBlur={aoSair}
            className={`${ESTILO_CAMPO} max-w-[160px]`}
          />
          {linha.rotuloUnidade && (
            <span className="text-ink-2 text-base font-semibold">
              {linha.rotuloUnidade}
            </span>
          )}
          {linha.faixa && (
            <span className="text-ink-3 text-sm">aceitável: {linha.faixa}</span>
          )}
        </div>
      )}

      {linha.tipo === "TEXTO" && (
        <>
          <label htmlFor={`txt-${linha.id}`} className="sr-only">
            {linha.textoItem}
          </label>
          <textarea
            id={`txt-${linha.id}`}
            value={visivel.texto}
            rows={2}
            disabled={!podeResponder}
            onChange={(e) => aoDigitar({ texto: e.target.value })}
            onBlur={aoSair}
            className={ESTILO_CAMPO}
          />
        </>
      )}

      {/* A explicação aparece junto da resposta, no instante em que ela passa
          a ser exigida — nunca num campo solto no fim da página, que é o mesmo
          que não pedir. */}
      {precisaObservar(linha, visivel.marcada) && (
        <div className="flex flex-col gap-1">
          <label
            htmlFor={idObservacao}
            className="text-ink-2 text-sm font-semibold"
          >
            {visivel.marcada === "nao" && linha.exigeObservacaoSeNao
              ? "O que houve? (obrigatório)"
              : linha.tipo === "NUMERO" && linha.faixa
                ? "Observação (obrigatória se a leitura sair da faixa)"
                : "Observação"}
          </label>
          <textarea
            id={idObservacao}
            value={visivel.observacao}
            rows={2}
            disabled={!podeResponder}
            placeholder="Ex.: filtro entupido, avisei o Zé da manutenção"
            onChange={(e) => aoDigitar({ observacao: e.target.value })}
            onBlur={aoSair}
            className={ESTILO_CAMPO}
          />
        </div>
      )}

      <SituacaoDoItem estado={estado} aoTentarDeNovo={aoTentarDeNovo} />
    </div>
  );
}

/**
 * A linha de estado embaixo de cada item.
 *
 * Diz QUEM gravou e QUANDO — não porque fica bonito, mas porque um checklist é
 * uma afirmação assinada. "A câmara fria estava limpa às 7h03" só vale alguma
 * coisa se estiver escrito quem afirmou isso.
 *
 * Quando falha, o texto não é "erro": é o que aconteceu e o que fazer. E o
 * botão de tentar de novo fica ali, porque a causa mais comum é a internet da
 * cozinha, que volta sozinha em dez segundos.
 */
function SituacaoDoItem({
  estado,
  aoTentarDeNovo,
}: {
  estado: EstadoDaLinha;
  aoTentarDeNovo: () => void;
}) {
  if (estado.situacao === "falhou") {
    return (
      <p className="text-bad flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="flex items-center gap-1.5 font-semibold">
          <Icone nome="alerta" tamanho={14} />
          Não gravado — voltou ao que estava.
        </span>
        <span className="text-ink-2">{estado.erro}</span>
        <button
          type="button"
          onClick={aoTentarDeNovo}
          className="text-accent focus-visible:outline-accent inline-flex h-8 items-center gap-1 rounded-md px-2 font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <Icone nome="atualizar" tamanho={13} />
          Tentar de novo
        </button>
      </p>
    );
  }

  if (estado.situacao === "salvando") {
    return (
      <p className="text-ink-3 flex items-center gap-1.5 text-sm">
        <span
          aria-hidden="true"
          className="border-ink-3 size-3 animate-spin rounded-full border-2 border-r-transparent"
        />
        Gravando…
      </p>
    );
  }

  if (estado.quando) {
    return (
      <p className="text-ink-3 flex items-center gap-1.5 text-sm">
        <Icone nome="check" tamanho={13} className="text-ok" />
        Gravado às {estado.quando}
        {estado.quem ? ` por ${estado.quem}` : ""}
      </p>
    );
  }

  return null;
}
