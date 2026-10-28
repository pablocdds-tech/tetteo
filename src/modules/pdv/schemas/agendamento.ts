import { z } from "zod";
import { ErroPdv } from "./erro";
import { periodoPedidos } from "./pedido";

const local = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
export const esquemaAgendamento = z
  .object({
    paraLocal: local,
    antecedenciaMinutos: z.number().int().min(1).max(1440),
  })
  .strict();
const formatador = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
export function formatoLocalSaoPaulo(valor: Date | string): string {
  const data = typeof valor === "string" ? new Date(valor) : valor;
  if (!Number.isFinite(data.getTime())) throw new ErroPdv("Data inválida.");
  const partes = Object.fromEntries(
    formatador.formatToParts(data).map((p) => [p.type, p.value]),
  );
  return `${partes.year}-${partes.month}-${partes.day}T${partes.hour}:${partes.minute}`;
}
export function converterDataLocalSaoPaulo(valor: string): Date {
  if (!local.safeParse(valor).success)
    throw new ErroPdv("Informe uma data e hora válidas em São Paulo.");
  const civil = new Date(`${valor}:00Z`);
  if (
    !Number.isFinite(civil.getTime()) ||
    civil.toISOString().slice(0, 16) !== valor
  )
    throw new ErroPdv("Data civil inválida.");
  // Deriva os offsets do banco IANA em ambos os lados de uma eventual transição.
  // Nunca interpreta a data local no fuso do servidor e nunca escolhe uma hora ambígua.
  const offsets = new Set<number>();
  for (let horas = -48; horas <= 48; horas += 12) {
    const amostra = new Date(civil.getTime() + horas * 3600000);
    offsets.add(
      new Date(`${formatoLocalSaoPaulo(amostra)}:00Z`).getTime() -
        amostra.getTime(),
    );
  }
  const candidatos = [...offsets]
    .map((offset) => new Date(civil.getTime() - offset))
    .filter((d) => formatoLocalSaoPaulo(d) === valor);
  if (candidatos.length !== 1)
    throw new ErroPdv(
      "Este horário não existe ou é ambíguo em São Paulo. Escolha outro horário.",
    );
  return candidatos[0];
}
export function converterAgendamento(entrada: unknown, agora = new Date()) {
  if (!Number.isFinite(agora.getTime()))
    throw new ErroPdv("Horário atual inválido.");
  const d = esquemaAgendamento.parse(entrada);
  const agendadoPara = converterDataLocalSaoPaulo(d.paraLocal);
  const distancia = agendadoPara.getTime() - agora.getTime();
  if (distancia < 5 * 60000 || distancia > 90 * 86400000)
    throw new ErroPdv(
      "Agende entre cinco minutos e noventa dias a partir de agora.",
    );
  return {
    agendadoPara,
    iniciarPreparoEm: new Date(
      agendadoPara.getTime() - d.antecedenciaMinutos * 60000,
    ),
    antecedenciaMinutos: d.antecedenciaMinutos,
  };
}
const base = {
  pedidoId: z.string().uuid(),
  versao: z.number().int().min(1).max(2000000000),
  chave: z.string().uuid(),
  motivo: z.string().trim().min(3).max(300),
};
export const esquemaReagendarPedido = z
  .object({ ...base, agendamento: esquemaAgendamento })
  .strict();
export const esquemaIniciarAgendado = z.object(base).strict();
const dia = z
  .string()
  .refine((v) => {
    if (!v) return true;
    try {
      periodoPedidos(v);
      return true;
    } catch {
      return false;
    }
  }, "Data inválida.")
  .default("");
export const esquemaListaAgendamentos = z
  .object({
    de: dia,
    ate: dia,
    estado: z
      .enum(["EM_ABERTO", "AGUARDANDO", "INICIADOS", "FINALIZADOS", "TODOS"])
      .default("EM_ABERTO"),
    pagina: z.coerce.number().int().min(1).max(100000).default(1),
  })
  .strict()
  .refine((d) => !d.de || !d.ate || d.de <= d.ate, "Período inválido.");
