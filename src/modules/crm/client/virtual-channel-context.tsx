"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api } from "./api";
import { useAuth } from "./context";

export type VirtualChannelProvider = "DEMO" | "META" | "EVOLUTION";
type AccountMode = "REAL" | "DEMO";
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
  accountMode: AccountMode;
  setAccountMode: (mode: AccountMode) => void;
  setSelectedAccountId: (id: string, mode?: AccountMode) => void;
  refreshAccounts: () => void;
};
const AccountContext = createContext<AccountContextValue | null>(null);

const modeOf = (account: VirtualChannelAccount): AccountMode =>
  account.provider === "DEMO" ? "DEMO" : "REAL";
function preferredAccount(accounts: VirtualChannelAccount[]) {
  return (
    accounts.find(
      (item) => item.provider !== "DEMO" && item.connectionState === "VERIFIED",
    ) ??
    accounts.find((item) => item.provider !== "DEMO") ??
    accounts[0]
  );
}

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
  const [selection, setSelection] = useState<{
    id: string;
    mode: AccountMode;
    explicit: boolean;
  }>({ id: "", mode: "REAL", explicit: false });
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const accounts = useMemo(
    () => (data?.storeId === storeId ? data.result.accounts : []),
    [data, storeId],
  );
  const accountSnapshot = useRef(accounts);
  useEffect(() => {
    accountSnapshot.current = accounts;
  }, [accounts]);
  const setSelectedAccountId = useCallback((id: string, mode?: AccountMode) => {
    const account = accountSnapshot.current.find((item) => item.id === id);
    setSelection({
      id,
      mode: mode ?? (account ? modeOf(account) : "REAL"),
      explicit: true,
    });
  }, []);
  const setAccountMode = useCallback((mode: AccountMode) => {
    const available = accountSnapshot.current.filter(
      (item) => modeOf(item) === mode,
    );
    setSelection((current) => ({
      id:
        available.find((item) => item.id === current.id)?.id ??
        preferredAccount(available)?.id ??
        "",
      mode,
      explicit: true,
    }));
  }, []);
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
        setSelection((current) => {
          const available = current.explicit
            ? result.accounts.filter((item) => modeOf(item) === current.mode)
            : result.accounts;
          const preferred =
            (current.explicit
              ? available.find((item) => item.id === current.id)
              : undefined) ?? preferredAccount(available);
          return {
            id: preferred?.id ?? "",
            mode: preferred ? modeOf(preferred) : current.mode,
            explicit: current.explicit,
          };
        });
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
      selectedAccountId: selection.id,
      accountMode: selection.mode,
      setAccountMode,
      account: accounts.find((account) => account.id === selection.id) ?? null,
      loading: data?.storeId !== storeId,
      error,
      setSelectedAccountId,
      refreshAccounts,
    }),
    [
      accounts,
      selection,
      data,
      storeId,
      error,
      refreshAccounts,
      setAccountMode,
      setSelectedAccountId,
    ],
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
