import type { NextAuthConfig } from "next-auth";

/**
 * Configuração LEVE — a que o middleware usa.
 *
 * O middleware roda num ambiente restrito, sem acesso a banco nem a bibliotecas
 * que dependem do Node. Por isso ele só recebe o que precisa para responder
 * UMA pergunta: "esta requisição tem sessão válida?".
 *
 * A verificação de e-mail e senha, que precisa do banco, vive em `config.ts` e
 * só roda no servidor completo.
 */
export const authConfigBase = {
  session: {
    strategy: "jwt",
    maxAge: 60 * 60 * 12, // 12 horas — um turno
  },

  pages: {
    signIn: "/login",
  },

  providers: [],

  callbacks: {
    authorized({ auth }) {
      return Boolean(auth?.user);
    },
    jwt({ token, user }) {
      if (user?.id) token.usuarioId = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.usuarioId) session.user.id = token.usuarioId as string;
      return session;
    },
  },
} satisfies NextAuthConfig;
