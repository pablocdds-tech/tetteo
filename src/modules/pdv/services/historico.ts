import { Prisma } from "@prisma/client";
import { pode, type ContextoSessao } from "@/core/sessao/nucleo";
import { db } from "@/server/db";
import type {
  ExportacaoHistorico,
  HistoricoFiltros,
  PaginaHistorico,
  VendaHistorico,
} from "../historico-types";
import { serializarVendaPdv } from "./venda-dto";
import { ErroPdv } from "../schemas/erro";
import {
  analisarHistorico,
  buscaLiteral,
  celulaCsvHistorico,
  LIMITE_EXPORTACAO_HISTORICO,
  numeroBuscado,
  TAMANHO_PAGINA_HISTORICO,
} from "../schemas/historico";
import { periodoPedidos } from "../schemas/pedido";
import { exigirEscopo } from "./pdv";

type Escopo = { organizacaoId: string; unidadeId: string };
type Transacao = Prisma.TransactionClient;
async function filtroBanco(
  tx: Transacao,
  escopo: Escopo,
  f: HistoricoFiltros,
  clientes: boolean,
): Promise<Prisma.PdvVendaWhereInput> {
  const onde: Prisma.PdvVendaWhereInput = {
    ...escopo,
    criadaEm: {
      gte: periodoPedidos(f.de).inicio,
      lt: periodoPedidos(f.ate).fim,
    },
  };
  if (f.status !== "TODAS") onde.status = f.status;
  if (f.modalidade !== "TODAS") onde.modalidade = f.modalidade;
  if (f.operadorId) onde.usuarioId = f.operadorId;
  if (f.pagamento !== "TODOS")
    onde.pagamentos = { array_contains: [{ forma: f.pagamento }] };
  if (f.busca) {
    const termo = buscaLiteral(f.busca);
    const alternativas: Prisma.PdvVendaWhereInput[] = [
      { id: { contains: termo, mode: "insensitive" } },
      { operador: { contains: termo, mode: "insensitive" } },
    ];
    if (clientes)
      alternativas.push({ cliente: { contains: termo, mode: "insensitive" } });
    const numero = numeroBuscado(f.busca);
    if (numero !== null) {
      const pedido = await tx.pdvPedido.findFirst({
        where: { ...escopo, numero },
        select: { vendaId: true },
      });
      if (pedido) alternativas.push({ id: pedido.vendaId });
    }
    onde.OR = alternativas;
  }
  return onde;
}
async function serializarVendas(
  tx: Transacao,
  escopo: Escopo,
  vendas: Prisma.PdvVendaGetPayload<object>[],
  clientes: boolean,
): Promise<VendaHistorico[]> {
  const pedidos = await tx.pdvPedido.findMany({
    where: { ...escopo, vendaId: { in: vendas.map((v) => v.id) } },
    select: { vendaId: true, numero: true },
  });
  const numeros = new Map(pedidos.map((p) => [p.vendaId, p.numero]));
  return vendas.map((v) => ({
    ...serializarVendaPdv(v, clientes),
    numeroPedido: numeros.get(v.id) ?? null,
  }));
}
export async function consultarHistorico(
  ctx: ContextoSessao,
  entrada: unknown = {},
): Promise<PaginaHistorico> {
  const escopo = await exigirEscopo(ctx);
  const filtros = analisarHistorico(entrada);
  const clientes = pode(ctx, "crm.ver");
  return db.$transaction(
    async (tx) => {
      const onde = await filtroBanco(tx, escopo, filtros, clientes);
      const [totalRegistros, resumos, operadoresBanco] = await Promise.all([
        tx.pdvVenda.count({ where: onde }),
        tx.pdvVenda.groupBy({
          by: ["status"],
          where: onde,
          _count: { _all: true },
          _sum: { totalCentavos: true },
        }),
        tx.pdvVenda.groupBy({
          by: ["usuarioId", "operador"],
          where: escopo,
          orderBy: { operador: "asc" },
        }),
      ]);
      const totalPaginas = Math.max(
        1,
        Math.ceil(totalRegistros / TAMANHO_PAGINA_HISTORICO),
      );
      const pagina = Math.min(filtros.pagina, totalPaginas);
      const vendas = await tx.pdvVenda.findMany({
        where: onde,
        orderBy: [{ criadaEm: "desc" }, { id: "desc" }],
        skip: (pagina - 1) * TAMANHO_PAGINA_HISTORICO,
        take: TAMANHO_PAGINA_HISTORICO,
      });
      const concluidas = resumos.find((r) => r.status === "CONCLUIDA");
      const canceladas = resumos.find((r) => r.status === "CANCELADA");
      const pendentes = resumos.find((r) => r.status === "PENDENTE");
      const operadores = [
        ...new Map(
          operadoresBanco.map((o) => [
            o.usuarioId,
            { id: o.usuarioId, nome: o.operador },
          ]),
        ).values(),
      ];
      return {
        filtros: { ...filtros, pagina },
        vendas: await serializarVendas(tx, escopo, vendas, clientes),
        totalRegistros,
        totalPaginas,
        tamanhoPagina: TAMANHO_PAGINA_HISTORICO,
        resumo: {
          pendentes: pendentes?._count._all ?? 0,
          totalPendenteCentavos: pendentes?._sum.totalCentavos ?? 0,
          concluidas: concluidas?._count._all ?? 0,
          canceladas: canceladas?._count._all ?? 0,
          totalConcluidoCentavos: concluidas?._sum.totalCentavos ?? 0,
          totalCanceladoCentavos: canceladas?._sum.totalCentavos ?? 0,
        },
        operadores,
        podeVerClientes: clientes,
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 20_000,
    },
  );
}
export async function exportarHistorico(
  ctx: ContextoSessao,
  entrada: unknown = {},
): Promise<ExportacaoHistorico> {
  const escopo = await exigirEscopo(ctx);
  const filtros = analisarHistorico(entrada);
  const clientes = pode(ctx, "crm.ver");
  return db.$transaction(
    async (tx) => {
      const onde = await filtroBanco(tx, escopo, filtros, clientes);
      const quantidade = await tx.pdvVenda.count({ where: onde });
      if (quantidade > LIMITE_EXPORTACAO_HISTORICO)
        throw new ErroPdv(
          `O filtro tem ${quantidade} vendas. Reduza o período ou refine os filtros para exportar até ${LIMITE_EXPORTACAO_HISTORICO} vendas por arquivo.`,
        );
      const registros = await tx.pdvVenda.findMany({
        where: onde,
        orderBy: [{ criadaEm: "desc" }, { id: "desc" }],
      });
      const vendas = await serializarVendas(tx, escopo, registros, clientes);
      const data = new Intl.DateTimeFormat("pt-BR", {
        timeZone: "America/Sao_Paulo",
        dateStyle: "short",
        timeStyle: "medium",
      });
      const reais = (centavos: number) =>
        (centavos / 100).toFixed(2).replace(".", ",");
      const cabecalho = [
        "Pedido",
        "Identificação da venda",
        "Data (São Paulo)",
        "Situação",
        "Recebido em (São Paulo)",
        "Recebido por",
        "Modalidade",
        "Operador",
        ...(clientes ? ["Cliente"] : []),
        "Subtotal (R$)",
        "Desconto (R$)",
        "Taxa (R$)",
        "Frete (R$)",
        "Total (R$)",
        "Troco (R$)",
        "Pagamentos registrados",
        "Itens",
      ];
      const linhas = vendas.map((v) => [
        v.numeroPedido ?? "",
        v.id,
        data.format(new Date(v.criadaEm)),
        v.status,
        v.recebidoEm ? data.format(new Date(v.recebidoEm)) : "",
        v.recebidoPor ?? "",
        v.modalidade,
        v.operador,
        ...(clientes ? [v.cliente ?? ""] : []),
        reais(v.subtotalCentavos),
        reais(v.descontoCentavos),
        reais(v.taxaCentavos),
        reais(v.freteCentavos ?? 0),
        reais(v.totalCentavos),
        reais(v.trocoCentavos),
        v.pagamentos
          .map((p) => `${p.forma}: ${reais(p.valorCentavos)}`)
          .join(" | "),
        v.itens
          .map(
            (i) =>
              `${i.quantidade} x ${i.nome}${i.complementos.length ? ` (${i.complementos.map((c) => c.nome).join(", ")})` : ""}`,
          )
          .join(" | "),
      ]);
      await tx.auditoria.create({
        data: {
          ...escopo,
          usuarioId: ctx.usuario.id,
          entidade: "PdvHistoricoExportacao",
          entidadeId: crypto.randomUUID(),
          acao: "ACESSOU",
          valoresDepois: {
            quantidade,
            de: filtros.de,
            ate: filtros.ate,
            status: filtros.status,
            modalidade: filtros.modalidade,
            pagamento: filtros.pagamento,
            operadorId: filtros.operadorId,
            comBusca: Boolean(filtros.busca),
            incluiCliente: clientes,
          },
        },
      });
      return {
        csv:
          "\uFEFF" +
          [cabecalho, ...linhas]
            .map((l) => l.map(celulaCsvHistorico).join(";"))
            .join("\r\n"),
        nomeArquivo: `pdv-vendas-${filtros.de}-${filtros.ate}.csv`,
        quantidade,
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 30_000,
    },
  );
}
