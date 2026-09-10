import { pode, type ContextoSessao } from "@/core/sessao/contexto";
import { ExigeUnidade, SemPermissao } from "@/lib/erros";
import { Prisma } from "@prisma/client";

import { db } from "@/server/db";

import type { DadosNovaContagem } from "../schemas/contagem";
import {
  classificarEdicoes,
  type ConflitoNaFolha,
  type EdicaoRecebida,
} from "../schemas/edicao-de-contagem";

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
      local: { select: { id: true, nome: true } },
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
  edicoes: EdicaoRecebida[],
): Promise<{ salvos: number; conflitos: ConflitoNaFolha[] }> {
  if (!pode(contexto, "estoque.contar")) {
    throw new SemPermissao("preencher contagens");
  }
  const unidade = exigirUnidade(contexto);

  const contagem = await db.contagem.findFirst({
    where: { id: contagemId, unidadeId: unidade.id },
    select: {
      id: true,
      status: true,
      itens: {
        select: {
          insumoId: true,
          quantidade: true,
          contadoPorId: true,
          contadoEm: true,
          insumo: { select: { nome: true, unidadeMedida: true } },
        },
      },
    },
  });
  if (!contagem) throw new Error("Contagem não encontrada.");
  if (contagem.status !== "ABERTA") {
    throw new Error("Esta contagem já foi fechada e não aceita alterações.");
  }

  const noBanco = new Map(
    contagem.itens.map((i) => [
      i.insumoId,
      {
        quantidade: i.quantidade === null ? null : Number(i.quantidade),
        contadoPorId: i.contadoPorId,
        contadoEm: i.contadoEm,
      },
    ]),
  );

  // A regra de quem pode escrever o quê mora numa função pura, testada caso a
  // caso em `schemas/edicao-de-contagem.test.ts`.
  const { gravar, conflitos } = classificarEdicoes(edicoes, noBanco);

  const agora = new Date();
  const resultados =
    gravar.length === 0
      ? []
      : await db.$transaction(
          gravar.map(({ insumoId, valor, base }) =>
            db.contagemItem.updateMany({
              // A BASE vai no filtro. Se entre a leitura acima e esta escrita
              // uma terceira pessoa salvou, o filtro não casa, nada é gravado
              // e a linha vira conflito logo abaixo — em vez de sobrescrever.
              where: { contagemId, insumoId, quantidade: base },
              data: {
                quantidade: valor,
                contadoPorId: valor === null ? null : contexto.usuario.id,
                contadoEm: valor === null ? null : agora,
              },
            }),
          ),
        );

  const perdidas = gravar.filter((_, i) => resultados[i]?.count === 0);

  if (perdidas.length > 0) {
    const relidas = await db.contagemItem.findMany({
      where: {
        contagemId,
        insumoId: { in: perdidas.map((p) => p.insumoId) },
      },
      select: {
        insumoId: true,
        quantidade: true,
        contadoPorId: true,
        contadoEm: true,
      },
    });
    for (const r of relidas) {
      conflitos.push({
        insumoId: r.insumoId,
        tentado: perdidas.find((p) => p.insumoId === r.insumoId)!.valor,
        noBanco: r.quantidade === null ? null : Number(r.quantidade),
        contadoPorId: r.contadoPorId,
        contadoEm: r.contadoEm,
      });
    }
  }

  // O nome, não o id. "Alguém mudou" não ajuda a decidir; "a Ana contou às
  // 10h05" diz com quem conferir.
  const ids = [
    ...new Set(
      conflitos.map((c) => c.contadoPorId).filter((id): id is string => !!id),
    ),
  ];
  const pessoas =
    ids.length === 0
      ? []
      : await db.usuario.findMany({
          where: { id: { in: ids } },
          select: { id: true, nome: true },
        });
  const nomePorId = new Map(pessoas.map((p) => [p.id, p.nome]));
  const insumoPorId = new Map(
    contagem.itens.map((i) => [i.insumoId, i.insumo]),
  );

  return {
    salvos: gravar.length - perdidas.length,
    conflitos: conflitos.map((c) => ({
      insumoId: c.insumoId,
      nome: insumoPorId.get(c.insumoId)?.nome ?? "Insumo",
      unidade: insumoPorId.get(c.insumoId)?.unidadeMedida ?? "",
      tentado: c.tentado,
      noBanco: c.noBanco,
      porQuem: c.contadoPorId ? (nomePorId.get(c.contadoPorId) ?? null) : null,
      quando: c.contadoEm ? c.contadoEm.toISOString() : null,
    })),
  };
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
    include: {
      itens: { select: { id: true, insumoId: true, quantidade: true } },
    },
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

  /**
   * A CONTAGEM CORRIGE A POSIÇÃO — mas só quando ela sabe ONDE.
   *
   * Contar sem corrigir era fazer o trabalho e jogar fora o resultado: a
   * pessoa contava 12 kg e o sistema seguia afirmando 40.
   *
   * A correção só acontece na contagem de um LUGAR. Na contagem da loja
   * inteira o número contado é o total somado de várias prateleiras, e não há
   * como dizer quanto disso está na câmara fria e quanto no depósito —
   * escrever o total num lugar só criaria um saldo errado em dois lugares de
   * uma vez. A tela avisa; o CMV, que é o que importa, não depende disso.
   */
  const ajustaPosicao = contagem.localId !== null;

  const posicoes = ajustaPosicao
    ? await db.posicaoEstoque.findMany({
        where: {
          localId: contagem.localId!,
          insumoId: { in: contagem.itens.map((i) => i.insumoId) },
        },
        select: { insumoId: true, quantidade: true },
      })
    : [];
  const saldoAtual = new Map(
    posicoes.map((p) => [p.insumoId, Number(p.quantidade)]),
  );

  const agora = new Date();
  const escritas: Prisma.PrismaPromise<unknown>[] = [];

  for (const item of contagem.itens) {
    const custo = porInsumo.get(item.insumoId) ?? 0;

    escritas.push(
      db.contagemItem.update({
        where: { id: item.id },
        data: { custoUnitario: custo },
      }),
    );

    // Em branco é "não contei", não "acabou": o item fica de fora do ajuste,
    // exatamente como fica de fora do CMV.
    if (!ajustaPosicao || item.quantidade === null) continue;

    const contado = Number(item.quantidade);
    const esperado = saldoAtual.get(item.insumoId) ?? 0;
    const diferenca = Math.round((contado - esperado) * 1000) / 1000;

    if (diferenca !== 0) {
      escritas.push(
        db.movimentoEstoque.create({
          data: {
            unidadeId: unidade.id,
            insumoId: item.insumoId,
            localId: contagem.localId!,
            tipo: "AJUSTE",
            // A quantidade é sempre positiva; o sinal do ajuste vive no motivo
            // e na comparação, não num número negativo escondido no banco.
            quantidade: Math.abs(diferenca),
            custoUnitario: custo,
            motivo:
              diferenca < 0
                ? `Faltou ${Math.abs(diferenca)} em relação ao sistema`
                : `Sobrou ${diferenca} em relação ao sistema`,
            contagemId: id,
            ocorridoEm: contagem.referencia,
            registradoPorId: contexto.usuario.id,
          },
        }),
      );
    }

    escritas.push(
      db.posicaoEstoque.upsert({
        where: {
          localId_insumoId: {
            localId: contagem.localId!,
            insumoId: item.insumoId,
          },
        },
        // GRAVA o contado, não incrementa: a contagem física é a verdade, e o
        // que o sistema achava passa a ser história.
        update: { quantidade: contado },
        create: {
          unidadeId: unidade.id,
          localId: contagem.localId!,
          insumoId: item.insumoId,
          quantidade: contado,
        },
      }),
    );
  }

  escritas.push(
    db.contagem.update({
      where: { id },
      data: {
        status: "FECHADA",
        fechadaEm: agora,
        fechadaPorId: contexto.usuario.id,
      },
    }),
  );

  await db.$transaction(escritas);

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
