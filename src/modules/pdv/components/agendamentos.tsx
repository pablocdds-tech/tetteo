"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Botao } from "@/design-system/botao";
import { Campo } from "@/design-system/campo";
import { PainelLateral } from "@/design-system/painel-lateral";
import { cancelarVendaAcao } from "../acoes";
import {
  listarAgendamentosAcao,
  reagendarPedidoAcao,
  iniciarAgendadoAcao,
} from "../acoes-agendamentos";
import type {
  AgendamentoPdv,
  PaginaAgendamentos,
  AgendamentoEntrada,
} from "../agendamento-types";
import { converterAgendamento } from "../schemas/agendamento";
import { BotoesImpressao } from "./botoes-impressao";
import { EtiquetaPagamento } from "./etiqueta-pagamento";
import { ReceberPedido } from "./receber-pedido";
import { horarioSaoPaulo, dataLocalAgendamento } from "./dados-agendamento";

const moeda = (v: number) =>
  (v / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const estados = {
  EM_ABERTO: "Em aberto",
  AGUARDANDO: "Aguardando preparo",
  INICIADOS: "Preparo iniciado",
  FINALIZADOS: "Finalizados",
  TODOS: "Todos",
};
const statusNome: Record<string, string> = {
  AGENDADO: "Aguardando preparo",
  COZINHA: "Na cozinha",
  AGUARDANDO_COLETA: "Pronto para coleta",
  SAIU_ENTREGA: "Saiu para entrega",
  ENTREGUE: "Entregue",
  CANCELADO: "Cancelado",
};
type TipoOperacao = "REAGENDAR" | "INICIAR" | "CANCELAR";
type PayloadAgenda = {
  pedidoId: string;
  versao: number;
  chave: string;
  motivo: string;
  agendamento?: AgendamentoEntrada;
};
type PayloadCancelar = {
  vendaId: string;
  pedidoId: string;
  versaoPedido: number;
  versaoFinanceira: number;
  motivo: string;
};
type Tentativa =
  | { tipo: "REAGENDAR" | "INICIAR"; payload: PayloadAgenda }
  | { tipo: "CANCELAR"; payload: PayloadCancelar };

export function Agendamentos({
  inicial,
  podeVender,
  podeOperar,
  podeCancelar,
}: {
  inicial: PaginaAgendamentos;
  podeVender: boolean;
  podeOperar: boolean;
  podeCancelar: boolean;
}) {
  const router = useRouter();
  const [dados, setDados] = useState(inicial);
  const [selecionado, setSelecionado] = useState<AgendamentoPdv | null>(null);
  const [recebendo, setRecebendo] = useState<string | null>(null);
  const [operacao, setOperacao] = useState<TipoOperacao | null>(null);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [incerta, setIncerta] = useState(false);
  const [rejeitada, setRejeitada] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [paraLocal, setParaLocal] = useState("");
  const [antecedencia, setAntecedencia] = useState("30");
  const tentativa = useRef<Tentativa | null>(null);
  const trava = useRef(false);
  const consultando = useRef(false);
  const geracaoConsulta = useRef(0);
  const consultaPendente = useRef(false);
  const vivo = useRef(true);
  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
    };
  }, []);
  const atualizar = useCallback(async () => {
    if (consultando.current) {
      consultaPendente.current = true;
      geracaoConsulta.current++;
      return;
    }
    consultando.current = true;
    setCarregando(true);
    try {
      do {
        consultaPendente.current = false;
        const geracao = geracaoConsulta.current;
        try {
          const resposta = await listarAgendamentosAcao(dados.filtros);
          if (!vivo.current) return;
          if (geracao !== geracaoConsulta.current) continue;
          if (resposta.pagina) setDados(resposta.pagina);
          else
            setErro(
              resposta.erro ?? "Não foi possível consultar os agendamentos.",
            );
        } catch {
          if (vivo.current && geracao === geracaoConsulta.current)
            setErro("Não foi possível atualizar. Tente novamente.");
        }
      } while (vivo.current && consultaPendente.current);
    } finally {
      consultando.current = false;
      if (vivo.current) setCarregando(false);
    }
  }, [dados.filtros]);
  useEffect(() => {
    if (selecionado || recebendo || operacao || ocupado || incerta) return;
    const conferir = () => {
      if (document.visibilityState === "visible") void atualizar();
    };
    const timer = setInterval(conferir, 15000);
    window.addEventListener("focus", conferir);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", conferir);
    };
  }, [selecionado, recebendo, operacao, ocupado, incerta, atualizar]);
  useEffect(() => {
    if (!ocupado && !incerta) return;
    const proteger = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", proteger);
    return () => window.removeEventListener("beforeunload", proteger);
  }, [ocupado, incerta]);
  function abrirOperacao(tipo: TipoOperacao) {
    if (!selecionado) return;
    setOperacao(tipo);
    setRejeitada(false);
    setMotivo("");
    setParaLocal(dataLocalAgendamento(selecionado.agendadoPara));
    setAntecedencia(String(selecionado.antecedenciaMinutos));
    setErro("");
    tentativa.current = null;
  }
  function fecharOperacao() {
    if (ocupado || incerta) return;
    setOperacao(null);
    if (rejeitada) {
      setSelecionado(null);
      void atualizar();
    }
    setRejeitada(false);
    setErro("");
    tentativa.current = null;
  }
  async function executar() {
    if (trava.current || rejeitada || !selecionado || !operacao) return;
    if (!incerta && motivo.trim().length < 3) {
      setErro("Informe o motivo com pelo menos três caracteres.");
      return;
    }
    if (!navigator.onLine) {
      setErro("Sem conexão. Mantenha esta tela aberta para tentar novamente.");
      return;
    }
    if (!tentativa.current) {
      if (operacao === "CANCELAR")
        tentativa.current = {
          tipo: "CANCELAR",
          payload: {
            vendaId: selecionado.venda.id,
            pedidoId: selecionado.pedidoId,
            versaoPedido: selecionado.versao,
            versaoFinanceira: selecionado.venda.versaoFinanceira ?? 1,
            motivo: motivo.trim(),
          },
        };
      else {
        const agendamento = {
          paraLocal,
          antecedenciaMinutos: Number(antecedencia),
        };
        if (operacao === "REAGENDAR")
          try {
            converterAgendamento(agendamento);
          } catch (falha) {
            setErro(
              falha instanceof Error && falha.name !== "ZodError"
                ? falha.message
                : "Confira o horário e a antecedência.",
            );
            return;
          }
        tentativa.current = {
          tipo: operacao,
          payload: {
            pedidoId: selecionado.pedidoId,
            versao: selecionado.versao,
            chave: crypto.randomUUID(),
            motivo: motivo.trim(),
            ...(operacao === "REAGENDAR" ? { agendamento } : {}),
          },
        };
      }
    }
    trava.current = true;
    setOcupado(true);
    setErro("");
    try {
      const t = tentativa.current;
      const resposta =
        t.tipo === "CANCELAR"
          ? await cancelarVendaAcao(t.payload)
          : t.tipo === "REAGENDAR"
            ? await reagendarPedidoAcao(t.payload)
            : await iniciarAgendadoAcao(t.payload);
      if (resposta.erro) {
        setErro(resposta.erro);
        if (!incerta) setRejeitada(true);
        return;
      }
      if (!resposta.ok) throw new Error("Resposta incompleta");
      setAviso(resposta.ok);
      setIncerta(false);
      setOperacao(null);
      setSelecionado(null);
      tentativa.current = null;
      void atualizar();
    } catch {
      setIncerta(true);
      setErro(
        "A resposta não foi confirmada. Confirme novamente aqui sem alterar os dados; a mesma tentativa evita duplicação.",
      );
    } finally {
      trava.current = false;
      setOcupado(false);
    }
  }
  const ativo = (p: AgendamentoPdv) =>
    p.status !== "ENTREGUE" && p.status !== "CANCELADO";
  const atrasado = (p: AgendamentoPdv) =>
    ativo(p) &&
    new Date(p.agendadoPara).getTime() < new Date(dados.agora).getTime();
  let inicioNovo: Date | null = null;
  try {
    if (operacao === "REAGENDAR")
      inicioNovo = converterAgendamento({
        paraLocal,
        antecedenciaMinutos: Number(antecedencia),
      }).iniciarPreparoEm;
  } catch {}
  return (
    <div className="space-y-5">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          const params = new URLSearchParams();
          for (const campo of ["de", "ate", "estado"]) {
            const valor = String(form.get(campo) ?? "");
            if (valor) params.set(campo, valor);
          }
          router.push(`/pdv/agendamentos?${params}`);
        }}
        className="border-line bg-surface grid grid-cols-1 items-end gap-3 rounded-lg border p-4 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto_auto]"
      >
        <Campo
          rotulo="Agendado de"
          name="de"
          type="date"
          defaultValue={inicial.filtros.de}
        />
        <Campo
          rotulo="Até"
          name="ate"
          type="date"
          defaultValue={inicial.filtros.ate}
        />
        <label className="text-ink-2 text-sm font-semibold">
          Situação
          <select
            name="estado"
            defaultValue={inicial.filtros.estado}
            className="border-line-2 bg-surface mt-2 block min-h-11 rounded-md border px-3 font-normal"
          >
            {Object.entries(estados).map(([valor, nome]) => (
              <option key={valor} value={valor}>
                {nome}
              </option>
            ))}
          </select>
        </label>
        <Botao type="submit">Aplicar filtros</Botao>
        <Botao
          peso="secundario"
          type="button"
          disabled={carregando}
          onClick={() => void atualizar()}
        >
          Atualizar
        </Botao>
      </form>
      <div
        className="flex flex-wrap gap-x-6 gap-y-2 text-sm"
        aria-label="Resumo dos agendamentos"
      >
        <p>
          Aguardando preparo: <strong>{dados.resumo.aguardando}</strong>
        </p>
        <p>
          Início nos próximos 30 min: <strong>{dados.resumo.proximos}</strong>
        </p>
        <p>
          Atrasados: <strong>{dados.resumo.atrasados}</strong>
        </p>
      </div>
      {aviso && (
        <p role="status" className="bg-accent-sub rounded-md p-3 text-sm">
          {aviso}
        </p>
      )}
      {erro && !operacao && (
        <p role="alert" className="text-bad text-sm">
          {erro}
        </p>
      )}
      {!dados.pedidos.length ? (
        <div className="border-line rounded-lg border p-8">
          <h2 className="font-semibold">Nenhum agendamento neste filtro</h2>
          <p className="text-ink-3 mt-2 text-sm">
            Ajuste o período ou agende um horário ao criar um novo pedido.
          </p>
        </div>
      ) : (
        <>
          <div className="border-line relative hidden overflow-x-auto rounded-lg border md:block">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface-2 text-ink-2">
                <tr>
                  {[
                    "Pedido",
                    "Horário prometido",
                    "Início do preparo",
                    "Cliente",
                    "Situação",
                    "Pagamento",
                    "Total",
                  ].map((t) => (
                    <th
                      key={t}
                      className="px-4 py-3 font-semibold whitespace-nowrap"
                    >
                      {t}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-line divide-y">
                {dados.pedidos.map((p) => (
                  <tr key={p.pedidoId} className="hover:bg-surface-2">
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        className="text-accent min-h-11 font-semibold underline"
                        onClick={() => {
                          geracaoConsulta.current++;
                          setSelecionado(p);
                          setErro("");
                        }}
                      >
                        #{String(p.numero).padStart(4, "0")}
                      </button>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {horarioSaoPaulo(p.agendadoPara)}
                      {atrasado(p) && (
                        <span className="text-bad block text-xs">Atrasado</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {horarioSaoPaulo(
                        p.preparoIniciadoEm ?? p.iniciarPreparoEm,
                      )}
                      <span className="text-ink-3 block text-xs">
                        {p.preparoIniciadoEm ? "Iniciado" : "Previsto"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {p.venda.cliente ?? "Não identificado"}
                    </td>
                    <td className="px-4 py-3">{statusNome[p.status]}</td>
                    <td className="px-4 py-3">
                      <EtiquetaPagamento venda={p.venda} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap tabular-nums">
                      {moeda(p.venda.totalCentavos)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="divide-line border-line divide-y rounded-lg border md:hidden">
            {dados.pedidos.map((p) => (
              <li key={p.pedidoId}>
                <button
                  type="button"
                  className="hover:bg-surface-2 w-full space-y-2 p-4 text-left text-sm"
                  onClick={() => {
                    geracaoConsulta.current++;
                    setSelecionado(p);
                    setErro("");
                  }}
                >
                  <div className="flex justify-between gap-3">
                    <strong>
                      #{String(p.numero).padStart(4, "0")} ·{" "}
                      {statusNome[p.status]}
                    </strong>
                    <strong className="shrink-0">
                      {moeda(p.venda.totalCentavos)}
                    </strong>
                  </div>
                  <p>{p.venda.cliente ?? "Cliente não identificado"}</p>
                  <p>Prometido: {horarioSaoPaulo(p.agendadoPara)}</p>
                  <p className="text-ink-3">
                    {p.preparoIniciadoEm ? "Iniciado em" : "Início previsto"}:{" "}
                    {horarioSaoPaulo(p.preparoIniciadoEm ?? p.iniciarPreparoEm)}
                  </p>
                  <EtiquetaPagamento venda={p.venda} />
                  {atrasado(p) && (
                    <span className="text-bad block">Atrasado</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <nav
        aria-label="Paginação dos agendamentos"
        className="flex flex-wrap items-center justify-between gap-3 text-sm"
      >
        <span>
          {dados.totalRegistros} registros · Página {dados.filtros.pagina} de{" "}
          {dados.totalPaginas}
        </span>
        <div className="flex gap-2">
          {[-1, 1].map((delta) => (
            <Botao
              key={delta}
              peso="secundario"
              disabled={
                delta < 0
                  ? dados.filtros.pagina <= 1
                  : dados.filtros.pagina >= dados.totalPaginas
              }
              onClick={() => {
                const params = new URLSearchParams({
                  de: dados.filtros.de,
                  ate: dados.filtros.ate,
                  estado: dados.filtros.estado,
                  pagina: String(dados.filtros.pagina + delta),
                });
                router.push(`/pdv/agendamentos?${params}`);
              }}
            >
              {delta < 0 ? "Anterior" : "Próxima"}
            </Botao>
          ))}
        </div>
      </nav>
      {selecionado && !operacao && !recebendo && (
        <PainelLateral
          aberto
          aoFechar={() => setSelecionado(null)}
          titulo={`Pedido #${String(selecionado.numero).padStart(4, "0")}`}
          apoio={`${statusNome[selecionado.status]} · Horários de São Paulo`}
        >
          <div className="space-y-5">
            <BotoesImpressao vendaId={selecionado.venda.id} />
            <EtiquetaPagamento venda={selecionado.venda} />
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="text-ink-3">Horário prometido</dt>
                <dd className="font-semibold">
                  {horarioSaoPaulo(selecionado.agendadoPara)}
                </dd>
              </div>
              <div>
                <dt className="text-ink-3">Início previsto do preparo</dt>
                <dd>{horarioSaoPaulo(selecionado.iniciarPreparoEm)}</dd>
              </div>
              {selecionado.preparoIniciadoEm && (
                <div>
                  <dt className="text-ink-3">Preparo iniciado</dt>
                  <dd>{horarioSaoPaulo(selecionado.preparoIniciadoEm)}</dd>
                </div>
              )}
              <div>
                <dt className="text-ink-3">Cliente</dt>
                <dd>{selecionado.venda.cliente ?? "Não identificado"}</dd>
              </div>
            </dl>
            <ul className="divide-line divide-y">
              {selecionado.venda.itens.map((item, i) => (
                <li key={i} className="py-3 text-sm">
                  <div className="flex justify-between gap-3">
                    <strong>
                      {item.quantidade} × {item.nome}
                    </strong>
                    <span>{moeda(item.totalCentavos)}</span>
                  </div>
                  {item.complementos.length > 0 && (
                    <p className="text-ink-3 mt-1 text-xs">
                      Complementos por unidade:{" "}
                      {item.complementos
                        .map((c) => `${c.grupo}: ${c.nome}`)
                        .join("; ")}
                    </p>
                  )}
                  {item.observacao && <p className="mt-1">{item.observacao}</p>}
                </li>
              ))}
            </ul>
            {selecionado.venda.observacao && (
              <p className="text-sm">{selecionado.venda.observacao}</p>
            )}
            <p className="flex justify-between font-semibold">
              <span>Total</span>
              <span>{moeda(selecionado.venda.totalCentavos)}</span>
            </p>
            <div className="flex flex-wrap gap-2">
              {selecionado.status === "AGENDADO" && podeVender && (
                <Botao
                  peso="secundario"
                  onClick={() => abrirOperacao("REAGENDAR")}
                >
                  Reagendar
                </Botao>
              )}
              {selecionado.status === "AGENDADO" && podeOperar && (
                <Botao onClick={() => abrirOperacao("INICIAR")}>
                  Iniciar preparo agora
                </Botao>
              )}
              {selecionado.venda.status === "PENDENTE" && podeVender && (
                <Botao
                  peso="secundario"
                  onClick={() => setRecebendo(selecionado.venda.id)}
                >
                  Receber pagamento
                </Botao>
              )}
              {ativo(selecionado) && podeCancelar && (
                <Botao
                  peso="secundario"
                  onClick={() => abrirOperacao("CANCELAR")}
                >
                  Cancelar pedido
                </Botao>
              )}
            </div>
            <details>
              <summary className="cursor-pointer text-sm font-semibold">
                Histórico do pedido
              </summary>
              <ol className="mt-3 space-y-3">
                {selecionado.historico.map((evento) => (
                  <li
                    key={evento.id}
                    className="border-line border-l-2 pl-3 text-sm"
                  >
                    <strong>{statusNome[evento.para] ?? evento.para}</strong>
                    <p className="text-ink-3 text-xs">
                      {horarioSaoPaulo(evento.criadoEm)} · {evento.operador}
                    </p>
                    {evento.observacao && <p>{evento.observacao}</p>}
                  </li>
                ))}
              </ol>
            </details>
          </div>
        </PainelLateral>
      )}
      {operacao && selecionado && (
        <PainelLateral
          aberto
          aoFechar={fecharOperacao}
          podeFechar={() => !ocupado && !incerta}
          titulo={
            operacao === "REAGENDAR"
              ? "Reagendar pedido"
              : operacao === "INICIAR"
                ? "Iniciar preparo agora"
                : "Cancelar pedido"
          }
          apoio={`Pedido #${String(selecionado.numero).padStart(4, "0")}`}
          rodape={
            <Botao
              className="w-full"
              carregando={ocupado}
              disabled={rejeitada}
              onClick={() => void executar()}
            >
              {incerta
                ? "Confirmar novamente"
                : operacao === "REAGENDAR"
                  ? "Confirmar novo horário"
                  : operacao === "INICIAR"
                    ? "Confirmar início do preparo"
                    : "Confirmar cancelamento"}
            </Botao>
          }
        >
          <div className="space-y-5">
            {operacao === "REAGENDAR" && (
              <>
                <Campo
                  rotulo="Nova data e hora (São Paulo)"
                  type="datetime-local"
                  value={paraLocal}
                  disabled={ocupado || incerta}
                  onChange={(e) => setParaLocal(e.target.value)}
                />
                <Campo
                  rotulo="Antecedência do preparo (minutos)"
                  type="number"
                  min={1}
                  max={1440}
                  value={antecedencia}
                  disabled={ocupado || incerta}
                  onChange={(e) => setAntecedencia(e.target.value)}
                />
                {inicioNovo && (
                  <p className="text-ink-2 text-sm">
                    {inicioNovo.getTime() <= new Date(dados.agora).getTime()
                      ? "O início do preparo já chegou; o pedido entrará imediatamente na cozinha."
                      : `Início do preparo: ${horarioSaoPaulo(inicioNovo)}.`}
                  </p>
                )}
                <p className="text-ink-3 text-sm">
                  Preços, estoque e pagamentos já registrados serão preservados.
                </p>
              </>
            )}
            {operacao === "INICIAR" && (
              <p className="text-sm">
                O pedido entrará na cozinha agora. Essa ação não fará nova baixa
                de estoque nem registrará outro pagamento.
              </p>
            )}
            {operacao === "CANCELAR" && (
              <p className="text-sm">
                {selecionado.venda.status === "PENDENTE"
                  ? "Nenhum pagamento foi registrado; não haverá devolução de dinheiro."
                  : "Confira a devolução dos valores manualmente."}{" "}
                O consumo registrado será estornado; registre perdas no Estoque
                se os ingredientes já foram consumidos.
              </p>
            )}
            <Campo
              rotulo="Motivo"
              maxLength={300}
              value={motivo}
              disabled={ocupado || incerta}
              onChange={(e) => setMotivo(e.target.value)}
            />
            {erro && (
              <p
                role="alert"
                className="bg-bad-sub text-bad rounded-md p-3 text-sm"
              >
                {erro}
              </p>
            )}
            {erro && !incerta && (
              <Botao
                peso="secundario"
                disabled={ocupado}
                onClick={() => {
                  fecharOperacao();
                  setSelecionado(null);
                  void atualizar();
                }}
              >
                Atualizar situação e fechar
              </Botao>
            )}
          </div>
        </PainelLateral>
      )}
      {recebendo && (
        <ReceberPedido
          key={recebendo}
          vendaId={recebendo}
          aoReceber={() => {
            setSelecionado(null);
          }}
          aoFechar={() => {
            setRecebendo(null);
            void atualizar();
          }}
        />
      )}
    </div>
  );
}
