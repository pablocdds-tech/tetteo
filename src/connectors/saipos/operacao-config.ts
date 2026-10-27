import { z } from "zod";

export function ambienteOperacao() {
  const env = process.env.SAIPOS_OPERATIONS_ENVIRONMENT ?? "homologacao";
  if (!["homologacao", "producao"].includes(env))
    throw new Error("Ambiente Saipos inválido.");
  if (env === "producao" && process.env.SAIPOS_PRODUCTION_APPROVED !== "true")
    throw new Error("Produção aguarda homologação da Saipos.");
  return env;
}
export function configOperacao(tipo: "pedidos" | "logistica") {
  const unidadeId = process.env.SAIPOS_OPERATIONS_UNIDADE_ID;
  if (!unidadeId) throw new Error("Configure a unidade das operações Saipos.");
  const ambiente = ambienteOperacao();
  if (!/^[a-f0-9]{64}$/i.test(process.env.SAIPOS_OPERATIONS_KEY ?? ""))
    throw new Error("Configure a chave privada das operações Saipos.");
  if (tipo === "pedidos") {
    const secret = process.env.SAIPOS_ORDER_SECRET,
      partnerId = process.env.SAIPOS_ORDER_PARTNER_ID,
      codStore = process.env.SAIPOS_ORDER_STORE_CODE;
    if (
      process.env.SAIPOS_ORDER_ENABLED !== "true" ||
      !secret ||
      !partnerId ||
      !codStore
    )
      throw new Error("API de Pedidos aguarda configuração no servidor.");
    return {
      unidadeId,
      ambiente,
      secret,
      partnerId,
      codStore,
      clientId: "",
      merchantId: "",
    };
  }
  const secret = process.env.SAIPOS_LOGISTICS_CLIENT_SECRET,
    clientId = process.env.SAIPOS_LOGISTICS_CLIENT_ID,
    merchantId = process.env.SAIPOS_LOGISTICS_MERCHANT_ID;
  if (
    process.env.SAIPOS_LOGISTICS_ENABLED !== "true" ||
    !secret ||
    secret.length < 32 ||
    !clientId ||
    !merchantId
  )
    throw new Error("API de Logística aguarda configuração no servidor.");
  return {
    unidadeId,
    ambiente,
    secret,
    clientId,
    merchantId,
    codStore: "",
    partnerId: "",
  };
}
// Receber eventos não deve habilitar comandos de escrita no PDV.
export function configWebhookPedido() {
  const unidadeId = process.env.SAIPOS_OPERATIONS_UNIDADE_ID;
  const codStore = process.env.SAIPOS_ORDER_STORE_CODE;
  const ambiente = ambienteOperacao();
  if (
    !unidadeId ||
    !codStore ||
    !/^[a-f0-9]{64}$/i.test(process.env.SAIPOS_OPERATIONS_KEY ?? "") ||
    !/^[a-f0-9]{64}$/i.test(process.env.SAIPOS_ORDER_WEBHOOK_KEY ?? "")
  )
    throw new Error("Webhook de Pedidos aguarda configuração no servidor.");
  return { unidadeId, codStore, ambiente };
}
export const textoId = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[\w.-]+$/);
export const statusPedido = z.enum([
  "CONFIRMED",
  "READY_TO_DELIVER",
  "DISPATCHED",
  "CONCLUDED",
  "CANCELLED",
]);
export const statusEntrega = z.enum([
  "PENDING",
  "ACCEPTED",
  "REJECTED",
  "PICKUP_ONGOING",
  "ARRIVED_AT_MERCHANT",
  "ORDER_PICKED",
  "DELIVERY_ONGOING",
  "ARRIVED_AT_CUSTOMER",
  "ORDER_DELIVERED",
  "RETURNING_TO_MERCHANT",
  "RETURNED_TO_MERCHANT",
  "DELIVERY_FINISHED",
  "CANCELLED",
]);
export const terminal = (s: string) =>
  ["CONCLUDED", "CANCELLED", "REJECTED", "DELIVERY_FINISHED"].includes(s);
