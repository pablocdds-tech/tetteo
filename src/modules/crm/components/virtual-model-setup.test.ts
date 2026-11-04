import assert from "node:assert/strict";
import { test } from "node:test";

import type { VirtualModelStatus } from "../virtual-types";
import {
  MODEL_TEST_VALIDITY_MS,
  virtualModelSaveSettings,
  virtualModelSetup,
  type VirtualModelDraft,
} from "./virtual-model-setup";

const now = Date.parse("2026-11-04T12:00:00.000Z");
const status: VirtualModelStatus = {
  provider: "GEMINI",
  source: "DATABASE",
  credentialPresent: true,
  model: "gemini-fixture",
  revision: 2,
  enabled: false,
  rates: {
    inputMicrosPerMillion: 0,
    outputMicrosPerMillion: 0,
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
const draft: VirtualModelDraft = {
  pendingKey: false,
  model: "gemini-fixture",
  inputPrice: "0",
  outputPrice: "0",
  ratesConfirmed: true,
};
const setup = (saved = status, editing = draft, busy = false, secure = true) =>
  virtualModelSetup(saved, editing, busy, now, secure);

test("salvar chave preserva configurações já salvas mesmo com rascunho de modelo e tarifas inválidos", () => {
  const editing = {
    ...draft,
    pendingKey: true,
    model: "modelo inválido",
    inputPrice: "",
    outputPrice: "-1",
    ratesConfirmed: false,
  };
  assert.deepEqual(virtualModelSaveSettings(status, editing, true), {
    model: status.model,
    ratesConfirmed: status.rates.confirmed,
    inputMicrosPerMillion: status.rates.inputMicrosPerMillion,
    outputMicrosPerMillion: status.rates.outputMicrosPerMillion,
  });
  assert.equal(virtualModelSaveSettings(status, editing, false), null);
});

test("cadastro inicial da chave independe de modelo e tarifas enquanto salvar custos usa o rascunho", () => {
  const initial = {
    ...status,
    model: null,
    rates: { ...status.rates, confirmed: false },
  };
  assert.deepEqual(
    virtualModelSaveSettings(
      initial,
      { ...draft, pendingKey: true, inputPrice: "", outputPrice: "" },
      true,
    ),
    {
      model: "",
      ratesConfirmed: false,
      inputMicrosPerMillion: 0,
      outputMicrosPerMillion: 0,
    },
  );
  assert.deepEqual(
    virtualModelSaveSettings(status, { ...draft, inputPrice: "1.25" }, false),
    {
      model: draft.model,
      ratesConfirmed: true,
      inputMicrosPerMillion: 1_250_000,
      outputMicrosPerMillion: 0,
    },
  );
});

test("tarifas zero explicitamente confirmadas liberam teste, mantendo ativação condicionada à aprovação", () => {
  const ready = setup();
  assert.equal(ready.inputRate, 0);
  assert.equal(ready.outputRate, 0);
  assert.equal(ready.testReason, null);
  assert.match(ready.activateReason ?? "", /Conclua o teste/);
  assert.equal(ready.testPassed, false);
});

test("chave salva e tarifas ainda não confirmadas explicam o próximo passo exato", () => {
  const missing = setup(
    { ...status, rates: { ...status.rates, confirmed: false } },
    { ...draft, ratesConfirmed: false },
  );
  assert.match(missing.testReason ?? "", /Confirme as tarifas/);
  assert.match(missing.testReason ?? "", /gratuita/);
  assert.ok(missing.saveReason);
  const checked = setup({
    ...status,
    rates: { ...status.rates, confirmed: false },
  });
  assert.equal(checked.saveReason, null);
  assert.match(checked.testReason ?? "", /Salvar modelo e custos/);
});

test("nova chave pendente não é descartada por salvar modelo nem pode testar configuração antiga", () => {
  const pending = setup(status, { ...draft, pendingKey: true });
  assert.match(pending.saveReason ?? "", /nova chave/);
  assert.match(pending.testReason ?? "", /nova chave/);
  assert.match(pending.activateReason ?? "", /nova chave/);
});

test("teste aprovado da revisão atual libera ativação enquanto teste vencido ou de outra revisão não libera", () => {
  const passed: VirtualModelStatus = {
    ...status,
    test: {
      ...status.test,
      state: "PASSED",
      revision: status.revision,
      testedAt: new Date(now - 1000).toISOString(),
    },
  };
  assert.equal(setup(passed).activateReason, null);
  assert.equal(setup(passed).testPassed, true);
  assert.match(setup(passed).saveReason ?? "", /Ative o Gemini testado/);
  const active = setup({ ...passed, enabled: true });
  assert.match(active.saveReason ?? "", /já está ativo/);
  assert.doesNotMatch(active.saveReason ?? "", /Continue no teste|novo teste/);
  const expired = setup({
    ...passed,
    test: {
      ...passed.test,
      testedAt: new Date(now - MODEL_TEST_VALIDITY_MS).toISOString(),
    },
  });
  assert.equal(expired.testPassed, false);
  assert.match(expired.testLabel, /vencido/);
  assert.match(expired.activateReason ?? "", /30 dias/);
  assert.equal(expired.testReason, null);
  const outdated = setup({ ...passed, test: { ...passed.test, revision: 1 } });
  assert.equal(outdated.testPassed, false);
  assert.match(outdated.testLabel, /Revisão atual/);
  assert.ok(outdated.activateReason);
});

test("modelo manual válido não depende do catálogo e exige salvar antes de testar", () => {
  const manual = setup(status, { ...draft, model: "gemini-manual-fixture" });
  assert.equal(manual.modelValid, true);
  assert.equal(manual.saveReason, null);
  assert.match(manual.testReason ?? "", /Salvar modelo e custos/);
  assert.match(
    setup(status, { ...draft, model: "https://untrusted.invalid" })
      .saveReason ?? "",
    /modelo Gemini/,
  );
});

test("valores vazios, negativos, imprecisos e acima do teto explicam impedimento antes do envio", () => {
  for (const inputPrice of ["", "-1", "0.0000001", "1001", "inválido"])
    assert.match(
      setup(status, { ...draft, inputPrice }).saveReason ?? "",
      /duas tarifas/,
    );
  assert.equal(
    setup(status, { ...draft, inputPrice: "1.234567" }).inputRate,
    1_234_567,
  );
});

test("operação pendente e origem insegura mantêm ações bloqueadas com motivo visível", () => {
  assert.match(setup(status, draft, true).testReason ?? "", /Aguarde/);
  assert.match(setup(status, draft, false, false).testReason ?? "", /HTTPS/);
  assert.match(
    setup({ ...status, credentialPresent: false }).testReason ?? "",
    /chave privada/,
  );
});
