import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import type { ContextoSessao } from "@/core/sessao/nucleo";
import { EVENTOS_FINANCEIROS_PDV } from "@/server/recebimentos-pdv";
import {
  configuracaoRecebimentosPdv,
  FORMAS_RECEBIMENTO_PDV,
} from "../schemas/recebimentos-pdv";
import { centavos, reais, diaNoFuso, dataBancaria } from "../schemas/bancos";
import {
  exigirDiretor,
  registrarBaixa,
  transacaoFinanceira,
} from "./integrado";

export async function consultarRecebimentosPdv(ctx: ContextoSessao) {
  exigirDiretor(ctx);
  return transacaoFinanceira(ctx, "financeiro.ver", async (tx, u) => {
    const where = {
      appDestino: "financeiro",
      evento: {
        organizacaoId: ctx.organizacao.id,
        unidadeId: u,
        tipo: { in: [...EVENTOS_FINANCEIROS_PDV] },
      },
    };
    const [regras, empresas, contas, planos, pendentes, problemas] =
      await Promise.all([
        tx.configuracaoRecebimentoPdv.findMany({
          where: { organizacaoId: ctx.organizacao.id, unidadeId: u },
        }),
        tx.empresaFinanceira.findMany({
          where: {
            organizacaoId: ctx.organizacao.id,
            unidadeId: u,
            ativa: true,
          },
          select: { id: true, nome: true },
          orderBy: { nome: "asc" },
        }),
        tx.contaFinanceira.findMany({
          where: {
            unidadeId: u,
            ativa: true,
            empresa: { organizacaoId: ctx.organizacao.id, ativa: true },
          },
          select: { id: true, nome: true, empresaId: true },
          orderBy: { nome: "asc" },
        }),
        tx.categoriaFinanceira.findMany({
          where: {
            organizacaoId: ctx.organizacao.id,
            ativa: true,
            tipo: "RECEITA",
          },
          select: { id: true, nome: true },
          orderBy: { nome: "asc" },
        }),
        tx.entregaEvento.count({
          where: { ...where, status: { in: ["PENDENTE", "FALHOU"] } },
        }),
        tx.entregaEvento.findMany({
          where: { ...where, status: "FALHOU" },
          take: 20,
          orderBy: { criadoEm: "desc" },
          select: {
            id: true,
            ultimoErro: true,
            evento: { select: { correlacaoId: true } },
          },
        }),
      ]);
    return {
      regras: FORMAS_RECEBIMENTO_PDV.map((forma) => {
        const r = regras.find((r) => r.forma === forma);
        return {
          forma,
          ativa: r?.ativa ?? false,
          empresaId: r?.empresaId ?? null,
          contaId: r?.contaId ?? null,
          categoriaId: r?.categoriaId ?? null,
          taxaBps: r?.taxaBps ?? null,
          prazoDias: r?.prazoDias ?? null,
          baixarNoRecebimento: r?.baixarNoRecebimento ?? false,
          versao: r?.versao ?? 0,
        };
      }),
      empresas,
      contas,
      planos,
      pendentes,
      problemas,
      unidade: ctx.unidadeAtiva!.nome,
    };
  });
}

export async function salvarRecebimentosPdv(
  ctx: ContextoSessao,
  entrada: unknown,
) {
  exigirDiretor(ctx);
  const dados = configuracaoRecebimentosPdv.parse(entrada);
  return transacaoFinanceira(ctx, "financeiro.lancar", async (tx, u) => {
    for (const r of dados.regras) {
      const antes = await tx.configuracaoRecebimentoPdv.findUnique({
        where: { unidadeId_forma: { unidadeId: u, forma: r.forma } },
      });
      if ((antes?.versao ?? 0) !== r.versao)
        throw new Error(
          "A configuração mudou em outra tela. Atualize antes de salvar.",
        );
      if (
        r.empresaId &&
        !(await tx.empresaFinanceira.count({
          where: {
            id: r.empresaId,
            organizacaoId: ctx.organizacao.id,
            unidadeId: u,
            ativa: true,
          },
        }))
      )
        throw new Error("Empresa indisponível nesta unidade.");
      if (
        r.contaId &&
        (!r.empresaId ||
          !(await tx.contaFinanceira.count({
            where: {
              id: r.contaId,
              unidadeId: u,
              empresaId: r.empresaId,
              ativa: true,
            },
          })))
      )
        throw new Error("Conta indisponível ou de outra empresa.");
      if (
        r.categoriaId &&
        !(await tx.categoriaFinanceira.count({
          where: {
            id: r.categoriaId,
            organizacaoId: ctx.organizacao.id,
            ativa: true,
            tipo: "RECEITA",
          },
        }))
      )
        throw new Error("Escolha um plano ativo de receita desta organização.");
      const { versao, ...campos } = r;
      const salvo = await tx.configuracaoRecebimentoPdv.upsert({
        where: { unidadeId_forma: { unidadeId: u, forma: r.forma } },
        create: {
          ...campos,
          organizacaoId: ctx.organizacao.id,
          unidadeId: u,
          versao: versao + 1,
        },
        update: { ...campos, versao: versao + 1 },
      });
      await tx.auditoria.create({
        data: {
          organizacaoId: ctx.organizacao.id,
          unidadeId: u,
          usuarioId: ctx.usuario.id,
          entidade: "ConfiguracaoRecebimentoPdv",
          entidadeId: salvo.id,
          acao: antes ? "ALTEROU" : "CRIOU",
          valoresAntes: antes
            ? JSON.parse(JSON.stringify(antes))
            : Prisma.JsonNull,
          valoresDepois: JSON.parse(JSON.stringify(salvo)),
        },
      });
    }
    return {
      mensagem:
        "Configuração salva. Use Processar recebimentos para integrar os eventos pendentes.",
    };
  });
}

const pagamentos = z
  .array(
    z.object({
      forma: z.enum(FORMAS_RECEBIMENTO_PDV),
      valorCentavos: z.number().int().positive(),
    }),
  )
  .min(1);
class PendentePdv extends Error {}
export async function processarRecebimentosPdv(ctx: ContextoSessao) {
  exigirDiretor(ctx);
  const ids = await transacaoFinanceira(ctx, "financeiro.quitar", (tx, u) =>
    tx.entregaEvento.findMany({
      where: {
        appDestino: "financeiro",
        status: { in: ["PENDENTE", "FALHOU"] },
        evento: {
          organizacaoId: ctx.organizacao.id,
          unidadeId: u,
          tipo: { in: [...EVENTOS_FINANCEIROS_PDV] },
        },
      },
      select: { id: true },
      orderBy: [{ tentativas: "asc" }, { criadoEm: "asc" }, { id: "asc" }],
      take: 50,
    }),
  );
  let processados = 0,
    aguardando = 0;
  for (const { id } of ids) {
    try {
      const feito = await transacaoFinanceira(
        ctx,
        "financeiro.lancar",
        async (tx, u) => {
          const entrega = await tx.entregaEvento.findFirst({
            where: {
              id,
              appDestino: "financeiro",
              status: { in: ["PENDENTE", "FALHOU"] },
              evento: {
                organizacaoId: ctx.organizacao.id,
                unidadeId: u,
                tipo: { in: [...EVENTOS_FINANCEIROS_PDV] },
              },
            },
            include: { evento: true },
          });
          if (!entrega) return false;
          const { vendaId } = z
            .object({ vendaId: z.string().min(1) })
            .parse(entrega.evento.dados);
          const venda = await tx.pdvVenda.findFirst({
            where: {
              id: vendaId,
              organizacaoId: ctx.organizacao.id,
              unidadeId: u,
            },
          });
          if (!venda)
            throw new PendentePdv("Venda indisponível nesta unidade.");
          const chaves = FORMAS_RECEBIMENTO_PDV.map(
            (forma) => `pdv:${venda.id}:${forma}`,
          );
          if (entrega.evento.tipo === "pdv.venda_cancelada") {
            if (venda.status !== "CANCELADA")
              throw new PendentePdv(
                "O cancelamento precisa ser conferido no PDV.",
              );
            const lancamentos = await tx.lancamento.findMany({
              where: {
                unidadeId: u,
                chaveCriacao: { in: chaves },
                status: { not: "CANCELADO" },
              },
              include: { baixas: { where: { estornadoEm: null } } },
            });
            if (
              lancamentos.some(
                (l) => l.baixas.length || centavos(l.valorQuitado ?? 0) > 0n,
              )
            )
              throw new PendentePdv(
                "Venda cancelada com recebimento baixado: confira a devolução e estorne a baixa antes de reprocessar.",
              );
            for (const l of lancamentos) {
              await tx.lancamento.update({
                where: { id: l.id },
                data: { status: "CANCELADO", versao: { increment: 1 } },
              });
              await tx.auditoria.create({
                data: {
                  organizacaoId: ctx.organizacao.id,
                  unidadeId: u,
                  usuarioId: ctx.usuario.id,
                  entidade: "Lancamento",
                  entidadeId: l.id,
                  acao: "ALTEROU",
                  valoresAntes: { status: l.status },
                  valoresDepois: {
                    status: "CANCELADO",
                    eventoId: entrega.eventoId,
                  },
                },
              });
            }
          } else if (venda.status !== "CANCELADA") {
            if (venda.status !== "CONCLUIDA" || !venda.recebidoEm)
              throw new PendentePdv(
                "Venda ainda não tem recebimento confirmado.",
              );
            const porForma = new Map<string, bigint>();
            for (const p of pagamentos.parse(venda.pagamentos))
              porForma.set(
                p.forma,
                (porForma.get(p.forma) ?? 0n) + BigInt(p.valorCentavos),
              );
            if (venda.trocoCentavos)
              porForma.set(
                "DINHEIRO",
                (porForma.get("DINHEIRO") ?? 0n) - BigInt(venda.trocoCentavos),
              );
            if (
              [...porForma.values()].some((v) => v < 0n) ||
              [...porForma.values()].reduce((s, v) => s + v, 0n) !==
                BigInt(venda.totalCentavos)
            )
              throw new PendentePdv(
                "Os pagamentos da venda precisam de conferência.",
              );
            const fuso = (
              await tx.unidade.findUniqueOrThrow({
                where: { id: u },
                select: { fusoHorario: true },
              })
            ).fusoHorario;
            const dia = diaNoFuso(venda.recebidoEm, fuso);
            for (const [forma, bruto] of porForma) {
              if (bruto === 0n) continue;
              const chaveCriacao = `pdv:${venda.id}:${forma}`;
              if (
                await tx.lancamento.count({
                  where: { unidadeId: u, chaveCriacao },
                })
              )
                continue;
              const r = await tx.configuracaoRecebimentoPdv.findFirst({
                where: {
                  organizacaoId: ctx.organizacao.id,
                  unidadeId: u,
                  forma,
                  ativa: true,
                  empresa: { ativa: true },
                  conta: { ativa: true },
                  categoria: {
                    ativa: true,
                    tipo: "RECEITA",
                    organizacaoId: ctx.organizacao.id,
                  },
                },
              });
              if (
                !r ||
                !r.empresaId ||
                !r.contaId ||
                !r.categoriaId ||
                r.taxaBps === null ||
                r.prazoDias === null
              )
                throw new PendentePdv(
                  `Configure e ative ${forma} antes de integrar esta venda.`,
                );
              const taxa = (bruto * BigInt(r.taxaBps) + 5000n) / 10000n,
                liquido = bruto - taxa;
              if (liquido <= 0n)
                throw new PendentePdv(
                  "O valor líquido precisa ser positivo. Confira a taxa configurada.",
                );
              const vencimento = new Date(
                dataBancaria(dia).getTime() + r.prazoDias * 86400000,
              );
              const l = await tx.lancamento.create({
                data: {
                  unidadeId: u,
                  empresaId: r.empresaId,
                  categoriaId: r.categoriaId,
                  contaId: r.contaId,
                  direcao: "RECEBER",
                  descricao: `PDV ${venda.id} · ${forma}`,
                  valor: reais(bruto),
                  desconto: reais(taxa),
                  vencimento,
                  competencia: dataBancaria(diaNoFuso(venda.criadaEm, fuso)),
                  tipoPagamento: forma,
                  historico: `Recebimento PDV; taxa ${(r.taxaBps / 100).toFixed(2)}%; prazo ${r.prazoDias} dias corridos.`,
                  numeroPedido: venda.id,
                  chaveCriacao,
                  assinaturaCriacao: entrega.eventoId,
                  criadoPorId: ctx.usuario.id,
                },
              });
              await tx.auditoria.create({
                data: {
                  organizacaoId: ctx.organizacao.id,
                  unidadeId: u,
                  usuarioId: ctx.usuario.id,
                  entidade: "Lancamento",
                  entidadeId: l.id,
                  acao: "CRIOU",
                  valoresDepois: {
                    origem: "pdv",
                    eventoId: entrega.eventoId,
                    forma,
                    valor: reais(bruto),
                    taxa: reais(taxa),
                    configuracaoId: r.id,
                    versaoConfiguracao: r.versao,
                  },
                },
              });
              if (r.baixarNoRecebimento)
                await registrarBaixa(
                  tx,
                  ctx,
                  u,
                  {
                    lancamentoId: l.id,
                    contaId: r.contaId,
                    valor: reais(liquido),
                    dataPagamento: dia,
                    tipoPagamento: forma as "DINHEIRO" | "PIX",
                    complemento: "Recebimento confirmado no PDV",
                    chave: randomUUID(),
                  },
                  undefined,
                  "pdv",
                );
            }
          }
          await tx.entregaEvento.update({
            where: { id },
            data: {
              status: "PROCESSADO",
              processadoEm: new Date(),
              tentativas: { increment: 1 },
              ultimoErro: null,
            },
          });
          return true;
        },
      );
      if (feito) processados++;
    } catch (e) {
      const erro =
        e instanceof PendentePdv
          ? e.message
          : "Não foi possível integrar. Confira a configuração e tente novamente.";
      await transacaoFinanceira(ctx, "financeiro.lancar", (tx, u) =>
        tx.entregaEvento.updateMany({
          where: {
            id,
            status: { not: "PROCESSADO" },
            evento: { organizacaoId: ctx.organizacao.id, unidadeId: u },
          },
          data: {
            status: "FALHOU",
            tentativas: { increment: 1 },
            ultimoErro: erro,
          },
        }),
      );
      aguardando++;
    }
  }
  return {
    processados,
    aguardando,
    mensagem: `${processados} eventos integrados; ${aguardando} aguardando configuração ou conferência. Lote de até 50 eventos.`,
  };
}
