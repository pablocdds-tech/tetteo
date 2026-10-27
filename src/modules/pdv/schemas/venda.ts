import { z } from "zod";
import { ErroPdv } from "./erro";
import { esquemaEntregaEntrada } from "./entrega";
import type {
  ItemCarrinho,
  ItemVendaPdv,
  PagamentoPdv,
  ProdutoPdv,
} from "../types";

const centavos = z.number().int().min(0).max(100_000_000);
const identificador = z.string().trim().min(1).max(100);
export const esquemaGrupo = z
  .object({
    id: identificador,
    nome: z.string().trim().min(1).max(100),
    minimo: z.number().int().min(0).max(20),
    maximo: z.number().int().min(1).max(20),
    calculo: z.enum(["SOMA", "MEDIA"]),
    opcoes: z
      .array(
        z.object({
          id: identificador,
          nome: z.string().trim().min(1).max(100),
          precoCentavos: centavos,
          fichaId: identificador.optional(),
        }),
      )
      .min(1)
      .max(100),
  })
  .superRefine((g, ctx) => {
    if (g.minimo > g.maximo || g.maximo > g.opcoes.length)
      ctx.addIssue({
        code: "custom",
        message: "Confira os limites das opções.",
      });
  });
export const esquemaComplementos = z
  .object({
    produtoId: identificador,
    codigo: z.string().trim().max(80),
    grupos: z.array(esquemaGrupo).max(20),
  })
  .superRefine((d, ctx) => {
    const ids = d.grupos.flatMap((g) => [g.id, ...g.opcoes.map((o) => o.id)]);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({
        code: "custom",
        message: "Cada grupo e opção precisa ter um identificador único.",
      });
  });
export const esquemaFinalizar = z
  .object({
    chave: z.string().uuid(),
    carrinhoId: z.string().uuid().optional(),
    versaoCarrinho: z.number().int().min(1).max(2_000_000_000).optional(),
    caixaId: identificador,
    clienteId: identificador.optional(),
    modalidade: z.enum(["RETIRADA", "BALCAO", "ENTREGA"]),
    entrega: esquemaEntregaEntrada.optional(),
    observacao: z.string().trim().max(500),
    itens: z
      .array(
        z.object({
          produtoId: identificador,
          quantidade: z.number().int().min(1).max(1000),
          opcoes: z.array(identificador).max(200),
          observacao: z.string().trim().max(140),
        }),
      )
      .min(1)
      .max(100),
    descontoCentavos: centavos,
    taxaCentavos: centavos,
    pagamentos: z
      .array(
        z.object({
          forma: z.enum(["DINHEIRO", "PIX", "CREDITO", "DEBITO"]),
          valorCentavos: centavos.refine(
            (v) => v > 0,
            "Informe o valor do pagamento.",
          ),
        }),
      )
      .min(1)
      .max(20),
  })
  .superRefine((dados, ctx) => {
    if (
      (dados.carrinhoId === undefined) !==
      (dados.versaoCarrinho === undefined)
    )
      ctx.addIssue({
        code: "custom",
        message: "Informe a identificação e a versão do carrinho salvo.",
      });
  });
export const esquemaAbrir = z.object({
  saldoInicialCentavos: centavos,
  localEstoqueId: identificador,
});
export const esquemaMovimento = z.object({
  caixaId: identificador,
  tipo: z.enum(["SANGRIA", "SUPRIMENTO"]),
  valorCentavos: centavos.refine(
    (v) => v > 0,
    "Informe um valor maior que zero.",
  ),
  motivo: z.string().trim().min(3).max(300),
});
export const esquemaFechar = z.object({
  caixaId: identificador,
  valorContadoCentavos: centavos,
  observacao: z.string().trim().max(500),
});
export const esquemaCancelar = z
  .object({
    vendaId: identificador,
    motivo: z.string().trim().min(3).max(300),
    pedidoId: identificador.optional(),
    versaoPedido: z.number().int().min(1).max(2_000_000_000).optional(),
  })
  .superRefine((dados, ctx) => {
    if ((dados.pedidoId === undefined) !== (dados.versaoPedido === undefined))
      ctx.addIssue({
        code: "custom",
        message: "Informe a identificação e a versão do pedido.",
      });
  });

export function calcularPrecoItem(
  produto: ProdutoPdv,
  opcoes: string[],
): number {
  if (new Set(opcoes).size !== opcoes.length)
    throw new ErroPdv("Há complementos repetidos.");
  const conhecidas = new Set(
    produto.grupos.flatMap((g) => g.opcoes.map((o) => o.id)),
  );
  if (opcoes.some((id) => !conhecidas.has(id)))
    throw new ErroPdv("Complemento indisponível. Atualize o catálogo.");
  let preco = produto.precoCentavos;
  for (const grupo of produto.grupos) {
    const escolhidas = grupo.opcoes.filter((o) => opcoes.includes(o.id));
    if (escolhidas.length < grupo.minimo || escolhidas.length > grupo.maximo)
      throw new ErroPdv(`Confira as opções de ${grupo.nome}.`);
    const soma = escolhidas.reduce((s, o) => s + o.precoCentavos, 0);
    preco +=
      grupo.calculo === "MEDIA" && escolhidas.length
        ? Math.round(soma / escolhidas.length)
        : soma;
  }
  if (!Number.isSafeInteger(preco) || preco < 0 || preco > 100_000_000)
    throw new ErroPdv("Preço fora do limite permitido.");
  return preco;
}
export function calcularVenda(
  produtos: ProdutoPdv[],
  itens: ItemCarrinho[],
  descontoCentavos: number,
  taxaCentavos: number,
  pagamentos: PagamentoPdv[],
) {
  const linhas: ItemVendaPdv[] = itens.map((item) => {
    const produto = produtos.find((p) => p.id === item.produtoId);
    if (!produto)
      throw new ErroPdv("Produto indisponível. Atualize o catálogo.");
    const precoUnitarioCentavos = calcularPrecoItem(produto, item.opcoes);
    return {
      ...item,
      nome: produto.nome,
      precoUnitarioCentavos,
      totalCentavos: precoUnitarioCentavos * item.quantidade,
      complementos: produto.grupos.flatMap((g) =>
        g.opcoes
          .filter((o) => item.opcoes.includes(o.id))
          .map((o) => ({
            grupo: g.nome,
            nome: o.nome,
            precoCentavos: o.precoCentavos,
          })),
      ),
    };
  });
  const subtotalCentavos = linhas.reduce((s, l) => s + l.totalCentavos, 0);
  if (descontoCentavos > subtotalCentavos)
    throw new ErroPdv("O desconto não pode superar o subtotal.");
  const totalCentavos = subtotalCentavos - descontoCentavos + taxaCentavos;
  if (totalCentavos <= 0 || totalCentavos > 100_000_000)
    throw new ErroPdv(
      "O total da venda precisa ser maior que zero e estar dentro do limite.",
    );
  const pago = pagamentos.reduce((s, p) => s + p.valorCentavos, 0);
  const semDinheiro = pagamentos
    .filter((p) => p.forma !== "DINHEIRO")
    .reduce((s, p) => s + p.valorCentavos, 0);
  if (semDinheiro > totalCentavos)
    throw new ErroPdv("Troco só é permitido em dinheiro.");
  if (pago < totalCentavos)
    throw new ErroPdv("Ainda falta registrar parte do pagamento.");
  return {
    itens: linhas,
    subtotalCentavos,
    totalCentavos,
    trocoCentavos: pago - totalCentavos,
  };
}
