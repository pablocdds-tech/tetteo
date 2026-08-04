import NextAuth from "next-auth";

import { authConfigBase } from "@/core/auth/config-base";

/**
 * Nada no Tetteo é público. O único caminho aberto é a tela de login e os
 * arquivos estáticos — todo o resto exige sessão.
 */
export const { auth: middleware } = NextAuth(authConfigBase);

export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico|login).*)"],
};
