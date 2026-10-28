"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Botao } from "@/design-system/botao";
import { Campo } from "@/design-system/campo";
import { useAmbienteProprio } from "@/core/shell/link-integrado";
import { Icone } from "@/design-system/icones";
import { ModalPdv } from "./modal-pdv";
import styles from "./secoes-pdv.module.css";
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
  const proprio = useAmbienteProprio();
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
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
    setFiltrosAbertos(false);
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
    <div className={styles.pagina}>
      {!proprio && <h1 className={styles.titulo}>Histórico de pedidos</h1>}
      <div className={styles.barra}>
        <form
          key={JSON.stringify(filtros)}
          onSubmit={aplicar}
          className={styles.formBusca}
          aria-label="Buscar pedidos"
        >
          {Object.entries(filtros)
            .filter(([chave]) => chave !== "busca" && chave !== "pagina")
            .map(([chave, valor]) => (
              <input key={chave} type="hidden" name={chave} value={valor} />
            ))}
          <label className={styles.busca}>
            <Icone nome="lupa" tamanho={18} />
            <input
              aria-label={
                inicial.podeVerClientes
                  ? "Pesquisar por cliente ou número do pedido"
                  : "Pesquisar por número ou operador"
              }
              name="busca"
              type="search"
              maxLength={100}
              defaultValue={filtros.busca}
              placeholder="Pesquise por cliente ou número do pedido"
            />
          </label>
          <button className={styles.botao} disabled={navegando}>
            Buscar
          </button>
        </form>
        <div className={styles.acoes}>
          <button
            type="button"
            className={styles.botao}
            onClick={exportar}
            disabled={exportando || navegando}
          >
            {exportando ? "Exportando…" : "Exportar"}
          </button>
          <button
            type="button"
            className={styles.botao}
            onClick={() => setFiltrosAbertos(true)}
          >
            <Icone nome="filtro" tamanho={16} />
            Filtros avançados
          </button>
        </div>
      </div>
      <div className={styles.barra}>
        <p className={styles.legenda}>
          De {filtros.de.split("-").reverse().join("/")} a{" "}
          {filtros.ate.split("-").reverse().join("/")} · Horário de São Paulo
        </p>
        <Link href="/pdv/vendas" className={styles.link}>
          Limpar filtros
        </Link>
      </div>
      {erroExportacao && (
        <p role="alert" className="bg-bad-sub text-bad rounded p-3 text-sm">
          {erroExportacao}
        </p>
      )}
      <section
        className={styles.superficie}
        aria-label="Lista de vendas"
        aria-busy={navegando}
      >
        <div className={styles.rolagemTabela}>
          <table className={styles.tabela}>
            <thead>
              <tr>
                {[
                  "Pedido",
                  "Cliente",
                  "Data de criação",
                  "Total",
                  "Forma de pagamento",
                  "Tipo",
                  "Pagamento",
                ].map((coluna) => (
                  <th key={coluna} scope="col">
                    {coluna}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {vendas.map((venda) => (
                <tr
                  key={venda.id}
                  onClick={() => !navegando && setSelecionadaId(venda.id)}
                  className="cursor-pointer"
                >
                  <td>
                    <button
                      type="button"
                      className={styles.link}
                      disabled={navegando}
                      onClick={() => setSelecionadaId(venda.id)}
                      aria-label={`Abrir pedido ${venda.numeroPedido ?? venda.id.slice(0, 8)}`}
                    >
                      {venda.numeroPedido !== null
                        ? `Nº ${venda.numeroPedido}`
                        : venda.id.slice(0, 8)}
                    </button>
                    <small>#{venda.id.slice(0, 8)}</small>
                  </td>
                  <td>
                    {inicial.podeVerClientes
                      ? (venda.cliente ?? "Não identificado")
                      : "Nome restrito"}
                    <small>{venda.operador}</small>
                  </td>
                  <td className="whitespace-nowrap">{data(venda.criadaEm)}</td>
                  <td className="whitespace-nowrap tabular-nums">
                    {moeda(venda.totalCentavos)}
                  </td>
                  <td>
                    {[
                      ...new Set(venda.pagamentos.map((p) => formas[p.forma])),
                    ].join(" / ") || "Sem registro"}
                  </td>
                  <td>
                    {venda.modalidade === "BALCAO"
                      ? "Balcão"
                      : venda.modalidade === "ENTREGA"
                        ? "Delivery"
                        : "Retirada"}
                  </td>
                  <td>
                    <EtiquetaPagamento venda={venda} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!vendas.length && (
            <div className={styles.vazio}>
              <h2>Nenhum pedido neste filtro</h2>
              <p>
                Altere o período ou os filtros para consultar outros registros.
              </p>
            </div>
          )}
        </div>
        <nav aria-label="Paginação do histórico" className={styles.paginacao}>
          <span>Registros por página: {inicial.tamanhoPagina}</span>
          <span role="status">
            {inicial.totalRegistros
              ? `${(filtros.pagina - 1) * inicial.tamanhoPagina + 1}–${(filtros.pagina - 1) * inicial.tamanhoPagina + vendas.length} de ${inicial.totalRegistros}`
              : "0 registros"}
          </span>
          {filtros.pagina > 1 ? (
            <Link
              href={paginaHref(filtros, filtros.pagina - 1)}
              onClick={() => setSelecionadaId(null)}
            >
              Anterior
            </Link>
          ) : (
            <span aria-disabled="true">Anterior</span>
          )}
          {filtros.pagina < inicial.totalPaginas ? (
            <Link
              href={paginaHref(filtros, filtros.pagina + 1)}
              onClick={() => setSelecionadaId(null)}
            >
              Próxima
            </Link>
          ) : (
            <span aria-disabled="true">Próxima</span>
          )}
        </nav>
      </section>
      <details className={styles.legenda}>
        <summary className="cursor-pointer">
          Resumo do período e da seleção
        </summary>
        <div className={styles.resumo}>
          <span>
            Pedidos<strong>{inicial.totalRegistros}</strong>
          </span>
          <span>
            Recebidos ({resumo.concluidas})
            <strong>{moeda(resumo.totalConcluidoCentavos)}</strong>
          </span>
          <span>
            A receber ({resumo.pendentes})
            <strong>{moeda(resumo.totalPendenteCentavos)}</strong>
          </span>
          <span>
            Cancelados ({resumo.canceladas})
            <strong>{moeda(resumo.totalCanceladoCentavos)}</strong>
          </span>
          {filtros.pagamento !== "TODOS" && (
            <p>
              Totais das vendas que contêm esse pagamento, incluindo parcelas de
              outros meios.
            </p>
          )}
        </div>
      </details>
      {filtrosAbertos && (
        <ModalPdv
          aberto
          titulo="Filtros avançados"
          aoFechar={() => setFiltrosAbertos(false)}
          ocupado={navegando}
          rodape={
            <>
              <button
                className={styles.botao}
                disabled={navegando}
                onClick={() => setFiltrosAbertos(false)}
              >
                Voltar
              </button>
              <button
                form="filtros-historico"
                className={styles.primario}
                disabled={navegando}
              >
                Aplicar filtro
              </button>
            </>
          }
        >
          <form
            id="filtros-historico"
            onSubmit={aplicar}
            className={styles.filtros}
            aria-label="Filtros do histórico"
          >
            <input type="hidden" name="busca" value={filtros.busca} />
            <label className={styles.campo}>
              Data inicial
              <input
                name="de"
                type="date"
                defaultValue={filtros.de}
                min="2000-01-01"
                max="2100-12-31"
                required
              />
            </label>
            <label className={styles.campo}>
              Data final
              <input
                name="ate"
                type="date"
                defaultValue={filtros.ate}
                min="2000-01-01"
                max="2100-12-31"
                required
              />
            </label>
            <label className={styles.campo}>
              Situação
              <select name="status" defaultValue={filtros.status}>
                <option value="TODAS">Todas</option>
                <option value="PENDENTE">Aguardando pagamento</option>
                <option value="CONCLUIDA">Pagamento registrado</option>
                <option value="CANCELADA">Canceladas</option>
              </select>
            </label>
            <label className={styles.campo}>
              Tipo de pedido
              <select name="modalidade" defaultValue={filtros.modalidade}>
                <option value="TODAS">Todos</option>
                <option value="BALCAO">Balcão</option>
                <option value="RETIRADA">Retirada</option>
                <option value="ENTREGA">Entrega</option>
              </select>
            </label>
            <label className={styles.campo}>
              Pagamento
              <select name="pagamento" defaultValue={filtros.pagamento}>
                <option value="TODOS">Todos</option>
                {Object.entries(formas).map(([valor, nome]) => (
                  <option key={valor} value={valor}>
                    {nome}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.campo}>
              Operador
              <select name="operadorId" defaultValue={filtros.operadorId}>
                <option value="">Todos</option>
                {inicial.operadores.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.nome}
                  </option>
                ))}
              </select>
            </label>
          </form>
          <p className="text-ink-3 mt-5 text-xs">
            O CSV inclui todos os pedidos da seleção, até 5.000 registros. Datas
            no horário de São Paulo.
          </p>
        </ModalPdv>
      )}
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
    <ModalPdv
      aberto
      aoFechar={aoFechar}
      ocupado={pendente}
      titulo="Detalhes da venda"
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
    </ModalPdv>
  );
}
