import { z } from "zod";

/** Recusa de validação anterior ao commit; permite corrigir a proposta. */
export class NotaAssistidaRecusada extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "NotaAssistidaRecusada";
  }
}

const id = z.string().trim().min(1).max(128);
const opcional = (limite: number) =>
  z
    .string()
    .trim()
    .max(limite)
    .nullish()
    .transform((v) => v || undefined);

const dia = z.string().refine((v) => {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}, "Informe a data completa e válida, como 2026-11-04.");

const decimal = (casas: number, limite: number) =>
  z
    .number()
    .positive()
    .max(limite)
    .refine(
      (v) => new RegExp(`^\\d+(?:\\.\\d{1,${casas}})?$`).test(String(v)),
      `Informe um número positivo com até ${casas} casas decimais.`,
    );
const dinheiro = decimal(2, 999_999_999_999.99);

/** Apenas valores validados pelo contrato; nenhuma conta em ponto flutuante. */
export function centavosDaNota(valor: number): bigint {
  const [inteiro, fracao = ""] = String(valor).split(".");
  return BigInt(inteiro) * 100n + BigInt(fracao.padEnd(2, "0"));
}

const item = z
  .object({
    descricao: z.string().trim().min(1).max(200),
    insumoId: id.optional(),
    novoInsumo: z
      .object({
        nome: z.string().trim().min(2).max(120),
        unidadeMedida: z.enum(["KG", "L", "UN"]),
      })
      .strict()
      .optional(),
    quantidade: decimal(3, 99_999_999_999.999),
    fatorConversao: decimal(4, 9_999_999_999.9999),
    valorTotal: dinheiro,
  })
  .strict()
  .refine((v) => Boolean(v.insumoId) !== Boolean(v.novoInsumo), {
    path: ["insumoId"],
    message: "Escolha um insumo existente ou confirme o cadastro de um novo.",
  });

/** A proposta completa que a pessoa conferiu. Não admite valores presumidos. */
export const notaAssistidaPronta = z
  .object({
    operacaoId: id,
    arquivoId: id.optional(),
    fornecedor: z
      .object({
        nome: z.string().trim().min(2).max(120),
        documento: opcional(30)
          .refine(
            (v) => !v || /^[\d./ -]+$/.test(v),
            "Informe CPF ou CNPJ numérico.",
          )
          .transform((v) => v?.replace(/\D/g, ""))
          .refine(
            (v) => !v || v.length === 11 || v.length === 14,
            "CPF ou CNPJ precisa estar completo.",
          ),
      })
      .strict(),
    numero: opcional(30),
    serie: opcional(10),
    chaveAcesso: opcional(44).refine(
      (v) => !v || /^\d{44}$/.test(v),
      "A chave fiscal precisa ter 44 dígitos.",
    ),
    emitidaEm: dia,
    recebidaEm: dia,
    localId: id,
    empresaId: id,
    categoriaId: id,
    valorTotal: dinheiro,
    itens: z.array(item).min(1).max(200),
    pagamento: z
      .object({
        situacao: z.enum(["PAGA", "A_PAGAR"]),
        forma: z.enum([
          "PIX",
          "BOLETO",
          "DINHEIRO",
          "CREDITO",
          "DEBITO",
          "TED",
          "DEBITO_CONTA",
          "VA",
          "VR",
          "OUTRO",
        ]),
        contaId: id.optional(),
        dataPagamento: dia.optional(),
        parcelas: z
          .array(z.object({ vencimento: dia, valor: dinheiro }).strict())
          .min(1)
          .max(60),
      })
      .strict(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (!v.numero && !v.chaveAcesso)
      ctx.addIssue({
        code: "custom",
        path: ["numero"],
        message:
          "Confira o número da nota ou cupom, ou informe a chave de acesso, para evitar duplicar a entrada.",
      });
    if (
      ![
        v.valorTotal,
        ...v.itens.map((i) => i.valorTotal),
        ...v.pagamento.parcelas.map((p) => p.valor),
      ].every((n) => dinheiro.safeParse(n).success)
    )
      return;
    const total = centavosDaNota(v.valorTotal);
    if (
      v.itens.reduce((s, i) => s + centavosDaNota(i.valorTotal), 0n) !== total
    )
      ctx.addIssue({
        code: "custom",
        path: ["itens"],
        message:
          "O total dos itens não confere com o total da nota. Confira descontos e frete antes de confirmar.",
      });
    if (
      v.pagamento.parcelas.reduce((s, p) => s + centavosDaNota(p.valor), 0n) !==
      total
    )
      ctx.addIssue({
        code: "custom",
        path: ["pagamento", "parcelas"],
        message: "A soma das parcelas precisa conferir com o total da nota.",
      });
    if (
      v.pagamento.situacao === "PAGA" &&
      (!v.pagamento.contaId ||
        !v.pagamento.dataPagamento ||
        v.pagamento.parcelas.length !== 1)
    )
      ctx.addIssue({
        code: "custom",
        path: ["pagamento"],
        message:
          "Para registrar como paga, confirme conta, data do pagamento e o valor integral em uma parcela.",
      });
    if (v.pagamento.situacao === "A_PAGAR" && v.pagamento.dataPagamento)
      ctx.addIssue({
        code: "custom",
        path: ["pagamento", "dataPagamento"],
        message: "Nota a pagar não pode ter data de pagamento confirmado.",
      });
  });

export type NotaAssistidaPronta = z.infer<typeof notaAssistidaPronta>;
