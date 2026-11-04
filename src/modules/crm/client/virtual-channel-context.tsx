"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { api } from "./api";
import { useAuth } from "./context";

export type VirtualChannelProvider = "DEMO" | "META" | "EVOLUTION";
export type VirtualChannelAccount = {
  id: string;
  name: string;
  provider: VirtualChannelProvider;
  mode: VirtualChannelProvider;
  active: boolean;
  revision: number;
  credentialPresent: boolean;
  settings: {
    url?: string;
    instance?: string;
    phoneNumberId?: string;
    businessAccountId?: string;
    apiVersion?: string;
  };
  connectionState: "PENDING" | "VERIFIED" | "FAILED";
  verifiedAt: string | null;
  webhookSeenAt: string | null;
  webhookUrl: string;
  lastError: string | null;
  latestTest: null | {
    id: string;
    state: "SENDING" | "ACCEPTED" | "DELIVERED" | "FAILED" | "UNCERTAIN";
    recipientMasked: string;
    observedAt: string | null;
    error: string | null;
    createdAt: string;
  };
  blockers: string[];
};
export type VirtualChannelsResult = {
  accounts: VirtualChannelAccount[];
  allowedEvolutionOrigins: string[];
  legacyReservedInstance: string | null;
  managedEvolutionAvailable?: boolean;
  createdAccountId?: string;
};
type AccountContextValue = {
  accounts: VirtualChannelAccount[];
  selectedAccountId: string;
  account: VirtualChannelAccount | null;
  loading: boolean;
  error: string;
  setSelectedAccountId: (id: string) => void;
  refreshAccounts: () => void;
};
const AccountContext = createContext<AccountContextValue | null>(null);

export function VirtualAccountProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { selectedStoreId: storeId } = useAuth();
  const [data, setData] = useState<{
    storeId: string;
    result: VirtualChannelsResult;
  } | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const accounts = useMemo(
    () => (data?.storeId === storeId ? data.result.accounts : []),
    [data, storeId],
  );
  const refreshAccounts = useCallback(
    () => setRevision((value) => value + 1),
    [],
  );
  useEffect(() => {
    let alive = true;
    void api
      .get<VirtualChannelsResult>(
        `/api/crm/virtual/channels?storeId=${encodeURIComponent(storeId)}`,
      )
      .then((result) => {
        if (!alive) return;
        setData({ storeId, result });
        setError("");
        setSelectedAccountId((current) =>
          result.accounts.some((account) => account.id === current)
            ? current
            : (result.accounts[0]?.id ?? ""),
        );
      })
      .catch((failure) => {
        if (alive)
          setError(
            failure instanceof Error
              ? failure.message
              : "Não foi possível consultar as contas de canal.",
          );
      });
    return () => {
      alive = false;
    };
  }, [storeId, revision]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) refreshAccounts();
    }, 30000);
    return () => clearInterval(timer);
  }, [refreshAccounts]);
  const value = useMemo(
    () => ({
      accounts,
      selectedAccountId,
      account:
        accounts.find((account) => account.id === selectedAccountId) ?? null,
      loading: data?.storeId !== storeId,
      error,
      setSelectedAccountId,
      refreshAccounts,
    }),
    [accounts, selectedAccountId, data, storeId, error, refreshAccounts],
  );
  return (
    <AccountContext.Provider value={value}>{children}</AccountContext.Provider>
  );
}

export function useVirtualAccount() {
  const context = useContext(AccountContext);
  if (!context) throw new Error("Abra o atendimento dentro da Severina.");
  return context;
}
