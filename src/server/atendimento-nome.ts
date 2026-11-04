import { maskVirtualSecrets } from "./atendimento-canal";

/** Names are display data, never identity proof or agent instructions. */
export function safeVirtualCustomerName(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 500) return null;
  const name = value
    .normalize("NFKC")
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (
    !name ||
    [...name].length > 100 ||
    !/\p{L}/u.test(name) ||
    /[<>]/u.test(name) ||
    /https?:|www\.|\b[\p{L}\d-]+\.[\p{L}]{2,}(?:\b|\/)/iu.test(name) ||
    /(?:\d[\s().+/-]*){7,}/u.test(name) ||
    /^Cliente •{4} \d{4}$/iu.test(name) ||
    maskVirtualSecrets(name) !== name ||
    /^(?:cliente(?: sem cadastro| do whatsapp)?|visitante(?: [·•] exemplo kairu)?|sem nome|desconhecid[oa]|unknown|whatsapp|contato|user|null|undefined)$/iu.test(
      name,
    )
  )
    return null;
  return name;
}
