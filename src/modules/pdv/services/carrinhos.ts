import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { pode, type ContextoSessao } from "@/core/sessao/nucleo";
import { SemPermissao } from "@/lib/erros";
import { db } from "@/server/db";
import type {
  CarrinhoSalvo,
  ConteudoCarrinho,
  ResumoCarrinho,
  RetomadaCarrinho,
} from "../carrinho-types";
import { ErroPdv } from "../schemas/erro";
import {
  atualizarConteudoCarrinho,
  esquemaConteudoCarrinho,
  esquemaDescartarCarrinho,
  esquemaIdentificarCarrinho,
  esquemaSalvarCarrinho,
} from "../schemas/carrinho";
import { catalogo, exigirEscopo } from "./pdv";

type Transacao = Prisma.TransactionClient;
type EscopoCarrinho = {
  organizacaoId: string;
  unidadeId: string;
  usuarioId: string;
};
async function escopoCarrinho(ctx: ContextoSessao): Promise<EscopoCarrinho> {
  return {
    ...(await exigirEscopo(ctx, "pdv.vender")),
    usuarioId: ctx.usuario.id,
  };
}
async function travar(tx: Transacao, escopo: EscopoCarrinho) {
  // A mesma chave de finalizarVenda evita salvar/descartar durante a conclusão.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`pdv:${escopo.organizacaoId}:${escopo.unidadeId}`},0))`;
}
function comoSalvo(c: Prisma.PdvCarrinhoGetPayload<object>): CarrinhoSalvo {
  return {
    id: c.id,
    versao: c.versao,
    nome: c.nome,
    atualizadoEm: c.atualizadoEm.toISOString(),
    conteudo: esquemaConteudoCarrinho.parse(c.conteudo),
  };
}
async function conferirCliente(
  tx: Transacao,
  ctx: ContextoSessao,
  unidadeId: string,
  conteudo: ConteudoCarrinho,
) {
  if (!conteudo.clienteId) return;
  if (!pode(ctx, "crm.ver"))
    throw new SemPermissao("consultar clientes do CRM");
  if (
    !(await tx.crmContact.findFirst({
      where: {
        id: conteudo.clienteId,
        storeId: unidadeId,
        active: true,
        mergedIntoId: null,
      },
      select: { id: true },
    }))
  )
    throw new ErroPdv(
      "Cliente indisponível nesta unidade. O carrinho original foi preservado.",
    );
}
async function auditar(
  tx: Transacao,
  escopo: EscopoCarrinho,
  id: string,
  antes: { versao: number; status: string } | null,
  depois: { versao: number; status: string },
) {
  await tx.auditoria.create({
    data: {
      ...escopo,
      entidade: "PdvCarrinho",
      entidadeId: id,
      acao: antes ? "ALTEROU" : "CRIOU",
      valoresAntes: antes ?? Prisma.JsonNull,
      valoresDepois: depois,
    },
  });
}
export async function listarCarrinhos(
  ctx: ContextoSessao,
): Promise<ResumoCarrinho[]> {
  const escopo = await escopoCarrinho(ctx);
  const carrinhos = await db.pdvCarrinho.findMany({
    where: { ...escopo, status: "ATIVO" },
    orderBy: { atualizadoEm: "desc" },
    take: 20,
  });
  return carrinhos.map((c) => {
    const conteudo = esquemaConteudoCarrinho.parse(c.conteudo);
    return {
      id: c.id,
      versao: c.versao,
      nome: c.nome,
      atualizadoEm: c.atualizadoEm.toISOString(),
      quantidadeItens: conteudo.itens.reduce((s, i) => s + i.quantidade, 0),
    };
  });
}
export async function salvarCarrinho(
  ctx: ContextoSessao,
  entrada: unknown,
): Promise<CarrinhoSalvo> {
  const escopo = await escopoCarrinho(ctx);
  const dados = esquemaSalvarCarrinho.parse(entrada);
  const hash = createHash("sha256")
    .update(JSON.stringify({ nome: dados.nome, conteudo: dados.conteudo }))
    .digest("hex");
  return db.$transaction(async (tx) => {
    await travar(tx, escopo);
    await conferirCliente(tx, ctx, escopo.unidadeId, dados.conteudo);
    const existente = await tx.pdvCarrinho.findFirst({
      where: { ...escopo, id: dados.id },
    });
    if (existente) {
      if (existente.status !== "ATIVO")
        throw new ErroPdv(
          "Este carrinho já foi concluído ou descartado. Atualize a lista.",
        );
      // Repetir o mesmo salvamento após resposta perdida recupera sua confirmação.
      if (
        existente.versao === dados.versao + 1 &&
        existente.ultimoHash === hash
      )
        return comoSalvo(existente);
      if (existente.versao !== dados.versao)
        throw new ErroPdv(
          "Este carrinho mudou em outra aba. Retome a versão atual antes de salvar.",
        );
    } else {
      if (dados.versao !== 0)
        throw new ErroPdv(
          "Carrinho não encontrado para este operador e unidade.",
        );
      if (
        (await tx.pdvCarrinho.count({
          where: { ...escopo, status: "ATIVO" },
        })) >= 20
      )
        throw new ErroPdv(
          "Você já tem 20 carrinhos salvos nesta unidade. Conclua ou descarte um antes de salvar outro.",
        );
    }
    atualizarConteudoCarrinho(
      dados.conteudo,
      await catalogo(tx, escopo.organizacaoId),
    );
    const nome = dados.nome || "Carrinho salvo";
    const conteudo = JSON.parse(
      JSON.stringify(dados.conteudo),
    ) as Prisma.InputJsonValue;
    const salvo = existente
      ? await tx.pdvCarrinho.update({
          where: { id: existente.id },
          data: { nome, conteudo, ultimoHash: hash, versao: { increment: 1 } },
        })
      : await tx.pdvCarrinho.create({
          data: { id: dados.id, ...escopo, nome, conteudo, ultimoHash: hash },
        });
    await auditar(
      tx,
      escopo,
      salvo.id,
      existente ? { versao: existente.versao, status: existente.status } : null,
      { versao: salvo.versao, status: salvo.status },
    );
    return comoSalvo(salvo);
  });
}
export async function retomarCarrinho(
  ctx: ContextoSessao,
  entrada: unknown,
): Promise<RetomadaCarrinho> {
  const escopo = await escopoCarrinho(ctx);
  const dados = esquemaIdentificarCarrinho.parse(entrada);
  return db.$transaction(async (tx) => {
    const registro = await tx.pdvCarrinho.findFirst({
      where: { ...escopo, id: dados.id, status: "ATIVO" },
    });
    if (!registro)
      throw new ErroPdv("Carrinho indisponível para este operador e unidade.");
    const carrinho = comoSalvo(registro);
    await conferirCliente(tx, ctx, escopo.unidadeId, carrinho.conteudo);
    const produtos = await catalogo(tx, escopo.organizacaoId);
    const atualizado = atualizarConteudoCarrinho(carrinho.conteudo, produtos);
    return {
      carrinho: { ...carrinho, conteudo: atualizado.conteudo },
      produtos,
      avisos: atualizado.avisos,
    };
  });
}
export async function descartarCarrinho(
  ctx: ContextoSessao,
  entrada: unknown,
): Promise<void> {
  const escopo = await escopoCarrinho(ctx);
  const dados = esquemaDescartarCarrinho.parse(entrada);
  await db.$transaction(async (tx) => {
    await travar(tx, escopo);
    const registro = await tx.pdvCarrinho.findFirst({
      where: { ...escopo, id: dados.id },
    });
    if (!registro)
      throw new ErroPdv("Carrinho indisponível para este operador e unidade.");
    if (
      registro.status === "DESCARTADO" &&
      registro.versao === dados.versao + 1
    )
      return;
    if (registro.status !== "ATIVO")
      throw new ErroPdv("Este carrinho já foi concluído ou descartado.");
    if (registro.versao !== dados.versao)
      throw new ErroPdv(
        "Este carrinho mudou em outra aba. Atualize a lista antes de descartar.",
      );
    const atualizado = await tx.pdvCarrinho.update({
      where: { id: registro.id },
      data: {
        status: "DESCARTADO",
        descartadoEm: new Date(),
        versao: { increment: 1 },
      },
    });
    await auditar(
      tx,
      escopo,
      registro.id,
      { versao: registro.versao, status: registro.status },
      { versao: atualizado.versao, status: atualizado.status },
    );
  });
}
