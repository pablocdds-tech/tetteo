// Contract for the composition root: connectors translate, the CRM owns writes.
export type ClienteVenda = {
  externalId: string;
  name: string;
  phone: string | null;
  email: string | null;
};
export type VendaCliente = {
  externalId: string;
  soldAt: Date;
  updatedAt: Date;
  shiftDate: string;
  totalCents: number;
  cancelled: boolean;
  customer: ClienteVenda | null;
};
export type FonteClientes = (
  storeId: number,
  period: { start: string; end: string; column: "shift_date" | "updated_at" },
) => Promise<VendaCliente[]>;
