import { chaveFiscalValida, dadosDaChave } from "@/lib/documento-fiscal";
import {
  confiancas,
  confiancasDoItem,
  extracaoVazia,
  type ExtracaoFiscal,
} from "./extracao";
const decimal = (v: string | undefined) =>
  v && /^\d[\d.]*,\d+$/.test(v)
    ? Number(v.replaceAll(".", "").replace(",", "."))
    : v && /^\d+$/.test(v)
      ? Number(v)
      : null;
/** Parser conservador de DANFE/cupom textual. Layout desconhecido fica pendente. */
export function lerTextoFiscal(texto: string): ExtracaoFiscal {
  const d = extracaoVazia(),
    linhas = texto
      .slice(0, 240_000)
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
  const textoPlano = linhas.join("\n");
  const chave = textoPlano
    .match(/(?:\d{4}[ \t]*){11}/g)
    ?.map((v) => v.replace(/\s/g, ""))
    .find(chaveFiscalValida);
  d.chave_acesso = chave ?? null;
  const documentos = [
    ...new Set(
      [
        ...textoPlano.matchAll(
          /CNPJ\s*:?\s*(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})/gi,
        ),
      ].map((m) => m[1].replace(/\D/g, "")),
    ),
  ];
  const emitenteDaChave = chave ? dadosDaChave(chave)?.cnpj : null;
  d.cnpj_emitente =
    documentos.length === 1
      ? documentos[0]
      : emitenteDaChave && documentos.includes(emitenteDaChave)
        ? emitenteDaChave
        : null;
  if (documentos.length > 1 && !d.cnpj_emitente)
    d.alertas.push(
      "Há mais de um CNPJ no PDF e não foi possível identificar o emitente com segurança.",
    );
  d.razao_social =
    textoPlano
      .match(/(?:RAZ[AÃ]O SOCIAL|EMITENTE|FORNECEDOR)\s*:?\s*([^\n]+)/i)?.[1]
      .trim() ?? null;
  const data = textoPlano.match(
    /(?:DATA (?:DE )?EMISS[AÃ]O|EMISS[AÃ]O)\s*:?\s*(\d{2}\/\d{2}\/20\d{2}|20\d{2}-\d{2}-\d{2})/i,
  )?.[1];
  d.data_emissao = data?.includes("/")
    ? data.split("/").reverse().join("-")
    : (data ?? null);
  d.numero =
    textoPlano
      .match(/(?:N[ÚU]MERO|N[º°.]|NF-?E\s*N[º°.]?)\s*:?\s*(\d[\d.]*)/i)?.[1]
      .replaceAll(".", "") ?? null;
  d.serie = textoPlano.match(/S[ÉE]RIE\s*:?\s*(\d+)/i)?.[1] ?? null;
  const lerValor = (label: string) =>
    decimal(
      new RegExp(`${label}\\s*:?\\s*(?:R\\$\\s*)?([\\d.]+,\\d{2})`, "i").exec(
        textoPlano,
      )?.[1],
    );
  d.total_nota = lerValor(
    "(?:VALOR TOTAL DA NOTA|TOTAL DA NOTA|TOTAL A PAGAR)",
  );
  d.descontos = lerValor("(?:DESCONTOS?|VALOR DO DESCONTO)");
  d.acrescimos = lerValor("(?:ACR[ÉE]SCIMOS?|FRETE E ACR[ÉE]SCIMOS)");
  const forma = textoPlano
    .match(
      /(?:FORMA DE PAGAMENTO|PAGAMENTO)\s*:?\s*(PIX|DINHEIRO|BOLETO|CART[AÃ]O DE CR[ÉE]DITO|CART[AÃ]O DE D[ÉE]BITO)/i,
    )?.[1]
    .toUpperCase();
  d.forma_pagamento = forma?.includes("CR")
    ? "CREDITO"
    : forma?.includes("DÉBITO") || forma?.includes("DEBITO")
      ? "DEBITO"
      : (forma ?? null);
  let tabela = false,
    pendente = "";
  for (const linha of linhas) {
    if (
      /DESCRI[CÇ][AÃ]O/i.test(linha) &&
      /QTD|QUANT/i.test(linha) &&
      /TOTAL/i.test(linha)
    ) {
      tabela = true;
      continue;
    }
    if (!tabela) continue;
    if (
      /^(?:VALOR TOTAL|TOTAL DA NOTA|TOTAL A PAGAR|DESCONTOS?|PAGAMENTO|FORMA DE PAGAMENTO)/i.test(
        linha,
      )
    ) {
      tabela = false;
      continue;
    }
    const l = `${pendente} ${linha}`.trim();
    const m =
      /^([\w.-]{1,30})\s+(.+?)\s+(\d+(?:[.,]\d{1,4})?)\s+([A-Z]{1,6})\s+([\d.]+,\d{2,6})\s+([\d.]+,\d{2})\s*$/.exec(
        l,
      );
    if (m) {
      d.itens.push({
        codigo_fornecedor: m[1],
        descricao: m[2],
        quantidade: decimal(m[3]),
        unidade: m[4],
        valor_unitario: decimal(m[5]),
        valor_total: decimal(m[6]),
        codigo_ean: null,
        confianca: confiancasDoItem(pendente ? 0.85 : 0.95),
      });
      pendente = "";
    } else pendente = l.length <= 500 ? l : "";
  }
  d.confianca = confiancas(0.95);
  d.alertas.push(
    "Texto extraído diretamente do PDF. Campos e tabelas de layout desconhecido ficam a conferir.",
  );
  return d;
}
