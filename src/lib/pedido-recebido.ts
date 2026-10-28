import { z } from "zod";

const texto = z.string().max(1000);
const centavos = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const esquemaPedidoRecebido = z.object({
  numeroOrigem: z.string().min(1).max(300),
  canal: z.string().max(300),
  situacao: z.string().min(1).max(300),
  situacaoNome: z.string().min(1).max(300),
  etapa: z.enum([
    "COZINHA",
    "AGUARDANDO_COLETA",
    "SAIU_ENTREGA",
    "ENTREGUE",
    "CANCELADO",
    "AGENDADO",
  ]),
  modalidade: z.enum(["ENTREGA", "RETIRADA", "BALCAO"]),
  criadoEm: z.iso.datetime({ offset: true }),
  atualizadoEm: z.iso.datetime({ offset: true }),
  agendadoPara: z.iso.datetime({ offset: true }).nullable(),
  cliente: texto.nullable(),
  observacao: texto,
  totalCentavos: centavos,
  freteCentavos: centavos,
  itens: z
    .array(
      z.object({
        produtoId: texto,
        nome: texto,
        quantidade: z.number().positive().max(10000),
        observacao: texto,
        precoUnitarioCentavos: centavos,
        totalCentavos: centavos,
        complementos: z
          .array(
            z.object({ grupo: texto, nome: texto, precoCentavos: centavos }),
          )
          .max(2000),
      }),
    )
    .max(1000),
  pagamentos: z
    .array(
      z.object({
        meio: texto,
        tipo: z.enum(["ONLINE", "NA_ENTREGA", "OUTRO"]),
        situacao: texto,
        pago: z.boolean(),
        totalCentavos: centavos,
        trocoParaCentavos: centavos.nullable(),
      }),
    )
    .max(100),
  entrega: z
    .object({
      destinatario: texto.nullable(),
      telefone: texto.nullable(),
      logradouro: texto,
      numero: texto,
      complemento: texto,
      bairro: texto,
      cidade: texto,
      uf: texto,
      cep: texto,
      referencia: texto,
    })
    .nullable(),
});
export type PedidoRecebido = z.infer<typeof esquemaPedidoRecebido>;

export function nomeOrigemPedido(origem: string) {
  return origem === "CARDAPIO_WEB"
    ? "Cardápio Web"
    : origem === "TETTEO"
      ? "Tetteo"
      : origem;
}
