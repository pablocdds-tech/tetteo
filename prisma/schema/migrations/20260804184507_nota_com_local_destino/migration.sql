-- AlterTable
ALTER TABLE "nota_entrada" ADD COLUMN     "localDestinoId" TEXT;

-- AddForeignKey
ALTER TABLE "nota_entrada" ADD CONSTRAINT "nota_entrada_localDestinoId_fkey" FOREIGN KEY ("localDestinoId") REFERENCES "local_estoque"("id") ON DELETE SET NULL ON UPDATE CASCADE;
