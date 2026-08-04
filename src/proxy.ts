import NextAuth from "next-auth";

import { authConfigBase } from "@/core/auth/config-base";

/**
 * Roda antes de qualquer página, no servidor.
 *
 * Nada no Tetteo é público: só a tela de login e os arquivos estáticos
 * passam; todo o resto exige sessão válida.
 *
 * (No Next.js 16 este arquivo se chamava `middleware.ts`. Foi renomeado para
 * `proxy.ts` — mesma função, nome novo.)
 */
const { auth } = NextAuth(authConfigBase);

export default auth;

export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico|login).*)"],
};
