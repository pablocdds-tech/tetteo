import type { PedidoCozinha, QuadroCozinha } from "../cozinha-types";
import type { QuadroPedidos } from "../pedido-types";

/** A cozinha recebe apenas a comanda: sem contato, endereço ou valores. */
export function quadroCozinha(
  quadro: QuadroPedidos,
  agora = new Date(),
): QuadroCozinha {
  const pedidos: PedidoCozinha[] = quadro.pedidos.flatMap((p) =>
    p.status === "COZINHA" || p.status === "AGUARDANDO_COLETA"
      ? [
          {
            id: p.id,
            numero: p.origem?.numero ?? String(p.numero),
            versao: p.versao,
            modalidade: p.venda.modalidade,
            status: p.status,
            iniciadoEm: p.preparoIniciadoEm ?? p.criadoEm,
            prontoEm: p.prontoEm,
            agendadoPara: p.agendadoPara ?? null,
            observacao: p.venda.observacao,
            itens: p.venda.itens.map((i) => ({
              nome: i.nome,
              quantidade: i.quantidade,
              observacao: i.observacao,
              complementos: i.complementos.map((c) => c.grupo + ": " + c.nome),
            })),
          },
        ]
      : [],
  );
  pedidos.sort(
    (a, b) =>
      a.iniciadoEm.localeCompare(b.iniciadoEm) || a.id.localeCompare(b.id),
  );
  return {
    pedidos,
    emPreparo: quadro.totais.COZINHA,
    prontos: quadro.totais.AGUARDANDO_COLETA,
    truncado:
      pedidos.length < quadro.totais.COZINHA + quadro.totais.AGUARDANDO_COLETA,
    atualizadoEm: agora.toISOString(),
  };
}
