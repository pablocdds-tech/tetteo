import type { ContextoSessao } from "@/core/sessao/nucleo";
import { db } from "@/server/db";
import type { PreparacaoPdv } from "../preparacao-types";
import { ErroPdv } from "../schemas/erro";
import { diagnosticarProdutoPreparacao } from "../schemas/preparacao";
import { exigirEscopo } from "./pdv";

/** Diagnóstico administrativo somente leitura; não cria fichas, saldos ou caixa. */
export async function obterPreparacaoPdv(
  ctx: ContextoSessao,
  localId?: string,
): Promise<PreparacaoPdv> {
  const escopo = await exigirEscopo(ctx, "pdv.configurar");
  if (
    localId !== undefined &&
    (typeof localId !== "string" || !localId.trim() || localId.length > 100)
  )
    throw new ErroPdv("Escolha um local de estoque ativo desta unidade.");
  const [fichas, configuracoes, insumos, locais, caixa] = await Promise.all([
    db.fichaTecnica.findMany({
      where: { organizacaoId: escopo.organizacaoId, excluidoEm: null },
      include: { itens: true },
      orderBy: [{ categoria: "asc" }, { nome: "asc" }],
    }),
    db.pdvProduto.findMany({ where: { organizacaoId: escopo.organizacaoId } }),
    db.insumo.findMany({
      where: {
        organizacaoId: escopo.organizacaoId,
        ativo: true,
        excluidoEm: null,
      },
      select: { id: true, nome: true, unidadeMedida: true, custoMedio: true },
    }),
    db.localEstoque.findMany({
      where: { unidadeId: escopo.unidadeId, ativo: true },
      select: { id: true, nome: true },
      orderBy: { nome: "asc" },
    }),
    db.pdvCaixa.findFirst({
      where: { ...escopo, fechadoEm: null },
      select: { localEstoqueId: true },
    }),
  ]);
  const local =
    localId !== undefined
      ? locais.find((l) => l.id === localId.trim())
      : caixa
        ? locais.find((l) => l.id === caixa.localEstoqueId)
        : locais[0];
  if (localId !== undefined && !local)
    throw new ErroPdv("Escolha um local de estoque ativo desta unidade.");
  const posicoes = local
    ? await db.posicaoEstoque.findMany({
        where: { unidadeId: escopo.unidadeId, localId: local.id },
        select: { insumoId: true, quantidade: true },
      })
    : [];
  const saldos = local
    ? new Map(posicoes.map((p) => [p.insumoId, Number(p.quantidade)]))
    : null;
  const receitas = fichas.map((f) => ({
    id: f.id,
    nome: f.nome,
    rendimento: Number(f.rendimento),
    unidadeRendimento: f.unidadeRendimento,
    itens: f.itens.map((i) => ({
      insumoId: i.insumoId,
      subFichaId: i.subFichaId,
      quantidade: Number(i.quantidade),
      unidade: i.unidade,
      perdaPercentual: Number(i.perdaPercentual),
    })),
  }));
  const idsAtivos = new Set(fichas.filter((f) => f.ativo).map((f) => f.id));
  const receitasAtivas = receitas.filter((f) => idsAtivos.has(f.id));
  const insumosAtivos = insumos.map((i) => ({
    id: i.id,
    nome: i.nome,
    unidadeMedida: i.unidadeMedida,
    custoUnitario: i.custoMedio.toString(),
  }));
  const configs = new Map(configuracoes.map((c) => [c.fichaId, c]));
  const receitasPorId = new Map(receitas.map((f) => [f.id, f]));
  const produtos = fichas
    .filter((f) => f.tipo === "PRATO")
    .map((f) =>
      diagnosticarProdutoPreparacao(
        {
          ...receitasPorId.get(f.id)!,
          ativo: f.ativo,
          categoria: f.categoria,
          precoCentavos:
            f.precoVenda === null
              ? null
              : Number(f.precoVenda.mul(100).toFixed(0)),
        },
        configs.get(f.id),
        receitasAtivas,
        insumosAtivos,
        saldos,
      ),
    );
  const contadores = {
    produtos: produtos.length,
    prontos: produtos.filter((p) => p.pronto).length,
    bloqueados: produtos.filter((p) => !p.pronto).length,
    alertasEstoque: produtos.filter((p) =>
      p.pendencias.some((a) => a.nivel === "ESTOQUE"),
    ).length,
    avisos: produtos.filter((p) =>
      p.pendencias.some((a) => a.nivel === "AVISO"),
    ).length,
  };
  const comPendencia = (codigos: string[]) =>
    produtos.some((p) =>
      p.pendencias.some(
        (a) =>
          a.nivel === "BLOQUEIO" && codigos.some((c) => a.codigo.startsWith(c)),
      ),
    );
  return {
    unidadeId: escopo.unidadeId,
    unidadeNome: ctx.unidadeAtiva!.nome,
    localId: local?.id ?? null,
    localNome: local?.nome ?? null,
    caixaAberto: caixa !== null,
    locais,
    produtos,
    contadores,
    etapas: [
      {
        id: "produtos",
        titulo: "Produtos e preços",
        descricao: `${contadores.produtos} produtos cadastrados; ${contadores.bloqueados} com pendências de cadastro.`,
        status:
          !produtos.length || comPendencia(["produto_inativo", "preco_"])
            ? "PENDENTE"
            : "OK",
        href: "/cardapio/fichas",
        acao: "Revisar fichas",
      },
      {
        id: "receitas",
        titulo: "Receitas e consumo",
        descricao:
          "Receitas, rendimentos, conversões e referências ativas conferidos para a base e os complementos vinculados.",
        status: comPendencia(["receita_", "consumo_ausente"])
          ? "PENDENTE"
          : !produtos.length
            ? "ATENCAO"
            : "OK",
        href: "/cardapio/fichas",
        acao: "Revisar receitas",
      },
      {
        id: "complementos",
        titulo: "Códigos e complementos",
        descricao:
          "Códigos ausentes e opções sem ficha são avisos; não bloqueiam por si só a venda.",
        status: comPendencia(["complementos_"])
          ? "PENDENTE"
          : contadores.avisos
            ? "ATENCAO"
            : "OK",
        href: "/pdv/catalogo",
        acao: "Configurar catálogo",
      },
      {
        id: "estoque",
        titulo: "Local e saldos",
        descricao: !local
          ? caixa
            ? "O local do caixa aberto não está ativo. Revise o local antes de vender."
            : "Cadastre um local de estoque ativo para conferir os saldos."
          : "Saldos atuais do local escolhido; os complementos e a quantidade final alteram o consumo. A venda verifica a combinação completa.",
        status: !local
          ? "PENDENTE"
          : contadores.alertasEstoque
            ? "ATENCAO"
            : "OK",
        href: "/estoque",
        acao: "Conferir estoque",
      },
      {
        id: "caixa",
        titulo: "Caixa",
        descricao: caixa
          ? "Existe um caixa aberto nesta unidade."
          : "Abra o caixa e escolha o local de saída de estoque antes de vender.",
        status: caixa ? "OK" : "PENDENTE",
        href: "/pdv/caixa",
        acao: "Ver caixa",
      },
    ],
  };
}
