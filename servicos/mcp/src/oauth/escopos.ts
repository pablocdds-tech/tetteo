/**
 * O QUE UMA CONEXÃO PODE FAZER.
 *
 * Um escopo só, e ele é de leitura. Quando surgir uma ferramenta nova, ela
 * ganha escopo próprio — a pessoa aprova o que a IA vai poder fazer, item a
 * item, em vez de um "acesso total" que ninguém lê.
 */

export const ESCOPO_VENDAS = "vendas:ler";

export const ESCOPOS_SUPORTADOS: readonly string[] = [ESCOPO_VENDAS];

/**
 * Pedido sem escopo recebe o único que existe. Escopos desconhecidos (como
 * `offline_access`, que alguns clientes pedem por hábito) são descartados: o
 * OAuth permite conceder menos do que foi pedido, e a resposta diz o que foi
 * concedido. Só é erro quando nada do que foi pedido existe aqui.
 */
export function escoposConcedidos(pedido: string | undefined): string[] | null {
  const itens = (pedido ?? "").split(" ").filter(Boolean);
  if (itens.length === 0) return [ESCOPO_VENDAS];
  const conhecidos = [
    ...new Set(itens.filter((item) => ESCOPOS_SUPORTADOS.includes(item))),
  ];
  return conhecidos.length > 0 ? conhecidos : null;
}
