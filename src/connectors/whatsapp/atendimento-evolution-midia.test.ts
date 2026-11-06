import assert from "node:assert/strict";
import test from "node:test";
import type { LiveChannelConfig } from "@/server/atendimento-provedor";
import {
  ChannelMediaError,
  validateVirtualMedia,
  virtualMediaLimit,
} from "@/server/atendimento-midia";
import { readEvolutionMessageMedia } from "./atendimento-evolution-midia";

const config: Extract<LiveChannelConfig, { provider: "EVOLUTION" }> = {
  organizationId: "org-kairu",
  storeId: "store-kairu",
  accountId: "account-kairu",
  revision: 1,
  name: "Kairu fictício",
  active: false,
  provider: "EVOLUTION",
  settings: { url: "https://provider.invalid", instance: "sv-kairu" },
  secrets: { apiKey: "chave-ficticia-privada" },
};
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ogg = Buffer.concat([
  Buffer.from("OggS"),
  Buffer.alloc(24),
  Buffer.from("OpusHead"),
  Buffer.alloc(8),
]);
const query = {
  providerMessageId: "fake_message_kairu",
  kind: "IMAGE" as const,
};
const rejectCode = (code: string) => (error: unknown) =>
  error instanceof ChannelMediaError && error.code === code;

test("mídia usa só ID guardado e instância configurada, sem URL de cliente nem envio", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async (url, init) => {
      calls++;
      assert.equal(
        String(url),
        "https://provider.invalid/chat/getBase64FromMediaMessage/sv-kairu",
      );
      assert.equal(init?.method, "POST");
      assert.equal(init?.redirect, "error");
      assert.equal(init?.cache, "no-store");
      assert.ok(init?.signal);
      assert.deepEqual(JSON.parse(String(init?.body)), {
        message: { key: { id: query.providerMessageId } },
        convertToMp4: false,
      });
      return Response.json({
        base64: png.toString("base64"),
        mimetype: "image/png",
        fileName: "../../segredo.html",
      });
    };
    const result = await readEvolutionMessageMedia(config, query);
    assert.deepEqual(result.bytes, png);
    assert.equal(result.contentType, "image/png");
    assert.equal(result.extension, "png");
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test("assinatura distingue imagem, áudio Opus e MIME falso; SVG e vídeo são recusados", () => {
  assert.equal(
    validateVirtualMedia(ogg, "AUDIO", "audio/ogg; codecs=opus").contentType,
    "audio/ogg",
  );
  assert.throws(
    () => validateVirtualMedia(png, "AUDIO", "audio/ogg"),
    rejectCode("MEDIA_TYPE"),
  );
  assert.throws(
    () => validateVirtualMedia(png, "IMAGE", "image/jpeg"),
    rejectCode("MEDIA_TYPE"),
  );
  assert.throws(
    () =>
      validateVirtualMedia(
        Buffer.from("<svg onload='alert(1)'/>"),
        "IMAGE",
        "image/svg+xml",
      ),
    rejectCode("MEDIA_TYPE"),
  );
  const box = (type: string, content: Buffer) => {
    const header = Buffer.alloc(8);
    header.writeUInt32BE(8 + content.length);
    header.write(type, 4);
    return Buffer.concat([header, content]);
  };
  const handler = (kind: string) =>
    box(
      "trak",
      box(
        "mdia",
        box("hdlr", Buffer.concat([Buffer.alloc(8), Buffer.from(kind)])),
      ),
    );
  const ftyp = box("ftyp", Buffer.from("M4A \0\0\0\0M4A "));
  const m4a = Buffer.concat([ftyp, box("moov", handler("soun"))]);
  assert.equal(
    validateVirtualMedia(m4a, "AUDIO", "audio/mp4").extension,
    "m4a",
  );
  const video = Buffer.concat([
    ftyp,
    box("moov", Buffer.concat([handler("soun"), handler("vide")])),
  ]);
  assert.throws(
    () => validateVirtualMedia(video, "AUDIO", "audio/mp4"),
    rejectCode("MEDIA_TYPE"),
  );
  assert.throws(
    () =>
      validateVirtualMedia(
        Buffer.alloc(virtualMediaLimit("IMAGE") + 1),
        "IMAGE",
        "image/png",
      ),
    rejectCode("MEDIA_LIMIT"),
  );
});

test("arquivo expirado, erro e timeout não vazam resposta privada nem fazem retry", async () => {
  const original = globalThis.fetch;
  try {
    for (const failure of [
      () =>
        Promise.resolve(
          new Response("private token and signed URL", { status: 400 }),
        ),
      () =>
        Promise.reject(
          new Error("private-token https://private.invalid/secret"),
        ),
      () => Promise.reject(new DOMException("private-timeout", "TimeoutError")),
    ]) {
      let calls = 0;
      globalThis.fetch = async () => {
        calls++;
        return failure();
      };
      await assert.rejects(
        readEvolutionMessageMedia(config, query),
        (error: unknown) => {
          assert.equal(String(error), "Error: MEDIA_UNAVAILABLE");
          return true;
        },
      );
      assert.equal(calls, 1);
    }
  } finally {
    globalThis.fetch = original;
  }
});

test("limite corta stream antes do JSON e base64 inválido não é aceito", async () => {
  const original = globalThis.fetch;
  try {
    let cancelled = false;
    globalThis.fetch = async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new Uint8Array(
                Math.ceil(virtualMediaLimit("IMAGE") / 3) * 4 + 65537,
              ),
            );
          },
          cancel() {
            cancelled = true;
          },
        }),
      );
    await assert.rejects(
      readEvolutionMessageMedia(config, query),
      rejectCode("MEDIA_LIMIT"),
    );
    assert.equal(cancelled, true);
    globalThis.fetch = async () =>
      Response.json({
        base64: "data:image/png;base64,aGVsbG8=",
        mimetype: "image/png",
      });
    await assert.rejects(
      readEvolutionMessageMedia(config, query),
      rejectCode("MEDIA_UNAVAILABLE"),
    );
    let called = false;
    globalThis.fetch = async () => {
      called = true;
      throw new Error("unexpected");
    };
    await assert.rejects(
      readEvolutionMessageMedia(config, {
        ...query,
        providerMessageId: "https://private.invalid",
      }),
      rejectCode("MEDIA_UNAVAILABLE"),
    );
    assert.equal(called, false);
  } finally {
    globalThis.fetch = original;
  }
});
