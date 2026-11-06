import { documentoFiscalValido } from "@/lib/documento-fiscal";
import type { ExtracaoFiscal, PendenciaFiscal } from "@/server/notas/extracao";

type PerguntaFiscal = {
  texto: string;
  comando?: string;
  resposta?: "numero" | "documento" | "chave" | "ean" | "texto";
};
const limpar = (s: string) =>
  s
    .replace(/[\r\n\t*_~`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const moeda = (n: number | null) =>
  n === null
    ? "a conferir"
    : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const numero = (n: number | null) =>
  n === null ? "?" : n.toLocaleString("pt-BR", { maximumFractionDigits: 4 });

/** Uma pergunta por vez. Códigos e divergências completas permanecem na leitura auditada. */
function proximaPergunta(
  d: ExtracaoFiscal,
  pendencias: PendenciaFiscal[],
): PerguntaFiscal {
  if (
    pendencias.some((p) =>
      ["DESATIVADA", "INDISPONIVEL", "NAO_AUTORIZADA"].includes(p.codigo),
    ) ||
    !d.itens.length
  )
    return {
      texto:
        "Não consegui ler os produtos com segurança.\nEnvie outra foto mais nítida ou o XML da nota.",
    };
  const p = pendencias.find(
    (p) =>
      ![
        "BAIXA_CONFIANCA",
        "ALERTAS",
        "LEITURAS_DIVERGENTES",
        "QR_DIVERGENTE",
        "FONTES_DIVERGENTES",
        "SEGUNDA_LEITURA_INDISPONIVEL",
      ].includes(p.codigo),
  );
  if (!p)
    return {
      texto:
        "Confira os produtos respondendo *ITENS*.\nDepois, responda *CONFERI* para seguir com os dados lidos.",
      comando: "CONFERI LEITURA",
    };
  if (p.campo === "cnpj_emitente" || p.campo === "cpf_emitente")
    return {
      texto:
        "Preciso conferir o CPF/CNPJ do fornecedor.\nEnvie apenas os números do documento.",
      resposta: "documento",
    };
  if (p.campo === "chave_acesso")
    return {
      texto:
        "Preciso conferir a chave da nota.\nEnvie os 44 números ou outra foto mais nítida da parte de baixo do cupom.",
      comando: "CORRIGIR CHAVE",
      resposta: "chave",
    };
  if (p.campo === "totais") {
    const desconto = d.descontos === null;
    return {
      texto: `Qual é o valor ${desconto ? "do desconto" : "do acréscimo"}?\nEnvie o valor ou *0* se não houver.`,
      comando: desconto ? "CORRIGIR DESCONTOS" : "CORRIGIR ACRESCIMOS",
      resposta: "numero",
    };
  }
  if (p.campo === "parcelas")
    return {
      texto:
        "Os vencimentos da nota precisam ser conferidos.\nResponda *PAGAMENTO DEPOIS* para informar o pagamento na próxima etapa.",
      comando: "CORRIGIR PARCELAS SEM",
    };
  const item = /^itens\.(\d+)\.(\w+)$/.exec(p.campo);
  if (item) {
    const i = Number(item[1]),
      n = i + 1;
    const campos: Record<
      string,
      [string, string, NonNullable<PerguntaFiscal["resposta"]>]
    > = {
      descricao: ["Qual é o nome deste produto?", "NOME", "texto"],
      quantidade: ["Qual é a quantidade na nota?", "QUANTIDADE", "numero"],
      unidade: [
        "Qual é a unidade impressa (ex.: UN, KG ou CX)?",
        "UNIDADE",
        "texto",
      ],
      valor_unitario: ["Qual é o preço de uma unidade?", "PRECO", "numero"],
      valor_total: [
        "Qual é o valor total deste produto na nota?",
        "VALOR",
        "numero",
      ],
      codigo_ean: [
        "Envie o código de barras ou responda SEM CÓDIGO se não estiver legível.",
        "EAN",
        "ean",
      ],
    };
    const campo = campos[item[2]];
    if (campo)
      return {
        texto: `*Item ${n}: ${limpar(d.itens[i]?.descricao ?? "produto a conferir")}*\n${campo[0]}`,
        comando: `CORRIGIR ITEM ${n} ${campo[1]}`,
        resposta: campo[2],
      };
  }
  const campos: Record<
    string,
    [string, string, NonNullable<PerguntaFiscal["resposta"]>]
  > = {
    razao_social: ["Qual é o nome do fornecedor?", "FORNECEDOR", "texto"],
    data_emissao: [
      "Qual é a data de emissão?\nEnvie no formato dia/mês/ano.",
      "DATA",
      "texto",
    ],
    numero: ["Qual é o número da nota?", "NUMERO", "texto"],
    serie: ["Qual é a série da nota?", "SERIE", "texto"],
    total_nota: [
      p.codigo === "TOTAL_DIVERGENTE"
        ? "A soma dos produtos e descontos não confere com o total.\nResponda *ITENS* para conferir os valores. Para ajustar o total, envie o valor correto."
        : "Qual é o valor total da nota?",
      "TOTAL",
      "numero",
    ],
    descontos: [
      "Qual é o valor do desconto?\nEnvie o valor ou 0 se não houver.",
      "DESCONTOS",
      "numero",
    ],
    acrescimos: [
      "Qual é o valor do acréscimo?\nEnvie o valor ou 0 se não houver.",
      "ACRESCIMOS",
      "numero",
    ],
  };
  const campo = campos[p.campo];
  return campo
    ? { texto: campo[0], comando: `CORRIGIR ${campo[1]}`, resposta: campo[2] }
    : {
        texto:
          "Ainda há dados que não consegui conferir.\nEnvie outra foto mais nítida ou o XML da nota.",
      };
}

export function mensagemLeituraFiscal(
  d: ExtracaoFiscal,
  pendencias: PendenciaFiscal[],
): string {
  return [
    `*${limpar(d.razao_social ?? "Nota de compra")}*`,
    `${d.itens.length} ${d.itens.length === 1 ? "produto" : "produtos"} · *${moeda(d.total_nota)}*`,
    ...(d.descontos ? [`Desconto: ${moeda(d.descontos)}`] : []),
    ...(d.acrescimos ? [`Acréscimo: ${moeda(d.acrescimos)}`] : []),
    "",
    proximaPergunta(d, pendencias).texto,
    "",
    "*ITENS* para ver os produtos · *CANCELAR* para descartar.",
    "Ainda não houve lançamento.",
  ].join("\n");
}

export function mensagemItensFiscais(d: ExtracaoFiscal): string {
  const documento = d.cnpj_emitente ?? d.cpf_emitente;
  return [
    `*Produtos da nota · ${limpar(d.razao_social ?? "fornecedor a conferir")}*`,
    ...(documento && documentoFiscalValido(documento)
      ? [`CPF/CNPJ: ${documento}`]
      : []),
    "",
    ...d.itens.map(
      (i, n) =>
        `${n + 1}. *${limpar(i.descricao ?? "Produto a conferir")}*\n${numero(i.quantidade)} ${limpar(i.unidade ?? "?")} × ${moeda(i.valor_unitario)} = ${moeda(i.valor_total)}`,
    ),
    "",
    `Desconto: ${moeda(d.descontos)} · Acréscimo: ${moeda(d.acrescimos)}`,
    `*Total: ${moeda(d.total_nota)}*`,
    ...(d.forma_pagamento
      ? [`Pagamento na nota: ${limpar(d.forma_pagamento)}`]
      : []),
    "",
    "Para ajustar um produto: CORRIGIR ITEM seguido do número, campo e valor.",
    "*RESUMO* para voltar à pergunta. Ainda não houve lançamento.",
  ].join("\n");
}

/** Respostas simples só alteram o campo da pergunta atual; nunca autorizam um lançamento. */
export function comandoDaRespostaFiscal(
  d: ExtracaoFiscal,
  pendencias: PendenciaFiscal[],
  texto: string,
): string | null {
  const s = texto.trim();
  if (
    /^(?:ok|confirmar|corrigir|cancelar|resumo|itens|detalhes|ajuda|buscar|alterar|nota|conferi\s+leitura|sem\s+ajustes)\b/i.test(
      s,
    )
  )
    return null;
  const p = proximaPergunta(d, pendencias);
  if (/^conferi$/i.test(s))
    return p.comando === "CONFERI LEITURA" ? p.comando : null;
  if (/^pagamento depois$/i.test(s))
    return p.comando === "CORRIGIR PARCELAS SEM" ? p.comando : null;
  if (/^sem c[oó]digo$/i.test(s))
    return p.resposta === "ean" ? `${p.comando} SEM` : null;
  if (/^(sim|n[aã]o)$/i.test(s)) return null;
  if (p.resposta === "documento" && /^[\d.\s/-]+$/.test(s)) {
    const v = s.replace(/\D/g, "");
    if (v.length === 14 || v.length === 11)
      return `CORRIGIR ${v.length === 14 ? "CNPJ" : "CPF"} ${v}`;
  }
  if (
    p.resposta === "chave" &&
    /^[\d\s]+$/.test(s) &&
    s.replace(/\s/g, "").length === 44
  )
    return `${p.comando} ${s}`;
  if (p.resposta === "ean") {
    if (/^\d{8,14}$/.test(s)) return `${p.comando} ${s}`;
  }
  if (p.resposta === "numero" && /^(?:R\$\s*)?\d[\d.,]*$/.test(s))
    return `${p.comando} ${s}`;
  if (p.resposta === "texto" && s.length > 0 && s.length <= 240)
    return `${p.comando} ${s}`;
  return null;
}
