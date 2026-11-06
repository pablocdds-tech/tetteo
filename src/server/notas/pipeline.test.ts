import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { lerDocumentoFiscal } from "./pipeline";
import { lerQrFiscal, chaveDoQr } from "./qr";
import { prepararImagemNota, recortesDaNota } from "./imagem";
import { LeituraNotaRecusada } from "./documento";
const fixture = (nome: string) =>
  readFile(path.join(process.cwd(), "tests/fixtures/notas", nome));
const scope = {
  organizacaoId: "organizacao-ficticia",
  unidadeId: "unidade-ficticia",
};
test("XML e PDF textual nunca chamam Gemini nem consulta de rede", async (t) => {
  const rede = t.mock.method(globalThis, "fetch", async () => {
    throw Error("Não deve chamar rede");
  });
  let ia = 0;
  for (const arquivo of ["nfe-sintetica.xml", "nfe-texto-sintetica.pdf"]) {
    const r = await lerDocumentoFiscal(await fixture(arquivo), {
      ...scope,
      gemini: async () => {
        ia++;
        throw Error();
      },
    });
    assert.equal(r.dados.itens.length, 2);
  }
  assert.equal(ia, 0);
  assert.equal(rede.mock.callCount(), 0);
});
test("QR é decodificado e consulta desativada pede XML sem chamada a terceiros", async (t) => {
  const rede = t.mock.method(globalThis, "fetch", async () => {
    throw Error("URL do QR não pode ser consultada");
  });
  const bytes = await fixture("cupom-qr.png");
  let ia = 0;
  const q = await lerQrFiscal(bytes);
  assert.ok(q?.valida);
  const r = await lerDocumentoFiscal(bytes, {
    ...scope,
    gemini: async () => {
      ia++;
      throw Error();
    },
  });
  assert.equal(r.metodo, "QR");
  assert.ok(r.pendencias.some((p) => p.codigo === "DESATIVADA"));
  assert.equal(ia, 0);
  assert.equal(rede.mock.callCount(), 0);
  const cinza = await sharp(bytes).greyscale().png().toBuffer();
  assert.equal((await lerQrFiscal(cinza))?.chave, q.chave);
  assert.equal(chaveDoQr(`http://127.0.0.1/segredo?p=${q.chave}`), q.chave); // somente extração; nenhum fetch.
});
test("original permanece intacto e derivados e recortes conservam escala dos pixels", async () => {
  const original = await fixture("cupom-torto-simulado.png"),
    hash = createHash("sha256").update(original).digest("hex");
  const a = await prepararImagemNota(original);
  assert.equal(createHash("sha256").update(original).digest("hex"), hash);
  assert.equal(a.ruim, false);
  assert.ok(a.processada.bytes.length);
  assert.ok(Math.abs(a.angulo) <= 7);
  const cortes = await recortesDaNota([a.processada]),
    m = await sharp(a.processada.bytes).metadata();
  assert.equal(cortes.length, 3);
  for (const i of cortes)
    assert.equal((await sharp(i.bytes).metadata()).width, m.width);
});
test("foto sem detalhes recebe orientação antes de qualquer geração", async () => {
  let ia = 0;
  await assert.rejects(
    lerDocumentoFiscal(await fixture("imagem-sem-detalhes.png"), {
      ...scope,
      gemini: async () => {
        ia++;
        throw Error();
      },
    }),
    (e) => e instanceof LeituraNotaRecusada && e.codigo === "IMAGEM_RUIM",
  );
  assert.equal(ia, 0);
});
