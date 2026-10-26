import { pode, type ContextoSessao } from "@/core/sessao/nucleo";

export type CrmUser = {
  userId: string;
  role: "SUPER_ADMIN" | "MANAGER" | "ATTENDANT";
  storeIds: string[];
  permissions: string[];
};

export function crmUser(ctx: ContextoSessao): CrmUser {
  const unit = ctx.unidadeAtiva;
  if (!unit || !ctx.unidadesVisiveis.some((u) => u.id === unit.id))
    throw forbidden();
  return {
    userId: ctx.usuario.id,
    role: pode(ctx, "crm.gerenciar") ? "MANAGER" : "ATTENDANT",
    storeIds: [unit.id],
    permissions: [...ctx.permissoes],
  };
}
export function can(user: CrmUser, _module: string, action: string) {
  return pode(
    { permissoes: new Set(user.permissions) },
    action === "VIEW" ? "crm.ver" : "crm.editar",
  );
}
function forbidden() {
  const error = new Error("Sem acesso a esta unidade.");
  error.name = "AuthorizationError";
  return error;
}
export function assertStoreAccess(user: CrmUser, storeId: string) {
  if (!user.storeIds.includes(storeId)) throw forbidden();
}
export function scopedStoreIds(user: CrmUser, storeId?: string) {
  if (!storeId || storeId === "all") return user.storeIds;
  assertStoreAccess(user, storeId);
  return [storeId];
}
