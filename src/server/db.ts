import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

/**
 * A conexão com o banco.
 *
 * Em desenvolvimento o Next.js recarrega o código a cada alteração. Sem o
 * cache global abaixo, cada recarga abriria uma conexão nova e o banco
 * esgotaria o limite em poucos minutos.
 */

const criarCliente = () => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL não configurada. Em desenvolvimento, copie .env.example para .env.local e preencha.",
    );
  }
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: url }),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
};

const globalParaPrisma = globalThis as unknown as {
  prisma?: ReturnType<typeof criarCliente>;
};

export const db = globalParaPrisma.prisma ?? criarCliente();

if (process.env.NODE_ENV !== "production") globalParaPrisma.prisma = db;
