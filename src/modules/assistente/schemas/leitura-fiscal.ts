import { z } from "zod";
import {
  extracaoFiscalSchema,
  validarExtracaoFiscal,
  valoresLiquidos,
  centavos,
  camposCabecalho,
  camposItem,
  type ExtracaoFiscal,
  type PendenciaFiscal,
} from "@/server/notas/extracao";
import type { RascunhoNota } from "./conferencia-nota";
import {
  mensagemLeituraFiscal,
  comandoDaRespostaFiscal,
} from "./mensagens-leitura-fiscal";
const categoriaFinanceiraSchema = z.object({
  opcoes: z.array(
    z.object({
      nome: z.string().min(1).max(160),
      valor: z.string().min(1).max(120),
    }),
  ),
  selecionada: z.string().min(1).max(120).nullable(),
  confirmada: z.boolean(),
});
export type ConferenciaFiscal = {
  versao: "fiscal-2.0";
  metodo: string;
  original: ExtracaoFiscal;
  conferida: ExtracaoFiscal;
  extras: PendenciaFiscal[];
  alertasConferidos: boolean;
  categoriaFinanceira?: z.infer<typeof categoriaFinanceiraSchema>;
};
export function conferenciaFiscal(v: unknown): ConferenciaFiscal | null {
  if (!v || typeof v !== "object") return null;
  const d = v as Partial<ConferenciaFiscal>;
  if (
    d.versao !== "fiscal-2.0" ||
    typeof d.metodo !== "string" ||
    !Array.isArray(d.extras)
  )
    return null;
  const l = extracaoFiscalSchema.safeParse(d.conferida),
    o = extracaoFiscalSchema.safeParse(d.original);
  const categoria = categoriaFinanceiraSchema.safeParse(d.categoriaFinanceira);
  return l.success && o.success
    ? {
        versao: "fiscal-2.0",
        metodo: d.metodo,
        original: o.data,
        conferida: l.data,
        extras: d.extras,
        alertasConferidos: !!d.alertasConferidos,
        ...(categoria.success ? { categoriaFinanceira: categoria.data } : {}),
      }
    : null;
}
/** Categorias vêm do catálogo autorizado; a IA só transcreve o documento. */
export function atualizarCategoriasDaLeitura(
  c: ConferenciaFiscal,
  opcoes: { nome: string; valor: string }[],
  preferida?: string,
): ConferenciaFiscal {
  const anterior = c.categoriaFinanceira;
  const valida = (id: string | null | undefined) =>
    opcoes.some((o) => o.valor === id);
  const manter = valida(anterior?.selecionada);
  const preferir = valida(preferida);
  return {
    ...c,
    categoriaFinanceira: {
      opcoes,
      selecionada: preferir
        ? preferida!
        : manter
          ? anterior!.selecionada
          : opcoes.length === 1
            ? opcoes[0].valor
            : null,
      confirmada:
        manter &&
        !!anterior?.confirmada &&
        (!preferir || preferida === anterior?.selecionada),
    },
  };
}
export function pendenciasDaConferenciaFiscal(c: ConferenciaFiscal) {
  const p = validarExtracaoFiscal(c.conferida);
  if (!c.alertasConferidos) {
    p.push(...c.extras);
    if (c.conferida.alertas.length)
      p.push({
        campo: "alertas",
        codigo: "ALERTAS",
        mensagem: "Confira os alertas da leitura no documento original.",
      });
  }
  return p;
}
export function mensagemConferenciaFiscal(c: ConferenciaFiscal): string {
  return mensagemLeituraFiscal(
    c.conferida,
    pendenciasDaConferenciaFiscal(c),
    c.categoriaFinanceira,
  );
}
export function responderLeituraFiscal(
  c: ConferenciaFiscal,
  texto: string,
): {
  conferencia: ConferenciaFiscal;
  erro: string | null;
  reconhecido: boolean;
} {
  const n = {
      ...structuredClone(c),
      original: structuredClone(c.original),
      conferida: structuredClone(c.conferida),
    },
    d = n.conferida,
    s =
      comandoDaRespostaFiscal(d, pendenciasDaConferenciaFiscal(c), texto) ??
      texto.trim();
  if (/^corrigir\s+parcelas\s+(sem|ilegivel|ilegível|null)$/i.test(s)) {
    d.parcelas = null;
    d.confianca.parcelas = 0;
    return { conferencia: n, erro: null, reconhecido: true };
  }
  if (/^conferi\s+leitura$/i.test(s)) {
    for (const k of camposCabecalho) if (d[k] !== null) d.confianca[k] = 1;
    for (const i of d.itens)
      for (const k of camposItem) if (i[k] !== null) i.confianca[k] = 1;
    n.alertasConferidos = true;
    return { conferencia: n, erro: null, reconhecido: true };
  }
  if (/^sem\s+ajustes$/i.test(s)) {
    d.descontos = 0;
    d.acrescimos = 0;
    d.confianca.descontos = 1;
    d.confianca.acrescimos = 1;
    return { conferencia: n, erro: null, reconhecido: true };
  }
  const numero = (v: string) => {
    const x = v.trim().replace(/^R\$\s*/, "");
    const z = Number(
      x.includes(",") ? x.replaceAll(".", "").replace(",", ".") : x,
    );
    return Number.isFinite(z) && z >= 0 && z <= 1_000_000_000 ? z : null;
  };
  let m =
    /^corrigir\s+item\s+(\d+)\s+(quantidade|valor|nome|unidade|preco|preço|ean|codigo|código)\s+(.+)$/i.exec(
      s,
    );
  if (m) {
    const i = d.itens[Number(m[1]) - 1];
    if (!i)
      return {
        conferencia: c,
        erro: "Item não encontrado.",
        reconhecido: true,
      };
    const campo = m[2].normalize("NFD").replace(/\p{M}/gu, "").toLowerCase(),
      v = m[3].trim();
    const numeros = {
      quantidade: "quantidade",
      valor: "valor_total",
      preco: "valor_unitario",
    } as const;
    if (campo in numeros) {
      const k = numeros[campo as keyof typeof numeros],
        x = numero(v);
      if (x === null)
        return {
          conferencia: c,
          erro: "Informe um número válido.",
          reconhecido: true,
        };
      i[k] = x;
      i.confianca[k] = 1;
    } else {
      const k = (
        {
          nome: "descricao",
          unidade: "unidade",
          ean: "codigo_ean",
          codigo: "codigo_fornecedor",
        } as const
      )[campo as "nome" | "unidade" | "ean" | "codigo"];
      i[k] = /^(?:null|ilegivel|ilegível|sem)$/i.test(v) ? null : v;
      i.confianca[k] = i[k] === null ? 0 : 1;
    }
  } else {
    m =
      /^corrigir\s+(cnpj|cpf|fornecedor|data|numero|número|serie|série|chave|total|descontos|acrescimos|acréscimos|pagamento)\s+(.+)$/i.exec(
        s,
      );
    if (!m) return { conferencia: c, erro: null, reconhecido: false };
    const k = m[1].normalize("NFD").replace(/\p{M}/gu, "").toLowerCase(),
      v = m[2].trim();
    if (["total", "descontos", "acrescimos"].includes(k)) {
      const campo =
          k === "total" ? "total_nota" : (k as "descontos" | "acrescimos"),
        x = numero(v);
      if (x === null)
        return {
          conferencia: c,
          erro: "Informe um número válido.",
          reconhecido: true,
        };
      d[campo] = x;
      d.confianca[campo] = 1;
    } else {
      const campo = (
        {
          cnpj: "cnpj_emitente",
          cpf: "cpf_emitente",
          fornecedor: "razao_social",
          data: "data_emissao",
          numero: "numero",
          serie: "serie",
          chave: "chave_acesso",
          pagamento: "forma_pagamento",
        } as const
      )[
        k as
          | "cnpj"
          | "cpf"
          | "fornecedor"
          | "data"
          | "numero"
          | "serie"
          | "chave"
          | "pagamento"
      ];
      let valor: string | null = /^(?:null|ilegivel|ilegível|sem)$/i.test(v)
        ? null
        : v;
      if (
        campo === "cnpj_emitente" ||
        campo === "cpf_emitente" ||
        campo === "chave_acesso"
      )
        valor = valor?.replace(/\D/g, "") ?? null;
      if (
        campo === "data_emissao" &&
        valor &&
        /^\d{2}\/\d{2}\/\d{4}$/.test(valor)
      )
        valor = valor.split("/").reverse().join("-");
      d[campo] = valor;
      d.confianca[campo] = valor === null ? 0 : 1;
      if (campo === "cnpj_emitente") d.cpf_emitente = null;
      if (campo === "cpf_emitente") d.cnpj_emitente = null;
    }
  }
  const validada = extracaoFiscalSchema.safeParse(d);
  if (!validada.success)
    return {
      conferencia: c,
      erro: "O campo excede o formato permitido. Confira o valor no documento.",
      reconhecido: true,
    };
  return { conferencia: n, erro: null, reconhecido: true };
}
export function rascunhoDaLeituraFiscal(
  c: ConferenciaFiscal,
  meta: { operacaoId: string; arquivoId: string; recebidaEm: string },
  anterior?: RascunhoNota,
): RascunhoNota {
  if (pendenciasDaConferenciaFiscal(c).length)
    throw new Error("A leitura fiscal ainda tem pendências.");
  const d = c.conferida,
    liquidos = valoresLiquidos(d),
    documento = d.cnpj_emitente ?? d.cpf_emitente ?? undefined;
  const mesmoFornecedor = anterior?.fornecedor.documento === documento;
  const itens = d.itens.map((i, n) => {
    const a = mesmoFornecedor ? anterior?.itens[n] : undefined,
      mesmo =
        a &&
        a.descricao === i.descricao &&
        a.unidade === i.unidade &&
        a.codigoFornecedor === (i.codigo_fornecedor ?? undefined) &&
        a.ean === (i.codigo_ean ?? undefined);
    return {
      descricao: i.descricao!,
      quantidade: i.quantidade!,
      unidade: i.unidade!,
      valorTotal: liquidos[n],
      valorBruto: i.valor_total!,
      valorUnitarioImpresso: i.valor_unitario ?? undefined,
      codigoFornecedor: i.codigo_fornecedor ?? undefined,
      ean: i.codigo_ean ?? undefined,
      ...(mesmo
        ? {
            insumoId: a.insumoId,
            novoInsumo: a.novoInsumo,
            fatorConversao: a.fatorConversao,
            exigirVinculo: a.exigirVinculo,
          }
        : {}),
    };
  });
  const forma = d.forma_pagamento
    ?.normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase();
  const formaNormalizada = forma?.includes("PIX")
    ? "PIX"
    : forma?.includes("CREDITO")
      ? "CREDITO"
      : forma?.includes("DEBITO")
        ? "DEBITO"
        : forma;
  const formas = [
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
  ];
  const pagamento = { ...anterior?.pagamento };
  if (!pagamento.forma && formaNormalizada && formas.includes(formaNormalizada))
    pagamento.forma = formaNormalizada as NonNullable<
      RascunhoNota["pagamento"]["forma"]
    >;
  if (anterior && anterior.valorTotal !== d.total_nota)
    delete pagamento.parcelas;
  if (
    !pagamento.parcelas &&
    d.parcelas?.length &&
    d.parcelas.every((p) => p.vencimento && p.valor !== null)
  )
    pagamento.parcelas = d.parcelas.map((p) => ({
      vencimento: p.vencimento!,
      valor: p.valor!,
    }));
  return {
    ...anterior,
    ...meta,
    ...(!anterior?.categoriaId && c.categoriaFinanceira?.selecionada
      ? { categoriaId: c.categoriaFinanceira.selecionada }
      : {}),
    fornecedor: { nome: d.razao_social!, documento },
    numero: d.numero ?? undefined,
    serie: d.serie ?? undefined,
    chaveAcesso: d.chave_acesso ?? undefined,
    emitidaEm: d.data_emissao!,
    valorTotal: d.total_nota!,
    itens,
    pagamento,
    fiscal: {
      descontos: d.descontos!,
      acrescimos: d.acrescimos!,
      ajusteArredondamento:
        (centavos(d.total_nota!) -
          d.itens.reduce((s, i) => s + centavos(i.valor_total!), 0) +
          centavos(d.descontos!) -
          centavos(d.acrescimos!)) /
        100,
    },
  };
}
