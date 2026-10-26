import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import type { ContextoSessao } from "@/core/sessao/nucleo";
import { cifrar, hash } from "./operacao-seguranca";
import { ambienteOperacao } from "./operacao-config";

export type EscopoSaipos = {
  organizacaoId: string;
  unidadeId: string;
  usuarioId?: string;
};
export async function escopoOperacao(
  contexto: ContextoSessao,
): Promise<EscopoSaipos> {
  if (
    !contexto.ehDiretor ||
    !contexto.unidadeAtiva ||
    !contexto.unidadesVisiveis.some((u) => u.id === contexto.unidadeAtiva?.id)
  )
    throw new Error("Selecione uma unidade autorizada como diretor.");
  const scope = {
    organizacaoId: contexto.organizacao.id,
    unidadeId: contexto.unidadeAtiva.id,
    usuarioId: contexto.usuario.id,
  };
  await validarUnidade(scope);
  return scope;
}
export async function validarUnidade(scope: EscopoSaipos) {
  if (
    !(await db.unidade.findFirst({
      where: {
        id: scope.unidadeId,
        organizacaoId: scope.organizacaoId,
        ativa: true,
        excluidoEm: null,
        organizacao: { ativa: true, excluidoEm: null },
      },
      select: { id: true },
    }))
  )
    throw new Error("Unidade indisponível.");
}
export async function escopoMaquina(unidadeId: string): Promise<EscopoSaipos> {
  const unit = await db.unidade.findUnique({
    where: { id: unidadeId },
    select: { id: true, organizacaoId: true },
  });
  if (!unit) throw new Error("Unidade não configurada.");
  const scope = { organizacaoId: unit.organizacaoId, unidadeId: unit.id };
  await validarUnidade(scope);
  return scope;
}
export function contextoCifra(scope: EscopoSaipos) {
  return `saipos:${scope.organizacaoId}:${scope.unidadeId}`;
}
export async function auditar(
  tx: Prisma.TransactionClient,
  scope: EscopoSaipos,
  id: string,
  estado: string,
) {
  await tx.auditoria.create({
    data: {
      ...scope,
      entidade: "SaiposOperacao",
      entidadeId: id,
      acao: "ALTEROU",
      valoresDepois: { estado },
    },
  });
}
export async function reservar(
  scope: EscopoSaipos,
  tipo: string,
  chave: string,
  referencia: string,
  payload: unknown,
) {
  const ambiente = ambienteOperacao(),
    digest = hash(JSON.stringify(payload));
  const unique = {
    organizacaoId: scope.organizacaoId,
    unidadeId: scope.unidadeId,
    ambiente,
    tipo,
    chave,
  };
  try {
    const row = await db.$transaction(
      async (tx) => {
        const result = await tx.saiposOperacao.create({
          data: {
            ...unique,
            referencia,
            hash: digest,
            estado: "ENVIANDO",
            payloadCifrado: cifrar(payload, contextoCifra(scope)),
          },
        });
        await auditar(tx, scope, result.id, "ENVIANDO");
        return result;
      },
      { maxWait: 500, timeout: 2500 },
    );
    return { row, nova: true };
  } catch (e) {
    if (
      !(e instanceof Prisma.PrismaClientKnownRequestError) ||
      e.code !== "P2002"
    )
      throw e;
    const row = await db.saiposOperacao.findUniqueOrThrow({
      where: { organizacaoId_unidadeId_ambiente_tipo_chave: unique },
    });
    if (row.hash !== digest)
      throw new Error(
        "Identificador já utilizado com outro conteúdo. Confira a operação existente.",
      );
    return { row, nova: false };
  }
}
export async function concluir(
  scope: EscopoSaipos,
  id: string,
  estado: string,
  response?: unknown,
  erro?: string,
) {
  await db.$transaction(async (tx) => {
    const updated = await tx.saiposOperacao.updateMany({
      where: {
        id,
        organizacaoId: scope.organizacaoId,
        unidadeId: scope.unidadeId,
        excluidoEm: null,
      },
      data: {
        estado,
        erro: erro ?? null,
        ...(response !== undefined
          ? { respostaCifrada: cifrar(response, contextoCifra(scope)) }
          : {}),
        versao: { increment: 1 },
      },
    });
    if (!updated.count)
      throw new Error("Operação não encontrada nesta unidade.");
    await auditar(tx, scope, id, estado);
  });
}
