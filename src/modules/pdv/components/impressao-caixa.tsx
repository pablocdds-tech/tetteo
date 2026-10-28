"use client";

import Link from "next/link";
import type { DetalheCaixa } from "../caixa-types";
import { fontePdv } from "../fonte";
import { ResumoCaixa } from "./resumo-caixa";
import styles from "./gestao-caixa.module.css";
import aparencia from "./pdv-aparencia.module.css";

export function ImpressaoCaixa({
  caixa,
  unidade,
}: {
  caixa: DetalheCaixa;
  unidade: string;
}) {
  return (
    <main
      className={`${fontePdv.variable} ${aparencia.aparencia} ${styles.impressao}`}
    >
      <h1>Resumo do caixa</h1>
      <p>{unidade}</p>
      <p>Documento não fiscal</p>
      <ResumoCaixa caixa={caixa} />
      <nav>
        <Link className={styles.botao} href={`/pdv/caixa?caixa=${caixa.id}`}>
          Voltar ao caixa
        </Link>
        <button className={styles.primario} onClick={() => window.print()}>
          Imprimir
        </button>
      </nav>
    </main>
  );
}
