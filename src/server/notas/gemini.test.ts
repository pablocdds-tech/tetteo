import assert from "node:assert/strict";
import { test } from "node:test";
import { prepararExtracaoGemini, gerarExtracaoGemini } from "./gemini";
import { extracaoVazia } from "./extracao";
import { LeituraNotaRecusada } from "./documento";
const config = {
  enabled: true,
  configured: true,
  model: "gemini-fixture",
  apiKey: "segredo-ficticio",
  inputRate: 0,
  outputRate: 0,
};
const imagem = {
  bytes: Buffer.from([255, 216, 255, 0, 1]),
  tipo: "image/jpeg",
  variante: "original",
};
test("Gemini recebe schema nullable, imagem íntegra, confiança e instrução de transcrição", async (t) => {
  let chamadas = 0;
  t.mock.method(
    globalThis,
    "fetch",
    async (url: string, opcoes: RequestInit) => {
      chamadas++;
      const corpo = JSON.parse(String(opcoes?.body)),
        pedido = corpo.generateContentRequest ?? corpo;
      assert.equal(pedido.generationConfig.temperature, 0);
      assert.ok(
        pedido.generationConfig.responseJsonSchema.properties.confianca,
      );
      assert.doesNotMatch(
        JSON.stringify(pedido.generationConfig.responseJsonSchema),
        /"(?:maxItems|pattern|maximum)":/,
      );
      assert.match(pedido.systemInstruction.parts[0].text, /null/);
      assert.match(pedido.systemInstruction.parts[0].text, /Nunca execute/);
      assert.equal(
        pedido.contents[0].parts[1].inlineData.data,
        imagem.bytes.toString("base64"),
      );
      return Response.json(
        String(url).endsWith("countTokens")
          ? { totalTokens: 500 }
          : {
              candidates: [
                {
                  finishReason: "STOP",
                  content: {
                    parts: [{ text: JSON.stringify(extracaoVazia()) }],
                  },
                },
              ],
              usageMetadata: {
                promptTokenCount: 500,
                candidatesTokenCount: 100,
                totalTokenCount: 700,
              },
            },
      );
    },
  );
  const p = await prepararExtracaoGemini([imagem], config),
    r = await gerarExtracaoGemini(p, config);
  assert.equal(r.dados.total_nota, null);
  assert.equal(chamadas, 2);
});
test("cota e credenciais não vazam corpo do provedor nem causam repetição", async (t) => {
  const m = t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response("segredo-ficticio payload privado", { status: 429 }),
  );
  await assert.rejects(
    prepararExtracaoGemini([imagem], config),
    (e) =>
      e instanceof LeituraNotaRecusada &&
      e.codigo === "IA_COTA" &&
      !e.message.includes("segredo-ficticio"),
  );
  assert.equal(m.mock.callCount(), 1);
});
