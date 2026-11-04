/** Diagnóstico privado e explícito. Nunca inicia workers nem ativa o canal. */
import { z } from "zod";

const inputSchema = z
  .object({
    phase: z.enum(["prepare", "send_input", "reply", "reconcile", "status"]),
    organizationId: z.string().min(1).max(128),
    storeId: z.string().min(1).max(128),
    accountId: z.string().uuid(),
    actorId: z.string().min(1).max(128),
    testerInstanceId: z.string().min(1).max(128),
    originTestId: z.string().uuid(),
    requestId: z.string().uuid(),
  })
  .strict();
type Input = z.infer<typeof inputSchema>;
const outputSchema = z
  .object({
    requestId: z.string().uuid(),
    state: z.enum([
      "PREPARED",
      "INPUT_UNCERTAIN",
      "SENDING",
      "ACCEPTED",
      "DELIVERED",
      "READ",
      "UNCERTAIN",
      "FAILED",
      "EXPIRED",
    ]),
    testId: z.string().uuid().nullable(),
    delivered: z.boolean(),
    observed: z.boolean(),
    nameSource: z
      .enum([
        "CUSTOMER_CORRECTION",
        "CRM_VERIFIED",
        "DEVICE_CONTACT",
        "PROVIDER_CONTACT",
        "CRM_PHONE_HINT",
        "WHATSAPP_PROFILE",
        "HISTORY",
        "UNKNOWN",
      ])
      .nullable(),
  })
  .strict();
let errorStage = "INPUT";

async function readInput() {
  let length = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    const part = Buffer.from(chunk);
    length += part.byteLength;
    if (length > 8192) throw new Error("INVALID_INPUT");
    chunks.push(part);
  }
  return inputSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
}

const phoneFromOwner = (value: unknown) => {
  if (typeof value !== "string") return null;
  const match = value.match(/^([1-9]\d{7,14})(?:@s\.whatsapp\.net)?$/);
  return match ? `+${match[1]}` : null;
};
const sameInput = (left: Input, right: Input) =>
  left.organizationId === right.organizationId &&
  left.storeId === right.storeId &&
  left.accountId === right.accountId &&
  left.actorId === right.actorId &&
  left.testerInstanceId === right.testerInstanceId &&
  left.originTestId === right.originTestId &&
  left.requestId === right.requestId;

async function main() {
  if (process.argv.length === 3 && process.argv[2] === "--help") {
    process.stdout.write(
      "Diagnóstico privado: envie JSON por stdin com phase, organizationId, storeId, accountId, actorId, testerInstanceId, originTestId e requestId. Use somente o ambiente privado do servidor. Nenhum telefone, texto ou segredo é aceito como parâmetro.\n",
    );
    return;
  }
  if (process.argv.length !== 2) throw new Error("INVALID_INPUT");
  const input = await readInput();
  errorStage = "IMPORTS";
  const [
    { db },
    { contextoDeFundo },
    { managedEvolutionFor },
    { liveChannelConfiguration },
    { managementFor },
    { evolutionAttendance },
    { channelHttp },
    { reservedEvolutionInstance },
    { runVirtualGreetingProbe },
  ] = await Promise.all([
    import("../src/server/db"),
    import("../src/core/sessao/nucleo"),
    import("../src/modules/crm/services/virtual-evolution-config"),
    import("../src/server/atendimento-contas"),
    import("../src/app/api/atendimento/_costura/providers"),
    import("../src/connectors/whatsapp/atendimento-evolution"),
    import("../src/connectors/whatsapp/atendimento-http"),
    import("../src/server/atendimento-credenciais"),
    import("../src/modules/crm/services/virtual-greeting-probe"),
  ]);

  const instanceSchema = z.object({
    id: z.string().uuid(),
    name: z.string().min(1).max(300),
    connectionStatus: z.literal("open"),
    ownerJid: z.string().min(1).max(100),
  });
  const bind = async (requested: Input) => {
    errorStage = "OWNED_BINDING";
    if (!sameInput(input, requested)) throw new Error("OWNED_BINDING_CHANGED");
    const context = await contextoDeFundo(input.actorId, input.storeId);
    if (
      !context ||
      context.organizacao.id !== input.organizationId ||
      context.unidadeAtiva?.id !== input.storeId
    )
      throw new Error("OWNED_BINDING_CHANGED");
    const managed = await managedEvolutionFor(context);
    if (!managed) throw new Error("OWNED_BINDING_UNAVAILABLE");
    const [account, tester, config] = await Promise.all([
      db.avChannelAccount.findFirst({
        where: {
          id: input.accountId,
          organizationId: input.organizationId,
          storeId: input.storeId,
          mode: "EVOLUTION",
          active: false,
        },
        include: { connection: true },
      }),
      db.instanciaWhatsapp.findFirst({
        where: {
          id: input.testerInstanceId,
          organizacaoId: input.organizationId,
          nome: process.env.EVOLUTION_INSTANCIA?.trim() || "",
          ativa: true,
          excluidoEm: null,
          provedor: "EVOLUTION_BAILEYS",
        },
      }),
      liveChannelConfiguration(input.accountId),
    ]);
    const legacyKey = process.env.EVOLUTION_API_KEY?.trim();
    if (
      !account?.connection ||
      account.connection.connectionState !== "VERIFIED" ||
      account.connection.verifiedRevision !== account.connection.revision ||
      !tester ||
      !legacyKey ||
      /[\r\n\0]/.test(legacyKey) ||
      config.provider !== "EVOLUTION" ||
      config.organizationId !== input.organizationId ||
      config.storeId !== input.storeId ||
      config.active ||
      config.revision !== account.connection.revision ||
      config.settings.url.replace(/\/+$/, "") !== managed.url ||
      reservedEvolutionInstance(
        config.settings.url,
        config.settings.instance,
      ) ||
      !reservedEvolutionInstance(config.settings.url, tester.nome) ||
      tester.nome === config.settings.instance
    )
      throw new Error("OWNED_BINDING_CHANGED");
    const find = async (name: string) => {
      errorStage = "PROVIDER_METADATA";
      const raw = await channelHttp(
        `${managed.url}/instance/fetchInstances?instanceName=${encodeURIComponent(name)}`,
        { method: "GET", headers: { apikey: managed.apiKey } },
      );
      const rows = z.array(instanceSchema).length(1).parse(raw);
      if (rows[0].name !== name) throw new Error("OWNED_BINDING_CHANGED");
      return rows[0];
    };
    const [serviceInstance, testerInstance] = await Promise.all([
      find(config.settings.instance),
      find(tester.nome),
    ]);
    const servicePhone = phoneFromOwner(serviceInstance.ownerJid),
      testerPhone = phoneFromOwner(testerInstance.ownerJid);
    if (
      serviceInstance.id === testerInstance.id ||
      !servicePhone ||
      !testerPhone ||
      servicePhone === testerPhone
    )
      throw new Error("OWNED_BINDING_CHANGED");
    return {
      testerPhone,
      servicePhone,
      revision: account.connection.revision,
      tester,
      testerInstance,
      config,
      legacyKey,
    };
  };
  try {
    errorStage = "PROBE_SERVICE";
    const result = await runVirtualGreetingProbe(input, {
      async attestPair(requested) {
        const pair = await bind(requested);
        return {
          testerPhone: pair.testerPhone,
          servicePhone: pair.servicePhone,
          revision: pair.revision,
        };
      },
      async sendInput(request) {
        const pair = await bind(input);
        errorStage = "SEND_INPUT";
        if (
          request.testerInstanceId !== input.testerInstanceId ||
          request.recipient !== pair.servicePhone ||
          request.text !== "Oi" ||
          request.correlationId !== input.requestId
        )
          throw new Error("OWNED_BINDING_CHANGED");
        const adapter = evolutionAttendance({
          provider: "EVOLUTION",
          organizationId: input.organizationId,
          storeId: input.storeId,
          accountId: pair.tester.id,
          revision: pair.revision,
          active: false,
          name: "Teste privado entre instâncias próprias",
          settings: {
            url: pair.config.settings.url,
            instance: pair.tester.nome,
          },
          secrets: { apiKey: pair.legacyKey },
        });
        return adapter.sendText({
          recipient: pair.servicePhone,
          text: "Oi",
          correlationId: input.requestId,
        });
      },
      async managementFor(accountId) {
        if (accountId !== input.accountId)
          throw new Error("OWNED_BINDING_CHANGED");
        await bind(input);
        errorStage = "MANAGEMENT";
        return managementFor(accountId);
      },
    });
    process.stdout.write(`${JSON.stringify(outputSchema.parse(result))}\n`);
  } finally {
    await db.$disconnect();
  }
}

void main().catch((error: unknown) => {
  const ownErrors = new Set([
    "INVALID_INPUT",
    "OWNED_BINDING_CHANGED",
    "OWNED_BINDING_UNAVAILABLE",
  ]);
  const serviceErrors = new Set([
    "PROBE_ADAPTER_CHANGED",
    "PROBE_BINDING_CHANGED",
    "PROBE_CHANNEL_CHANGED",
    "PROBE_CHANNEL_NOT_PAUSED",
    "PROBE_CONVERSATION_CHANGED",
    "PROBE_EXPIRED",
    "PROBE_FORBIDDEN",
    "PROBE_HUMAN_CONTROL",
    "PROBE_HUMAN_REPLY",
    "PROBE_INPUT_NOT_AUTHENTIC",
    "PROBE_INPUT_NOT_UNIQUE",
    "PROBE_INPUT_REQUIRED",
    "PROBE_NAME_UNAVAILABLE",
    "PROBE_ORIGIN_REQUIRED",
    "PROBE_PAIR_CHANGED",
    "PROBE_PAIR_INVALID",
    "TEST_RATE_LIMIT",
  ]);
  const serviceCode =
    error && typeof error === "object" && "code" in error
      ? error.code
      : undefined;
  const errorCode =
    error instanceof z.ZodError
      ? "INVALID_INPUT"
      : error instanceof Error && ownErrors.has(error.message)
        ? error.message
        : typeof serviceCode === "string" && serviceErrors.has(serviceCode)
          ? serviceCode
          : "GREETING_PROBE_REJECTED";
  process.stderr.write(
    `${JSON.stringify({ ok: false, error: errorCode, stage: errorStage })}\n`,
  );
  process.exitCode = 1;
});
