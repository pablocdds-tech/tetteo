"use client";

import { useRef } from "react";
import { api } from "@/modules/crm/client/api";

export const retentionRules = [
  {
    key: "VIP",
    label: "VIP",
    rule: "8 ou mais visitas; última visita há até 30 dias.",
  },
  {
    key: "REGULAR",
    label: "Regulares",
    rule: "3 ou mais visitas; última visita há até 45 dias.",
  },
  {
    key: "OCCASIONAL",
    label: "Ocasionais",
    rule: "Ao menos 1 visita; última visita há até 60 dias.",
  },
  {
    key: "AT_RISK",
    label: "Em risco",
    rule: "Ao menos 1 visita; última visita há até 90 dias.",
  },
  {
    key: "LOST",
    label: "Perdidos",
    rule: "Ao menos 1 visita; última visita há mais de 90 dias.",
  },
  { key: "NEW", label: "Novos", rule: "Nenhuma visita vinculada." },
  {
    key: "UNKNOWN",
    label: "Dados incompletos",
    rule: "Há visitas, mas falta uma data válida para classificar.",
  },
];
export const crmMoney = (cents: number | null) =>
  cents === null
    ? "Indisponível"
    : new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
      }).format(cents / 100);
export const crmDate = (date: string | null) =>
  date
    ? new Date(date).toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        dateStyle: "short",
        timeStyle: "short",
      })
    : "Ainda não atualizado";
export const crmError = (error: unknown) =>
  error instanceof Error ? error.message : "Não foi possível concluir a ação.";

export function useCrmMutation() {
  const pending = useRef(new Map<string, { payload: string; key: string }>());
  return async <T>(
    path: string,
    body: unknown,
    method: "POST" | "PUT" = "POST",
  ) => {
    const payload = JSON.stringify(body),
      operation = `${method}:${path}`;
    let request = pending.current.get(operation);
    if (!request || request.payload !== payload) {
      request = { payload, key: crypto.randomUUID() };
      pending.current.set(operation, request);
    }
    const result = await (method === "PUT" ? api.put<T> : api.post<T>)(
      path,
      body,
      { headers: { "Idempotency-Key": request.key } },
    );
    pending.current.delete(operation);
    return result;
  };
}
