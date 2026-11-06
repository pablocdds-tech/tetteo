import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import QRCode from "qrcode";
import { digitoChaveFiscal } from "../src/lib/documento-fiscal.ts";

// Corpus inteiramente sintético. Não usa fotos, chaves ou XML de clientes.
const pasta = path.resolve("tests/fixtures/notas");
await mkdir(pasta, { recursive: true });
const base = "3526111122233300018155001000000123112345678",
  chave = base + digitoChaveFiscal(base);
const linhas = [
  "DANFE NFC-e - TESTE SINTETICO SEM VALOR FISCAL",
  "RAZAO SOCIAL: FORNECEDOR FICTICIO",
  "CNPJ: 11.222.333/0001-81",
  "EMISSAO: 04/11/2026",
  "NUMERO: 123",
  "SERIE: 1",
  chave,
  "CODIGO DESCRICAO QTD UN V.UNIT V.TOTAL",
  "001 ARROZ TIPO 1 2,000 PCT 5,00 10,00",
  "002 FEIJAO PRETO 1,000 PCT 5,00 5,00",
  "DESCONTOS: 1,00",
  "ACRESCIMOS: 0,00",
  "TOTAL DA NOTA: 14,00",
  "FORMA DE PAGAMENTO: BOLETO",
];
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600"><rect width="1200" height="1600" fill="white"/>${linhas.map((t, i) => `<text x="45" y="${80 + i * 65}" font-family="monospace" font-size="27" fill="black">${t}</text>`).join("")}</svg>`;
const nitido = await sharp(Buffer.from(svg)).png().toBuffer();
await writeFile(path.join(pasta, "cupom-nitido.png"), nitido);
await writeFile(
  path.join(pasta, "cupom-escuro-simulado.png"),
  await sharp(nitido).linear(0.18, 0).png().toBuffer(),
);
await writeFile(
  path.join(pasta, "cupom-torto-simulado.png"),
  await sharp(nitido).rotate(6, { background: "white" }).png().toBuffer(),
);
const dobra = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600"><path d="M0 550 L1200 650 L1200 690 L0 590Z" fill="black" opacity="0.12"/><path d="M350 0 L450 1600 L475 1600 L375 0Z" fill="black" opacity="0.10"/></svg>',
);
await writeFile(
  path.join(pasta, "cupom-dobrado-simulado.png"),
  await sharp(nitido)
    .composite([{ input: dobra }])
    .png()
    .toBuffer(),
);
const qr = await QRCode.toBuffer(
  `https://nfce.example.invalid/consulta?p=${chave}|2|2|SINTETICO`,
  { width: 420, margin: 4 },
);
await writeFile(
  path.join(pasta, "cupom-qr.png"),
  await sharp(nitido)
    .composite([{ input: qr, left: 380, top: 1120 }])
    .png()
    .toBuffer(),
);
await writeFile(
  path.join(pasta, "imagem-sem-detalhes.png"),
  await sharp({
    create: { width: 600, height: 900, channels: 3, background: "#222222" },
  })
    .png()
    .toBuffer(),
);
const xml = `<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe${chave}" versao="4.00"><ide><mod>55</mod><serie>1</serie><nNF>123</nNF><dhEmi>2026-11-04T10:00:00-03:00</dhEmi><finNFe>1</finNFe><tpAmb>2</tpAmb></ide><emit><CNPJ>11222333000181</CNPJ><xNome>FORNECEDOR FICTICIO</xNome></emit><det nItem="1"><prod><cProd>001</cProd><cEAN>SEM GTIN</cEAN><xProd>ARROZ TIPO 1</xProd><uCom>PCT</uCom><qCom>2.0000</qCom><vUnCom>5.0000</vUnCom><vProd>10.00</vProd></prod></det><det nItem="2"><prod><cProd>002</cProd><cEAN>SEM GTIN</cEAN><xProd>FEIJAO PRETO</xProd><uCom>PCT</uCom><qCom>1.0000</qCom><vUnCom>5.0000</vUnCom><vProd>5.00</vProd></prod></det><total><ICMSTot><vProd>15.00</vProd><vDesc>1.00</vDesc><vFrete>0.00</vFrete><vSeg>0.00</vSeg><vOutro>0.00</vOutro><vNF>14.00</vNF></ICMSTot></total><pag><detPag><tPag>15</tPag><vPag>14.00</vPag></detPag></pag><cobr><dup><dVenc>2026-11-10</dVenc><vDup>14.00</vDup></dup></cobr></infNFe></NFe><protNFe><infProt><cStat>100</cStat></infProt></protNFe></nfeProc>`;
await writeFile(path.join(pasta, "nfe-sintetica.xml"), xml);
function pdf(objetos) {
  const partes = [Buffer.from("%PDF-1.4\n")],
    offsets = [0];
  let tamanho = partes[0].length;
  for (const [i, o] of objetos.entries()) {
    offsets.push(tamanho);
    const b = Buffer.concat([
      Buffer.from(`${i + 1} 0 obj\n`),
      Buffer.isBuffer(o) ? o : Buffer.from(o),
      Buffer.from("\nendobj\n"),
    ]);
    partes.push(b);
    tamanho += b.length;
  }
  const xref = tamanho;
  partes.push(
    Buffer.from(
      `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n${offsets
        .slice(1)
        .map((n) => `${String(n).padStart(10, "0")} 00000 n \n`)
        .join(
          "",
        )}trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
    ),
  );
  return Buffer.concat(partes);
}
const conteudo = `BT /F1 10 Tf 30 800 Td ${linhas.map((l, i) => `${i ? "0 -25 Td " : ""}(${l.replace(/[\\()]/g, "\\$&")}) Tj`).join("\n")} ET`;
await writeFile(
  path.join(pasta, "nfe-texto-sintetica.pdf"),
  pdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 850] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(conteudo)} >>\nstream\n${conteudo}\nendstream`,
  ]),
);
const jpeg = await sharp(nitido).jpeg({ quality: 95 }).toBuffer(),
  desenho = "q 600 0 0 800 0 0 cm /Im0 Do Q";
await writeFile(
  path.join(pasta, "nfe-digitalizada-sintetica.pdf"),
  pdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>",
    Buffer.concat([
      Buffer.from(
        `<< /Type /XObject /Subtype /Image /Width 1200 /Height 1600 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
      ),
      jpeg,
      Buffer.from("\nendstream"),
    ]),
    `<< /Length ${desenho.length} >>\nstream\n${desenho}\nendstream`,
  ]),
);
const esperado = {
  cnpj_emitente: "11222333000181",
  cpf_emitente: null,
  razao_social: "FORNECEDOR FICTICIO",
  data_emissao: "2026-11-04",
  numero: "123",
  serie: "1",
  chave_acesso: chave,
  descontos: 1,
  acrescimos: 0,
  total_nota: 14,
  forma_pagamento: "BOLETO",
  parcelas: null,
  itens: [
    {
      descricao: "ARROZ TIPO 1",
      quantidade: 2,
      unidade: "PCT",
      valor_unitario: 5,
      valor_total: 10,
      codigo_fornecedor: "001",
      codigo_ean: null,
    },
    {
      descricao: "FEIJAO PRETO",
      quantidade: 1,
      unidade: "PCT",
      valor_unitario: 5,
      valor_total: 5,
      codigo_fornecedor: "002",
      codigo_ean: null,
    },
  ],
};
const casos = [
  { arquivo: "nfe-sintetica.xml", metodo: "XML" },
  { arquivo: "nfe-texto-sintetica.pdf", metodo: "PDF_TEXTO" },
  ...[
    "cupom-nitido.png",
    "cupom-escuro-simulado.png",
    "cupom-torto-simulado.png",
    "cupom-dobrado-simulado.png",
    "nfe-digitalizada-sintetica.pdf",
  ].map((arquivo) => ({ arquivo, metodo: "GEMINI" })),
  { arquivo: "cupom-qr.png", metodo: "QR", pendencia: "DESATIVADA" },
  { arquivo: "imagem-sem-detalhes.png", erro: "IMAGEM_RUIM" },
].map((c) => ({
  ...c,
  proveniencia: "sintetica",
  esperado: c.erro
    ? Object.fromEntries(
        Object.keys(esperado).map((k) => [k, k === "itens" ? [] : null]),
      )
    : {
        ...esperado,
        ...(c.metodo === "XML"
          ? { parcelas: [{ vencimento: "2026-11-10", valor: 14 }] }
          : {}),
      },
}));
await writeFile(
  path.join(pasta, "manifest.json"),
  JSON.stringify({ versao: 1, casos }, null, 2) + "\n",
);
console.log(
  `Geradas ${casos.length} fixtures sintéticas em ${pasta}. Nenhum documento real foi utilizado.`,
);
