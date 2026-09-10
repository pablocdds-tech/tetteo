import { pode, type ContextoSessao } from "@/core/sessao/contexto";
import { SemPermissao } from "@/lib/erros";
import { db } from "@/server/db";

import { exigirUnidade } from "./contagens";

/**
 * A DESPENSA.
 *
 * Uma linha por INSUMO — não por prateleira. É a diferença entre as duas
 * perguntas que o estoque responde:
 *
 *   "quanto de mussarela tem nesta loja?"     → esta tela
 *   "quanto de mussarela tem na câmara fria?" → a Posição, por lugar
 *
 * Quem vai comprar faz a primeira. Somar os lugares na hora de decidir a
 * compra evita o erro clássico de pedir mussarela porque a geladeira da frente
 * está vazia enquanto há uma caixa fechada no depósito.
 *
 * ---------------------------------------------------------------------------
 * O QUE ESTA FUNÇÃO NÃO FAZ.
 *
 * Ela não inventa cálculo. O saldo é a SOMA das posições que o Estoque já
 * mantém; o custo médio vem do cadastro do insumo, do jeito que o resto do
 * sistema já o lê. Nenhuma regra nova de CMV, de custo ou de arredondamento
 * nasce aqui — se nascesse, dois lugares do sistema passariam a responder
 * números diferentes para a mesma pergunta.
 * ---------------------------------------------------------------------------
 *
 * AS TRÊS UNIDADES, QUE NÃO SÃO A MESMA COISA.
 *
 *   contagem   o que se conta na prateleira      — `unidadeMedida` (+ rótulo)
 *   compra     como o fornecedor vende           — `EmbalagemCompra.fator`
 *   disponível o saldo, sempre na de contagem    — a soma abaixo
 *
 * A embalagem só aparece quando ESTÁ CADASTRADA. Sem o fator, "2 caixas" não
 * vira quilo — é uma pergunta sem resposta ("quantos quilos tem a caixa?"
 * depende da caixa), e chutar transformaria uma compra em outra.
 */

export type SituacaoDoItem =
  "repor" | "saudavel" | "sem-minimo" | "nunca-contado";

export type ItemDaDespensa = {
  insumoId: string;
  nome: string;
  categoria: string | null;
  /** A unidade de CONTAGEM, como a cozinha a chama ("cx" só se for o rótulo). */
  unidade: string;
  unidadeMedida: string;

  /**
   * `null` quando o insumo nunca teve posição nesta unidade.
   *
   * Vazio NÃO é zero. Zero é um fato ("acabou"); ausência é outro ("ninguém
   * contou ainda"). Escrever 0 aqui faria a tela afirmar que a câmara fria
   * está vazia, e alguém compraria em cima disso.
   */
  disponivel: number | null;

  /** `null` quando não há mínimo cadastrado. Nunca 0 disfarçado de mínimo. */
  minimo: number | null;

  situacao: SituacaoDoItem;

  /**
   * Quanto falta para chegar ao mínimo. Só existe quando os DOIS números
   * existem — é o que a lista de compras usa como sugestão, e ela precisa
   * poder dizer de onde veio.
   */
  sugestao: number | null;

  custoMedio: number;
  custoUltimo: number;
  /** `null` quando não há saldo conhecido: sem quantidade não há valor. */
  valor: number | null;

  /** As embalagens de COMPRA cadastradas. Vazio quando não há nenhuma. */
  embalagens: { id: string; nome: string; fator: number; padrao: boolean }[];

  /** O detalhe por prateleira, para o painel lateral. */
  porLocal: {
    localId: string;
    local: string;
    quantidade: number;
    /** O mínimo DAQUELE lugar; `null` cai no mínimo geral do insumo. */
    minimo: number | null;
    faltando: boolean;
    atualizadoEm: Date;
  }[];

  /** Quando a posição mais recente deste insumo mudou. `null` se nunca. */
  atualizadoEm: Date | null;
};

/** A ordem do trabalho: primeiro o que falta, depois o que não se sabe. */
const PESO_DA_SITUACAO: Record<SituacaoDoItem, number> = {
  repor: 0,
  "nunca-contado": 1,
  "sem-minimo": 2,
  saudavel: 3,
};

export async function listarDespensa(contexto: ContextoSessao) {
  if (!pode(contexto, "estoque.ver")) throw new SemPermissao("ver o estoque");
  const unidade = exigirUnidade(contexto);

  // O catálogo é da ORGANIZAÇÃO e o saldo é da UNIDADE — por isso são duas
  // consultas e não um include. Um insumo cadastrado e nunca recebido nesta
  // loja precisa APARECER na lista, como desconhecido; um `include` a partir
  // da posição o esconderia, e ninguém compraria o que não vê.
  const [insumos, posicoes, ultimaContagem] = await Promise.all([
    db.insumo.findMany({
      where: {
        organizacaoId: contexto.organizacao.id,
        excluidoEm: null,
        ativo: true,
      },
      select: {
        id: true,
        nome: true,
        categoria: true,
        unidadeMedida: true,
        unidadeRotulo: true,
        custoMedio: true,
        custoUltimo: true,
        estoqueMinimo: true,
        embalagens: {
          where: { ativo: true },
          select: { id: true, nome: true, fator: true, padrao: true },
          orderBy: [{ padrao: "desc" }, { nome: "asc" }],
        },
      },
      orderBy: { nome: "asc" },
    }),

    db.posicaoEstoque.findMany({
      where: { unidadeId: unidade.id },
      include: { local: { select: { id: true, nome: true } } },
    }),

    db.contagem.findFirst({
      where: { unidadeId: unidade.id, status: "FECHADA", canceladaEm: null },
      orderBy: { referencia: "desc" },
      select: { referencia: true, descricao: true },
    }),
  ]);

  const porInsumo = new Map<string, typeof posicoes>();
  for (const p of posicoes) {
    const lista = porInsumo.get(p.insumoId);
    if (lista) lista.push(p);
    else porInsumo.set(p.insumoId, [p]);
  }

  const itens: ItemDaDespensa[] = insumos.map((insumo) => {
    const suas = porInsumo.get(insumo.id) ?? [];
    const custoMedio = Number(insumo.custoMedio);

    const minimoGeral = Number(insumo.estoqueMinimo);
    const minimo = minimoGeral > 0 ? minimoGeral : null;

    // Nunca teve posição nesta loja: o saldo é DESCONHECIDO, não zero.
    const disponivel =
      suas.length === 0
        ? null
        : suas.reduce((soma, p) => soma + Number(p.quantidade), 0);

    const situacao: SituacaoDoItem =
      disponivel === null
        ? "nunca-contado"
        : minimo === null
          ? "sem-minimo"
          : disponivel < minimo
            ? "repor"
            : "saudavel";

    return {
      insumoId: insumo.id,
      nome: insumo.nome,
      categoria: insumo.categoria,
      unidade: insumo.unidadeRotulo ?? insumo.unidadeMedida,
      unidadeMedida: insumo.unidadeMedida,
      disponivel,
      minimo,
      situacao,
      sugestao:
        situacao === "repor" && minimo !== null && disponivel !== null
          ? Math.round((minimo - disponivel) * 1000) / 1000
          : null,
      custoMedio,
      custoUltimo: Number(insumo.custoUltimo),
      // O mesmo arredondamento por linha que a Posição já usa, para os dois
      // totais baterem com a soma que alguém faria na calculadora.
      valor:
        disponivel === null
          ? null
          : Math.round(disponivel * custoMedio * 100) / 100,
      embalagens: insumo.embalagens.map((e) => ({
        id: e.id,
        nome: e.nome,
        fator: Number(e.fator),
        padrao: e.padrao,
      })),
      porLocal: suas
        .map((p) => {
          const doLugar =
            p.estoqueMinimo !== null ? Number(p.estoqueMinimo) : null;
          const valeAqui = doLugar ?? minimo;
          const quantidade = Number(p.quantidade);
          return {
            localId: p.local.id,
            local: p.local.nome,
            quantidade,
            minimo: valeAqui,
            faltando:
              valeAqui !== null && valeAqui > 0 && quantidade < valeAqui,
            atualizadoEm: p.atualizadoEm,
          };
        })
        .sort((a, b) => a.local.localeCompare(b.local, "pt-BR")),
      atualizadoEm: suas.reduce<Date | null>(
        (maior, p) =>
          maior === null || p.atualizadoEm > maior ? p.atualizadoEm : maior,
        null,
      ),
    };
  });

  itens.sort(
    (a, b) =>
      PESO_DA_SITUACAO[a.situacao] - PESO_DA_SITUACAO[b.situacao] ||
      a.nome.localeCompare(b.nome, "pt-BR"),
  );

  const categorias = [
    ...new Set(itens.map((i) => i.categoria).filter((c): c is string => !!c)),
  ].sort((a, b) => a.localeCompare(b, "pt-BR"));

  return {
    itens,
    categorias,
    ultimaContagem,
    aRepor: itens.filter((i) => i.situacao === "repor").length,
    semSaldo: itens.filter((i) => i.situacao === "nunca-contado").length,
    semMinimo: itens.filter((i) => i.situacao === "sem-minimo").length,

    /**
     * O valor soma só o que TEM saldo conhecido. Um insumo nunca contado não
     * entra como zero — ele não entra. Por isso a tela precisa dizer quantos
     * itens ficaram de fora, senão o total parece completo e não é.
     */
    valorTotal: itens.reduce((soma, i) => soma + (i.valor ?? 0), 0),
  };
}
