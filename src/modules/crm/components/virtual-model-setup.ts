import type { VirtualModelStatus } from "../virtual-types";

export const MODEL_TEST_VALIDITY_MS = 30 * 86_400_000;

export type VirtualModelDraft = {
  pendingKey: boolean;
  model: string;
  inputPrice: string;
  outputPrice: string;
  ratesConfirmed: boolean;
};

function rateMicros(price: string): number | null {
  if (!price.trim()) return null;
  const value = Number(price) * 1_000_000;
  const rounded = Math.round(value);
  return Number.isFinite(value) &&
    value >= 0 &&
    rounded <= 1_000_000_000 &&
    Math.abs(value - rounded) < 0.0000001
    ? rounded
    : null;
}

/** A key rotation preserves saved settings, independently of unfinished drafts. */
export function virtualModelSaveSettings(
  status: VirtualModelStatus,
  draft: VirtualModelDraft,
  withKey: boolean,
) {
  if (withKey)
    return {
      model: status.model ?? "",
      ratesConfirmed: status.rates.confirmed,
      inputMicrosPerMillion: status.rates.inputMicrosPerMillion,
      outputMicrosPerMillion: status.rates.outputMicrosPerMillion,
    };
  const inputRate = rateMicros(draft.inputPrice);
  const outputRate = rateMicros(draft.outputPrice);
  if (draft.pendingKey || inputRate === null || outputRate === null)
    return null;
  return {
    model: draft.model,
    ratesConfirmed: draft.ratesConfirmed,
    inputMicrosPerMillion: inputRate,
    outputMicrosPerMillion: outputRate,
  };
}

/** Shared button gates and explanations; no catalog dependency or inferred tariff. */
export function virtualModelSetup(
  status: VirtualModelStatus | null,
  draft: VirtualModelDraft,
  busy: boolean,
  now: number,
  secure: boolean,
) {
  const inputRate = rateMicros(draft.inputPrice);
  const outputRate = rateMicros(draft.outputPrice);
  const modelValid =
    /^gemini-[a-zA-Z0-9.-]+$/.test(draft.model) && draft.model.length <= 128;
  const pendingKey = draft.pendingKey;
  const hasEdits = Boolean(
    status &&
    (pendingKey ||
      draft.model !== (status.model ?? "") ||
      inputRate !== status.rates.inputMicrosPerMillion ||
      outputRate !== status.rates.outputMicrosPerMillion ||
      draft.ratesConfirmed !== status.rates.confirmed),
  );
  const testedAt = status?.test.testedAt
    ? Date.parse(status.test.testedAt)
    : NaN;
  const sameRevision = status?.test.revision === status?.revision;
  const expired =
    status?.test.state === "PASSED" &&
    sameRevision &&
    Number.isFinite(testedAt) &&
    testedAt <= now - MODEL_TEST_VALIDITY_MS;
  const testPassed = Boolean(
    status?.test.state === "PASSED" &&
    sameRevision &&
    Number.isFinite(testedAt) &&
    testedAt > now - MODEL_TEST_VALIDITY_MS,
  );
  const labels: Record<VirtualModelStatus["test"]["state"], string> = {
    NONE: "Sem teste realizado",
    PENDING: "Configuração salva; teste pendente",
    TESTING: "Teste em andamento",
    PASSED: testPassed
      ? "Teste concluído com sucesso"
      : expired
        ? "Teste vencido; faça novo teste"
        : "Revisão atual ainda precisa de teste",
    FAILED: "Teste falhou",
  };
  const commonReason = !status
    ? "Aguarde a consulta da configuração."
    : !secure
      ? "Abra o sistema por HTTPS para configurar, testar e ativar o Gemini."
      : busy
        ? "Aguarde a operação em andamento."
        : !status.credentialPresent
          ? "Salve a chave privada do Gemini primeiro."
          : pendingKey
            ? "Há uma nova chave no campo. Salve essa chave ou descarte a alteração antes de continuar."
            : !modelValid
              ? "Selecione um modelo Gemini ou informe o nome completo em Modelo e custos."
              : inputRate === null || outputRate === null
                ? "Preencha as duas tarifas com valores de 0 a 1.000 dólares, com até seis casas decimais."
                : !draft.ratesConfirmed
                  ? "Confirme as tarifas em Modelo e custos e salve a configuração. Se a modalidade da sua conta for gratuita, os dois valores podem ser zero."
                  : null;
  const saveReason =
    commonReason ??
    (!hasEdits
      ? testPassed
        ? status?.enabled
          ? "O Gemini já está ativo nesta unidade."
          : "Modelo e custos já estão salvos. Ative o Gemini testado abaixo."
        : "Modelo e custos já estão salvos. Continue no teste abaixo."
      : null);
  const testReason =
    commonReason ??
    (hasEdits
      ? "Clique em Salvar modelo e custos antes de testar esta configuração."
      : !status?.rates.confirmed
        ? "Confirme e salve as tarifas em Modelo e custos antes de testar."
        : null);
  const activateReason =
    testReason ??
    (!testPassed
      ? expired
        ? "O teste venceu após 30 dias. Faça um novo teste antes de ativar."
        : "Conclua o teste desta revisão com sucesso antes de ativar."
      : null);
  return {
    inputRate,
    outputRate,
    modelValid,
    pendingKey,
    hasEdits,
    testPassed,
    expired,
    testLabel: status ? labels[status.test.state] : "Consultando configuração",
    saveReason,
    testReason,
    activateReason,
  };
}
