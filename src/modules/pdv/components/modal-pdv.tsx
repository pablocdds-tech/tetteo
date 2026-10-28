"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Icone } from "@/design-system/icones";
import styles from "./secoes-pdv.module.css";

export function ModalPdv({
  aberto,
  titulo,
  aoFechar,
  ocupado = false,
  amplo = false,
  children,
  rodape,
  podeFechar,
}: {
  aberto: boolean;
  titulo: string;
  aoFechar: () => void;
  ocupado?: boolean;
  amplo?: boolean;
  children: ReactNode;
  rodape?: ReactNode;
  podeFechar?: () => boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const el = ref.current;
    if (aberto && el && !el.open) {
      el.showModal();
      el.querySelector<HTMLElement>("[data-foco-inicial]")?.focus();
    }
    if (!aberto && el?.open) el.close();
  }, [aberto]);
  useEffect(() => {
    if (!aberto) return;
    const antes = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = antes;
    };
  }, [aberto]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={id}
      className={styles.modal}
      data-amplo={amplo || undefined}
      onCancel={(e) => {
        if (ocupado || (podeFechar && !podeFechar())) e.preventDefault();
      }}
      onClose={aoFechar}
    >
      <header>
        <h2 id={id}>{titulo}</h2>
        <button
          type="button"
          aria-label="Fechar janela"
          disabled={ocupado}
          onClick={() => {
            if (!podeFechar || podeFechar()) ref.current?.close();
          }}
        >
          <Icone nome="fechar" tamanho={20} />
        </button>
      </header>
      <div className={styles.corpoModal}>{children}</div>
      {rodape && <footer>{rodape}</footer>}
    </dialog>
  );
}
