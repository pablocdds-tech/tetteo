export const VIRTUAL_STATUSES = [
  "OPEN",
  "WAITING_CUSTOMER",
  "WAITING_TEAM",
  "ESCALATED",
  "PAUSED",
  "RESOLVED",
] as const;
export type VirtualStatus = (typeof VIRTUAL_STATUSES)[number];
export type VirtualEscalation = {
  id: string;
  conversationId: string;
  customerName: string;
  reason: string;
  excerpt: string;
  status: string;
  owner: string | null;
  acknowledgedAt: string | null;
  alertStatus: string;
  alertError: string | null;
  createdAt: string;
};
export type VirtualInboxItem = {
  id: string;
  customerName: string;
  customerId: string | null;
  unitName: string;
  channel: string;
  demo: boolean;
  lastMessage: string;
  lastMessageAt: string;
  owner: string | null;
  status: VirtualStatus;
  agentEnabled: boolean;
  version: number;
  pauseUntil: string | null;
  latestEscalation: VirtualEscalation | null;
};
export type VirtualInboxResult = {
  items: VirtualInboxItem[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<VirtualStatus, number>;
};
export type VirtualConversationDetail = {
  conversation: VirtualInboxItem;
  messages: {
    id: string;
    text: string;
    direction: string;
    author: string;
    kind: string;
    status: string;
    createdAt: string;
  }[];
  customer: {
    id: string | null;
    name: string;
    known: boolean;
    source: string;
    updatedAt: string | null;
    preferences: { key: string; value: string }[];
  };
  pause: {
    id: string;
    until: string | null;
    actor: string;
    reason: string;
    createdAt: string;
  } | null;
  escalations: VirtualEscalation[];
  reservations: {
    id: string;
    date: string;
    time: string;
    partySize: number;
    status: string;
    guestName: string;
  }[];
  runs: {
    id: string;
    status: string;
    model: string;
    tokens: number;
    costMicros: number;
    latencyMs: number;
    error: string | null;
    createdAt: string;
  }[];
  summary: string | null;
};
export type VirtualHealth = {
  demo: true;
  accountName: string;
  active: boolean;
  lastWebhookAt: string | null;
  queuePending: number;
  queueDelayMs: number;
  channelErrors: number;
  emptyResponses: number;
  loopsBlocked: number;
  pendingEscalations: number;
  failedAlerts: number;
  tokens: number;
  costMicros: number;
  dailyBudgetMicros: number;
  circuitUntil: string | null;
  lastError: string | null;
};
export type VirtualClaim = {
  toolExecutionId: string;
  objectId: string;
  action: string;
};
export type VirtualTurnInput = {
  organizationId: string;
  storeId: string;
  accountId: string;
  conversationId: string;
  contactId: string | null;
  senderKey: string;
  runId: string;
  version: number;
  leaseOwner: string;
  timezone: string;
  customerName: string;
  summary: string | null;
  state: unknown;
  messages: {
    id: string;
    text: string;
    kind: string;
    transcriptionCertain: boolean;
  }[];
  limits: { maxTokens: number; maxCostMicros: number; timeoutMs: number };
  now: Date;
};
export type VirtualTurnResult = {
  text: string;
  claims?: VirtualClaim[];
  tokens: number;
  costMicros: number;
  model?: string;
  state?: unknown;
  status?: VirtualStatus;
};
export type VirtualOperatorAction =
  | "takeover"
  | "pause"
  | "resume"
  | "resolve"
  | "reopen"
  | "reply"
  | "ack_escalation"
  | "retry_alert";
