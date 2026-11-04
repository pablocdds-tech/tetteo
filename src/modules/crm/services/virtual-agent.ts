import { db } from "@/server/db";
import { safeVirtualCustomerName } from "@/server/atendimento-nome";
import { maskVirtualSecrets } from "@/server/atendimento-canal";
import {
  extractVirtualModelIntent,
  type VirtualModelCredentials,
} from "@/server/ia/atendimento";
import { privateVirtualModelConfiguration } from "@/server/ia/modelo-atendimento-config";
import type {
  VirtualTurnInput,
  VirtualTurnResult,
  VirtualClaim,
} from "../virtual-types";
import { assertVirtualTurn } from "./virtual-runtime";
import {
  demoVirtualIntent,
  virtualIntentSchema,
  type VirtualIntent,
  virtualReferenceTime,
  virtualLiteralDate,
} from "./virtual-agent-plan";
import { relativeVirtualDate } from "./virtual-knowledge";
import { approvedVirtualPolicy } from "./virtual-policy";
import { virtualGreetingPrefix } from "./virtual-greeting";
import {
  executeVirtualTool,
  claimFor,
  isExplicitVirtualConfirmation,
  newPendingReservation,
  virtualStateSchema,
  type VirtualToolName,
} from "./virtual-tools";

type CustomerData = {
  name: string;
  nameSource: string;
  nameUsableForReservation: boolean;
  known: boolean;
  preferences: { key: string; value: string }[];
  reservations: {
    id: string;
    date: string;
    time: string;
    partySize: number;
    guestName: string;
  }[];
};
export async function reserveModelBudget(
  input: VirtualTurnInput,
  bound: number,
  configuration: VirtualModelCredentials,
) {
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`av:model:${input.organizationId}:${input.storeId}`},0))`;
    await assertVirtualTurn(tx, input);
    const current = await tx.avModelConfiguration.findUnique({
      where: {
        organizationId_storeId: {
          organizationId: input.organizationId,
          storeId: input.storeId,
        },
      },
    });
    if (
      configuration.source === "DATABASE"
        ? !current ||
          !current.enabled ||
          current.revision !== configuration.revision ||
          current.testState !== "PASSED" ||
          current.testedRevision !== current.revision ||
          !current.testedAt ||
          current.testedAt.getTime() <= Date.now() - 30 * 86_400_000
        : !!current
    )
      throw new Error("MODEL_CONFIGURATION_CHANGED");
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`virtual-budget:${input.organizationId}:${input.storeId}`},0))`;
    const account = await tx.avChannelAccount.findUniqueOrThrow({
      where: { id: input.accountId },
    });
    const day = new Date(Date.now() - 86_400_000);
    const total = await tx.avAgentRun.aggregate({
      where: { accountId: input.accountId, createdAt: { gte: day } },
      _sum: { costMicros: true },
    });
    const probes = await tx.avModelProbe.aggregate({
      where: {
        organizationId: input.organizationId,
        storeId: input.storeId,
        createdAt: { gte: day },
      },
      _sum: { costMicros: true },
    });
    const notas = await tx.notaFiscalWhatsapp.aggregate({
      where: {
        organizacaoId: input.organizationId,
        unidadeId: input.storeId,
        criadoEm: { gte: day },
      },
      _sum: { custoMicros: true },
    });
    if (
      bound > input.limits.maxCostMicros ||
      (total._sum.costMicros ?? 0) +
        (probes._sum.costMicros ?? 0) +
        (notas._sum.custoMicros ?? 0) +
        bound >
        account.dailyBudgetMicros ||
      (account.circuitUntil && account.circuitUntil > new Date())
    )
      throw new Error("MODEL_COST_CIRCUIT_OPEN");
    // Reserve the maximum before network access; simultaneous workers share this lock.
    // An uncertain provider outcome keeps the reservation charged, never retried blindly.
    await tx.avAgentRun.update({
      where: { id: input.runId },
      data: { costMicros: bound },
    });
  });
}
export async function runVirtualAgent(
  input: VirtualTurnInput,
): Promise<VirtualTurnResult> {
  const joined = input.messages.map((m) => m.text).join("\n");
  const referenceTime = virtualReferenceTime(input.messages, input.now);
  const state = virtualStateSchema.safeParse(input.state);
  let nextState = state.success ? state.data : {};
  const claims: VirtualClaim[] = [];
  const allowedUrls = new Set<string>();
  let tokens = 0,
    costMicros = 0,
    model = "DEMO_RULES";
  const tool = async (
    name: VirtualToolName,
    args: unknown = {},
    stableKey?: string,
  ) => {
    const result = await executeVirtualTool(
      input,
      name,
      args,
      stableKey ?? `${input.runId}:${name}`,
    );
    if (
      result.success &&
      result.data &&
      typeof result.data === "object" &&
      !Array.isArray(result.data) &&
      Array.isArray(result.data.links)
    ) {
      for (const link of result.data.links)
        if (
          link &&
          typeof link === "object" &&
          !Array.isArray(link) &&
          typeof link.url === "string"
        )
          allowedUrls.add(link.url);
    }
    claims.push(...claimFor(result, name));
    return result;
  };
  const reply = (
    text: string,
    extra: Partial<VirtualTurnResult> = {},
  ): VirtualTurnResult => ({
    text: text.replace(/https?:\/\/[^\s<>()]+/gi, (url) =>
      allowedUrls.has(url) ? url : "[link não aprovado]",
    ),
    claims,
    tokens,
    costMicros,
    model,
    state: nextState,
    status: "WAITING_CUSTOMER",
    ...extra,
  });
  const escalate = async (reason: string) => {
    const r = await tool(
      "escalar_para_humano",
      { reason, excerpt: maskVirtualSecrets(joined).slice(0, 1000) },
      `escalate:${input.messages[0]?.id ?? input.runId}`,
    );
    nextState = {};
    return reply(
      r.success
        ? `Criei uma pendência para a equipe acompanhar esta conversa. Protocolo ${r.id}.\nA resposta depende do atendimento humano.`
        : "Não consegui criar a pendência. Tente falar com a equipe pelo atendimento do sistema.",
      { status: "ESCALATED" },
    );
  };
  if (
    input.messages.some((m) => m.kind === "AUDIO" && !m.transcriptionCertain)
  ) {
    nextState = {};
    return reply(
      "Não consegui confirmar o conteúdo do áudio. Pode escrever o trecho com a data, horário e quantidade de pessoas? Nenhuma reserva foi alterada.",
    );
  }
  if (input.messages.some((m) => m.kind === "TEXT" && !m.transcriptionCertain))
    return escalate(
      "A mensagem chegou com horário de origem ausente ou incerto. A equipe precisa conferir a data antes de executar qualquer ação.",
    );
  if (input.messages.some((m) => m.kind === "IMAGE"))
    return escalate("Imagem ou anexo precisa de conferência humana.");
  if (Buffer.byteLength(joined, "utf8") > 16_000)
    return escalate(
      "Mensagem excedeu o limite do turno; precisa de leitura humana.",
    );
  // Route sensitive requests before sending customer content to a model provider.
  const serverPlan = demoVirtualIntent(joined, referenceTime, input.timezone);
  if (serverPlan.intent === "human")
    return escalate(
      "Solicitação fora do escopo automático ou assunto que exige a equipe.",
    );
  let plan: VirtualIntent;
  const config = await privateVirtualModelConfiguration({
    organizationId: input.organizationId,
    storeId: input.storeId,
  });
  const [account, policy] = await Promise.all([
    db.avChannelAccount.findUniqueOrThrow({
      where: { id: input.accountId },
      select: { mode: true },
    }),
    db.$transaction((tx) =>
      approvedVirtualPolicy(tx, {
        organizationId: input.organizationId,
        storeId: input.storeId,
      }),
    ),
  ]);
  if (account.mode !== "DEMO" && (!config.enabled || !config.configured))
    return escalate(
      "A configuração do modelo foi desativada ou perdeu a validade. Atendimento humano necessário.",
    );
  if (config.enabled) {
    model = config.model || "MODEL_UNAVAILABLE";
    const bound = Math.ceil(
      (input.limits.maxTokens * Math.max(config.inputRate, config.outputRate)) /
        1_000_000,
    );
    try {
      if (!config.configured) throw new Error("MODEL_CONFIGURATION_MISSING");
      await reserveModelBudget(input, bound, config);
      costMicros = bound;
      const result = await extractVirtualModelIntent(
        {
          messages: input.messages.map((m) => m.text),
          now: input.now.toISOString(),
          timezone: input.timezone,
          maxTokens: input.limits.maxTokens,
          timeoutMs: input.limits.timeoutMs,
          humanSummary: input.summary,
          referenceDate: referenceTime.toISOString(),
          messageTimes: input.messages.map((m) => m.occurredAt ?? null),
          approvedStyle: policy
            ? { tone: policy.tone, instructions: policy.instructions }
            : null,
        },
        config,
      );
      plan = virtualIntentSchema.parse(result.plan);
      tokens = result.tokens;
      costMicros = result.costMicros;
      model = result.model;
    } catch {
      return escalate(
        "Modelo indisponível, resposta inválida ou limite de custo atingido. Nenhuma ação de reserva executada.",
      );
    }
  } else plan = demoVirtualIntent(joined, referenceTime, input.timezone);
  const literalDate = virtualLiteralDate(
    input.messages,
    input.now,
    input.timezone,
  );
  if (literalDate) plan = { ...plan, date: literalDate };
  // Sensitive/conflicting requests are routed by server policy even if a model misclassifies them.
  if (plan.intent === "human")
    return escalate(
      "Solicitação fora do escopo automático ou assunto que exige a equipe.",
    );
  const customerResult = await tool("buscar_cliente");
  const customer = customerResult.data as unknown as CustomerData;
  const knownName = customer.nameUsableForReservation
    ? (safeVirtualCustomerName(customer.name) ?? undefined)
    : undefined;
  const explicitName = plan.name ? safeVirtualCustomerName(plan.name) : null;
  const invalidExplicitName = Boolean(
    plan.name && (!explicitName || explicitName.length < 2),
  );
  if (plan.name && !invalidExplicitName)
    plan = { ...plan, name: explicitName! };
  if (plan.intent === "name" && plan.name) {
    if (nextState.pending) {
      const p = nextState.pending;
      const prior = await db.avToolExecution.findUnique({
        where: {
          conversationId_key: {
            conversationId: input.conversationId,
            key: `${p.type}:${p.token}`,
          },
        },
      });
      if (prior?.success)
        return escalate(
          "A ação anterior da reserva precisa de conciliação antes de corrigir o nome e gerar outro resumo.",
        );
    }
    const r = await tool("registrar_preferencia", {
      key: "name",
      value: plan.name,
    });
    if (r.success) {
      if (nextState.pending) {
        const p = nextState.pending;
        nextState =
          p.type === "cancel"
            ? {}
            : {
                draft: {
                  date: p.date,
                  time: p.time,
                  partySize: p.partySize,
                  guestName: plan.name,
                  ...(p.type === "update"
                    ? { operation: "update", reservationId: p.reservationId }
                    : {}),
                },
              };
      } else if (nextState.draft) {
        nextState = { draft: { ...nextState.draft, guestName: plan.name } };
      }
    } else if (nextState.pending || nextState.draft) {
      const p = nextState.pending;
      nextState = p
        ? p.type === "cancel"
          ? {}
          : {
              draft: {
                date: p.date,
                time: p.time,
                partySize: p.partySize,
                ...(p.type === "update"
                  ? { operation: "update", reservationId: p.reservationId }
                  : {}),
              },
            }
        : { draft: { ...nextState.draft, guestName: undefined } };
    }
    return reply(
      r.success
        ? `Certo, vou chamar você de ${plan.name} neste atendimento.`
        : (r.error ?? "Não consegui registrar a correção."),
    );
  }
  if (plan.intent === "preference" && plan.preference) {
    const r = await tool("registrar_preferencia", {
      key: "dietaryPreference",
      value: plan.preference,
    });
    return reply(
      r.success
        ? "Registrei essa preferência para os próximos atendimentos neste canal."
        : (r.error ?? "Não consegui registrar a preferência."),
    );
  }
  if (nextState.pending) {
    const p = nextState.pending;
    const name = safeVirtualCustomerName(p.guestName);
    if (!name || name.length < 2) {
      const prior = await db.avToolExecution.findUnique({
        where: {
          conversationId_key: {
            conversationId: input.conversationId,
            key: `${p.type}:${p.token}`,
          },
        },
      });
      if (prior?.success)
        return escalate(
          "A ação anterior da reserva precisa de conciliação antes de corrigir o nome e gerar outro resumo.",
        );
      if (p.type === "cancel")
        return escalate(
          "O nome da reserva anterior precisa de conferência antes do cancelamento.",
        );
      nextState = {
        draft: {
          date: p.date,
          time: p.time,
          partySize: p.partySize,
          ...(p.type === "update"
            ? { operation: "update", reservationId: p.reservationId }
            : {}),
        },
      };
      if (
        (!explicitName || invalidExplicitName) &&
        ["confirm", "reserve", "update", "unknown"].includes(plan.intent)
      )
        return reply(
          "Em qual nome devo fazer a reserva? O resumo anterior precisa ser confirmado novamente.",
        );
    } else nextState = { ...nextState, pending: { ...p, guestName: name } };
  }
  const explicit = isExplicitVirtualConfirmation(joined);
  if (nextState.pending && !explicit) {
    const p = nextState.pending;
    const prior = await db.avToolExecution.findUnique({
      where: {
        conversationId_key: {
          conversationId: input.conversationId,
          key: `${p.type}:${p.token}`,
        },
      },
    });
    if (prior?.success) {
      const action =
        p.type === "create"
          ? "criar_reserva"
          : p.type === "update"
            ? "atualizar_reserva"
            : "cancelar_reserva";
      const reconciled = await tool(
        action,
        { confirmationToken: p.token },
        `${p.type}:${p.token}`,
      );
      const handedOff = await escalate(
        "A reserva foi processada antes da nova mensagem; a equipe deve conciliar a continuação.",
      );
      return {
        ...handedOff,
        text: `A ação anterior da reserva ${reconciled.id} foi concluída (${reconciled.state}).\n${handedOff.text}`,
      };
    }
    // A different message invalidates the previous approval request. Preserve
    // fields for a new preview, so a later "sim" cannot approve an old summary.
    nextState =
      p.type === "cancel"
        ? {}
        : {
            draft: {
              date: p.date,
              time: p.time,
              partySize: p.partySize,
              guestName: p.guestName,
              ...(p.type === "update"
                ? { operation: "update", reservationId: p.reservationId }
                : {}),
            },
          };
  }
  if (nextState.pending && explicit) {
    const p = nextState.pending;
    const action =
      p.type === "create"
        ? "criar_reserva"
        : p.type === "update"
          ? "atualizar_reserva"
          : "cancelar_reserva";
    const r = await tool(
      action,
      { confirmationToken: p.token },
      `${p.type}:${p.token}`,
    );
    nextState = {};
    if (!r.success && r.state === "CONFIRMATION_OUTDATED") {
      nextState = {
        pending: newPendingReservation({
          type: p.type,
          date: p.date,
          time: p.time,
          partySize: p.partySize,
          guestName: p.guestName,
          ...(p.reservationId ? { reservationId: p.reservationId } : {}),
        }),
      };
      return reply(
        `A confirmação anterior chegou fora de ordem e não alterou a reserva.\nResumo atual: ${p.date}, às ${p.time}, ${p.partySize} pessoas, em nome de ${p.guestName}. Responda “confirmo” para ${p.type === "cancel" ? "cancelar" : p.type === "update" ? "alterar" : "criar"} a reserva. A disponibilidade será conferida novamente.`,
      );
    }
    if (!r.success)
      return reply(
        r.error ??
          "Não foi possível confirmar a ação. Nenhuma alteração foi confirmada.",
      );
    return reply(
      p.type === "cancel"
        ? `Reserva ${r.id} cancelada.`
        : `Reserva ${r.id} ${p.type === "update" ? "atualizada" : "confirmada"} para ${p.date}, às ${p.time}, ${p.partySize} pessoas, em nome de ${p.guestName}.`,
    );
  }
  if (plan.intent === "confirm")
    return reply(
      "Ainda não há um resumo de reserva aguardando confirmação. Informe o que deseja reservar ou alterar.",
    );
  if (plan.intent === "reservations") {
    const rs = customer.reservations;
    return reply(
      rs.length
        ? `Reservas deste contato neste canal:\n${rs.map((r) => `${r.date} às ${r.time} · ${r.partySize} pessoas · código ${r.id}`).join("\n")}`
        : "Não encontrei reservas futuras vinculadas a este contato neste canal.",
    );
  }
  if (nextState.selection && plan.intent === "unknown")
    plan = { ...plan, intent: nextState.selection };
  if (plan.intent === "cancel" || plan.intent === "update") {
    const rs = customer.reservations;
    const selected =
      rs.length === 1 ? rs[0] : rs.find((r) => joined.includes(r.id));
    if (!selected) {
      nextState = { selection: plan.intent };
      return reply(
        rs.length
          ? `Qual reserva deseja ${plan.intent === "cancel" ? "cancelar" : "alterar"}? Envie o código:\n${rs.map((r) => `${r.id}: ${r.date}, ${r.time}, ${r.partySize} pessoas`).join("\n")}`
          : "Não encontrei uma reserva futura deste contato para alterar. A equipe pode conferir com você.",
      );
    }
    if (plan.intent === "cancel") {
      const guestName = safeVirtualCustomerName(selected.guestName);
      if (!guestName || guestName.length < 2)
        return escalate(
          "O nome da reserva selecionada precisa de conferência antes do cancelamento.",
        );
      nextState = {
        pending: newPendingReservation({
          type: "cancel",
          reservationId: selected.id,
          date: selected.date,
          time: selected.time,
          partySize: selected.partySize,
          guestName,
        }),
      };
      return reply(
        `Deseja cancelar a reserva ${selected.id}, ${selected.date} às ${selected.time}, ${selected.partySize} pessoas? Responda “confirmo” para cancelar.`,
      );
    }
    nextState = {
      draft: {
        date: selected.date,
        time: selected.time,
        partySize: selected.partySize,
        guestName: selected.guestName,
        operation: "update",
        reservationId: selected.id,
      },
    };
  }
  if (
    plan.intent === "reserve" ||
    plan.intent === "update" ||
    (nextState.draft && plan.intent === "unknown")
  ) {
    const draft = { ...nextState.draft };
    const savedName = draft.guestName
      ? safeVirtualCustomerName(draft.guestName)
      : null;
    const invalidSavedName = Boolean(
      draft.guestName && (!savedName || savedName.length < 2),
    );
    if (draft.guestName)
      draft.guestName = invalidSavedName ? undefined : savedName!;
    if (draft.date && !draft.time && /^(?:[01]?\d|2[0-3])$/.test(joined.trim()))
      plan = { ...plan, time: `${joined.trim().padStart(2, "0")}:00` };
    else if (
      draft.date &&
      draft.time &&
      !draft.partySize &&
      /^\d{1,2}$/.test(joined.trim())
    ) {
      const count = Number(joined.trim());
      if (count >= 1 && count <= 50) plan = { ...plan, partySize: count };
    }
    if (plan.date) {
      try {
        draft.date = relativeVirtualDate(
          plan.date,
          referenceTime,
          input.timezone,
        );
      } catch {
        return reply("Qual é a data da reserva? Envie dia/mês/ano.");
      }
    }
    if (plan.time) draft.time = plan.time;
    if (plan.partySize) draft.partySize = plan.partySize;
    if (invalidExplicitName) {
      nextState = { draft: { ...draft, guestName: undefined } };
      return reply(
        "Não consegui usar esse nome. Em qual nome devo fazer a reserva?",
      );
    }
    if (explicitName) draft.guestName = explicitName;
    // A short answer to the explicit name question is kept as conversational alias.
    if (
      !draft.guestName &&
      nextState.draft?.date &&
      nextState.draft?.time &&
      nextState.draft?.partySize &&
      plan.intent === "unknown" &&
      !plan.date &&
      !plan.time &&
      !plan.partySize &&
      /^[\p{L}][\p{L} '-]{1,100}$/u.test(joined.trim())
    )
      draft.guestName = safeVirtualCustomerName(joined.trim()) ?? undefined;
    if (invalidSavedName && !draft.guestName) {
      nextState = { draft };
      return reply("Em qual nome devo fazer a reserva?");
    }
    if (!draft.guestName && knownName) draft.guestName = knownName;
    nextState = { draft };
    if (!draft.date) return reply("Para qual data você quer reservar?");
    if (!draft.time) return reply("Qual horário você prefere para a reserva?");
    if (!draft.partySize) return reply("A reserva será para quantas pessoas?");
    if (!draft.guestName) return reply("Em qual nome devo fazer a reserva?");
    const available = await tool("consultar_disponibilidade_reserva", {
      date: draft.date,
      time: draft.time,
      partySize: draft.partySize,
      ...(draft.operation === "update" && draft.reservationId
        ? { reservationId: draft.reservationId }
        : {}),
    });
    if (!available.success)
      return escalate(
        available.error ?? "A equipe precisa conferir a grade de reservas.",
      );
    if (available.state !== "AVAILABLE")
      return reply(
        "A consulta da grade não encontrou capacidade para esse grupo nesse horário. Qual outro horário você prefere?",
      );
    const operation =
      "operation" in draft && draft.operation === "update"
        ? "update"
        : "create";
    nextState = {
      pending: newPendingReservation({
        type: operation,
        date: draft.date,
        time: draft.time,
        partySize: draft.partySize,
        guestName: draft.guestName,
        ...(operation === "update" && "reservationId" in draft
          ? { reservationId: draft.reservationId as string }
          : {}),
      }),
    };
    return reply(
      `Consultei a grade: ${draft.date}, às ${draft.time}, ${draft.partySize} pessoas, em nome de ${draft.guestName}.\nResponda “confirmo” para ${operation === "update" ? "alterar" : "criar"} a reserva. A vaga será conferida novamente na confirmação.`,
    );
  }
  if (plan.intent === "menu") {
    const r = await tool("consultar_cardapio");
    if (!r.success) return escalate(r.error ?? "Cardápio indisponível.");
    const data = r.data as unknown as {
      menu: {
        id: string;
        name: string;
        description: string;
        priceCents: number;
        vegetarian: boolean;
      }[];
      links: { url: string }[];
    };
    const menu = /vegetarian/i.test(joined)
      ? data.menu.filter((m) => m.vegetarian)
      : data.menu;
    if (!menu.length)
      return escalate(
        "Não há item publicado que responda à pergunta sobre o cardápio.",
      );
    return reply(
      `${menu
        .slice(0, 5)
        .map(
          (m) =>
            `${m.name} — ${(m.priceCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}\n${m.description.slice(0, 240)}${m.description.length > 240 ? "…" : ""}`,
        )
        .join(
          "\n\n",
        )}${data.links[0] ? `\n\nCardápio oficial: ${data.links[0].url}` : "\n\nO link do cardápio não está disponível nesta base."}`,
    );
  }
  if (plan.intent === "hours" || plan.intent === "location") {
    const r = await tool("consultar_unidades");
    if (!r.success)
      return escalate(r.error ?? "Informações da unidade indisponíveis.");
    const data = r.data as unknown as {
      name: string;
      address: string;
      hours: { day: number; opens: string; closes: string }[];
      exceptions: { date: string; closed: boolean; description: string }[];
      links: { kind: string; url: string }[];
    };
    if (plan.intent === "location")
      return reply(
        data.address
          ? `${data.name}\n${data.address}${data.links.find((l) => l.kind === "location") ? `\n${data.links.find((l) => l.kind === "location")!.url}` : ""}`
          : "O endereço público não foi aprovado na base. A equipe pode conferir.",
      );
    const date = relativeVirtualDate(
      plan.date ?? "hoje",
      referenceTime,
      input.timezone,
    );
    const exception = data.exceptions.find((e) => e.date === date);
    if (exception)
      return reply(
        `${date}: ${exception.closed ? "unidade fechada" : "horário excepcional; consulte a equipe"}. ${exception.description}`,
      );
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    const hours = data.hours.filter((h) => h.day === weekday);
    return reply(
      hours.length
        ? `Em ${date}, o horário de funcionamento publicado é ${hours.map((h) => `${h.opens} às ${h.closes}`).join(" e ")}.\nA grade de reservas é consultada separadamente.`
        : "Não há horário de funcionamento publicado para esse dia. A equipe precisa conferir.",
    );
  }
  const greetingPrefix = virtualGreetingPrefix(knownName);
  return reply(
    `${greetingPrefix}${policy ? (/^(?:oi|olá|ola|bom dia|boa tarde|boa noite)[!.\s]*$/i.test(joined.trim()) ? policy.greeting : policy.fallbackMessage) || "Posso consultar o cardápio, os horários da unidade e as reservas, ou chamar a equipe. Como posso ajudar?" : `${greetingPrefix ? "" : "Olá! "}Posso consultar o cardápio, os horários da unidade e as reservas, ou chamar a equipe. Como posso ajudar?`}`,
  );
}
