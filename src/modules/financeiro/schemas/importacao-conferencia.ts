import { createHash } from "node:crypto";

import {
  configuracaoSchema,
  diaValido,
  linhaSchema,
  LIMITE_ARQUIVO,
  LIMITE_LINHAS,
  type Configuracao,
  type Linha,
} from "./conferencia";

export function hash(valor: string | Uint8Array) {
  return createHash("sha256").update(valor).digest("hex");
}
export function canonico(valor: unknown): string {
  if (Array.isArray(valor)) return "[" + valor.map(canonico).join(",") + "]";
  if (valor && typeof valor === "object")
    return (
      "{" +
      Object.entries(valor)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonico(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(valor);
}

export function reaisEmCentavos(valor: string) {
  const limpo = valor.trim().replace(/^R\$\s*/, "");
  if (!/^-?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(limpo))
    throw new Error("Valor BRL inválido; use 1.250,00.");
  const negativo = limpo.startsWith("-");
  const [inteiro, decimais = ""] = limpo
    .replace("-", "")
    .replaceAll(".", "")
    .split(",");
  const resultado =
    Number(BigInt(inteiro) * BigInt(100) + BigInt(decimais.padEnd(2, "0"))) *
    (negativo ? -1 : 1);
  if (!Number.isSafeInteger(resultado))
    throw new Error("Valor fora do limite.");
  return resultado;
}

// CSV RFC 4180 com separador explícito, aspas escapadas e quebras dentro da célula.
export function lerCsv(texto: string, separador: string): string[][] {
  const linhas: string[][] = [];
  let linha: string[] = [];
  let campo = "";
  let aspas = false;
  let fechado = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (c === '"') {
      if (aspas && texto[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (aspas) {
        aspas = false;
        fechado = true;
      } else if (!campo && !fechado) aspas = true;
      else throw new Error("Aspas fora do lugar no CSV.");
    } else if (!aspas && c === separador) {
      linha.push(campo);
      campo = "";
      fechado = false;
    } else if (!aspas && (c === "\n" || c === "\r")) {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      linha.push(campo);
      linhas.push(linha);
      linha = [];
      campo = "";
      fechado = false;
    } else {
      if (fechado) throw new Error("Há texto depois de aspas fechadas no CSV.");
      campo += c;
    }
    if (linhas.length > LIMITE_LINHAS + 2 || campo.length > 10_000)
      throw new Error(
        "O arquivo excede o limite de 5.000 linhas ou de tamanho por célula.",
      );
  }
  if (aspas) throw new Error("O CSV terminou com aspas abertas.");
  if (campo || linha.length) {
    linha.push(campo);
    linhas.push(linha);
  }
  return linhas;
}

const nomes: Record<string, string> = {
  provedor: "provider",
  estabelecimento: "merchantRef",
  conta: "accountRef",
  id: "externalId",
  venda: "saleExternalId",
  dia: "businessDay",
  data: "businessDay",
  data_hora: "occurredAt",
  bruto_centavos: "grossCents",
  taxa_centavos: "feeCents",
  liquido_centavos: "netCents",
  valor_centavos: "amountCents",
  ajuste_centavos: "adjustmentCents",
  motivo_ajuste: "adjustmentReason",
  bruto: "gross",
  taxa: "fee",
  liquido: "net",
  valor: "amount",
  ajuste: "adjustment",
  metodo: "method",
  bandeira: "brand",
  parcelas: "installments",
  parcela: "installmentNumber",
  situacao: "status",
  lote: "payoutRef",
  liquidacao: "expectedSettlementDay",
  descricao: "description",
  direcao: "direction",
  terminal: "terminalRef",
  autorizacao: "authorizationCode",
};
const monetarios: Record<string, string> = {
  gross: "grossCents",
  fee: "feeCents",
  net: "netCents",
  amount: "amountCents",
  adjustment: "adjustmentCents",
};
const inteiros = new Set([
  "grossCents",
  "feeCents",
  "netCents",
  "amountCents",
  "adjustmentCents",
  "installments",
  "installmentNumber",
]);
const permitidos = new Set(
  Object.keys(linhaSchema.shape).concat(Object.keys(monetarios)),
);
const normalizarTexto = (v: string) =>
  v
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
const traduzir: Record<string, string> = {
  CREDITO: "CREDIT",
  DEBITO: "DEBIT",
  LIQUIDADO: "SETTLED",
  PENDENTE: "PENDING",
  CANCELADO: "CANCELLED",
  CONCLUIDO: "COMPLETED",
  CREDITO_CARTAO: "CREDIT",
  DEBITO_CARTAO: "DEBIT",
  MASTERCARD: "MASTERCARD",
  MASTER: "MASTERCARD",
  "MASTER CARD": "MASTERCARD",
  "AMERICAN EXPRESS": "AMEX",
  "NAO INFORMADO": "UNKNOWN",
};
function dataDoCampo(valor: string, config: Configuracao) {
  if (config.formatoData === "BR") {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(valor);
    if (!m) throw new Error("Data inválida; esperado DD/MM/AAAA.");
    return `${m[3]}-${m[2]}-${m[1]}`;
  }
  return valor;
}
export type LinhaLida = {
  numero: number;
  bruto: Record<string, unknown>;
  normalizado: Linha | null;
  erros: string[];
  hash: string;
  identidade: string | null;
};
export type Leitura = {
  colunas: string[];
  avisos: string[];
  linhas: LinhaLida[];
  lidas: number;
  aceitas: number;
  rejeitadas: number;
  ignoradas: number;
};

export function interpretar(
  bytes: Uint8Array,
  nomeArquivo: string,
  configuracao: Configuracao,
  fusoHorario: string,
): Leitura {
  const config = configuracaoSchema.parse(configuracao);
  if (bytes.length === 0 || bytes.length > LIMITE_ARQUIVO)
    throw new Error("Envie um CSV ou JSON de até 2 MB, com conteúdo.");
  let texto: string;
  try {
    texto = new TextDecoder("utf-8", { fatal: true })
      .decode(bytes)
      .replace(/^\uFEFF/, "");
  } catch {
    throw new Error("Use um arquivo em UTF-8.");
  }
  if (texto.includes("\0"))
    throw new Error("O arquivo não contém texto válido.");
  let brutas: {
    numero: number;
    linha: Record<string, unknown>;
    erro?: string;
  }[];
  let colunas: string[];
  let ignoradas = 0;
  if (nomeArquivo.toLowerCase().endsWith(".json")) {
    const parsed: unknown = JSON.parse(texto);
    if (!Array.isArray(parsed) || parsed.length > LIMITE_LINHAS)
      throw new Error("O JSON deve ser uma lista de até 5.000 objetos.");
    brutas = parsed.map((linha, i) => ({
      numero: i + 1,
      linha:
        linha && typeof linha === "object" && !Array.isArray(linha)
          ? linha
          : { valorOriginal: linha },
      erro:
        !linha || typeof linha !== "object" || Array.isArray(linha)
          ? "A linha não é um objeto."
          : undefined,
    }));
    colunas = [...new Set(brutas.flatMap((l) => Object.keys(l.linha)))];
  } else if (nomeArquivo.toLowerCase().endsWith(".csv")) {
    const csv = lerCsv(texto, config.separador);
    colunas = (csv.shift() ?? []).map((c) => c.trim());
    if (
      !colunas.length ||
      colunas.some((c) => !c) ||
      new Set(colunas).size !== colunas.length
    )
      throw new Error("Cabeçalhos vazios ou repetidos no CSV.");
    brutas = [];
    csv.forEach((linha, i) => {
      if (linha.every((c) => c.trim() === "")) {
        ignoradas++;
        return;
      }
      brutas.push({
        numero: i + 2,
        linha: Object.fromEntries(
          linha.map((v, j) => [colunas[j] ?? `colunaExtra${j}`, v]),
        ),
        erro:
          linha.length !== colunas.length
            ? "Quantidade de colunas diferente do cabeçalho."
            : undefined,
      });
    });
  } else
    throw new Error(
      "Use arquivos .csv ou .json. Outros formatos precisam de um adapter próprio.",
    );
  if (brutas.length > LIMITE_LINHAS || !brutas.length)
    throw new Error("O arquivo precisa conter de 1 a 5.000 linhas.");
  const colunasNormalizadas = colunas.map((c) => nomes[c] ?? c);
  if (new Set(colunasNormalizadas).size !== colunasNormalizadas.length)
    throw new Error(
      "Duas colunas representam o mesmo campo; revise o cabeçalho.",
    );
  const desconhecidas = colunas.filter((c) => !permitidos.has(nomes[c] ?? c));
  const avisos = desconhecidas.length
    ? [
        `Colunas sem interpretação: ${desconhecidas.join(", ")}. Revise o lote antes de confirmar.`,
      ]
    : [];
  const linhas: LinhaLida[] = brutas.map(({ numero, linha, erro }) => {
    let normalizado: Linha | null = null;
    const erros: string[] = erro ? [erro] : [];
    try {
      const campos: Record<string, unknown> = {};
      for (const [original, valor] of Object.entries(linha)) {
        const k = nomes[original] ?? original;
        if (!permitidos.has(k) || valor === null || valor === "") continue;
        if (monetarios[k]) {
          if (typeof valor !== "string")
            throw new Error(
              `${original}: valores em reais precisam ser texto no formato BRL.`,
            );
          const alvo = monetarios[k];
          if (campos[alvo] !== undefined || linha[alvo] !== undefined)
            throw new Error(`${original}: valor informado duas vezes.`);
          campos[alvo] = reaisEmCentavos(valor);
        } else if (inteiros.has(k)) {
          if (typeof valor === "string" && !/^-?\d+$/.test(valor.trim()))
            throw new Error(
              `${original}: esperado inteiro, sem casas decimais.`,
            );
          campos[k] = typeof valor === "string" ? Number(valor) : valor;
        } else campos[k] = typeof valor === "string" ? valor.trim() : valor;
      }
      campos.accountRef ??= config.contaRef;
      if (campos.accountRef !== config.contaRef)
        throw new Error(
          "A conta da linha difere da conta confirmada para este arquivo.",
        );
      for (const k of ["brand", "method", "status", "direction"])
        if (typeof campos[k] === "string") {
          const v = normalizarTexto(campos[k]);
          campos[k] = traduzir[v] ?? v;
        }
      for (const k of ["businessDay", "expectedSettlementDay"])
        if (typeof campos[k] === "string")
          campos[k] = dataDoCampo(campos[k], config);
      if (campos.occurredAt) {
        if (
          typeof campos.occurredAt !== "string" ||
          !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(campos.occurredAt) ||
          !Number.isFinite(Date.parse(campos.occurredAt))
        )
          throw new Error(
            "Data/hora precisa conter fuso explícito (Z ou -03:00).",
          );
        campos.businessDay ??= new Intl.DateTimeFormat("en-CA", {
          timeZone: fusoHorario,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date(campos.occurredAt));
      }
      campos.status ??=
        config.fonte === "VENDA"
          ? "COMPLETED"
          : config.fonte === "BANCO"
            ? "SETTLED"
            : "PENDING";
      const l = linhaSchema.parse(campos);
      if (
        !diaValido(l.businessDay) ||
        l.businessDay < config.de ||
        l.businessDay > config.ate
      )
        throw new Error("Dia fora da cobertura declarada do arquivo.");
      if (
        config.fonte === "VENDA" &&
        (l.grossCents === undefined ||
          !["COMPLETED", "CANCELLED"].includes(l.status))
      )
        throw new Error("Venda exige bruto e situação concluída/cancelada.");
      if (config.fonte === "ADQUIRENTE") {
        if (
          l.grossCents === undefined ||
          l.feeCents === undefined ||
          l.netCents === undefined ||
          !["PENDING", "SETTLED", "CHARGEBACK"].includes(l.status)
        )
          throw new Error(
            "Adquirente exige bruto, taxa, líquido e situação pendente/liquidado/chargeback.",
          );
        if (l.grossCents - l.feeCents + l.adjustmentCents !== l.netCents)
          throw new Error(
            "Bruto menos taxa mais ajustes não corresponde ao líquido.",
          );
        if (l.adjustmentCents && !l.adjustmentReason)
          throw new Error("Informe o motivo do ajuste.");
      }
      if (
        config.fonte === "BANCO" &&
        (l.amountCents === undefined || !l.direction)
      )
        throw new Error("Banco exige valor e direção CREDIT/DEBIT.");
      normalizado = l;
    } catch (e) {
      if (
        e &&
        typeof e === "object" &&
        "issues" in e &&
        Array.isArray(e.issues)
      )
        erros.push(
          ...e.issues.map(
            (i: { path: PropertyKey[]; message: string }) =>
              `${i.path.join(".")}: ${i.message}`,
          ),
        );
      else erros.push(e instanceof Error ? e.message : "Linha inválida.");
    }
    return {
      numero,
      bruto: linha,
      normalizado: erros.length ? null : normalizado,
      erros,
      hash: hash(canonico(linha)),
      identidade: normalizado?.externalId
        ? hash(
            canonico([
              config.fonte,
              normalizado.provider,
              normalizado.merchantRef,
              config.contaRef,
              normalizado.externalId,
            ]),
          )
        : null,
    };
  });
  return {
    colunas,
    avisos,
    linhas,
    lidas: brutas.length + ignoradas,
    aceitas: linhas.filter((l) => l.normalizado).length,
    rejeitadas: linhas.filter((l) => !l.normalizado).length,
    ignoradas,
  };
}
