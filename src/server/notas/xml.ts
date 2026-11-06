import { XMLParser, XMLValidator } from "fast-xml-parser";
import {
  confiancas,
  confiancasDoItem,
  extracaoFiscalSchema,
  extracaoVazia,
  type ExtracaoFiscal,
} from "./extracao";
import {
  LIMITE_DOCUMENTO_NOTA,
  LeituraNotaRecusada,
  textoXml,
} from "./documento";

type Objeto = Record<string, unknown>;
const obj = (v: unknown): Objeto =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Objeto) : {};
const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;
const valor = (v: unknown): number | null =>
  typeof v === "string" &&
  /^\d+(?:\.\d{1,10})?$/.test(v) &&
  Number.isFinite(Number(v))
    ? Number(v)
    : null;
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : v ? [v] : []);
const formas: Record<string, string> = {
  "01": "DINHEIRO",
  "02": "CHEQUE",
  "03": "CREDITO",
  "04": "DEBITO",
  "05": "CREDITO_LOJA",
  "10": "VA",
  "11": "VR",
  "12": "VALE_PRESENTE",
  "13": "VALE_COMBUSTIVEL",
  "14": "DUPLICATA",
  "15": "BOLETO",
  "16": "DEPOSITO",
  "17": "PIX",
  "18": "TRANSFERENCIA",
  "19": "CASHBACK",
  "20": "PIX",
  "90": "SEM_PAGAMENTO",
  "99": "OUTRO",
};
export function lerXmlFiscal(bytes: Uint8Array): ExtracaoFiscal {
  const falha = () =>
    new LeituraNotaRecusada(
      "XML_INVALIDO",
      "Não consegui validar este XML de NF-e/NFC-e. Envie o XML original completo do fornecedor.",
    );
  if (!bytes.length || bytes.length > LIMITE_DOCUMENTO_NOTA) throw falha();
  let xml: string;
  try {
    xml = textoXml(bytes);
  } catch {
    throw falha();
  }
  if (
    /<!DOCTYPE|<!ENTITY|<\?xml-stylesheet|<(?:[\w-]+:)?(?:__proto__|constructor|prototype)\b/i.test(
      xml,
    )
  )
    throw falha();
  let profundidade = 0,
    nos = 0;
  for (const tag of xml.matchAll(/<\/?[\w:-]+\b[^>]*>/g)) {
    if (++nos > 60_000) throw falha();
    if (tag[0].startsWith("</")) profundidade--;
    else if (!tag[0].endsWith("/>")) profundidade++;
    if (profundidade > 48) throw falha();
  }
  if (XMLValidator.validate(xml) !== true) throw falha();
  let raiz: Objeto;
  try {
    raiz = obj(
      new XMLParser({
        ignoreAttributes: false,
        removeNSPrefix: true,
        parseTagValue: false,
        parseAttributeValue: false,
        processEntities: false,
        trimValues: true,
      }).parse(xml),
    );
  } catch {
    throw falha();
  }
  const proc = obj(raiz.nfeProc),
    nfe = obj(proc.NFe ?? raiz.NFe),
    inf = obj(nfe.infNFe),
    ide = obj(inf.ide),
    emit = obj(inf.emit),
    total = obj(obj(inf.total).ICMSTot);
  if (!["55", "65"].includes(String(ide.mod)) || !Object.keys(inf).length)
    throw falha();
  const status = str(obj(obj(proc.protNFe).infProt).cStat);
  if (status && !["100", "150"].includes(status))
    throw new LeituraNotaRecusada(
      "XML_SEM_AUTORIZACAO",
      "O protocolo deste XML não informa autorização de uso. Confira o documento com o fornecedor.",
    );
  if (str(ide.finNFe) && str(ide.finNFe) !== "1")
    throw new LeituraNotaRecusada(
      "XML_FINALIDADE",
      "Este XML não é uma NF-e normal de compra. Confira a finalidade no sistema.",
    );
  const d = extracaoVazia();
  const decode = (s: string | null) =>
    s?.replace(
      /&(?:amp|lt|gt|quot|apos);/g,
      (e) =>
        ({
          "&amp;": "&",
          "&lt;": "<",
          "&gt;": ">",
          "&quot;": '"',
          "&apos;": "'",
        })[e]!,
    ) ?? null;
  d.cnpj_emitente = str(emit.CNPJ);
  d.cpf_emitente = str(emit.CPF);
  d.razao_social = decode(str(emit.xNome));
  d.data_emissao = (str(ide.dhEmi) ?? str(ide.dEmi))?.slice(0, 10) ?? null;
  d.numero = str(ide.nNF);
  d.serie = str(ide.serie);
  d.chave_acesso = str(inf["@_Id"])?.replace(/^NFe/, "") ?? null;
  d.itens = lista(inf.det).map((v) => {
    const p = obj(obj(v).prod);
    const ean = str(p.cEAN);
    return {
      descricao: decode(str(p.xProd)),
      quantidade: valor(p.qCom),
      unidade: str(p.uCom),
      valor_unitario: valor(p.vUnCom),
      valor_total: valor(p.vProd),
      codigo_ean: ean && /^\d+$/.test(ean) ? ean : null,
      codigo_fornecedor: str(p.cProd),
      confianca: confiancasDoItem(1),
    };
  });
  // Tags opcionais ausentes representam zero no leiaute XML; não são estimativas visuais.
  d.descontos = total.vDesc === undefined ? 0 : valor(total.vDesc);
  const adicionais = [
    "vFrete",
    "vSeg",
    "vOutro",
    "vIPI",
    "vST",
    "vFCPST",
    "vII",
    "vIPIDevol",
  ];
  const ajustes = adicionais.map((k) =>
    total[k] === undefined ? 0 : valor(total[k]),
  );
  d.acrescimos = ajustes.some((v) => v === null)
    ? null
    : ajustes.reduce<number>((s, v) => s + v!, 0);
  d.total_nota = valor(total.vNF);
  const pagamentos = lista(obj(inf.pag).detPag).map(
    (v) => formas[String(obj(v).tPag)] ?? "OUTRO",
  );
  d.forma_pagamento =
    new Set(pagamentos).size === 1
      ? (pagamentos[0] ?? null)
      : pagamentos.length
        ? "MULTIPLO"
        : null;
  const duplicatas = lista(obj(inf.cobr).dup);
  d.parcelas = duplicatas.length
    ? duplicatas.map((v) => ({
        vencimento: str(obj(v).dVenc),
        valor: valor(obj(v).vDup),
      }))
    : null;
  d.confianca = confiancas(1);
  d.alertas.push(
    "Dados extraídos do XML. Assinatura digital e situação atual na SEFAZ não foram consultadas; confira a origem do arquivo.",
  );
  if ((valor(total.vICMSDeson) ?? 0) > 0)
    d.alertas.push(
      "Há desoneração no XML. Confira a composição dos totais antes de lançar.",
    );
  return extracaoFiscalSchema.parse(d);
}
