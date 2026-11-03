import { z } from "zod";

export const virtualDate = z
  .string()
  .regex(/^20\d{2}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(`${s}T12:00:00Z`);
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "Data inválida.");

export function dateInZone(now: Date, timezone: string) {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  return `${p.find((x) => x.type === "year")!.value}-${p.find((x) => x.type === "month")!.value}-${p.find((x) => x.type === "day")!.value}`;
}

export function relativeVirtualDate(
  value: string,
  now: Date,
  timezone: string,
) {
  const t = value.toLocaleLowerCase("pt-BR").trim();
  if (t !== "hoje" && t !== "amanhã" && t !== "amanha")
    return virtualDate.parse(value);
  const local = dateInZone(now, timezone);
  if (t === "hoje") return local;
  return new Date(new Date(`${local}T12:00:00Z`).getTime() + 86_400_000)
    .toISOString()
    .slice(0, 10);
}
