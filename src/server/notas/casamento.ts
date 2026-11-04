import { documentoFiscalValido, eanValido } from "@/lib/documento-fiscal";

export const normalizarProdutoFiscal = (v: string) =>
  v
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
type Produto = { id: string; nome: string; unidadeMedida: string };
export type VinculoFiscal = {
  insumoId: string;
  fornecedor: string;
  descricao: string;
  unidadeNota: string;
  fator: number;
  codigoFornecedor?: string | null;
  ean?: string | null;
};
export function casarProdutoFiscal(
  item: {
    descricao: string;
    unidade: string;
    codigoFornecedor?: string | null;
    ean?: string | null;
  },
  fornecedor: string,
  produtos: Produto[],
  vinculos: VinculoFiscal[],
) {
  const validos = vinculos.filter(
    (v) =>
      produtos.some((p) => p.id === v.insumoId) &&
      v.unidadeNota.trim().toUpperCase() === item.unidade.trim().toUpperCase(),
  );
  const codigo = item.codigoFornecedor?.trim();
  const porCodigo = codigo
    ? validos.filter(
        (v) => v.fornecedor === fornecedor && v.codigoFornecedor === codigo,
      )
    : [];
  const porEan =
    item.ean && eanValido(item.ean)
      ? validos.filter((v) => v.ean === item.ean)
      : [];
  // Evidências fortes contraditórias ou repetidas nunca escolhem o primeiro cadastro.
  const forte = porCodigo.length ? porCodigo : porEan;
  const ids = new Set(forte.map((v) => v.insumoId));
  const fatores = new Set(forte.map((v) => v.fator));
  const contradicao =
    porCodigo.length > 0 && porEan.some((v) => !ids.has(v.insumoId));
  if (forte.length && ids.size === 1 && fatores.size === 1 && !contradicao)
    return {
      metodo: porCodigo.length ? "CODIGO_FORNECEDOR" : "EAN",
      vinculo: forte[0],
      candidatos: [] as Produto[],
      confianca: 1,
    };
  const termos = new Set(
    normalizarProdutoFiscal(item.descricao)
      .split(" ")
      .filter((t) => t.length > 1),
  );
  const candidatos = produtos
    .map((p) => {
      const outros = new Set(
        normalizarProdutoFiscal(p.nome)
          .split(" ")
          .filter((t) => t.length > 1),
      );
      const uniao = new Set([...termos, ...outros]);
      return {
        p,
        score: uniao.size
          ? [...termos].filter((t) => outros.has(t)).length / uniao.size
          : 0,
      };
    })
    .filter((v) => v.score > 0)
    .sort((a, b) => b.score - a.score || a.p.nome.localeCompare(b.p.nome));
  return {
    metodo: forte.length ? "AMBIGUO" : "DESCRICAO",
    vinculo: null,
    candidatos: candidatos.slice(0, 8).map((v) => v.p),
    confianca: candidatos[0]?.score ?? 0,
  };
}

export function casarFornecedorFiscal(
  documento: string | undefined,
  nome: string,
  candidatos: {
    id: string;
    nome: string;
    documento: string | null;
    ativo: boolean;
  }[],
) {
  const normalizar = (v: string | null) => v?.replace(/\D/g, "") ?? "";
  if (documento) {
    if (!documentoFiscalValido(documento))
      return { estado: "INVALIDO" as const, id: null };
    const encontrados = candidatos.filter(
      (c) => normalizar(c.documento) === documento,
    );
    if (encontrados.length > 1) return { estado: "AMBIGUO" as const, id: null };
    if (encontrados.length)
      return {
        estado: encontrados[0].ativo
          ? ("EXISTENTE" as const)
          : ("INATIVO" as const),
        id: encontrados[0].id,
      };
    // Nome igual com outro documento é uma pendência de identidade, não um vínculo.
    if (
      candidatos.some(
        (c) =>
          normalizarProdutoFiscal(c.nome) === normalizarProdutoFiscal(nome),
      )
    )
      return { estado: "DIVERGENTE" as const, id: null };
    return { estado: "NOVO" as const, id: null };
  }
  return { estado: "SEM_DOCUMENTO" as const, id: null };
}
