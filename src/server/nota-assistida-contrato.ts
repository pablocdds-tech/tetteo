import { z } from "zod";
import {
  documentoFiscalValido,
  chaveFiscalValida,
  dadosDaChave,
  eanValido,
  toleranciaFiscalCentavos,
} from "@/lib/documento-fiscal";
import { ratearCentavos } from "./notas/rateio";

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
const valorItem = z
  .number()
  .finite()
  .nonnegative()
  .max(999_999_999_999.99)
  .refine(
    (v) => /^\d+(?:\.\d{1,2})?$/.test(String(v)),
    "Informe centavos válidos.",
  );

/** Apenas valores validados pelo contrato; nenhuma conta em ponto flutuante. */
export function centavosDaNota(valor: number): bigint {
  const [inteiro, fracao = ""] = String(valor).split(".");
  return BigInt(inteiro) * 100n + BigInt(fracao.padEnd(2, "0"));
}

const item = z
  .object({
    descricao: z.string().trim().min(1).max(240),
    insumoId: id.optional(),
    novoInsumo: z
      .object({
        nome: z.string().trim().min(2).max(160),
        unidadeMedida: z.enum(["KG", "L", "UN"]),
      })
      .strict()
      .optional(),
    quantidade: decimal(3, 99_999_999_999.999),
    fatorConversao: decimal(4, 9_999_999_999.9999),
    valorTotal: valorItem,
    valorBruto: valorItem.optional(),
    valorUnitarioImpresso: z
      .number()
      .finite()
      .nonnegative()
      .max(1_000_000_000)
      .optional(),
    codigoFornecedor: z.string().min(1).max(80).optional(),
    ean: z.string().refine(eanValido, "EAN inválido.").optional(),
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
        nome: z.string().trim().min(2).max(160),
        documento: opcional(30)
          .refine(
            (v) => !v || /^[\d./ -]+$/.test(v),
            "Informe CPF ou CNPJ numérico.",
          )
          .transform((v) => v?.replace(/\D/g, ""))
          .refine(
            (v) => !v || documentoFiscalValido(v),
            "CPF ou CNPJ inválido. Confira os dígitos verificadores.",
          ),
      })
      .strict(),
    numero: opcional(60),
    serie: opcional(20),
    chaveAcesso: opcional(44).refine(
      (v) => !v || chaveFiscalValida(v),
      "A chave fiscal precisa ter 44 dígitos válidos, com dígito verificador correto.",
    ),
    emitidaEm: dia,
    recebidaEm: dia,
    localId: id,
    empresaId: id,
    categoriaId: id,
    valorTotal: dinheiro,
    itens: z.array(item).min(1).max(200),
    fiscal: z
      .object({
        descontos: valorItem,
        acrescimos: valorItem,
        ajusteArredondamento: z
          .number()
          .finite()
          .min(-0.05)
          .max(0.05)
          .refine(
            (v) => Math.abs(v * 100 - Math.round(v * 100)) < 0.000001,
            "Informe centavos válidos.",
          ),
      })
      .strict()
      .optional(),
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
      !dinheiro.safeParse(v.valorTotal).success ||
      !v.itens.every((i) => valorItem.safeParse(i.valorTotal).success) ||
      !v.pagamento.parcelas.every((p) => dinheiro.safeParse(p.valor).success)
    )
      return;
    const total = centavosDaNota(v.valorTotal);
    const chave = v.chaveAcesso ? dadosDaChave(v.chaveAcesso) : null;
    const normalizar = (s: string) => s.replace(/^0+(?=\d)/, "");
    if (
      chave &&
      ((v.fornecedor.documento && v.fornecedor.documento !== chave.cnpj) ||
        (v.numero && normalizar(v.numero) !== normalizar(chave.numero)) ||
        (v.serie && normalizar(v.serie) !== normalizar(chave.serie)) ||
        v.emitidaEm.slice(2, 7).replace("-", "") !== chave.anoMes)
    )
      ctx.addIssue({
        code: "custom",
        path: ["chaveAcesso"],
        message: "A chave diverge do emitente, número, série ou emissão.",
      });
    const tolerancia = toleranciaFiscalCentavos();
    for (const [n, i] of v.itens.entries()) {
      if (
        i.valorUnitarioImpresso !== undefined &&
        Math.abs(
          Math.round(i.quantidade * i.valorUnitarioImpresso * 100) -
            Number(centavosDaNota(i.valorBruto ?? i.valorTotal)),
        ) > tolerancia
      )
        ctx.addIssue({
          code: "custom",
          path: ["itens", n],
          message: `Quantidade × preço do item ${n + 1} não confere com o total bruto.`,
        });
    }
    if (v.fiscal) {
      const f = v.fiscal;
      if (v.itens.some((i) => i.valorBruto === undefined))
        ctx.addIssue({
          code: "custom",
          path: ["fiscal"],
          message:
            "Conserve os totais brutos transcritos para validar o rateio.",
        });
      else {
        const brutos = v.itens.map((i) =>
            Number(centavosDaNota(i.valorBruto!)),
          ),
          soma = brutos.reduce((a, b) => a + b, 0);
        const ajuste = Math.round(f.ajusteArredondamento * 100);
        if (
          Math.abs(ajuste) > tolerancia ||
          soma -
            Number(centavosDaNota(f.descontos)) +
            Number(centavosDaNota(f.acrescimos)) +
            ajuste !==
            Number(total)
        )
          ctx.addIssue({
            code: "custom",
            path: ["fiscal"],
            message:
              "Itens, descontos e acréscimos não conferem com o total fiscal.",
          });
        if (soma > 0) {
          const liquidos = ratearCentavos(brutos, Number(total));
          if (
            v.itens.some(
              (i, n) => Number(centavosDaNota(i.valorTotal)) !== liquidos[n],
            )
          )
            ctx.addIssue({
              code: "custom",
              path: ["itens"],
              message: "O rateio líquido por item está divergente.",
            });
        }
      }
    }
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
