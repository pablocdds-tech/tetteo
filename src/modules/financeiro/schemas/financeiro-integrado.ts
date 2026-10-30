import { z } from "zod";
import { centavos, dataBancaria } from "./bancos";

const texto = (n: number) => z.string().trim().max(n);
const id = texto(128).min(1);
const opcional = texto(128)
  .nullish()
  .transform((v) => v || null);
export const dinheiroIntegrado = z
  .string()
  .trim()
  .transform((v) => v.replace(/^R\$\s*/, ""))
  .transform((v) =>
    v.includes(",") ? v.replace(/\./g, "").replace(",", ".") : v,
  )
  .refine(
    (v) => /^\d{1,12}(\.\d{1,2})?$/.test(v),
    "Informe um valor como 1.234,56.",
  );
export const diaIntegrado = texto(10).refine((v) => {
  try {
    dataBancaria(v);
    return true;
  } catch {
    return false;
  }
}, "Data inválida.");
export const pagamentoIntegrado = z.enum([
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
]);
export const lancamentoIntegrado = z
  .object({
    id: opcional,
    versao: z.coerce.number().int().nonnegative().default(0),
    empresaId: id,
    pessoaId: opcional,
    categoriaId: id,
    centroCustoId: opcional,
    direcao: z.enum(["PAGAR", "RECEBER"]),
    descricao: texto(300).min(2),
    valor: dinheiroIntegrado,
    desconto: dinheiroIntegrado.default("0"),
    multa: dinheiroIntegrado.default("0"),
    juros: dinheiroIntegrado.default("0"),
    vencimento: diaIntegrado,
    competencia: diaIntegrado,
    tipoPagamento: pagamentoIntegrado,
    historico: z.enum([
      "Pagamento",
      "Recebimento",
      "Sangria",
      "Transferência",
      "Suprimento",
    ]),
    numeroPedido: texto(100).default(""),
    numeroNotaFiscal: texto(100).default(""),
    observacao: texto(2000).default(""),
    composeDre: z.boolean().default(true),
    restritoMaster: z.boolean().default(false),
  })
  .refine(
    (v) =>
      centavos(v.valor) -
        centavos(v.desconto) +
        centavos(v.multa) +
        centavos(v.juros) >
      0n,
    "O valor líquido deve ser maior que zero.",
  );
export const pessoaIntegrada = z
  .object({
    id: opcional,
    nome: texto(160).min(2),
    tipoDocumento: z.enum(["cpf", "cnpj"]),
    documento: texto(30).transform((v) => v.replace(/\D/g, "") || null),
    telefone: texto(40).default(""),
    email: z.union([z.email(), z.literal("")]).default(""),
    categoria: texto(80).default(""),
    contato: texto(100).default(""),
    endereco: texto(300).default(""),
    cidade: texto(100).default(""),
    categoriaId: opcional,
    operacaoPadrao: z.enum(["PAGAR", "RECEBER"]).default("PAGAR"),
    prazoDias: z.coerce.number().int().min(0).max(365).default(0),
    chavePix: texto(160).default(""),
    observacoes: texto(2000).default(""),
    ehFuncionario: z.boolean().default(false),
  })
  .refine(
    (v) =>
      !v.documento ||
      v.documento.length === (v.tipoDocumento === "cnpj" ? 14 : 11),
    "Documento deve conter 11 dígitos (CPF) ou 14 (CNPJ).",
  );
export const planoIntegrado = z.object({
  id: opcional,
  nome: texto(100).min(2),
  codigo: texto(30).min(1),
  tipo: z.enum(["RECEITA", "DESPESA"]),
  paiId: opcional,
  entraDre: z.boolean().default(true),
});
export const baixaIntegrada = z
  .object({
    lancamentoId: id,
    contaId: id,
    valor: dinheiroIntegrado,
    dataPagamento: diaIntegrado,
    tipoPagamento: pagamentoIntegrado,
    complemento: texto(500).default(""),
    chave: z.uuid(),
  })
  .refine((v) => centavos(v.valor) > 0n, "Valor deve ser positivo.");
export const integracaoIntegrada = z.object({
  id: opcional,
  empresaId: id,
  contaId: id,
  envKey: texto(32).regex(
    /^[A-Z][A-Z0-9_]{0,31}$/,
    "Use letras maiúsculas, números e sublinhado.",
  ),
  ambiente: z.enum(["sandbox", "producao"]),
  ativa: z.boolean().default(true),
});
export const transferenciaIntegrada = z
  .object({
    origemId: id,
    destinoId: id,
    data: diaIntegrado,
    valor: dinheiroIntegrado,
    descricao: texto(300).min(2),
    chave: z.uuid(),
  })
  .refine(
    (v) => v.origemId !== v.destinoId && centavos(v.valor) > 0n,
    "Escolha contas diferentes e valor positivo.",
  );
export const filtroIntegrado = z.object({
  pagina: z.coerce.number().int().min(1).max(10000).default(1),
  q: texto(120).default(""),
  direcao: z.enum(["PAGAR", "RECEBER", ""]).default(""),
  status: z.enum(["ABERTO", "QUITADO", "CANCELADO", ""]).default(""),
  empresaId: texto(128).default(""),
  de: diaIntegrado.optional(),
  ate: diaIntegrado.optional(),
});
