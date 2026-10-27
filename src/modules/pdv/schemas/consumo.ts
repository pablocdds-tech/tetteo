import { converter } from "@/lib/unidades";
import { ErroPdv } from "./erro";

export type ReceitaPdv = {
  id: string;
  nome: string;
  rendimento: number;
  unidadeRendimento: string;
  itens: {
    insumoId: string | null;
    subFichaId: string | null;
    quantidade: number;
    unidade: string;
    perdaPercentual: number;
  }[];
};
export type InsumoPdv = {
  id: string;
  nome: string;
  unidadeMedida: string;
  custoUnitario: string;
};
export type ConsumoPdv = {
  insumoId: string;
  nome: string;
  quantidade: string;
  custoUnitario: string;
};

/** Consumo de uma unidade vendida, com rendimento, conversão e perdas da receita. */
export function calcularConsumo(
  entradas: { fichaId: string; quantidade: number }[],
  receitas: ReceitaPdv[],
  insumos: InsumoPdv[],
): ConsumoPdv[] {
  const fichas = new Map(receitas.map((f) => [f.id, f]));
  const ingredientes = new Map(insumos.map((i) => [i.id, i]));
  const totais = new Map<string, number>();
  function visitar(id: string, quantidade: number, caminho: string[]) {
    const ficha = fichas.get(id);
    if (!ficha || ficha.rendimento <= 0)
      throw new ErroPdv("Ficha técnica indisponível ou sem rendimento válido.");
    if (caminho.includes(id) || caminho.length >= 10)
      throw new ErroPdv(
        `Confira a receita de ${ficha.nome}: ciclo ou profundidade excessiva.`,
      );
    for (const item of ficha.itens) {
      if (
        item.quantidade <= 0 ||
        item.perdaPercentual < 0 ||
        item.perdaPercentual >= 100
      )
        throw new ErroPdv(
          `Confira as quantidades e perdas da ficha ${ficha.nome}.`,
        );
      const bruto =
        (item.quantidade * quantidade) /
        ficha.rendimento /
        (1 - item.perdaPercentual / 100);
      if (item.insumoId && !item.subFichaId) {
        const insumo = ingredientes.get(item.insumoId);
        if (!insumo)
          throw new ErroPdv(
            `A ficha ${ficha.nome} utiliza um insumo indisponível.`,
          );
        const convertido = converter(bruto, item.unidade, insumo.unidadeMedida);
        if (convertido === null)
          throw new ErroPdv(`Confira as unidades da ficha ${ficha.nome}.`);
        totais.set(insumo.id, (totais.get(insumo.id) ?? 0) + convertido);
      } else if (item.subFichaId && !item.insumoId) {
        const sub = fichas.get(item.subFichaId);
        if (!sub)
          throw new ErroPdv(
            `A ficha ${ficha.nome} utiliza um preparo indisponível.`,
          );
        const convertido = converter(
          bruto,
          item.unidade,
          sub.unidadeRendimento,
        );
        if (convertido === null)
          throw new ErroPdv(`Confira a unidade do preparo ${sub.nome}.`);
        visitar(sub.id, convertido, [...caminho, id]);
      } else
        throw new ErroPdv(`Confira os ingredientes da ficha ${ficha.nome}.`);
    }
  }
  for (const entrada of entradas)
    visitar(entrada.fichaId, entrada.quantidade, []);
  return [...totais].map(([id, quantidade]) => {
    if (!Number.isFinite(quantidade) || quantidade > 100_000_000)
      throw new ErroPdv("Consumo fora do limite permitido.");
    const insumo = ingredientes.get(id)!;
    // O estoque guarda milésimos; acumular antes de arredondar evita perder frações por linha.
    const arredondada = Math.round(quantidade * 1000) / 1000;
    if (arredondada <= 0)
      throw new ErroPdv(
        `Consumo de ${insumo.nome} abaixo da precisão do estoque. Revise a receita.`,
      );
    return {
      insumoId: id,
      nome: insumo.nome,
      quantidade: arredondada.toFixed(3),
      custoUnitario: insumo.custoUnitario,
    };
  });
}
