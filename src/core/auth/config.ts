import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import bcrypt from "bcryptjs";
import { z } from "zod";

import { db } from "@/server/db";

import { authConfigBase } from "./config-base";
import { googleConfigurado } from "./politicas";
import { resolverUsuarioGoogle } from "./google";
import { permitirTentativa } from "./limites";

/**
 * Configuração COMPLETA — a que roda no servidor.
 *
 * O Login resolve apenas UMA pergunta: quem é a pessoa. O que ela pode fazer,
 * e em qual unidade, é responsabilidade do sistema de permissões — que roda
 * depois, sobre a resposta daqui.
 *
 * O token dura 12h. O servidor confere status e versão no banco: redefinir a
 * senha ou suspender a conta invalida também as sessões emitidas anteriormente.
 */

const credenciais = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  senha: z.string().min(1).max(200),
});

export const authConfig = {
  ...authConfigBase,

  providers: [
    ...(googleConfigurado()
      ? [
          Google({
            clientId: process.env.AUTH_GOOGLE_ID,
            clientSecret: process.env.AUTH_GOOGLE_SECRET,
            authorization: {
              params: {
                scope: "openid email profile",
                prompt: "select_account",
              },
            },
          }),
        ]
      : []),
    Credentials({
      credentials: {
        email: {},
        senha: {},
      },
      async authorize(dados, request) {
        const analise = credenciais.safeParse(dados);
        if (!analise.success) return null;

        const { email, senha } = analise.data;
        const ip =
          request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
          "desconhecido";
        const porIp = await permitirTentativa("login-ip", ip, 50);
        const porEmail = await permitirTentativa("login-email", email, 10);
        if (!porIp || !porEmail) return null;

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
  callbacks: {
    ...authConfigBase.callbacks,
    async signIn({ user, account, profile }) {
      if (account?.provider !== "google") return true;
      const usuario = await resolverUsuarioGoogle(profile ?? {});
      if (!usuario) return "/login?error=ContaIndisponivel";
      user.id = usuario.id;
      user.name = usuario.nome;
      user.email = usuario.email;
      user.image = usuario.avatarUrl;
      return true;
    },
    async jwt({ token, user }) {
      const id = user?.id ?? token.usuarioId;
      if (typeof id !== "string") return null;
      const usuario = await db.usuario.findUnique({
        where: { id },
        select: { status: true, excluidoEm: true, versaoSessao: true },
      });
      if (!usuario || usuario.excluidoEm || usuario.status !== "ATIVO")
        return null;
      if (!user && (token.versaoSessao ?? 0) !== usuario.versaoSessao)
        return null;
      token.usuarioId = id;
      token.versaoSessao = usuario.versaoSessao;
      return token;
    },
  },
} satisfies NextAuthConfig;
