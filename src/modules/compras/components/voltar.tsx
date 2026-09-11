"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";

import { Icone } from "@/design-system/icones";

import { lerRecorte } from "./recorte";

/**
 * VOLTAR PARA A LISTA COMO ELA ESTAVA.
 *
 * Os filtros das listas de Compras moram no endereço (DESIGN.md §5), e o
 * FiltrosDeCompras guarda nesta aba o último recorte de cada lista. Voltar do
 * detalhe devolve a loja, o estado e a rodada que a pessoa tinha escolhido —
 * em vez de jogá-la na lista inteira de novo.
 */
const nada = () => () => {};

export function Voltar({ para, rotulo }: { para: string; rotulo: string }) {
  const recorte = useSyncExternalStore(
    nada,
    () => lerRecorte(para),
    () => "",
  );
  return (
    <Link
      href={recorte ? `${para}?${recorte}` : para}
      className="text-ink-3 hover:text-ink inline-flex min-h-11 items-center gap-1 self-start text-sm md:min-h-0"
    >
      <Icone nome="seta-esquerda" tamanho={14} />
      {rotulo}
    </Link>
  );
}
