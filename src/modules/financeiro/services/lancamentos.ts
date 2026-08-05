import { pode, type ContextoSessao } from "@/core/sessao/contexto";
import { ExigeUnidade, SemPermissao } from "@/lib/erros";
import { db } from "@/server/db";

import {
  calcularResultado,
  dividirEmParcelas,
  projetarSaldo,
  resumirFluxo,
  vencimentosMensais,
  type LancamentoParaFluxo,
} from "../schemas/dinheiro";
import type { DadosLancamento } from "../schemas/entradas";

/**
 * OS LANÇAMENTOS.
 *
 * As contas do dia 5. A conta mora em `schemas/dinheiro`, pura e testada;
 * aqui só busca, grava e traduz Decimal em número.
 */

/** Caixa é físico: a gaveta fica num endereço, o boleto vence num CNPJ. */
export function exigirUnidade(contexto: ContextoSessao) {
  if (!contexto.unidadeAtiva) throw new ExigeUnidade();
  return contexto.unidadeAtiva;
}

export type LancamentoNaLista = {
  id: string;
  direcao: "PAGAR" | "RECEBER";
  status: "ABERTO" | "QUITADO" | "CANCELADO";
  descricao: string;
  valor: number;
  vencimento: Date;
  quitadoEm: Date | null;
  valorQuitado: number | null;
  categoria: { id: string; nome: string } | null;
  fornecedor: { id: string; nome: string } | null;
  conta: { id: string; nome: string } | null;
  parcela: number | null;
  totalParcelas: number | null;
  daNota: boolean;
  atrasado: boolean;
};

function soData(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export async function listarLancamentos(
  contexto: ContextoSessao,
  filtro: {
    direcao?: "PAGAR" | "RECEBER";
    status?: "ABERTO" | "QUITADO";
    de?: Date;
    ate?: Date;
  } = {},
): Promise<LancamentoNaLista[]> {
  if (!pode(contexto, "financeiro.ver")) {
    throw new SemPermissao("ver o financeiro");
  }
  const unidade = exigirUnidade(contexto);

  const linhas = await db.lancamento.findMany({
    where: {
      unidadeId: unidade.id,
      canceladoEm: null,
      ...(filtro.direcao ? { direcao: filtro.direcao } : {}),
      ...(filtro.status ? { status: filtro.status } : {}),
      ...(filtro.de || filtro.ate
        ? {
            vencimento: {
              ...(filtro.de ? { gte: filtro.de } : {}),
              ...(filtro.ate ? { lte: filtro.ate } : {}),
            },
          }
        : {}),
    },
    include: {
      categoria: { select: { id: true, nome: true } },
      fornecedor: { select: { id: true, nome: true } },
      conta: { select: { id: true, nome: true } },
    },
    orderBy: [{ status: "asc" }, { vencimento: "asc" }],
    take: 300,
  });

  const hoje = soData(new Date());

  return linhas.map((l) => ({
    id: l.id,
    direcao: l.direcao,
    status: l.status,
    descricao: l.descricao,
    valor: Number(l.valor),
    vencimento: l.vencimento,
    quitadoEm: l.quitadoEm,
    valorQuitado: l.valorQuitado === null ? null : Number(l.valorQuitado),
    categoria: l.categoria,
    fornecedor: l.fornecedor,
    conta: l.conta,
    parcela: l.parcela,
    totalParcelas: l.totalParcelas,
    daNota: l.notaEntradaId !== null,
    atrasado: l.status === "ABERTO" && soData(l.vencimento) < hoje,
  }));
}

/**
 * Cria o lançamento — ou a série inteira, quando é parcelado.
 *
 * O valor informado é o TOTAL, e ele é dividido em centavos exatos. Pedir o
 * valor da parcela obrigaria a pessoa a fazer a divisão de cabeça, e é aí que
 * o centavo se perde.
 */
export async function criarLancamento(
  contexto: ContextoSessao,
  dados: DadosLancamento,
) {
  if (!pode(contexto, "financeiro.lancar")) {
    throw new SemPermissao("cadastrar contas");
  }
  const unidade = exigirUnidade(contexto);

  const valores = dividirEmParcelas(dados.valor, dados.parcelas);
  const datas = vencimentosMensais(dados.vencimento, dados.parcelas);
  const grupo = dados.parcelas > 1 ? crypto.randomUUID() : null;

  await db.lancamento.createMany({
    data: valores.map((valor, i) => ({
      unidadeId: unidade.id,
      direcao: dados.direcao,
      descricao:
        dados.parcelas > 1
          ? `${dados.descricao} ${i + 1}/${dados.parcelas}`
          : dados.descricao,
      valor,
      vencimento: datas[i],
      categoriaId: dados.categoriaId,
      fornecedorId: dados.fornecedorId,
      contaId: dados.contaId,
      observacao: dados.observacao,
      grupoParcelas: grupo,
      parcela: dados.parcelas > 1 ? i + 1 : null,
      totalParcelas: dados.parcelas > 1 ? dados.parcelas : null,
      criadoPorId: contexto.usuario.id,
    })),
  });

  await registrar(contexto, "CRIOU", grupo ?? dados.descricao, null, {
    descricao: dados.descricao,
    valor: dados.valor,
    parcelas: dados.parcelas,
  });

  return valores.length;
}

export async function quitarLancamento(
  contexto: ContextoSessao,
  id: string,
  dados: { valorQuitado: number; quitadoEm: Date; contaId: string | null },
) {
  if (!pode(contexto, "financeiro.quitar")) {
    throw new SemPermissao("dar baixa em contas");
  }
  const unidade = exigirUnidade(contexto);

  const lancamento = await db.lancamento.findFirst({
    where: { id, unidadeId: unidade.id, canceladoEm: null },
    select: { id: true, status: true, valor: true, descricao: true },
  });
  if (!lancamento) throw new Error("Lançamento não encontrado.");
  if (lancamento.status === "QUITADO") {
    throw new Error("Esta conta já foi quitada.");
  }

  await db.lancamento.update({
    where: { id },
    data: {
      status: "QUITADO",
      valorQuitado: dados.valorQuitado,
      quitadoEm: dados.quitadoEm,
      contaId: dados.contaId ?? undefined,
      quitadoPorId: contexto.usuario.id,
    },
  });

  await registrar(
    contexto,
    "ALTEROU",
    id,
    { status: "ABERTO", valor: Number(lancamento.valor) },
    { status: "QUITADO", valorQuitado: dados.valorQuitado },
  );
}

/**
 * Desfaz a baixa.
 *
 * Existe porque errar a linha é banal — vinte boletos parecidos, um clique na
 * errada. Sem desfazer, o conserto seria criar um lançamento negativo, que
 * suja o resultado para sempre.
 */
export async function estornarLancamento(contexto: ContextoSessao, id: string) {
  if (!pode(contexto, "financeiro.quitar")) {
    throw new SemPermissao("estornar contas");
  }
  const unidade = exigirUnidade(contexto);

  const lancamento = await db.lancamento.findFirst({
    where: { id, unidadeId: unidade.id, status: "QUITADO" },
    select: { id: true, valorQuitado: true },
  });
  if (!lancamento) throw new Error("Lançamento não encontrado ou não quitado.");

  await db.lancamento.update({
    where: { id },
    data: {
      status: "ABERTO",
      valorQuitado: null,
      quitadoEm: null,
      quitadoPorId: null,
    },
  });

  await registrar(
    contexto,
    "ALTEROU",
    id,
    { status: "QUITADO", valorQuitado: Number(lancamento.valorQuitado ?? 0) },
    { status: "ABERTO" },
  );
}

export async function cancelarLancamento(
  contexto: ContextoSessao,
  id: string,
  futurasTambem = false,
) {
  if (!pode(contexto, "financeiro.lancar")) {
    throw new SemPermissao("cancelar contas");
  }
  const unidade = exigirUnidade(contexto);

  const lancamento = await db.lancamento.findFirst({
    where: { id, unidadeId: unidade.id, canceladoEm: null },
    select: { id: true, status: true, grupoParcelas: true, parcela: true },
  });
  if (!lancamento) throw new Error("Lançamento não encontrado.");
  if (lancamento.status === "QUITADO") {
    throw new Error("Conta quitada não se cancela — estorne primeiro.");
  }

  const agora = new Date();

  // Cancelar as futuras de uma vez é o gesto de "o contrato acabou". Sem isso,
  // encerrar um aluguel de 12 parcelas seriam doze cliques.
  if (futurasTambem && lancamento.grupoParcelas && lancamento.parcela) {
    await db.lancamento.updateMany({
      where: {
        unidadeId: unidade.id,
        grupoParcelas: lancamento.grupoParcelas,
        parcela: { gte: lancamento.parcela },
        status: "ABERTO",
      },
      data: { status: "CANCELADO", canceladoEm: agora },
    });
  } else {
    await db.lancamento.update({
      where: { id },
      data: { status: "CANCELADO", canceladoEm: agora },
    });
  }

  await registrar(contexto, "EXCLUIU", id, { status: "ABERTO" }, null);
}

// ---------------------------------------------------------------------------
// AS TELAS DE LEITURA
// ---------------------------------------------------------------------------

export async function visaoDoCaixa(contexto: ContextoSessao, dias = 30) {
  if (!pode(contexto, "financeiro.ver")) {
    throw new SemPermissao("ver o financeiro");
  }
  const unidade = exigirUnidade(contexto);

  const [abertos, contas, quitados] = await Promise.all([
    db.lancamento.findMany({
      where: { unidadeId: unidade.id, status: "ABERTO", canceladoEm: null },
      select: {
        id: true,
        direcao: true,
        status: true,
        valor: true,
        vencimento: true,
        quitadoEm: true,
        valorQuitado: true,
      },
    }),
    db.contaFinanceira.findMany({
      where: { unidadeId: unidade.id, ativa: true },
      select: { id: true, nome: true, tipo: true, saldoInicial: true },
    }),
    // O saldo real é o inicial mais tudo que já foi quitado. Projetar a partir
    // de zero mostraria um caixa negativo desde o primeiro dia de uso.
    db.lancamento.groupBy({
      by: ["direcao"],
      where: { unidadeId: unidade.id, status: "QUITADO" },
      _sum: { valorQuitado: true },
    }),
  ]);

  const saldoInicial = contas.reduce((s, c) => s + Number(c.saldoInicial), 0);
  const entrou = Number(
    quitados.find((q) => q.direcao === "RECEBER")?._sum.valorQuitado ?? 0,
  );
  const saiu = Number(
    quitados.find((q) => q.direcao === "PAGAR")?._sum.valorQuitado ?? 0,
  );
  const saldoAtual = Math.round((saldoInicial + entrou - saiu) * 100) / 100;

  const paraFluxo: LancamentoParaFluxo[] = abertos.map((l) => ({
    id: l.id,
    direcao: l.direcao,
    status: l.status,
    valor: Number(l.valor),
    vencimento: l.vencimento,
    quitadoEm: l.quitadoEm,
    valorQuitado: l.valorQuitado === null ? null : Number(l.valorQuitado),
  }));

  const hoje = new Date();

  return {
    saldoAtual,
    contas: contas.map((c) => ({
      id: c.id,
      nome: c.nome,
      tipo: c.tipo,
      saldoInicial: Number(c.saldoInicial),
    })),
    resumo: resumirFluxo(paraFluxo, hoje),
    projecao: projetarSaldo(saldoAtual, paraFluxo, hoje, dias),
  };
}

export async function resultadoDoPeriodo(
  contexto: ContextoSessao,
  de: Date,
  ate: Date,
) {
  if (!pode(contexto, "financeiro.resultado")) {
    throw new SemPermissao("ver o resultado");
  }
  const unidade = exigirUnidade(contexto);

  const quitados = await db.lancamento.findMany({
    where: {
      unidadeId: unidade.id,
      status: "QUITADO",
      quitadoEm: { gte: de, lte: ate },
    },
    select: {
      direcao: true,
      valor: true,
      valorQuitado: true,
      categoria: { select: { nome: true, grupo: true } },
    },
  });

  return calcularResultado(
    quitados.map((l) => ({
      direcao: l.direcao,
      valor: Number(l.valor),
      valorQuitado: l.valorQuitado === null ? null : Number(l.valorQuitado),
      categoria: l.categoria,
    })),
  );
}

async function registrar(
  contexto: ContextoSessao,
  acao: "CRIOU" | "ALTEROU" | "EXCLUIU",
  entidadeId: string,
  antes: unknown,
  depois: unknown,
) {
  await db.auditoria.create({
    data: {
      organizacaoId: contexto.organizacao.id,
      unidadeId: contexto.unidadeAtiva?.id ?? null,
      usuarioId: contexto.usuario.id,
      entidade: "Lancamento",
      entidadeId,
      acao,
      valoresAntes:
        antes === null ? undefined : JSON.parse(JSON.stringify(antes)),
      valoresDepois:
        depois === null ? undefined : JSON.parse(JSON.stringify(depois)),
    },
  });
}

/**
 * Os movimentos do período para o DRE.
 *
 * A BASE é uma escolha, e ela muda o número:
 *
 *   competência  pela data de VENCIMENTO — o mês a que a conta pertence.
 *                É o DRE de verdade, e é o que se compara com o mercado.
 *                Aproximação honesta: o aluguel que vence dia 5 é do mês, mas
 *                a luz que vence dia 10 é do consumo do mês anterior. Para uma
 *                pizzaria a diferença é pequena e o ganho de leitura é grande.
 *
 *   caixa        pela data de PAGAMENTO — o que efetivamente saiu.
 *                Responde "sobrou dinheiro", não "deu lucro".
 *
 * Duas perguntas diferentes, e a tela deixa escolher em vez de decidir
 * escondido — porque decidir escondido é como um relatório engana.
 */
export async function movimentosParaDre(
  contexto: ContextoSessao,
  de: Date,
  ate: Date,
  base: "competencia" | "caixa" = "competencia",
) {
  if (!pode(contexto, "financeiro.resultado")) {
    throw new SemPermissao("ver o resultado");
  }
  const unidade = exigirUnidade(contexto);

  const linhas = await db.lancamento.findMany({
    where: {
      unidadeId: unidade.id,
      canceladoEm: null,
      ...(base === "caixa"
        ? { status: "QUITADO", quitadoEm: { gte: de, lte: ate } }
        : { status: { not: "CANCELADO" }, vencimento: { gte: de, lte: ate } }),
    },
    select: {
      valor: true,
      valorQuitado: true,
      categoria: { select: { nome: true, grupoDre: true } },
    },
  });

  return linhas.map((l) => ({
    // No caixa vale o que saiu; na competência, o que foi combinado — o
    // desconto de antecipação é ganho financeiro, não desconto de aluguel.
    valor:
      base === "caixa" ? Number(l.valorQuitado ?? l.valor) : Number(l.valor),
    categoria: l.categoria,
  }));
}
