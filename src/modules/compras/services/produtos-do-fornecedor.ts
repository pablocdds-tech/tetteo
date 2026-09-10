import { Prisma } from "@prisma/client";

import { pode, type ContextoSessao } from "@/core/sessao/nucleo";
import { SemPermissao } from "@/lib/erros";
import { normalizarTelefone } from "@/lib/telefone";
import type { Unidade } from "@/lib/unidades";
import { db } from "@/server/db";

import {
  CASAS,
  NumeroInvalido,
  digitado,
  fatorDoBanco,
  paraDecimal,
} from "../schemas/aritmetica";
import { fatorDaEmbalagem } from "../schemas/embalagem";

import { registrar } from "./auditoria";

/**
 * O QUE CADA FORNECEDOR VENDE — e o destino das mensagens para ele.
 *
 * `FornecedorInsumo` diz quem é ELEGÍVEL para cotar cada insumo e em que
 * embalagem. É também onde mora o fornecedor FIXO: o banco garante um por
 * insumo (`chaveFixo` única), e marcar um segundo devolve uma frase dizendo
 * quem já é o fixo.
 */

function exigir(ctx: ContextoSessao, chave: string, acao: string) {
  if (!pode(ctx, chave)) throw new SemPermissao(acao);
}

function lerNumero(valor: string, casas: number): bigint | null {
  try {
    return digitado(valor, casas);
  } catch (erro) {
    if (erro instanceof NumeroInvalido) throw new Error(erro.message);
    throw erro;
  }
}

export async function listarProdutosDoFornecedor(
  ctx: ContextoSessao,
  fornecedorId: string,
) {
  exigir(ctx, "compras.ver", "ver compras");
  const produtos = await db.fornecedorInsumo.findMany({
    where: { organizacaoId: ctx.organizacao.id, fornecedorId, ativo: true },
    include: {
      insumo: { select: { nome: true, unidadeMedida: true, unidadeRotulo: true } },
    },
    orderBy: { insumo: { nome: "asc" } },
  });
  return produtos.map((p) => ({
    id: p.id,
    insumoId: p.insumoId,
    insumo: p.insumo.nome,
    unidade: p.insumo.unidadeMedida,
    nomeEmbalagem: p.nomeEmbalagem,
    pecas: p.pecas,
    conteudo: p.conteudo?.toString() ?? null,
    unidadeConteudo: p.unidadeConteudo,
    fracionavel: p.fracionavel,
    fator: p.fator?.toString() ?? null,
    fatorOrigem: p.fatorOrigem,
    fatorVersao: p.fatorVersao,
    fixo: p.fixo,
    precoReferencia: p.precoReferencia?.toString() ?? null,
    precoReferenciaOrigem: p.precoReferenciaOrigem,
    precoReferenciaEm: p.precoReferenciaEm,
  }));
}

export async function salvarProdutoDoFornecedor(
  ctx: ContextoSessao,
  dados: {
    id?: string;
    fornecedorId: string;
    insumoId: string;
    nomeEmbalagem: string;
    pecas: string;
    conteudo: string;
    unidadeConteudo: Unidade | null;
    fracionavel: boolean;
    fixo: boolean;
    precoReferencia: string;
    precoReferenciaOrigem: string | null;
  },
): Promise<{ id: string; avisoDoFator: string | null }> {
  exigir(ctx, "compras.fornecedores", "cadastrar produtos do fornecedor");

  const [fornecedor, insumo] = await Promise.all([
    db.fornecedor.findFirst({
      where: { id: dados.fornecedorId, organizacaoId: ctx.organizacao.id, excluidoEm: null },
      select: { id: true, nome: true },
    }),
    db.insumo.findFirst({
      where: { id: dados.insumoId, organizacaoId: ctx.organizacao.id, excluidoEm: null },
      select: { id: true, nome: true, unidadeMedida: true },
    }),
  ]);
  if (!fornecedor) throw new Error("Fornecedor não encontrado.");
  if (!insumo) throw new Error("Insumo não encontrado.");

  const nomeEmbalagem = dados.nomeEmbalagem.trim().slice(0, 40) || "Unidade";
  const pecas = dados.pecas.trim() === "" ? 1 : Number(dados.pecas);
  const conteudo = lerNumero(dados.conteudo, CASAS.dezMilesimos);
  const fator = fatorDaEmbalagem(insumo.unidadeMedida, {
    pecas,
    conteudo,
    unidadeConteudo: conteudo === null ? null : dados.unidadeConteudo,
    fracionavel: dados.fracionavel,
  });
  if (!fator.ok && fator.motivo === "invalido") throw new Error(fator.mensagem);

  const preco = lerNumero(dados.precoReferencia, CASAS.centavos);

  const antes = dados.id
    ? await db.fornecedorInsumo.findFirst({
        where: { id: dados.id, organizacaoId: ctx.organizacao.id },
      })
    : null;
  if (dados.id && !antes) throw new Error("Produto do fornecedor não encontrado.");

  const fatorNovo = fator.ok ? paraDecimal(fator.fator, CASAS.dezMilesimos) : null;
  const fatorMudou =
    antes !== null &&
    (antes.fator === null ? fatorNovo !== null : fatorNovo === null ||
      fatorDoBanco(antes.fator) !== fatorDoBanco(fatorNovo));
  const precoMudou =
    preco !== null &&
    (antes?.precoReferencia == null ||
      antes.precoReferencia.toString() !== paraDecimal(preco, CASAS.centavos));

  const campos = {
    nomeEmbalagem,
    pecas,
    conteudo: conteudo === null ? null : paraDecimal(conteudo, CASAS.dezMilesimos),
    unidadeConteudo: conteudo === null ? null : dados.unidadeConteudo,
    fracionavel: dados.fracionavel,
    fator: fatorNovo,
    fatorOrigem: fator.ok ? "cadastro do fornecedor" : fator.mensagem,
    fixo: dados.fixo,
    chaveFixo: dados.fixo ? `${ctx.organizacao.id}:${insumo.id}` : null,
    precoReferencia: preco === null ? null : paraDecimal(preco, CASAS.centavos),
    ...(precoMudou
      ? {
          precoReferenciaEm: new Date(),
          precoReferenciaOrigem:
            dados.precoReferenciaOrigem?.trim().slice(0, 120) || "cadastro",
        }
      : {}),
  };

  try {
    const salvo = antes
      ? await db.fornecedorInsumo.update({
          where: { id: antes.id },
          data: { ...campos, ...(fatorMudou ? { fatorVersao: { increment: 1 } } : {}) },
          select: { id: true },
        })
      : await db.fornecedorInsumo.create({
          data: {
            ...campos,
            organizacaoId: ctx.organizacao.id,
            fornecedorId: fornecedor.id,
            insumoId: insumo.id,
            criadoPorId: ctx.usuario.id,
          },
          select: { id: true },
        });

    await registrar(db, ctx, {
      entidade: "FornecedorInsumo",
      entidadeId: salvo.id,
      acao: antes ? "ALTEROU" : "CRIOU",
      antes: antes && {
        fator: antes.fator?.toString() ?? null,
        fixo: antes.fixo,
        precoReferencia: antes.precoReferencia?.toString() ?? null,
      },
      depois: { fator: fatorNovo, fixo: dados.fixo, precoReferencia: campos.precoReferencia },
    });

    return { id: salvo.id, avisoDoFator: fator.ok ? null : fator.mensagem };
  } catch (erro) {
    if (
      erro instanceof Prisma.PrismaClientKnownRequestError &&
      erro.code === "P2002"
    ) {
      // Com o adaptador do Postgres, o campo que violou a unicidade pode vir em
      // lugares diferentes do `meta`. Procura no objeto inteiro.
      const alvo = JSON.stringify(erro.meta ?? {});
      if (alvo.includes("chaveFixo")) {
        const atual = await db.fornecedorInsumo.findFirst({
          where: { chaveFixo: `${ctx.organizacao.id}:${insumo.id}` },
          select: { fornecedor: { select: { nome: true } } },
        });
        throw new Error(
          `${insumo.nome} já tem fornecedor fixo: ${atual?.fornecedor.nome ?? "outro fornecedor"}. Tire o fixo de lá antes.`,
        );
      }
      throw new Error(
        `${fornecedor.nome} já tem ${insumo.nome} cadastrado com a embalagem "${nomeEmbalagem}".`,
      );
    }
    throw erro;
  }
}

export async function removerProdutoDoFornecedor(ctx: ContextoSessao, id: string) {
  exigir(ctx, "compras.fornecedores", "cadastrar produtos do fornecedor");
  const escrita = await db.fornecedorInsumo.updateMany({
    where: { id, organizacaoId: ctx.organizacao.id },
    data: { ativo: false, fixo: false, chaveFixo: null },
  });
  if (escrita.count !== 1) throw new Error("Produto do fornecedor não encontrado.");
  await registrar(db, ctx, {
    entidade: "FornecedorInsumo",
    entidadeId: id,
    acao: "EXCLUIU",
  });
}

/**
 * O destino das mensagens — o único lugar de onde a fila tira um número.
 *
 * Autorizar exige telefone válido. Mudar o número fica auditado com o antes e
 * o depois: é a informação que responde "por que o pedido foi parar noutro
 * celular?".
 */
export async function configurarDestino(
  ctx: ContextoSessao,
  fornecedorId: string,
  dados: { telefonePedidos: string; autorizado: boolean },
): Promise<void> {
  exigir(ctx, "compras.fornecedores", "configurar o destino das mensagens");

  const antes = await db.fornecedor.findFirst({
    where: { id: fornecedorId, organizacaoId: ctx.organizacao.id, excluidoEm: null },
    select: { telefonePedidos: true, autorizadoMensagens: true },
  });
  if (!antes) throw new Error("Fornecedor não encontrado.");

  const telefone = dados.telefonePedidos.trim()
    ? normalizarTelefone(dados.telefonePedidos)
    : null;
  if (dados.telefonePedidos.trim() && !telefone) {
    throw new Error("Telefone inválido. Use DDD e número, como (84) 99999-0000.");
  }
  if (dados.autorizado && !telefone) {
    throw new Error("Para autorizar mensagens, informe o telefone de pedidos.");
  }

  const autorizou = dados.autorizado && !antes.autorizadoMensagens;
  await db.fornecedor.update({
    where: { id: fornecedorId },
    data: {
      telefonePedidos: telefone,
      autorizadoMensagens: dados.autorizado,
      ...(autorizou ? { autorizadoPorId: ctx.usuario.id, autorizadoEm: new Date() } : {}),
      ...(!dados.autorizado ? { autorizadoPorId: null, autorizadoEm: null } : {}),
    },
  });

  await registrar(db, ctx, {
    entidade: "Fornecedor",
    entidadeId: fornecedorId,
    acao: "ALTEROU",
    antes: { telefonePedidos: antes.telefonePedidos, autorizado: antes.autorizadoMensagens },
    depois: { telefonePedidos: telefone, autorizado: dados.autorizado },
  });
}
