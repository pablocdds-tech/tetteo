import { pode, type ContextoSessao } from "@/core/sessao/contexto";
import { ExigeUnidade, SemPermissao } from "@/lib/erros";
import { db } from "@/server/db";

import type { DadosNovaContagem } from "../schemas/contagem";

/**
 * As regras da contagem de estoque.
 *
 * Componente não calcula nem decide — componente exibe. Toda regra que
 * importa mora aqui.
 *
 * Além das três invariantes que valem em todo o Tetteo (escopo, exclusão
 * lógica, auditoria), esta camada carrega uma quarta, própria do Estoque:
 * **contagem fechada não muda**. O CMV de uma semana encerrada é história, e
 * história que se reescreve sozinha não serve para decidir nada.
 */

/**
 * Estoque é físico. "A rede" não tem câmara fria, então não há o que contar
 * enquanto o usuário estiver olhando a rede inteira.
 */
export function exigirUnidade(contexto: ContextoSessao) {
  if (!contexto.unidadeAtiva) throw new ExigeUnidade();
  return contexto.unidadeAtiva;
}

export async function listarContagens(contexto: ContextoSessao) {
  if (!pode(contexto, "estoque.ver")) throw new SemPermissao("ver o estoque");
  const unidade = exigirUnidade(contexto);

  const contagens = await db.contagem.findMany({
    where: { unidadeId: unidade.id, canceladaEm: null },
    orderBy: { referencia: "desc" },
    include: {
      local: { select: { nome: true } },
      // `_count` traz só os números: a lista não precisa carregar cento e
      // vinte itens por linha para dizer "32 de 118".
      _count: { select: { itens: true } },
    },
  });

  // Quantos já foram contados, por contagem. Uma consulta só para todas —
  // fazer uma por linha seria o clássico problema de N+1.
  const contados = await db.contagemItem.groupBy({
    by: ["contagemId"],
    where: {
      contagem: { unidadeId: unidade.id, canceladaEm: null },
      quantidade: { not: null },
    },
    _count: { _all: true },
  });

  const porContagem = new Map(
    contados.map((c) => [c.contagemId, c._count._all]),
  );

  return contagens.map((c) => ({
    ...c,
    totalItens: c._count.itens,
    itensContados: porContagem.get(c.id) ?? 0,
  }));
}

export async function obterContagem(contexto: ContextoSessao, id: string) {
  if (!pode(contexto, "estoque.ver")) throw new SemPermissao("ver o estoque");
  const unidade = exigirUnidade(contexto);

  return db.contagem.findFirst({
    // Busca SEMPRE com escopo: mesmo com o id certo, uma contagem de outra
    // unidade não aparece.
    where: { id, unidadeId: unidade.id },
    include: {
      itens: {
        include: {
          insumo: {
            select: {
              id: true,
              nome: true,
              categoria: true,
              unidadeMedida: true,
            },
          },
        },
      },
    },
  });
}

/** As categorias já usadas nos insumos — para escolher o escopo da contagem. */
export async function categoriasDeInsumos(contexto: ContextoSessao) {
  if (!pode(contexto, "estoque.ver")) throw new SemPermissao("ver o estoque");

  const linhas = await db.insumo.findMany({
    where: {
      organizacaoId: contexto.organizacao.id,
      excluidoEm: null,
      ativo: true,
      categoria: { not: null },
    },
    select: { categoria: true },
    distinct: ["categoria"],
    orderBy: { categoria: "asc" },
  });

  return linhas.map((l) => l.categoria!).filter(Boolean);
}

/**
 * Abre uma contagem e já monta a folha.
 *
 * Os itens são congelados AGORA: se um insumo for cadastrado amanhã, ele não
 * entra numa contagem de ontem. Sem isso a folha mudaria debaixo de quem está
 * contando.
 */
export async function criarContagem(
  contexto: ContextoSessao,
  dados: DadosNovaContagem & {
    localId?: string | null;
    rotinaId?: string | null;
  },
) {
  if (!pode(contexto, "estoque.contar")) {
    throw new SemPermissao("abrir contagens");
  }
  const unidade = exigirUnidade(contexto);

  // A folha nasce do escopo. Com LUGAR, entram os insumos que têm posição
  // naquele lugar — é o que faz a folha da praça ter vinte itens e não
  // duzentos e trinta. Sem lugar, entra o catálogo, filtrado por categoria.
  let insumoIds: string[];

  if (dados.localId) {
    const posicoes = await db.posicaoEstoque.findMany({
      where: {
        localId: dados.localId,
        unidadeId: unidade.id,
        insumo: {
          excluidoEm: null,
          ativo: true,
          ...(dados.categorias.length > 0
            ? { categoria: { in: dados.categorias } }
            : {}),
        },
      },
      select: { insumoId: true },
    });
    insumoIds = posicoes.map((p) => p.insumoId);
  } else {
    const insumos = await db.insumo.findMany({
      where: {
        organizacaoId: contexto.organizacao.id,
        excluidoEm: null,
        ativo: true,
        ...(dados.categorias.length > 0
          ? { categoria: { in: dados.categorias } }
          : {}),
      },
      select: { id: true },
      orderBy: { nome: "asc" },
    });
    insumoIds = insumos.map((i) => i.id);
  }

  if (insumoIds.length === 0) {
    throw new Error(
      dados.localId
        ? "Nenhum insumo cadastrado nesse lugar. Importe ou cadastre posições antes de contar."
        : "Nenhum insumo ativo nesse escopo. Cadastre insumos no Cardápio antes de contar.",
    );
  }

  const contagem = await db.contagem.create({
    data: {
      unidadeId: unidade.id,
      referencia: dados.referencia,
      descricao: dados.descricao || null,
      categorias: dados.categorias,
      localId: dados.localId ?? null,
      rotinaId: dados.rotinaId ?? null,
      abertaPorId: contexto.usuario.id,
      itens: {
        // Quantidade nasce NULA: ninguém contou ainda. Nascer zero afirmaria
        // que a câmara fria está vazia.
        createMany: { data: insumoIds.map((id) => ({ insumoId: id })) },
      },
    },
  });

  await registrarAuditoria(contexto, "CRIOU", contagem.id, null, {
    referencia: dados.referencia.toISOString(),
    descricao: dados.descricao ?? null,
    categorias: dados.categorias,
    localId: dados.localId ?? null,
    itens: insumoIds.length,
  });

  return contagem;
}

/**
 * Grava o que foi digitado na folha.
 *
 * Recebe só o que mudou. Chaves ausentes não são tocadas — salvar uma parte
 * da folha não pode apagar o resto.
 */
export async function salvarQuantidades(
  contexto: ContextoSessao,
  contagemId: string,
  valores: Map<string, number | null>,
) {
  if (!pode(contexto, "estoque.contar")) {
    throw new SemPermissao("preencher contagens");
  }
  const unidade = exigirUnidade(contexto);

  const contagem = await db.contagem.findFirst({
    where: { id: contagemId, unidadeId: unidade.id },
    select: { id: true, status: true },
  });
  if (!contagem) throw new Error("Contagem não encontrada.");
  if (contagem.status !== "ABERTA") {
    throw new Error("Esta contagem já foi fechada e não aceita alterações.");
  }

  const agora = new Date();

  await db.$transaction(
    [...valores].map(([insumoId, quantidade]) =>
      db.contagemItem.update({
        where: { contagemId_insumoId: { contagemId, insumoId } },
        data: {
          quantidade,
          contadoPorId: quantidade === null ? null : contexto.usuario.id,
          contadoEm: quantidade === null ? null : agora,
        },
      }),
    ),
  );

  return valores.size;
}

/**
 * Fecha a contagem.
 *
 * É aqui que o custo é congelado. Se a mussarela subir semana que vem, o CMV
 * desta semana continua o mesmo — senão o passado se reescreveria sozinho a
 * cada compra.
 *
 * Itens sem contagem NÃO viram zero: ficam nulos e simplesmente não entram no
 * CMV. É a diferença entre "não contei" e "acabou".
 */
export async function fecharContagem(contexto: ContextoSessao, id: string) {
  if (!pode(contexto, "estoque.contar")) {
    throw new SemPermissao("fechar contagens");
  }
  const unidade = exigirUnidade(contexto);

  const contagem = await db.contagem.findFirst({
    where: { id, unidadeId: unidade.id },
    include: { itens: { select: { id: true, insumoId: true } } },
  });
  if (!contagem) throw new Error("Contagem não encontrada.");
  if (contagem.status !== "ABERTA") {
    throw new Error("Esta contagem já foi fechada.");
  }

  const custos = await db.insumo.findMany({
    where: { id: { in: contagem.itens.map((i) => i.insumoId) } },
    select: { id: true, custoMedio: true },
  });
  const porInsumo = new Map(custos.map((c) => [c.id, c.custoMedio]));

  await db.$transaction([
    ...contagem.itens.map((item) =>
      db.contagemItem.update({
        where: { id: item.id },
        data: { custoUnitario: porInsumo.get(item.insumoId) ?? 0 },
      }),
    ),
    db.contagem.update({
      where: { id },
      data: {
        status: "FECHADA",
        fechadaEm: new Date(),
        fechadaPorId: contexto.usuario.id,
      },
    }),
  ]);

  await registrarAuditoria(
    contexto,
    "ALTEROU",
    id,
    { status: "ABERTA" },
    {
      status: "FECHADA",
    },
  );
}

/**
 * Cancela a contagem.
 *
 * Não existe reabrir: uma contagem fechada já pode ter servido de base para um
 * CMV que alguém leu e usou para decidir. Cancelar é explícito — o registro
 * continua no banco, sai das telas e deixa rastro na auditoria.
 */
export async function cancelarContagem(contexto: ContextoSessao, id: string) {
  if (!pode(contexto, "estoque.contar")) {
    throw new SemPermissao("cancelar contagens");
  }
  const unidade = exigirUnidade(contexto);

  const contagem = await db.contagem.findFirst({
    where: { id, unidadeId: unidade.id, canceladaEm: null },
    select: { id: true, status: true },
  });
  if (!contagem) throw new Error("Contagem não encontrada.");

  await db.contagem.update({
    where: { id },
    data: { status: "CANCELADA", canceladaEm: new Date() },
  });

  await registrarAuditoria(
    contexto,
    "EXCLUIU",
    id,
    { status: contagem.status },
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
      entidade: "Contagem",
      entidadeId,
      acao,
      valoresAntes:
        antes === null ? undefined : JSON.parse(JSON.stringify(antes)),
      valoresDepois:
        depois === null ? undefined : JSON.parse(JSON.stringify(depois)),
    },
  });
}
