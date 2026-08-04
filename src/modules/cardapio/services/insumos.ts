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

/**
 * A ponte entre o formulário antigo e a tabela de unidades.
 *
 * O formulário ainda manda o valor do enum legado (`KG`, `G`, …). O banco, a
 * partir da M3, guarda um ponteiro para `unidade_medida` — que é o que permite
 * cadastrar "saco" e "caixa" sem migration.
 *
 * Enquanto as duas coisas convivem, o insumo grava as duas: o enum para a tela
 * atual continuar funcionando e o ponteiro para o razão de estoque poder somar
 * saldo. O enum some na M9, junto com este mapa.
 */
const CODIGO_DA_UNIDADE_LEGADA: Record<DadosInsumo["unidadeMedida"], string> = {
  KG: "kg",
  G: "g",
  L: "L",
  ML: "ml",
  UN: "un",
};

async function resolverUnidadeEstoque(
  organizacaoId: string,
  unidadeLegada: DadosInsumo["unidadeMedida"],
): Promise<string> {
  const codigo = CODIGO_DA_UNIDADE_LEGADA[unidadeLegada];

  const unidade = await db.unidadeMedida.findFirst({
    where: { organizacaoId, codigo, excluidoEm: null },
    select: { id: true },
  });

  // Só acontece se a organização não passou pelo seed. Sem unidade de estoque
  // o saldo do insumo não pode ser somado, então é melhor recusar o cadastro
  // do que criar um insumo que o estoque não consegue movimentar.
  if (!unidade) {
    throw new Error(
      `A unidade de medida "${codigo}" não está cadastrada nesta organização. Rode \`npm run seed\`.`,
    );
  }

  return unidade.id;
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

  const unidadeEstoqueId = await resolverUnidadeEstoque(
    contexto.organizacao.id,
    dados.unidadeMedida,
  );

  const insumo = await db.insumo.create({
    data: {
      organizacaoId: contexto.organizacao.id,
      nome: dados.nome,
      categoria: dados.categoria || null,
      unidadeMedida: dados.unidadeMedida,
      unidadeEstoqueId,
      custoMedio: dados.custoMedio,
      custoReferencia: dados.custoMedio,
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

  const unidadeEstoqueId = await resolverUnidadeEstoque(
    contexto.organizacao.id,
    dados.unidadeMedida,
  );

  // `updateMany` e não `update`: o filtro carrega a organização junto, então a
  // escrita é escopada pela mesma regra que a leitura. Com `update({ where:
  // { id } })`, a garantia dependia de a busca anterior ter sido bem escrita —
  // e é este arquivo que os próximos Apps vão copiar.
  await db.insumo.updateMany({
    where: {
      id,
      organizacaoId: contexto.organizacao.id,
      excluidoEm: null,
    },
    data: {
      nome: dados.nome,
      categoria: dados.categoria || null,
      unidadeMedida: dados.unidadeMedida,
      unidadeEstoqueId,
      custoMedio: dados.custoMedio,
      custoReferencia: dados.custoMedio,
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

  return obterInsumo(contexto, id);
}

export async function excluirInsumo(contexto: ContextoSessao, id: string) {
  if (!pode(contexto, "cardapio.excluir")) {
    throw new SemPermissao("excluir insumos");
  }

  const anterior = await obterInsumo(contexto, id);
  if (!anterior) throw new Error("Insumo não encontrado.");

  // Exclusão LÓGICA. O registro sai da tela mas continua no banco: relatórios
  // antigos e o histórico de compras continuam fazendo sentido.
  //
  // O nome volta a ficar livre — desde a M1 a trava de unicidade só vale entre
  // os não excluídos, então recadastrar "Mussarela" depois disto funciona.
  await db.insumo.updateMany({
    where: {
      id,
      organizacaoId: contexto.organizacao.id,
      excluidoEm: null,
    },
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
