import { db } from "@/server/db";
import { contextoParaNota } from "./contexto-nota";

const DIA = 24 * 60 * 60_000;

/** Recebe apenas a conversa interna de uma pessoa que ainda pode lançar. */
export async function enfileirarNotaWhatsapp(
  instanciaId: string,
  vinculoId: string,
  entrada: {
    idMensagem: string;
    texto?: string;
    foto: boolean;
    recebidaEm: Date;
  },
): Promise<boolean> {
  const agora = new Date();
  const quando =
    entrada.recebidaEm instanceof Date
      ? entrada.recebidaEm.getTime()
      : Number.NaN;
  if (
    !Number.isFinite(quando) ||
    quando < agora.getTime() - DIA ||
    quando > agora.getTime() + 30_000 ||
    !/^[\w-]{1,200}$/.test(entrada.idMensagem)
  )
    return false;
  const autorizado = await contextoParaNota(instanciaId, vinculoId);
  if (!autorizado) return false;
  const ctx = autorizado.contexto;
  const unidadeId = ctx.unidadeAtiva!.id;
  const texto = entrada.texto?.trim().slice(0, 4000) || null;
  const idExterno = `entrada:${entrada.idMensagem}`;

  return db.$transaction(async (tx) => {
    // O teto é da pessoa, mesmo com mais de um número/canal na organização.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`nota-whatsapp:${ctx.organizacao.id}:${ctx.usuario.id}`}))`;
    const existente = await tx.mensagemNotaWhatsapp.findUnique({
      where: { instanciaId_idExterno: { instanciaId, idExterno } },
      select: { conversa: { select: { vinculoId: true } } },
    });
    if (existente) return existente.conversa.vinculoId === vinculoId;
    const anterior = await tx.conversaNotaWhatsapp.findUnique({
      where: { instanciaId_vinculoId: { instanciaId, vinculoId } },
    });
    if (
      anterior &&
      (anterior.organizacaoId !== ctx.organizacao.id ||
        anterior.unidadeId !== unidadeId ||
        anterior.usuarioId !== ctx.usuario.id)
    )
      return false;
    if (
      !entrada.foto &&
      !anterior?.notaAtivaId &&
      !/^(?:nota|ajuda|resumo|confirmar)\b/i.test(texto ?? "")
    )
      return false;
    const tipo = entrada.foto ? "FOTO" : "TEXTO";
    const quantidade = await tx.mensagemNotaWhatsapp.count({
      where: {
        direcao: "ENTRADA",
        tipo,
        criadoEm: { gte: new Date(agora.getTime() - DIA) },
        conversa: {
          organizacaoId: ctx.organizacao.id,
          usuarioId: ctx.usuario.id,
        },
      },
    });
    if (quantidade >= (entrada.foto ? 20 : 200)) return false;
    const conversa =
      anterior ??
      (await tx.conversaNotaWhatsapp.create({
        data: {
          organizacaoId: ctx.organizacao.id,
          unidadeId,
          usuarioId: ctx.usuario.id,
          instanciaId,
          vinculoId,
        },
      }));
    await tx.mensagemNotaWhatsapp.create({
      data: {
        conversaId: conversa.id,
        instanciaId,
        idExterno,
        direcao: "ENTRADA",
        tipo,
        texto,
        recebidoEm: entrada.recebidaEm,
      },
    });
    return true;
  });
}
