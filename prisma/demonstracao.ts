import { config as carregarEnv } from "dotenv";

carregarEnv({ path: ".env.local", quiet: true });

/**
 * DADOS DE DEMONSTRAÇÃO.
 *
 * Preenche um banco de DESENVOLVIMENTO com contas, pendências e um checklist
 * respondido, para dar o que ver ao Painel da operação antes de existir
 * movimento real.
 *
 * ---------------------------------------------------------------------------
 * ISTO NÃO É O `seed.ts`, E A DIFERENÇA É O PONTO.
 *
 * O seed cria o que todo Tetteo precisa para existir: a organização, a
 * unidade, os papéis, o primeiro usuário. Roda em produção.
 *
 * Este arquivo cria FATOS INVENTADOS — boletos que ninguém deve, coifa que
 * ninguém sujou. Ele nunca pode rodar em produção, e por isso a trava abaixo
 * não é decorativa: um "a pagar" fictício de R$ 22.400 no meio das contas
 * reais é o tipo de erro que só aparece quando alguém tenta conciliar o
 * extrato e não fecha.
 *
 *   npm run demo            cria
 *   npm run demo -- --apagar   remove tudo que foi criado aqui
 *
 * Tudo que este script grava leva a MARCA abaixo. É ela que torna a remoção
 * exata: nada que você tenha cadastrado à mão é tocado.
 * ---------------------------------------------------------------------------
 */

const MARCA = "[demonstração]";

/** Hoje, à meia-noite, no fuso de quem está rodando. */
function hoje() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function emDias(dias: number) {
  const d = hoje();
  d.setDate(d.getDate() + dias);
  return d;
}

/**
 * A trava.
 *
 * Recusa qualquer banco que não seja claramente local e de desenvolvimento.
 * Preferimos falhar aqui e obrigar alguém a pensar do que aceitar um
 * `DATABASE_URL` que por acaso apontava para a loja.
 */
function conferirQueEhDesenvolvimento() {
  const url = process.env.DATABASE_URL ?? "";

  if (process.env.NODE_ENV === "production") {
    throw new Error("Recusado: NODE_ENV=production.");
  }
  if (!url) {
    throw new Error("Recusado: DATABASE_URL não configurada.");
  }

  const local = url.includes("localhost") || url.includes("127.0.0.1");
  const nomeDeDesenvolvimento = /_dev|_test|_local/.test(url);

  if (!local || !nomeDeDesenvolvimento) {
    throw new Error(
      "Recusado: este script só roda em banco local cujo nome contenha " +
        "_dev, _test ou _local. Dados de demonstração nunca entram em " +
        "produção como se fossem fatos.",
    );
  }
}

async function principal() {
  conferirQueEhDesenvolvimento();

  const { db } = await import("../src/server/db");
  const apagar = process.argv.includes("--apagar");

  const organizacao = await db.organizacao.findFirst({
    where: { excluidoEm: null },
  });
  if (!organizacao)
    throw new Error("Nenhuma organização. Rode `npm run seed`.");

  const unidade = await db.unidade.findFirst({
    where: { organizacaoId: organizacao.id, excluidoEm: null },
  });
  if (!unidade) throw new Error("Nenhuma unidade. Rode `npm run seed`.");

  // -------------------------------------------------------------------------
  // APAGAR — na ordem das dependências, do filho para o pai.
  // -------------------------------------------------------------------------
  async function limpar() {
    const respostas = await db.respostaDeChecklist.findMany({
      where: { observacao: { startsWith: MARCA } },
      select: { id: true },
    });
    const idsResposta = respostas.map((r) => r.id);

    const removidas = await db.pendencia.deleteMany({
      where: { respostaId: { in: idsResposta } },
    });
    await db.respostaItem.deleteMany({
      where: { respostaId: { in: idsResposta } },
    });
    await db.respostaDeChecklist.deleteMany({
      where: { id: { in: idsResposta } },
    });

    const modelos = await db.modeloDeChecklist.findMany({
      where: { descricao: { startsWith: MARCA } },
      select: { id: true },
    });
    const idsModelo = modelos.map((m) => m.id);
    await db.itemDeModelo.deleteMany({
      where: { modeloId: { in: idsModelo } },
    });
    await db.modeloDeChecklist.deleteMany({ where: { id: { in: idsModelo } } });

    const lancamentos = await db.lancamento.deleteMany({
      where: { observacao: { startsWith: MARCA } },
    });
    await db.contaFinanceira.deleteMany({
      where: { unidadeId: unidade!.id, nome: { endsWith: "(demonstração)" } },
    });
    await db.categoriaFinanceira.deleteMany({
      where: { organizacaoId: organizacao!.id, grupo: MARCA },
    });
    await db.fornecedor.deleteMany({
      where: { organizacaoId: organizacao!.id, observacao: MARCA },
    });

    // As pessoas da equipe fictícia, e o acesso delas.
    const equipe = await db.usuario.findMany({
      where: { email: { endsWith: "@demonstracao.local" } },
      select: { id: true },
    });
    const idsEquipe = equipe.map((u) => u.id);
    await db.acesso.deleteMany({ where: { usuarioId: { in: idsEquipe } } });
    await db.usuario.deleteMany({ where: { id: { in: idsEquipe } } });

    console.log(
      `Removidos: ${lancamentos.count} lançamentos, ${removidas.count} pendências, ` +
        `${idsResposta.length} checklist(s), ${idsEquipe.length} pessoa(s).`,
    );
  }

  // Sempre limpa antes de criar: rodar duas vezes não duplica nada.
  await limpar();
  if (apagar) {
    console.log("Pronto. O banco voltou ao estado sem demonstração.");
    await db.$disconnect();
    return;
  }

  // -------------------------------------------------------------------------
  // A EQUIPE
  //
  // `senhaHash: null` e status CONVIDADO de propósito: elas aparecem como
  // responsáveis pelas pendências e NÃO conseguem entrar no sistema. Uma conta
  // fictícia que loga é uma porta que ninguém lembra de fechar.
  // -------------------------------------------------------------------------
  const papelGerente =
    (await db.papel.findFirst({
      where: { organizacaoId: organizacao.id, nome: { contains: "Gerente" } },
    })) ??
    (await db.papel.findFirst({ where: { organizacaoId: organizacao.id } }));

  const equipe = [
    { nome: "Marcos Aurélio", email: "marcos@demonstracao.local" },
    { nome: "Juliana Prado", email: "juliana@demonstracao.local" },
  ];

  const pessoas: { id: string; nome: string }[] = [];
  for (const pessoa of equipe) {
    const criada = await db.usuario.create({
      data: {
        nome: pessoa.nome,
        email: pessoa.email,
        senhaHash: null,
        status: "CONVIDADO",
      },
      select: { id: true, nome: true },
    });
    if (papelGerente) {
      await db.acesso.create({
        data: {
          usuarioId: criada.id,
          organizacaoId: organizacao.id,
          unidadeId: unidade.id,
          papelId: papelGerente.id,
          status: "ATIVO",
        },
      });
    }
    pessoas.push(criada);
  }
  const [marcos, juliana] = pessoas;

  // -------------------------------------------------------------------------
  // O CAIXA
  // -------------------------------------------------------------------------
  const conta = await db.contaFinanceira.create({
    data: {
      unidadeId: unidade.id,
      nome: "Conta corrente (demonstração)",
      tipo: "BANCO",
      saldoInicial: 18500,
      ativa: true,
    },
  });

  const categorias: Record<string, string> = {};
  const definicoes = [
    { nome: "Vendas no salão", tipo: "RECEITA", dre: "RECEITA" },
    { nome: "Delivery próprio", tipo: "RECEITA", dre: "RECEITA" },
    { nome: "Aluguel", tipo: "DESPESA", dre: "OCUPACAO" },
    { nome: "Energia elétrica", tipo: "DESPESA", dre: "OCUPACAO" },
    { nome: "Folha de pagamento", tipo: "DESPESA", dre: "PESSOAL" },
    { nome: "Fornecedores", tipo: "DESPESA", dre: "MERCADORIA" },
    { nome: "Taxa de cartão", tipo: "DESPESA", dre: "DEDUCAO" },
    { nome: "Manutenção", tipo: "DESPESA", dre: "OPERACIONAL" },
  ] as const;

  for (const d of definicoes) {
    const existente = await db.categoriaFinanceira.findFirst({
      where: { organizacaoId: organizacao.id, nome: d.nome },
    });
    if (existente) {
      categorias[d.nome] = existente.id;
      continue;
    }
    const criada = await db.categoriaFinanceira.create({
      data: {
        organizacaoId: organizacao.id,
        nome: d.nome,
        tipo: d.tipo,
        grupo: MARCA,
        grupoDre: d.dre,
      },
    });
    categorias[d.nome] = criada.id;
  }

  const fornecedores: Record<string, string> = {};
  for (const nome of [
    "Laticínios Serra Azul",
    "Moinho Paulista",
    "Distribuidora Bebidas Norte",
    "Hortifruti do Zé",
  ]) {
    const existente = await db.fornecedor.findFirst({
      where: { organizacaoId: organizacao.id, nome },
    });
    fornecedores[nome] =
      existente?.id ??
      (
        await db.fornecedor.create({
          data: { organizacaoId: organizacao.id, nome, observacao: MARCA },
        })
      ).id;
  }

  // -------------------------------------------------------------------------
  // AS CONTAS
  //
  // A mistura é proposital: vencidas, a vencer dentro e fora do período de 30
  // dias, e quitadas. É isso que dá o que testar nos filtros e faz a projeção
  // do caixa ter forma — e, com a folha caindo no dia 22, ela cruza o zero.
  // -------------------------------------------------------------------------
  type Conta = {
    descricao: string;
    direcao: "PAGAR" | "RECEBER";
    valor: number;
    dias: number;
    categoria: string;
    fornecedor?: string;
    quitado?: boolean;
    parcela?: [number, number];
  };

  const contas: Conta[] = [
    // --- vencidas, ainda em aberto ---
    {
      descricao: "Energia elétrica — agosto",
      direcao: "PAGAR",
      valor: 2340.5,
      dias: -6,
      categoria: "Energia elétrica",
    },
    {
      descricao: "Mussarela e queijos — nota 4417",
      direcao: "PAGAR",
      valor: 4180,
      dias: -3,
      categoria: "Fornecedores",
      fornecedor: "Laticínios Serra Azul",
    },
    {
      descricao: "Limpeza técnica da coifa",
      direcao: "PAGAR",
      valor: 890,
      dias: -1,
      categoria: "Manutenção",
    },
    {
      descricao: "Evento corporativo — Construtora Vale",
      direcao: "RECEBER",
      valor: 3200,
      dias: -2,
      categoria: "Vendas no salão",
    },

    // --- a vencer, dentro dos 30 dias ---
    {
      descricao: "Hortifruti da semana",
      direcao: "PAGAR",
      valor: 640,
      dias: 2,
      categoria: "Fornecedores",
      fornecedor: "Hortifruti do Zé",
    },
    {
      descricao: "Aluguel do ponto",
      direcao: "PAGAR",
      valor: 7500,
      dias: 5,
      categoria: "Aluguel",
      parcela: [9, 12],
    },
    {
      descricao: "Farinha tipo 00 — 40 sacas",
      direcao: "PAGAR",
      valor: 3260,
      dias: 8,
      categoria: "Fornecedores",
      fornecedor: "Moinho Paulista",
    },
    {
      descricao: "Folha de pagamento — setembro",
      direcao: "PAGAR",
      valor: 22400,
      dias: 12,
      categoria: "Folha de pagamento",
    },
    {
      descricao: "Internet e telefone",
      direcao: "PAGAR",
      valor: 320,
      dias: 15,
      categoria: "Manutenção",
    },
    {
      descricao: "Refrigerantes e cervejas",
      direcao: "PAGAR",
      valor: 1975.4,
      dias: 18,
      categoria: "Fornecedores",
      fornecedor: "Distribuidora Bebidas Norte",
    },
    {
      descricao: "Taxa de cartão — 1ª quinzena",
      direcao: "PAGAR",
      valor: 1180.9,
      dias: 25,
      categoria: "Taxa de cartão",
    },

    // --- a vencer, só aparece no período de 90 dias ---
    {
      descricao: "Recarga de gás — contrato trimestral",
      direcao: "PAGAR",
      valor: 1450,
      dias: 40,
      categoria: "Fornecedores",
    },

    // --- a receber ---
    {
      descricao: "Repasse iFood — semana 36",
      direcao: "RECEBER",
      valor: 8900,
      dias: 3,
      categoria: "Delivery próprio",
    },
    {
      descricao: "Repasse cartão — 1ª quinzena",
      direcao: "RECEBER",
      valor: 12450,
      dias: 7,
      categoria: "Vendas no salão",
    },
    {
      descricao: "Repasse cartão — 2ª quinzena",
      direcao: "RECEBER",
      valor: 11800,
      dias: 21,
      categoria: "Vendas no salão",
    },

    // --- já quitadas ---
    {
      descricao: "Energia elétrica — julho",
      direcao: "PAGAR",
      valor: 2180,
      dias: -38,
      categoria: "Energia elétrica",
      quitado: true,
    },
    {
      descricao: "Aluguel do ponto",
      direcao: "PAGAR",
      valor: 7500,
      dias: -25,
      categoria: "Aluguel",
      quitado: true,
      parcela: [8, 12],
    },
    {
      descricao: "Repasse iFood — semana 34",
      direcao: "RECEBER",
      valor: 7640,
      dias: -20,
      categoria: "Delivery próprio",
      quitado: true,
    },
  ];

  for (const c of contas) {
    await db.lancamento.create({
      data: {
        unidadeId: unidade.id,
        direcao: c.direcao,
        status: c.quitado ? "QUITADO" : "ABERTO",
        descricao: c.descricao,
        categoriaId: categorias[c.categoria],
        fornecedorId: c.fornecedor ? fornecedores[c.fornecedor] : null,
        valor: c.valor,
        vencimento: emDias(c.dias),
        quitadoEm: c.quitado ? emDias(c.dias) : null,
        valorQuitado: c.quitado ? c.valor : null,
        contaId: conta.id,
        parcela: c.parcela?.[0] ?? null,
        totalParcelas: c.parcela?.[1] ?? null,
        grupoParcelas: c.parcela ? "aluguel-2026" : null,
        observacao: `${MARCA} conta fictícia para testar o painel`,
      },
    });
  }

  // -------------------------------------------------------------------------
  // O CHECKLIST E AS PENDÊNCIAS
  //
  // As pendências cobrem os quatro estados que o painel ordena: atrasada, sem
  // responsável, com prazo, e sem prazo. É a única forma de ver se a fila do
  // gerente está ordenando pelo que importa.
  // -------------------------------------------------------------------------
  const modelo = await db.modeloDeChecklist.create({
    data: {
      organizacaoId: organizacao.id,
      nome: "Abertura do salão (demonstração)",
      descricao: `${MARCA} modelo fictício`,
      ativo: true,
      itens: {
        create: [
          {
            texto: "As câmaras frias estão na temperatura?",
            secao: "Cozinha",
            ordem: 0,
          },
          { texto: "A coifa está limpa?", secao: "Cozinha", ordem: 1 },
          { texto: "O termômetro está calibrado?", secao: "Cozinha", ordem: 2 },
          { texto: "O salão está montado?", secao: "Salão", ordem: 3 },
          {
            texto: "Os banheiros estão abastecidos?",
            secao: "Banheiros",
            ordem: 4,
          },
          {
            texto: "A fachada e o rodapé estão em ordem?",
            secao: "Salão",
            ordem: 5,
          },
        ],
      },
    },
    include: { itens: { orderBy: { ordem: "asc" } } },
  });

  const resposta = await db.respostaDeChecklist.create({
    data: {
      unidadeId: unidade.id,
      modeloId: modelo.id,
      referencia: emDias(-1),
      status: "FECHADA",
      itensConformes: 3,
      itensNaoConformes: 3,
      pontuacao: 50,
      fechadaEm: emDias(-1),
      observacao: `${MARCA} checklist fictício`,
      itens: {
        create: modelo.itens.map((item, i) => ({
          itemId: item.id,
          textoItem: item.texto,
          secao: item.secao,
          ordem: i,
          conforme: ![1, 2, 5].includes(i),
          respondidoEm: emDias(-1),
        })),
      },
    },
  });

  const pendencias = [
    {
      descricao: "Coifa da cozinha com acúmulo de gordura",
      prazo: -4,
      responsavel: marcos.id,
    },
    {
      descricao: "Termômetro da câmara fria descalibrado",
      prazo: -1,
      responsavel: juliana.id,
    },
    {
      descricao: "Lâmpada queimada no banheiro masculino",
      prazo: 2,
      responsavel: null,
    },
    {
      descricao: "Rodapé do salão soltando na entrada",
      prazo: 6,
      responsavel: marcos.id,
    },
    {
      descricao: "Falta papel-toalha no lavatório de funcionários",
      prazo: null,
      responsavel: null,
    },
  ];

  for (const p of pendencias) {
    await db.pendencia.create({
      data: {
        unidadeId: unidade.id,
        respostaId: resposta.id,
        descricao: p.descricao,
        responsavelId: p.responsavel,
        prazo: p.prazo === null ? null : emDias(p.prazo),
        status: "ABERTA",
      },
    });
  }

  // Uma resolvida, para provar que ela sai da fila de abertas.
  await db.pendencia.create({
    data: {
      unidadeId: unidade.id,
      respostaId: resposta.id,
      descricao: "Porta da câmara fria sem borracha de vedação",
      responsavelId: juliana.id,
      prazo: emDias(-8),
      status: "RESOLVIDA",
      resolucao: "Borracha trocada pelo técnico da Refrisul em 02/09.",
      resolvidaEm: emDias(-7),
    },
  });

  console.log("Dados de demonstração criados:");
  console.log(`  ${contas.length} contas (4 vencidas, 3 quitadas)`);
  console.log("  5 pendências abertas + 1 resolvida");
  console.log("  1 checklist respondido, 2 pessoas na equipe");
  console.log("  1 conta bancária com saldo inicial de R$ 18.500,00");
  console.log("");
  console.log("Para desfazer: npm run demo -- --apagar");

  await db.$disconnect();
}

principal().catch((erro) => {
  console.error(erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
