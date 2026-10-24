import { db } from "@/server/db";
import { hashSegredo } from "./politicas";

/** Uma escrita atômica por janela; funciona também com várias réplicas. */
export async function permitirTentativa(
  tipo: string,
  identidade: string,
  maximo: number,
  janelaMs = 15 * 60_000,
) {
  const agora = Date.now();
  const janela = Math.floor(agora / janelaMs);
  const chave = hashSegredo(`${tipo}:${identidade}:${janela}`);
  const contador = await db.limiteAutenticacao.upsert({
    where: { chave },
    create: { chave, expiraEm: new Date((janela + 1) * janelaMs) },
    update: { tentativas: { increment: 1 } },
    select: { tentativas: true },
  });
  await db.limiteAutenticacao.deleteMany({
    where: { expiraEm: { lt: new Date(agora - janelaMs) } },
  });
  return contador.tentativas <= maximo;
}
