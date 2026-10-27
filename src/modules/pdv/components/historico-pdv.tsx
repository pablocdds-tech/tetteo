"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Botao } from "@/design-system/botao";
import { Campo } from "@/design-system/campo";
import { PainelLateral } from "@/design-system/painel-lateral";
import { cancelarVendaAcao } from "../acoes";
import { exportarHistoricoAcao } from "../acoes-historico";
import type { HistoricoFiltros, PaginaHistorico } from "../historico-types";
import type { PagamentoPdv, VendaPdv } from "../types";
import { BotoesImpressao } from "./botoes-impressao";
import { EtiquetaPagamento } from "./etiqueta-pagamento";
import { ReceberPedido } from "./receber-pedido";

const moeda = (valor: number) =>
  (valor / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const data = (valor: string) =>
  new Date(valor).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
const formas: Record<PagamentoPdv["forma"], string> = {
  DINHEIRO: "Dinheiro",
  PIX: "Pix",
  CREDITO: "Crédito",
  DEBITO: "Débito",
};
const entrada =
  "bg-surface border-line-2 text-ink h-10 w-full rounded-md border px-3 text-sm font-normal";
const rotulo =
  "text-ink-2 flex min-w-32 flex-col gap-1.5 text-sm font-semibold";
function paginaHref(filtros: HistoricoFiltros, pagina: number) {
  const parametros = new URLSearchParams();
  for (const [chave, valor] of Object.entries({ ...filtros, pagina }))
    if (valor !== "") parametros.set(chave, String(valor));
  return `/pdv/vendas?${parametros.toString()}`;
}

export function HistoricoPdv({
  inicial,
  podeCancelar,
  podeReceber,
}: {
  inicial: PaginaHistorico;
  podeCancelar: boolean;
  podeReceber: boolean;
}) {
  const router = useRouter();
  const [selecionadaId, setSelecionadaId] = useState<string | null>(null);
  const [recebendoId, setRecebendoId] = useState<string | null>(null);
  const [erroExportacao, setErroExportacao] = useState("");
  const [exportando, iniciarExportacao] = useTransition();
  const [navegando, iniciarNavegacao] = useTransition();
  const { filtros, vendas, resumo } = inicial;
  const selecionada = !navegando
    ? (vendas.find((v) => v.id === selecionadaId) ?? null)
    : null;
  function aplicar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const campos = new FormData(evento.currentTarget);
    const parametros = new URLSearchParams();
    for (const [chave, valor] of campos)
      if (typeof valor === "string" && valor !== "")
        parametros.set(chave, valor);
    parametros.set("pagina", "1");
    setSelecionadaId(null);
    setErroExportacao("");
    iniciarNavegacao(() => router.push(`/pdv/vendas?${parametros.toString()}`));
  }
  function exportar() {
    if (exportando) return;
    setErroExportacao("");
    iniciarExportacao(async () => {
      try {
        const resultado = await exportarHistoricoAcao(filtros);
        if (resultado.erro) {
          setErroExportacao(resultado.erro);
          return;
        }
        if (!resultado.exportacao) {
          setErroExportacao(
            "Não foi possível preparar o arquivo. Tente novamente.",
          );
          return;
        }
        const arquivo = resultado.exportacao;
        const url = URL.createObjectURL(
          new Blob([arquivo.csv], { type: "text/csv;charset=utf-8" }),
        );
        const link = document.createElement("a");
        link.href = url;
        link.download = arquivo.nomeArquivo;
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);
      } catch {
        setErroExportacao(
          "Não foi possível exportar as vendas. Tente novamente.",
        );
      }
    });
  }
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Histórico de pedidos
          </h1>
          <p className="text-ink-3 mt-1 text-sm">
            Vendas, itens e pagamentos registrados no PDV. Datas no horário de
            São Paulo.
          </p>
        </div>
        <Botao
          peso="secundario"
          onClick={exportar}
          carregando={exportando}
          disabled={navegando}
        >
          Exportar filtro aplicado
        </Botao>
      </header>
      <form
        key={JSON.stringify(filtros)}
        onSubmit={aplicar}
        className="border-line bg-surface space-y-4 rounded-lg border p-4"
        aria-label="Filtros do histórico"
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className={rotulo}>
            Data inicial
            <input
              name="de"
              type="date"
              className={entrada}
              defaultValue={filtros.de}
              min="2000-01-01"
              max="2100-12-31"
              required
            />
          </label>
          <label className={rotulo}>
            Data final
            <input
              name="ate"
              type="date"
              className={entrada}
              defaultValue={filtros.ate}
              min="2000-01-01"
              max="2100-12-31"
              required
            />
          </label>
          <label className={rotulo}>
            Situação
            <select
              name="status"
              className={entrada}
              defaultValue={filtros.status}
            >
              <option value="TODAS">Todas</option>
              <option value="PENDENTE">Aguardando pagamento</option>
              <option value="CONCLUIDA">Pagamento registrado</option>
              <option value="CANCELADA">Canceladas</option>
            </select>
          </label>
          <label className={rotulo}>
            Tipo de pedido
            <select
              name="modalidade"
              className={entrada}
              defaultValue={filtros.modalidade}
            >
              <option value="TODAS">Todos</option>
              <option value="BALCAO">Balcão</option>
              <option value="RETIRADA">Retirada</option>
              <option value="ENTREGA">Entrega</option>
            </select>
          </label>
          <label className={rotulo}>
            Pagamento
            <select
              name="pagamento"
              className={entrada}
              defaultValue={filtros.pagamento}
            >
              <option value="TODOS">Todos</option>
              {Object.entries(formas).map(([valor, nome]) => (
                <option key={valor} value={valor}>
                  {nome}
                </option>
              ))}
            </select>
          </label>
          <label className={rotulo}>
            Operador
            <select
              name="operadorId"
              className={entrada}
              defaultValue={filtros.operadorId}
            >
              <option value="">Todos</option>
              {inicial.operadores.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.nome}
                </option>
              ))}
            </select>
          </label>
          <label className={`${rotulo} sm:col-span-2`}>
            {inicial.podeVerClientes
              ? "Identificação, número, cliente ou operador"
              : "Identificação, número ou operador"}
            <input
              name="busca"
              type="search"
              maxLength={100}
              className={entrada}
              defaultValue={filtros.busca}
              placeholder="Buscar no período selecionado"
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Botao type="submit" carregando={navegando}>
            Aplicar filtros
          </Botao>
          <Link
            href="/pdv/vendas"
            className="text-ink-2 text-sm underline underline-offset-4"
          >
            Limpar filtros
          </Link>
          <p className="text-ink-3 text-xs">
            O CSV inclui todas as vendas do filtro aplicado, até 5.000
            registros. Não depende da página exibida.
          </p>
        </div>
      </form>
      {erroExportacao && (
        <p
          role="alert"
          className="bg-bad-sub text-bad rounded-md px-4 py-3 text-sm"
        >
          {erroExportacao}
        </p>
      )}
      {!inicial.podeVerClientes && (
        <p className="text-ink-3 text-xs">
          Nomes de clientes estão ocultos. A consulta desses nomes exige acesso
          ao CRM.
        </p>
      )}
      <section
        aria-label="Resumo do filtro aplicado"
        className="border-line bg-surface grid gap-3 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <div>
          <p className="text-ink-3 text-xs">Pedidos no filtro</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">
            {inicial.totalRegistros}
          </p>
        </div>
        <div>
          <p className="text-ink-3 text-xs">
            Aguardando pagamento: {resumo.pendentes}
          </p>
          <p className="mt-1 text-xl font-semibold tabular-nums">
            {moeda(resumo.totalPendenteCentavos)}
          </p>
        </div>
        <div>
          <p className="text-ink-3 text-xs">
            Pagamento registrado: {resumo.concluidas}
          </p>
          <p className="mt-1 text-xl font-semibold tabular-nums">
            {moeda(resumo.totalConcluidoCentavos)}
          </p>
        </div>
        <div>
          <p className="text-ink-3 text-xs">Cancelados: {resumo.canceladas}</p>
          <p className="text-bad mt-1 text-xl font-semibold tabular-nums">
            {moeda(resumo.totalCanceladoCentavos)}
          </p>
        </div>
      </section>
      {filtros.pagamento !== "TODOS" && (
        <p className="text-ink-3 text-xs">
          Totais das vendas que contêm esse pagamento, incluindo parcelas de
          outros meios.
        </p>
      )}
      <section
        className="border-line bg-surface overflow-x-auto rounded-lg border"
        aria-label="Lista de vendas"
        aria-busy={navegando}
      >
        {vendas.length ? (
          <>
            <table className="hidden w-full min-w-[820px] text-left text-sm lg:table">
              <thead className="bg-surface-2 text-ink-2 border-line border-b text-xs">
                <tr>
                  {[
                    "Pedido",
                    "Cliente",
                    "Criado em",
                    "Total",
                    "Pagamento",
                    "Tipo",
                    "Situação",
                  ].map((coluna) => (
                    <th
                      key={coluna}
                      scope="col"
                      className={`px-4 py-3 font-semibold ${coluna === "Total" ? "text-right" : ""}`}
                    >
                      {coluna}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-line divide-y">
                {vendas.map((venda) => (
                  <tr
                    key={venda.id}
                    onClick={() => !navegando && setSelecionadaId(venda.id)}
                    className="hover:bg-surface-2 cursor-pointer"
                  >
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        disabled={navegando}
                        onClick={() => !navegando && setSelecionadaId(venda.id)}
                        aria-label={`Abrir ${venda.numeroPedido !== null ? `pedido ${venda.numeroPedido}` : `venda ${venda.id}`}`}
                        className="focus-visible:outline-accent font-semibold underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-3"
                      >
                        {venda.numeroPedido !== null
                          ? `#${venda.numeroPedido}`
                          : venda.id.slice(0, 8)}
                      </button>
                    </td>
                    <td className="max-w-52 px-4 py-3">
                      <span className="block truncate">
                        {inicial.podeVerClientes
                          ? (venda.cliente ?? "Não identificado")
                          : "Nome restrito"}
                      </span>
                      <span className="text-ink-3 mt-1 block truncate text-xs">
                        {venda.operador}
                      </span>
                    </td>
                    <td className="text-ink-2 px-4 py-3 whitespace-nowrap">
                      {data(venda.criadaEm)}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold whitespace-nowrap tabular-nums">
                      {moeda(venda.totalCentavos)}
                    </td>
                    <td className="text-ink-2 px-4 py-3">
                      {[
                        ...new Set(
                          venda.pagamentos.map((p) => formas[p.forma]),
                        ),
                      ].join(" / ") || "Sem registro"}
                    </td>
                    <td className="text-ink-2 px-4 py-3">
                      {venda.modalidade === "BALCAO"
                        ? "Balcão"
                        : venda.modalidade === "ENTREGA"
                          ? "Entrega"
                          : "Retirada"}
                    </td>
                    <td className="px-4 py-3">
                      <EtiquetaPagamento venda={venda} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="divide-line divide-y lg:hidden">
              {vendas.map((venda) => (
                <button
                  key={venda.id}
                  type="button"
                  disabled={navegando}
                  onClick={() => !navegando && setSelecionadaId(venda.id)}
                  className="hover:bg-surface-2 focus-visible:outline-accent flex w-full flex-wrap items-center gap-3 px-5 py-4 text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {venda.numeroPedido !== null && (
                        <span className="mr-2 font-semibold">
                          #{venda.numeroPedido}
                        </span>
                      )}
                      {inicial.podeVerClientes
                        ? (venda.cliente ?? "Cliente não identificado")
                        : "Nome do cliente restrito"}
                    </p>
                    <p className="text-ink-3 mt-1 text-sm">
                      {data(venda.criadaEm)} · {venda.operador} ·{" "}
                      {venda.modalidade === "BALCAO"
                        ? "Balcão"
                        : venda.modalidade === "ENTREGA"
                          ? "Entrega"
                          : "Retirada"}
                    </p>
                    <p className="text-ink-3 mt-1 text-xs break-all">
                      {venda.id}
                    </p>
                  </div>
                  <EtiquetaPagamento venda={venda} />
                  <strong className="min-w-24 text-right tabular-nums">
                    {moeda(venda.totalCentavos)}
                  </strong>
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="px-5 py-10 text-center">
            <h2 className="font-semibold">Nenhuma venda neste filtro</h2>
            <p className="text-ink-3 mt-2 text-sm">
              Altere o período ou os filtros para consultar outros registros.
            </p>
          </div>
        )}
      </section>
      <nav
        aria-label="Paginação do histórico"
        className="flex flex-wrap items-center justify-between gap-3 text-sm"
      >
        <p className="text-ink-3" role="status">
          {inicial.totalRegistros
            ? `${(filtros.pagina - 1) * inicial.tamanhoPagina + 1}–${(filtros.pagina - 1) * inicial.tamanhoPagina + vendas.length} de ${inicial.totalRegistros}`
            : "0 registros"}{" "}
          · Página {filtros.pagina} de {inicial.totalPaginas}
        </p>
        <div className="flex gap-4">
          {filtros.pagina > 1 ? (
            <Link
              href={paginaHref(filtros, filtros.pagina - 1)}
              onClick={() => setSelecionadaId(null)}
              className="font-semibold underline underline-offset-4"
            >
              Anterior
            </Link>
          ) : (
            <span aria-disabled="true" className="text-ink-3">
              Anterior
            </span>
          )}
          {filtros.pagina < inicial.totalPaginas ? (
            <Link
              href={paginaHref(filtros, filtros.pagina + 1)}
              onClick={() => setSelecionadaId(null)}
              className="font-semibold underline underline-offset-4"
            >
              Próxima
            </Link>
          ) : (
            <span aria-disabled="true" className="text-ink-3">
              Próxima
            </span>
          )}
        </div>
      </nav>
      {selecionada && !recebendoId && (
        <DetalheVenda
          key={selecionada.id}
          venda={selecionada}
          podeCancelar={podeCancelar}
          podeReceber={podeReceber}
          aoReceber={() => setRecebendoId(selecionada.id)}
          podeVerClientes={inicial.podeVerClientes}
          aoFechar={() => setSelecionadaId(null)}
        />
      )}
      {recebendoId && (
        <ReceberPedido
          key={recebendoId}
          vendaId={recebendoId}
          aoReceber={() => setSelecionadaId(null)}
          aoFechar={() => {
            setRecebendoId(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
function DetalheVenda({
  venda,
  podeCancelar,
  podeReceber,
  aoReceber,
  podeVerClientes,
  aoFechar,
}: {
  venda: VendaPdv;
  podeCancelar: boolean;
  podeReceber: boolean;
  aoReceber: () => void;
  podeVerClientes: boolean;
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
          versaoFinanceira: venda.versaoFinanceira ?? 1,
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
        podeCancelar && venda.status !== "CANCELADA" ? (
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
        <BotoesImpressao vendaId={venda.id} />
        {podeReceber && venda.status === "PENDENTE" && !cancelando && (
          <Botao onClick={aoReceber}>Receber pagamento</Botao>
        )}
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-ink-3">Cliente</dt>
            <dd className="mt-1 font-medium">
              {podeVerClientes
                ? (venda.cliente ?? "Não identificado")
                : "Nome do cliente restrito"}
            </dd>
          </div>
          <div>
            <dt className="text-ink-3">Situação</dt>
            <dd className="mt-1 font-medium">
              <EtiquetaPagamento venda={venda} />
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
            ["Frete", venda.freteCentavos ?? 0],
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
          <h3 className="font-semibold">Pagamento</h3>
          {venda.status === "PENDENTE" ? (
            <p className="mt-2 text-sm">
              A receber: <strong>{moeda(venda.totalCentavos)}</strong>. O
              estoque já foi movimentado ao criar o pedido.
            </p>
          ) : venda.pagamentos.length ? (
            <p className="text-ink-3 mt-1 text-xs">
              Registro manual do operador.
            </p>
          ) : (
            <p className="text-ink-3 mt-1 text-sm">
              Cancelado sem pagamento registrado.
            </p>
          )}
          {venda.recebidoEm && (
            <p className="text-ink-3 mt-2 text-xs">
              Recebido em {data(venda.recebidoEm)}
              {venda.recebidoPor ? ` por ${venda.recebidoPor}` : ""}.
            </p>
          )}
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
              O cancelamento preserva o histórico e estorna o consumo de
              estoque.
              {venda.pagamentos.length
                ? " A devolução de dinheiro ou estorno da operadora deve ser realizado separadamente."
                : " Nenhum pagamento foi registrado; não haverá devolução de dinheiro."}
            </p>
            <Campo
              rotulo="Motivo do cancelamento"
              value={motivo}
              onChange={(evento) => setMotivo(evento.target.value)}
              required
              minLength={3}
              maxLength={300}
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
