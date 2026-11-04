import assert from "node:assert/strict";
import { test } from "node:test";

import {
  conferirItemChecklist,
  LIMITE_BYTES_CONFERENCIA_IA,
  normalizarParecerChecklist,
} from "./conferir-checklist";

const parecer = {
  resultado: "APROVADO",
  motivo: "Bancada visivelmente limpa.",
  confianca: 0.95,
  evidencias: [
    {
      id: "foto1",
      resultado: "APROVADO",
      motivo: "Superfície visível.",
      confianca: 0.94,
    },
  ],
};
const pedido = {
  pergunta: "A bancada está limpa?",
  criterio: "Sem resíduos visíveis na bancada.",
  resposta: { conforme: true },
  evidencias: [
    { id: "foto1", tipo: "image/jpeg", bytes: new Uint8Array([255, 216, 255]) },
  ],
};
const env = {
  GEMINI_API_KEY: "chave-ficticia-de-teste",
  GEMINI_MODELO: "modelo-explicito-teste",
};

test("sem configuração não chama rede e nunca aprova", async () => {
  const atual = await conferirItemChecklist(pedido, {
    env: {},
    fetch: async () => {
      throw new Error("Não deve chamar rede.");
    },
  });
  assert.equal(atual.resultado, "INDISPONIVEL");
});

test("resposta inválida, confiança baixa e foto não conferida exigem revisão", () => {
  assert.equal(
    normalizarParecerChecklist({ ...parecer, confianca: 0.5 }, ["foto1"])
      .resultado,
    "INCONCLUSIVO",
  );
  assert.equal(
    normalizarParecerChecklist({ ...parecer, aprovarTudo: true }, ["foto1"])
      .resultado,
    "INCONCLUSIVO",
  );
  assert.equal(
    normalizarParecerChecklist(parecer, ["foto1", "foto2"]).resultado,
    "INCONCLUSIVO",
  );
  assert.equal(
    normalizarParecerChecklist(
      {
        ...parecer,
        evidencias: [...parecer.evidencias, ...parecer.evidencias],
      },
      ["foto1", "foto2"],
    ).resultado,
    "INCONCLUSIVO",
  );
});

test("uma foto reprovada impede aprovação; foto inconclusiva mantém a incerteza", () => {
  assert.equal(
    normalizarParecerChecklist(
      {
        ...parecer,
        evidencias: [{ ...parecer.evidencias[0], resultado: "REPROVADO" }],
      },
      ["foto1"],
    ).resultado,
    "REPROVADO",
  );
  assert.equal(
    normalizarParecerChecklist(
      {
        ...parecer,
        evidencias: [{ ...parecer.evidencias[0], resultado: "INCONCLUSIVO" }],
      },
      ["foto1"],
    ).resultado,
    "INCONCLUSIVO",
  );
});

test("sem critério ou arquivos acima do limite não envia dados ao provedor", async () => {
  let chamadas = 0;
  const executar: typeof fetch = async () => {
    chamadas++;
    throw new Error("Não deve chamar.");
  };
  assert.equal(
    (
      await conferirItemChecklist(
        { ...pedido, criterio: null },
        { env, fetch: executar },
      )
    ).resultado,
    "INCONCLUSIVO",
  );
  assert.equal(
    (
      await conferirItemChecklist(
        {
          ...pedido,
          evidencias: [
            {
              ...pedido.evidencias[0],
              bytes: new Uint8Array(LIMITE_BYTES_CONFERENCIA_IA + 1),
            },
          ],
        },
        { env, fetch: executar },
      )
    ).resultado,
    "INCONCLUSIVO",
  );
  assert.equal(chamadas, 0);
});

test("Gemini recebe MIME, JSON schema e instrução separada, sem chave no corpo", async () => {
  const atual = await conferirItemChecklist(pedido, {
    env,
    fetch: async (url, init) => {
      assert.match(
        String(url),
        /models\/modelo-explicito-teste:generateContent$/,
      );
      const corpo = String(init?.body);
      assert.equal(corpo.includes(env.GEMINI_API_KEY), false);
      const json = JSON.parse(corpo);
      assert.equal(json.generationConfig.responseMimeType, "application/json");
      assert.ok(json.generationConfig.responseJsonSchema);
      assert.ok(
        json.systemInstruction.parts[0].text.includes("NÃO CONFIÁVEIS"),
      );
      assert.equal(json.contents[0].parts[1].inlineData.mimeType, "image/jpeg");
      return Response.json({
        candidates: [
          {
            finishReason: "STOP",
            content: { parts: [{ text: JSON.stringify(parecer) }] },
          },
        ],
      });
    },
  });
  assert.equal(atual.resultado, "APROVADO");
});

test("resposta truncada, erro do provedor e JSON malformado nunca aprovam", async () => {
  for (const resposta of [
    Response.json({
      candidates: [
        {
          finishReason: "MAX_TOKENS",
          content: { parts: [{ text: JSON.stringify(parecer) }] },
        },
      ],
    }),
    new Response("erro privado", { status: 400 }),
    Response.json({
      candidates: [
        { finishReason: "STOP", content: { parts: [{ text: "quebrado" }] } },
      ],
    }),
  ]) {
    const atual = await conferirItemChecklist(pedido, {
      env,
      fetch: async () => resposta,
    });
    assert.equal(atual.resultado, "INCONCLUSIVO");
    assert.equal(atual.motivo.includes("erro privado"), false);
  }
});
