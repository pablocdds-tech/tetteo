import assert from "node:assert/strict";
import { test } from "node:test";

import { baixarFotoNota } from "./nota-midia";

const ambiente = {
  EVOLUTION_URL: "http://evolution.internal:8080",
  EVOLUTION_INSTANCIA: "equipe ficticia",
  EVOLUTION_API_KEY: "credencial-ficticia",
};
const foto = Buffer.from([0xff, 0xd8, 0xff, 0, 1]);

test("baixa foto só pelo id, usando instância configurada, sem redirecionar", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async (url: string, options: RequestInit) => {
      assert.equal(
        url,
        "http://evolution.internal:8080/chat/getBase64FromMediaMessage/equipe%20ficticia",
      );
      assert.equal(options.redirect, "error");
      assert.deepEqual(JSON.parse(String(options.body)), {
        message: { key: { id: "FOTO-1" } },
        convertToMp4: false,
      });
      assert.equal(
        (options.headers as Record<string, string>).apikey,
        ambiente.EVOLUTION_API_KEY,
      );
      return Response.json({
        mimetype: "image/jpeg",
        base64: foto.toString("base64"),
      });
    },
  );
  const lida = await baixarFotoNota("FOTO-1", ambiente);
  assert.deepEqual(lida.bytes, foto);
  assert.equal(lida.tipo, "image/jpeg");
});

test("arquivo disfarçado, base64 inválido e mime divergente são recusados sem ecoar o provedor", async (t) => {
  for (const resposta of [
    {
      mimetype: "image/jpeg",
      base64: Buffer.from("MZ executável").toString("base64"),
    },
    { mimetype: "image/jpeg", base64: "http://private.invalid/token=segredo" },
    { mimetype: "image/png", base64: foto.toString("base64") },
  ]) {
    const mock = t.mock.method(globalThis, "fetch", async () =>
      Response.json(resposta),
    );
    await assert.rejects(
      baixarFotoNota("FOTO-1", ambiente),
      (error: Error) => !/private.invalid|segredo|MZ/.test(error.message),
    );
    mock.mock.restore();
  }
});

test("id e URL maliciosos não provocam chamada de rede", async (t) => {
  const mock = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("não deveria chamar");
  });
  await assert.rejects(baixarFotoNota("https://private.invalid", ambiente));
  await assert.rejects(
    baixarFotoNota("FOTO-1", {
      ...ambiente,
      EVOLUTION_URL: "http://user:senha@private.invalid",
    }),
  );
  assert.equal(mock.mock.callCount(), 0);
});

test("limite é conferido durante stream mesmo com cabeçalho falso; erro não contém segredo", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(29 * 1024 * 1024));
            controller.close();
          },
        }),
        { headers: { "content-length": "1" } },
      ),
  );
  await assert.rejects(baixarFotoNota("FOTO-1", ambiente), /até 20 MB/);
});

test("falha e timeout são apresentados sem detalhes privados", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("token=credencial-ficticia https://private.invalid");
  });
  await assert.rejects(
    baixarFotoNota("FOTO-1", ambiente),
    (error: Error) => !/credencial|private.invalid/.test(error.message),
  );
});
