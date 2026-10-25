import bcrypt from "bcryptjs";
import { db } from "@/server/db";
import { enviarRecuperacao } from "./email";
import { permitirTentativa } from "./limites";
import {
  criarTokenRecuperacao,
  emailDeLogin,
  hashSegredo,
  recuperacaoConfigurada,
  senhaNova,
  tokenDeRecuperacao,
  urlPublica,
} from "./politicas";

export const RESPOSTA_RECUPERACAO =
  "Se houver uma conta ativa com esse e-mail, você receberá um link para redefinir a senha. Confira também o spam.";

export async function solicitarRecuperacao(emailBruto: string, ip: string) {
  const email = emailDeLogin.parse(emailBruto);
  if (!recuperacaoConfigurada()) throw new Error("RECUPERACAO_INDISPONIVEL");
  const porIp = await permitirTentativa("recuperacao-ip", ip, 10);
  const porEmail = await permitirTentativa("recuperacao-email", email, 3);
  if (!porIp || !porEmail) return;

  const usuario = await db.usuario.findFirst({
    where: { email, status: "ATIVO", excluidoEm: null },
    select: { id: true },
  });
  if (!usuario) return;

  const { token, tokenHash, expiraEm } = criarTokenRecuperacao();
  const registro = await db.recuperacaoSenha.create({
    data: { usuarioId: usuario.id, tokenHash, expiraEm },
  });
  const link = new URL("/redefinir-senha", urlPublica());
  link.searchParams.set("token", token);
  try {
    await enviarRecuperacao(email, link.href);
  } catch {
    await db.recuperacaoSenha.delete({ where: { id: registro.id } });
    // A resposta pública continua idêntica para conta existente e inexistente.
    console.error("[auth/recuperacao] Não foi possível entregar o e-mail.");
  }
}

export async function linkRecuperacaoValido(token: string) {
  if (!tokenDeRecuperacao.safeParse(token).success) return false;
  return Boolean(
    await db.recuperacaoSenha.findFirst({
      where: {
        tokenHash: hashSegredo(token),
        usadoEm: null,
        expiraEm: { gt: new Date() },
        usuario: { status: "ATIVO", excluidoEm: null },
      },
      select: { id: true },
    }),
  );
}

export async function concluirRecuperacao(
  tokenBruto: string,
  senhaBruta: string,
  ip: string,
) {
  const token = tokenDeRecuperacao.parse(tokenBruto);
  const senha = senhaNova.parse(senhaBruta);
  if (!(await permitirTentativa("redefinicao-ip", ip, 15)))
    throw new Error("LIMITE_RECUPERACAO");
  const tokenHash = hashSegredo(token);
  const registro = await db.recuperacaoSenha.findUnique({
    where: { tokenHash },
    select: { id: true, usuarioId: true },
  });
  if (!registro) throw new Error("LINK_INVALIDO");
  const senhaHash = await bcrypt.hash(senha, 12);

  await db.$transaction(
    async (tx) => {
      // Serializa redefinições da mesma conta, inclusive com links distintos.
      const ativo = await tx.usuario.updateMany({
        where: { id: registro.usuarioId, status: "ATIVO", excluidoEm: null },
        data: { versaoSessao: { increment: 1 } },
      });
      if (ativo.count !== 1) throw new Error("LINK_INVALIDO");
      const consumido = await tx.recuperacaoSenha.updateMany({
        where: { id: registro.id, usadoEm: null, expiraEm: { gt: new Date() } },
        data: { usadoEm: new Date() },
      });
      if (consumido.count !== 1) throw new Error("LINK_INVALIDO");
      await tx.usuario.update({
        where: { id: registro.usuarioId },
        data: { senhaHash },
      });
      await tx.recuperacaoSenha.updateMany({
        where: { usuarioId: registro.usuarioId, usadoEm: null },
        data: { usadoEm: new Date() },
      });
      await tx.sessao.updateMany({
        where: { usuarioId: registro.usuarioId, revogadaEm: null },
        data: { revogadaEm: new Date() },
      });
    },
    { maxWait: 10_000, timeout: 15_000 },
  );
}
