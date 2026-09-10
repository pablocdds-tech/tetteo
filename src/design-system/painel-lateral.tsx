"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

import { Icone } from "./icones";

/**
 * O PAINEL LATERAL DE DETALHE.
 *
 * É um `<dialog>` aberto com `showModal()`, e essa escolha é o componente
 * inteiro. O navegador entrega de graça, e sem bug:
 *
 *   • o foco preso dentro do painel enquanto ele está aberto
 *   • Esc fechando
 *   • o resto da página inerte — o leitor de tela não atravessa o painel
 *   • o foco VOLTANDO para quem abriu, ao fechar
 *
 * Cada um desses itens, escrito à mão, é um punhado de `useEffect` e uma
 * armadilha de foco que quebra no primeiro `<select>`. A versão do navegador
 * já funciona em leitor de tela, em navegação por voz e no celular.
 *
 * O que sobra para nós: o desenho, a rolagem do fundo e a pergunta de saída
 * quando há edição pendente.
 */
export function PainelLateral({
  aberto,
  aoFechar,
  titulo,
  apoio,
  children,
  rodape,
  /**
   * Chamado antes de fechar. Devolver `false` mantém o painel aberto — é o que
   * impede o Esc de jogar fora um formulário meio preenchido.
   */
  podeFechar,
}: {
  aberto: boolean;
  aoFechar: () => void;
  titulo: string;
  apoio?: ReactNode;
  children: ReactNode;
  rodape?: ReactNode;
  podeFechar?: () => boolean;
}) {
  const referencia = useRef<HTMLDialogElement>(null);
  const idTitulo = useId();

  // Abrir e fechar seguem o estado de fora, não o contrário.
  useEffect(() => {
    const dialogo = referencia.current;
    if (!dialogo) return;

    if (aberto && !dialogo.open) dialogo.showModal();
    if (!aberto && dialogo.open) dialogo.close();
  }, [aberto]);

  // Enquanto o painel está aberto, o fundo não rola. Sem isso, rolar dentro do
  // painel no celular arrasta a página atrás dele e a pessoa perde o lugar.
  useEffect(() => {
    if (!aberto) return;
    const anterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = anterior;
    };
  }, [aberto]);

  useEffect(() => {
    const dialogo = referencia.current;
    if (!dialogo) return;

    // `cancel` é o Esc. Interceptamos para poder recusar a saída.
    const aoCancelar = (evento: Event) => {
      if (podeFechar && !podeFechar()) {
        evento.preventDefault();
        return;
      }
    };

    // `close` cobre todos os caminhos de fechamento, inclusive o Esc que
    // passou pela verificação acima. É aqui que o estado de fora é avisado.
    const aoFecharNativo = () => aoFechar();

    dialogo.addEventListener("cancel", aoCancelar);
    dialogo.addEventListener("close", aoFecharNativo);
    return () => {
      dialogo.removeEventListener("cancel", aoCancelar);
      dialogo.removeEventListener("close", aoFecharNativo);
    };
  }, [aoFechar, podeFechar]);

  function fechar() {
    if (podeFechar && !podeFechar()) return;
    referencia.current?.close();
  }

  return (
    <dialog
      ref={referencia}
      aria-labelledby={idTitulo}
      // Clique no fundo escuro fecha. O alvo só é o próprio `<dialog>` quando
      // o clique caiu fora do conteúdo — por isso a comparação.
      onClick={(evento) => {
        if (evento.target === referencia.current) fechar();
      }}
      className="bg-surface text-ink border-line fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-dvh w-full max-w-[460px] animate-[deslizar-da-direita_250ms_var(--ease)] flex-col border-l p-0 shadow-[var(--shadow-flutuante)] backdrop:bg-[rgb(12_15_22/45%)] open:flex"
    >
      <header className="border-line flex flex-none items-start gap-3 border-b px-5 py-4">
        <div className="min-w-0 flex-1">
          <h2
            id={idTitulo}
            className="text-[17px] leading-6 font-semibold tracking-tight"
          >
            {titulo}
          </h2>
          {apoio && (
            <p className="text-ink-3 mt-1 text-sm leading-5">{apoio}</p>
          )}
        </div>

        <button
          type="button"
          onClick={fechar}
          aria-label="Fechar detalhe"
          className="text-ink-2 hover:bg-surface-2 hover:text-ink focus-visible:outline-accent -mt-1 -mr-1 grid size-11 flex-none place-items-center rounded-md transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-3"
        >
          <Icone nome="fechar" tamanho={18} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

      {rodape && (
        <footer className="border-line bg-surface-2 flex flex-none flex-wrap items-center justify-end gap-2 border-t px-5 py-3">
          {rodape}
        </footer>
      )}
    </dialog>
  );
}

/**
 * Um par rótulo/valor dentro do painel.
 *
 * `<dl>` de verdade em volta: a relação entre "Vencimento" e a data é
 * semântica, não visual. Duas `<div>` empilhadas ficam iguais na tela e viram
 * dois textos soltos no leitor de tela.
 */
export function LinhaDeDetalhe({
  rotulo,
  children,
}: {
  rotulo: string;
  children: ReactNode;
}) {
  return (
    <div className="border-line grid grid-cols-[minmax(0,7.5rem)_1fr] gap-3 border-b py-2.5 last:border-b-0">
      <dt className="text-ink-3 text-sm leading-5">{rotulo}</dt>
      <dd className="text-ink text-sm leading-5">{children}</dd>
    </div>
  );
}
