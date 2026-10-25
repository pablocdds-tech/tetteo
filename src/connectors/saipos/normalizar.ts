import { SaiposError, type SaiposSale } from "./client";

export function normalizarVenda(venda: SaiposSale, loja: number) {
  if (venda.id_store !== loja)
    throw new SaiposError("store", "Venda pertence a outra loja.");
  const totalCentavos = Math.round(venda.total_amount * 100);
  const data = /^\d{4}-\d{2}-\d{2}$/;
  const instante = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/;
  if (
    !Number.isSafeInteger(totalCentavos) ||
    Math.abs(totalCentavos) > 2147483647 ||
    !data.test(venda.shift_date) ||
    !instante.test(venda.created_at) ||
    !instante.test(venda.updated_at)
  )
    throw new SaiposError("format", "Valor ou data Saipos fora do contrato.");
  const criadaNoSaiposEm = new Date(venda.created_at + "-03:00");
  const alteradaNoSaiposEm = new Date(venda.updated_at + "-03:00");
  if (
    !Number.isFinite(criadaNoSaiposEm.getTime()) ||
    !Number.isFinite(alteradaNoSaiposEm.getTime())
  )
    throw new SaiposError("format", "Data Saipos inválida.");
  return {
    vendaExternaId: String(venda.id_sale),
    dataTurno: venda.shift_date,
    totalCentavos,
    cancelada: venda.canceled === "Y",
    criadaNoSaiposEm,
    alteradaNoSaiposEm,
  };
}
