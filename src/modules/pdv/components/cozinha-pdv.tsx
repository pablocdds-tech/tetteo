"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAmbienteProprio } from "@/core/shell/link-integrado";
import { Icone } from "@/design-system/icones";
import { atualizarCozinhaAcao, concluirPreparoAcao } from "../acoes-cozinha";
import type { PedidoCozinha, QuadroCozinha } from "../cozinha-types";
import comum from "./secoes-pdv.module.css";
import styles from "./cozinha-pdv.module.css";

const hora = (valor: string) =>
  new Date(valor).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
export function CozinhaPdv({
  inicial,
  podeOperar,
}: {
  inicial: QuadroCozinha;
  podeOperar: boolean;
}) {
  const proprio = useAmbienteProprio();
  const [quadro, setQuadro] = useState(inicial);
  const [busca, setBusca] = useState("");
  const [modo, setModo] = useState<PedidoCozinha["status"]>("COZINHA");
  const [tipo, setTipo] = useState("TODOS");
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState("");
  const [agora, setAgora] = useState(() =>
    new Date(inicial.atualizadoEm).getTime(),
  );
  const [atualizando, setAtualizando] = useState(false);
  const trava = useRef(false);
  const consultando = useRef(false);
  const geracao = useRef(0);
  const montado = useRef(true);
  useEffect(() => {
    montado.current = true;
    geracao.current++;
    return () => {
      montado.current = false;
    };
  }, []);
  const atualizar = useCallback(async () => {
    if (trava.current || consultando.current) return;
    consultando.current = true;
    const versao = geracao.current;
    setAtualizando(true);
    try {
      const r = await atualizarCozinhaAcao();
      if (!montado.current || versao !== geracao.current) return;
      if (r.quadro) {
        setQuadro(r.quadro);
        setErro("");
      } else setErro(r.erro ?? "Não foi possível atualizar.");
    } catch {
      if (montado.current && versao === geracao.current)
        setErro("Sem conexão. Os pedidos abaixo podem estar desatualizados.");
    } finally {
      consultando.current = false;
      if (montado.current) setAtualizando(false);
    }
  }, []);
  useEffect(() => {
    const timer = setInterval(() => {
      setAgora(Date.now());
      if (!document.hidden) void atualizar();
    }, 15000);
    const retomar = () => {
      if (!document.hidden) void atualizar();
    };
    document.addEventListener("visibilitychange", retomar);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", retomar);
    };
  }, [atualizar]);
  async function pronto(p: PedidoCozinha) {
    if (trava.current) return;
    trava.current = true;
    geracao.current++;
    setOcupado(p.id);
    setErro("");
    setAviso("");
    try {
      const r = await concluirPreparoAcao({ pedidoId: p.id, versao: p.versao });
      if (!montado.current) return;
      if (r.quadro) {
        setQuadro(r.quadro);
        setAviso("Pedido #" + p.numero + " pronto para coleta.");
      } else setErro(r.erro ?? "Atualize a cozinha para conferir o pedido.");
    } catch {
      if (montado.current)
        setErro(
          "A confirmação não chegou. Atualize a cozinha antes de repetir.",
        );
    } finally {
      trava.current = false;
      if (montado.current) setOcupado("");
    }
  }
  const pedidos = quadro.pedidos.filter(
    (p) =>
      p.status === modo &&
      (tipo === "TODOS" || p.modalidade === tipo) &&
      (p.numero + " " + p.itens.map((i) => i.nome).join(" "))
        .toLocaleLowerCase("pt-BR")
        .includes(busca.trim().toLocaleLowerCase("pt-BR")),
  );
  return (
    <div className={comum.pagina}>
      <h1 className={proprio ? "sr-only" : comum.titulo}>Cozinha</h1>
      <div className={styles.barra}>
        <label className={comum.busca}>
          <Icone nome="lupa" tamanho={18} />
          <input
            type="search"
            aria-label="Buscar número ou item na cozinha"
            placeholder="Número do pedido ou produto"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </label>
        <div className={comum.abas} aria-label="Etapa da cozinha">
          <button
            aria-pressed={modo === "COZINHA"}
            onClick={() => setModo("COZINHA")}
          >
            Em preparo <strong>{quadro.emPreparo}</strong>
          </button>
          <button
            aria-pressed={modo === "AGUARDANDO_COLETA"}
            onClick={() => setModo("AGUARDANDO_COLETA")}
          >
            Prontos <strong>{quadro.prontos}</strong>
          </button>
        </div>
        <select
          aria-label="Tipo de pedido"
          value={tipo}
          onChange={(e) => setTipo(e.target.value)}
        >
          <option value="TODOS">Todos os tipos</option>
          <option value="ENTREGA">Delivery</option>
          <option value="RETIRADA">Retirada</option>
          <option value="BALCAO">Balcão</option>
        </select>
        <button
          className={comum.botao}
          disabled={!!ocupado || atualizando}
          onClick={() => void atualizar()}
        >
          {atualizando ? "Atualizando…" : "Atualizar"}
        </button>
      </div>
      {erro && (
        <p role="alert" className="bg-bad-sub text-bad rounded p-3 text-sm">
          {erro}
        </p>
      )}
      {aviso && (
        <p role="status" className="text-ok text-sm">
          {aviso}
        </p>
      )}
      {quadro.truncado && (
        <p role="alert" className="text-warn text-sm">
          Há mais pedidos ativos do que o limite desta consulta. Confira também
          a gestão de pedidos.
        </p>
      )}
      <div className={styles.pedidos}>
        {pedidos.map((p) => {
          const minutos = Math.max(
            0,
            Math.floor((agora - new Date(p.iniciadoEm).getTime()) / 60000),
          );
          return (
            <article
              key={p.id}
              className={styles.pedido}
              data-pronto={p.status === "AGUARDANDO_COLETA" || undefined}
            >
              <header>
                <strong>#{p.numero}</strong>
                <span>
                  {p.modalidade === "ENTREGA"
                    ? "Delivery"
                    : p.modalidade === "RETIRADA"
                      ? "Retirada"
                      : "Balcão"}
                </span>
                <time dateTime={p.iniciadoEm}>
                  {minutos} min · {hora(p.iniciadoEm)}
                </time>
              </header>
              {p.agendadoPara && (
                <p className={styles.agendado}>
                  Agendado para{" "}
                  {new Date(p.agendadoPara).toLocaleString("pt-BR", {
                    timeZone: "America/Sao_Paulo",
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </p>
              )}
              <ul>
                {p.itens.map((item, i) => (
                  <li key={i}>
                    <strong>
                      {item.quantidade} × {item.nome}
                    </strong>
                    {item.complementos.map((c, n) => (
                      <p key={n}>{c}</p>
                    ))}
                    {item.observacao && (
                      <p className={styles.observacao}>{item.observacao}</p>
                    )}
                  </li>
                ))}
              </ul>
              {p.observacao && (
                <p className={styles.observacao}>{p.observacao}</p>
              )}
              <footer>
                {p.status === "COZINHA" ? (
                  podeOperar ? (
                    <button
                      className={comum.primario}
                      disabled={!!ocupado}
                      onClick={() => void pronto(p)}
                    >
                      {ocupado === p.id ? "Confirmando…" : "Concluir preparo"}
                    </button>
                  ) : (
                    <span className={comum.legenda}>Consulta de preparo</span>
                  )
                ) : (
                  <>
                    <span className={comum.legenda}>
                      {p.prontoEm
                        ? "Pronto às " + hora(p.prontoEm)
                        : "Pronto para coleta"}
                    </span>
                    <Link href="/pdv" className={comum.link}>
                      Abrir gestão
                    </Link>
                  </>
                )}
              </footer>
            </article>
          );
        })}
      </div>
      {!pedidos.length && (
        <div className={comum.vazio}>
          <Icone nome="prato" tamanho={42} />
          <h2>
            {modo === "COZINHA"
              ? "Nenhum pedido em preparo"
              : "Nenhum pedido aguardando coleta"}
          </h2>
          <p>
            {busca || tipo !== "TODOS"
              ? "Confira a busca e os filtros."
              : "Os pedidos aparecerão aqui automaticamente."}
          </p>
        </div>
      )}
      <p className={comum.legenda}>
        Atualizado às {hora(quadro.atualizadoEm)} · Atualização automática a
        cada 15 segundos. Finalizar o preparo envia o pedido para a coleta na
        gestão.
      </p>
    </div>
  );
}
