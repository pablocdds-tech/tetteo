import type { OrigemPedido } from "../pedido-types";

export function EtiquetaOrigemPedido({ origem }: { origem?: OrigemPedido }) {
  return (
    <span
      className={`${origem ? "bg-info-sub text-info" : "bg-surface-2 text-ink-2"} inline-flex max-w-full flex-wrap rounded px-2 py-1 text-xs font-semibold`}
    >
      {origem ? `${origem.nome} · pedido #${origem.numero}` : "Tetteo"}
    </span>
  );
}

export function PagamentosOrigemPedido({ origem }: { origem: OrigemPedido }) {
  const estados: Record<string, string> = {
    paid: "Pago",
    pending: "Pendente",
    authorized: "Autorizado",
    refunded: "Reembolsado",
    cancelled: "Cancelado",
    abandoned: "Não concluído",
  };
  const moeda = (valor: number) =>
    (valor / 100).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });
  return (
    <div className="space-y-2 text-sm">
      {!origem.pagamentos.length && <p>Pagamento não informado pela origem.</p>}
      {origem.pagamentos.map((p, i) => (
        <div key={i}>
          <p>
            {p.meio} · {moeda(p.totalCentavos)} ·{" "}
            {estados[p.situacao] ?? p.situacao}
          </p>
          <p className="text-ink-3 text-xs">
            {p.tipo === "ONLINE"
              ? "Pagamento online na origem"
              : p.tipo === "NA_ENTREGA"
                ? "Pagamento no recebimento do pedido"
                : "Consultar forma de pagamento na origem"}
          </p>
          {p.trocoParaCentavos !== null && (
            <p className="text-ink-3 text-xs">
              Troco para {moeda(p.trocoParaCentavos)}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

export function EntregaOrigemPedido({
  origem,
  podeEntrega,
}: {
  origem: OrigemPedido;
  podeEntrega: boolean;
}) {
  const e = origem.entrega;
  return e ? (
    <div className="space-y-1">
      {e.destinatario && (
        <p>
          <strong>{e.destinatario}</strong>
        </p>
      )}
      {e.telefone && <p>Telefone: {e.telefone}</p>}
      <p>
        {e.logradouro}
        {e.numero ? `, ${e.numero}` : ""}
      </p>
      {e.complemento && <p>{e.complemento}</p>}
      <p>
        {e.bairro} · {e.cidade}/{e.uf}
      </p>
      {e.cep && <p>CEP: {e.cep}</p>}
      {e.referencia && <p>Referência: {e.referencia}</p>}
    </div>
  ) : (
    <p>
      {podeEntrega
        ? "Endereço não informado pela origem."
        : "Seu perfil precisa de permissão de entrega para consultar o endereço."}
    </p>
  );
}
