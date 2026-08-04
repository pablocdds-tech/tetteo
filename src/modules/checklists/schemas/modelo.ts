import { z } from "zod";

import { lerDataLocal } from "@/lib/data";
import { lerNumeroBr } from "@/lib/numero";

/**
 * A validação dos Checklists.
 *
 * A mesma definição vale no formulário e no servidor — uma regra só, escrita
 * uma vez, sem risco de o navegador aceitar o que o servidor recusa.
 */

/**
 * Um número do checklist — leitura ou faixa.
 *
 * Construído sobre `lerNumeroBr` e NÃO sobre `numeroBrOpcional`, que é o que
 * o resto do sistema usa: aquele recusa negativo, porque nasceu para
 * quantidade e custo, onde negativo é sempre erro de digitação.
 *
 * Aqui negativo é o caso normal. Freezer trabalha a −18 °C, e uma trava de
 * "não pode ser negativo" tornaria impossível cadastrar justamente a checagem
 * mais importante da cozinha.
 */
export const esquemaNumeroChecklist = z
  .string()
  .optional()
  .superRefine((bruto, ctx) => {
    if (lerNumeroBr(bruto ?? "") === undefined) {
      ctx.addIssue({
        code: "custom",
        message:
          "Não deu para entender o número: use vírgula para os decimais (−18,5).",
      });
    }
  })
  .transform((bruto) => lerNumeroBr(bruto ?? "") ?? null);

export const esquemaModelo = z.object({
  nome: z
    .string()
    .trim()
    .min(3, "Dê um nome ao checklist — ele aparece na lista do dia.")
    .max(80, "O nome está longo demais."),
  descricao: z
    .string()
    .trim()
    .max(200, "A descrição está longa demais.")
    .optional()
    .transform((v) => v || null),
});

export const esquemaItemModelo = z
  .object({
    texto: z
      .string()
      .trim()
      .min(3, "Escreva a pergunta como ela vai ser lida no celular.")
      .max(200, "A pergunta está longa demais — quebre em duas."),
    secao: z
      .string()
      .trim()
      .max(40, "O nome do bloco está longo demais.")
      .optional()
      .transform((v) => v || null),
    tipo: z.enum(["SIM_NAO", "NUMERO", "TEXTO"], {
      message: "Escolha o tipo de resposta.",
    }),
    obrigatorio: z.boolean().default(true),
    exigeObservacaoSeNao: z.boolean().default(true),
    exigeFoto: z.boolean().default(false),
    rotuloUnidade: z
      .string()
      .trim()
      .max(10, "Use algo curto: °C, kg, min.")
      .optional()
      .transform((v) => v || null),
    minimo: esquemaNumeroChecklist,
    maximo: esquemaNumeroChecklist,
  })
  .superRefine((dados, ctx) => {
    // Faixa invertida passa despercebida e transforma TODA leitura em erro:
    // o checklist da loja passaria a acusar não conformidade todo santo dia.
    if (
      dados.minimo != null &&
      dados.maximo != null &&
      dados.minimo > dados.maximo
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["maximo"],
        message: "O máximo precisa ser maior que o mínimo.",
      });
    }
  });

export type DadosItemModelo = z.infer<typeof esquemaItemModelo>;

/** A leitura digitada na folha — mesma regra da faixa. */
export const esquemaLeituraNumero = esquemaNumeroChecklist;

export const esquemaRotinaChecklist = z
  .object({
    modeloId: z.string().trim().min(1, "Escolha o checklist."),
    recorrencia: z.enum(["DIARIA", "SEMANAL", "MENSAL"], {
      message: "Escolha a frequência.",
    }),
    diaDaSemana: z.coerce.number().int().min(0).max(6).nullish(),
    diaDoMes: z.coerce
      .number()
      .int()
      .min(1, "O dia do mês vai de 1 a 28.")
      // Até 28: "dia 31" não existe em fevereiro e a rotina sumiria do mês.
      .max(28, "Use até o dia 28 — fevereiro existe.")
      .nullish(),
    horario: z
      .string()
      .trim()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Horário no formato 07:00.")
      .optional()
      .or(z.literal("").transform(() => undefined)),
    responsavelId: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v ? v : null)),
  })
  .superRefine((dados, ctx) => {
    if (dados.recorrencia === "SEMANAL" && dados.diaDaSemana == null) {
      ctx.addIssue({
        code: "custom",
        path: ["diaDaSemana"],
        message: "Escolha o dia da semana.",
      });
    }
    if (dados.recorrencia === "MENSAL" && dados.diaDoMes == null) {
      ctx.addIssue({
        code: "custom",
        path: ["diaDoMes"],
        message: "Escolha o dia do mês.",
      });
    }
  });

export type DadosRotinaChecklist = z.infer<typeof esquemaRotinaChecklist>;

export const esquemaNovaResposta = z.object({
  modeloId: z.string().trim().min(1, "Escolha o checklist."),
  /**
   * O dia que a resposta REPRESENTA. O fechamento das 23h costuma ser lançado
   * depois da meia-noite, e ele pertence ao dia que acabou.
   */
  referencia: z
    .string()
    .trim()
    .min(1, "Informe a data.")
    .refine((v) => lerDataLocal(v) !== null, { message: "Data inválida." })
    .transform((v) => lerDataLocal(v)!),
});

export const esquemaPendencia = z.object({
  descricao: z
    .string()
    .trim()
    .min(3, "Descreva o que precisa ser resolvido.")
    .max(300, "A descrição está longa demais."),
  responsavelId: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : null)),
  prazo: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? lerDataLocal(v) : null)),
});

export const esquemaResolucao = z.object({
  resolucao: z
    .string()
    .trim()
    .min(3, "Escreva o que foi feito — é isso que fecha a pendência.")
    .max(300, "O texto está longo demais."),
});
