export type CrmSegment = "LEAD" | "NEW" | "ACTIVE" | "AT_RISK" | "LOST";

export function normalizeBrazilPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  const local =
    digits.startsWith("55") && (digits.length === 12 || digits.length === 13)
      ? digits.slice(2)
      : digits;
  if (!/^\d{2}[1-9]\d{7,8}$/.test(local))
    throw new Error("Telefone brasileiro inválido.");
  return `55${local}`;
}

export function crmSegment(
  purchases: number,
  lastPurchaseAt: Date | null,
  now = new Date(),
): CrmSegment {
  if (purchases === 0 || !lastPurchaseAt) return "LEAD";
  const days = Math.max(
    0,
    Math.floor((now.getTime() - lastPurchaseAt.getTime()) / 86_400_000),
  );
  if (days >= 90) return "LOST";
  if (days >= 30) return "AT_RISK";
  return purchases === 1 ? "NEW" : "ACTIVE";
}
