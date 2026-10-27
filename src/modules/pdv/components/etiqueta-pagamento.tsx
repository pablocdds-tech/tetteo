import type { VendaPdv } from "../types";

export function EtiquetaPagamento({
  venda,
}: {
  venda: Pick<VendaPdv, "status" | "pagamentos">;
}) {
  const pendente = venda.status === "PENDENTE";
  const cancelada = venda.status === "CANCELADA";
  const texto = pendente
    ? "Aguardando pagamento"
    : cancelada
      ? venda.pagamentos.length
        ? "Cancelado · devolução manual"
        : "Cancelado sem pagamento"
      : "Pagamento registrado";
  return (
    <span
      className={`${pendente ? "bg-warn-sub text-warn" : cancelada ? "bg-bad-sub text-bad" : "bg-ok-sub text-ok"} inline-flex rounded px-2 py-1 text-xs font-semibold`}
    >
      {texto}
    </span>
  );
}
