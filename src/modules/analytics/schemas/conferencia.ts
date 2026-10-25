import { z } from "zod";
import { periodoVendas } from "./vendas";
export class ErroReferencia extends Error {}
export function centavosInformados(valor: string): number | null {
  const texto = valor
    .trim()
    .replace(/^R\$\s*/, "")
    .replace(/\u00a0/g, " ")
    .trim();
  if (!/^(?:\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}|\d+\.\d{2}|\d+)$/.test(texto))
    return null;
  const partes = texto.includes(",")
    ? texto.replace(/\./g, "").split(",")
    : texto.split(".");
  const total = Number(partes[0]) * 100 + Number(partes[1] ?? "0");
  return Number.isSafeInteger(total) && total >= 0 && total <= 2147483647
    ? total
    : null;
}
export const referenciaSchema = z
  .object({
    de: z.string(),
    ate: z.string(),
    total: z.string().max(32),
    versao: z.coerce.number().int().min(0),
  })
  .superRefine((v, ctx) => {
    try {
      periodoVendas(v.de, v.ate);
    } catch {
      ctx.addIssue({
        code: "custom",
        message: "Informe um período válido com até 366 dias.",
        path: ["de"],
      });
    }
    if (centavosInformados(v.total) === null)
      ctx.addIssue({
        code: "custom",
        message: "Informe um total válido, como 10.457,38.",
        path: ["total"],
      });
  });
export function conferirTotal(
  totalApi: number,
  referencia: number | null,
  incompleto: boolean,
) {
  if (referencia === null)
    return { estado: "sem_referencia" as const, diferenca: null };
  if (incompleto) return { estado: "sem_cobertura" as const, diferenca: null };
  const diferenca = totalApi - referencia;
  return {
    estado: diferenca === 0 ? ("bateu" as const) : ("divergente" as const),
    diferenca,
  };
}
export function detalharCanais(
  linhas: {
    origem: string | null;
    modalidade: number | null;
    canalImportado: boolean;
    cancelada: boolean;
    _count: { _all: number };
    _sum: { totalCentavos: number | null };
  }[],
) {
  const origens = new Map<
    string,
    { nome: string; quantidade: number; canceladas: number; centavos: number }
  >();
  const modalidades = new Map<
    string,
    { nome: string; quantidade: number; canceladas: number; centavos: number }
  >();
  const nomes: Record<number, string> = {
    1: "Entrega",
    2: "Balcão",
    3: "Salão",
    4: "Ficha",
  };
  let semDetalhamento = 0;
  for (const linha of linhas) {
    if (!linha.canalImportado && !linha.cancelada)
      semDetalhamento += linha._count._all;
    for (const [mapa, nome] of [
      [
        origens,
        linha.canalImportado
          ? linha.origem?.trim() || "Não informado"
          : "Histórico ainda sem detalhamento",
      ],
      [
        modalidades,
        linha.canalImportado
          ? (nomes[linha.modalidade ?? 0] ?? "Não informado")
          : "Histórico ainda sem detalhamento",
      ],
    ] as const) {
      const grupo = mapa.get(nome) ?? {
        nome,
        quantidade: 0,
        canceladas: 0,
        centavos: 0,
      };
      if (linha.cancelada) grupo.canceladas += linha._count._all;
      else {
        grupo.quantidade += linha._count._all;
        grupo.centavos += linha._sum.totalCentavos ?? 0;
      }
      mapa.set(nome, grupo);
    }
  }
  const ordenar = (m: typeof origens) =>
    [...m.values()].sort(
      (a, b) =>
        b.centavos - a.centavos || a.nome.localeCompare(b.nome, "pt-BR"),
    );
  return {
    origens: ordenar(origens),
    modalidades: ordenar(modalidades),
    semDetalhamento,
  };
}
