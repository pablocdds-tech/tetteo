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

/**
 * As exceções, e o motivo de cada uma.
 *
 * `api/auth`    — o próprio login precisa acontecer antes de haver sessão
 * `_next/*`     — arquivos estáticos, sem dado dentro
 * `login`       — a tela de entrar
 * `api/severina` — MÁQUINA, não gente
 *
 * A última é a que merece explicação. O relógio da Severina é chamado por uma
 * tarefa agendada às 7h da manhã: não existe navegador, não existe cookie, e
 * não existe ninguém para ser redirecionado ao login. Sem esta exceção, a
 * resposta é um 307 para `/login` — que o `curl` recebe calado, e a cobrança
 * simplesmente nunca sai.
 *
 * Isso NÃO abre a rota: ela exige `x-severina-segredo` e recusa com 401 sem
 * ele. A autenticação dela é outra, não é nenhuma.
 *
 * `api/whatsapp` — também máquina: é a Evolution entregando webhook. A rota
 * exige o passe HS256 assinado com a senha do servidor, recusa o que chegou
 * pelo proxy público, e só aceita instância que está no cadastro.
 *
 * `api/compras/tick` — o relógio de Compras, pelo mesmo motivo: máquina, e
 *                      com o próprio segredo (`x-compras-segredo`).
 * `fornecedor/`      — a página onde o FORNECEDOR responde a cotação. Ele não
 *                      tem conta no Tetteo; quem autentica é o código do link,
 *                      conferido a cada leitura e a cada envio. A página não
 *                      mostra nada sem um código válido.
 */
export const config = {
  matcher: [
    "/((?!api/auth|api/severina|api/whatsapp|api/compras/tick|fornecedor/|_next/static|_next/image|favicon.ico|login).*)",
  ],
};
