import { pode, type ContextoSessao } from "@/core/sessao/contexto";
import type { GrupoDre } from "../schemas/dre";
import { SemPermissao } from "@/lib/erros";
import { db } from "@/server/db";

import { exigirUnidade } from "./lancamentos";

/**
 * CATEGORIAS, CONTAS — e a costura com as notas do Estoque.
 */

/**
 * As categorias que toda pizzaria tem.
 *
 * Criadas no primeiro acesso em vez de exigidas antes do primeiro lançamento.
 * Uma tela de "cadastre seu plano de contas" na frente da primeira conta a
 * pagar é onde o módulo seria abandonado — e categoria pode ser renomeada
 * depois, sem perder nada.
 */
const PADRAO = [
  {
    nome: "Vendas no salão",
    tipo: "RECEITA",
    grupo: "Vendas",
    grupoDre: "RECEITA",
  },
  { nome: "Delivery", tipo: "RECEITA", grupo: "Vendas", grupoDre: "RECEITA" },
  // Taxa de app e imposto sobre venda NÃO são despesa operacional: saem antes,
  // como dedução. Jogá-las junto com aluguel esconderia a receita líquida, que
  // é a base de tudo que vem depois.
  {
    nome: "Taxas de cartão e apps",
    tipo: "DESPESA",
    grupo: "Vendas",
    grupoDre: "DEDUCAO",
  },
  { nome: "Impostos", tipo: "DESPESA", grupo: "Impostos", grupoDre: "DEDUCAO" },
  // Fica FORA do DRE: quem responde pelo custo da comida é o CMV do Estoque.
  {
    nome: "Mercadoria",
    tipo: "DESPESA",
    grupo: "Mercadoria",
    grupoDre: "MERCADORIA",
  },
  {
    nome: "Folha e encargos",
    tipo: "DESPESA",
    grupo: "Pessoal",
    grupoDre: "PESSOAL",
  },
  { nome: "Aluguel", tipo: "DESPESA", grupo: "Ocupação", grupoDre: "OCUPACAO" },
  {
    nome: "Energia, água e gás",
    tipo: "DESPESA",
    grupo: "Ocupação",
    grupoDre: "OCUPACAO",
  },
  {
    nome: "Manutenção",
    tipo: "DESPESA",
    grupo: "Operação",
    grupoDre: "OPERACIONAL",
  },
  {
    nome: "Outras despesas",
    tipo: "DESPESA",
    grupo: "Operação",
    grupoDre: "OPERACIONAL",
  },
  {
    nome: "Juros e tarifas",
    tipo: "DESPESA",
    grupo: "Financeiro",
    grupoDre: "FINANCEIRA",
  },
  {
    nome: "Investimentos",
    tipo: "DESPESA",
    grupo: "Investimento",
    grupoDre: "INVESTIMENTO",
  },
] as const;

export async function listarCategorias(contexto: ContextoSessao) {
  if (!pode(contexto, "financeiro.ver")) {
    throw new SemPermissao("ver o financeiro");
  }

  const existentes = await db.categoriaFinanceira.count({
    where: { organizacaoId: contexto.organizacao.id },
  });

  if (existentes === 0 && pode(contexto, "financeiro.lancar")) {
    await db.categoriaFinanceira.createMany({
      data: PADRAO.map((c) => ({
        organizacaoId: contexto.organizacao.id,
        nome: c.nome,
        tipo: c.tipo,
        grupo: c.grupo,
        grupoDre: c.grupoDre,
        ehSistema: true,
      })),
      skipDuplicates: true,
    });
  }

  return db.categoriaFinanceira.findMany({
    where: { organizacaoId: contexto.organizacao.id, ativa: true },
    orderBy: [{ tipo: "asc" }, { grupo: "asc" }, { nome: "asc" }],
  });
}

export async function salvarCategoria(
  contexto: ContextoSessao,
  id: string | null,
  dados: {
    nome: string;
    tipo: "RECEITA" | "DESPESA";
    grupo: string | null;
    grupoDre: GrupoDre | null;
  },
) {
  if (!pode(contexto, "financeiro.lancar")) {
    throw new SemPermissao("cadastrar categorias");
  }

  if (!id) {
    return db.categoriaFinanceira.create({
      data: { organizacaoId: contexto.organizacao.id, ...dados },
    });
  }

  const antes = await db.categoriaFinanceira.findFirst({
    where: { id, organizacaoId: contexto.organizacao.id },
    select: { id: true, ehSistema: true },
  });
  if (!antes) throw new Error("Categoria não encontrada.");

  // Categoria do sistema pode ser renomeada, não trocada de lado: mudar
  // "Aluguel" de despesa para receita inverteria o sinal de todo o histórico.
  return db.categoriaFinanceira.update({
    where: { id },
    // Categoria do sistema pode ser renomeada e reclassificada no DRE — o que
    // ela não pode é trocar de lado (despesa vira receita), porque isso
    // inverteria o sinal de todo o histórico.
    data: antes.ehSistema
      ? { nome: dados.nome, grupo: dados.grupo, grupoDre: dados.grupoDre }
      : dados,
  });
}

export async function desativarCategoria(contexto: ContextoSessao, id: string) {
  if (!pode(contexto, "financeiro.lancar")) {
    throw new SemPermissao("alterar categorias");
  }

  const categoria = await db.categoriaFinanceira.findFirst({
    where: { id, organizacaoId: contexto.organizacao.id },
    select: { id: true, ativa: true },
  });
  if (!categoria) throw new Error("Categoria não encontrada.");

  await db.categoriaFinanceira.update({
    where: { id },
    data: { ativa: !categoria.ativa },
  });
}

export async function listarContas(contexto: ContextoSessao) {
  if (!pode(contexto, "financeiro.ver")) {
    throw new SemPermissao("ver o financeiro");
  }
  const unidade = exigirUnidade(contexto);

  return db.contaFinanceira.findMany({
    where: { unidadeId: unidade.id },
    orderBy: [{ ativa: "desc" }, { nome: "asc" }],
  });
}

export async function salvarConta(
  contexto: ContextoSessao,
  id: string | null,
  dados: { nome: string; tipo: "CAIXA" | "BANCO"; saldoInicial: number },
) {
  if (!pode(contexto, "financeiro.lancar")) {
    throw new SemPermissao("cadastrar contas bancárias");
  }
  const unidade = exigirUnidade(contexto);

  if (!id) {
    return db.contaFinanceira.create({
      data: { unidadeId: unidade.id, ...dados },
    });
  }

  const existe = await db.contaFinanceira.count({
    where: { id, unidadeId: unidade.id },
  });
  if (!existe) throw new Error("Conta não encontrada.");

  return db.contaFinanceira.update({ where: { id }, data: dados });
}

// ---------------------------------------------------------------------------
// A COSTURA COM O ESTOQUE
// ---------------------------------------------------------------------------

/**
 * As notas lançadas no Estoque que ainda não viraram conta a pagar.
 *
 * Esta é a única leitura que o Financeiro faz de uma tabela de outro App, e é
 * deliberada: uma nota de entrada É uma obrigação de pagar. Obrigar a pessoa a
 * redigitar cada nota aqui garantiria que ela não digitasse — e um contas a
 * pagar incompleto é pior do que nenhum, porque dá falsa segurança.
 *
 * A leitura é do FATO ("chegou mercadoria por R$ X, de fulano"); a obrigação
 * continua sendo criada e mantida aqui. O vínculo um-para-um impede que a
 * mesma nota vire duas contas.
 */
export async function notasSemContaAPagar(contexto: ContextoSessao) {
  if (!pode(contexto, "financeiro.lancar")) {
    throw new SemPermissao("cadastrar contas");
  }
  const unidade = exigirUnidade(contexto);

  const notas = await db.notaEntrada.findMany({
    where: {
      unidadeId: unidade.id,
      status: "LANCADA",
      contaAPagar: null,
      valorTotal: { gt: 0 },
    },
    include: { fornecedor: { select: { id: true, nome: true } } },
    orderBy: { recebidaEm: "desc" },
    take: 50,
  });

  return notas.map((n) => ({
    id: n.id,
    fornecedorId: n.fornecedorId,
    fornecedor: n.fornecedor.nome,
    numero: n.numero,
    recebidaEm: n.recebidaEm,
    valorTotal: Number(n.valorTotal),
  }));
}

/**
 * Transforma as notas escolhidas em contas a pagar.
 *
 * O vencimento não é a data de recebimento: usa o prazo do fornecedor quando
 * ele existe. Lançar tudo vencendo no dia da entrega encheria a tela de
 * atrasos falsos no primeiro uso.
 */
export async function importarNotas(
  contexto: ContextoSessao,
  notaIds: string[],
  categoriaId: string | null,
) {
  if (!pode(contexto, "financeiro.lancar")) {
    throw new SemPermissao("cadastrar contas");
  }
  const unidade = exigirUnidade(contexto);

  const notas = await db.notaEntrada.findMany({
    where: {
      id: { in: notaIds },
      unidadeId: unidade.id,
      status: "LANCADA",
      contaAPagar: null,
    },
    include: { fornecedor: { select: { id: true, nome: true } } },
  });

  if (notas.length === 0) return 0;

  const prazos = await db.fornecedor.findMany({
    where: { id: { in: notas.map((n) => n.fornecedorId) } },
    select: { id: true, prazoEntregaDias: true, condicaoPagamento: true },
  });
  const porFornecedor = new Map(prazos.map((p) => [p.id, p]));

  await db.lancamento.createMany({
    data: notas.map((n) => {
      const vencimento = new Date(n.recebidaEm);
      // Sem condição cadastrada, 28 dias — o padrão de distribuidora no Brasil.
      // Um chute explícito e ajustável é melhor do que "vence hoje".
      const dias = porFornecedor.get(n.fornecedorId)?.condicaoPagamento
        ? lerDias(porFornecedor.get(n.fornecedorId)!.condicaoPagamento!)
        : 28;
      vencimento.setDate(vencimento.getDate() + dias);

      return {
        unidadeId: unidade.id,
        direcao: "PAGAR" as const,
        descricao: `${n.fornecedor.nome}${n.numero ? ` · NF ${n.numero}` : ""}`,
        valor: n.valorTotal,
        vencimento,
        categoriaId,
        fornecedorId: n.fornecedorId,
        notaEntradaId: n.id,
        criadoPorId: contexto.usuario.id,
      };
    }),
  });

  return notas.length;
}

/** "28 dias", "30/60", "à vista" → o primeiro número que aparecer. */
function lerDias(condicao: string) {
  const achado = /\d+/.exec(condicao);
  if (!achado) return 0;
  const dias = Number(achado[0]);
  return dias >= 0 && dias <= 180 ? dias : 28;
}
