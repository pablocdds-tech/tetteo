import { createHash } from "node:crypto";
import type { TransacaoBancaria } from "@/lib/extrato-bancario";

type Objeto = Record<string, unknown>;
function objeto(v: unknown): Objeto {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Objeto) : {};
}
function texto(v: unknown) {
  return typeof v === "string" ? v.trim() : "";
}
export function normalizarPem(v: string, tipo: "CERTIFICATE" | "PRIVATE KEY") {
  const pem = v
    .trim()
    .replace(/^(["'])([\s\S]*)\1$/, "$2")
    .replace(/\\n/g, "\n");
  const cabecalho =
    tipo === "CERTIFICATE" ? "CERTIFICATE" : "(?:RSA |EC )?PRIVATE KEY";
  if (
    !new RegExp(`^-----BEGIN ${cabecalho}-----\\r?\\n`).test(pem) ||
    !pem.includes("-----END ")
  )
    throw new Error(
      "Certificado ou chave PEM inválido. Confira as quebras de linha no host.",
    );
  return pem;
}

export function normalizarTransacao(
  bruto: unknown,
  namespace: string,
  cnpj: string,
): TransacaoBancaria {
  const t = objeto(bruto);
  if (t.tipoOperacao !== "C" && t.tipoOperacao !== "D")
    throw new Error("Direção de transação Inter desconhecida.");
  const direcao = t.tipoOperacao === "C" ? "RECEBER" : "PAGAR";
  const data = texto(t.dataTransacao || t.dataEntrada || t.dataMovimento).slice(
    0,
    10,
  );
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(data) ||
    new Date(data + "T00:00:00Z").toISOString().slice(0, 10) !== data
  )
    throw new Error("Data de transação Inter inválida.");
  const rawValor = String(t.valor ?? "").replace(",", ".");
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(rawValor) || Number(rawValor) <= 0)
    throw new Error("Valor de transação Inter inválido.");
  const [inteiro, decimal = ""] = rawValor.split(".");
  const valor = `${inteiro}.${decimal.padEnd(2, "0")}`;
  const detalhes = objeto(t.detalhes);
  const lados =
    direcao === "RECEBER"
      ? ["pagador", "remetente"]
      : ["recebedor", "beneficiario", "favorecido", "destinatario"];
  let nome = "",
    documento = "";
  for (const lado of lados) {
    const cap = lado[0].toUpperCase() + lado.slice(1);
    const pessoa = objeto(detalhes[lado]);
    nome ||=
      texto(detalhes[`nome${cap}`]) ||
      texto(pessoa.nome) ||
      texto(pessoa.razaoSocial);
    documento ||=
      texto(detalhes[`cpfCnpj${cap}`]) ||
      texto(detalhes[`documento${cap}`]) ||
      texto(pessoa.cpfCnpj) ||
      texto(pessoa.documento) ||
      texto(pessoa.cnpj) ||
      texto(pessoa.cpf);
  }
  // Fallback restrito ao lado correto; nunca percorre os dados da própria ponta.
  for (const [chave, valorCampo] of Object.entries(detalhes)) {
    const k = chave.toLowerCase();
    if (!lados.some((l) => k.includes(l))) continue;
    if (/nome|razao/.test(k)) nome ||= texto(valorCampo);
    if (/cpf|cnpj|documento/.test(k)) documento ||= texto(valorCampo);
  }
  // No contrato oficial, PAGAMENTO identifica o beneficiário por cpfCnpj.
  if (direcao === "PAGAR" && t.tipoTransacao === "PAGAMENTO") {
    documento ||= texto(detalhes.cpfCnpj);
    nome ||= texto(detalhes.nomeDestinatario);
  }
  const descricao = texto(t.descricao).slice(0, 2000);
  const padrao =
    direcao === "RECEBER"
      ? /^PIX RECEBIDO\s*-\s*(.*?)\s*-\s*([\d.\/-]+)$/i
      : /^PIX (?:ENVIADO|PAGO)\s*-\s*(.*?)\s*-\s*([\d.\/-]+)$/i;
  const m = descricao.match(padrao);
  nome ||= m?.[1] || "";
  documento ||= m?.[2] || "";
  documento = documento.replace(/\D/g, "");
  if (![11, 14].includes(documento.length)) documento = "";
  if (documento && documento === cnpj.replace(/\D/g, "")) {
    documento = "";
    nome = "";
  }
  const tipo = texto(t.tipoTransacao).slice(0, 80);
  const identificador = texto(t.idTransacao);
  const id = createHash("sha256")
    .update(
      JSON.stringify([
        namespace,
        identificador || [data, direcao, tipo, valor, descricao],
      ]),
    )
    .digest("hex");
  return {
    id,
    data,
    direcao,
    valor,
    tipo,
    descricao,
    titulo: texto(t.titulo).slice(0, 200),
    documento: documento || null,
    nome: nome.slice(0, 200) || null,
  };
}
