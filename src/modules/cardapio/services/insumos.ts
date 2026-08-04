import { pode, type ContextoSessao } from "@/core/sessao/contexto";
import { db } from "@/server/db";

import type { DadosInsumo } from "../schemas/insumo";

/**
 * As regras de negócio do insumo.
 *
 * Componente não calcula nem decide — componente exibe. Toda regra que
 * importa mora aqui, onde pode ser lida, testada e mudada num lugar só.
 *
 * Três invariantes valem em cada função abaixo:
 *   1. Nada é lido sem escopo — sempre filtrando pela organização do usuário
 *   2. Nada é apagado de verdade — exclusão é lógica
 *   3. Toda escrita é auditada — quem mudou, o quê, de qual valor para qual
 */

export class SemPermissao extends Error {
  constructor(acao: string) {
    super(`Você não tem permissão para ${acao}.`);
    this.name = "SemPermissao";
  }
}

export async function listarInsumos(contexto: ContextoSessao) {
  if (!pode(contexto, "cardapio.ver")) throw new SemPermissao("ver o cardápio");

  return db.insumo.findMany({
    where: {
      organizacaoId: contexto.organizacao.id,
      excluidoEm: null,
    },
    orderBy: [{ ativo: "desc" }, { nome: "asc" }],
  });
}

export async function obterInsumo(contexto: ContextoSessao, id: string) {
  if (!pode(contexto, "cardapio.ver")) throw new SemPermissao("ver o cardápio");

  return db.insumo.findFirst({
    where: {
      id,
      organizacaoId: contexto.organizacao.id,
      excluidoEm: null,
    },
  });
}

export async function criarInsumo(
  contexto: ContextoSessao,
  dados: DadosInsumo,
) {
  if (!pode(contexto, "cardapio.editar")) {
    throw new SemPermissao("cadastrar insumos");
  }

  const insumo = await db.insumo.create({
    data: {
      organizacaoId: contexto.organizacao.id,
      nome: dados.nome,
      categoria: dados.categoria || null,
      unidadeMedida: dados.unidadeMedida,
      custoMedio: dados.custoMedio,
      estoqueMinimo: dados.estoqueMinimo,
      criadoPorId: contexto.usuario.id,
      atualizadoPorId: contexto.usuario.id,
    },
  });

  await registrarAuditoria(contexto, "CRIOU", insumo.id, null, dados);
  return insumo;
}

export async function atualizarInsumo(
  contexto: ContextoSessao,
  id: string,
  dados: DadosInsumo,
) {
  if (!pode(contexto, "cardapio.editar")) {
    throw new SemPermissao("alterar insumos");
  }

  // Busca com escopo: garante que o insumo é da organização do usuário.
  const anterior = await obterInsumo(contexto, id);
  if (!anterior) throw new Error("Insumo não encontrado.");

  const insumo = await db.insumo.update({
    where: { id },
    data: {
      nome: dados.nome,
      categoria: dados.categoria || null,
      unidadeMedida: dados.unidadeMedida,
      custoMedio: dados.custoMedio,
      estoqueMinimo: dados.estoqueMinimo,
      atualizadoPorId: contexto.usuario.id,
    },
  });

  await registrarAuditoria(
    contexto,
    "ALTEROU",
    id,
    {
      nome: anterior.nome,
      categoria: anterior.categoria,
      unidadeMedida: anterior.unidadeMedida,
      custoMedio: anterior.custoMedio.toString(),
      estoqueMinimo: anterior.estoqueMinimo.toString(),
    },
    dados,
  );

  return insumo;
}

export async function excluirInsumo(contexto: ContextoSessao, id: string) {
  if (!pode(contexto, "cardapio.excluir")) {
    throw new SemPermissao("excluir insumos");
  }

  const anterior = await obterInsumo(contexto, id);
  if (!anterior) throw new Error("Insumo não encontrado.");

  // Exclusão LÓGICA. O registro sai da tela mas continua no banco: relatórios
  // antigos e o histórico de compras continuam fazendo sentido.
  await db.insumo.update({
    where: { id },
    data: { excluidoEm: new Date(), atualizadoPorId: contexto.usuario.id },
  });

  await registrarAuditoria(
    contexto,
    "EXCLUIU",
    id,
    { nome: anterior.nome },
    null,
  );
}

async function registrarAuditoria(
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
      entidade: "Insumo",
      entidadeId,
      acao,
      valoresAntes:
        antes === null ? undefined : JSON.parse(JSON.stringify(antes)),
      valoresDepois:
        depois === null ? undefined : JSON.parse(JSON.stringify(depois)),
    },
  });
}
