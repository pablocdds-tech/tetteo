import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";

import { db } from "@/server/db";

import { authConfigBase } from "./config-base";

/**
 * Configuração COMPLETA — a que roda no servidor.
 *
 * O Login resolve apenas UMA pergunta: quem é a pessoa. O que ela pode fazer,
 * e em qual unidade, é responsabilidade do sistema de permissões — que roda
 * depois, sobre a resposta daqui.
 *
 * A sessão viaja num token assinado, não em tabela, o que dispensa consultar o
 * banco a cada requisição. O preço: revogar acesso não é instantâneo, espera o
 * token expirar. Por isso a validade é curta (12h) e a tabela `sessao` já
 * existe no schema — a revogação imediata entra quando houver equipe de
 * verdade usando o sistema.
 */

const credenciais = z.object({
  email: z.email(),
  senha: z.string().min(1),
});

export const authConfig = {
  ...authConfigBase,

  providers: [
    Credentials({
      credentials: {
        email: {},
        senha: {},
      },
      async authorize(dados) {
        const analise = credenciais.safeParse(dados);
        if (!analise.success) return null;

        const { email, senha } = analise.data;

        const usuario = await db.usuario.findUnique({
          where: { email: email.toLowerCase().trim() },
          select: {
            id: true,
            nome: true,
            email: true,
            avatarUrl: true,
            senhaHash: true,
            status: true,
            excluidoEm: true,
          },
        });

        // Mesma resposta para "não existe", "sem senha", "excluído",
        // "suspenso" e "senha errada": quem fica tentando não descobre quais
        // e-mails existem no sistema.
        if (
          !usuario ||
          !usuario.senhaHash ||
          usuario.excluidoEm ||
          usuario.status !== "ATIVO"
        ) {
          return null;
        }

        const confere = await bcrypt.compare(senha, usuario.senhaHash);
        if (!confere) return null;

        await db.usuario.update({
          where: { id: usuario.id },
          data: { ultimoAcessoEm: new Date() },
        });

        return {
          id: usuario.id,
          name: usuario.nome,
          email: usuario.email,
          image: usuario.avatarUrl,
        };
      },
    }),
  ],
} satisfies NextAuthConfig;
