import type { Prisma } from "@prisma/client";
import type { ItemVendaPdv, PagamentoPdv, VendaPdv } from "../types";

/** Snapshot financeiro. Contatos/endereço de entrega nunca entram neste DTO. */
export function serializarVendaPdv(
  v: Prisma.PdvVendaGetPayload<object>,
  podeVerCliente: boolean,
): VendaPdv {
  return {
    id: v.id,
    criadaEm: v.criadaEm.toISOString(),
    cliente: podeVerCliente ? v.cliente : null,
    modalidade: v.modalidade,
    status: v.status as VendaPdv["status"],
    totalCentavos: v.totalCentavos,
    subtotalCentavos: v.subtotalCentavos,
    descontoCentavos: v.descontoCentavos,
    taxaCentavos: v.taxaCentavos,
    freteCentavos: v.freteCentavos,
    trocoCentavos: v.trocoCentavos,
    observacao: v.observacao,
    operador: v.operador,
    itens: v.itens as ItemVendaPdv[],
    pagamentos: v.pagamentos as PagamentoPdv[],
    motivoCancelamento: v.motivoCancelamento,
    versaoFinanceira: v.versaoFinanceira,
    recebidoEm: v.recebidoEm?.toISOString() ?? null,
    recebidoPor: v.recebidoPorNome,
    caixaRecebimentoId: v.caixaRecebimentoId,
  };
}
