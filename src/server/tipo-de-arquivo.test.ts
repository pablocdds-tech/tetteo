import assert from "node:assert/strict";
import { test } from "node:test";

import { tipoPelaAssinatura } from "./tipo-de-arquivo";

const bytes = (...v: number[]) => new Uint8Array(v);
const texto = (s: string) => new TextEncoder().encode(s);

test("reconhece JPEG, PNG e WebP pela assinatura", () => {
  assert.equal(tipoPelaAssinatura(bytes(0xff, 0xd8, 0xff, 0xe0, 0x00)), "image/jpeg");
  assert.equal(
    tipoPelaAssinatura(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00)),
    "image/png",
  );
  const webp = new Uint8Array([...texto("RIFF"), 0, 0, 0, 0, ...texto("WEBP"), 0]);
  assert.equal(tipoPelaAssinatura(webp), "image/webp");
});

test("PDF, texto e executável renomeado não passam", () => {
  assert.equal(tipoPelaAssinatura(texto("%PDF-1.7")), null);
  assert.equal(tipoPelaAssinatura(texto("olá, sou uma foto")), null);
  assert.equal(tipoPelaAssinatura(bytes(0x4d, 0x5a, 0x90, 0x00)), null); // "MZ"
  assert.equal(tipoPelaAssinatura(new Uint8Array()), null);
});
