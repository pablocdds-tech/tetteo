/**
 * As siglas das unidades de medida.
 *
 * Mora em `lib` porque Cardápio, Estoque e Compras escrevem "kg" do mesmo
 * jeito. O valor guardado no banco é o código (`KG`); o que a pessoa lê é a
 * sigla — e ela nunca deve aparecer em caixa alta no meio de uma frase.
 */
export const SIGLA_UNIDADE: Record<string, string> = {
  KG: "kg",
  G: "g",
  L: "L",
  ML: "ml",
  UN: "un",
};

export function sigla(codigo: string) {
  return SIGLA_UNIDADE[codigo] ?? codigo.toLowerCase();
}
