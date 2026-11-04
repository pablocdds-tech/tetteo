import { safeVirtualCustomerName } from "@/server/atendimento-nome";

/** A display name never overrides the resolver's identity/ambiguity decision. */
export function virtualGreetingPrefix(name?: string, canGreet = true): string {
  const safeName = canGreet ? safeVirtualCustomerName(name) : null;
  return safeName ? `Olá, ${safeName}. ` : "";
}
