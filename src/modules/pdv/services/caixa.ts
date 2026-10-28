import { Prisma } from "@prisma/client";
import { z } from "zod";
import type { ContextoSessao } from "@/core/sessao/nucleo";
import { db } from "@/server/db";
import type {
  DetalheCaixa,
  FormaCaixa,
  HistoricoCaixas,
  TotaisCaixa,
} from "../caixa-types";
import { modalidadesCaixa } from "../caixa-types";
import type { PagamentoPdv } from "../types";
import { ErroPdv } from "../schemas/erro";
import {
  acumularVenda,
  pagamentosLiquidos,
  totaisVazios,
} from "../schemas/resumo-caixa";
import { exigirEscopo } from "./escopo";

export async function listarHistoricoCaixas(
  ctx: ContextoSessao,
  pagina: unknown = 1,
): Promise<HistoricoCaixas> {
  const escopo = await exigirEscopo(ctx);
  const numero = z.number().int().min(1).max(1_000_000).parse(pagina);
  const porPagina = 10;
  return db.$transaction(
    async (tx) => {
      const total = await tx.pdvCaixa.count({ where: escopo });
      const atual = Math.min(numero, Math.max(1, Math.ceil(total / porPagina)));
      const itens = await tx.pdvCaixa.findMany({
        where: escopo,
        orderBy: [{ abertoEm: "desc" }, { id: "desc" }],
        skip: (atual - 1) * porPagina,
        take: porPagina,
        select: {
          id: true,
          abertoEm: true,
          fechadoEm: true,
          operador: true,
          saldoInicialCentavos: true,
          valorContadoCentavos: true,
        },
      });
      return {
        itens: itens.map((c) => ({
          ...c,
          abertoEm: c.abertoEm.toISOString(),
          fechadoEm: c.fechadoEm?.toISOString() ?? null,
        })),
        total,
        pagina: atual,
        porPagina,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

export async function consultarCaixa(
  ctx: ContextoSessao,
  id: string,
): Promise<DetalheCaixa> {
  const escopo = await exigirEscopo(ctx);
  if (!z.string().uuid().safeParse(id).success)
    throw new ErroPdv("Caixa não encontrado nesta unidade.");
  // A mesma fotografia alimenta tabela e totais, mesmo durante um recebimento.
  return db.$transaction(
    async (tx) => {
      const c = await tx.pdvCaixa.findFirst({
        where: { ...escopo, id },
        include: {
          movimentos: { orderBy: [{ criadoEm: "desc" }, { id: "desc" }] },
        },
      });
      if (!c) throw new ErroPdv("Caixa não encontrado nesta unidade.");
      const vendas = await tx.pdvVenda.findMany({
        where: {
          ...escopo,
          status: { in: ["CONCLUIDA", "CANCELADA"] },
          OR: [
            { caixaRecebimentoId: id },
            { caixaId: id, caixaRecebimentoId: null },
          ],
        },
        select: {
          id: true,
          criadaEm: true,
          recebidoEm: true,
          recebidoPorNome: true,
          operador: true,
          status: true,
          canceladaEm: true,
          canceladaPorId: true,
          modalidade: true,
          pagamentos: true,
          trocoCentavos: true,
          subtotalCentavos: true,
          descontoCentavos: true,
          taxaCentavos: true,
          freteCentavos: true,
          totalCentavos: true,
          pedido: { select: { numero: true } },
        },
      });
      const usuarios = await tx.usuario.findMany({
        where: {
          id: {
            in: [
              ...new Set([
                ...c.movimentos.map((m) => m.usuarioId),
                ...vendas.flatMap((v) =>
                  v.canceladaPorId ? [v.canceladaPorId] : [],
                ),
              ]),
            ],
          },
        },
        select: { id: true, nome: true },
      });
      const nomes = new Map(usuarios.map((u) => [u.id, u.nome]));
      const resumo = totaisVazios();
      const modalidades = new Map<string, TotaisCaixa>();
      const lancamentos: DetalheCaixa["lancamentos"] = [
        {
          id: `${c.id}:abertura`,
          data: c.abertoEm.toISOString(),
          descricao: "Saldo inicial",
          forma: "DINHEIRO",
          tipo: "ABERTURA",
          valorCentavos: c.saldoInicialCentavos,
          usuario: c.operador,
        },
      ];
      for (const v of vendas) {
        const pagamentos = pagamentosLiquidos(
          v.pagamentos as PagamentoPdv[],
          v.trocoCentavos,
        );
        if (v.status === "CONCLUIDA") {
          acumularVenda(resumo, v, pagamentos);
          const total = modalidades.get(v.modalidade) ?? totaisVazios();
          acumularVenda(total, v, pagamentos);
          modalidades.set(v.modalidade, total);
        }
        const descricao = `Pedido Nº ${v.pedido?.numero ?? v.id.slice(0, 8).toUpperCase()} (${modalidadesCaixa[v.modalidade] ?? v.modalidade})`;
        for (const forma of Object.keys(pagamentos) as FormaCaixa[]) {
          if (!pagamentos[forma]) continue;
          lancamentos.push({
            id: `${v.id}:${forma}`,
            data: (v.recebidoEm ?? v.criadaEm).toISOString(),
            descricao,
            valorCentavos: pagamentos[forma],
            forma,
            tipo: "VENDA",
            usuario: v.recebidoPorNome ?? v.operador,
          });
          if (v.status === "CANCELADA" && v.canceladaEm)
            lancamentos.push({
              id: `${v.id}:${forma}:estorno`,
              data: v.canceladaEm.toISOString(),
              descricao: `Cancelamento · ${descricao}`,
              valorCentavos: -pagamentos[forma],
              forma,
              tipo: "ESTORNO",
              usuario:
                nomes.get(v.canceladaPorId ?? "") ?? "Operador não disponível",
            });
        }
      }
      let suprimentosCentavos = 0;
      let sangriasCentavos = 0;
      for (const m of c.movimentos) {
        if (m.tipo === "SANGRIA") sangriasCentavos += m.valorCentavos;
        else suprimentosCentavos += m.valorCentavos;
        lancamentos.push({
          id: m.id,
          data: m.criadoEm.toISOString(),
          descricao: m.motivo,
          valorCentavos:
            m.tipo === "SANGRIA" ? -m.valorCentavos : m.valorCentavos,
          forma: "DINHEIRO",
          tipo: m.tipo === "SANGRIA" ? "SANGRIA" : "SUPRIMENTO",
          usuario: nomes.get(m.usuarioId) ?? "Operador não disponível",
        });
      }
      const saldo =
        c.saldoFechamentoCentavos ??
        c.saldoInicialCentavos +
          resumo.pagamentos.DINHEIRO +
          suprimentosCentavos -
          sangriasCentavos;
      return {
        id: c.id,
        abertoEm: c.abertoEm.toISOString(),
        fechadoEm: c.fechadoEm?.toISOString() ?? null,
        operador: c.operador,
        localEstoqueId: c.localEstoqueId,
        saldoInicialCentavos: c.saldoInicialCentavos,
        saldoEsperadoCentavos: saldo,
        valorContadoCentavos: c.valorContadoCentavos,
        diferencaCentavos:
          c.valorContadoCentavos === null
            ? null
            : c.valorContadoCentavos - saldo,
        observacao: c.observacao,
        movimentos: c.movimentos.map((m) => ({
          id: m.id,
          tipo: m.tipo,
          valorCentavos: m.valorCentavos,
          motivo: m.motivo,
          criadoEm: m.criadoEm.toISOString(),
        })),
        lancamentos: lancamentos.sort(
          (a, b) => b.data.localeCompare(a.data) || a.id.localeCompare(b.id),
        ),
        resumo,
        modalidades: [...modalidades].map(([modalidade, totais]) => ({
          modalidade,
          totais,
        })),
        suprimentosCentavos,
        sangriasCentavos,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

export async function carregarGestaoCaixa(
  ctx: ContextoSessao,
  selecionado?: string,
) {
  const escopo = await exigirEscopo(ctx);
  const [atual, historico, locais] = await Promise.all([
    db.pdvCaixa.findFirst({
      where: { ...escopo, fechadoEm: null },
      select: { id: true },
    }),
    listarHistoricoCaixas(ctx),
    db.localEstoque.findMany({
      where: { unidadeId: escopo.unidadeId, ativo: true },
      select: { id: true, nome: true },
      orderBy: { nome: "asc" },
    }),
  ]);
  const id = selecionado ?? atual?.id ?? historico.itens[0]?.id;
  return {
    caixa: id ? await consultarCaixa(ctx, id) : null,
    caixaAtualId: atual?.id ?? null,
    historico,
    locais,
  };
}
