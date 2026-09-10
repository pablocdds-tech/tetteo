"use client";

import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { Icone } from "@/design-system/icones";

import type { AppNaBarra } from "./apps";
import { ConteudoDaNavegacao } from "./navegacao-lateral";

/**
 * A NAVEGAÇÃO QUE MUDA DE FORMA.
 *
 * Acima de 1180px a barra lateral é uma coluna fixa. Abaixo disso ela é uma
 * GAVETA que entra pela esquerda. É o mesmo conteúdo nas duas — o que muda é o
 * recipiente.
 *
 * ---------------------------------------------------------------------------
 * O QUE ISTO CONSERTA.
 *
 * Antes, a barra lateral era `hidden md:flex`. No celular ela simplesmente
 * DESAPARECIA — e com ela a única forma de trocar de módulo, de unidade ou de
 * sair. Quem abrisse o Tetteo no telefone ficava preso na tela em que caiu.
 * Não era uma barra "escondida": era um sistema sem navegação.
 * ---------------------------------------------------------------------------
 *
 * A gaveta é um `<dialog>` aberto com `showModal()`. O navegador cuida do foco
 * preso, do Esc, de tornar o fundo inerte e de devolver o foco ao botão Menu
 * quando fecha. O que escrevemos aqui é o resto: travar a rolagem do fundo,
 * fechar ao escolher um destino, e fechar sozinha se a janela crescer até a
 * largura em que a barra fixa reaparece — senão a gaveta ficaria aberta por
 * cima de uma barra lateral que já está lá.
 */

const ID_GAVETA = "gaveta-de-navegacao";

type EstadoDaNavegacao = {
  aberta: boolean;
  alternar: () => void;
  fechar: () => void;
};

const ContextoDaNavegacao = createContext<EstadoDaNavegacao | null>(null);

function useNavegacao() {
  const estado = useContext(ContextoDaNavegacao);
  if (!estado) {
    throw new Error(
      "Componente de navegação usado fora do ProvedorDeNavegacao.",
    );
  }
  return estado;
}

export function ProvedorDeNavegacao({ children }: { children: ReactNode }) {
  const caminho = usePathname();

  /**
   * O estado guarda EM QUAL ENDEREÇO a gaveta foi aberta, não um `true`.
   *
   * Com isso, escolher um destino a fecha sozinha: o endereço muda, deixa de
   * bater com o guardado, e `aberta` já nasce `false` na mesma renderização.
   *
   * A forma óbvia — um booleano mais um `useEffect` que o zera quando o
   * caminho muda — desenha a tela nova UMA VEZ com a gaveta ainda aberta e só
   * depois a fecha. É de onde vem o piscar de menu que se vê em tanto app.
   */
  const [abertaEm, setAbertaEm] = useState<string | null>(null);
  const aberta = abertaEm === caminho;

  const fechar = useCallback(() => setAbertaEm(null), []);
  const alternar = useCallback(
    () => setAbertaEm((atual) => (atual === caminho ? null : caminho)),
    [caminho],
  );

  return (
    <ContextoDaNavegacao.Provider value={{ aberta, alternar, fechar }}>
      {children}
    </ContextoDaNavegacao.Provider>
  );
}

/**
 * O botão Menu.
 *
 * `aria-controls` aponta para a gaveta e `aria-expanded` diz se ela está
 * aberta. São esses dois atributos que fazem um leitor de tela anunciar
 * "Menu, botão, recolhido" em vez de só "Menu" — a pessoa sabe que existe algo
 * para abrir antes de apertar.
 *
 * 44×44 de alvo: é um botão de polegar, e o polegar não tem mira.
 */
export function BotaoMenu() {
  const { aberta, alternar } = useNavegacao();

  return (
    <button
      type="button"
      onClick={alternar}
      aria-expanded={aberta}
      aria-controls={ID_GAVETA}
      className="text-ink-2 hover:bg-surface-2 hover:text-ink focus-visible:outline-accent desk:hidden -ml-2 grid size-11 flex-none place-items-center rounded-md transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-3"
    >
      <Icone nome="menu" tamanho={20} />
      <span className="sr-only">Menu de navegação</span>
    </button>
  );
}

export function GavetaDeNavegacao({
  apps,
  seletorDeUnidade,
  conta,
}: {
  apps: AppNaBarra[];
  seletorDeUnidade: ReactNode;
  conta: ReactNode;
}) {
  const { aberta, fechar } = useNavegacao();
  const referencia = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialogo = referencia.current;
    if (!dialogo) return;

    if (aberta && !dialogo.open) dialogo.showModal();
    if (!aberta && dialogo.open) dialogo.close();
  }, [aberta]);

  // `close` cobre o Esc, o clique no fundo e o botão Fechar de uma vez só.
  useEffect(() => {
    const dialogo = referencia.current;
    if (!dialogo) return;
    dialogo.addEventListener("close", fechar);
    return () => dialogo.removeEventListener("close", fechar);
  }, [fechar]);

  useEffect(() => {
    if (!aberta) return;
    const anterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = anterior;
    };
  }, [aberta]);

  // A janela cresceu até a largura da barra fixa: a gaveta não tem mais razão
  // de existir. Girar o tablet não pode deixar duas navegações na tela.
  useEffect(() => {
    if (!aberta) return;
    const media = window.matchMedia("(min-width: 1180px)");
    const conferir = () => {
      if (media.matches) fechar();
    };
    conferir();
    media.addEventListener("change", conferir);
    return () => media.removeEventListener("change", conferir);
  }, [aberta, fechar]);

  return (
    <dialog
      id={ID_GAVETA}
      ref={referencia}
      aria-label="Navegação do Tetteo"
      onClick={(evento) => {
        if (evento.target === referencia.current) referencia.current?.close();
      }}
      className="bg-surface text-ink border-line desk:hidden fixed inset-y-0 right-auto left-0 m-0 h-dvh max-h-dvh w-[min(88vw,280px)] max-w-none animate-[deslizar-da-esquerda_200ms_var(--ease)] flex-col border-r p-0 shadow-[var(--shadow-flutuante)] backdrop:bg-[rgb(12_15_22/45%)] open:flex"
    >
      <div className="border-line flex flex-none items-center justify-between gap-2 border-b px-3 py-2">
        <p className="text-ink-3 px-1 text-xs font-semibold">Navegação</p>
        <button
          type="button"
          autoFocus
          onClick={() => referencia.current?.close()}
          className="text-ink-2 hover:bg-surface-2 hover:text-ink focus-visible:outline-accent grid size-11 place-items-center rounded-md transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-3"
        >
          <Icone nome="fechar" tamanho={18} />
          <span className="sr-only">Fechar menu</span>
        </button>
      </div>

      <ConteudoDaNavegacao
        apps={apps}
        seletorDeUnidade={seletorDeUnidade}
        conta={conta}
      />
    </dialog>
  );
}
