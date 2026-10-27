"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { Botao, estiloDeBotao } from "@/design-system/botao";
import { solicitarImpressaoAcao } from "../impressao-acoes";
import type { DocumentoImpressaoPdv } from "../impressao-types";
import styles from "./impressao-pdv.module.css";

const moeda = (valor: number) =>
  (valor / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const data = (valor: string) =>
  new Date(valor).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
const status: Record<string, string> = {
  COZINHA: "Na cozinha",
  AGUARDANDO_COLETA: "Aguardando coleta",
  SAIU_ENTREGA: "Saiu para entrega",
  ENTREGUE: "Entregue",
  CANCELADO: "Cancelado",
  CONCLUIDA: "Concluída",
  CANCELADA: "Cancelada",
};
const formas: Record<string, string> = {
  DINHEIRO: "Dinheiro",
  PIX: "Pix",
  CREDITO: "Crédito",
  DEBITO: "Débito",
};

export function ImpressaoPdv({ inicial }: { inicial: DocumentoImpressaoPdv }) {
  const [documento, setDocumento] = useState(inicial);
  const [pendente, setPendente] = useState(false);
  const [autorizada, setAutorizada] = useState(false);
  const [incerta, setIncerta] = useState(false);
  const [mensagem, setMensagem] = useState("");
  const [erro, setErro] = useState("");
  const trava = useRef(false);
  const tentativa = useRef<string | null>(null);
  const aoTerminar = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      if (aoTerminar.current)
        window.removeEventListener("afterprint", aoTerminar.current);
    },
    [],
  );

  const solicitar = useCallback(async () => {
    if (trava.current) return;
    trava.current = true;
    tentativa.current ??= crypto.randomUUID();
    setPendente(true);
    setErro("");
    setMensagem("");
    try {
      const resposta = await solicitarImpressaoAcao({
        vendaId: inicial.vendaId,
        tipo: inicial.tipo,
        chave: tentativa.current,
      });
      if (resposta.erro || !resposta.resultado) {
        setErro(
          resposta.erro ?? "A solicitação não foi confirmada. Tente novamente.",
        );
        return;
      }
      const resultado = resposta.resultado;
      flushSync(() => {
        setDocumento(resultado.documento);
        setAutorizada(true);
        setIncerta(false);
      });
      tentativa.current = null;
      setMensagem(
        `${resultado.solicitacao.reimpressao ? "Nova solicitação desta via" : "Solicitação de impressão"} registrada em ${data(resultado.solicitacao.quando)}. O navegador não confirma se houve impressão.`,
      );
      if (aoTerminar.current)
        window.removeEventListener("afterprint", aoTerminar.current);
      const terminar = () => setAutorizada(false);
      aoTerminar.current = terminar;
      window.addEventListener("afterprint", terminar, { once: true });
      try {
        window.print();
      } catch {
        window.removeEventListener("afterprint", terminar);
        setAutorizada(false);
        setErro(
          "A solicitação foi registrada, mas o navegador não abriu a impressão. Use o botão para solicitar novamente.",
        );
      }
    } catch {
      setIncerta(true);
      setErro(
        "A confirmação da solicitação não chegou. Tente confirmar novamente; a mesma identificação evita duplicar o registro.",
      );
    } finally {
      trava.current = false;
      setPendente(false);
    }
  }, [inicial.vendaId, inicial.tipo]);

  useEffect(() => {
    const atalho = (evento: KeyboardEvent) => {
      if (
        (evento.ctrlKey || evento.metaKey) &&
        !evento.altKey &&
        !evento.shiftKey &&
        evento.key.toLowerCase() === "p"
      ) {
        evento.preventDefault();
        void solicitar();
      }
    };
    window.addEventListener("keydown", atalho);
    return () => window.removeEventListener("keydown", atalho);
  }, [solicitar]);

  return (
    <main
      className={`${styles.pagina} ${autorizada ? styles.liberada : styles.bloqueada}`}
    >
      <header className={styles.controles}>
        <div>
          <h1 className="text-xl font-semibold">
            {documento.tipo === "COZINHA"
              ? "Versão para a cozinha"
              : "Comprovante não fiscal"}
          </h1>
          <p className="text-ink-3 mt-2 max-w-2xl text-sm">
            Prévia para bobina de 80 mm. Escolha a impressora e o papel no
            navegador; também é possível usar A4 ou salvar em PDF. Use o botão
            Imprimir ou Ctrl+P para registrar a solicitação e abrir a impressão.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/pdv" className={estiloDeBotao("secundario")}>
            Voltar à gestão
          </Link>
          <Botao onClick={() => void solicitar()} carregando={pendente}>
            {incerta ? "Confirmar solicitação (Ctrl+P)" : "Imprimir (Ctrl+P)"}
          </Botao>
        </div>
        {mensagem && (
          <p role="status" className="text-ok text-sm">
            {mensagem}
          </p>
        )}
        {erro && (
          <p role="alert" className="text-bad text-sm">
            {erro}
          </p>
        )}
      </header>
      <p className={styles.bloqueioImpressao}>
        Use o botão “Imprimir (Ctrl+P)” nesta página para registrar a
        solicitação e abrir o documento.
      </p>
      <article
        className={`${styles.folha} ${documento.tipo === "COZINHA" ? styles.cozinha : ""}`}
        aria-label={
          documento.tipo === "COZINHA"
            ? "Via da cozinha sem preços"
            : "Comprovante não fiscal da venda"
        }
      >
        <header className={styles.cabecalho}>
          <p className={styles.marca}>Tetteo</p>
          <h2>{documento.unidade}</h2>
          <p>
            {documento.tipo === "COZINHA"
              ? "VIA DA COZINHA"
              : "COMPROVANTE NÃO FISCAL"}
          </p>
          <strong>NÃO É DOCUMENTO FISCAL</strong>
          {documento.pedido && <h3>Pedido #{documento.pedido.numero}</h3>}
          <p className={styles.identificacao}>Venda: {documento.vendaId}</p>
        </header>
        {(documento.statusVenda === "CANCELADA" ||
          documento.pedido?.status === "CANCELADO") && (
          <div className={styles.cancelado}>PEDIDO CANCELADO</div>
        )}
        <dl className={styles.dados}>
          <div>
            <dt>Data</dt>
            <dd>{data(documento.criadaEm)}</dd>
          </div>
          <div>
            <dt>Atendimento</dt>
            <dd>
              {documento.modalidade === "ENTREGA"
                ? "Entrega"
                : documento.modalidade === "BALCAO"
                  ? "Balcão"
                  : "Retirada"}
            </dd>
          </div>
          {documento.cliente && (
            <div>
              <dt>Cliente</dt>
              <dd>{documento.cliente}</dd>
            </div>
          )}
          <div>
            <dt>Operador</dt>
            <dd>{documento.operador}</dd>
          </div>
          <div>
            <dt>Venda</dt>
            <dd>{status[documento.statusVenda] ?? documento.statusVenda}</dd>
          </div>
          {documento.pedido && (
            <div>
              <dt>Pedido</dt>
              <dd>
                {status[documento.pedido.status] ?? documento.pedido.status}
              </dd>
            </div>
          )}
        </dl>
        <section className={styles.itens}>
          <h3>Itens</h3>
          {documento.itens.map((item, indice) => (
            <div key={indice} className={styles.item}>
              <p>
                <strong>
                  {item.quantidade} × {item.nome}
                </strong>
                {documento.tipo === "COMPROVANTE" && (
                  <span>{moeda(documento.itens[indice].totalCentavos)}</span>
                )}
              </p>
              {documento.tipo === "COMPROVANTE" && (
                <small>
                  {moeda(documento.itens[indice].precoUnitarioCentavos)} por
                  unidade
                </small>
              )}
              {item.complementos.length > 0 && (
                <div>
                  <h4 className={styles.rotuloComplementos}>
                    Complementos por unidade
                  </h4>
                  <ul>
                    {item.complementos.map((opcao, numero) => (
                      <li key={numero}>
                        {opcao.grupo}: {opcao.nome}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {item.observacao && (
                <p className={styles.observacao}>Obs.: {item.observacao}</p>
              )}
            </div>
          ))}
        </section>
        {documento.observacao && (
          <section className={styles.observacaoPedido}>
            <h3>Observação do pedido</h3>
            <p>{documento.observacao}</p>
          </section>
        )}
        {documento.tipo === "COMPROVANTE" && (
          <>
            <dl className={styles.totais}>
              <div>
                <dt>Subtotal</dt>
                <dd>{moeda(documento.subtotalCentavos)}</dd>
              </div>
              {documento.descontoCentavos > 0 && (
                <div>
                  <dt>Desconto</dt>
                  <dd>− {moeda(documento.descontoCentavos)}</dd>
                </div>
              )}
              {documento.taxaCentavos > 0 && (
                <div>
                  <dt>Taxa adicional</dt>
                  <dd>{moeda(documento.taxaCentavos)}</dd>
                </div>
              )}
              <div className={styles.total}>
                <dt>Total</dt>
                <dd>{moeda(documento.totalCentavos)}</dd>
              </div>
            </dl>
            <section className={styles.pagamentos}>
              <h3>Pagamentos registrados</h3>
              <dl>
                {documento.pagamentos.map((pagamento, indice) => (
                  <div key={indice}>
                    <dt>{formas[pagamento.forma] ?? pagamento.forma}</dt>
                    <dd>{moeda(pagamento.valorCentavos)}</dd>
                  </div>
                ))}
                <div>
                  <dt>Troco em dinheiro</dt>
                  <dd>{moeda(documento.trocoCentavos)}</dd>
                </div>
              </dl>
              <small>Valores informados pelo operador.</small>
            </section>
          </>
        )}
        {documento.motivoCancelamento && (
          <section className={styles.observacaoPedido}>
            <h3>Motivo do cancelamento</h3>
            <p>{documento.motivoCancelamento}</p>
          </section>
        )}
        <footer className={styles.fim}>
          <p>Prévia gerada em {data(documento.geradoEm)}</p>
          <p>
            {documento.tipo === "COZINHA"
              ? "Via de produção, sem valores financeiros."
              : "Este comprovante não substitui documento fiscal."}
          </p>
        </footer>
      </article>
    </main>
  );
}
