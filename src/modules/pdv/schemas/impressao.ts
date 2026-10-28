import { z } from "zod";
import type { DocumentoImpressaoPdv } from "../impressao-types";
import { esquemaEntregaSnapshot } from "./entrega";

export const esquemaDocumentoImpressao = z
  .object({
    vendaId: z.string().uuid(),
    tipo: z.enum(["COMPROVANTE", "COZINHA"]),
  })
  .strict();

export const esquemaSolicitarImpressao = esquemaDocumentoImpressao.extend({
  chave: z.string().uuid(),
});

const centavos = z.number().int().nonnegative().max(2_147_483_647);
const item = z.object({
  nome: z.string().min(1).max(300),
  quantidade: z.number().int().min(1).max(1000),
  observacao: z.string().max(140),
  complementos: z
    .array(z.object({ grupo: z.string().max(300), nome: z.string().max(300) }))
    .max(200),
  precoUnitarioCentavos: centavos,
  totalCentavos: centavos,
});
const esquemaSnapshot = z.object({
  id: z.string().uuid(),
  cliente: z.string().nullable(),
  modalidade: z.enum(["RETIRADA", "BALCAO", "ENTREGA"]),
  observacao: z.string().max(500),
  status: z.enum(["PENDENTE", "CONCLUIDA", "CANCELADA"]),
  operador: z.string(),
  criadaEm: z.date(),
  motivoCancelamento: z.string().nullable(),
  itens: z.array(item).min(1).max(100),
  pagamentos: z
    .array(
      z.object({
        forma: z.enum(["DINHEIRO", "PIX", "CREDITO", "DEBITO"]),
        valorCentavos: centavos,
      }),
    )
    .max(20),
  subtotalCentavos: centavos,
  descontoCentavos: centavos,
  taxaCentavos: centavos,
  freteCentavos: centavos.default(0),
  entrega: z.unknown().optional(),
  totalCentavos: centavos,
  trocoCentavos: centavos,
});

/** Só campos explicitamente permitidos saem do servidor, sem repassar o JSON bruto. */
export function montarDocumentoImpressao(
  snapshot: unknown,
  contexto: {
    unidade: string;
    tipo: "COMPROVANTE" | "COZINHA";
    podeVerCliente: boolean;
    podeVerEntrega?: boolean;
    pedido: {
      id: string;
      numero: number;
      status: string;
      agendadoPara?: Date | null;
      iniciarPreparoEm?: Date | null;
      preparoIniciadoEm?: Date | null;
    } | null;
    agora?: Date;
  },
): DocumentoImpressaoPdv {
  const venda = esquemaSnapshot.parse(snapshot);
  const base = {
    vendaId: venda.id,
    unidade: contexto.unidade,
    pedido: contexto.pedido
      ? {
          id: contexto.pedido.id,
          numero: contexto.pedido.numero,
          status: contexto.pedido.status,
        }
      : null,
    criadaEm: venda.criadaEm.toISOString(),
    geradoEm: (contexto.agora ?? new Date()).toISOString(),
    operador: venda.operador,
    ...(contexto.podeVerCliente && venda.cliente
      ? { cliente: venda.cliente }
      : {}),
    modalidade: venda.modalidade,
    observacao: venda.observacao,
    statusVenda: venda.status,
    motivoCancelamento: venda.motivoCancelamento,
    ...(contexto.pedido?.agendadoPara && contexto.pedido.iniciarPreparoEm
      ? {
          agendamento: {
            para: contexto.pedido.agendadoPara.toISOString(),
            iniciarPreparoEm: contexto.pedido.iniciarPreparoEm.toISOString(),
            preparoIniciadoEm:
              contexto.pedido.preparoIniciadoEm?.toISOString() ?? null,
          },
        }
      : {}),
  };
  const itens = venda.itens.map((linha) => ({
    nome: linha.nome,
    quantidade: linha.quantidade,
    observacao: linha.observacao,
    complementos: linha.complementos.map((opcao) => ({
      grupo: opcao.grupo,
      nome: opcao.nome,
    })),
  }));
  if (contexto.tipo === "COZINHA") return { ...base, tipo: "COZINHA", itens };
  const entrega = contexto.podeVerEntrega
    ? esquemaEntregaSnapshot.safeParse(venda.entrega)
    : null;
  return {
    ...base,
    tipo: "COMPROVANTE",
    itens: itens.map((linha, indice) => ({
      ...linha,
      precoUnitarioCentavos: venda.itens[indice].precoUnitarioCentavos,
      totalCentavos: venda.itens[indice].totalCentavos,
    })),
    subtotalCentavos: venda.subtotalCentavos,
    descontoCentavos: venda.descontoCentavos,
    taxaCentavos: venda.taxaCentavos,
    freteCentavos: venda.freteCentavos,
    ...(entrega?.success
      ? {
          entrega: {
            destinatario: entrega.data.destinatario,
            telefone: entrega.data.telefone,
            endereco: entrega.data.endereco,
            areaNome: entrega.data.areaNome,
            previstoEm: entrega.data.previstoEm,
          },
        }
      : {}),
    totalCentavos: venda.totalCentavos,
    trocoCentavos: venda.trocoCentavos,
    pagamentos: venda.pagamentos,
  };
}
