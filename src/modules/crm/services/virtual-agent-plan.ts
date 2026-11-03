import { z } from "zod";
import { relativeVirtualDate, virtualDate } from "./virtual-domain";

// The language model can extract intent and fields. It cannot author an outgoing
// message, choose a tenant, approve facts, confirm an action or invoke admin tools.
export const virtualIntentSchema = z
  .object({
    intent: z.enum([
      "menu",
      "hours",
      "location",
      "reserve",
      "reservations",
      "update",
      "cancel",
      "confirm",
      "name",
      "preference",
      "human",
      "unknown",
    ]),
    date: z.string().max(20).optional(),
    time: z
      .string()
      .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    partySize: z.number().int().min(1).max(50).optional(),
    name: z.string().trim().min(2).max(160).optional(),
    preference: z.string().trim().min(1).max(160).optional(),
  })
  .strict();
export type VirtualIntent = z.infer<typeof virtualIntentSchema>;
export function demoVirtualIntent(
  text: string,
  now: Date,
  timezone: string,
): VirtualIntent {
  const t = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  let intent: VirtualIntent["intent"] = "unknown";
  if (
    /humano|atendente|gerente|reclam|cobranca|reembolso|desconto|pagamento|senha|token|segredo|credencial|ignore.*instruc|cpf/.test(
      t,
    )
  )
    intent = "human";
  else if (/cancel/.test(t)) intent = "cancel";
  else if (/alterar|atualizar|mudar.*reserva|trocar.*reserva/.test(t))
    intent = "update";
  else if (/minha[s]? reserva|consultar.*reserva|tenho.*reserva/.test(t))
    intent = "reservations";
  else if (/meu nome|me chamo|pode me chamar/.test(t)) intent = "name";
  else if (/prefiro|preferencia|sou vegetarian/.test(t)) intent = "preference";
  else if (/cardapio|pizza|vegetarian|sabor|comida/.test(t)) intent = "menu";
  else if (/horario|abre|abrem|fecha|funciona/.test(t)) intent = "hours";
  else if (/endereco|localiza|onde fica/.test(t)) intent = "location";
  else if (/reserva|mesa/.test(t)) intent = "reserve";
  else if (
    /^(sim|confirmo|confirmar|pode confirmar|confirmado)[.!\s]*$/.test(t.trim())
  )
    intent = "confirm";
  const plan: VirtualIntent = { intent };
  const relative = t.match(/\b(amanha|hoje)\b/);
  const iso = t.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  const br = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}))?\b/);
  const date = relative
    ? relativeVirtualDate(relative[1], now, timezone)
    : (iso?.[1] ??
      (br
        ? `${br[3] ?? relativeVirtualDate("hoje", now, timezone).slice(0, 4)}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}`
        : undefined));
  if (date && virtualDate.safeParse(date).success) plan.date = date;
  const clock =
    t.match(/\b([01]?\d|2[0-3])(?:h|:)([0-5]\d)?\b/) ??
    t.match(/\bas\s+([01]?\d|2[0-3])\b/);
  if (clock) plan.time = `${clock[1].padStart(2, "0")}:${clock[2] ?? "00"}`;
  const people = t.match(
    /\b(\d{1,2}|uma|duas|tres|quatro|cinco|seis|sete|oito|nove|dez)\s*(?:pessoas|pessoa|lugares)\b/,
  );
  if (people) {
    const words: Record<string, number> = {
      uma: 1,
      duas: 2,
      tres: 3,
      quatro: 4,
      cinco: 5,
      seis: 6,
      sete: 7,
      oito: 8,
      nove: 9,
      dez: 10,
    };
    const n = words[people[1]] ?? Number(people[1]);
    if (n >= 1 && n <= 50) plan.partySize = n;
  }
  const n = text.match(
    /(?:meu nome [ée]|me chamo|pode me chamar de|em nome de)\s+([\p{L}][\p{L} '-]{1,100})/iu,
  );
  if (n) plan.name = n[1].replace(/[.!?].*$/, "").trim();
  if (intent === "preference") plan.preference = text.trim().slice(0, 160);
  return virtualIntentSchema.parse(plan);
}
