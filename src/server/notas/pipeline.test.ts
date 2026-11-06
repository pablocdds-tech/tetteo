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
import { lerXmlFiscal } from "./xml";
import { extracaoVazia } from "./extracao";
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
test("foto inteira válida passa pelo Gemini sem tentar QR ou consulta", async () => {
  const bytes = await fixture("cupom-qr.png");
  const dados = lerXmlFiscal(await fixture("nfe-sintetica.xml"));
  dados.alertas = [];
  const etapas: string[] = [];
  let ia = 0;
  const r = await lerDocumentoFiscal(bytes, {
    ...scope,
    registrar: async (e) => {
      etapas.push(e.etapa);
    },
    consulta: {
      consultar: async () => {
        throw Error("Consulta não deve preceder nem substituir leitura válida");
      },
    },
    gemini: async (imagens) => {
      ia++;
      assert.deepEqual(imagens[0].bytes, bytes);
      assert.equal(imagens[0].variante, "original");
      return { dados, extras: [] };
    },
  });
  assert.equal(ia, 1);
  assert.equal(r.metodo, "GEMINI");
  assert.deepEqual(r.pendencias, []);
  assert.ok(!etapas.some((e) => e.startsWith("QR_")));
});

test("QR é o último recurso após falha visual, sem abrir a URL impressa", async (t) => {
  const rede = t.mock.method(globalThis, "fetch", async () => {
    throw Error("URL do QR não pode ser consultada");
  });
  const bytes = await fixture("cupom-qr.png");
  let ia = 0;
  const etapas: string[] = [];
  const q = await lerQrFiscal(bytes);
  assert.ok(q?.valida);
  const r = await lerDocumentoFiscal(bytes, {
    ...scope,
    registrar: async (e) => {
      etapas.push(e.etapa);
    },
    gemini: async () => {
      ia++;
      throw new LeituraNotaRecusada("IA_CONTRATO", "Leitura inconclusiva.");
    },
  });
  assert.equal(r.metodo, "QR");
  assert.ok(r.pendencias.some((p) => p.codigo === "DESATIVADA"));
  assert.equal(ia, 1);
  assert.ok(
    etapas.indexOf("GEMINI_IMAGEM_INTEIRA") <
      etapas.indexOf("QR_ULTIMO_RECURSO"),
  );
  assert.equal(rede.mock.callCount(), 0);
  const cinza = await sharp(bytes).greyscale().png().toBuffer();
  assert.equal((await lerQrFiscal(cinza))?.chave, q.chave);
  assert.equal(chaveDoQr(`http://127.0.0.1/segredo?p=${q.chave}`), q.chave); // somente extração; nenhum fetch.
});

test("QR com consulta desligada conserva a leitura visual incompleta para conferência", async () => {
  const dados = lerXmlFiscal(await fixture("nfe-sintetica.xml"));
  dados.itens[0].quantidade = null;
  dados.itens[0].confianca.quantidade = 0;
  const r = await lerDocumentoFiscal(await fixture("cupom-qr.png"), {
    ...scope,
    gemini: async () => ({ dados, extras: [] }),
  });
  assert.equal(r.metodo, "GEMINI");
  assert.deepEqual(r.dados, dados);
  assert.equal(r.dados.itens[0].quantidade, null);
  assert.ok(r.pendencias.length > 0);
  assert.ok(!r.pendencias.some((p) => p.codigo === "DESATIVADA"));
});

test("consulta configurada só vem após a leitura visual e valida a chave retornada", async () => {
  let lida = false;
  const r = await lerDocumentoFiscal(await fixture("cupom-qr.png"), {
    ...scope,
    gemini: async () => {
      lida = true;
      return { dados: extracaoVazia(), extras: [] };
    },
    consulta: {
      consultar: async () => {
        assert.equal(lida, true);
        return {
          estado: "DISPONIVEL",
          xml: await fixture("nfe-sintetica.xml"),
        };
      },
    },
  });
  assert.equal(r.metodo, "QR");
  assert.equal(r.dados.itens.length, 2);
});

test("QR divergente mantém a transcrição e exige conferência mesmo sem consulta externa", async () => {
  const dados = extracaoVazia();
  dados.numero = "999";
  const r = await lerDocumentoFiscal(await fixture("cupom-qr.png"), {
    ...scope,
    gemini: async () => ({ dados, extras: [] }),
  });
  assert.equal(r.dados.numero, "999");
  assert.ok(
    r.pendencias.some(
      (p) => p.campo === "numero" && p.codigo === "QR_DIVERGENTE",
    ),
  );
});

test("consulta não esconde divergência com o total lido na foto", async () => {
  const dados = extracaoVazia();
  dados.total_nota = 99;
  const r = await lerDocumentoFiscal(await fixture("cupom-qr.png"), {
    ...scope,
    gemini: async () => ({ dados, extras: [] }),
    consulta: {
      consultar: async () => ({
        estado: "DISPONIVEL",
        xml: await fixture("nfe-sintetica.xml"),
      }),
    },
  });
  assert.ok(
    r.pendencias.some(
      (p) => p.codigo === "FONTES_DIVERGENTES" && p.campo === "total_nota",
    ),
  );
});

test("sem QR, falha de cota mantém o motivo e não repete a IA", async () => {
  let ia = 0;
  await assert.rejects(
    lerDocumentoFiscal(await fixture("cupom-torto-simulado.png"), {
      ...scope,
      gemini: async () => {
        ia++;
        throw new LeituraNotaRecusada("IA_COTA", "Cota indisponível.");
      },
    }),
    (e) => e instanceof LeituraNotaRecusada && e.codigo === "IA_COTA",
  );
  assert.equal(ia, 1);
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
