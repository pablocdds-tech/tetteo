import { Prisma } from "@prisma/client";
import { db } from "./db";

/** Reexecuta somente transações abortadas pelo controle de concorrência. */
export async function transacaoSerializavel<T>(
  operacao: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let tentativa = 0; ; tentativa++) {
    try {
      return await db.$transaction(operacao, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 20000,
      });
    } catch (e) {
      // SELECT ... FOR UPDATE via queryRaw entrega o SQLSTATE em P2010.
      const adaptador =
        e instanceof Prisma.PrismaClientKnownRequestError
          ? (e.meta?.driverAdapterError as
              { cause?: { originalCode?: string } } | undefined)
          : undefined;
      const conflito =
        e instanceof Prisma.PrismaClientKnownRequestError &&
        (e.code === "P2034" ||
          (e.code === "P2010" &&
            ["40001", "40P01"].includes(
              String(e.meta?.code ?? adaptador?.cause?.originalCode),
            )));
      if (tentativa < 3 && conflito) continue;
      throw e;
    }
  }
}
