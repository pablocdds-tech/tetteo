"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icone } from "@/design-system/icones";
import { PainelLateral } from "@/design-system/painel-lateral";
import { destinoAtual, type AppNaBarra, type DestinoDoApp } from "./apps";
import { AvisoDeConexao } from "./aviso-de-conexao";
import { ProvedorDeAmbientes } from "./link-integrado";
import styles from "./ambiente-aplicativo.module.css";

export function AmbienteAplicativo({
  app,
  principal,
  organizacao,
  seletorDeUnidade,
  conta,
  ajuda,
  children,
  className,
}: {
  app: AppNaBarra;
  principal: string;
  organizacao: string;
  seletorDeUnidade: ReactNode;
  conta: ReactNode;
  ajuda?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const caminho = usePathname();
  const [menuAberto, setMenuAberto] = useState(false);
  const [recolhido, setRecolhido] = useState(false);
  const contaRef = useRef<HTMLDetailsElement>(null);
  const ajudaRef = useRef<HTMLDetailsElement>(null);
  const atual = destinoAtual(app, caminho);
  const destinos = app.navegacao.filter((d) => !d.somenteAcao);
  const grupos = [
    ...new Set(destinos.flatMap((d) => (d.grupo ? [d.grupo] : []))),
  ];
  useEffect(() => {
    const menus = [contaRef, ajudaRef];
    function fora(e: PointerEvent) {
      for (const ref of menus)
        if (
          ref.current?.open &&
          e.target instanceof Node &&
          !ref.current.contains(e.target)
        )
          ref.current.open = false;
    }
    function escapar(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      const aberto = menus.find((ref) => ref.current?.open)?.current;
      if (aberto) {
        aberto.open = false;
        aberto.querySelector("summary")?.focus();
        e.preventDefault();
        e.stopPropagation();
      }
    }
    document.addEventListener("pointerdown", fora);
    document.addEventListener("keydown", escapar, true);
    return () => {
      document.removeEventListener("pointerdown", fora);
      document.removeEventListener("keydown", escapar, true);
    };
  }, []);
  function item(destino: DestinoDoApp) {
    return (
      <Link
        key={destino.rota}
        href={destino.rota}
        aria-label={destino.nome}
        title={destino.nome}
        aria-current={atual?.rota === destino.rota ? "page" : undefined}
        onClick={() => setMenuAberto(false)}
        className={styles.item}
      >
        {destino.icone && <Icone nome={destino.icone} tamanho={20} />}
        <span>{destino.nome}</span>
      </Link>
    );
  }
  const navegacao = (
    <div className={styles.navegacao}>
      <Link
        href={app.rota}
        className={styles.marca}
        aria-label={`${app.marca ?? app.nome} ${app.nome}`}
      >
        <strong>{app.marca ?? app.nome}</strong>
        <span>{app.nome}</span>
      </Link>
      <div className={styles.unidade}>
        <span className={styles.unidadeIcone} aria-hidden="true">
          {organizacao.trim().charAt(0)}
        </span>
        <div>
          <p title={organizacao}>{organizacao}</p>
          {seletorDeUnidade}
        </div>
      </div>
      <nav aria-label={`Seções do ${app.nome}`} className={styles.secoes}>
        {destinos.filter((d) => !d.grupo).map(item)}
        {grupos.map((grupo) => {
          const itens = destinos.filter((d) => d.grupo === grupo);
          return (
            <details
              key={grupo}
              className={styles.grupo}
              open={itens.some((d) => d.rota === atual?.rota)}
            >
              <summary
                title={grupo}
                aria-label={grupo}
                onClick={(e) => {
                  if (recolhido) {
                    e.preventDefault();
                    setRecolhido(false);
                  }
                }}
              >
                <Icone nome={itens[0].icone ?? app.icone} tamanho={20} />
                <span>{grupo}</span>
                <Icone nome="seta-baixo" tamanho={13} />
              </summary>
              <div>{itens.map(item)}</div>
            </details>
          );
        })}
      </nav>
      <footer className={styles.rodape}>
        <a
          href={principal}
          className={styles.item}
          aria-label="Abrir Tetteo"
          title="Abrir Tetteo"
        >
          <Icone nome="grade" tamanho={20} />
          <span>Abrir Tetteo</span>
        </a>
        <button
          type="button"
          className={styles.recolher}
          onClick={() => setRecolhido((v) => !v)}
          aria-label={recolhido ? "Expandir menu" : "Recolher menu"}
          aria-expanded={!recolhido}
        >
          <Icone
            nome={recolhido ? "seta-direita" : "seta-esquerda"}
            tamanho={16}
          />
        </button>
      </footer>
    </div>
  );
  return (
    <ProvedorDeAmbientes principal={principal} rotaAplicativo={app.rota}>
      <div
        className={`${styles.ambiente} ${className ?? ""}`}
        data-recolhido={recolhido}
      >
        <aside aria-label={`Menu do ${app.nome}`} className={styles.lateral}>
          {navegacao}
        </aside>
        <PainelLateral
          aberto={menuAberto}
          aoFechar={() => setMenuAberto(false)}
          titulo={`Menu do ${app.nome}`}
        >
          {menuAberto ? navegacao : null}
        </PainelLateral>
        <div className={styles.area}>
          <header className={styles.topo}>
            <button
              type="button"
              onClick={() => setMenuAberto(true)}
              aria-label={`Abrir menu do ${app.nome}`}
              aria-expanded={menuAberto}
              className={styles.menuMovel}
            >
              <Icone nome="menu" tamanho={22} />
            </button>
            <span className={styles.titulo}>
              {atual?.titulo ?? atual?.nome ?? app.nome}
            </span>
            {ajuda && (
              <details className={styles.ajuda} ref={ajudaRef}>
                <summary aria-label="Guia rápido" title="Guia rápido">
                  <span aria-hidden="true">?</span>
                </summary>
                <div>{ajuda}</div>
              </details>
            )}
            <div className={styles.acoesTopo}>
              <a
                href={principal}
                aria-label="Abrir Tetteo"
                title="Abrir Tetteo"
              >
                <Icone nome="grade" tamanho={19} />
              </a>
              <details className={styles.conta} ref={contaRef}>
                <summary aria-label="Minha conta" title="Minha conta">
                  <Icone nome="pessoa" tamanho={20} />
                </summary>
                <div>{conta}</div>
              </details>
            </div>
          </header>
          <AvisoDeConexao />
          <main className={styles.conteudo}>{children}</main>
        </div>
      </div>
    </ProvedorDeAmbientes>
  );
}
