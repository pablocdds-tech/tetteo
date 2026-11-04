import type { VirtualModelStatus } from "../virtual-types";

export type VirtualModelSettings = {
  model: string;
  ratesConfirmed: boolean;
  inputMicrosPerMillion: number;
  outputMicrosPerMillion: number;
};
type SaveRequest = VirtualModelSettings & {
  storeId: string;
  action: "save";
  apiKey?: string;
};
type Model = { name: string; displayName: string };
export const PENDING_MODEL_KEY =
  "Há uma chave digitada ainda não salva. Use Salvar chave antes de salvar modelo e custos.";
export const MODEL_CATALOG_WARNING =
  "A chave está salva, mas não foi possível consultar os modelos. Confira as permissões no Google AI Studio e tente consultar novamente, sem reinserir a chave.";

/** A catalog failure must not turn a successful private save into a failed save. */
export async function saveVirtualModelConfiguration(
  input: {
    storeId: string;
    withKey: boolean;
    apiKey: string;
    persisted: VirtualModelStatus;
    draft: VirtualModelSettings;
  },
  actions: {
    save: (request: SaveRequest) => Promise<VirtualModelStatus>;
    onSaved: (status: VirtualModelStatus) => void;
    listModels: () => Promise<Model[]>;
  },
) {
  if (!input.withKey && input.apiKey.trim()) throw new Error(PENDING_MODEL_KEY);
  const settings = input.withKey
    ? {
        model: input.persisted.model ?? "",
        ratesConfirmed: input.persisted.rates.confirmed,
        inputMicrosPerMillion: input.persisted.rates.inputMicrosPerMillion,
        outputMicrosPerMillion: input.persisted.rates.outputMicrosPerMillion,
      }
    : input.draft;
  const status = await actions.save({
    storeId: input.storeId,
    action: "save",
    ...settings,
    ...(input.withKey ? { apiKey: input.apiKey.trim() } : {}),
  });
  actions.onSaved(status);
  if (!input.withKey) return { models: null, catalogError: null };
  try {
    return { models: await actions.listModels(), catalogError: null };
  } catch {
    return { models: null, catalogError: MODEL_CATALOG_WARNING };
  }
}
