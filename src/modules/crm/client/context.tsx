"use client";

import { createContext, useContext, useMemo } from "react";
import { useRouter } from "next/navigation";
import { trocarUnidade } from "@/core/shell/acoes";

type Props = {
  children: React.ReactNode;
  storeId: string;
  stores: { id: string; name: string }[];
  permissions: string[];
  manager: boolean;
};
type Value = {
  selectedStoreId: string;
  setSelectedStoreId: (id: string) => void;
  user: { role: string; stores: Props["stores"] };
  can: (module: string, action: string) => boolean;
};
const Context = createContext<Value | null>(null);
export function CrmProvider({
  children,
  storeId,
  stores,
  permissions,
  manager,
}: Props) {
  const router = useRouter();
  const value = useMemo<Value>(
    () => ({
      selectedStoreId: storeId,
      user: { role: manager ? "MANAGER" : "ATTENDANT", stores },
      setSelectedStoreId(id) {
        if (id !== "all") void trocarUnidade(id).then(() => router.refresh());
      },
      can(_module, action) {
        const key = action === "VIEW" ? "crm.ver" : "crm.editar";
        return (
          permissions.includes("*") ||
          permissions.includes("crm.*") ||
          permissions.includes(key)
        );
      },
    }),
    [storeId, stores, permissions, manager, router],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useAuth() {
  const ctx = useContext(Context);
  if (!ctx) throw new Error("Abra o CRM dentro do sistema.");
  return ctx;
}
