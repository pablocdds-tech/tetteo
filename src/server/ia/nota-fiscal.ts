import { db } from "@/server/db";

import {
  privateVirtualModelConfiguration,
  MODEL_TEST_VALID_MS,
} from "./modelo-atendimento-config";
import {
  gerarLeituraNota,
  MAX_SAIDA_NOTA_TOKENS,
  prepararLeituraNota,
  type LeituraNotaFiscal,
} from "./nota-fiscal-leitura";

export {
  leituraNotaFiscalSchema,
  type LeituraNotaFiscal,
} from "./nota-fiscal-leitura";

/**
 * Persiste a reserva ANTES da geração paga. Uma falha conserva a reserva e
 * impede repetir a cobrança. O orçamento é compartilhado com o atendimento.
 */
export async function lerNotaFiscalFoto(
  scope: { organizationId: string; storeId: string; solicitacaoId: string },
  foto: { bytes: Uint8Array; tipo: string },
): Promise<LeituraNotaFiscal> {
  const config = await privateVirtualModelConfiguration({
    organizationId: scope.organizationId,
    storeId: scope.storeId,
  });
  if (
    !config.enabled ||
    !config.configured ||
    ![config.inputRate, config.outputRate].every(
      (rate) => Number.isSafeInteger(rate) && rate >= 0,
    )
  )
    throw new Error(
      "Configure, teste e ative o Gemini desta unidade antes de enviar notas por foto.",
    );

  const preparado = await prepararLeituraNota(foto, config);
  const limite = Math.ceil(
    (preparado.entradaTokens * config.inputRate +
      MAX_SAIDA_NOTA_TOKENS * config.outputRate) /
      1_000_000,
  );
  if (!Number.isSafeInteger(limite) || limite < 0 || limite > 2_147_483_647)
    throw new Error("O limite de custo da leitura precisa ser revisto.");
  const tentadaEm = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`av:model:${scope.organizationId}:${scope.storeId}`},0))`;
    const atual = await tx.avModelConfiguration.findUnique({
      where: {
        organizationId_storeId: {
          organizationId: scope.organizationId,
          storeId: scope.storeId,
        },
      },
    });
    if (
      config.source === "DATABASE"
        ? !atual ||
          !atual.enabled ||
          atual.revision !== config.revision ||
          !atual.ratesConfirmed ||
          atual.testState !== "PASSED" ||
          atual.testedRevision !== atual.revision ||
          !atual.testedAt ||
          atual.testedAt.getTime() <= Date.now() - MODEL_TEST_VALID_MS
        : !!atual
    )
      throw new Error(
        "A configuração do Gemini mudou. Confira a conexão antes de tentar novamente.",
      );
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`virtual-budget:${scope.organizationId}:${scope.storeId}`},0))`;
    const nota = await tx.notaFiscalWhatsapp.findFirst({
      where: {
        id: scope.solicitacaoId,
        organizacaoId: scope.organizationId,
        unidadeId: scope.storeId,
      },
      select: { id: true, leituraTentadaEm: true, criadoEm: true },
    });
    if (!nota || nota.leituraTentadaEm)
      throw new Error(
        "Esta leitura já foi tentada. Confira a nota antes de enviar outra foto.",
      );
    const desde = new Date(Date.now() - 86_400_000);
    if (nota.criadoEm < desde)
      throw new Error(
        "Esta foto expirou. Envie novamente para iniciar uma nova conferência.",
      );
    const escopo = {
      organizationId: scope.organizationId,
      storeId: scope.storeId,
    };
    const [contas, turnos, provas, notas] = await Promise.all([
      tx.avChannelAccount.findMany({
        where: escopo,
        select: {
          maxTurnCostMicros: true,
          dailyBudgetMicros: true,
          circuitUntil: true,
        },
      }),
      tx.avAgentRun.aggregate({
        where: { ...escopo, createdAt: { gte: desde } },
        _sum: { costMicros: true },
      }),
      tx.avModelProbe.aggregate({
        where: { ...escopo, createdAt: { gte: desde } },
        _sum: { costMicros: true },
      }),
      tx.notaFiscalWhatsapp.aggregate({
        where: {
          organizacaoId: scope.organizationId,
          unidadeId: scope.storeId,
          criadoEm: { gte: desde },
        },
        _sum: { custoMicros: true },
      }),
    ]);
    const porLeitura = contas.length
      ? Math.min(...contas.map((conta) => conta.maxTurnCostMicros))
      : 100_000;
    const porDia = contas.length
      ? Math.min(...contas.map((conta) => conta.dailyBudgetMicros))
      : 5_000_000;
    if (
      limite > porLeitura ||
      (turnos._sum.costMicros ?? 0) +
        (provas._sum.costMicros ?? 0) +
        (notas._sum.custoMicros ?? 0) +
        limite >
        porDia ||
      contas.some(
        (conta) => conta.circuitUntil && conta.circuitUntil > new Date(),
      )
    )
      throw new Error(
        "O limite de custo da unidade foi atingido. A leitura por foto ficou pendente.",
      );
    const reservada = await tx.notaFiscalWhatsapp.updateMany({
      where: {
        id: nota.id,
        organizacaoId: scope.organizationId,
        unidadeId: scope.storeId,
        leituraTentadaEm: null,
      },
      data: { custoMicros: limite, leituraTentadaEm: new Date() },
    });
    if (!reservada.count)
      throw new Error("Esta leitura já está em processamento.");
    return tx.notaFiscalWhatsapp.findUniqueOrThrow({
      where: { id: nota.id },
      select: { leituraTentadaEm: true },
    });
  });

  const resultado = await gerarLeituraNota(preparado, config);
  if (resultado.custoMicros > limite)
    throw new Error(
      "A leitura excedeu o limite reservado. Confira a configuração do modelo.",
    );
  await db.notaFiscalWhatsapp.updateMany({
    where: {
      id: scope.solicitacaoId,
      organizacaoId: scope.organizationId,
      unidadeId: scope.storeId,
      custoMicros: limite,
      leituraTentadaEm: tentadaEm.leituraTentadaEm,
    },
    data: { custoMicros: resultado.custoMicros, tokens: resultado.tokens },
  });
  return resultado.leitura;
}
