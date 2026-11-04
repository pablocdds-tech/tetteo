import type { ChannelManagementFactory } from "@/server/atendimento-provedor";
import { processVirtualHistoryQueue } from "./virtual-history";

const state = globalThis as unknown as {
  virtualHistoryTimer?: ReturnType<typeof setInterval>;
};

export function startVirtualHistoryWorker(factory: ChannelManagementFactory) {
  if (
    process.env.AV_HISTORY_WORKER_ENABLED === "false" ||
    process.env.NODE_ENV === "test" ||
    state.virtualHistoryTimer
  )
    return;
  let active = false;
  const tick = async () => {
    if (active) return;
    active = true;
    try {
      const deadline = Date.now() + 8000;
      for (let round = 0; round < 4 && Date.now() < deadline; round++) {
        if ((await processVirtualHistoryQueue(factory)) === 0) break;
      }
    } catch {
      console.error(
        "[atendimento-historico] Rodada não concluída; importação preservada.",
      );
    } finally {
      active = false;
    }
  };
  state.virtualHistoryTimer = setInterval(() => void tick(), 2000);
  state.virtualHistoryTimer.unref();
}
