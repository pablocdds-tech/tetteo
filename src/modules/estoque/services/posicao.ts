import { pode, type ContextoSessao } from "@/core/sessao/contexto";
import { SemPermissao } from "@/lib/erros";
import { db } from "@/server/db";

import { exigirUnidade } from "./contagens";

/**
 * A POSIÇÃO DE ESTOQUE.
 *
 * O que existe, onde, e quanto vale. É a tela que responde "quantas coca eu
 * tenho?" — a pergunta que o cadastro duplicado do sistema antigo não
 * conseguia responder.
 *
 * O saldo aqui é derivado do que o sistema SABE: contagens fechadas e notas
 * lançadas. Enquanto a saída não for capturada (PDV ou baixa manual), ele é
 * uma estimativa que só cresce — e a tela precisa dizer isso, não deixar
 * alguém tomar decisão de compra achando que é verdade absoluta.
 */
export async function listarPosicao(
  contexto: ContextoSessao,
  filtro?: { localId?: string | null; abaixoDoMinimo?: boolean },
) {
  if (!pode(contexto, "estoque.ver")) throw new SemPermissao("ver o estoque");
  const unidade = exigirUnidade(contexto);

  const posicoes = await db.posicaoEstoque.findMany({
    where: {
      unidadeId: unidade.id,
      ...(filtro?.localId ? { localId: filtro.localId } : {}),
      insumo: { excluidoEm: null, ativo: true },
    },
    include: {
      local: { select: { id: true, nome: true } },
      insumo: {
        select: {
          id: true,
          nome: true,
          categoria: true,
          unidadeMedida: true,
          unidadeRotulo: true,
          custoMedio: true,
          estoqueMinimo: true,
        },
      },
    },
  });

  const linhas = posicoes.map((p) => {
    const quantidade = Number(p.quantidade);
    const custo = Number(p.insumo.custoMedio);
    // O mínimo do lugar manda; sem ele, vale o mínimo geral do insumo.
    const minimo =
      p.estoqueMinimo !== null
        ? Number(p.estoqueMinimo)
        : Number(p.insumo.estoqueMinimo);

    return {
      id: p.id,
      insumoId: p.insumo.id,
      nome: p.insumo.nome,
      categoria: p.insumo.categoria,
      unidade: p.insumo.unidadeRotulo ?? p.insumo.unidadeMedida,
      local: p.local,
      quantidade,
      minimo,
      custoMedio: custo,
      valor: Math.round(quantidade * custo * 100) / 100,
      faltando: minimo > 0 && quantidade < minimo,
    };
  });

  const filtradas = filtro?.abaixoDoMinimo
    ? linhas.filter((l) => l.faltando)
    : linhas;

  filtradas.sort(
    (a, b) =>
      Number(b.faltando) - Number(a.faltando) ||
      a.nome.localeCompare(b.nome, "pt-BR"),
  );

  const ultimaContagem = await db.contagem.findFirst({
    where: { unidadeId: unidade.id, status: "FECHADA", canceladaEm: null },
    orderBy: { referencia: "desc" },
    select: { referencia: true, descricao: true },
  });

  return {
    linhas: filtradas,
    // O total soma os valores já arredondados de cada linha, para bater com
    // a soma que alguém faria na calculadora olhando a tela.
    valorTotal: filtradas.reduce((s, l) => s + l.valor, 0),
    faltando: linhas.filter((l) => l.faltando).length,
    ultimaContagem,
  };
}
