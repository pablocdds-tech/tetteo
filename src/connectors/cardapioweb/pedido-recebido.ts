import type { z } from "zod";
import type { PedidoRecebido } from "@/lib/pedido-recebido";
import { detalhePedidoCw } from "./schemas";

const meios: Record<string, string> = {
  money: "Dinheiro",
  pix: "Pix",
  pix_auto: "Pix automático",
  credit_card: "Crédito",
  debit_card: "Débito",
  online_credit_card: "Crédito online",
  meal_voucher: "Vale-refeição",
  food_voucher: "Vale-alimentação",
  bank_transfer: "Transferência",
  bank_slip: "Boleto",
  debt_book: "Fiado",
  ifood: "iFood",
  ifood_voucher: "Voucher iFood",
  food99: "99Food",
};
export function normalizarPedidoRecebidoCw(
  p: z.output<typeof detalhePedidoCw>,
): PedidoRecebido {
  const situacoes: Record<string, string> = {
    waiting_confirmation: "Aguardando confirmação",
    pending_payment: "Pagamento pendente",
    pending_online_payment: "Pagamento online pendente",
    scheduled_confirmed: "Agendado confirmado",
    confirmed: "Confirmado",
    ready: "Pronto",
    waiting_to_catch: "Aguardando retirada",
    released: "Saiu para entrega",
    delivered: "Entregue",
    closed: "Finalizado",
    canceling: "Cancelamento em andamento",
    canceled: "Cancelado",
  };
  const etapas: Record<string, PedidoRecebido["etapa"]> = {
    scheduled_confirmed: "AGENDADO",
    ready: "AGUARDANDO_COLETA",
    waiting_to_catch: "AGUARDANDO_COLETA",
    released: "SAIU_ENTREGA",
    delivered: "ENTREGUE",
    closed: "ENTREGUE",
    canceled: "CANCELADO",
  };
  type Linha = {
    name: string;
    quantity: number;
    status?: string;
    options: {
      name: string;
      quantity: number;
      option_group_name?: string | null;
      unit_price?: number;
      total_price?: number;
    }[];
    items?: Linha[];
  };
  function complementos(
    linha: Linha,
    grupo = "",
  ): PedidoRecebido["itens"][number]["complementos"] {
    const opcoes = linha.options.map((o) => ({
      grupo: grupo
        ? `${grupo} · ${o.option_group_name ?? "Complementos"}`
        : (o.option_group_name ?? "Complementos"),
      nome: `${o.quantity}× ${o.name}`,
      precoCentavos: o.unit_price ?? o.total_price ?? 0,
    }));
    for (const filho of linha.items ?? []) {
      if (filho.status === "canceled" || filho.quantity === 0) continue;
      opcoes.push({
        grupo: "Combo",
        nome: `${filho.quantity}× ${filho.name}`,
        precoCentavos: 0,
      });
      opcoes.push(...complementos(filho, filho.name));
    }
    return opcoes;
  }
  const endereco = p.delivery_address;
  const canais: Record<string, string> = {
    catalog: "Cardápio digital",
    whatsapp_extension: "WhatsApp",
    portal: "Portal",
    store_front_catalog: "Balcão",
    ifood: "iFood",
    food99: "99Food",
  };
  return {
    numeroOrigem: String(p.display_id ?? p.id),
    canal: canais[p.sales_channel] ?? p.sales_channel,
    situacao: p.status,
    situacaoNome: situacoes[p.status] ?? p.status,
    etapa: etapas[p.status] ?? "COZINHA",
    modalidade:
      p.order_type === "delivery"
        ? "ENTREGA"
        : p.order_type === "takeout"
          ? "RETIRADA"
          : "BALCAO",
    criadoEm: p.created_at,
    atualizadoEm: p.updated_at,
    agendadoPara: p.schedule?.scheduled_date_time_start ?? null,
    cliente: p.customer?.name ?? null,
    observacao: p.observation ?? "",
    totalCentavos: p.total,
    freteCentavos: p.delivery_fee,
    itens: p.items
      .filter((i) => i.status !== "canceled" && i.quantity > 0)
      .map((i) => ({
        produtoId: `externo:${i.item_id}`,
        nome: i.name,
        quantidade: i.quantity,
        observacao: i.observation ?? "",
        precoUnitarioCentavos: i.unit_price,
        totalCentavos: i.total_price,
        complementos: complementos(i),
      })),
    pagamentos: p.payments.map((pag) => ({
      meio: meios[pag.payment_method] ?? pag.payment_method,
      tipo:
        pag.payment_type === "online"
          ? "ONLINE"
          : pag.payment_type === "offline"
            ? "NA_ENTREGA"
            : "OUTRO",
      situacao: pag.status,
      pago: pag.status === "paid",
      totalCentavos: pag.total,
      trocoParaCentavos: pag.change_for ?? null,
    })),
    entrega: endereco
      ? {
          destinatario: p.customer?.name ?? null,
          telefone: p.customer?.phone ?? null,
          logradouro: endereco.street,
          numero:
            endereco.number ??
            [
              endereco.address_block && `Quadra ${endereco.address_block}`,
              endereco.address_lot && `Lote ${endereco.address_lot}`,
            ]
              .filter(Boolean)
              .join(" · "),
          complemento: endereco.complement ?? "",
          bairro: endereco.neighborhood,
          cidade: endereco.city,
          uf: endereco.state,
          cep: endereco.postal_code ?? "",
          referencia: endereco.reference ?? "",
        }
      : null,
  };
}
