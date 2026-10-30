import { Prisma } from "@prisma/client";
import { z } from "zod";
import { pode, type ContextoSessao } from "@/core/sessao/nucleo";
import { db } from "@/server/db";
import { ExigeUnidade, SemPermissao } from "@/lib/erros";
import type { TransacaoBancaria } from "@/lib/extrato-bancario";
import {
  centavos,
  reais,
  dataBancaria,
  diaNoFuso,
  cnpjValido,
} from "../schemas/bancos";
import {
  encontrarCandidatos,
  valorLiquido,
} from "../schemas/conciliacao-inter";
import {
  baixaIntegrada,
  filtroIntegrado,
  integracaoIntegrada,
  lancamentoIntegrado,
  pessoaIntegrada,
  planoIntegrado,
  transferenciaIntegrada,
} from "../schemas/financeiro-integrado";

type Tx = Prisma.TransactionClient;
export function exigirDiretor(ctx: ContextoSessao) {
  if (!ctx.ehDiretor)
    throw new SemPermissao("executar esta ação exclusiva do diretor");
}
export async function transacaoFinanceira<T>(
  ctx: ContextoSessao,
  permissao: string,
  fn: (tx: Tx, unidadeId: string) => Promise<T>,
): Promise<T> {
  if (!pode(ctx, "financeiro.ver") || !pode(ctx, permissao))
    throw new SemPermissao("acessar esta operação financeira");
  if (!ctx.unidadeAtiva) throw new ExigeUnidade();
  const unidadeId = ctx.unidadeAtiva.id;
  if (!ctx.unidadesVisiveis.some((u) => u.id === unidadeId))
    throw new SemPermissao("acessar esta unidade");
  for (let i = 0; ; i++) {
    try {
      return await db.$transaction(
        async (tx) => {
          const unidade = await tx.unidade.findFirst({
            where: {
              id: unidadeId,
              organizacaoId: ctx.organizacao.id,
              ativa: true,
              excluidoEm: null,
              organizacao: { ativa: true, excluidoEm: null },
            },
          });
          if (!unidade) throw new SemPermissao("acessar esta unidade");
          await tx.$queryRaw`SELECT set_config('tetteo.financeiro_organizacao', ${ctx.organizacao.id}, true), set_config('tetteo.financeiro_unidade', ${unidadeId}, true)`;
          return fn(tx, unidadeId);
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 15000,
        },
      );
    } catch (e) {
      if (
        i < 3 &&
        e instanceof Prisma.PrismaClientKnownRequestError &&
        ["P2034", "P2002"].includes(e.code)
      )
        continue;
      throw e;
    }
  }
}
const escopo = (ctx: ContextoSessao, unidadeId: string) => ({
  organizacaoId: ctx.organizacao.id,
  unidadeId,
});
const visivel = (ctx: ContextoSessao) =>
  ctx.ehDiretor ? {} : { restritoMaster: false };
function json(v: unknown): Prisma.InputJsonValue {
  return JSON.parse(
    JSON.stringify(v, (_k, n) => (typeof n === "bigint" ? n.toString() : n)),
  );
}
async function auditar(
  tx: Tx,
  ctx: ContextoSessao,
  entidade: string,
  id: string,
  antes: unknown,
  depois: unknown,
) {
  await tx.auditoria.create({
    data: {
      organizacaoId: ctx.organizacao.id,
      unidadeId: ctx.unidadeAtiva!.id,
      usuarioId: ctx.usuario.id,
      entidade,
      entidadeId: id,
      acao: antes ? "ALTEROU" : "CRIOU",
      valoresAntes: antes ? json(antes) : undefined,
      valoresDepois: json(depois),
    },
  });
}
async function empresa(
  tx: Tx,
  ctx: ContextoSessao,
  unidadeId: string,
  id: string,
) {
  const e = await tx.empresaFinanceira.findFirst({
    where: { id, unidadeId, organizacaoId: ctx.organizacao.id, ativa: true },
  });
  if (!e) throw new Error("Empresa não encontrada na unidade ativa.");
  return e;
}
async function conta(
  tx: Tx,
  unidadeId: string,
  id: string,
  empresaId?: string,
) {
  const c = await tx.contaFinanceira.findFirst({
    where: { id, unidadeId, ativa: true, ...(empresaId ? { empresaId } : {}) },
  });
  if (!c) throw new Error("Conta não encontrada, inativa ou de outra empresa.");
  return c;
}
const incluirLancamento = {
  pessoa: true,
  fornecedor: true,
  categoria: true,
  empresa: true,
  centroCusto: true,
  baixas: {
    where: { estornadoEm: null },
    orderBy: { dataPagamento: "asc" as const },
  },
};
type Linha = Prisma.LancamentoGetPayload<{ include: typeof incluirLancamento }>;
function pago(l: Pick<Linha, "baixas" | "valorQuitado">) {
  return l.baixas.length
    ? l.baixas.reduce((s, b) => s + centavos(b.valor), 0n)
    : centavos(l.valorQuitado ?? 0);
}
function paraLista(l: Linha) {
  const liquido = valorLiquido(l),
    totalPago = pago(l);
  return {
    ...l,
    valor: String(l.valor),
    desconto: String(l.desconto),
    multa: String(l.multa),
    juros: String(l.juros),
    valorQuitado: l.valorQuitado === null ? null : String(l.valorQuitado),
    valorLiquido: reais(liquido),
    saldo: reais(liquido - totalPago),
    totalPago: reais(totalPago),
    baixas: l.baixas.map((b) => ({ ...b, valor: String(b.valor) })),
  };
}

export async function consultarFinanceiro(
  ctx: ContextoSessao,
  entrada: unknown = {},
) {
  const filtro = filtroIntegrado.parse(entrada);
  return transacaoFinanceira(ctx, "financeiro.ver", async (tx, unidadeId) => {
    const base = escopo(ctx, unidadeId);
    const busca: Prisma.LancamentoWhereInput = filtro.q
      ? {
          OR: [
            { descricao: { contains: filtro.q, mode: "insensitive" } },
            { pessoa: { nome: { contains: filtro.q, mode: "insensitive" } } },
            {
              fornecedor: { nome: { contains: filtro.q, mode: "insensitive" } },
            },
            { historico: { contains: filtro.q, mode: "insensitive" } },
            { numeroPedido: { contains: filtro.q, mode: "insensitive" } },
            { numeroNotaFiscal: { contains: filtro.q, mode: "insensitive" } },
            ...(/^\d+(?:[.,]\d{1,2})?$/.test(filtro.q)
              ? [{ valor: new Prisma.Decimal(filtro.q.replace(",", ".")) }]
              : []),
          ],
        }
      : {};
    const where: Prisma.LancamentoWhereInput = {
      unidadeId,
      ...visivel(ctx),
      ...busca,
      ...(filtro.direcao ? { direcao: filtro.direcao } : {}),
      ...(filtro.status ? { status: filtro.status } : {}),
      ...(filtro.empresaId ? { empresaId: filtro.empresaId } : {}),
      ...(filtro.de || filtro.ate
        ? {
            vencimento: {
              ...(filtro.de ? { gte: dataBancaria(filtro.de) } : {}),
              ...(filtro.ate
                ? {
                    lt: new Date(dataBancaria(filtro.ate).getTime() + 86400000),
                  }
                : {}),
            },
          }
        : {}),
    };
    const [
      lancamentos,
      total,
      pessoas,
      planos,
      centros,
      empresas,
      contas,
      integracoes,
      pendencias,
      transferencias,
      grupos,
      baixas,
      antigas,
      transfersAntigas,
    ] = await Promise.all([
      tx.lancamento.findMany({
        where,
        include: incluirLancamento,
        orderBy: [{ vencimento: "asc" }, { id: "asc" }],
        skip: (filtro.pagina - 1) * 50,
        take: 50,
      }),
      tx.lancamento.count({ where }),
      tx.pessoaFinanceira.findMany({ where: base, orderBy: { nome: "asc" } }),
      tx.categoriaFinanceira.findMany({
        where: { organizacaoId: ctx.organizacao.id, ativa: true },
        orderBy: [{ codigo: "asc" }, { nome: "asc" }],
      }),
      tx.centroCustoFinanceiro.findMany({
        where: { ...base, ativo: true },
        orderBy: { nome: "asc" },
      }),
      tx.empresaFinanceira.findMany({
        where: { ...base, ativa: true },
        orderBy: { nome: "asc" },
      }),
      tx.contaFinanceira.findMany({
        where: { unidadeId },
        orderBy: { nome: "asc" },
      }),
      ctx.ehDiretor
        ? tx.integracaoInter.findMany({
            where: base,
            include: { empresa: true, conta: true },
          })
        : [],
      tx.pendenciaInter.findMany({
        where: { ...base, status: "pendente" },
        orderBy: { data: "desc" },
        take: 200,
      }),
      tx.transferenciaInterna.findMany({
        where: base,
        orderBy: { data: "desc" },
      }),
      tx.lancamento.groupBy({
        by: ["direcao", "status", "composeDre", "categoriaId"],
        where: {
          unidadeId,
          ...visivel(ctx),
          ...(filtro.de || filtro.ate
            ? {
                competencia: {
                  ...(filtro.de ? { gte: dataBancaria(filtro.de) } : {}),
                  ...(filtro.ate ? { lte: dataBancaria(filtro.ate) } : {}),
                },
              }
            : {}),
        },
        _sum: {
          valor: true,
          desconto: true,
          multa: true,
          juros: true,
          valorQuitado: true,
        },
      }),
      tx.baixaFinanceira.findMany({
        where: { ...base, estornadoEm: null, lancamento: visivel(ctx) },
        include: { lancamento: { select: { direcao: true } } },
      }),
      tx.lancamento.findMany({
        where: {
          unidadeId,
          status: "QUITADO",
          ...visivel(ctx),
          baixas: { none: {} },
        },
        select: {
          contaId: true,
          direcao: true,
          valorQuitado: true,
          quitadoEm: true,
        },
      }),
      ctx.ehDiretor
        ? tx.transferenciaFinanceira.findMany({ where: { unidadeId } })
        : [],
    ]);
    const fluxo = { entradas: 0n, saidas: 0n };
    const dentro = (data: Date) =>
      (!filtro.de || data.toISOString().slice(0, 10) >= filtro.de) &&
      (!filtro.ate || data.toISOString().slice(0, 10) <= filtro.ate);
    for (const b of baixas)
      if (dentro(b.dataPagamento))
        fluxo[b.lancamento.direcao === "RECEBER" ? "entradas" : "saidas"] +=
          centavos(b.valor);
    for (const l of antigas)
      if (l.quitadoEm && dentro(l.quitadoEm))
        fluxo[l.direcao === "RECEBER" ? "entradas" : "saidas"] += centavos(
          l.valorQuitado ?? 0,
        );
    const fuso = (
      await tx.unidade.findUniqueOrThrow({
        where: { id: unidadeId },
        select: { fusoHorario: true },
      })
    ).fusoHorario;
    const hojeSaldo = diaNoFuso(new Date(), fuso);
    const saldos = contas.map((c) => {
      const corte = diaNoFuso(c.iniciadaEm, fuso);
      const noSaldo = (data: Date) =>
        data.toISOString().slice(0, 10) <= hojeSaldo &&
        (!c.corteAplicado || data.toISOString().slice(0, 10) >= corte);
      let saldo =
        !c.corteAplicado || corte <= hojeSaldo ? centavos(c.saldoInicial) : 0n;
      for (const b of baixas)
        if (b.contaId === c.id && noSaldo(b.dataPagamento))
          saldo +=
            centavos(b.valor) * (b.lancamento.direcao === "RECEBER" ? 1n : -1n);
      for (const l of antigas)
        if (l.contaId === c.id && l.quitadoEm && noSaldo(l.quitadoEm))
          saldo +=
            centavos(l.valorQuitado ?? 0) *
            (l.direcao === "RECEBER" ? 1n : -1n);
      for (const t of transferencias.filter(
        (t) => !t.estornadoEm && noSaldo(t.data),
      )) {
        if (t.origemId === c.id) saldo -= centavos(t.valor);
        if (t.destinoId === c.id) saldo += centavos(t.valor);
      }
      for (const t of transfersAntigas.filter((t) => noSaldo(t.data))) {
        if (t.origemId === c.id) saldo -= t.valorCentavos;
        if (t.destinoId === c.id) saldo += t.valorCentavos;
      }
      return {
        ...c,
        saldoInicial: String(c.saldoInicial),
        saldoInicialCentavos: c.saldoInicialCentavos?.toString() ?? null,
        saldo: ctx.ehDiretor ? reais(saldo) : null,
      };
    });
    return {
      saldoSemConta: ctx.ehDiretor
        ? reais(
            antigas
              .filter(
                (l) => !l.contaId && l.quitadoEm && l.quitadoEm <= new Date(),
              )
              .reduce(
                (s, l) =>
                  s +
                  centavos(l.valorQuitado ?? 0) *
                    (l.direcao === "RECEBER" ? 1n : -1n),
                0n,
              ),
          )
        : null,
      fluxo: { entradas: reais(fluxo.entradas), saidas: reais(fluxo.saidas) },
      lancamentos: lancamentos.map(paraLista),
      total,
      filtro,
      pessoas,
      planos,
      centros,
      empresas,
      contas: saldos,
      integracoes,
      pendencias: pendencias.map((p) => ({
        ...p,
        candidatosIds: ctx.ehDiretor ? p.candidatosIds : [],
      })),
      transferencias,
      grupos: grupos.map((g) => ({
        direcao: g.direcao,
        status: g.status,
        composeDre:
          g.composeDre &&
          planos.find((p) => p.id === g.categoriaId)?.entraDre !== false,
        liquido: reais(
          centavos(g._sum.valor ?? 0) -
            centavos(g._sum.desconto ?? 0) +
            centavos(g._sum.multa ?? 0) +
            centavos(g._sum.juros ?? 0),
        ),
        pago: String(g._sum.valorQuitado ?? 0),
      })),
      permissoes: {
        editar: pode(ctx, "financeiro.lancar"),
        baixar: pode(ctx, "financeiro.quitar"),
        diretor: ctx.ehDiretor,
        resultado: pode(ctx, "financeiro.resultado"),
      },
      unidade: ctx.unidadeAtiva!.nome,
    };
  });
}

export async function detalheFinanceiro(ctx: ContextoSessao, id: string) {
  return transacaoFinanceira(ctx, "financeiro.ver", async (tx, unidadeId) => {
    const l = await tx.lancamento.findFirst({
      where: { id, unidadeId, ...visivel(ctx) },
      include: incluirLancamento,
    });
    if (!l) throw new Error("Lançamento não encontrado.");
    return paraLista(l);
  });
}

export async function salvarLancamentoIntegrado(
  ctx: ContextoSessao,
  entrada: unknown,
) {
  const dados = lancamentoIntegrado.parse(entrada);
  return transacaoFinanceira(
    ctx,
    "financeiro.lancar",
    async (tx, unidadeId) => {
      if (dados.restritoMaster) exigirDiretor(ctx);
      await empresa(tx, ctx, unidadeId, dados.empresaId);
      const plano = await tx.categoriaFinanceira.findFirst({
        where: {
          id: dados.categoriaId,
          organizacaoId: ctx.organizacao.id,
          ativa: true,
        },
      });
      if (
        !plano ||
        plano.tipo !== (dados.direcao === "PAGAR" ? "DESPESA" : "RECEITA")
      )
        throw new Error("Escolha um plano compatível com a operação.");
      if (
        dados.pessoaId &&
        !(await tx.pessoaFinanceira.count({
          where: { id: dados.pessoaId, ...escopo(ctx, unidadeId), ativa: true },
        }))
      )
        throw new Error("Pessoa inválida.");
      if (
        dados.centroCustoId &&
        !(await tx.centroCustoFinanceiro.count({
          where: {
            id: dados.centroCustoId,
            ...escopo(ctx, unidadeId),
            ativo: true,
          },
        }))
      )
        throw new Error("Centro de custo inválido.");
      const antes = dados.id
        ? await tx.lancamento.findFirst({
            where: { id: dados.id, unidadeId, ...visivel(ctx) },
            include: { baixas: { where: { estornadoEm: null } } },
          })
        : null;
      if (dados.id && !antes) throw new Error("Lançamento não encontrado.");
      if (
        antes &&
        (antes.versao !== dados.versao ||
          antes.status !== "ABERTO" ||
          antes.baixas.length ||
          antes.valorQuitado)
      )
        throw new Error(
          "Lançamento mudou ou já tem baixas. Atualize a tela; estorne antes de editar.",
        );
      const { id, versao, ...campos } = dados;
      void versao;
      const data = {
        ...campos,
        vencimento: dataBancaria(dados.vencimento),
        competencia: dataBancaria(dados.competencia),
        versao: (antes?.versao ?? -1) + 1,
      };
      const salvo = id
        ? await tx.lancamento.update({ where: { id }, data })
        : await tx.lancamento.create({
            data: { ...data, unidadeId, criadoPorId: ctx.usuario.id },
          });
      await auditar(tx, ctx, "Lancamento", salvo.id, antes, salvo);
      return { id: salvo.id };
    },
  );
}

export async function salvarPessoaIntegrada(
  ctx: ContextoSessao,
  entrada: unknown,
) {
  const { id, ...data } = pessoaIntegrada.parse(entrada);
  return transacaoFinanceira(
    ctx,
    "financeiro.lancar",
    async (tx, unidadeId) => {
      if (
        data.categoriaId &&
        !(await tx.categoriaFinanceira.count({
          where: {
            id: data.categoriaId,
            organizacaoId: ctx.organizacao.id,
            ativa: true,
            tipo: data.operacaoPadrao === "PAGAR" ? "DESPESA" : "RECEITA",
          },
        }))
      )
        throw new Error("Plano incompatível com a operação padrão.");
      const antes = id
        ? await tx.pessoaFinanceira.findFirst({
            where: { id, ...escopo(ctx, unidadeId) },
          })
        : null;
      if (id && !antes) throw new Error("Pessoa não encontrada.");
      const salvo = id
        ? await tx.pessoaFinanceira.update({ where: { id }, data })
        : await tx.pessoaFinanceira.create({
            data: { ...data, ...escopo(ctx, unidadeId) },
          });
      await auditar(tx, ctx, "PessoaFinanceira", salvo.id, antes, salvo);
      return { id: salvo.id };
    },
  );
}
export async function salvarPlanoIntegrado(
  ctx: ContextoSessao,
  entrada: unknown,
) {
  const { id, ...data } = planoIntegrado.parse(entrada);
  return transacaoFinanceira(
    ctx,
    "financeiro.lancar",
    async (tx, unidadeId) => {
      void unidadeId;
      const antes = id
        ? await tx.categoriaFinanceira.findFirst({
            where: { id, organizacaoId: ctx.organizacao.id },
          })
        : null;
      if (id && !antes) throw new Error("Plano não encontrado.");
      if (
        antes &&
        antes.tipo !== data.tipo &&
        (await tx.lancamento.count({ where: { categoriaId: id! } }))
      )
        throw new Error("Plano com movimentos não pode mudar de operação.");
      if (
        await tx.categoriaFinanceira.count({
          where: {
            organizacaoId: ctx.organizacao.id,
            codigo: data.codigo,
            ...(id ? { id: { not: id } } : {}),
          },
        })
      )
        throw new Error("Código já utilizado.");
      let paiId = data.paiId;
      const visitados = new Set([id]);
      while (paiId) {
        if (visitados.has(paiId))
          throw new Error("O plano não pode formar um ciclo.");
        visitados.add(paiId);
        const pai = await tx.categoriaFinanceira.findFirst({
          where: {
            id: paiId,
            organizacaoId: ctx.organizacao.id,
            ativa: true,
            tipo: data.tipo,
          },
        });
        if (!pai) throw new Error("Plano pai inválido ou de outra operação.");
        paiId = pai.paiId;
      }
      const salvo = id
        ? await tx.categoriaFinanceira.update({ where: { id }, data })
        : await tx.categoriaFinanceira.create({
            data: { ...data, organizacaoId: ctx.organizacao.id },
          });
      await auditar(tx, ctx, "CategoriaFinanceira", salvo.id, antes, salvo);
      return { id: salvo.id };
    },
  );
}
export async function salvarCentroIntegrado(
  ctx: ContextoSessao,
  entrada: unknown,
) {
  const dados = z
    .object({ nome: z.string().trim().min(2).max(100) })
    .parse(entrada);
  return transacaoFinanceira(ctx, "financeiro.lancar", async (tx, u) => {
    const salvo = await tx.centroCustoFinanceiro.create({
      data: { ...dados, ...escopo(ctx, u) },
    });
    await auditar(tx, ctx, "CentroCustoFinanceiro", salvo.id, null, salvo);
    return { id: salvo.id };
  });
}

export async function salvarIntegracaoInter(
  ctx: ContextoSessao,
  entrada: unknown,
) {
  exigirDiretor(ctx);
  const { id, ...dados } = integracaoIntegrada.parse(entrada);
  return transacaoFinanceira(ctx, "financeiro.ver", async (tx, u) => {
    const e = await empresa(tx, ctx, u, dados.empresaId);
    if (!cnpjValido(e.cnpj))
      throw new Error(
        "Cadastre e confirme o CNPJ da empresa antes de ligar o Inter.",
      );
    const c = await conta(tx, u, dados.contaId, dados.empresaId);
    if (c.tipo !== "BANCO") throw new Error("Vincule uma conta bancária.");
    const antes = id
      ? await tx.integracaoInter.findFirst({ where: { id, ...escopo(ctx, u) } })
      : null;
    if (id && !antes) throw new Error("Integração não encontrada.");
    if (
      antes &&
      (antes.empresaId !== dados.empresaId ||
        antes.contaId !== dados.contaId ||
        antes.ambiente !== dados.ambiente ||
        antes.envKey !== dados.envKey)
    )
      throw new Error(
        "Preserve empresa, conta, ambiente e identificador. Para trocar a integração, use outro cadastro de empresa/conta.",
      );
    const salvo = id
      ? await tx.integracaoInter.update({ where: { id }, data: dados })
      : await tx.integracaoInter.create({
          data: { ...dados, ...escopo(ctx, u) },
        });
    await auditar(tx, ctx, "IntegracaoInter", salvo.id, antes, salvo);
    return { id: salvo.id };
  });
}

async function registrarBaixa(
  tx: Tx,
  ctx: ContextoSessao,
  u: string,
  dados: z.infer<typeof baixaIntegrada>,
  interId?: string,
) {
  const anterior = await tx.baixaFinanceira.findUnique({
    where: { chave: dados.chave },
  });
  if (anterior) {
    if (
      anterior.unidadeId !== u ||
      anterior.lancamentoId !== dados.lancamentoId ||
      anterior.contaId !== dados.contaId ||
      centavos(anterior.valor) !== centavos(dados.valor) ||
      anterior.dataPagamento.toISOString().slice(0, 10) !== dados.dataPagamento
    )
      throw new Error("Chave de baixa já utilizada com outros dados.");
    return anterior;
  }
  const l = await tx.lancamento.findFirst({
    where: { id: dados.lancamentoId, unidadeId: u, ...visivel(ctx) },
    include: incluirLancamento,
  });
  if (!l || l.status !== "ABERTO")
    throw new Error("Lançamento não encontrado ou fora de aberto.");
  if (!l.empresaId)
    throw new Error("Revise o CNPJ do lançamento antigo antes de baixar.");
  await conta(tx, u, dados.contaId, l.empresaId);
  const saldo = valorLiquido(l) - pago(l),
    valor = centavos(dados.valor);
  if (valor <= 0n || valor > saldo)
    throw new Error(
      "A baixa deve ser positiva e não pode exceder o saldo em aberto.",
    );
  const b = await tx.baixaFinanceira.create({
    data: {
      ...dados,
      ...escopo(ctx, u),
      dataPagamento: dataBancaria(dados.dataPagamento),
      origem: interId ? "inter" : "manual",
      interTransacaoId: interId,
      criadoPorId: ctx.usuario.id,
    },
  });
  const total = pago(l) + valor;
  await tx.lancamento.update({
    where: { id: l.id },
    data: {
      valorQuitado: reais(total),
      quitadoEm: dataBancaria(dados.dataPagamento),
      quitadoPorId: ctx.usuario.id,
      contaId: dados.contaId,
      status: total >= valorLiquido(l) ? "QUITADO" : "ABERTO",
      versao: { increment: 1 },
    },
  });
  await auditar(tx, ctx, "BaixaFinanceira", b.id, null, b);
  return b;
}
export async function baixarIntegrado(ctx: ContextoSessao, entrada: unknown) {
  const d = baixaIntegrada.parse(entrada);
  return transacaoFinanceira(ctx, "financeiro.quitar", (tx, u) =>
    registrarBaixa(tx, ctx, u, d),
  );
}

export async function estornarBaixaIntegrada(ctx: ContextoSessao, id: string) {
  exigirDiretor(ctx);
  return transacaoFinanceira(ctx, "financeiro.quitar", async (tx, u) => {
    const b = await tx.baixaFinanceira.findFirst({
      where: { id, ...escopo(ctx, u), estornadoEm: null },
    });
    if (!b) throw new Error("Baixa não encontrada.");
    await tx.baixaFinanceira.update({
      where: { id },
      data: { estornadoEm: new Date(), estornadoPorId: ctx.usuario.id },
    });
    const restantes = await tx.baixaFinanceira.findMany({
      where: {
        lancamentoId: b.lancamentoId,
        ...escopo(ctx, u),
        estornadoEm: null,
      },
    });
    const total = restantes.reduce((s, r) => s + centavos(r.valor), 0n);
    await tx.lancamento.update({
      where: { id: b.lancamentoId },
      data: {
        status: "ABERTO",
        valorQuitado: total ? reais(total) : null,
        quitadoEm: restantes.at(-1)?.dataPagamento ?? null,
        versao: { increment: 1 },
      },
    });
    await auditar(tx, ctx, "BaixaFinanceira", id, b, { estornada: true });
    return { ok: true };
  });
}
export async function cancelarIntegrado(ctx: ContextoSessao, id: string) {
  return transacaoFinanceira(ctx, "financeiro.lancar", async (tx, u) => {
    const l = await tx.lancamento.findFirst({
      where: { id, unidadeId: u, ...visivel(ctx) },
      include: { baixas: { where: { estornadoEm: null } } },
    });
    if (!l || l.status !== "ABERTO" || l.baixas.length || l.valorQuitado)
      throw new Error("Só é possível cancelar lançamento aberto sem baixas.");
    await tx.lancamento.update({
      where: { id },
      data: {
        status: "CANCELADO",
        canceladoEm: new Date(),
        versao: { increment: 1 },
      },
    });
    await auditar(tx, ctx, "Lancamento", id, l, { status: "CANCELADO" });
    return { ok: true };
  });
}

export async function criarTransferenciaIntegrada(
  ctx: ContextoSessao,
  entrada: unknown,
) {
  const d = transferenciaIntegrada.parse(entrada);
  return transacaoFinanceira(ctx, "financeiro.quitar", async (tx, u) => {
    const antes = await tx.transferenciaInterna.findUnique({
      where: { chave: d.chave },
    });
    if (antes) {
      if (
        antes.unidadeId !== u ||
        antes.origemId !== d.origemId ||
        antes.destinoId !== d.destinoId ||
        centavos(antes.valor) !== centavos(d.valor) ||
        antes.data.toISOString().slice(0, 10) !== d.data
      )
        throw new Error("Chave já utilizada com outros dados.");
      return { id: antes.id };
    }
    const o = await conta(tx, u, d.origemId),
      dest = await conta(tx, u, d.destinoId);
    if (!o.empresaId || !dest.empresaId)
      throw new Error("Vincule as contas aos respectivos CNPJs primeiro.");
    const salvo = await tx.transferenciaInterna.create({
      data: {
        ...d,
        ...escopo(ctx, u),
        data: dataBancaria(d.data),
        criadoPorId: ctx.usuario.id,
      },
    });
    await auditar(tx, ctx, "TransferenciaInterna", salvo.id, null, salvo);
    return { id: salvo.id };
  });
}

export async function obterIntegracaoInter(ctx: ContextoSessao, id: string) {
  exigirDiretor(ctx);
  return transacaoFinanceira(ctx, "financeiro.ver", async (tx, u) => {
    const i = await tx.integracaoInter.findFirst({
      where: { id, ...escopo(ctx, u), ativa: true },
      include: { empresa: true, conta: true },
    });
    if (!i || !i.empresa.ativa || !i.conta.ativa || !cnpjValido(i.empresa.cnpj))
      throw new Error("Integração inativa, não encontrada ou sem CNPJ válido.");
    return i;
  });
}
export async function registrarEstadoInter(
  ctx: ContextoSessao,
  id: string,
  erro: string | null,
) {
  exigirDiretor(ctx);
  return transacaoFinanceira(ctx, "financeiro.ver", async (tx, u) => {
    const i = await tx.integracaoInter.findFirst({
      where: { id, ...escopo(ctx, u) },
    });
    if (!i) throw new Error("Integração não encontrada.");
    await tx.integracaoInter.update({
      where: { id },
      data: {
        ultimoErro: erro,
        ...(!erro ? { ultimaSincronizacao: new Date() } : {}),
      },
    });
    await auditar(
      tx,
      ctx,
      "IntegracaoInter",
      id,
      { ultimaSincronizacao: i.ultimaSincronizacao, ultimoErro: i.ultimoErro },
      { erro, sucesso: !erro },
    );
  });
}

async function candidatos(
  tx: Tx,
  ctx: ContextoSessao,
  u: string,
  t: TransacaoBancaria,
  empresaId: string,
) {
  const data = dataBancaria(t.data);
  const linhas = await tx.lancamento.findMany({
    where: {
      unidadeId: u,
      empresaId,
      status: "ABERTO",
      ...visivel(ctx),
      vencimento: {
        gte: new Date(data.getTime() - 5 * 86400000),
        lt: new Date(data.getTime() + 6 * 86400000),
      },
    },
    include: incluirLancamento,
  });
  return encontrarCandidatos(
    t,
    linhas.map((l) => ({
      id: l.id,
      empresaId: l.empresaId,
      direcao: l.direcao,
      vencimento: l.vencimento,
      saldo: reais(valorLiquido(l) - pago(l)),
      documento: l.pessoa?.documento ?? l.fornecedor?.documento ?? null,
    })),
    empresaId,
  );
}
export async function processarExtratoInter(
  ctx: ContextoSessao,
  id: string,
  transacoes: TransacaoBancaria[],
) {
  exigirDiretor(ctx);
  const totais = {
    baixadasAutomatico: 0,
    manuaisAmbiguas: 0,
    semCorrespondencia: 0,
    jaConciliadas: 0,
  };
  for (const t of transacoes) {
    const resultado = await transacaoFinanceira(
      ctx,
      "financeiro.quitar",
      async (tx, u) => {
        const i = await tx.integracaoInter.findFirst({
          where: { id, ...escopo(ctx, u), ativa: true },
        });
        if (!i) throw new Error("Integração indisponível.");
        if (
          (await tx.baixaFinanceira.count({
            where: { interTransacaoId: t.id },
          })) ||
          (await tx.pendenciaInter.count({ where: { interTransacaoId: t.id } }))
        )
          return "jaConciliadas" as const;
        const lista = await candidatos(tx, ctx, u, t, i.empresaId);
        if (lista.length === 1) {
          await registrarBaixa(
            tx,
            ctx,
            u,
            {
              lancamentoId: lista[0].id,
              contaId: i.contaId,
              valor: t.valor,
              dataPagamento: t.data,
              tipoPagamento: "OUTRO",
              complemento: t.descricao,
              chave: crypto.randomUUID(),
            },
            t.id,
          );
          return "baixadasAutomatico" as const;
        }
        const p = await tx.pendenciaInter.create({
          data: {
            ...escopo(ctx, u),
            integracaoId: id,
            interTransacaoId: t.id,
            tipo: lista.length ? "ambiguo" : "sem_lancamento",
            data: dataBancaria(t.data),
            direcao: t.direcao,
            valor: t.valor,
            tipoTransacao: t.tipo,
            titulo: t.titulo,
            descricao: t.descricao,
            contraparteNome: t.nome,
            contraparteDocumento: t.documento,
            candidatosIds: lista.map((c) => c.id),
          },
        });
        await auditar(tx, ctx, "PendenciaInter", p.id, null, {
          tipo: p.tipo,
          interTransacaoId: t.id,
        });
        return lista.length
          ? ("manuaisAmbiguas" as const)
          : ("semCorrespondencia" as const);
      },
    );
    totais[resultado]++;
  }
  return totais;
}
export async function resolverPendenciasInter(
  ctx: ContextoSessao,
  entrada: unknown,
) {
  const d = z
    .object({
      ids: z.array(z.string().min(1).max(128)).min(1).max(200),
      acao: z.enum(["vincular", "ignorar", "excluir", "reavaliar"]),
      lancamentoId: z.string().max(128).optional(),
    })
    .parse(entrada);
  if (d.ids.length > 1 || d.acao === "excluir") exigirDiretor(ctx);
  if (d.acao === "vincular" && (d.ids.length !== 1 || !d.lancamentoId))
    throw new Error("Escolha um lançamento para esta transação.");
  return transacaoFinanceira(ctx, "financeiro.quitar", async (tx, u) => {
    let resolvidas = 0;
    for (const id of new Set(d.ids)) {
      const p = await tx.pendenciaInter.findFirst({
        where: { id, ...escopo(ctx, u), status: "pendente" },
        include: { integracao: true },
      });
      if (!p) throw new Error("Pendência não encontrada ou já resolvida.");
      if (d.acao === "ignorar" || d.acao === "excluir") {
        await tx.pendenciaInter.update({
          where: { id },
          data: {
            status: d.acao === "ignorar" ? "ignorado" : "excluido",
            resolvidaEm: new Date(),
            resolvidaPorId: ctx.usuario.id,
          },
        });
        await auditar(
          tx,
          ctx,
          "PendenciaInter",
          id,
          { status: "pendente" },
          { status: d.acao },
        );
        resolvidas++;
        continue;
      }
      const t: TransacaoBancaria = {
        id: p.interTransacaoId,
        data: p.data.toISOString().slice(0, 10),
        valor: String(p.valor),
        direcao: p.direcao,
        tipo: p.tipoTransacao,
        titulo: p.titulo,
        descricao: p.descricao,
        documento: p.contraparteDocumento,
        nome: p.contraparteNome,
      };
      const lista = await candidatos(tx, ctx, u, t, p.integracao.empresaId);
      const escolhido =
        d.acao === "vincular"
          ? d.lancamentoId
          : lista.length === 1
            ? lista[0].id
            : null;
      if (!escolhido) {
        await tx.pendenciaInter.update({
          where: { id },
          data: {
            tipo: lista.length ? "ambiguo" : "sem_lancamento",
            candidatosIds: lista.map((c) => c.id),
          },
        });
        await auditar(
          tx,
          ctx,
          "PendenciaInter",
          id,
          { tipo: p.tipo },
          {
            tipo: lista.length ? "ambiguo" : "sem_lancamento",
            candidatos: lista.map((c) => c.id),
          },
        );
        continue;
      }
      const l = await tx.lancamento.findFirst({
        where: {
          id: escolhido,
          unidadeId: u,
          empresaId: p.integracao.empresaId,
          direcao: p.direcao,
          status: "ABERTO",
          ...visivel(ctx),
        },
      });
      if (!l)
        throw new Error(
          "Escolha um lançamento aberto da mesma empresa e direção.",
        );
      const b = await registrarBaixa(
        tx,
        ctx,
        u,
        {
          lancamentoId: escolhido,
          contaId: p.integracao.contaId,
          valor: String(p.valor),
          dataPagamento: t.data,
          tipoPagamento: "OUTRO",
          complemento: p.descricao,
          chave: crypto.randomUUID(),
        },
        p.interTransacaoId,
      );
      await tx.pendenciaInter.update({
        where: { id },
        data: {
          status: "resolvido",
          resolvidaEm: new Date(),
          resolvidaPorId: ctx.usuario.id,
          baixaId: b.id,
        },
      });
      await auditar(
        tx,
        ctx,
        "PendenciaInter",
        id,
        { status: "pendente" },
        { status: "resolvido", baixaId: b.id },
      );
      resolvidas++;
    }
    return { resolvidas };
  });
}
