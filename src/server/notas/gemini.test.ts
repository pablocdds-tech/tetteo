import assert from "node:assert/strict";
import { test } from "node:test";
import { prepararExtracaoGemini, gerarExtracaoGemini } from "./gemini";
import { extracaoVazia } from "./extracao";
import { LeituraNotaRecusada } from "./documento";
import { confiancasDoItem } from "./extracao";
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

test("Gemini sugere uma categoria do catálogo na mesma geração e não recebe IDs do sistema", async (t) => {
  const categorias = [
    { nome: "Mercadorias", valor: "id-privado-mercadorias" },
    { nome: "Material de limpeza", valor: "id-privado-limpeza" },
  ];
  const dados = extracaoVazia();
  dados.itens = [
    {
      descricao: "DETERGENTE FICTICIO",
      quantidade: 1,
      unidade: "UN",
      valor_unitario: 5,
      valor_total: 5,
      codigo_ean: null,
      codigo_fornecedor: null,
      confianca: confiancasDoItem(1),
    },
  ];
  const mock = t.mock.method(
    globalThis,
    "fetch",
    async (url: string, opcoes: RequestInit) => {
      const corpo = JSON.parse(String(opcoes.body));
      const pedido = corpo.generateContentRequest ?? corpo;
      assert.match(
        pedido.systemInstruction.parts[0].text,
        /conforme os produtos/,
      );
      assert.match(
        pedido.systemInstruction.parts[0].text,
        /Material de limpeza/,
      );
      assert.ok(!JSON.stringify(pedido).includes("id-privado"));
      assert.deepEqual(
        pedido.generationConfig.responseJsonSchema.properties
          .categoria_financeira_indice.anyOf[0].enum,
        [1, 2],
      );
      return Response.json(
        url.endsWith("countTokens")
          ? { totalTokens: 500 }
          : {
              candidates: [
                {
                  finishReason: "STOP",
                  content: {
                    parts: [
                      {
                        text: JSON.stringify({
                          ...dados,
                          categoria_financeira_indice: 2,
                        }),
                      },
                    ],
                  },
                },
              ],
              usageMetadata: {
                promptTokenCount: 500,
                candidatesTokenCount: 100,
                totalTokenCount: 600,
              },
            },
      );
    },
  );
  const r = await gerarExtracaoGemini(
    await prepararExtracaoGemini([imagem], config, categorias),
    config,
  );
  assert.equal(mock.mock.callCount(), 2); // Contagem + uma geração já existente.
  assert.equal(r.categoriaFinanceira, categorias[1].valor);
  assert.deepEqual(r.dados, dados);
});

test("categoria inválida ou sem produtos não descarta a transcrição fiscal útil", async (t) => {
  let indice: unknown = "id-de-outra-organizacao";
  const dados = extracaoVazia();
  dados.razao_social = "Fornecedor fictício legível";
  t.mock.method(globalThis, "fetch", async (url: string) =>
    Response.json(
      url.endsWith("countTokens")
        ? { totalTokens: 500 }
        : {
            candidates: [
              {
                finishReason: "STOP",
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        ...dados,
                        categoria_financeira_indice: indice,
                      }),
                    },
                  ],
                },
              },
            ],
            usageMetadata: {
              promptTokenCount: 500,
              candidatesTokenCount: 100,
              totalTokenCount: 600,
            },
          },
    ),
  );
  const p = await prepararExtracaoGemini([imagem], config, [
    { nome: "Categoria fictícia", valor: "permitida" },
  ]);
  for (const valor of [null, "id-de-outra-organizacao", 99, 0, 1.5, 1]) {
    indice = valor;
    dados.itens =
      valor === 1
        ? []
        : [
            {
              descricao: "Produto fictício",
              quantidade: 1,
              unidade: "UN",
              valor_unitario: 5,
              valor_total: 5,
              codigo_ean: null,
              codigo_fornecedor: null,
              confianca: confiancasDoItem(1),
            },
          ];
    const r = await gerarExtracaoGemini(p, config);
    assert.equal(r.categoriaFinanceira, undefined);
    assert.equal(r.dados.razao_social, dados.razao_social);
  }
});
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
