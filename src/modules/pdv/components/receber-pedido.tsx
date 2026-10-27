"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Botao } from "@/design-system/botao";
import { Campo } from "@/design-system/campo";
import { PainelLateral } from "@/design-system/painel-lateral";
import {
  consultarRecebimentoAcao,
  receberPedidoAcao,
} from "../acoes-recebimentos";
import type { DadosRecebimento, ReceberEntrada } from "../recebimento-types";
import type { PagamentoPdv } from "../types";

const formas: Record<PagamentoPdv["forma"], string> = {
  DINHEIRO: "Dinheiro",
  PIX: "Pix",
  CREDITO: "Crédito",
  DEBITO: "Débito",
};
const moeda = (valor: number) =>
  (valor / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
function centavos(texto: string) {
  const limpo = texto.trim();
  if (!/^\d+(?:[,.]\d{1,2})?$/.test(limpo)) return NaN;
  return Math.round(Number(limpo.replace(",", ".")) * 100);
}

export function ReceberPedido({
  vendaId,
  aoFechar,
  aoReceber,
}: {
  vendaId: string;
  aoFechar: () => void;
  aoReceber: () => void;
}) {
  const [dados, setDados] = useState<DadosRecebimento | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [revisao, setRevisao] = useState(0);
  const [erro, setErro] = useState("");
  const [forma, setForma] = useState<PagamentoPdv["forma"]>("DINHEIRO");
  const [valor, setValor] = useState("");
  const [pagamentos, setPagamentos] = useState<PagamentoPdv[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [incerta, setIncerta] = useState(false);
  const [reconsultar, setReconsultar] = useState(false);
  const tentativa = useRef<ReceberEntrada | null>(null);
  const trava = useRef(false);
  useEffect(() => {
    let ativa = true;
    consultarRecebimentoAcao({ vendaId })
      .then((resultado) => {
        if (!ativa) return;
        if (resultado.dados) setDados(resultado.dados);
        else setErro(resultado.erro ?? "Não foi possível consultar o pedido.");
        setCarregando(false);
      })
      .catch(() => {
        if (ativa) {
          setErro("Não foi possível consultar o pedido. Tente novamente.");
          setCarregando(false);
        }
      });
    return () => {
      ativa = false;
    };
  }, [vendaId, revisao]);
  useEffect(() => {
    if (!ocupado && !incerta) return;
    const proteger = (evento: BeforeUnloadEvent) => {
      evento.preventDefault();
    };
    window.addEventListener("beforeunload", proteger);
    return () => window.removeEventListener("beforeunload", proteger);
  }, [ocupado, incerta]);
  const total = dados?.venda.totalCentavos ?? 0;
  const pago = pagamentos.reduce(
    (soma, pagamento) => soma + pagamento.valorCentavos,
    0,
  );
  const pendente = dados?.venda.status === "PENDENTE";
  function atualizar() {
    if (ocupado || incerta) return;
    if (
      (pagamentos.length || valor.trim()) &&
      !window.confirm(
        "Atualizar a situação e descartar os pagamentos ainda não registrados?",
      )
    )
      return;
    setPagamentos([]);
    setValor("");
    setErro("");
    setDados(null);
    setReconsultar(false);
    setCarregando(true);
    tentativa.current = null;
    setRevisao((n) => n + 1);
  }
  function adicionar() {
    const recebido = valor.trim() ? centavos(valor) : Math.max(0, total - pago);
    if (pagamentos.length >= 20) {
      setErro("Use até 20 pagamentos para quitar o pedido.");
      return;
    }
    if (
      !Number.isSafeInteger(recebido) ||
      recebido <= 0 ||
      recebido > 100_000_000
    ) {
      setErro(
        "Informe um valor entre R$ 0,01 e R$ 1.000.000,00, com até duas casas decimais.",
      );
      return;
    }
    if (forma !== "DINHEIRO" && recebido > total - pago) {
      setErro("Somente dinheiro pode gerar troco. Informe o valor restante.");
      return;
    }
    setPagamentos((atuais) => [...atuais, { forma, valorCentavos: recebido }]);
    setValor("");
    setErro("");
  }
  async function receber() {
    if (
      trava.current ||
      reconsultar ||
      (!tentativa.current &&
        (!dados?.caixa || !pendente || pago < total || !pagamentos.length))
    )
      return;
    if (!navigator.onLine) {
      setErro(
        "Sem conexão. Mantenha esta tela aberta e tente novamente quando a internet voltar.",
      );
      return;
    }
    trava.current = true;
    setOcupado(true);
    setErro("");
    tentativa.current ??= {
      vendaId,
      versaoFinanceira: dados!.venda.versaoFinanceira ?? 1,
      caixaId: dados!.caixa!.id,
      chave: crypto.randomUUID(),
      pagamentos: pagamentos.map((p) => ({ ...p })),
    };
    try {
      const resultado = await receberPedidoAcao(tentativa.current);
      if (resultado.erro) {
        setErro(resultado.erro);
        if (!incerta) setReconsultar(true);
        return;
      }
      if (!resultado.ok) throw new Error("Resposta sem confirmação");
      aoReceber();
      aoFechar();
    } catch {
      setIncerta(true);
      setErro(
        "A resposta não foi confirmada. Não receba novamente em outra tela. Confirme novamente aqui: a mesma identificação evita duplicação.",
      );
    } finally {
      trava.current = false;
      setOcupado(false);
    }
  }
  return (
    <PainelLateral
      aberto
      aoFechar={aoFechar}
      podeFechar={() =>
        !ocupado &&
        !incerta &&
        (!(pagamentos.length || valor.trim()) ||
          window.confirm("Sair sem registrar estes pagamentos?"))
      }
      titulo={
        dados?.pedidoNumero
          ? `Receber pedido #${String(dados.pedidoNumero).padStart(4, "0")}`
          : "Receber pedido"
      }
      apoio="Confira os valores recebidos. Pix e cartões são conferidos manualmente."
      rodape={
        pendente && (dados?.caixa || incerta) ? (
          <Botao
            className="w-full"
            carregando={ocupado}
            disabled={
              carregando ||
              reconsultar ||
              (!incerta &&
                (pago < total || !pagamentos.length || !!valor.trim()))
            }
            onClick={() => void receber()}
          >
            {incerta ? "Confirmar novamente" : "Registrar pagamento"} ·{" "}
            {moeda(total)}
          </Botao>
        ) : undefined
      }
    >
      <div className="space-y-5">
        {carregando && <p role="status">Consultando pedido…</p>}
        {dados && (
          <>
            <p className="bg-surface-2 rounded-md p-3 text-sm font-semibold">
              {pendente
                ? "Aguardando pagamento"
                : dados.venda.status === "CONCLUIDA"
                  ? "Pagamento registrado"
                  : "Pedido cancelado"}
            </p>
            {dados.venda.cliente && (
              <p className="text-sm">Cliente: {dados.venda.cliente}</p>
            )}
            <ul className="divide-line divide-y">
              {dados.venda.itens.map((item, indice) => (
                <li key={indice} className="py-3 text-sm">
                  <div className="flex justify-between gap-3">
                    <strong>
                      {item.quantidade} × {item.nome}
                    </strong>
                    <span className="shrink-0 tabular-nums">
                      {moeda(item.totalCentavos)}
                    </span>
                  </div>
                  {item.complementos.length > 0 && (
                    <p className="text-ink-3 mt-1 text-xs">
                      Complementos por unidade:{" "}
                      {item.complementos
                        .map((opcao) => `${opcao.grupo}: ${opcao.nome}`)
                        .join("; ")}
                    </p>
                  )}
                  {item.observacao && (
                    <p className="text-ink-2 mt-1">{item.observacao}</p>
                  )}
                </li>
              ))}
            </ul>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt>Subtotal</dt>
                <dd>{moeda(dados.venda.subtotalCentavos)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Desconto</dt>
                <dd>{moeda(dados.venda.descontoCentavos)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Taxa adicional</dt>
                <dd>{moeda(dados.venda.taxaCentavos)}</dd>
              </div>
              {!!dados.venda.freteCentavos && (
                <div className="flex justify-between">
                  <dt>Frete</dt>
                  <dd>{moeda(dados.venda.freteCentavos)}</dd>
                </div>
              )}
              <div className="border-line flex justify-between border-t pt-3 text-lg font-semibold">
                <dt>Total do pedido</dt>
                <dd>{moeda(total)}</dd>
              </div>
            </dl>
            {dados.venda.observacao && (
              <p className="text-ink-2 text-sm">
                Observação: {dados.venda.observacao}
              </p>
            )}
            {pendente && !dados.caixa && !incerta && (
              <div className="bg-warn-sub space-y-2 rounded-md p-3 text-sm">
                <p>Abra um caixa nesta unidade para registrar o recebimento.</p>
                <Link
                  className="text-accent underline"
                  href="/pdv/caixa"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Abrir caixa em outra aba
                </Link>
              </div>
            )}
            {pendente && (dados.caixa || incerta) && (
              <>
                <p className="text-ink-3 text-xs">
                  Caixa de recebimento:{" "}
                  {dados.caixa?.operador ??
                    "identificado na tentativa original"}
                  . Todos os valores serão registrados juntos.
                </p>
                <fieldset disabled={ocupado || incerta} className="space-y-3">
                  <legend className="mb-2 text-sm font-semibold">
                    Forma de pagamento
                  </legend>
                  <div className="grid grid-cols-2 gap-2">
                    {Object.entries(formas).map(([id, nome]) => (
                      <Botao
                        key={id}
                        peso="secundario"
                        aria-pressed={forma === id}
                        onClick={() => setForma(id as PagamentoPdv["forma"])}
                      >
                        {forma === id ? "✓ " : ""}
                        {nome}
                      </Botao>
                    ))}
                  </div>
                  <Campo
                    rotulo="Valor recebido (R$)"
                    inputMode="decimal"
                    value={valor}
                    placeholder={(Math.max(0, total - pago) / 100)
                      .toFixed(2)
                      .replace(".", ",")}
                    onChange={(e) => setValor(e.target.value)}
                  />
                  <Botao
                    className="w-full"
                    peso="secundario"
                    disabled={pago >= total}
                    onClick={adicionar}
                  >
                    Adicionar pagamento
                  </Botao>
                </fieldset>
                <section
                  aria-label="Pagamentos a registrar"
                  className="space-y-2"
                >
                  {!pagamentos.length && (
                    <p className="text-ink-3 text-sm">
                      Adicione os valores recebidos para quitar o pedido.
                    </p>
                  )}
                  {pagamentos.map((p, indice) => (
                    <div
                      key={indice}
                      className="border-line flex items-center gap-2 border-b py-2 text-sm"
                    >
                      <span className="flex-1">{formas[p.forma]}</span>
                      <strong>{moeda(p.valorCentavos)}</strong>
                      <button
                        type="button"
                        className="min-h-11 min-w-11"
                        disabled={ocupado || incerta}
                        aria-label={`Remover pagamento ${indice + 1}`}
                        onClick={() =>
                          setPagamentos((atuais) =>
                            atuais.filter((_, i) => i !== indice),
                          )
                        }
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </section>
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <dt>Total recebido</dt>
                    <dd>{moeda(pago)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>Falta receber</dt>
                    <dd>{moeda(Math.max(0, total - pago))}</dd>
                  </div>
                  {pago > total && (
                    <div className="text-accent flex justify-between font-semibold">
                      <dt>Troco em dinheiro</dt>
                      <dd>{moeda(pago - total)}</dd>
                    </div>
                  )}
                </dl>
                {!!valor.trim() && (
                  <p className="text-ink-3 text-xs">
                    Adicione ou limpe o valor digitado antes de registrar.
                  </p>
                )}
              </>
            )}
          </>
        )}
        {erro && (
          <p
            role="alert"
            className="bg-bad-sub text-bad rounded-md p-3 text-sm"
          >
            {erro}
          </p>
        )}
        {!incerta && (
          <Botao
            peso="secundario"
            disabled={ocupado || carregando}
            onClick={atualizar}
          >
            Atualizar situação do pedido
          </Botao>
        )}
        {incerta && (
          <Link
            href="/pdv/vendas"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent text-sm underline"
          >
            Consultar vendas em outra aba
          </Link>
        )}
      </div>
    </PainelLateral>
  );
}
