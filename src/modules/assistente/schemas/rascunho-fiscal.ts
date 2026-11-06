import { z } from "zod";
import {
  camposCabecalho,
  camposItem,
  confiancasDoItem,
  extracaoFiscalSchema,
  validarExtracaoFiscal,
  type ExtracaoFiscal,
  type PendenciaFiscal,
} from "@/server/notas/extracao";

export type RascunhoFiscal = {
  id: string;
  revisao: number;
  arquivoId: string | null;
  dados: ExtracaoFiscal;
  pendencias: PendenciaFiscal[];
  avisos: string[];
};
export class RascunhoFiscalRecusado extends Error {}

// O cliente só envia campos editáveis. Confiança, original, alertas, autorização
// e estado da operação continuam sob controle do servidor.
const texto = (max: number) => z.string().trim().max(max).nullable();
const valor = z.number().finite().nonnegative().max(1_000_000_000).nullable();
export const edicaoFiscalSchema = z
  .object({
    ...(Object.fromEntries(
      [
        ["cnpj_emitente", 14],
        ["cpf_emitente", 11],
        ["razao_social", 160],
        ["data_emissao", 10],
        ["numero", 60],
        ["serie", 20],
        ["chave_acesso", 44],
        ["forma_pagamento", 80],
      ].map(([campo, max]) => [campo, texto(Number(max))]),
    ) as Record<
      | "cnpj_emitente"
      | "cpf_emitente"
      | "razao_social"
      | "data_emissao"
      | "numero"
      | "serie"
      | "chave_acesso"
      | "forma_pagamento",
      ReturnType<typeof texto>
    >),
    descontos: valor,
    acrescimos: valor,
    total_nota: valor,
    itens: z
      .array(
        z
          .object({
            descricao: texto(240),
            quantidade: valor,
            unidade: texto(30),
            valor_unitario: valor,
            valor_total: valor,
            codigo_ean: texto(14),
            codigo_fornecedor: texto(80),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
export type EdicaoFiscal = z.infer<typeof edicaoFiscalSchema>;
export const salvarRascunhoFiscalSchema = z
  .object({
    id: z.string().min(1).max(100),
    unidadeId: z.string().min(1).max(100),
    revisao: z.number().int().nonnegative(),
    dados: edicaoFiscalSchema,
  })
  .strict();

export function camposEditaveis(d: ExtracaoFiscal): EdicaoFiscal {
  return edicaoFiscalSchema.parse(
    Object.fromEntries(
      Object.keys(edicaoFiscalSchema.shape).map((k) => [
        k,
        k === "itens"
          ? d.itens.map((i) =>
              Object.fromEntries(camposItem.map((campo) => [campo, i[campo]])),
            )
          : d[k as keyof ExtracaoFiscal],
      ]),
    ),
  );
}

export function aplicarEdicaoFiscal(
  anterior: ExtracaoFiscal,
  entrada: unknown,
): ExtracaoFiscal {
  const e = edicaoFiscalSchema.parse(entrada);
  const d = structuredClone(anterior);
  const limpar = <T>(v: T): T | null => (v === "" ? null : v);
  for (const k of camposCabecalho) {
    if (k === "parcelas") continue;
    const v = limpar(e[k]);
    if (d[k] !== v) d.confianca[k] = v === null ? 0 : 1;
    Object.assign(d, { [k]: v });
  }
  d.itens = e.itens.map((item, n) => {
    const confianca = anterior.itens[n]
      ? { ...anterior.itens[n].confianca }
      : confiancasDoItem();
    const novo = { ...item, confianca };
    for (const k of camposItem) {
      const v = limpar(item[k]);
      Object.assign(novo, { [k]: v });
      if (anterior.itens[n]?.[k] !== v) confianca[k] = v === null ? 0 : 1;
    }
    return novo;
  });
  return extracaoFiscalSchema.parse(d);
}

/** Pendências orientam a edição; nunca impedem salvar um rascunho. */
export function pendenciasDoRascunho(d: ExtracaoFiscal): PendenciaFiscal[] {
  return validarExtracaoFiscal(d).flatMap((p) => {
    if (p.campo === "cnpj_emitente" && !d.cnpj_emitente && d.cpf_emitente)
      return [{ ...p, campo: "cpf_emitente" }];
    if (p.campo !== "totais") return [p];
    return (["descontos", "acrescimos"] as const)
      .filter((k) => d[k] === null)
      .map((campo) => ({
        ...p,
        campo,
        mensagem:
          "Não identificado. Confira no documento; mantenha vazio se não souber.",
      }));
  });
}
