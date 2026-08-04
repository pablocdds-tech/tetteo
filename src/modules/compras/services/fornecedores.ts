import { pode, type ContextoSessao } from "@/core/sessao/contexto";
import { SemPermissao } from "@/lib/erros";
import { db } from "@/server/db";

import type { DadosFornecedor } from "../schemas/entradas";

/**
 * OS FORNECEDORES.
 *
 * Escopo de ORGANIZAÇÃO, não de unidade: a distribuidora atende as duas lojas
 * e cadastrá-la duas vezes tornaria impossível comparar preço entre elas.
 *
 * A tabela veio do arquivo do Estoque quando este App nasceu — mudou de dono,
 * não de lugar no banco. Estoque continua LENDO fornecedor para lançar nota,
 * que é leitura de vocabulário compartilhado, o mesmo que ele já faz com
 * insumo.
 */

export async function listarFornecedores(
  contexto: ContextoSessao,
  incluirInativos = false,
) {
  if (!pode(contexto, "compras.ver")) throw new SemPermissao("ver compras");

  const fornecedores = await db.fornecedor.findMany({
    where: {
      organizacaoId: contexto.organizacao.id,
      excluidoEm: null,
      ...(incluirInativos ? {} : { ativo: true }),
    },
    include: {
      _count: { select: { notas: true, propostas: true, pedidos: true } },
    },
    orderBy: [{ ativo: "desc" }, { nome: "asc" }],
  });

  return fornecedores.map((f) => ({
    id: f.id,
    nome: f.nome,
    documento: f.documento,
    telefone: f.telefone,
    email: f.email,
    contato: f.contato,
    prazoEntregaDias: f.prazoEntregaDias,
    condicaoPagamento: f.condicaoPagamento,
    observacao: f.observacao,
    ativo: f.ativo,
    notas: f._count.notas,
    cotacoes: f._count.propostas,
    pedidos: f._count.pedidos,
  }));
}

export async function obterFornecedor(contexto: ContextoSessao, id: string) {
  if (!pode(contexto, "compras.ver")) throw new SemPermissao("ver compras");

  return db.fornecedor.findFirst({
    where: { id, organizacaoId: contexto.organizacao.id, excluidoEm: null },
  });
}

export async function salvarFornecedor(
  contexto: ContextoSessao,
  id: string | null,
  dados: DadosFornecedor,
) {
  if (!pode(contexto, "compras.fornecedores")) {
    throw new SemPermissao("cadastrar fornecedores");
  }

  if (!id) {
    const criado = await db.fornecedor.create({
      data: {
        organizacaoId: contexto.organizacao.id,
        ...dados,
        criadoPorId: contexto.usuario.id,
      },
    });
    await registrar(contexto, "CRIOU", criado.id, null, { nome: dados.nome });
    return criado;
  }

  const antes = await obterFornecedor(contexto, id);
  if (!antes) throw new Error("Fornecedor não encontrado.");

  const salvo = await db.fornecedor.update({ where: { id }, data: dados });
  await registrar(
    contexto,
    "ALTEROU",
    id,
    { nome: antes.nome, telefone: antes.telefone },
    { nome: dados.nome, telefone: dados.telefone },
  );
  return salvo;
}

/**
 * Desativa em vez de excluir.
 *
 * O fornecedor aparece em notas lançadas e em cotações antigas. Apagá-lo
 * deixaria o histórico de preço sem dono — e o histórico de preço é o
 * patrimônio que este módulo constrói.
 */
export async function alternarFornecedor(contexto: ContextoSessao, id: string) {
  if (!pode(contexto, "compras.fornecedores")) {
    throw new SemPermissao("alterar fornecedores");
  }

  const fornecedor = await obterFornecedor(contexto, id);
  if (!fornecedor) throw new Error("Fornecedor não encontrado.");

  await db.fornecedor.update({
    where: { id },
    data: { ativo: !fornecedor.ativo },
  });

  await registrar(
    contexto,
    "ALTEROU",
    id,
    { ativo: fornecedor.ativo },
    { ativo: !fornecedor.ativo },
  );
}

/**
 * O histórico de preço de um insumo, por fornecedor.
 *
 * Sai das cotações já respondidas — não existe tabela separada de catálogo.
 * Uma tabela paralela precisaria ser sincronizada a cada cotação, e a cópia
 * desatualizada acabaria valendo mais do que o original.
 */
export async function historicoDePreco(
  contexto: ContextoSessao,
  insumoId: string,
) {
  if (!pode(contexto, "compras.ver")) throw new SemPermissao("ver compras");

  const precos = await db.precoProposto.findMany({
    where: {
      naoAtende: false,
      item: {
        insumoId,
        cotacao: {
          unidadeId: contexto.unidadeAtiva?.id,
          canceladaEm: null,
        },
      },
      proposta: { status: "RESPONDIDA" },
    },
    include: {
      proposta: {
        select: {
          respondidaEm: true,
          fornecedor: { select: { id: true, nome: true } },
        },
      },
      item: { select: { cotacao: { select: { descricao: true } } } },
    },
    orderBy: { proposta: { respondidaEm: "desc" } },
    take: 40,
  });

  return precos.map((p) => ({
    fornecedorId: p.proposta.fornecedor.id,
    fornecedor: p.proposta.fornecedor.nome,
    precoUnitario: Number(p.precoUnitario),
    embalagem: p.embalagem,
    cotacao: p.item.cotacao.descricao,
    quando: p.proposta.respondidaEm,
  }));
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
      entidade: "Fornecedor",
      entidadeId,
      acao,
      valoresAntes:
        antes === null ? undefined : JSON.parse(JSON.stringify(antes)),
      valoresDepois:
        depois === null ? undefined : JSON.parse(JSON.stringify(depois)),
    },
  });
}
