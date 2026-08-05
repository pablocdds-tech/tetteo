import { z } from "zod";

/**
 * O FORMULÁRIO DE AGENTE — onde a regra MOLE × DURO aparece para o usuário.
 *
 * `instrucoes` é texto livre: orienta o modelo, e o modelo quase sempre
 * obedece. Quase.
 *
 * `janelaInicio`, `janelaFim` e os destinatários são CAMPOS: o código os
 * confere antes de agir, e o modelo não convence um `if`.
 *
 * Nada que não se pode perder mora na caixa de texto.
 */

const horario = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use o formato 07:00");

const horarioOpcional = z
  .string()
  .trim()
  .transform((v) => (v === "" ? undefined : v))
  .optional()
  .pipe(horario.optional());

export const esquemaAgente = z
  .object({
    nome: z
      .string()
      .trim()
      .min(3, "Dê um nome que você reconheça daqui a seis meses"),

    /** Vazio = a rede inteira. */
    unidadeId: z
      .string()
      .trim()
      .transform((v) => (v === "" ? null : v))
      .nullable(),

    gatilho: z.enum(["HORARIO", "ROTINA_VENCIDA"], {
      message: "Escolha quando ela deve falar",
    }),

    horario: horarioOpcional,
    diasDaSemana: z.array(z.coerce.number().int().min(0).max(6)).default([]),

    destinatariosPapeis: z.array(z.string().trim().min(1)).default([]),
    destinatariosUsuarios: z.array(z.string().trim().min(1)).default([]),

    instrucoes: z
      .string()
      .trim()
      .min(10, "Escreva, em português, o que ela deve dizer")
      .max(2000, "Instrução longa demais — a mensagem tem 3 linhas"),

    janelaInicio: horarioOpcional,
    janelaFim: horarioOpcional,
  })
  // Gatilho de horário SEM horário criaria um agente que nunca fala, e que
  // pareceria configurado. Silêncio que parece funcionamento é o pior defeito
  // possível numa ferramenta de cobrança.
  .refine((d) => d.gatilho !== "HORARIO" || Boolean(d.horario), {
    message: "Diga a que horas ela deve falar",
    path: ["horario"],
  })
  // Agente sem destinatário é um agente que fala sozinho.
  .refine(
    (d) =>
      d.destinatariosPapeis.length > 0 || d.destinatariosUsuarios.length > 0,
    {
      message: "Escolha ao menos um papel ou uma pessoa",
      path: ["destinatariosPapeis"],
    },
  );

export type DadosAgente = z.infer<typeof esquemaAgente>;

/** O número em E.164 é montado por `lib/telefone`; aqui só o cru. */
export const esquemaVinculo = z.object({
  usuarioId: z.string().trim().min(1, "Escolha a pessoa"),
  telefone: z.string().trim().min(8, "Telefone incompleto"),
});
