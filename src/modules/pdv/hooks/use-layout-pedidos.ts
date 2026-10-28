"use client";
import { useMemo, useSyncExternalStore } from "react";
import {
  LAYOUT_PEDIDOS_PADRAO,
  lerLayoutPedidos,
  esquemaLayoutPedidos,
  type LayoutPedidos,
} from "../schemas/layout-pedidos";

const evento = "pdv-layout-atualizado";
function observar(avisar: () => void) {
  window.addEventListener("storage", avisar);
  window.addEventListener(evento, avisar);
  return () => {
    window.removeEventListener("storage", avisar);
    window.removeEventListener(evento, avisar);
  };
}
const noServidor = () => LAYOUT_PEDIDOS_PADRAO;

function criarFonte(escopo: string) {
  const chave = `tetteo.pdv.layout.v1:${escopo}`;
  let ultimo: string | null | undefined;
  let atual = LAYOUT_PEDIDOS_PADRAO;
  let soMemoria = false;
  const ler = () => {
    if (soMemoria) return atual;
    try {
      const valor = localStorage.getItem(chave);
      if (valor !== ultimo) {
        ultimo = valor;
        atual = lerLayoutPedidos(valor);
      }
    } catch {
      soMemoria = true;
    }
    return atual;
  };
  const atualizar = (mudar: (anterior: LayoutPedidos) => LayoutPedidos) => {
    atual = esquemaLayoutPedidos.parse(mudar(ler()));
    ultimo = JSON.stringify(atual);
    try {
      localStorage.setItem(chave, ultimo);
    } catch {
      soMemoria = true;
    }
    window.dispatchEvent(new Event(evento));
  };
  return { ler, atualizar };
}

/** Preferências de apresentação por operador/unidade. Nunca armazena pedidos ou clientes. */
export function useLayoutPedidos(escopo: string) {
  const fonte = useMemo(() => criarFonte(escopo), [escopo]);
  const layout = useSyncExternalStore(observar, fonte.ler, noServidor);
  return [layout, fonte.atualizar] as const;
}
