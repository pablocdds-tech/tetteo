/** Distribui centavos por maior resto, com desempate estável pela linha. */
export function ratearCentavos(brutos: number[], total: number): number[] {
  if (
    !Number.isSafeInteger(total) ||
    total < 0 ||
    brutos.some((v) => !Number.isSafeInteger(v) || v < 0)
  )
    throw new Error("Valores monetários inválidos.");
  const valores = brutos.map(BigInt),
    soma = valores.reduce((a, b) => a + b, 0n),
    alvo = BigInt(total);
  if (soma <= 0n) throw new Error("Os itens precisam ter valor.");
  const bases = valores.map((v) => (v * alvo) / soma);
  let resto = alvo - bases.reduce((a, b) => a + b, 0n);
  const ordem = valores
    .map((v, i) => ({ i, r: (v * alvo) % soma }))
    .sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (const { i } of ordem)
    if (resto > 0n) {
      bases[i]++;
      resto--;
    }
  return bases.map(Number);
}
