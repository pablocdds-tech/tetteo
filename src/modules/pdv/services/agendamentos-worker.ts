import { processarAgendamentosVencidos } from "./agendamentos";

type RelogioAgendamentos = {
  timer?: ReturnType<typeof setInterval>;
  rodando: boolean;
};
const processo = globalThis as unknown as {
  pdvAgendamentos?: RelogioAgendamentos;
};

/** O bloqueio no banco coordena instâncias; este relógio só evita sobreposição local. */
export function iniciarRelogioAgendamentos() {
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (processo.pdvAgendamentos?.timer) return;
  const estado: RelogioAgendamentos = { rodando: false };
  processo.pdvAgendamentos = estado;
  const tick = async () => {
    if (estado.rodando) return;
    estado.rodando = true;
    try {
      await processarAgendamentosVencidos();
    } catch {
      console.error(
        "[pdv-agendamentos] Não foi possível atualizar a fila de preparo.",
      );
    } finally {
      estado.rodando = false;
    }
  };
  void tick();
  estado.timer = setInterval(() => void tick(), 30_000);
  estado.timer.unref();
}
