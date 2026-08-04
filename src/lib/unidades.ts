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

export type Unidade = "KG" | "G" | "L" | "ML" | "UN";

/**
 * Quantas unidades-base cabem em cada uma. A base de peso é o grama, a de
 * volume o mililitro, e a contagem não tem base — "un" não vira nada.
 */
const FAMILIA: Record<Unidade, { familia: string; fator: number }> = {
  KG: { familia: "peso", fator: 1000 },
  G: { familia: "peso", fator: 1 },
  L: { familia: "volume", fator: 1000 },
  ML: { familia: "volume", fator: 1 },
  UN: { familia: "contagem", fator: 1 },
};

/**
 * Converte entre unidades da MESMA família.
 *
 * Devolve `null` quando a conversão não existe — grama para unidade não é uma
 * conta, é uma pergunta sem resposta ("quantos gramas tem uma caixa?" depende
 * da caixa). Devolver zero ou o número original nesse caso seria pior: a ficha
 * técnica sairia com um custo errado e ninguém perceberia.
 *
 * É por aqui que passa o erro mais caro da ficha técnica. A mussarela é
 * comprada em KG a R$ 32, e a receita pede 200 G. Sem converter, o sistema
 * multiplicaria 200 × 32 e afirmaria que uma pizza leva R$ 6.400 de queijo.
 */
export function converter(
  quantidade: number,
  de: string,
  para: string,
): number | null {
  const origem = FAMILIA[de as Unidade];
  const destino = FAMILIA[para as Unidade];

  if (!origem || !destino) return null;
  if (origem.familia !== destino.familia) return null;

  return (quantidade * origem.fator) / destino.fator;
}

/** Se dá para converter — para avisar no formulário antes de salvar. */
export function convertivel(de: string, para: string) {
  return converter(1, de, para) !== null;
}
