import { pode, type ContextoSessao } from "@/core/sessao/nucleo";
import { SemPermissao } from "@/lib/erros";
import { db } from "@/server/db";

import {
  CASAS,
  NumeroInvalido,
  centavosDigitados,
  paraDecimal,
} from "../schemas/aritmetica";

import { registrar } from "./auditoria";

/**
 * AS ALÇADAS — até quanto cada papel aprova.
 *
 * Mudar uma alçada não a edita: encerra a vigente e cria a VERSÃO seguinte. A
 * aprovação grava qual alçada e qual versão valeu — daqui a um ano dá para
 * saber sob que regra aquele pedido foi aprovado.
 *
 * Decisão de 10/09/2026: começa com o Diretor, sem limite.
 */

export async function listarAlcadas(ctx: ContextoSessao) {
  if (!pode(ctx, "compras.ver")) throw new SemPermissao("ver compras");
  const [papeis, alcadas] = await Promise.all([
    db.papel.findMany({
      where: { organizacaoId: ctx.organizacao.id },
      select: { id: true, nome: true },
      orderBy: { nome: "asc" },
    }),
    db.alcadaDeCompra.findMany({
      where: { organizacaoId: ctx.organizacao.id },
      orderBy: [{ papelId: "asc" }, { versao: "desc" }],
    }),
  ]);
  return papeis.map((papel) => ({
    papel,
    vigente:
      alcadas.find((a) => a.papelId === papel.id && a.chaveVigente !== null) ??
      null,
    historico: alcadas.filter((a) => a.papelId === papel.id),
  }));
}

/**
 * `limite` em texto ("1.500,00"); `null` = sem limite. `remover` encerra a
 * alçada do papel sem criar outra.
 */
export async function salvarAlcada(
  ctx: ContextoSessao,
  papelId: string,
  limite: string | null,
  remover = false,
): Promise<void> {
  if (!pode(ctx, "compras.configurar")) throw new SemPermissao("mudar alçadas");

  const papel = await db.papel.findFirst({
    where: { id: papelId, organizacaoId: ctx.organizacao.id },
    select: { id: true, nome: true },
  });
  if (!papel) throw new Error("Papel não encontrado.");

  let valor: bigint | null = null;
  if (!remover && limite !== null) {
    try {
      valor = centavosDigitados(limite);
    } catch (erro) {
      if (erro instanceof NumeroInvalido) throw new Error(erro.message);
      throw erro;
    }
    if (valor === null || valor <= 0n) {
      throw new Error(
        "Informe um limite maior que zero, ou marque 'sem limite'.",
      );
    }
  }

  const chave = `${ctx.organizacao.id}:${papelId}`;
  await db.$transaction(async (tx) => {
    const vigente = await tx.alcadaDeCompra.findUnique({
      where: { chaveVigente: chave },
    });
    const ultima = await tx.alcadaDeCompra.findFirst({
      where: { organizacaoId: ctx.organizacao.id, papelId },
      orderBy: { versao: "desc" },
      select: { versao: true },
    });
    if (vigente) {
      await tx.alcadaDeCompra.update({
        where: { id: vigente.id },
        data: { chaveVigente: null, encerradaEm: new Date() },
      });
    }
    if (!remover) {
      await tx.alcadaDeCompra.create({
        data: {
          organizacaoId: ctx.organizacao.id,
          papelId,
          limite: valor === null ? null : paraDecimal(valor, CASAS.centavos),
          versao: (ultima?.versao ?? 0) + 1,
          chaveVigente: chave,
          criadoPorId: ctx.usuario.id,
        },
      });
    }
    await registrar(tx, ctx, {
      entidade: "AlcadaDeCompra",
      entidadeId: papelId,
      acao: "ALTEROU",
      antes: vigente
        ? {
            papel: papel.nome,
            limite: vigente.limite?.toString() ?? "sem limite",
            versao: vigente.versao,
          }
        : null,
      depois: remover
        ? { papel: papel.nome, removida: true }
        : {
            papel: papel.nome,
            limite: valor === null ? "sem limite" : valor,
            versao: (ultima?.versao ?? 0) + 1,
          },
    });
  });
}

/** Para o seed: o Diretor começa sem limite, se ainda não tem alçada. */
export async function garantirAlcadaDoDiretor(
  organizacaoId: string,
  papelDiretorId: string,
): Promise<void> {
  const chave = `${organizacaoId}:${papelDiretorId}`;
  const existe = await db.alcadaDeCompra.findFirst({
    where: { organizacaoId, papelId: papelDiretorId },
    select: { id: true },
  });
  if (existe) return;
  await db.alcadaDeCompra.create({
    data: {
      organizacaoId,
      papelId: papelDiretorId,
      limite: null,
      versao: 1,
      chaveVigente: chave,
    },
  });
}
