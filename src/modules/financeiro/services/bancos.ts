import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";

import { pode, type ContextoSessao } from "@/core/sessao/nucleo";
import { ExigeUnidade, SemPermissao } from "@/lib/erros";
import { db } from "@/server/db";
import {
  centavos,
  reais,
  dataBancaria,
  diaNoFuso,
  inicioNoFuso,
  esquemaContaBancaria,
  esquemaEmpresaBancaria,
  esquemaTransferencia,
  validarParTransferencia,
  identidadeBancaria,
} from "../schemas/bancos";

type Cliente = Prisma.TransactionClient;

async function escopo(ctx: ContextoSessao, editar = false, tx: Cliente = db) {
  if (!pode(ctx, editar ? "financeiro.lancar" : "financeiro.ver"))
    throw new SemPermissao(
      editar ? "alterar contas bancárias" : "ver o financeiro",
    );
  if (!ctx.unidadeAtiva) throw new ExigeUnidade();
  if (!ctx.unidadesVisiveis.some((u) => u.id === ctx.unidadeAtiva!.id))
    throw new SemPermissao("acessar esta unidade");
  const unidade = await tx.unidade.findFirst({
    where: {
      id: ctx.unidadeAtiva.id,
      organizacaoId: ctx.organizacao.id,
      ativa: true,
      excluidoEm: null,
      organizacao: { ativa: true, excluidoEm: null },
    },
    select: { id: true, fusoHorario: true },
  });
  if (!unidade) throw new SemPermissao("acessar esta unidade");
  if (tx !== db)
    await tx.$queryRaw`SELECT set_config('tetteo.financeiro_organizacao', ${ctx.organizacao.id}, true), set_config('tetteo.financeiro_unidade', ${unidade.id}, true)`;
  return unidade;
}

async function transacao<T>(
  operacao: (tx: Cliente) => Promise<T>,
  repetirDuplicidade = false,
): Promise<T> {
  for (let tentativa = 0; ; tentativa++) {
    try {
      return await db.$transaction(operacao, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (erro) {
      if (
        tentativa < 3 &&
        erro instanceof Prisma.PrismaClientKnownRequestError &&
        (erro.code === "P2034" || (repetirDuplicidade && erro.code === "P2002"))
      )
        continue;
      throw erro;
    }
  }
}

async function auditar(
  tx: Cliente,
  ctx: ContextoSessao,
  entidade: string,
  id: string,
  antes: unknown,
  depois: unknown,
) {
  const json = (valor: unknown) =>
    JSON.parse(
      JSON.stringify(valor, (_chave, v) =>
        typeof v === "bigint" ? v.toString() : v,
      ),
    );
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

export async function listarEmpresasBancarias(ctx: ContextoSessao) {
  const unidade = await escopo(ctx);
  return db.empresaFinanceira.findMany({
    where: { unidadeId: unidade.id, organizacaoId: ctx.organizacao.id },
    orderBy: { nome: "asc" },
  });
}

export async function criarEmpresaBancaria(
  ctx: ContextoSessao,
  entrada: unknown,
) {
  const dados = esquemaEmpresaBancaria.parse(entrada);
  return transacao(async (tx) => {
    const unidade = await escopo(ctx, true, tx);
    const empresa = await tx.empresaFinanceira.create({
      data: {
        ...dados,
        unidadeId: unidade.id,
        organizacaoId: ctx.organizacao.id,
      },
    });
    await tx.categoriaFinanceira.createMany({
      data: [
        {
          organizacaoId: ctx.organizacao.id,
          nome: `Repasse à outra empresa · ${empresa.cnpj}`,
          tipo: "DESPESA",
          grupo: "Repasses",
          grupoDre: null,
          entraDre: false,
          ehSistema: true,
        },
        {
          organizacaoId: ctx.organizacao.id,
          nome: `Repasse da outra empresa · ${empresa.cnpj}`,
          tipo: "RECEITA",
          grupo: "Repasses",
          grupoDre: null,
          entraDre: false,
          ehSistema: true,
        },
      ],
      skipDuplicates: true,
    });
    const compensacao = await tx.contaFinanceira.create({
      data: {
        unidadeId: unidade.id,
        empresaId: empresa.id,
        nome: "Compensação",
        tipo: "BANCO",
        modalidade: "OUTRO",
        titularidade: "PJ",
        nomeTitular: empresa.razaoSocial,
        compensacao: true,
        corteAplicado: true,
        saldoInicialCentavos: 0n,
        iniciadaEm: inicioNoFuso(
          diaNoFuso(new Date(), unidade.fusoHorario),
          unidade.fusoHorario,
        ),
      },
    });
    await auditar(
      tx,
      ctx,
      "ContaFinanceira",
      compensacao.id,
      null,
      compensacao,
    );
    await auditar(tx, ctx, "EmpresaFinanceira", empresa.id, null, empresa);
    return empresa;
  });
}

export function assinaturaEmpresa(empresa: {
  nome: string;
  razaoSocial: string;
  cnpj: string;
  regime: string;
  emiteNota: boolean;
  ativa: boolean;
}) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        empresa.nome,
        empresa.razaoSocial,
        empresa.cnpj,
        empresa.regime,
        empresa.emiteNota,
        empresa.ativa,
      ]),
    )
    .digest("hex");
}

export async function editarEmpresaBancaria(
  ctx: ContextoSessao,
  id: string,
  entrada: unknown,
  assinatura: string,
) {
  const dados = esquemaEmpresaBancaria.parse(entrada);
  return transacao(async (tx) => {
    const unidade = await escopo(ctx, true, tx);
    const antes = await tx.empresaFinanceira.findFirst({
      where: { id, unidadeId: unidade.id, organizacaoId: ctx.organizacao.id },
    });
    if (!antes) throw new Error("Empresa não encontrada.");
    if (assinaturaEmpresa(antes) !== assinatura)
      throw new Error(
        "A empresa mudou enquanto você editava. Atualize a página.",
      );
    if (dados.cnpj !== antes.cnpj)
      throw new Error(
        "O CNPJ identifica o histórico e não pode ser alterado. Desative o cadastro incorreto e cadastre a empresa correta.",
      );
    const empresa = await tx.empresaFinanceira.update({
      where: { id },
      data: dados,
    });
    await auditar(tx, ctx, "EmpresaFinanceira", id, antes, empresa);
    return empresa;
  });
}

export async function salvarContaBancaria(
  ctx: ContextoSessao,
  id: string | null,
  entrada: unknown,
  versao = 0,
) {
  const dados = esquemaContaBancaria.parse(entrada);
  return transacao(async (tx) => {
    const unidade = await escopo(ctx, true, tx);
    const empresa = await tx.empresaFinanceira.findFirst({
      where: {
        id: dados.empresaId,
        unidadeId: unidade.id,
        organizacaoId: ctx.organizacao.id,
        ativa: true,
      },
    });
    if (!empresa) throw new Error("Empresa não encontrada ou inativa.");
    const hoje = diaNoFuso(new Date(), unidade.fusoHorario);
    if (dados.dataInicial > hoje)
      throw new Error("A data inicial não pode estar no futuro.");
    const identidade =
      dados.modalidade === "DINHEIRO" || dados.compensacao
        ? null
        : identidadeBancaria(dados.banco, dados.agencia, dados.numero);
    const gravar = {
      nome: dados.nome,
      empresaId: dados.empresaId,
      modalidade: dados.modalidade,
      tipo:
        dados.modalidade === "DINHEIRO"
          ? ("CAIXA" as const)
          : ("BANCO" as const),
      banco: dados.banco || null,
      agencia: dados.agencia || null,
      numero: dados.numero || null,
      identidade,
      titularidade: dados.titularidade,
      nomeTitular: dados.nomeTitular,
      cor: dados.cor.toLowerCase(),
      compensacao: dados.compensacao,
      ativa: dados.ativa,
      saldoInicial: dados.saldoInicial,
      saldoInicialCentavos: centavos(dados.saldoInicial),
      iniciadaEm: inicioNoFuso(dados.dataInicial, unidade.fusoHorario),
    };
    if (!id) {
      const conta = await tx.contaFinanceira.create({
        data: { unidadeId: unidade.id, ...gravar, corteAplicado: true },
      });
      await auditar(tx, ctx, "ContaFinanceira", conta.id, null, conta);
      return conta;
    }
    const antes = await tx.contaFinanceira.findFirst({
      where: { id, unidadeId: unidade.id },
    });
    if (!antes) throw new Error("Conta não encontrada.");
    if (antes.versao !== versao)
      throw new Error(
        "A conta mudou enquanto você editava. Atualize a página.",
      );
    const movimentos =
      (await tx.lancamento.count({ where: { contaId: id } })) +
      (await tx.baixaFinanceira.count({ where: { contaId: id } })) +
      (await tx.integracaoInter.count({ where: { contaId: id } })) +
      (await tx.transferenciaInterna.count({
        where: { OR: [{ origemId: id }, { destinoId: id }] },
      })) +
      (await tx.transferenciaFinanceira.count({
        where: { OR: [{ origemId: id }, { destinoId: id }] },
      }));
    if (movimentos > 0) {
      if (
        !antes.corteAplicado &&
        dados.dataInicial === diaNoFuso(antes.iniciadaEm, unidade.fusoHorario)
      )
        gravar.iniciadaEm = antes.iniciadaEm;
      // Uma conta antiga pode ganhar seu vínculo explícito sem reescrever o saldo histórico.
      const chaves = [
        "empresaId",
        "modalidade",
        "tipo",
        "banco",
        "agencia",
        "numero",
        "titularidade",
        "nomeTitular",
        "compensacao",
      ] as const;
      if (
        chaves.some((k) => antes[k] !== null && antes[k] !== gravar[k]) ||
        centavos(antes.saldoInicial) !== centavos(gravar.saldoInicial) ||
        antes.iniciadaEm.getTime() !== gravar.iniciadaEm.getTime()
      ) {
        throw new Error(
          "Conta com movimentos: preserve CNPJ, titular, dados bancários, saldo e data iniciais. Nome, cor e situação podem mudar.",
        );
      }
    }
    const conta = await tx.contaFinanceira.update({
      where: { id, versao },
      data: { ...gravar, versao: { increment: 1 } },
    });
    await auditar(tx, ctx, "ContaFinanceira", conta.id, antes, conta);
    return conta;
  });
}

export async function transferirEntreContas(
  ctx: ContextoSessao,
  entrada: unknown,
) {
  const dados = esquemaTransferencia.parse(entrada);
  return transacao((tx) => gravarTransferencia(tx, ctx, dados), true);
}

type Movimento = {
  origemId: string;
  destinoId: string;
  valor: string;
  data: string;
  descricao: string;
  chave: string;
};

async function gravarTransferencia(
  tx: Cliente,
  ctx: ContextoSessao,
  dados: Movimento,
  estornoDeId?: string,
) {
  const unidade = await escopo(ctx, true, tx);
  if (!pode(ctx, "financeiro.quitar"))
    throw new SemPermissao("movimentar contas bancárias");
  const assinatura = createHash("sha256")
    .update(
      JSON.stringify({
        ...dados,
        ator: ctx.usuario.id,
        unidade: unidade.id,
        estornoDeId,
      }),
    )
    .digest("hex");
  const anterior = await tx.transferenciaFinanceira.findUnique({
    where: { unidadeId_chave: { unidadeId: unidade.id, chave: dados.chave } },
  });
  if (anterior) {
    if (anterior.assinatura !== assinatura)
      throw new Error(
        "Esta solicitação já foi usada com outros dados. Reabra o formulário.",
      );
    return anterior;
  }
  const contas = await tx.contaFinanceira.findMany({
    where: {
      unidadeId: unidade.id,
      id: { in: [dados.origemId, dados.destinoId] },
    },
    include: { empresa: true },
  });
  const origem = contas.find((c) => c.id === dados.origemId);
  const destino = contas.find((c) => c.id === dados.destinoId);
  const paraValidar = (c: typeof origem) =>
    c
      ? {
          id: c.id,
          empresaId: c.empresaId,
          ativa: c.ativa,
          dataInicial: diaNoFuso(c.iniciadaEm, unidade.fusoHorario),
          empresaAtiva: Boolean(c.empresa?.ativa),
        }
      : undefined;
  validarParTransferencia(
    paraValidar(origem),
    paraValidar(destino),
    dados.data,
    diaNoFuso(new Date(), unidade.fusoHorario),
    Boolean(estornoDeId),
  );
  if (!origem || !destino || origem.id === destino.id)
    throw new Error("Escolha duas contas desta unidade.");
  if (!origem.empresaId) throw new Error("Vincule a conta a um CNPJ.");
  const movimento = await tx.transferenciaFinanceira.create({
    data: {
      unidadeId: unidade.id,
      empresaId: origem.empresaId,
      origemId: origem.id,
      destinoId: destino.id,
      valorCentavos: centavos(dados.valor),
      data: dataBancaria(dados.data),
      descricao: dados.descricao,
      criadoPorId: ctx.usuario.id,
      chave: dados.chave,
      assinatura,
      estornoDeId,
    },
  });
  await auditar(
    tx,
    ctx,
    "TransferenciaFinanceira",
    movimento.id,
    null,
    movimento,
  );
  return movimento;
}

export async function estornarTransferencia(
  ctx: ContextoSessao,
  id: string,
  data: string,
  motivo: string,
  chave: string,
) {
  dataBancaria(data);
  if (
    motivo.trim().length < 3 ||
    motivo.length > 160 ||
    !/^[0-9a-f-]{36}$/i.test(chave)
  )
    throw new Error(
      "Informe a data e o motivo do estorno e reabra o formulário se necessário.",
    );
  return transacao(async (tx) => {
    const unidade = await escopo(ctx, true, tx);
    const original = await tx.transferenciaFinanceira.findFirst({
      where: { id, unidadeId: unidade.id },
      include: { estorno: true },
    });
    if (!original || original.estornoDeId)
      throw new Error("Transferência original não encontrada.");
    if (data < original.data.toISOString().slice(0, 10))
      throw new Error("O estorno não pode anteceder a transferência.");
    const dados = {
      origemId: original.destinoId,
      destinoId: original.origemId,
      valor: reais(original.valorCentavos),
      data,
      descricao: `Estorno: ${motivo.trim()}`,
      chave,
    };
    // A mesma chave pode repetir; outra tentativa não produz um segundo estorno.
    if (original.estorno && original.estorno.chave !== chave)
      throw new Error("Esta transferência já foi estornada.");
    return gravarTransferencia(tx, ctx, dados, original.id);
  }, true);
}

/** Saldos por conta, incluindo baixas existentes e as duas pernas das transferências. */
async function saldos(tx: Cliente, unidadeId: string, ate: Date) {
  const contas = await tx.contaFinanceira.findMany({
    where: { unidadeId },
    include: { empresa: { select: { nome: true, cnpj: true, ativa: true } } },
    orderBy: [{ ativa: "desc" }, { nome: "asc" }],
  });
  if (!contas.length) return [];
  const pagamentos = await tx.lancamento.groupBy({
    by: ["contaId", "direcao"],
    where: {
      unidadeId,
      status: "QUITADO",
      canceladoEm: null,
      quitadoEm: { lte: ate },
      OR: contas.map((c) => ({
        contaId: c.id,
        ...(c.corteAplicado
          ? { quitadoEm: { gte: c.iniciadaEm, lte: ate } }
          : {}),
      })),
    },
    _sum: { valorQuitado: true },
  });
  const fuso = (
    await tx.unidade.findUniqueOrThrow({
      where: { id: unidadeId },
      select: { fusoHorario: true },
    })
  ).fusoHorario;
  const dia = dataBancaria(diaNoFuso(ate, fuso));
  const transferencias = await tx.transferenciaFinanceira.groupBy({
    by: ["origemId", "destinoId"],
    where: { unidadeId, data: { lte: dia } },
    _sum: { valorCentavos: true },
  });
  return contas.map((c) => {
    let saldo =
      c.iniciadaEm <= ate || !c.corteAplicado
        ? (c.saldoInicialCentavos ?? centavos(c.saldoInicial))
        : 0n;
    for (const p of pagamentos)
      if (p.contaId === c.id)
        saldo +=
          centavos(p._sum.valorQuitado ?? 0) *
          (p.direcao === "RECEBER" ? 1n : -1n);
    for (const t of transferencias) {
      if (t.origemId === c.id) saldo -= t._sum.valorCentavos ?? 0n;
      if (t.destinoId === c.id) saldo += t._sum.valorCentavos ?? 0n;
    }
    const inicial = c.saldoInicialCentavos ?? centavos(c.saldoInicial);
    return {
      ...c,
      saldoInicial: reais(inicial),
      saldoInicialCentavos: inicial.toString(),
      saldo: reais(saldo),
    };
  });
}

export async function listarSaldosBancarios(
  ctx: ContextoSessao,
  ate = new Date(),
) {
  return db.$transaction(
    async (tx) => {
      const unidade = await escopo(ctx, false, tx);
      return saldos(tx, unidade.id, ate);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

export async function extratoBancario(
  ctx: ContextoSessao,
  contaId: string,
  de: string,
  ate: string,
) {
  const inicio = dataBancaria(de),
    fim = dataBancaria(ate);
  if (fim < inicio || fim.getTime() - inicio.getTime() > 365 * 86400000)
    throw new Error("Escolha um período de até 366 dias.");
  return db.$transaction(
    async (tx) => {
      const unidade = await escopo(ctx, false, tx);
      const conta = await tx.contaFinanceira.findFirst({
        where: { id: contaId, unidadeId: unidade.id },
        include: { empresa: true },
      });
      if (!conta) throw new Error("Conta não encontrada.");
      const limiteInicial = inicioNoFuso(de, unidade.fusoHorario);
      const proximoDia = new Date(fim.getTime() + 86400000)
        .toISOString()
        .slice(0, 10);
      const limiteFinal = inicioNoFuso(proximoDia, unidade.fusoHorario);
      const saldoAntes = (
        await saldos(tx, unidade.id, new Date(limiteInicial.getTime() - 1))
      ).find((c) => c.id === conta.id)!.saldo;
      const pagamentos = await tx.lancamento.findMany({
        where: {
          unidadeId: unidade.id,
          contaId,
          status: "QUITADO",
          canceladoEm: null,
          quitadoEm: {
            gte:
              conta.corteAplicado && conta.iniciadaEm > limiteInicial
                ? conta.iniciadaEm
                : limiteInicial,
            lt: limiteFinal,
          },
        },
        take: 1001,
        orderBy: [{ quitadoEm: "asc" }, { id: "asc" }],
      });
      const transferencias = await tx.transferenciaFinanceira.findMany({
        where: {
          unidadeId: unidade.id,
          OR: [{ origemId: contaId }, { destinoId: contaId }],
          data: { gte: inicio, lte: fim },
        },
        include: {
          origem: { select: { nome: true } },
          destino: { select: { nome: true } },
          estorno: { select: { id: true } },
        },
        take: 1001,
        orderBy: [{ data: "asc" }, { criadoEm: "asc" }, { id: "asc" }],
      });
      if (pagamentos.length + transferencias.length > 1000)
        throw new Error(
          "Mais de 1.000 movimentos. Reduza o período para ver o extrato completo.",
        );
      const linhas = [
        ...pagamentos.map((p) => ({
          id: p.id,
          dia: diaNoFuso(p.quitadoEm!, unidade.fusoHorario),
          descricao: p.descricao,
          tipo: p.direcao === "PAGAR" ? "Pagamento" : "Recebimento",
          valor: reais(
            centavos(p.valorQuitado ?? 0) *
              (p.direcao === "RECEBER" ? 1n : -1n),
          ),
          transferenciaId: null as string | null,
          estornavel: false,
          ordem: p.quitadoEm!.getTime(),
        })),
        ...transferencias.map((t) => ({
          id: t.id,
          dia: t.data.toISOString().slice(0, 10),
          descricao: `${t.descricao} · ${t.origemId === contaId ? "para " + t.destino.nome : "de " + t.origem.nome}`,
          tipo: t.estornoDeId ? "Estorno" : "Transferência",
          valor: reais(t.valorCentavos * (t.origemId === contaId ? -1n : 1n)),
          transferenciaId: t.id,
          estornavel: !t.estorno && !t.estornoDeId,
          ordem: t.criadoEm.getTime(),
        })),
      ].sort(
        (a, b) =>
          a.dia.localeCompare(b.dia) ||
          a.ordem - b.ordem ||
          a.id.localeCompare(b.id),
      );
      let saldo = centavos(saldoAntes);
      const movimentos = linhas.map((l) => {
        saldo += centavos(l.valor);
        return { ...l, saldo: reais(saldo) };
      });
      const dias: { dia: string; saldo: string }[] = [];
      for (const l of movimentos) {
        const anterior = dias.at(-1);
        if (anterior?.dia === l.dia) anterior.saldo = l.saldo;
        else dias.push({ dia: l.dia, saldo: l.saldo });
      }
      if (
        conta.corteAplicado &&
        de <= diaNoFuso(conta.iniciadaEm, unidade.fusoHorario) &&
        ate >= diaNoFuso(conta.iniciadaEm, unidade.fusoHorario)
      ) {
        // O corte precisa aparecer no extrato quando o período inclui a implantação.
        const diaInicial = diaNoFuso(conta.iniciadaEm, unidade.fusoHorario);
        movimentos.push({
          id: "saldo-inicial",
          dia: diaInicial,
          descricao: "Saldo de abertura",
          tipo: "Abertura",
          valor: reais(
            conta.saldoInicialCentavos ?? centavos(conta.saldoInicial),
          ),
          transferenciaId: null,
          estornavel: false,
          ordem: -1,
          saldo: "",
        });
        movimentos.sort(
          (a, b) =>
            a.dia.localeCompare(b.dia) ||
            a.ordem - b.ordem ||
            a.id.localeCompare(b.id),
        );
        saldo = centavos(saldoAntes);
        dias.length = 0;
        for (const l of movimentos) {
          saldo += centavos(l.valor);
          l.saldo = reais(saldo);
          const anterior = dias.at(-1);
          if (anterior?.dia === l.dia) anterior.saldo = l.saldo;
          else dias.push({ dia: l.dia, saldo: l.saldo });
        }
      }
      return {
        conta: {
          nome: conta.nome,
          empresa: conta.empresa?.nome ?? null,
          dataInicial: diaNoFuso(conta.iniciadaEm, unidade.fusoHorario),
        },
        de,
        ate,
        saldoAnterior: saldoAntes,
        saldoFinal: reais(saldo),
        movimentos,
        dias,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
