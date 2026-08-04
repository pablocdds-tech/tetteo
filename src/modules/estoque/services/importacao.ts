import { pode, type ContextoSessao } from "@/core/sessao/contexto";
import { ExigeUnidade, SemPermissao } from "@/lib/erros";
import { db } from "@/server/db";

import type { PlanoDeImportacao } from "../schemas/importacao";

import { exigirUnidade } from "./contagens";

/**
 * A GRAVAÇÃO DA IMPORTAÇÃO.
 *
 * Roda em lote, não linha a linha: o banco fica num servidor remoto, e
 * duzentas e sessenta idas e voltas levariam minutos com a tela parada.
 * `createMany` resolve tudo em três viagens.
 *
 * É IDEMPOTENTE de propósito — importar a mesma planilha duas vezes não
 * duplica nada, só atualiza. Isso muda o que acontece se algo falhar no meio:
 * em vez de restar meio cadastro sem conserto, basta importar de novo.
 *
 * Toca em duas casas: cria INSUMO, que é vocabulário do Cardápio, e cria
 * POSIÇÃO, que é do Estoque. Por isso exige as duas permissões. Uma
 * importação é uma operação de implantação, não de rotina.
 */
export async function importarPlanilha(
  contexto: ContextoSessao,
  plano: PlanoDeImportacao,
) {
  if (!pode(contexto, "cardapio.editar")) {
    throw new SemPermissao("cadastrar insumos");
  }
  if (!pode(contexto, "estoque.lancar")) {
    throw new SemPermissao("lançar posições de estoque");
  }
  const unidade = exigirUnidade(contexto);

  if (plano.erroGeral) throw new Error(plano.erroGeral);
  if (plano.insumos.length === 0) {
    throw new Error(
      "Nada para importar: a planilha não tem linhas de produto.",
    );
  }

  const organizacaoId = contexto.organizacao.id;

  // ---- 1. Os lugares ------------------------------------------------------
  await db.localEstoque.createMany({
    data: plano.locais.map((nome, i) => ({
      unidadeId: unidade.id,
      nome,
      ordem: i,
    })),
    skipDuplicates: true,
  });

  const locais = await db.localEstoque.findMany({
    where: { unidadeId: unidade.id },
    select: { id: true, nome: true },
  });
  const idDoLocal = new Map(locais.map((l) => [l.nome, l.id]));

  // ---- 2. Os insumos ------------------------------------------------------
  const existentes = await db.insumo.findMany({
    where: { organizacaoId },
    select: { id: true, nome: true },
  });
  const idDoInsumo = new Map(existentes.map((i) => [i.nome, i.id]));

  const novos = plano.insumos.filter((i) => !idDoInsumo.has(i.nome));
  const paraAtualizar = plano.insumos.filter((i) => idDoInsumo.has(i.nome));

  if (novos.length > 0) {
    await db.insumo.createMany({
      data: novos.map((i) => ({
        organizacaoId,
        nome: i.nome,
        categoria: i.categoria,
        unidadeMedida: i.unidadeMedida,
        unidadeRotulo: i.unidadeRotulo,
        custoMedio: i.custoMedio,
        custoUltimo: i.custoUltimo,
        estoqueMinimo: i.estoqueMinimo,
        criadoPorId: contexto.usuario.id,
        atualizadoPorId: contexto.usuario.id,
      })),
      skipDuplicates: true,
    });
  }

  // Só quem já existia precisa de UPDATE, e um por vez — são poucos numa
  // implantação e o caminho lento não vale otimização prematura.
  for (const i of paraAtualizar) {
    await db.insumo.update({
      where: { id: idDoInsumo.get(i.nome)! },
      data: {
        categoria: i.categoria,
        unidadeMedida: i.unidadeMedida,
        unidadeRotulo: i.unidadeRotulo,
        custoMedio: i.custoMedio,
        custoUltimo: i.custoUltimo,
        estoqueMinimo: i.estoqueMinimo,
        // Reimportar ressuscita o que tinha sido excluído: se o item voltou
        // para a planilha, ele voltou para a operação.
        excluidoEm: null,
        ativo: true,
        atualizadoPorId: contexto.usuario.id,
      },
    });
  }

  const todos = await db.insumo.findMany({
    where: { organizacaoId },
    select: { id: true, nome: true },
  });
  const idFinal = new Map(todos.map((i) => [i.nome, i.id]));

  // ---- 3. As posições -----------------------------------------------------
  const desejadas = plano.insumos.flatMap((insumo) =>
    insumo.posicoes.map((p) => ({
      unidadeId: unidade.id,
      localId: idDoLocal.get(p.local)!,
      insumoId: idFinal.get(insumo.nome)!,
      quantidade: p.quantidade,
      estoqueMinimo: p.estoqueMinimo,
    })),
  );

  const posicoesExistentes = await db.posicaoEstoque.findMany({
    where: { unidadeId: unidade.id },
    select: { id: true, localId: true, insumoId: true },
  });
  const idDaPosicao = new Map(
    posicoesExistentes.map((p) => [`${p.localId}|${p.insumoId}`, p.id]),
  );

  const posicoesNovas = desejadas.filter(
    (p) => !idDaPosicao.has(`${p.localId}|${p.insumoId}`),
  );

  if (posicoesNovas.length > 0) {
    await db.posicaoEstoque.createMany({
      data: posicoesNovas,
      skipDuplicates: true,
    });
  }

  for (const p of desejadas) {
    const id = idDaPosicao.get(`${p.localId}|${p.insumoId}`);
    if (!id) continue;
    await db.posicaoEstoque.update({
      where: { id },
      data: { quantidade: p.quantidade, estoqueMinimo: p.estoqueMinimo },
    });
  }

  const resumo = {
    insumosCriados: novos.length,
    insumosAtualizados: paraAtualizar.length,
    locais: plano.locais.length,
    posicoes: desejadas.length,
    linhas: plano.linhas.length,
  };

  await db.auditoria.create({
    data: {
      organizacaoId,
      unidadeId: unidade.id,
      usuarioId: contexto.usuario.id,
      entidade: "Insumo",
      entidadeId: "importacao-em-lote",
      acao: "CRIOU",
      valoresDepois: resumo,
    },
  });

  return resumo;
}

export { ExigeUnidade, SemPermissao };
