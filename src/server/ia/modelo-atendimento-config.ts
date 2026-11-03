import { db } from "@/server/db";
import { decryptVirtualCredential } from "./credencial-atendimento";
import {
  virtualModelConfiguration,
  type VirtualModelCredentials,
} from "./atendimento";

export const MODEL_TEST_VALID_MS = 30 * 86_400_000;
export function scopedEnvironmentModelConfiguration(scope: {
  organizationId: string;
  storeId: string;
}): VirtualModelCredentials {
  if (
    process.env.AV_MODEL_ORGANIZATION_ID === scope.organizationId &&
    process.env.AV_MODEL_STORE_ID === scope.storeId
  )
    return virtualModelConfiguration();
  return {
    enabled: false,
    configured: false,
    model: "",
    inputRate: 0,
    outputRate: 0,
    source: "NONE",
  };
}
export async function privateVirtualModelConfiguration(scope: {
  organizationId: string;
  storeId: string;
}): Promise<VirtualModelCredentials> {
  const row = await db.avModelConfiguration.findUnique({
    where: { organizationId_storeId: scope },
  });
  if (!row) return scopedEnvironmentModelConfiguration(scope);
  let apiKey: string | undefined;
  try {
    apiKey = decryptVirtualCredential(scope, row.encryptedKey);
  } catch {}
  const tested =
    row.testState === "PASSED" &&
    row.testedRevision === row.revision &&
    !!row.testedAt &&
    row.testedAt.getTime() > Date.now() - MODEL_TEST_VALID_MS;
  return {
    source: "DATABASE",
    revision: row.revision,
    enabled: row.enabled,
    configured: !!apiKey && !!row.model && row.ratesConfirmed && tested,
    model: row.model,
    apiKey,
    inputRate: row.inputMicrosPerMillion,
    outputRate: row.outputMicrosPerMillion,
  };
}
