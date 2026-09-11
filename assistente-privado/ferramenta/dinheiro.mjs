/**
 * O DINHEIRO DA FERRAMENTA.
 *
 * Soma de dinheiro é soma de INTEIROS: centavos. Ponto flutuante nunca entra
 * na conta — 0,1 + 0,2 não dá 0,3, e um fechamento que erra um centavo por
 * arredondamento é um fechamento em que ninguém confia.
 */

const formatador = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

/** 482305 → "R$ 4.823,05" (o espaço não separável do Intl vira espaço comum). */
export function reais(centavos) {
  return formatador.format(centavos / 100).replace(/\u00a0/g, " ");
}

/**
 * "1.234,56" · "1234,56" · "1234.56" · "R$ 1.234,56" · "-80.00" → centavos.
 * Qualquer outra forma → null.
 *
 * Sem vírgula, o ponto só é decimal com 1 ou 2 casas ("12.50"); com 3 casas
 * ele é milhar ("1.234" = mil duzentos e trinta e quatro reais).
 */
export function lerCentavos(texto) {
  let t = String(texto ?? "")
    .replace(/R\$/gi, "")
    .replace(/\s/g, "");
  if (!t) return null;

  const negativo = t.startsWith("-");
  if (negativo) t = t.slice(1);

  let inteiro;
  let fracao = "";
  let r;
  if ((r = /^(\d{1,3}(?:\.\d{3})+|\d+),(\d{1,2})$/.exec(t))) {
    inteiro = r[1].replace(/\./g, "");
    fracao = r[2];
  } else if ((r = /^(\d+)\.(\d{1,2})$/.exec(t))) {
    inteiro = r[1];
    fracao = r[2];
  } else if (/^\d{1,3}(?:\.\d{3})+$/.test(t)) {
    inteiro = t.replace(/\./g, "");
  } else if (/^\d+$/.test(t)) {
    inteiro = t;
  } else {
    return null;
  }

  const centavos = Number(inteiro) * 100 + Number(fracao.padEnd(2, "0"));
  if (!Number.isSafeInteger(centavos)) return null;
  return negativo ? -centavos : centavos;
}
