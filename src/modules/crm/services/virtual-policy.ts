import { z } from "zod";
import type { ContextoSessao } from "@/core/sessao/nucleo";
import { db } from "@/server/db";
import { maskVirtualSecrets } from "@/server/atendimento-canal";
import { canonicalHash, CrmError } from "./campaign-domain";
import {
  authorizeVirtual,
  virtualAudit,
  type VirtualTx,
} from "./virtual-runtime";

// These fields govern style only. Facts, links and successful effects are
// rendered from the approved knowledge and actual scoped tool executions.
const publicText = (maximum: number) =>
  z
    .string()
    .trim()
    .max(maximum)
    .refine(
      (value) =>
        maskVirtualSecrets(value) === value &&
        !/(?:https?:\/\/|www\.|\b[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:\+?\d[\s().-]*){8,}|\b(?:api[_ -]?key|token|senha|password|certificado|cpf)\s*[:=])/i.test(
          value,
        ),
      "Não inclua links, telefones, dados pessoais ou credenciais nas orientações. Use a base operacional para contatos e links.",
    );
const responseText = publicText(500).refine(
  (value) =>
    !/(?:reserv\w*.{0,35}(?:confirmad|criad|cancelad|alterad)|(?:confirmad|criad|cancelad|alterad).{0,35}reserv|(?:chamei|avisei|notifiquei|acionei|encaminhei|transferi)|(?:equipe|gerente|atendente|humano).{0,30}(?:chamad|avisad|notificad|acionad))/i.test(
      value,
    ),
  "Saudação e mensagem de ajuda não podem afirmar reserva, cancelamento ou contato com a equipe. Essas confirmações dependem das ferramentas.",
);
export const virtualPolicyFieldsSchema = z
  .object({
    instructions: publicText(4000),
    tone: z.enum(["ACOLHEDOR", "OBJETIVO"]),
    greeting: responseText,
    fallbackMessage: responseText,
  })
  .strict();
const inputSchema = z.discriminatedUnion("action", [
  virtualPolicyFieldsSchema
    .extend({ storeId: z.string().min(1).max(128), action: z.literal("draft") })
    .strict(),
  z
    .object({
      storeId: z.string().min(1).max(128),
      action: z.literal("approve"),
      versionId: z.string().uuid(),
    })
    .strict(),
]);
type PolicyScope = { organizationId: string; storeId: string };
export async function approvedVirtualPolicy(tx: VirtualTx, scope: PolicyScope) {
  const row = await tx.avAgentPolicy.findFirst({
    where: { ...scope, status: "APPROVED" },
    orderBy: { version: "desc" },
  });
  return row
    ? {
        id: row.id,
        version: row.version,
        ...virtualPolicyFieldsSchema.parse({
          instructions: row.instructions,
          tone: row.tone,
          greeting: row.greeting,
          fallbackMessage: row.fallbackMessage,
        }),
      }
    : null;
}
export async function virtualPolicy(context: ContextoSessao, storeId: string) {
  const scope = await authorizeVirtual(context, storeId);
  const versions = await db.avAgentPolicy.findMany({
    where: { organizationId: scope.organizationId, storeId },
    orderBy: { version: "desc" },
    take: 30,
  });
  const serialize = (row: (typeof versions)[number]) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    approvedAt: row.approvedAt?.toISOString() ?? null,
  });
  // An approved version remains current even after more than 30 drafts.
  const current =
    versions.find((v) => v.status === "APPROVED") ??
    (await db.avAgentPolicy.findFirst({
      where: {
        organizationId: scope.organizationId,
        storeId,
        status: "APPROVED",
      },
      orderBy: { version: "desc" },
    }));
  return {
    versions: versions.map(serialize),
    current: current ? serialize(current) : null,
  };
}
export async function changeVirtualPolicy(
  context: ContextoSessao,
  raw: unknown,
) {
  const data = inputSchema.parse(raw);
  const authorized = await authorizeVirtual(context, data.storeId, true, true);
  const scope = {
    organizationId: authorized.organizationId,
    storeId: data.storeId,
  };
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`av:policy:${scope.organizationId}:${scope.storeId}`}))`;
    if (data.action === "draft") {
      const latest = await tx.avAgentPolicy.aggregate({
        where: scope,
        _max: { version: true },
      });
      const fields = virtualPolicyFieldsSchema.parse({
        instructions: data.instructions,
        tone: data.tone,
        greeting: data.greeting,
        fallbackMessage: data.fallbackMessage,
      });
      const row = await tx.avAgentPolicy.create({
        data: {
          ...scope,
          ...fields,
          authorId: context.usuario.id,
          version: (latest._max.version ?? 0) + 1,
        },
      });
      await virtualAudit(
        tx,
        scope,
        context.usuario.id,
        "POLICY_DRAFT_CREATED",
        {
          versionId: row.id,
          version: row.version,
          contentHash: canonicalHash(fields),
        },
      );
    } else {
      const row = await tx.avAgentPolicy.findFirst({
        where: { ...scope, id: data.versionId },
      });
      if (!row)
        throw new CrmError(
          "POLICY_NOT_FOUND",
          "Versão de orientação indisponível nesta unidade.",
          404,
        );
      virtualPolicyFieldsSchema.parse({
        instructions: row.instructions,
        tone: row.tone,
        greeting: row.greeting,
        fallbackMessage: row.fallbackMessage,
      });
      if (row.status === "APPROVED") return;
      await tx.avAgentPolicy.update({
        where: { id: row.id },
        data: {
          status: "APPROVED",
          approvedAt: new Date(),
          approvedById: context.usuario.id,
        },
      });
      await virtualAudit(tx, scope, context.usuario.id, "POLICY_APPROVED", {
        versionId: row.id,
        version: row.version,
      });
    }
  });
  return virtualPolicy(context, data.storeId);
}
