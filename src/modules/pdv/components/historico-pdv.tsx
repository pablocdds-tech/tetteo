"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Botao } from "@/design-system/botao";
import { Campo } from "@/design-system/campo";
import { PainelLateral } from "@/design-system/painel-lateral";

import { cancelarVendaAcao } from "../acoes";
import type { PagamentoPdv, VendaPdv } from "../types";

const moeda = (valor: number) =>
  (valor / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const data = (valor: string) => new Date(valor).toLocaleString("pt-BR");
const formas: Record<PagamentoPdv["forma"], string> = {
  DINHEIRO: "Dinheiro",
  PIX: "Pix",
  CREDITO: "Crédito",
  DEBITO: "Débito",
};

export function HistoricoPdv({
  vendas,
  podeCancelar,
}: {
  vendas: VendaPdv[];
  podeCancelar: boolean;
}) {
  const [busca, setBusca] = useState("");
  const [status, setStatus] = useState("TODAS");
  const [selecionada, setSelecionada] = useState<VendaPdv | null>(null);
  const termo = busca.trim().toLocaleLowerCase("pt-BR");
  const filtradas = vendas.filter(
    (venda) =>
      (status === "TODAS" || venda.status === status) &&
      `${venda.id} ${venda.cliente ?? ""} ${venda.operador}`
        .toLocaleLowerCase("pt-BR")
        .includes(termo),
  );
  const concluidas = filtradas.filter((venda) => venda.status === "CONCLUIDA");

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Vendas do PDV</h1>
        <p className="text-ink-3 mt-1 text-sm">
          Consulte os registros mais recentes, os itens vendidos e os pagamentos
          informados pelo caixa.
        </p>
      </header>
      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-48 flex-1">
          <Campo
            rotulo="Buscar por identificação, cliente ou operador"
            type="search"
            value={busca}
            onChange={(evento) => setBusca(evento.target.value)}
            placeholder="Buscar venda"
          />
        </div>
        <label className="text-ink-2 flex flex-col gap-1.5 text-sm font-semibold">
          Situação
          <select
            value={status}
            onChange={(evento) => setStatus(evento.target.value)}
            className="bg-surface border-line-2 text-ink h-10 rounded-md border px-3 font-normal"
          >
            <option value="TODAS">Todas</option>
            <option value="CONCLUIDA">Concluídas</option>
            <option value="CANCELADA">Canceladas</option>
          </select>
        </label>
      </div>
      <div className="border-line bg-surface flex flex-wrap items-center justify-between gap-3 rounded-xl border px-5 py-4">
        <span className="text-ink-3 text-sm">
          {filtradas.length} registros exibidos · {concluidas.length} vendas
          concluídas
        </span>
        <span className="font-semibold tabular-nums">
          Total concluído:{" "}
          {moeda(
            concluidas.reduce((soma, venda) => soma + venda.totalCentavos, 0),
          )}
        </span>
      </div>
      <section
        className="border-line bg-surface overflow-hidden rounded-xl border"
        aria-label="Lista de vendas"
      >
        {filtradas.length ? (
          <div className="divide-line divide-y">
            {filtradas.map((venda) => (
              <button
                key={venda.id}
                type="button"
                onClick={() => setSelecionada(venda)}
                className="hover:bg-surface-2 focus-visible:outline-accent flex w-full flex-wrap items-center gap-3 px-5 py-4 text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {venda.cliente ?? "Cliente não identificado"}
                  </p>
                  <p className="text-ink-3 mt-1 text-sm">
                    {data(venda.criadaEm)} · {venda.operador}
                  </p>
                  <p className="text-ink-3 mt-1 text-xs">{venda.id}</p>
                </div>
                <span
                  className={`${venda.status === "CANCELADA" ? "bg-bad-sub text-bad" : "bg-ok-sub text-ok"} rounded-full px-2.5 py-1 text-xs font-semibold`}
                >
                  {venda.status === "CANCELADA" ? "Cancelada" : "Concluída"}
                </span>
                <strong className="min-w-24 text-right tabular-nums">
                  {moeda(venda.totalCentavos)}
                </strong>
              </button>
            ))}
          </div>
        ) : (
          <div className="px-5 py-10 text-center">
            <h2 className="font-semibold">
              {busca || status !== "TODAS"
                ? "Nenhuma venda neste filtro"
                : "Nenhuma venda registrada"}
            </h2>
            <p className="text-ink-3 mt-2 text-sm">
              {busca || status !== "TODAS"
                ? "Altere a busca ou a situação para consultar outros registros."
                : "As vendas concluídas no PDV aparecerão aqui."}
            </p>
          </div>
        )}
      </section>
      {selecionada && (
        <DetalheVenda
          key={selecionada.id}
          venda={selecionada}
          podeCancelar={podeCancelar}
          aoFechar={() => setSelecionada(null)}
        />
      )}
    </div>
  );
}

function DetalheVenda({
  venda,
  podeCancelar,
  aoFechar,
}: {
  venda: VendaPdv;
  podeCancelar: boolean;
  aoFechar: () => void;
}) {
  const router = useRouter();
  const [cancelando, setCancelando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState("");
  const [pendente, iniciar] = useTransition();
  function cancelar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (pendente || !motivo.trim()) return;
    setErro("");
    iniciar(async () => {
      try {
        const resultado = await cancelarVendaAcao({
          vendaId: venda.id,
          motivo: motivo.trim(),
        });
        if (resultado.erro) setErro(resultado.erro);
        else {
          router.refresh();
          aoFechar();
        }
      } catch {
        setErro(
          "Não foi possível confirmar o cancelamento. Atualize a venda antes de tentar novamente.",
        );
      }
    });
  }

  return (
    <PainelLateral
      aberto
      aoFechar={aoFechar}
      podeFechar={() => !pendente}
      titulo="Detalhes da venda"
      apoio={venda.id}
      rodape={
        podeCancelar && venda.status === "CONCLUIDA" ? (
          cancelando ? (
            <>
              <Botao
                peso="secundario"
                disabled={pendente}
                onClick={() => setCancelando(false)}
              >
                Manter venda
              </Botao>
              <Botao
                peso="destrutivo"
                type="submit"
                form="cancelar-venda-pdv"
                carregando={pendente}
                disabled={!motivo.trim()}
              >
                Confirmar cancelamento
              </Botao>
            </>
          ) : (
            <Botao peso="secundario" onClick={() => setCancelando(true)}>
              Cancelar venda
            </Botao>
          )
        ) : undefined
      }
    >
      <div className="space-y-6">
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-ink-3">Cliente</dt>
            <dd className="mt-1 font-medium">
              {venda.cliente ?? "Não identificado"}
            </dd>
          </div>
          <div>
            <dt className="text-ink-3">Situação</dt>
            <dd className="mt-1 font-medium">
              {venda.status === "CONCLUIDA" ? "Concluída" : "Cancelada"}
            </dd>
          </div>
          <div>
            <dt className="text-ink-3">Data</dt>
            <dd className="mt-1">{data(venda.criadaEm)}</dd>
          </div>
          <div>
            <dt className="text-ink-3">Operador</dt>
            <dd className="mt-1">{venda.operador}</dd>
          </div>
          <div>
            <dt className="text-ink-3">Modalidade</dt>
            <dd className="mt-1">
              {venda.modalidade === "ENTREGA"
                ? "Entrega"
                : venda.modalidade === "RETIRADA"
                  ? "Retirada"
                  : "Balcão"}
            </dd>
          </div>
        </dl>
        <section>
          <h3 className="font-semibold">Itens da venda</h3>
          <div className="divide-line mt-2 divide-y">
            {venda.itens.map((item, indice) => (
              <div key={`${item.produtoId}-${indice}`} className="py-3">
                <div className="flex justify-between gap-3 text-sm">
                  <strong>
                    {item.quantidade} × {item.nome}
                  </strong>
                  <span className="shrink-0 font-semibold tabular-nums">
                    {moeda(item.totalCentavos)}
                  </span>
                </div>
                <p className="text-ink-3 mt-1 text-sm">
                  {moeda(item.precoUnitarioCentavos)} por unidade
                </p>
                {item.complementos.length > 0 && (
                  <ul className="text-ink-3 mt-2 space-y-1 text-sm">
                    {item.complementos.map((opcao, numero) => (
                      <li key={numero}>
                        {opcao.grupo}: {opcao.nome} (
                        {moeda(opcao.precoCentavos)})
                      </li>
                    ))}
                  </ul>
                )}
                {item.observacao && (
                  <p className="text-ink-2 mt-2 text-sm">
                    Observação: {item.observacao}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
        <dl className="border-line space-y-2 border-y py-4 text-sm">
          {[
            ["Subtotal", venda.subtotalCentavos],
            ["Desconto", -venda.descontoCentavos],
            ["Taxa adicional", venda.taxaCentavos],
            ["Total", venda.totalCentavos],
          ].map(([rotulo, valor]) => (
            <div
              key={rotulo}
              className={`flex justify-between gap-3 ${rotulo === "Total" ? "pt-2 text-base font-semibold" : "text-ink-2"}`}
            >
              <dt>{rotulo}</dt>
              <dd className="tabular-nums">{moeda(Number(valor))}</dd>
            </div>
          ))}
        </dl>
        <section>
          <h3 className="font-semibold">Pagamentos registrados</h3>
          <p className="text-ink-3 mt-1 text-xs">
            Registro manual do operador.
          </p>
          <dl className="mt-3 space-y-2 text-sm">
            {venda.pagamentos.map((pagamento, indice) => (
              <div key={indice} className="flex justify-between gap-3">
                <dt>{formas[pagamento.forma]}</dt>
                <dd className="tabular-nums">
                  {moeda(pagamento.valorCentavos)}
                </dd>
              </div>
            ))}
            {venda.trocoCentavos > 0 && (
              <div className="border-line flex justify-between gap-3 border-t pt-2">
                <dt>Troco em dinheiro</dt>
                <dd className="tabular-nums">{moeda(venda.trocoCentavos)}</dd>
              </div>
            )}
          </dl>
        </section>
        {venda.observacao && (
          <section>
            <h3 className="font-semibold">Observação do pedido</h3>
            <p className="text-ink-2 mt-2 text-sm whitespace-pre-wrap">
              {venda.observacao}
            </p>
          </section>
        )}
        {venda.motivoCancelamento && (
          <section className="bg-bad-sub text-bad rounded-lg p-3">
            <h3 className="text-sm font-semibold">Motivo do cancelamento</h3>
            <p className="mt-1 text-sm">{venda.motivoCancelamento}</p>
          </section>
        )}
        {cancelando && (
          <form
            id="cancelar-venda-pdv"
            onSubmit={cancelar}
            className="border-line space-y-3 border-t pt-4"
          >
            <h3 className="font-semibold">Cancelar esta venda</h3>
            <p className="text-ink-3 text-sm">
              O cancelamento preserva o histórico e estorna as movimentações
              vinculadas à venda. A devolução de dinheiro ou estorno da
              operadora deve ser realizado separadamente.
            </p>
            <Campo
              rotulo="Motivo do cancelamento"
              value={motivo}
              onChange={(evento) => setMotivo(evento.target.value)}
              required
              minLength={3}
              maxLength={500}
              disabled={pendente}
            />
            {erro && (
              <p role="alert" className="text-bad text-sm">
                {erro}
              </p>
            )}
          </form>
        )}
      </div>
    </PainelLateral>
  );
}
