import { z } from "zod";
import {
  chaveFiscalValida,
  dadosDaChave,
  documentoFiscalValido,
  eanValido,
  toleranciaFiscalCentavos,
} from "@/lib/documento-fiscal";

const texto = (max: number) => z.string().trim().min(1).max(max).nullable();
const numero = z.number().finite().nonnegative().max(1_000_000_000).nullable();
const confianca = z.number().min(0).max(1);
export const camposCabecalho = [
  "cnpj_emitente",
  "cpf_emitente",
  "razao_social",
  "data_emissao",
  "numero",
  "serie",
  "chave_acesso",
  "descontos",
  "acrescimos",
  "total_nota",
  "forma_pagamento",
  "parcelas",
] as const;
export const camposItem = [
  "descricao",
  "quantidade",
  "unidade",
  "valor_unitario",
  "valor_total",
  "codigo_ean",
  "codigo_fornecedor",
] as const;
const confiancasCabecalho = z
  .object(
    Object.fromEntries(camposCabecalho.map((k) => [k, confianca])) as Record<
      (typeof camposCabecalho)[number],
      typeof confianca
    >,
  )
  .strict();
const confiancasItem = z
  .object(
    Object.fromEntries(camposItem.map((k) => [k, confianca])) as Record<
      (typeof camposItem)[number],
      typeof confianca
    >,
  )
  .strict();
export const extracaoFiscalSchema = z
  .object({
    cnpj_emitente: texto(14),
    cpf_emitente: texto(11),
    razao_social: texto(160),
    data_emissao: texto(10),
    numero: texto(60),
    serie: texto(20),
    chave_acesso: texto(44),
    itens: z
      .array(
        z
          .object({
            descricao: texto(240),
            quantidade: numero,
            unidade: texto(30),
            valor_unitario: numero,
            valor_total: numero,
            codigo_ean: texto(14),
            codigo_fornecedor: texto(80),
            confianca: confiancasItem,
          })
          .strict(),
      )
      .max(100),
    descontos: numero,
    acrescimos: numero,
    total_nota: numero,
    forma_pagamento: texto(80),
    parcelas: z
      .array(z.object({ vencimento: texto(10), valor: numero }).strict())
      .max(36)
      .nullable(),
    confianca: confiancasCabecalho,
    alertas: z.array(z.string().min(1).max(300)).max(20),
  })
  .strict();
export type ExtracaoFiscal = z.infer<typeof extracaoFiscalSchema>;
export type MetodoLeitura = "XML" | "PDF_TEXTO" | "QR" | "GEMINI";
export type PendenciaFiscal = {
  campo: string;
  codigo: string;
  mensagem: string;
};
export function confiancas(valor = 0) {
  return Object.fromEntries(
    camposCabecalho.map((k) => [k, valor]),
  ) as ExtracaoFiscal["confianca"];
}
export function confiancasDoItem(valor = 0) {
  return Object.fromEntries(
    camposItem.map((k) => [k, valor]),
  ) as ExtracaoFiscal["itens"][number]["confianca"];
}
export function extracaoVazia(): ExtracaoFiscal {
  return {
    cnpj_emitente: null,
    cpf_emitente: null,
    razao_social: null,
    data_emissao: null,
    numero: null,
    serie: null,
    chave_acesso: null,
    itens: [],
    descontos: null,
    acrescimos: null,
    total_nota: null,
    forma_pagamento: null,
    parcelas: null,
    confianca: confiancas(),
    alertas: [],
  };
}
export const centavos = (v: number) => Math.round((v + Number.EPSILON) * 100);
export function validarExtracaoFiscal(d: ExtracaoFiscal): PendenciaFiscal[] {
  const p: PendenciaFiscal[] = [];
  const erro = (campo: string, codigo: string, mensagem: string) =>
    p.push({ campo, codigo, mensagem });
  for (const campo of ["razao_social", "data_emissao", "total_nota"] as const)
    if (d[campo] === null)
      erro(
        campo,
        "ILEGIVEL",
        `Confira ${campo.replaceAll("_", " ")}: não foi possível ler.`,
      );
  const doc = d.cnpj_emitente ?? d.cpf_emitente;
  if (!doc)
    erro(
      "cnpj_emitente",
      "ILEGIVEL",
      "Informe o CPF/CNPJ do emitente antes de cadastrar o fornecedor.",
    );
  else if (!documentoFiscalValido(doc))
    erro(
      "cnpj_emitente",
      "DOCUMENTO_INVALIDO",
      "O CPF/CNPJ do emitente não passou nos dígitos verificadores.",
    );
  if (
    d.data_emissao &&
    (!/^20\d{2}-\d{2}-\d{2}$/.test(d.data_emissao) ||
      Number.isNaN(Date.parse(d.data_emissao)) ||
      new Date(d.data_emissao).toISOString().slice(0, 10) !== d.data_emissao)
  )
    erro("data_emissao", "DATA_INVALIDA", "Confira a data de emissão.");
  if (!d.numero && !d.chave_acesso)
    erro("numero", "ILEGIVEL", "Informe número fiscal ou chave de acesso.");
  if (d.chave_acesso) {
    if (!chaveFiscalValida(d.chave_acesso))
      erro(
        "chave_acesso",
        "CHAVE_INVALIDA",
        "A chave fiscal não passou na validação. Confira os 44 dígitos.",
      );
    else {
      const k = dadosDaChave(d.chave_acesso)!;
      const n = (s: string) => s.replace(/^0+(?=\d)/, "");
      if (
        (d.cnpj_emitente && k.cnpj !== d.cnpj_emitente) ||
        (d.numero && n(k.numero) !== n(d.numero)) ||
        (d.serie && n(k.serie) !== n(d.serie)) ||
        (d.data_emissao &&
          k.anoMes !== d.data_emissao.slice(2, 7).replace("-", ""))
      )
        erro(
          "chave_acesso",
          "CHAVE_DIVERGENTE",
          "A chave é diferente do CNPJ, número, série ou data lidos.",
        );
    }
  }
  if (!d.itens.length)
    erro(
      "itens",
      "ILEGIVEL",
      "Os itens não estão legíveis. Envie outra imagem ou o XML.",
    );
  for (const [i, item] of d.itens.entries()) {
    for (const campo of [
      "descricao",
      "quantidade",
      "unidade",
      "valor_total",
    ] as const)
      if (
        item[campo] === null ||
        (campo === "quantidade" && Number(item[campo]) <= 0)
      )
        erro(
          `itens.${i}.${campo}`,
          "ILEGIVEL",
          `Confira ${campo} do item ${i + 1}.`,
        );
    if (
      item.quantidade !== null &&
      item.valor_unitario !== null &&
      item.valor_total !== null &&
      Math.abs(
        centavos(item.quantidade * item.valor_unitario) -
          centavos(item.valor_total),
      ) > toleranciaFiscalCentavos()
    )
      erro(
        `itens.${i}.valor_total`,
        "ITEM_DIVERGENTE",
        `Quantidade × preço do item ${i + 1} não confere com o total da linha.`,
      );
    if (item.codigo_ean && !eanValido(item.codigo_ean))
      erro(
        `itens.${i}.codigo_ean`,
        "EAN_INVALIDO",
        `Confira o EAN do item ${i + 1}.`,
      );
    for (const campo of camposItem)
      if (item[campo] !== null && item.confianca[campo] < 0.9)
        erro(
          `itens.${i}.${campo}`,
          "BAIXA_CONFIANCA",
          `Confirme ${campo} do item ${i + 1}: leitura com baixa confiança.`,
        );
  }
  for (const campo of camposCabecalho)
    if (d[campo] !== null && d.confianca[campo] < 0.9)
      erro(
        campo,
        "BAIXA_CONFIANCA",
        `Confirme ${campo.replaceAll("_", " ")}: leitura com baixa confiança.`,
      );
  if (d.descontos === null || d.acrescimos === null)
    erro(
      "totais",
      "ILEGIVEL",
      "Confira descontos e acréscimos; zero precisa ser confirmado quando não estiver legível.",
    );
  if (
    d.total_nota !== null &&
    d.descontos !== null &&
    d.acrescimos !== null &&
    d.itens.every((i) => i.valor_total !== null)
  ) {
    const calculado =
      d.itens.reduce((s, i) => s + centavos(i.valor_total!), 0) -
      centavos(d.descontos) +
      centavos(d.acrescimos);
    if (
      Math.abs(calculado - centavos(d.total_nota)) > toleranciaFiscalCentavos()
    )
      erro(
        "total_nota",
        "TOTAL_DIVERGENTE",
        "Soma dos itens menos descontos mais acréscimos não confere com o total da nota.",
      );
  }
  return p;
}
/** Rateio contábil explícito em centavos; não modifica os valores transcritos. */
export function valoresLiquidos(d: ExtracaoFiscal): number[] {
  if (validarExtracaoFiscal(d).some((p) => p.codigo !== "BAIXA_CONFIANCA"))
    throw new Error("Confira as pendências fiscais antes do rateio.");
  const brutos = d.itens.map((i) => BigInt(centavos(i.valor_total!)));
  const soma = brutos.reduce((a, b) => a + b, 0n),
    alvo = BigInt(centavos(d.total_nota!));
  if (soma <= 0n) throw new Error("A nota precisa ter itens com valor.");
  const bases = brutos.map((v) => (v * alvo) / soma);
  let resto = alvo - bases.reduce((a, b) => a + b, 0n);
  const ordem = brutos
    .map((v, i) => ({ i, r: (v * alvo) % soma }))
    .sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (const { i } of ordem)
    if (resto > 0n) {
      bases[i]++;
      resto--;
    }
  return bases.map((v) => Number(v) / 100);
}
