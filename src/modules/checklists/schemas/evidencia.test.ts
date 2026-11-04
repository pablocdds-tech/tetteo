import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ErroEvidencia,
  esquemaEnvioEvidencia,
  faixaDaEvidencia,
  LIMITE_FOTO_CHECKLIST,
  LIMITE_VIDEO_CHECKLIST,
  lerCorpoLimitado,
  lerFormularioEvidencia,
  tipoDaEvidencia,
  validarEvidencia,
} from "./evidencia";

test("leitura parcial de vídeo limita faixa e recusa intervalos inválidos", () => {
  assert.deepEqual(faixaDaEvidencia("bytes=0-3", 10), { inicio: 0, fim: 3 });
  assert.deepEqual(faixaDaEvidencia("bytes=4-", 10), { inicio: 4, fim: 9 });
  assert.deepEqual(faixaDaEvidencia("bytes=-3", 10), { inicio: 7, fim: 9 });
  assert.deepEqual(faixaDaEvidencia("bytes=3-100", 10), { inicio: 3, fim: 9 });
  for (const invalida of [
    "bytes=10-",
    "bytes=8-2",
    "bytes=-0",
    "bytes=",
    "bytes=0-1,3-4",
    "bytes=Infinity-",
    "outro=0-1",
  ]) {
    assert.equal(faixaDaEvidencia(invalida, 10), null);
  }
});

test("a versão é obrigatória e não aceita vazio ou coerção de booleano", () => {
  for (const versaoEsperada of [
    null,
    undefined,
    "",
    " ",
    true,
    false,
    -1,
    1.5,
  ]) {
    assert.equal(
      esquemaEnvioEvidencia.safeParse({ itemId: "item", versaoEsperada })
        .success,
      false,
    );
  }
  assert.equal(
    esquemaEnvioEvidencia.parse({ itemId: "item", versaoEsperada: "0" })
      .versaoEsperada,
    0,
  );
});

test("a assinatura decide o tipo: rejeita HTML renomeado e aceita fotos e vídeos permitidos", () => {
  assert.equal(
    tipoDaEvidencia(new TextEncoder().encode("<html>foto.jpg</html>")),
    null,
  );
  assert.equal(
    tipoDaEvidencia(new Uint8Array([255, 216, 255, 1])),
    "image/jpeg",
  );
  const mp4 = new Uint8Array(24);
  new DataView(mp4.buffer).setUint32(0, 24);
  mp4.set(new TextEncoder().encode("ftypisom"), 4);
  assert.equal(tipoDaEvidencia(mp4), "video/mp4");
  mp4.set(new TextEncoder().encode("qt  "), 8);
  assert.equal(tipoDaEvidencia(mp4), null);
  const webm = new Uint8Array(20);
  webm.set([0x1a, 0x45, 0xdf, 0xa3]);
  webm.set(new TextEncoder().encode("webm"), 10);
  assert.equal(tipoDaEvidencia(webm), "video/webm");
});

test("fotos não herdam o limite maior de vídeos e arquivos vazios falham", () => {
  const foto = new Uint8Array(LIMITE_FOTO_CHECKLIST + 1);
  foto.set([255, 216, 255]);
  assert.throws(
    () => validarEvidencia(foto),
    (e) => e instanceof ErroEvidencia && e.status === 413,
  );
  assert.throws(
    () => validarEvidencia(new Uint8Array(LIMITE_VIDEO_CHECKLIST + 1)),
    (e) => e instanceof ErroEvidencia && e.status === 413,
  );
  assert.throws(() => validarEvidencia(new Uint8Array()));
});

test("Content-Length excessivo é recusado antes de ler o fluxo", async () => {
  await assert.rejects(
    lerCorpoLimitado(
      new Request("https://example.test", {
        method: "POST",
        headers: { "content-length": "1000000" },
        body: "a",
      }),
      10,
    ),
    (e) => e instanceof ErroEvidencia && e.status === 413,
  );
});

test("fluxo sem Content-Length também é limitado e cancelado antes do parser", async () => {
  let cancelado = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(8));
    },
    cancel() {
      cancelado = true;
    },
  });
  const request = new Request("https://example.test", {
    method: "POST",
    body,
    duplex: "half",
  } as RequestInit & { duplex: string });
  await assert.rejects(
    lerCorpoLimitado(request, 10),
    (e) => e instanceof ErroEvidencia && e.status === 413,
  );
  assert.equal(cancelado, true);
});

test("multipart válido preserva arquivo e campos após leitura limitada", async () => {
  const dados = new FormData();
  dados.set("itemId", "item-sintetico");
  dados.set(
    "arquivo",
    new File([new Uint8Array([255, 216, 255])], "foto.jpg", {
      type: "image/jpeg",
    }),
  );
  const lido = await lerFormularioEvidencia(
    new Request("https://example.test", { method: "POST", body: dados }),
  );
  assert.equal(lido.get("itemId"), "item-sintetico");
  assert.equal((lido.get("arquivo") as File).size, 3);
});
