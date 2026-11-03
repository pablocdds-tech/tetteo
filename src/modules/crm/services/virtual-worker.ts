import {
  processVirtualQueue,
  type VirtualChannelFactory,
} from "./virtual-runtime";
import { demoChannel } from "@/server/atendimento-canal";
import { runVirtualAgent } from "./virtual-agent";

const globalWorker = globalThis as unknown as {
  virtualWorkerTimer?: ReturnType<typeof setInterval>;
};
export function startVirtualWorker(
  channelFor: VirtualChannelFactory = demoChannel,
) {
  if (
    process.env.AV_WORKER_ENABLED === "false" ||
    process.env.NODE_ENV === "test" ||
    globalWorker.virtualWorkerTimer
  )
    return;
  let active = false;
  const tick = async () => {
    if (active) return;
    active = true;
    try {
      await processVirtualQueue(runVirtualAgent, 5, channelFor);
    } catch {
      console.error(
        "[atendimento-worker] Não foi possível completar a rodada; fila preservada.",
      );
    } finally {
      active = false;
    }
  };
  // This flag only avoids duplicate scheduling in one process. Database leases
  // and transaction fencing are the authority across replicas and restarts.
  globalWorker.virtualWorkerTimer = setInterval(() => void tick(), 1000);
  globalWorker.virtualWorkerTimer.unref();
}
