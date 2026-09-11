import { z } from "zod";

/**
 * O RECADO QUE A ROTA ACEITA.
 *
 * Estrito: campo a mais é recusa. É o que garante que o recado do assistente
 * nunca carrega uma ordem escondida — "proposta de compra" pode ser o TÍTULO
 * de um rascunho, nunca um pedido que o Tetteo executaria.
 *
 * O vocabulário dos estados é o da ferramenta do OpenClaw
 * (`assistente-privado/ferramenta/`). Mudou lá, muda aqui, e os testes dos
 * dois lados quebram se discordarem.
 */

export const ESTADOS_DE_EXECUCAO = [
  "calculado",
  "concluido",
  "preparado",
  "sem_dados",
  "arquivo_invalido",
  "acesso_negado",
  "cancelado",
] as const;

export const ESTADOS_DE_VERIFICACAO = [
  "conectado",
  "login_expirado",
  "limite",
  "modelo_indisponivel",
  "desligado",
] as const;

const dia = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "data no formato AAAA-MM-DD");

/** Data e hora ISO de verdade: "2026-02-31T10:00:00Z" não passa. */
const instante = z
  .string()
  .max(40)
  .refine((s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})T/.exec(s);
    if (!m || !Number.isFinite(Date.parse(s))) return false;
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    return (
      d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3])
    );
  }, "data e hora ISO");

const frase = (maximo: number) => z.string().trim().min(1).max(maximo);

const comum = {
  chave: z.string().regex(/^[a-z0-9:_-]{6,80}$/, "chave inválida"),
  ocorridoEm: instante,
  demonstracao: z.boolean().default(false),
  avisos: z.array(frase(200)).max(10).default([]),
  pendencias: z.array(frase(200)).max(10).default([]),
  detalhe: frase(300).nullish(),
  versaoOpenclaw: frase(40).nullish(),
  modelo: frase(80).nullish(),
};

export const corpoDoRegistro = z.discriminatedUnion("tipo", [
  z.strictObject({
    tipo: z.literal("execucao"),
    estado: z.enum(ESTADOS_DE_EXECUCAO),
    periodo: z.strictObject({ de: dia, ate: dia }).nullish(),
    fonte: z
      .string()
      .regex(/^[\w.-]{1,80}\.csv$/i)
      .nullish(),
    indicadores: z
      .strictObject({
        totalCentavos: z.number().int(),
        pedidos: z.number().int().min(0),
        ticketCentavos: z.number().int().nullable(),
        diasComVenda: z.number().int().min(0),
        diasNoPeriodo: z.number().int().min(0),
        ultimaData: dia.nullable(),
        desatualizado: z.boolean(),
      })
      .nullish(),
    ...comum,
  }),
  z.strictObject({
    tipo: z.literal("verificacao"),
    estado: z.enum(ESTADOS_DE_VERIFICACAO),
    proximaRotina: instante.nullish(),
    rotinaPausada: z.boolean().nullish(),
    limiteAte: instante.nullish(),
    ...comum,
  }),
]);

export type CorpoDoRegistro = z.infer<typeof corpoDoRegistro>;
