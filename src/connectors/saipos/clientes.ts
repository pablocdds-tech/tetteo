import { z } from "zod";
import type { ClienteVenda } from "@/server/contratos-clientes";

const externalId = z
  .union([
    z.number().int().positive().safe(),
    z.string().trim().regex(/^\d+$/).max(40),
  ])
  .transform(String);
export const customerSchema = z
  .object({
    id_customer: externalId,
    name: z.string().trim().min(2).max(160),
    phone: z.union([z.string().max(100), z.number().int().safe()]).nullish(),
    email: z.string().trim().max(240).nullish(),
  })
  .nullable()
  .catch(null)
  .optional();

export function clienteIdentificado(value: unknown): ClienteVenda | null {
  const customer = customerSchema.parse(value);
  if (
    !customer ||
    /^(consumidor|cliente) n[aã]o identificado$/i.test(customer.name)
  )
    return null;
  let phone = String(customer.phone ?? "").replace(/\D/g, "");
  if (phone.startsWith("55") && (phone.length === 12 || phone.length === 13))
    phone = phone.slice(2);
  const validPhone = /^\d{2}[1-9]\d{7,8}$/.test(phone) ? `55${phone}` : null;
  const email = z.email().safeParse(customer.email);
  return {
    externalId: customer.id_customer,
    name: customer.name,
    phone: validPhone,
    email: email.success ? email.data : null,
  };
}
