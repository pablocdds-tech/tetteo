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
  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url }),
    // Prisma's default error renderer can include query arguments with customer PII.
    log: [{ emit: "event", level: "error" }],
  });
  client.$on("error", () =>
    console.error("[database] Operação não concluída."),
  );
  return client;
};

const globalParaPrisma = globalThis as unknown as {
  prisma?: ReturnType<typeof criarCliente>;
};

export const db = globalParaPrisma.prisma ?? criarCliente();

if (process.env.NODE_ENV !== "production") globalParaPrisma.prisma = db;
