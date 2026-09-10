/**
 * DADOS DE DEMONSTRAÇÃO DA DESPENSA.
 *
 * Serve para OLHAR a tela funcionando antes de existir catálogo de verdade.
 * Nada aqui é fato: são insumos inventados, escolhidos para cobrir todos os
 * estados que a tela precisa saber desenhar.
 *
 *   npm run demo:despensa          põe os dados
 *   npm run demo:despensa:limpar   tira os dados
 *
 * ---------------------------------------------------------------------------
 * ISTO NUNCA DEVE RODAR EM PRODUÇÃO.
 *
 * O script recusa a rodar se `DATABASE_URL` não apontar para uma máquina
 * local. Não é paranoia: um "npm run" digitado na janela errada com a variável
 * de produção carregada põe mussarela inventada no estoque de uma loja de
 * verdade, e alguém compra em cima disso.
 *
 * Apague estes insumos ANTES de importar seu catálogo real, ou você vai ficar
 * com dois cadastros de mussarela — que é exatamente o problema que o Tetteo
 * existe para resolver.
 * ---------------------------------------------------------------------------
 *
 * Os estados cobertos, um por linha da tabela:
 *
 *   REPOR          abaixo do mínimo → etiqueta âmbar, sugestão de compra
 *   SUFICIENTE     no mínimo ou acima
 *   SEM MÍNIMO     tem saldo, mas não há mínimo cadastrado
 *   NUNCA CONTADO  existe no catálogo e não tem posição nenhuma nesta loja
 *
 * E, do lado das unidades:
 *
 *   com embalagem de compra (caixa, saco, fardo) e o fator de conversão
 *   sem embalagem nenhuma — a tela precisa dizer isso, não inventar a caixa
 *   rótulo próprio ("pct", "bdj") sobre a unidade base UN
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type UnidadeMedida } from "@prisma/client";
import { config as carregarEnv } from "dotenv";

carregarEnv({ path: ".env.local", quiet: true });

const url = process.env.DATABASE_URL ?? "";
// A mesma trava do `npm run demo`: máquina local E nome de banco de
// desenvolvimento. Só "localhost" não basta — o túnel SSH para o banco do VPS
// também é localhost, e é o nome (_dev, _test, _local) que separa um banco de
// testes do banco da loja.
const ehLocal = url.includes("localhost") || url.includes("127.0.0.1");
const nomeDeDesenvolvimento = /_dev|_test|_local/.test(url);

if (!ehLocal || !nomeDeDesenvolvimento) {
  console.error(
    "Recusado: DATABASE_URL precisa apontar para um banco local de desenvolvimento\n" +
      "(localhost, e nome terminado em _dev, _test ou _local).",
  );
  process.exit(1);
}

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url }),
});

const LOCAIS = ["Câmara fria", "Estoque seco", "Balcão"] as const;

type Demo = {
  nome: string;
  categoria: string;
  unidadeMedida: UnidadeMedida;
  unidadeRotulo?: string;
  custoMedio: number;
  custoUltimo: number;
  /** 0 = sem mínimo cadastrado. */
  estoqueMinimo: number;
  /** Ausente = nunca contado nesta loja: NÃO recebe posição nenhuma. */
  posicoes?: { local: (typeof LOCAIS)[number]; quantidade: number }[];
  embalagens?: { nome: string; fator: number; padrao?: boolean }[];
};

const INSUMOS: Demo[] = [
  // ---- Abaixo do mínimo: o trabalho do dia ----
  {
    nome: "Mussarela fatiada",
    categoria: "Laticínios",
    unidadeMedida: "KG",
    custoMedio: 32.4,
    custoUltimo: 34.9,
    estoqueMinimo: 25,
    posicoes: [
      { local: "Câmara fria", quantidade: 6.4 },
      { local: "Balcão", quantidade: 1.2 },
    ],
    embalagens: [
      { nome: "Caixa 10 kg", fator: 10, padrao: true },
      { nome: "Peça 3 kg", fator: 3 },
    ],
  },
  {
    nome: "Molho de tomate",
    categoria: "Mercearia",
    unidadeMedida: "KG",
    custoMedio: 8.9,
    custoUltimo: 9.4,
    estoqueMinimo: 40,
    posicoes: [{ local: "Estoque seco", quantidade: 12 }],
    embalagens: [{ nome: "Lata 3,1 kg", fator: 3.1, padrao: true }],
  },
  {
    nome: "Calabresa",
    categoria: "Frios",
    unidadeMedida: "KG",
    custoMedio: 24.5,
    custoUltimo: 26.0,
    estoqueMinimo: 15,
    posicoes: [{ local: "Câmara fria", quantidade: 3.5 }],
    embalagens: [{ nome: "Peça 2,5 kg", fator: 2.5, padrao: true }],
  },
  {
    nome: "Caixa de pizza 35cm",
    categoria: "Embalagens",
    unidadeMedida: "UN",
    custoMedio: 1.35,
    custoUltimo: 1.42,
    estoqueMinimo: 400,
    posicoes: [{ local: "Estoque seco", quantidade: 120 }],
    embalagens: [{ nome: "Fardo c/ 100", fator: 100, padrao: true }],
  },

  // ---- Suficientes ----
  {
    nome: "Farinha de trigo",
    categoria: "Mercearia",
    unidadeMedida: "KG",
    custoMedio: 4.2,
    custoUltimo: 4.35,
    estoqueMinimo: 50,
    posicoes: [{ local: "Estoque seco", quantidade: 175 }],
    embalagens: [{ nome: "Saco 25 kg", fator: 25, padrao: true }],
  },
  {
    nome: "Azeite de oliva",
    categoria: "Mercearia",
    unidadeMedida: "L",
    custoMedio: 38.0,
    custoUltimo: 41.5,
    estoqueMinimo: 4,
    posicoes: [{ local: "Estoque seco", quantidade: 9 }],
    embalagens: [{ nome: "Lata 5 L", fator: 5, padrao: true }],
  },
  {
    nome: "Refrigerante 2L",
    categoria: "Bebidas",
    unidadeMedida: "UN",
    unidadeRotulo: "grf",
    custoMedio: 6.8,
    custoUltimo: 7.1,
    estoqueMinimo: 24,
    posicoes: [
      { local: "Balcão", quantidade: 38 },
      { local: "Estoque seco", quantidade: 12 },
    ],
    embalagens: [{ nome: "Fardo c/ 6", fator: 6, padrao: true }],
  },

  // ---- Tem saldo, mas ninguém cadastrou o mínimo ----
  {
    nome: "Orégano",
    categoria: "Temperos",
    unidadeMedida: "KG",
    custoMedio: 42.0,
    custoUltimo: 45.0,
    estoqueMinimo: 0,
    posicoes: [{ local: "Estoque seco", quantidade: 2.4 }],
  },
  {
    nome: "Guardanapo",
    categoria: "Descartáveis",
    unidadeMedida: "UN",
    unidadeRotulo: "pct",
    custoMedio: 3.1,
    custoUltimo: 3.1,
    estoqueMinimo: 0,
    posicoes: [{ local: "Estoque seco", quantidade: 46 }],
  },

  // ---- Nunca contados: existem no catálogo, sem posição nenhuma ----
  {
    nome: "Champignon",
    categoria: "Mercearia",
    unidadeMedida: "KG",
    custoMedio: 28.0,
    custoUltimo: 28.0,
    estoqueMinimo: 3,
    embalagens: [{ nome: "Vidro 500 g", fator: 0.5, padrao: true }],
  },
  {
    nome: "Bacon em cubos",
    categoria: "Frios",
    unidadeMedida: "KG",
    custoMedio: 31.5,
    custoUltimo: 31.5,
    estoqueMinimo: 8,
  },
  {
    nome: "Catupiry",
    categoria: "Laticínios",
    unidadeMedida: "KG",
    custoMedio: 39.9,
    custoUltimo: 39.9,
    estoqueMinimo: 0,
  },
];

const NOMES = INSUMOS.map((i) => i.nome);

/**
 * Tira os dados de demonstração — e o que foi feito COM eles.
 *
 * Testar a tela deixa rastro: uma cotação montada pela lista de compras, uma
 * contagem aberta para ver a folha. Esses registros apontam para os insumos de
 * demonstração e impediriam de apagá-los. Então eles saem junto — mas só as
 * LINHAS que falam de insumo de demonstração, e só os documentos que ficaram
 * vazios depois disso. Uma cotação de verdade que por acaso tenha um item de
 * demonstração perde o item, não a cotação.
 *
 * Nota fiscal, pedido de compra e ficha técnica são outra conversa: geram
 * conta a pagar e custo de prato. Se um insumo de demonstração tiver ido parar
 * num deles, o script PARA e explica — apagar isso em silêncio mexeria em
 * dinheiro.
 */
async function limpar(organizacaoId: string) {
  const insumos = await db.insumo.findMany({
    where: { organizacaoId, nome: { in: NOMES } },
    select: { id: true },
  });
  const ids = insumos.map((i) => i.id);

  if (ids.length === 0) {
    console.log("Nenhum insumo de demonstração encontrado. Nada a fazer.");
    return;
  }

  const [emNotas, emPedidos, emFichas] = await Promise.all([
    db.notaEntradaItem.count({ where: { insumoId: { in: ids } } }),
    db.itemDePedido.count({ where: { insumoId: { in: ids } } }),
    db.itemDeFicha.count({ where: { insumoId: { in: ids } } }),
  ]);

  if (emNotas + emPedidos + emFichas > 0) {
    console.error(
      `Parado: os insumos de demonstração aparecem em ${emNotas} linha(s) de nota, ` +
        `${emPedidos} de pedido e ${emFichas} de ficha técnica.\n` +
        "Isso mexe em dinheiro e em custo de prato, e não é apagado sozinho.\n" +
        "Remova essas notas, pedidos ou fichas antes — ou desative os insumos no cadastro.",
    );
    process.exit(1);
  }

  const [linhasDeCotacao, linhasDeContagem] = await Promise.all([
    db.itemDeCotacao.findMany({
      where: { insumoId: { in: ids } },
      select: { cotacaoId: true },
    }),
    db.contagemItem.findMany({
      where: { insumoId: { in: ids } },
      select: { contagemId: true },
    }),
  ]);
  const cotacoes = [...new Set(linhasDeCotacao.map((l) => l.cotacaoId))];
  const contagens = [...new Set(linhasDeContagem.map((l) => l.contagemId))];

  const apagado = await db.$transaction(async (tx) => {
    const itensDeCotacao = await tx.itemDeCotacao.deleteMany({
      where: { insumoId: { in: ids } },
    });
    const itensDeContagem = await tx.contagemItem.deleteMany({
      where: { insumoId: { in: ids } },
    });
    const movimentos = await tx.movimentoEstoque.deleteMany({
      where: { insumoId: { in: ids } },
    });
    // Só os documentos que ficaram VAZIOS. O que ainda tem item de verdade fica.
    const cotacoesVazias = await tx.cotacao.deleteMany({
      where: { id: { in: cotacoes }, itens: { none: {} } },
    });
    const contagensVazias = await tx.contagem.deleteMany({
      where: { id: { in: contagens }, itens: { none: {} } },
    });
    // Embalagens e posições saem junto com o insumo (onDelete: Cascade).
    const removidos = await tx.insumo.deleteMany({
      where: { id: { in: ids } },
    });

    return {
      insumos: removidos.count,
      itensDeCotacao: itensDeCotacao.count,
      cotacoes: cotacoesVazias.count,
      itensDeContagem: itensDeContagem.count,
      contagens: contagensVazias.count,
      movimentos: movimentos.count,
    };
  });

  console.log(`removidos ${apagado.insumos} insumos de demonstração.`);
  console.log(
    `e o rastro dos testes: ${apagado.cotacoes} cotação(ões) e ` +
      `${apagado.contagens} contagem(ns) que só tinham demonstração, ` +
      `${apagado.itensDeCotacao + apagado.itensDeContagem} linha(s) e ` +
      `${apagado.movimentos} movimento(s).`,
  );
}

async function main() {
  const organizacao = await db.organizacao.findFirst({
    where: { excluidoEm: null },
    select: { id: true, nome: true },
  });
  if (!organizacao) {
    console.error("Nenhuma organização. Rode `npm run seed` antes.");
    process.exit(1);
  }

  if (process.argv.includes("--limpar")) {
    await limpar(organizacao.id);
    return;
  }

  const unidade = await db.unidade.findFirst({
    where: { organizacaoId: organizacao.id, excluidoEm: null },
    select: { id: true, nome: true },
  });
  if (!unidade) {
    console.error("Nenhuma unidade. Rode `npm run seed` antes.");
    process.exit(1);
  }

  // Os lugares de guardar. Sem eles não existe posição — e "onde está" é
  // metade da resposta que a despensa dá.
  const locais = new Map<string, string>();
  for (const [ordem, nome] of LOCAIS.entries()) {
    const local = await db.localEstoque.upsert({
      where: { unidadeId_nome: { unidadeId: unidade.id, nome } },
      update: {},
      create: { unidadeId: unidade.id, nome, ordem },
      select: { id: true },
    });
    locais.set(nome, local.id);
  }

  for (const demo of INSUMOS) {
    const insumo = await db.insumo.upsert({
      where: {
        organizacaoId_nome: { organizacaoId: organizacao.id, nome: demo.nome },
      },
      update: {
        categoria: demo.categoria,
        unidadeMedida: demo.unidadeMedida,
        unidadeRotulo: demo.unidadeRotulo ?? null,
        custoMedio: demo.custoMedio,
        custoUltimo: demo.custoUltimo,
        estoqueMinimo: demo.estoqueMinimo,
        ativo: true,
      },
      create: {
        organizacaoId: organizacao.id,
        nome: demo.nome,
        categoria: demo.categoria,
        unidadeMedida: demo.unidadeMedida,
        unidadeRotulo: demo.unidadeRotulo ?? null,
        custoMedio: demo.custoMedio,
        custoUltimo: demo.custoUltimo,
        estoqueMinimo: demo.estoqueMinimo,
      },
      select: { id: true },
    });

    for (const emb of demo.embalagens ?? []) {
      await db.embalagemCompra.upsert({
        where: { insumoId_nome: { insumoId: insumo.id, nome: emb.nome } },
        update: { fator: emb.fator, padrao: emb.padrao ?? false, ativo: true },
        create: {
          insumoId: insumo.id,
          nome: emb.nome,
          fator: emb.fator,
          padrao: emb.padrao ?? false,
        },
      });
    }

    // Sem `posicoes` o insumo fica NUNCA CONTADO de propósito. Criar uma
    // posição zerada aqui destruiria justamente o estado que a tela precisa
    // saber mostrar — e "em branco não é zero" viraria uma frase sem exemplo.
    for (const pos of demo.posicoes ?? []) {
      const localId = locais.get(pos.local)!;
      await db.posicaoEstoque.upsert({
        where: { localId_insumoId: { localId, insumoId: insumo.id } },
        update: { quantidade: pos.quantidade },
        create: {
          unidadeId: unidade.id,
          localId,
          insumoId: insumo.id,
          quantidade: pos.quantidade,
        },
      });
    }
  }

  console.log(
    `${INSUMOS.length} insumos de DEMONSTRAÇÃO criados em ${organizacao.nome} / ${unidade.nome}.`,
  );
  console.log("Para tirar: npm run demo:despensa:limpar");
}

main()
  .catch((erro) => {
    console.error(erro);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
