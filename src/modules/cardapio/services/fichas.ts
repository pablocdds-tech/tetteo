import { pode, type ContextoSessao } from "@/core/sessao/contexto";
import { SemPermissao } from "@/lib/erros";
import { db } from "@/server/db";

import {
  calcularCusto,
  type CustoDaFicha,
  type FichaParaCusto,
  type InsumoParaCusto,
} from "../schemas/custo";
import {
  lerAlvo,
  type DadosFicha,
  type DadosItemDeFicha,
} from "../schemas/ficha";

/**
 * AS FICHAS TÉCNICAS.
 *
 * Componente não calcula — a conta mora em `schemas/custo`, pura e testada.
 * Este arquivo só busca os dados, monta os dois mapas que a conta pede e
 * grava o que foi editado.
 *
 * Nada aqui congela custo, e é de propósito. A ficha responde "quanto custa
 * HOJE": ela não é registro histórico, é a receita vigente. O congelamento
 * acontece do outro lado — na contagem de estoque e, um dia, na venda.
 */

/**
 * Carrega TODAS as fichas da rede de uma vez.
 *
 * Parece exagero para custear uma pizza, e é a decisão certa: a receita desce
 * por sub-receitas de profundidade desconhecida, e buscar cada preparo sob
 * demanda faria uma consulta por nível, por linha — o problema N+1 clássico,
 * dentro de uma recursão. Uma pizzaria tem dezenas de fichas, não milhões.
 */
async function carregarUniverso(contexto: ContextoSessao) {
  const [fichas, insumos] = await Promise.all([
    db.fichaTecnica.findMany({
      where: { organizacaoId: contexto.organizacao.id, excluidoEm: null },
      include: { itens: { orderBy: { ordem: "asc" } } },
    }),
    db.insumo.findMany({
      where: { organizacaoId: contexto.organizacao.id, excluidoEm: null },
      select: {
        id: true,
        nome: true,
        unidadeMedida: true,
        custoMedio: true,
        custoUltimo: true,
      },
    }),
  ]);

  const mapaFichas = new Map<string, FichaParaCusto>(
    fichas.map((f) => [
      f.id,
      {
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
          observacao: i.observacao,
        })),
      },
    ]),
  );

  /**
   * Dois mapas de insumo, um por pergunta.
   *
   * O custo MÉDIO responde "quanto custou o que já consumi"; o da ÚLTIMA
   * compra responde "quanto custa repor hoje". Num período de alta os dois
   * divergem bastante, e a ficha mostra os dois lado a lado em vez de escolher
   * um escondido — que é o jeito de o sistema errar sem ninguém notar.
   */
  const porMedio = new Map<string, InsumoParaCusto>();
  const porUltimo = new Map<string, InsumoParaCusto>();

  for (const i of insumos) {
    porMedio.set(i.id, {
      id: i.id,
      nome: i.nome,
      unidadeMedida: i.unidadeMedida,
      custo: Number(i.custoMedio),
    });
    porUltimo.set(i.id, {
      id: i.id,
      nome: i.nome,
      unidadeMedida: i.unidadeMedida,
      // Insumo sem compra registrada cai na média — melhor do que zerar a
      // linha e afirmar que o prato ficou mais barato.
      custo:
        Number(i.custoUltimo) > 0
          ? Number(i.custoUltimo)
          : Number(i.custoMedio),
    });
  }

  return { fichas, mapaFichas, porMedio, porUltimo };
}

export type FichaNaLista = {
  id: string;
  nome: string;
  categoria: string | null;
  tipo: "PRATO" | "PREPARO";
  ativo: boolean;
  itens: number;
  rendimento: number;
  unidadeRendimento: "KG" | "G" | "L" | "ML" | "UN";
  precoVenda: number | null;
  custoUnitario: number;
  linhasComProblema: number;
};

export async function listarFichas(
  contexto: ContextoSessao,
): Promise<FichaNaLista[]> {
  if (!pode(contexto, "cardapio.ver")) throw new SemPermissao("ver o cardápio");

  const { fichas, mapaFichas, porMedio } = await carregarUniverso(contexto);

  return fichas
    .map((f) => {
      const custo = calcularCusto(f.id, mapaFichas, porMedio);
      return {
        id: f.id,
        nome: f.nome,
        categoria: f.categoria,
        tipo: f.tipo,
        ativo: f.ativo,
        itens: f.itens.length,
        rendimento: Number(f.rendimento),
        unidadeRendimento: f.unidadeRendimento,
        precoVenda: f.precoVenda === null ? null : Number(f.precoVenda),
        custoUnitario: custo.custoUnitario,
        linhasComProblema: custo.linhasComProblema,
      };
    })
    .sort(
      (a, b) =>
        Number(b.ativo) - Number(a.ativo) || a.nome.localeCompare(b.nome),
    );
}

export type FichaCompleta = {
  id: string;
  nome: string;
  categoria: string | null;
  tipo: "PRATO" | "PREPARO";
  modoDePreparo: string | null;
  rendimento: number;
  unidadeRendimento: "KG" | "G" | "L" | "ML" | "UN";
  precoVenda: number | null;
  ativo: boolean;
  itens: {
    id: string;
    insumoId: string | null;
    subFichaId: string | null;
    quantidade: number;
    unidade: "KG" | "G" | "L" | "ML" | "UN";
    perdaPercentual: number;
    observacao: string | null;
  }[];
  /** Quem usa esta ficha como ingrediente. */
  usadaEm: { id: string; nome: string }[];
  custoMedio: CustoDaFicha;
  custoUltimo: CustoDaFicha;
};

export async function obterFicha(
  contexto: ContextoSessao,
  id: string,
): Promise<FichaCompleta | null> {
  if (!pode(contexto, "cardapio.ver")) throw new SemPermissao("ver o cardápio");

  const { fichas, mapaFichas, porMedio, porUltimo } =
    await carregarUniverso(contexto);

  const ficha = fichas.find((f) => f.id === id);
  if (!ficha) return null;

  // Quem me usa: varre o universo já carregado em vez de outra consulta.
  const usadaEm = fichas
    .filter((f) => f.itens.some((i) => i.subFichaId === id))
    .map((f) => ({ id: f.id, nome: f.nome }))
    .sort((a, b) => a.nome.localeCompare(b.nome));

  return {
    id: ficha.id,
    nome: ficha.nome,
    categoria: ficha.categoria,
    tipo: ficha.tipo,
    modoDePreparo: ficha.modoDePreparo,
    rendimento: Number(ficha.rendimento),
    unidadeRendimento: ficha.unidadeRendimento,
    precoVenda: ficha.precoVenda === null ? null : Number(ficha.precoVenda),
    ativo: ficha.ativo,
    itens: ficha.itens.map((i) => ({
      id: i.id,
      insumoId: i.insumoId,
      subFichaId: i.subFichaId,
      quantidade: Number(i.quantidade),
      unidade: i.unidade,
      perdaPercentual: Number(i.perdaPercentual),
      observacao: i.observacao,
    })),
    usadaEm,
    custoMedio: calcularCusto(id, mapaFichas, porMedio),
    custoUltimo: calcularCusto(id, mapaFichas, porUltimo),
  };
}

/**
 * O que pode entrar numa receita: os insumos e as OUTRAS fichas.
 *
 * A própria ficha é excluída da lista. Não fecha a porta para o ciclo
 * indireto — A usa B que usa A ainda é possível de montar, e a conta avisa
 * quando acontece — mas tira da tela o erro mais bobo, que é escolher a si
 * mesma sem perceber.
 */
export async function opcoesDeItem(contexto: ContextoSessao, fichaId?: string) {
  if (!pode(contexto, "cardapio.ver")) throw new SemPermissao("ver o cardápio");

  const [insumos, fichas] = await Promise.all([
    db.insumo.findMany({
      where: {
        organizacaoId: contexto.organizacao.id,
        excluidoEm: null,
        ativo: true,
      },
      select: { id: true, nome: true, unidadeMedida: true },
      orderBy: { nome: "asc" },
    }),
    db.fichaTecnica.findMany({
      where: {
        organizacaoId: contexto.organizacao.id,
        excluidoEm: null,
        ativo: true,
        ...(fichaId ? { id: { not: fichaId } } : {}),
      },
      select: {
        id: true,
        nome: true,
        tipo: true,
        unidadeRendimento: true,
      },
      orderBy: { nome: "asc" },
    }),
  ]);

  return { insumos, fichas };
}

export async function criarFicha(contexto: ContextoSessao, dados: DadosFicha) {
  if (!pode(contexto, "cardapio.editar")) {
    throw new SemPermissao("cadastrar fichas técnicas");
  }

  const ficha = await db.fichaTecnica.create({
    data: {
      organizacaoId: contexto.organizacao.id,
      nome: dados.nome,
      categoria: dados.categoria,
      tipo: dados.tipo,
      modoDePreparo: dados.modoDePreparo,
      rendimento: dados.rendimento,
      unidadeRendimento: dados.unidadeRendimento,
      // Preparo não se vende. Guardar preço nele seria um campo que mente.
      precoVenda: dados.tipo === "PRATO" ? dados.precoVenda : null,
      criadoPorId: contexto.usuario.id,
      atualizadoPorId: contexto.usuario.id,
    },
  });

  await registrar(contexto, "CRIOU", ficha.id, null, { nome: dados.nome });
  return ficha;
}

export async function atualizarFicha(
  contexto: ContextoSessao,
  id: string,
  dados: DadosFicha,
) {
  if (!pode(contexto, "cardapio.editar")) {
    throw new SemPermissao("alterar fichas técnicas");
  }

  const antes = await exigirFicha(contexto, id);

  await db.fichaTecnica.update({
    where: { id },
    data: {
      nome: dados.nome,
      categoria: dados.categoria,
      tipo: dados.tipo,
      modoDePreparo: dados.modoDePreparo,
      rendimento: dados.rendimento,
      unidadeRendimento: dados.unidadeRendimento,
      precoVenda: dados.tipo === "PRATO" ? dados.precoVenda : null,
      atualizadoPorId: contexto.usuario.id,
    },
  });

  await registrar(
    contexto,
    "ALTEROU",
    id,
    {
      nome: antes.nome,
      tipo: antes.tipo,
      rendimento: antes.rendimento.toString(),
      precoVenda: antes.precoVenda?.toString() ?? null,
    },
    {
      nome: dados.nome,
      tipo: dados.tipo,
      rendimento: dados.rendimento,
      precoVenda: dados.precoVenda,
    },
  );
}

export async function alternarFicha(contexto: ContextoSessao, id: string) {
  if (!pode(contexto, "cardapio.editar")) {
    throw new SemPermissao("alterar fichas técnicas");
  }

  const ficha = await exigirFicha(contexto, id);

  await db.fichaTecnica.update({
    where: { id },
    data: { ativo: !ficha.ativo, atualizadoPorId: contexto.usuario.id },
  });

  await registrar(
    contexto,
    "ALTEROU",
    id,
    { ativo: ficha.ativo },
    { ativo: !ficha.ativo },
  );
}

export async function excluirFicha(contexto: ContextoSessao, id: string) {
  if (!pode(contexto, "cardapio.excluir")) {
    throw new SemPermissao("excluir fichas técnicas");
  }

  const ficha = await exigirFicha(contexto, id);

  // Apagar um preparo que outras receitas usam deixaria aquelas fichas com uma
  // linha órfã e um custo silenciosamente menor. O sistema recusa e diz quem
  // depende dele — quem decide o que fazer é a pessoa.
  const dependentes = await db.itemDeFicha.findMany({
    where: { subFichaId: id },
    select: { ficha: { select: { nome: true } } },
  });

  if (dependentes.length > 0) {
    const nomes = [...new Set(dependentes.map((d) => d.ficha.nome))];
    throw new Error(
      `Este preparo é usado em ${nomes.length === 1 ? "" : `${nomes.length} fichas: `}${nomes.slice(0, 5).join(", ")}${nomes.length > 5 ? "…" : ""}. Tire-o dessas receitas antes de excluir.`,
    );
  }

  await db.fichaTecnica.update({
    where: { id },
    data: { excluidoEm: new Date(), atualizadoPorId: contexto.usuario.id },
  });

  await registrar(contexto, "EXCLUIU", id, { nome: ficha.nome }, null);
}

// ---------------------------------------------------------------------------
// AS LINHAS DA RECEITA
// ---------------------------------------------------------------------------

async function exigirFicha(contexto: ContextoSessao, id: string) {
  const ficha = await db.fichaTecnica.findFirst({
    where: { id, organizacaoId: contexto.organizacao.id, excluidoEm: null },
  });
  if (!ficha) throw new Error("Ficha técnica não encontrada.");
  return ficha;
}

export async function adicionarItem(
  contexto: ContextoSessao,
  fichaId: string,
  dados: DadosItemDeFicha,
) {
  if (!pode(contexto, "cardapio.editar")) {
    throw new SemPermissao("alterar fichas técnicas");
  }
  await exigirFicha(contexto, fichaId);

  const { insumoId, subFichaId } = lerAlvo(dados.alvo);

  // O alvo vem de um <select>, mas nada impede um formulário adulterado de
  // mandar o id de outra rede. A conferência é do lado do servidor, sempre.
  if (insumoId) {
    const existe = await db.insumo.count({
      where: {
        id: insumoId,
        organizacaoId: contexto.organizacao.id,
        excluidoEm: null,
      },
    });
    if (!existe) throw new Error("Insumo não encontrado.");
  } else if (subFichaId) {
    if (subFichaId === fichaId) {
      throw new Error("Uma ficha não pode usar a si mesma.");
    }
    const existe = await db.fichaTecnica.count({
      where: {
        id: subFichaId,
        organizacaoId: contexto.organizacao.id,
        excluidoEm: null,
      },
    });
    if (!existe) throw new Error("Preparo não encontrado.");
  }

  const ultimo = await db.itemDeFicha.findFirst({
    where: { fichaId },
    orderBy: { ordem: "desc" },
    select: { ordem: true },
  });

  return db.itemDeFicha.create({
    data: {
      fichaId,
      insumoId,
      subFichaId,
      quantidade: dados.quantidade,
      unidade: dados.unidade,
      perdaPercentual: dados.perdaPercentual,
      observacao: dados.observacao,
      ordem: (ultimo?.ordem ?? -1) + 1,
    },
  });
}

export async function removerItem(
  contexto: ContextoSessao,
  fichaId: string,
  itemId: string,
) {
  if (!pode(contexto, "cardapio.editar")) {
    throw new SemPermissao("alterar fichas técnicas");
  }
  await exigirFicha(contexto, fichaId);

  await db.itemDeFicha.deleteMany({ where: { id: itemId, fichaId } });
}

async function registrar(
  contexto: ContextoSessao,
  acao: "CRIOU" | "ALTEROU" | "EXCLUIU",
  entidadeId: string,
  antes: unknown,
  depois: unknown,
) {
  await db.auditoria.create({
    data: {
      organizacaoId: contexto.organizacao.id,
      unidadeId: contexto.unidadeAtiva?.id ?? null,
      usuarioId: contexto.usuario.id,
      entidade: "FichaTecnica",
      entidadeId,
      acao,
      valoresAntes:
        antes === null ? undefined : JSON.parse(JSON.stringify(antes)),
      valoresDepois:
        depois === null ? undefined : JSON.parse(JSON.stringify(depois)),
    },
  });
}
