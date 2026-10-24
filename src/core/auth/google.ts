import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { identidadeGoogle } from "./politicas";

export async function resolverUsuarioGoogle(
  perfil: Parameters<typeof identidadeGoogle>[0],
) {
  const identidade = identidadeGoogle(perfil);
  if (!identidade) return null;
  // A associação depende do e-mail verificado pelo Google e da identidade imutável.
  // Nenhum acesso, papel ou organização é criado por este fluxo.
  try {
    const existente = await db.usuario.findUnique({
      where: { email: identidade.email },
    });
    if (existente) {
      if (
        existente.excluidoEm ||
        existente.status !== "ATIVO" ||
        (existente.googleSubject &&
          existente.googleSubject !== identidade.subject)
      )
        return null;
      const atualizado = await db.usuario.updateMany({
        where: {
          id: existente.id,
          status: "ATIVO",
          excluidoEm: null,
          OR: [{ googleSubject: null }, { googleSubject: identidade.subject }],
        },
        data: { googleSubject: identidade.subject, ultimoAcessoEm: new Date() },
      });
      return atualizado.count === 1 ? existente : null;
    }
    return await db.usuario.create({
      data: {
        nome: identidade.nome,
        email: identidade.email,
        googleSubject: identidade.subject,
        status: "ATIVO",
        ultimoAcessoEm: new Date(),
      },
    });
  } catch (erro) {
    // Uma corrida entre callbacks não pode vincular a conta a outra identidade.
    if (
      erro instanceof Prisma.PrismaClientKnownRequestError &&
      erro.code === "P2002"
    )
      return null;
    throw erro;
  }
}
