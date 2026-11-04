import assert from "node:assert/strict";
import { test } from "node:test";

import type { VirtualModelStatus } from "../virtual-types";
import {
  MODEL_TEST_VALIDITY_MS,
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
