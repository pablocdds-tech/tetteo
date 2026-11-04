import assert from "node:assert/strict";
import test from "node:test";
import type { VirtualModelStatus } from "../virtual-types";
import {
  MODEL_CATALOG_WARNING,
  PENDING_MODEL_KEY,
  saveVirtualModelConfiguration,
} from "./virtual-model-save";

const persisted: VirtualModelStatus = {
  provider: "GEMINI",
  source: "DATABASE",
  credentialPresent: true,
  model: "gemini-ficticio",
  revision: 1,
  enabled: false,
  rates: {
    inputMicrosPerMillion: 100,
    outputMicrosPerMillion: 200,
    confirmed: true,
  },
  test: {
    state: "PENDING",
    revision: null,
    testedAt: null,
    errorCode: null,
    tokens: 0,
    costMicros: 0,
  },
  blockers: [],
};
const input = {
  storeId: "unidade-ficticia",
  withKey: true,
  apiKey: "chave-ficticia-sem-acesso-externo",
  persisted,
  draft: {
    model: "rascunho inválido",
    ratesConfirmed: false,
    inputMicrosPerMillion: Number.NaN,
    outputMicrosPerMillion: -1,
  },
};

test("chave salva continua confirmada quando o catálogo falha e usa somente configurações persistidas", async () => {
  const calls: string[] = [];
  const saved = { ...persisted, revision: 2 };
  const result = await saveVirtualModelConfiguration(input, {
    async save(request) {
      calls.push("save");
      assert.equal(request.model, persisted.model);
      assert.equal(
        request.inputMicrosPerMillion,
        persisted.rates.inputMicrosPerMillion,
      );
      assert.equal(
        request.outputMicrosPerMillion,
        persisted.rates.outputMicrosPerMillion,
      );
      assert.equal(request.ratesConfirmed, persisted.rates.confirmed);
      assert.equal(Boolean(request.apiKey), true);
      return saved;
    },
    onSaved(status) {
      calls.push("saved");
      assert.equal(status.revision, 2);
    },
    async listModels() {
      calls.push("catalog");
      throw new Error("catálogo fictício indisponível");
    },
  });
  assert.deepEqual(calls, ["save", "saved", "catalog"]);
  assert.equal(result.models, null);
  assert.equal(result.catalogError, MODEL_CATALOG_WARNING);
});

test("salvar modelo com chave pendente não envia nem ignora a chave", async () => {
  let calls = 0;
  await assert.rejects(
    saveVirtualModelConfiguration(
      { ...input, withKey: false },
      {
        async save() {
          calls++;
          return persisted;
        },
        onSaved() {
          calls++;
        },
        async listModels() {
          calls++;
          return [];
        },
      },
    ),
    { message: PENDING_MODEL_KEY },
  );
  assert.equal(calls, 0);
});

test("falha no POST de salvamento não confirma sucesso nem consulta catálogo", async () => {
  let saved = false;
  let catalog = false;
  await assert.rejects(
    saveVirtualModelConfiguration(input, {
      async save() {
        throw new Error("falha de salvamento fictícia");
      },
      onSaved() {
        saved = true;
      },
      async listModels() {
        catalog = true;
        return [];
      },
    }),
    { message: "falha de salvamento fictícia" },
  );
  assert.equal(saved, false);
  assert.equal(catalog, false);
});
