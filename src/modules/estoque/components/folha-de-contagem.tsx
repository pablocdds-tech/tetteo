"use client";

import {
  startTransition,
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { Botao } from "@/design-system/botao";
import { formatarQuantidade } from "@/lib/numero";
import { sigla } from "@/lib/unidades";

import { fecharFolha, salvarFolha, type EstadoFormulario } from "../acoes";

export type ItemDaFolha = {
  insumoId: string;
  nome: string;
  categoria: string | null;
  unidadeMedida: string;
  /**
   * Como o banco tem AGORA, já no formato de campo ("12,5"). `null` quando
   * ninguém contou. É também a BASE que viaja com o campo — ver
   * `schemas/edicao-de-contagem.ts`.
   */
  quantidade: string | null;
};

const hora = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

function comUnidade(valor: number, unidade: string) {
  return `${formatarQuantidade(valor)} ${sigla(unidade)}`;
}

/**
 * A FOLHA DE CONTAGEM.
 *
 * Esta tela é usada em pé, de celular, dentro de uma câmara fria, com a mão
 * gelada. Todo o desenho sai daí:
 *
 *   · campo alto (48px) e teclado numérico — dedo com pressa não acerta alvo
 *     pequeno, e teclado de letras para digitar "12,5" é castigo;
 *   · agrupado por categoria — a pessoa anda pela loja por prateleira, não por
 *     ordem alfabética do sistema;
 *   · contador vivo no rodapé — contagem se faz em pedaços, com interrupção no
 *     meio; saber onde parou é o que faz voltar;
 *   · em branco ≠ zero — "não contei" e "acabou" são coisas diferentes, e o
 *     CMV trata cada uma do seu jeito.
 *
 * ---------------------------------------------------------------------------
 * QUATRO PROTEÇÕES, E O QUE CADA UMA EVITA.
 *
 * RASCUNHO. "Salvar" grava as quantidades e não mexe em saldo nenhum. Só
 * "Fechar" corrige a posição e congela o custo — e fechar pede confirmação,
 * porque não tem volta.
 *
 * CONFLITO. Cada campo leva a sua base: o número que mostrava quando a folha
 * foi desenhada. Quem salva uma folha aberta há uma hora não apaga o que outra
 * pessoa contou nesse meio tempo. O que colidir aparece na tela, com nome e
 * horário, e ninguém escolhe no escuro.
 *
 * NÃO SALVO. Quarenta quantidades digitadas numa câmara fria se perdem com um
 * toque no menu errado. Enquanto houver campo diferente do que está gravado,
 * sair da folha pergunta antes.
 *
 * ERRO NÃO APAGA. O envio sai pelo `onSubmit`, e não pelo `action` do
 * formulário. Com `action`, o React limpa todos os campos não controlados
 * quando a ação termina — inclusive quando ela volta dizendo que "abc" não é
 * número. Um erro de digitação levaria junto as outras trinta e nove
 * quantidades.
 * ---------------------------------------------------------------------------
 */
export function FolhaDeContagem({
  contagemId,
  itens,
  podeContar,
  local,
}: {
  contagemId: string;
  itens: ItemDaFolha[];
  podeContar: boolean;
  /** O lugar contado. `null` é a loja inteira — e aí o saldo não é corrigido. */
  local: string | null;
}) {
  const dialogo = useRef<HTMLDialogElement>(null);
  const idConfirmacao = useId();
  const idConflitos = useId();

  const [ultima, setUltima] = useState<"salvar" | "fechar" | null>(null);
  const [sujo, setSujo] = useState(false);

  // Um envio por vez: a trava vale já no segundo clique de um duplo clique,
  // antes de o React redesenhar os botões como desabilitados.
  const emVoo = useRef(false);

  const [aoSalvar, despacharSalvar, salvando] = useActionState<
    EstadoFormulario,
    FormData
  >(async (anterior, dados) => {
    try {
      setUltima("salvar");
      const resultado = await salvarFolha(anterior, dados);
      // `salvos` só volta quando a gravação aconteceu — inclusive com
      // conflito. Nesse ponto tudo o que estava digitado ou foi para o banco,
      // ou foi trocado na tela pelo número de quem salvou antes.
      if (resultado.salvos !== undefined) setSujo(false);
      return resultado;
    } finally {
      emVoo.current = false;
    }
  }, {});

  const [aoFechar, despacharFechar, fechando] = useActionState<
    EstadoFormulario,
    FormData
  >(async (anterior, dados) => {
    try {
      setUltima("fechar");
      const resultado = await fecharFolha(anterior, dados);
      // Chegou aqui: não fechou (quem fecha sai da página pelo
      // redirecionamento). A confirmação sai da frente para o erro aparecer.
      dialogo.current?.close();
      if (resultado.salvos !== undefined) setSujo(false);
      return resultado;
    } finally {
      emVoo.current = false;
    }
  }, {});

  function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (emVoo.current) return;

    // Qual botão enviou. Enter num campo usa o primeiro botão de envio do
    // formulário — o "Salvar" —, que é o lado seguro: nunca fecha sem querer.
    const botao = (evento.nativeEvent as SubmitEvent)
      .submitter as HTMLElement | null;
    const fechar = botao?.dataset.acao === "fechar";

    emVoo.current = true;
    const dados = new FormData(evento.currentTarget);
    startTransition(() =>
      fechar ? despacharFechar(dados) : despacharSalvar(dados),
    );
  }

  // O resultado que vale é o da ÚLTIMA ação. Sem isso, o conflito de um
  // "Fechar" antigo continuaria na tela depois de um "Salvar" bem-sucedido.
  const estado = ultima === "fechar" ? aoFechar : aoSalvar;
  const conflitos = estado.conflitos ?? [];

  const [preenchidos, setPreenchidos] = useState(
    () => itens.filter((i) => i.quantidade !== null).length,
  );

  /**
   * Quando o servidor devolve números novos, a contagem de preenchidos é
   * refeita a partir DELES.
   *
   * Depois de salvar, cada campo que mudou no banco é redesenhado (a `key`
   * leva o número) — os que eu gravei, e os que outra pessoa gravou. A tela
   * volta a ser espelho do banco, e o contador precisa acompanhar. É o padrão
   * de ajustar estado durante o render, e não num efeito: assim não há um
   * quadro com o número velho antes de o novo aparecer.
   */
  const assinatura = itens.map((i) => i.quantidade ?? "").join("|");
  const [assinaturaVista, setAssinaturaVista] = useState(assinatura);
  if (assinatura !== assinaturaVista) {
    setAssinaturaVista(assinatura);
    setPreenchidos(itens.filter((i) => i.quantidade !== null).length);
  }

  // Reconta a folha inteira a cada tecla. Percorrer cento e poucos campos é
  // barato; guardar um estado por campo custaria muito mais.
  function recontar(evento: FormEvent<HTMLFormElement>) {
    const campos = evento.currentTarget.querySelectorAll<HTMLInputElement>(
      'input[data-quantidade="sim"]',
    );
    let total = 0;
    let mudou = false;
    campos.forEach((campo) => {
      const valor = campo.value.trim();
      if (valor !== "") total += 1;
      if (valor !== (campo.dataset.base ?? "")) mudou = true;
    });
    setPreenchidos(total);
    setSujo(mudou);
  }

  /**
   * Sair com quantidades não salvas pergunta antes.
   *
   * Dois caminhos de saída, duas escutas. Fechar a aba ou recarregar passa
   * pelo `beforeunload` do navegador. Clicar num link do menu NÃO passa — a
   * navegação do Next acontece dentro da página —, então o clique é
   * interceptado na fase de captura, antes de chegar ao `<Link>`.
   *
   * É uma escuta de evento de fora, e é para isso que um efeito existe.
   */
  useEffect(() => {
    if (!sujo) return;

    const aoSairDaAba = (evento: BeforeUnloadEvent) => {
      evento.preventDefault();
      // Navegadores mais antigos só mostram o aviso com isto preenchido.
      evento.returnValue = "";
    };

    const aoClicarEmLink = (evento: MouseEvent) => {
      if (evento.defaultPrevented || evento.button !== 0) return;
      if (evento.metaKey || evento.ctrlKey || evento.shiftKey || evento.altKey)
        return;

      const link = (evento.target as Element | null)?.closest?.("a[href]");
      if (!link) return;
      const destino = link.getAttribute("href") ?? "";
      if (destino.startsWith("#") || link.getAttribute("target") === "_blank")
        return;

      const sair = window.confirm(
        "Há quantidades digitadas nesta folha que ainda não foram salvas. Sair assim mesmo e perder o que foi digitado?",
      );
      if (sair) return;
      evento.preventDefault();
      evento.stopPropagation();
    };

    window.addEventListener("beforeunload", aoSairDaAba);
    document.addEventListener("click", aoClicarEmLink, true);
    return () => {
      window.removeEventListener("beforeunload", aoSairDaAba);
      document.removeEventListener("click", aoClicarEmLink, true);
    };
  }, [sujo]);

  const grupos = agruparPorCategoria(itens);
  const faltam = itens.length - preenchidos;
  const ocupado = salvando || fechando;

  return (
    <form onSubmit={enviar} onInput={recontar} className="pb-32">
      <input type="hidden" name="contagemId" value={contagemId} />

      <div className="flex flex-col gap-6">
        {conflitos.length > 0 && (
          <section
            aria-labelledby={idConflitos}
            className="border-warn/30 bg-warn-sub rounded-lg border p-4"
          >
            <h2
              id={idConflitos}
              className="text-warn text-[15px] leading-6 font-semibold"
            >
              Mudou enquanto você contava
            </h2>
            <p className="text-ink-2 mt-0.5 text-sm leading-5">
              Nenhum destes foi sobrescrito. O campo agora mostra o número que
              está gravado; para manter o seu, digite de novo e salve.
            </p>

            <ul className="mt-3 flex flex-col gap-2">
              {conflitos.map((c) => (
                <li key={c.insumoId} className="text-ink text-sm leading-5">
                  <a
                    href={`#qtd-${c.insumoId}`}
                    className="font-semibold underline underline-offset-2"
                  >
                    {c.nome}
                  </a>
                  {": "}
                  {c.porQuem ?? "outra pessoa"}{" "}
                  {c.noBanco === null
                    ? "apagou a quantidade"
                    : `gravou ${comUnidade(c.noBanco, c.unidade)}`}
                  {c.quando ? ` às ${hora.format(new Date(c.quando))}` : ""}.{" "}
                  <span className="text-ink-2">
                    Você tinha digitado{" "}
                    {c.tentado === null
                      ? "em branco"
                      : comUnidade(c.tentado, c.unidade)}
                    .
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {grupos.map(([categoria, doGrupo]) => (
          <section key={categoria}>
            <h2 className="text-ink-2 mb-2 text-sm leading-5 font-semibold">
              {categoria}
            </h2>

            <div className="border-line bg-surface divide-line divide-y rounded-lg border">
              {doGrupo.map((item) => {
                const erro = estado.erros?.[item.insumoId];
                const idErro = `erro-${item.insumoId}`;

                return (
                  // A chave leva o número gravado. Quando ele muda no banco
                  // — porque eu salvei, ou porque outra pessoa salvou —, o
                  // campo é redesenhado com o valor novo. Um campo que
                  // ficasse com o número velho seria reenviado como se eu o
                  // tivesse apagado.
                  <div
                    key={`${item.insumoId}:${item.quantidade ?? ""}`}
                    className="flex items-center gap-3 px-3 py-2"
                  >
                    <input
                      type="hidden"
                      name={`base:${item.insumoId}`}
                      value={item.quantidade ?? ""}
                    />

                    <label
                      htmlFor={`qtd-${item.insumoId}`}
                      className="text-ink min-w-0 flex-1 text-sm leading-5 font-medium"
                    >
                      {item.nome}
                      {erro && (
                        <span
                          id={idErro}
                          className="text-bad block text-xs leading-[18px] font-normal"
                        >
                          {erro}
                        </span>
                      )}
                    </label>

                    <div className="flex flex-none items-center gap-1.5">
                      <input
                        id={`qtd-${item.insumoId}`}
                        name={`qtd:${item.insumoId}`}
                        data-quantidade="sim"
                        data-base={item.quantidade ?? ""}
                        defaultValue={item.quantidade ?? ""}
                        disabled={!podeContar}
                        inputMode="decimal"
                        autoComplete="off"
                        placeholder="—"
                        aria-invalid={erro ? true : undefined}
                        aria-describedby={erro ? idErro : undefined}
                        className={[
                          "bg-surface text-ink h-12 w-24 rounded-md border px-2",
                          "text-right text-base tabular-nums",
                          "placeholder:text-ink-3",
                          "transition-[border-color,box-shadow] duration-150",
                          "focus:outline-none",
                          erro
                            ? "border-bad focus:shadow-[0_0_0_3px_var(--bad-sub)]"
                            : "border-line-2 focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-sub)]",
                          "disabled:bg-surface-2 disabled:cursor-not-allowed",
                        ].join(" ")}
                      />
                      <span className="text-ink-2 w-8 text-sm">
                        {sigla(item.unidadeMedida)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {/* ---- A barra que acompanha a pessoa pela loja ----
          Começa depois da barra lateral só onde ela é fixa (1180px), e pela
          medida que a própria barra usa — o token, não um número copiado. Abaixo
          disso a navegação é gaveta, e a barra ocupa a largura inteira. */}
      <div className="border-line bg-surface desk:left-[var(--shell-sidebar)] fixed right-0 bottom-0 left-0 z-40 border-t px-4 py-3">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
          <p className="min-w-0 flex-1 text-sm leading-5">
            <span className="font-semibold tabular-nums">
              {preenchidos} de {itens.length}
            </span>{" "}
            <span className="text-ink-2">contados</span>
            {sujo && (
              <span className="text-warn font-semibold"> · não salvo</span>
            )}
            {faltam > 0 && (
              <span className="text-ink-3 block text-xs leading-[18px]">
                {faltam} em branco {faltam === 1 ? "ficará" : "ficarão"} de fora
                do CMV
              </span>
            )}
          </p>

          {podeContar && (
            <div className="flex flex-none items-center gap-2">
              <Botao
                type="submit"
                data-acao="salvar"
                peso="secundario"
                carregando={salvando}
                disabled={fechando}
              >
                Salvar
              </Botao>
              <Botao
                type="button"
                disabled={ocupado}
                onClick={() => dialogo.current?.showModal()}
              >
                Fechar contagem
              </Botao>
            </div>
          )}
        </div>

        {estado.erro && (
          <p
            role="alert"
            className={`mx-auto mt-2 max-w-5xl rounded-md px-3 py-2 text-sm leading-5 ${
              // Conflito não é erro de quem digitou: é aviso.
              conflitos.length > 0
                ? "bg-warn-sub text-warn"
                : "bg-bad-sub text-bad"
            }`}
          >
            {estado.erro}
          </p>
        )}
        {ultima === "salvar" &&
          aoSalvar.salvos !== undefined &&
          !aoSalvar.erro && (
            <p
              role="status"
              className="text-ok mx-auto mt-2 max-w-5xl px-1 text-sm leading-5"
            >
              {aoSalvar.salvos === 0
                ? "Nada mudou desde o último salvamento."
                : "Contagem salva. O saldo não mudou — isso só acontece ao fechar. Pode continuar depois."}
            </p>
          )}
      </div>

      {/* ---- A confirmação de fechar ----
          `<dialog>` com showModal(): foco preso, Esc fechando e o foco
          voltando para o botão que abriu — o navegador faz isso sem defeito.
          Ele fica DENTRO do formulário, então o botão de confirmar envia as
          quantidades que estão na tela. */}
      <dialog
        ref={dialogo}
        aria-labelledby={idConfirmacao}
        className="bg-surface text-ink border-line m-auto w-[min(calc(100%-2rem),30rem)] rounded-lg border p-0 shadow-[var(--shadow-flutuante)]"
      >
        <div className="p-5">
          <h2
            id={idConfirmacao}
            className="text-[17px] leading-6 font-semibold tracking-tight"
          >
            Fechar esta contagem?
          </h2>

          <ul className="text-ink-2 mt-3 flex list-disc flex-col gap-2 pl-5 text-sm leading-5">
            <li>
              <strong className="text-ink font-semibold tabular-nums">
                {preenchidos} de {itens.length}
              </strong>{" "}
              itens contados. O que estiver digitado é salvo antes de fechar.
            </li>
            {faltam > 0 && (
              <li>
                {faltam} em branco {faltam === 1 ? "fica" : "ficam"} de fora do
                CMV e não {faltam === 1 ? "mexe" : "mexem"} no saldo. Em branco
                não vira zero.
              </li>
            )}
            <li>
              {local ? (
                <>
                  O saldo de <strong className="text-ink">{local}</strong> passa
                  a ser o que foi contado. Cada diferença vira um ajuste em
                  Movimentos.
                </>
              ) : (
                <>
                  É a contagem da loja inteira: ela entra no CMV, mas não
                  corrige o saldo de cada prateleira.
                </>
              )}
            </li>
            <li>
              Depois de fechada, ela não aceita alterações. Se algo estiver
              errado, só cancelando.
            </li>
          </ul>
        </div>

        <div className="border-line bg-surface-2 flex flex-wrap justify-end gap-2 border-t px-5 py-3">
          <Botao
            type="button"
            peso="secundario"
            disabled={fechando}
            onClick={() => dialogo.current?.close()}
          >
            Voltar à folha
          </Botao>
          <Botao type="submit" data-acao="fechar" carregando={fechando}>
            Fechar contagem
          </Botao>
        </div>
      </dialog>
    </form>
  );
}

/**
 * Agrupa por categoria, na ordem em que aparecem.
 *
 * Sem categoria vai para o fim, sob um rótulo honesto — esconder esses itens
 * faria a contagem sair incompleta sem ninguém perceber.
 */
function agruparPorCategoria(itens: ItemDaFolha[]) {
  const mapa = new Map<string, ItemDaFolha[]>();

  for (const item of itens) {
    const chave = item.categoria?.trim() || "Sem categoria";
    const lista = mapa.get(chave);
    if (lista) lista.push(item);
    else mapa.set(chave, [item]);
  }

  return [...mapa].sort(([a], [b]) => {
    if (a === "Sem categoria") return 1;
    if (b === "Sem categoria") return -1;
    return a.localeCompare(b, "pt-BR");
  });
}
