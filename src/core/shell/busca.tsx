"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { Icone } from "@/design-system/icones";

import type { AppNaBarra } from "./apps";

/**
 * A BUSCA DE TELAS.
 *
 * ---------------------------------------------------------------------------
 * O QUE ISTO CONSERTA.
 *
 * O topo tinha uma caixa com uma lupa, o texto "Buscar…" e um atalho "Ctrl K"
 * desenhado ao lado. Era uma `<div>`. Não abria nada, não recebia foco, não
 * respondia ao atalho que ela mesma anunciava.
 *
 * Um controle que finge funcionar é pior do que um espaço vazio: a pessoa
 * tenta, não acontece nada, e conclui que o sistema está quebrado — ou que a
 * culpa é dela. Depois da terceira tentativa, ela para de tentar qualquer
 * coisa nova na tela.
 * ---------------------------------------------------------------------------
 *
 * Esta busca alcança MÓDULOS E TELAS — e diz isso com todas as letras, no
 * texto de apoio e no estado vazio. Ela não procura uma nota fiscal nem um
 * fornecedor. Prometer menos e cumprir é o contrário do que estava aqui antes.
 *
 * Só entra o que a pessoa pode ver: a lista já chega filtrada por permissão.
 * Uma busca que devolve o nome de uma tela proibida conta que ela existe.
 */

type Resultado = {
  id: string;
  rota: string;
  titulo: string;
  contexto: string;
  icone: AppNaBarra["icone"];
  cor: { fundo: string; frente: string };
  emConstrucao?: boolean;
};

/** Sem acento e sem caixa: quem digita "cardapio" quer achar "Cardápio". */
function normalizar(texto: string) {
  return texto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

export function Busca({ apps }: { apps: AppNaBarra[] }) {
  const [aberta, setAberta] = useState(false);
  const [termo, setTermo] = useState("");

  /**
   * O destaque guarda o TERMO a que pertence.
   *
   * Assim ele volta para a primeira linha sozinho quando a busca muda: o termo
   * guardado deixa de bater, e `indice` já nasce zero. Manter a seleção na
   * quinta linha depois que a lista inteira mudou apontaria para outro lugar —
   * e Enter abriria a tela errada.
   */
  const [selecao, setSelecao] = useState({ termo: "", indice: 0 });
  const indice = selecao.termo === termo ? selecao.indice : 0;
  const setIndice = (proximo: number | ((atual: number) => number)) =>
    setSelecao({
      termo,
      indice: typeof proximo === "function" ? proximo(indice) : proximo,
    });

  const dialogo = useRef<HTMLDialogElement>(null);
  const roteador = useRouter();
  const idLista = useId();
  const idCampo = useId();

  const tudo = useMemo<Resultado[]>(() => {
    const itens: Resultado[] = [];

    for (const app of apps) {
      itens.push({
        id: `app:${app.chave}`,
        rota: app.rota,
        titulo: app.nome,
        contexto: app.subtitulo,
        icone: app.icone,
        cor: app.cor,
        emConstrucao: app.emConstrucao,
      });

      for (const destino of app.navegacao) {
        // A rota-raiz do módulo já entrou acima com o nome do módulo.
        if (destino.rota === app.rota) continue;
        itens.push({
          id: `destino:${destino.rota}`,
          rota: destino.rota,
          titulo: destino.nome,
          contexto: app.nome,
          icone: app.icone,
          cor: app.cor,
          emConstrucao: app.emConstrucao,
        });
      }
    }

    return itens;
  }, [apps]);

  const resultados = useMemo(() => {
    const busca = normalizar(termo);
    if (!busca) return tudo.slice(0, 8);

    return tudo
      .filter((item) =>
        normalizar(`${item.titulo} ${item.contexto}`).includes(busca),
      )
      .slice(0, 12);
  }, [termo, tudo]);

  // O atalho anunciado no botão precisa existir de verdade.
  useEffect(() => {
    const aoTeclar = (evento: KeyboardEvent) => {
      if (
        (evento.ctrlKey || evento.metaKey) &&
        evento.key.toLowerCase() === "k"
      ) {
        evento.preventDefault();
        setAberta(true);
      }
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, []);

  useEffect(() => {
    const elemento = dialogo.current;
    if (!elemento) return;
    if (aberta && !elemento.open) elemento.showModal();
    if (!aberta && elemento.open) elemento.close();
  }, [aberta]);

  useEffect(() => {
    const elemento = dialogo.current;
    if (!elemento) return;
    const aoFechar = () => {
      setAberta(false);
      setTermo("");
      setSelecao({ termo: "", indice: 0 });
    };
    elemento.addEventListener("close", aoFechar);
    return () => elemento.removeEventListener("close", aoFechar);
  }, []);

  function ir(resultado: Resultado | undefined) {
    if (!resultado) return;
    dialogo.current?.close();
    roteador.push(resultado.rota);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAberta(true)}
        className="text-ink-3 border-line bg-surface-2 hover:border-line-2 hover:text-ink-2 focus-visible:outline-accent flex size-11 items-center justify-center gap-2 rounded-md border text-sm transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-3 sm:h-9 sm:w-[240px] sm:justify-start sm:px-2.5"
      >
        <Icone nome="lupa" tamanho={15} />
        <span className="hidden truncate sm:block">Buscar tela ou módulo</span>
        <span className="sr-only sm:hidden">Buscar tela ou módulo</span>
        <kbd className="border-line-2 text-ink-3 ml-auto hidden rounded border px-1 font-mono text-[11px] leading-4 sm:block">
          Ctrl K
        </kbd>
      </button>

      <dialog
        ref={dialogo}
        aria-label="Buscar tela ou módulo"
        onClick={(evento) => {
          if (evento.target === dialogo.current) dialogo.current?.close();
        }}
        className="bg-surface text-ink border-line m-0 mx-auto mt-[10vh] w-[min(92vw,540px)] max-w-none rounded-lg border p-0 shadow-[var(--shadow-flutuante)] backdrop:bg-[rgb(12_15_22/45%)]"
      >
        <div className="border-line flex items-center gap-2 border-b px-3">
          <Icone nome="lupa" tamanho={17} className="text-ink-3" />
          <label htmlFor={idCampo} className="sr-only">
            Buscar tela ou módulo
          </label>
          <input
            id={idCampo}
            autoFocus
            type="text"
            role="combobox"
            aria-expanded
            aria-controls={idLista}
            aria-autocomplete="list"
            aria-activedescendant={
              resultados[indice] ? `${idLista}-${indice}` : undefined
            }
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            onKeyDown={(evento) => {
              if (evento.key === "ArrowDown") {
                evento.preventDefault();
                setIndice((i) => (i + 1) % Math.max(resultados.length, 1));
              }
              if (evento.key === "ArrowUp") {
                evento.preventDefault();
                setIndice(
                  (i) =>
                    (i - 1 + Math.max(resultados.length, 1)) %
                    Math.max(resultados.length, 1),
                );
              }
              if (evento.key === "Enter") {
                evento.preventDefault();
                ir(resultados[indice]);
              }
            }}
            placeholder="Contas a pagar, contagens, fornecedores…"
            className="text-ink placeholder:text-ink-3 h-12 w-full bg-transparent text-base outline-none"
          />
        </div>

        <ul
          id={idLista}
          role="listbox"
          className="max-h-[50vh] overflow-y-auto p-1.5"
        >
          {resultados.map((resultado, i) => (
            <li key={resultado.id} role="none">
              <button
                type="button"
                id={`${idLista}-${i}`}
                role="option"
                aria-selected={i === indice}
                onMouseEnter={() => setIndice(i)}
                onClick={() => ir(resultado)}
                className={`flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors duration-150 ${
                  i === indice ? "bg-surface-2" : ""
                }`}
              >
                <span
                  aria-hidden="true"
                  className="grid size-7 flex-none place-items-center rounded-md"
                  style={{
                    background: resultado.cor.fundo,
                    color: resultado.cor.frente,
                  }}
                >
                  <Icone nome={resultado.icone} tamanho={14} />
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm leading-5 font-medium">
                    {resultado.titulo}
                  </span>
                  <span className="text-ink-3 block truncate text-xs leading-4">
                    {resultado.contexto}
                  </span>
                </span>

                {resultado.emConstrucao && (
                  <span className="bg-surface-3 text-ink-2 flex-none rounded-full px-1.5 py-0.5 text-[10px] leading-4 font-semibold">
                    em breve
                  </span>
                )}
              </button>
            </li>
          ))}

          {resultados.length === 0 && (
            <li className="px-3 py-6 text-center">
              <p className="text-sm leading-5 font-medium">
                Nenhuma tela com “{termo}”
              </p>
              <p className="text-ink-3 mt-1 text-xs leading-[18px]">
                Esta busca encontra módulos e telas. Ela ainda não procura
                dentro dos registros — para achar uma nota ou um fornecedor,
                abra o módulo e use a busca da lista.
              </p>
            </li>
          )}
        </ul>

        <p className="border-line text-ink-3 border-t px-3 py-2 text-xs leading-[18px]">
          Setas para escolher · Enter para abrir · Esc para fechar
        </p>
      </dialog>
    </>
  );
}
