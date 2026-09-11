/**
 * DEMONSTRAÇÃO DE COMPRAS — uma rede inventada, do pedido da loja ao
 * recebimento parcial.
 *
 * Serve para OLHAR as telas de Compras funcionando, tirar os prints e treinar
 * quem vai usar. Nada aqui é fato: a rede, as lojas, as pessoas, os
 * fornecedores, os telefones (começam com 5500000, que não é DDD) e os preços
 * são inventados.
 *
 *   npx tsx prisma/compras-demo.ts            cria
 *   npx tsx prisma/compras-demo.ts --apagar   remove tudo o que ela criou
 *
 * Tudo mora numa organização SEPARADA ("Rede Exemplo"), com pessoas próprias:
 * nada da sua rede é tocado. As senhas são sorteadas e gravadas em
 * `credenciais-demo-compras.txt`, na raiz do projeto (fora do git) — nunca
 * aparecem na tela.
 *
 * Os dados passam pelos MESMOS serviços que as telas usam: requisição,
 * consolidação, convite, proposta pelo link, comparação, pedido, aprovação,
 * envio (pelo simulador — nada sai) e conferência. Nada é gravado "por fora".
 *
 * O que fica pronto para ver:
 *
 *   Rodada "Semana 36"  pedidos aprovados; um enviado pelo simulador, um
 *                       mandado à mão (fornecedor sem autorização), um
 *                       confirmado pelo fornecedor, um ainda na aprovação, e
 *                       uma ENTREGA PARCIAL com item avariado.
 *   Rodada "Semana 37"  em revisão, com propostas: arredondamento de
 *                       embalagem, embalagem sem conversão, "não tem",
 *                       "sem resposta", disponibilidade menor que a
 *                       necessidade, frete e uma escolha diferente da
 *                       sugestão, com justificativa.
 *   Rodada "Semana 38"  em cotação, com os links dos fornecedores valendo; a
 *                       loja que não enviou a lista ficou de fora.
 *   Rodada "Semana 39"  coletando: a lista do Sul ainda está sendo montada.
 *
 * ---------------------------------------------------------------------------
 * ISTO NUNCA RODA EM PRODUÇÃO. A trava abaixo recusa banco que não seja local
 * e de desenvolvimento (nome com _dev, _test ou _local).
 * ---------------------------------------------------------------------------
 */

import { randomBytes, randomUUID } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import bcrypt from "bcryptjs";
import { config as carregarEnv } from "dotenv";

import type { ContextoSessao } from "../src/core/sessao/nucleo";
import type { Unidade } from "../src/lib/unidades";
import type { EstadoDaRodada } from "../src/modules/compras/schemas/rodada";

carregarEnv({ path: ".env.local", quiet: true });

const SLUG = "rede-exemplo-compras";
const DOMINIO = "@exemplo-compras.local";
const ARQUIVO = join(process.cwd(), "credenciais-demo-compras.txt");
const DIA = 86_400_000;

function conferirQueEhDesenvolvimento() {
  const url = process.env.DATABASE_URL ?? "";
  if (process.env.NODE_ENV === "production") {
    throw new Error("Recusado: NODE_ENV=production.");
  }
  const local = url.includes("localhost") || url.includes("127.0.0.1");
  if (!local || !/_dev|_test|_local/.test(url)) {
    throw new Error(
      "Recusado: a demonstração só roda em banco local cujo nome contenha " +
        "_dev, _test ou _local. Compra inventada nunca entra em produção.",
    );
  }
}

type Db = (typeof import("../src/server/db"))["db"];

// ------------------------------------------------------------------ APAGAR

/**
 * Remove a organização da demonstração e TUDO o que aponta para ela.
 *
 * Em vez de uma lista de tabelas (que envelhece a cada App novo), segue as
 * chaves estrangeiras do próprio banco: marca as linhas da organização, depois
 * as filhas delas, até não achar mais nada — e apaga só o que marcou.
 */
async function apagar(db: Db) {
  const org = await db.organizacao.findUnique({
    where: { slug: SLUG },
    select: { id: true },
  });
  if (!org) {
    console.log(
      "Nada para apagar: a demonstração de Compras não existe neste banco.",
    );
    rmSync(ARQUIVO, { force: true });
    return;
  }
  const acessos = await db.acesso.findMany({
    where: { organizacaoId: org.id },
    select: { usuarioId: true },
  });
  const pessoas = await db.usuario.findMany({
    where: {
      id: { in: acessos.map((a) => a.usuarioId) },
      email: { endsWith: DOMINIO },
    },
    select: { id: true },
  });

  const total = await db.$transaction(
    async (tx) => {
      const fks = await tx.$queryRaw<
        { filha: string; coluna: string; mae: string }[]
      >`
        SELECT tc.table_name AS filha, kcu.column_name AS coluna, ccu.table_name AS mae
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu
          ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
          AND ccu.column_name = 'id'`;
      const colunas = await tx.$queryRaw<{ tabela: string; coluna: string }[]>`
        SELECT table_name AS tabela, column_name AS coluna
        FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name IN ('id', 'organizacaoId')`;
      const temId = new Set(
        colunas.filter((c) => c.coluna === "id").map((c) => c.tabela),
      );
      const comOrganizacao = colunas
        .filter((c) => c.coluna === "organizacaoId" && temId.has(c.tabela))
        .map((c) => c.tabela);

      const marcados = new Map<string, Set<string>>();
      const marcar = (tabela: string, ids: string[]) => {
        const conjunto = marcados.get(tabela) ?? new Set<string>();
        let novos = 0;
        for (const id of ids) {
          if (!conjunto.has(id)) {
            conjunto.add(id);
            novos++;
          }
        }
        marcados.set(tabela, conjunto);
        return novos;
      };

      marcar("organizacao", [org.id]);
      marcar(
        "usuario",
        pessoas.map((p) => p.id),
      );
      for (const tabela of comOrganizacao) {
        const linhas = await tx.$queryRawUnsafe<{ id: string }[]>(
          `SELECT "id"::text AS id FROM "${tabela}" WHERE "organizacaoId" = $1`,
          org.id,
        );
        marcar(
          tabela,
          linhas.map((l) => l.id),
        );
      }

      let cresceu = true;
      while (cresceu) {
        cresceu = false;
        for (const fk of fks) {
          const maes = marcados.get(fk.mae);
          if (!maes?.size || !temId.has(fk.filha)) continue;
          const linhas = await tx.$queryRawUnsafe<{ id: string }[]>(
            `SELECT "id"::text AS id FROM "${fk.filha}" WHERE "${fk.coluna}"::text = ANY($1::text[])`,
            [...maes],
          );
          if (
            marcar(
              fk.filha,
              linhas.map((l) => l.id),
            ) > 0
          )
            cresceu = true;
        }
      }

      // Com tudo marcado, a ordem de apagar deixa de importar.
      await tx.$executeRawUnsafe(
        `SET LOCAL session_replication_role = replica`,
      );
      let apagados = 0;
      for (const fk of fks) {
        if (temId.has(fk.filha)) continue;
        const maes = marcados.get(fk.mae);
        if (!maes?.size) continue;
        apagados += await tx.$executeRawUnsafe(
          `DELETE FROM "${fk.filha}" WHERE "${fk.coluna}"::text = ANY($1::text[])`,
          [...maes],
        );
      }
      for (const [tabela, ids] of marcados) {
        if (!ids.size) continue;
        apagados += await tx.$executeRawUnsafe(
          `DELETE FROM "${tabela}" WHERE "id"::text = ANY($1::text[])`,
          [...ids],
        );
      }
      return apagados;
    },
    { timeout: 120_000 },
  );

  rmSync(ARQUIVO, { force: true });
  console.log(`Demonstração de Compras apagada: ${total} registros removidos.`);
}

// ------------------------------------------------------------------- CRIAR

async function criar(db: Db) {
  const { contextoDeFundo } = await import("../src/core/sessao/nucleo");
  const { garantirAlcadaDoDiretor } =
    await import("../src/modules/compras/services/alcadas");
  const { salvarProdutoDoFornecedor } =
    await import("../src/modules/compras/services/produtos-do-fornecedor");
  const { criarRodada, moverRodada } =
    await import("../src/modules/compras/services/rodadas");
  const { enviarRequisicao, requisicaoDaLoja, salvarItem } =
    await import("../src/modules/compras/services/requisicoes");
  const { convidar } =
    await import("../src/modules/compras/services/solicitacoes");
  const { registrarPeloComprador, registrarPeloLink } =
    await import("../src/modules/compras/services/propostas");
  const { aplicarSugestao, escolher } =
    await import("../src/modules/compras/services/comparacao");
  const { aprovarPedido, gerarPedidos, registrarConfirmacao } =
    await import("../src/modules/compras/services/pedidos");
  const { linkDaSolicitacao, marcarEnviadaAMao } =
    await import("../src/modules/compras/services/fila");
  const { criarSimulador } = await import("../src/connectors/fornecedores");
  const { rodarRelogio } = await import("../src/app/api/compras/tick/relogio");
  const { conferirRecebimento } =
    await import("../src/app/(shell)/compras/recebimento/conferir");

  // ---- a rede ----
  const org = await db.organizacao.create({
    data: { nome: "Rede Exemplo", slug: SLUG },
  });
  const centro = await db.unidade.create({
    data: {
      organizacaoId: org.id,
      nome: "Loja Exemplo Centro",
      codigo: "CEN",
      endereco: "Rua Exemplo, 100",
      bairro: "Centro",
      cidade: "Cidade Exemplo",
    },
  });
  const sul = await db.unidade.create({
    data: {
      organizacaoId: org.id,
      nome: "Loja Exemplo Sul",
      codigo: "SUL",
      endereco: "Avenida Exemplo, 200",
      bairro: "Zona Sul",
      cidade: "Cidade Exemplo",
    },
  });
  const depositoCentro = await db.localEstoque.create({
    data: { unidadeId: centro.id, nome: "Depósito", ordem: 1 },
  });
  await db.localEstoque.create({
    data: { unidadeId: centro.id, nome: "Câmara fria", ordem: 2 },
  });
  await db.localEstoque.create({
    data: { unidadeId: sul.id, nome: "Depósito", ordem: 1 },
  });

  const PAPEIS: Record<string, string[]> = {
    Diretor: ["*"],
    Comprador: [
      "compras.ver",
      "compras.rodadas",
      "compras.cotar",
      "compras.pedir",
      "compras.enviar",
      "compras.fornecedores",
      "estoque.ver",
    ],
    Gerente: [
      "compras.ver",
      "compras.requisitar",
      "compras.receber",
      "estoque.ver",
      "estoque.lancar",
    ],
    Financeiro: ["financeiro.ver", "financeiro.lancar", "compras.ver"],
  };
  const papel: Record<string, string> = {};
  for (const [nome, chaves] of Object.entries(PAPEIS)) {
    const p = await db.papel.create({
      data: {
        organizacaoId: org.id,
        nome,
        permissoes: { create: chaves.map((chave) => ({ chave })) },
      },
    });
    papel[nome] = p.id;
  }
  await garantirAlcadaDoDiretor(org.id, papel.Diretor);

  // ---- as pessoas (senha sorteada, só no arquivo) ----
  const senhas: {
    nome: string;
    email: string;
    senha: string;
    papel: string;
  }[] = [];
  async function pessoa(
    nome: string,
    usuario: string,
    nomeDoPapel: string,
    unidadeId: string | null,
  ) {
    const senha = randomBytes(12).toString("base64url");
    const email = `${usuario}${DOMINIO}`;
    const criada = await db.usuario.create({
      data: {
        nome,
        email,
        status: "ATIVO",
        senhaHash: await bcrypt.hash(senha, 10),
      },
    });
    await db.acesso.create({
      data: {
        usuarioId: criada.id,
        organizacaoId: org.id,
        unidadeId,
        papelId: papel[nomeDoPapel],
      },
    });
    senhas.push({ nome, email, senha, papel: nomeDoPapel });
    return criada;
  }
  const diretora = await pessoa(
    "Diretora Exemplo",
    "diretora",
    "Diretor",
    null,
  );
  const comprador = await pessoa(
    "Comprador Exemplo",
    "comprador",
    "Comprador",
    null,
  );
  const gerenteCentro = await pessoa(
    "Gerente Exemplo Centro",
    "gerente.centro",
    "Gerente",
    centro.id,
  );
  const gerenteSul = await pessoa(
    "Gerente Exemplo Sul",
    "gerente.sul",
    "Gerente",
    sul.id,
  );
  writeFileSync(
    ARQUIVO,
    [
      "DEMONSTRAÇÃO DE COMPRAS — contas inventadas da Rede Exemplo (só no banco local).",
      "Não use estas contas para nada real. Apague com: npx tsx prisma/compras-demo.ts --apagar",
      "",
      ...senhas.map(
        (s) => `${s.papel.padEnd(10)} ${s.email.padEnd(40)} ${s.senha}`,
      ),
      "",
    ].join("\n"),
    { mode: 0o600 },
  );

  async function ctx(
    u: { id: string },
    loja: { id: string } | null,
  ): Promise<ContextoSessao> {
    const c = await contextoDeFundo(u.id, loja?.id ?? null);
    if (!c)
      throw new Error("A demonstração pediu um contexto que a pessoa não tem.");
    return c;
  }
  const cComprador = await ctx(comprador, null);
  const cDiretora = await ctx(diretora, null);
  const cCentro = await ctx(gerenteCentro, centro);
  const cSul = await ctx(gerenteSul, sul);

  // ---- o catálogo ----
  const insumo = (
    nome: string,
    unidadeMedida: "KG" | "L" | "UN",
    estoqueMinimo: number,
    categoria: string,
    custoMedio: number,
  ) =>
    db.insumo.create({
      data: {
        organizacaoId: org.id,
        nome,
        unidadeMedida,
        estoqueMinimo,
        categoria,
        custoMedio,
      },
    });
  const i = {
    mussarela: await insumo("Mussarela", "KG", 25, "Laticínios", 31.2),
    molho: await insumo("Molho de tomate", "KG", 20, "Mercearia", 8.8),
    farinha: await insumo("Farinha de trigo 00", "KG", 50, "Mercearia", 4.2),
    calabresa: await insumo("Calabresa", "KG", 10, "Frios", 23.9),
    azeite: await insumo("Azeite de oliva", "L", 6, "Mercearia", 37),
    caixa: await insumo("Caixa de pizza 35 cm", "UN", 300, "Embalagens", 1.3),
  };

  const fornecedor = (
    nome: string,
    contato: string,
    telefone: string | null,
    autorizado: boolean,
    prazo: number,
  ) =>
    db.fornecedor.create({
      data: {
        organizacaoId: org.id,
        nome,
        contato,
        telefonePedidos: telefone,
        autorizadoMensagens: autorizado,
        autorizadoEm: autorizado ? new Date() : null,
        autorizadoPorId: autorizado ? diretora.id : null,
        condicaoPagamento: "28 dias",
        prazoEntregaDias: prazo,
      },
    });
  const f = {
    a: await fornecedor(
      "Distribuidora Exemplo A",
      "Vendedor A",
      "5500000000001",
      true,
      2,
    ),
    // Tem telefone, mas não autorizou mensagens: o pedido sai pelo WhatsApp de
    // quem compra, copiando.
    b: await fornecedor(
      "Distribuidora Exemplo B",
      "Vendedora B",
      "5500000000002",
      false,
      3,
    ),
    c: await fornecedor("Atacado Exemplo C", "Balcão C", null, false, 1),
    lat: await fornecedor(
      "Laticínio Exemplo",
      "Representante",
      "5500000000003",
      true,
      2,
    ),
  };

  async function produto(
    forn: { id: string },
    ins: { id: string },
    e: {
      nome: string;
      pecas: string;
      conteudo: string;
      unidade: Unidade | null;
      fixo?: boolean;
      preco?: string;
      origem?: string;
    },
  ) {
    await salvarProdutoDoFornecedor(cComprador, {
      fornecedorId: forn.id,
      insumoId: ins.id,
      nomeEmbalagem: e.nome,
      pecas: e.pecas,
      conteudo: e.conteudo,
      unidadeConteudo: e.unidade,
      fracionavel: false,
      fixo: e.fixo ?? false,
      precoReferencia: e.preco ?? "",
      precoReferenciaOrigem: e.origem ?? null,
    });
  }
  await produto(f.a, i.molho, {
    nome: "Caixa",
    pecas: "12",
    conteudo: "900",
    unidade: "G",
  });
  await produto(f.a, i.farinha, {
    nome: "Saco",
    pecas: "1",
    conteudo: "25",
    unidade: "KG",
  });
  await produto(f.a, i.calabresa, {
    nome: "Peça",
    pecas: "1",
    conteudo: "2",
    unidade: "KG",
  });
  await produto(f.a, i.azeite, {
    nome: "Caixa",
    pecas: "12",
    conteudo: "500",
    unidade: "ML",
  });
  await produto(f.a, i.caixa, {
    nome: "Fardo",
    pecas: "50",
    conteudo: "",
    unidade: null,
  });
  await produto(f.b, i.molho, {
    nome: "Balde",
    pecas: "1",
    conteudo: "10",
    unidade: "KG",
  });
  await produto(f.b, i.farinha, {
    nome: "Saco",
    pecas: "1",
    conteudo: "5",
    unidade: "KG",
  });
  // Sem o peso da peça: o sistema não converte e pede para conferir.
  await produto(f.b, i.calabresa, {
    nome: "Peça",
    pecas: "1",
    conteudo: "",
    unidade: null,
  });
  await produto(f.b, i.azeite, {
    nome: "Galão",
    pecas: "1",
    conteudo: "5",
    unidade: "L",
  });
  await produto(f.b, i.caixa, {
    nome: "Fardo",
    pecas: "100",
    conteudo: "",
    unidade: null,
  });
  await produto(f.c, i.farinha, {
    nome: "Saco",
    pecas: "1",
    conteudo: "25",
    unidade: "KG",
  });
  await produto(f.c, i.caixa, {
    nome: "Fardo",
    pecas: "50",
    conteudo: "",
    unidade: null,
  });
  await produto(f.lat, i.mussarela, {
    nome: "Caixa",
    pecas: "4",
    conteudo: "2,5",
    unidade: "KG",
    fixo: true,
    preco: "312",
    origem: "tabela de 02/09",
  });

  // ---- atalhos de fluxo ----
  async function mover(id: string, para: EstadoDaRodada) {
    const { versao } = await db.rodadaDeCompra.findUniqueOrThrow({
      where: { id },
      select: { versao: true },
    });
    await moverRodada(cComprador, id, { versao, para });
  }

  async function abrirRodada(descricao: string) {
    const agora = Date.now();
    const { id } = await criarRodada(cComprador, {
      descricao,
      unidadeIds: [centro.id, sul.id],
      prazoRequisicao: new Date(agora + DIA),
      prazoCotacao: new Date(agora + 2 * DIA),
      entregaDe: new Date(agora + 3 * DIA),
      entregaAte: new Date(agora + 4 * DIA),
      responsavelId: comprador.id,
      observacao: null,
    });
    await mover(id, "COLETANDO");
    return id;
  }

  async function pedir(
    c: ContextoSessao,
    rodadaId: string,
    itens: [{ id: string }, string][],
    enviar = true,
  ) {
    const req = await requisicaoDaLoja(c, rodadaId);
    if (!req) throw new Error("A loja não participa da rodada.");
    for (const [ins, quantidade] of itens) {
      await salvarItem(c, req.id, {
        insumoId: ins.id,
        quantidade,
        embalagemPreferida: null,
        observacao: null,
      });
    }
    if (enviar) {
      const atual = (await requisicaoDaLoja(c, rodadaId))!;
      await enviarRequisicao(c, req.id, atual.versao);
    }
  }

  const solicitacoesDa = (rodadaId: string) =>
    db.solicitacaoDeCotacao.findMany({
      where: { rodadaId },
      include: {
        itens: { include: { itemDaRodada: { select: { insumoId: true } } } },
      },
    });
  type Solicitacao = Awaited<ReturnType<typeof solicitacoesDa>>[number];

  async function convidarTodos(rodadaId: string) {
    const lista = await solicitacoesDa(rodadaId);
    for (const s of lista) await convidar(cComprador, s.id);
    return (fornecedorId: string) => {
      const s = lista.find((x) => x.fornecedorId === fornecedorId);
      if (!s) throw new Error("O fornecedor não foi convidado nesta rodada.");
      return s;
    };
  }

  type Oferta = {
    insumo: { id: string };
    preco?: string;
    nome?: string;
    pecas?: string;
    conteudo?: string;
    unidade?: "" | Unidade;
    situacao?: "COTADO" | "INDISPONIVEL";
    disponivel?: string;
  };
  function resposta(
    s: Solicitacao,
    ofertas: Oferta[],
    cabecalho: {
      frete?: string;
      pedidoMinimo?: string;
      prazoEntregaDias?: string;
      observacao?: string;
    },
  ) {
    return {
      frete: cabecalho.frete ?? "",
      pedidoMinimo: cabecalho.pedidoMinimo ?? "",
      prazoEntregaDias: cabecalho.prazoEntregaDias ?? "",
      validaAte: "",
      observacao: cabecalho.observacao ?? "",
      itens: ofertas.map((o) => {
        const item = s.itens.find(
          (x) => x.itemDaRodada.insumoId === o.insumo.id,
        );
        if (!item)
          throw new Error(
            "A oferta traz um item que não foi pedido a este fornecedor.",
          );
        return {
          itemDaSolicitacaoId: item.id,
          situacao: o.situacao ?? "COTADO",
          nomeEmbalagem: o.nome ?? "",
          pecas: o.pecas ?? "1",
          conteudo: o.conteudo ?? "",
          unidadeConteudo: o.unidade ?? "",
          fracionavel: false,
          precoEmbalagem: o.preco ?? "",
          disponivel: o.disponivel ?? "",
          observacao: "",
        };
      }),
    };
  }

  /** O fornecedor responde pela página pública, com o código do link. */
  async function pelaPagina(
    s: Solicitacao,
    bruto: ReturnType<typeof resposta>,
  ) {
    const codigo = (await linkDaSolicitacao(s.id)).split("#")[1];
    const r = await registrarPeloLink(codigo, bruto);
    if (!r.ok) throw new Error(`Proposta pelo link recusada: ${r.mensagem}`);
  }

  /** O fornecedor mandou pelo WhatsApp; o comprador digita. */
  async function digitada(s: Solicitacao, bruto: ReturnType<typeof resposta>) {
    const r = await registrarPeloComprador(cComprador, s.id, bruto, {
      origem: "COMPRADOR_DIGITOU",
    });
    if (!r.ok)
      throw new Error(`Proposta digitada recusada: ${JSON.stringify(r.erros)}`);
  }

  async function mandarFila() {
    const canal = criarSimulador();
    for (let volta = 0; volta < 12; volta++) {
      await rodarRelogio(canal, {
        dono: "demonstracao-compras",
        intervaloMs: 0,
      });
      const restam = await db.mensagemAoFornecedor.count({
        where: { organizacaoId: org.id, estado: "NA_FILA" },
      });
      if (restam === 0) break;
    }
  }

  // ======================================================== RODADA 1 ======
  const r1 = await abrirRodada("Semana 36 — reposição");
  await pedir(cCentro, r1, [
    [i.molho, "20"],
    [i.calabresa, "8"],
    [i.azeite, "5"],
    [i.mussarela, "20"],
  ]);
  await pedir(cSul, r1, [
    [i.farinha, "50"],
    [i.caixa, "200"],
    [i.mussarela, "10"],
  ]);
  await mover(r1, "COTANDO");
  const s1 = await convidarTodos(r1);

  await pelaPagina(
    s1(f.a.id),
    resposta(
      s1(f.a.id),
      [
        {
          insumo: i.molho,
          nome: "Caixa",
          pecas: "12",
          conteudo: "900",
          unidade: "G",
          preco: "95,40",
        },
        {
          insumo: i.calabresa,
          nome: "Peça",
          pecas: "1",
          conteudo: "2",
          unidade: "KG",
          preco: "47,90",
        },
        {
          insumo: i.azeite,
          nome: "Caixa",
          pecas: "12",
          conteudo: "500",
          unidade: "ML",
          preco: "222",
        },
        {
          insumo: i.farinha,
          nome: "Saco",
          pecas: "1",
          conteudo: "25",
          unidade: "KG",
          preco: "102,50",
        },
        { insumo: i.caixa, nome: "Fardo", pecas: "50", preco: "64" },
      ],
      { frete: "25", pedidoMinimo: "150", prazoEntregaDias: "2" },
    ),
  );
  await digitada(
    s1(f.b.id),
    resposta(
      s1(f.b.id),
      [
        {
          insumo: i.molho,
          nome: "Balde",
          pecas: "1",
          conteudo: "10",
          unidade: "KG",
          preco: "99",
        },
        {
          insumo: i.farinha,
          nome: "Saco",
          pecas: "1",
          conteudo: "5",
          unidade: "KG",
          preco: "19,90",
        },
        { insumo: i.caixa, nome: "Fardo", pecas: "100", preco: "118" },
        { insumo: i.calabresa, nome: "Peça", preco: "44" },
        { insumo: i.azeite, situacao: "INDISPONIVEL" },
      ],
      { frete: "0", pedidoMinimo: "200", prazoEntregaDias: "3" },
    ),
  );
  // O Atacado C não respondeu; o Laticínio (fixo) também não — vale o preço
  // de referência, dito com a data e a origem.

  await mover(r1, "REVISAO");
  await aplicarSugestao(cComprador, r1);
  await gerarPedidos(cComprador, r1, { ignorar: [] });

  const pedidosR1 = await db.pedido.findMany({
    where: { rodadaId: r1 },
    select: { id: true, versao: true, unidadeId: true, fornecedorId: true },
  });
  const pedidoDe = (unidadeId: string, fornecedorId: string) => {
    const p = pedidosR1.find(
      (x) => x.unidadeId === unidadeId && x.fornecedorId === fornecedorId,
    );
    if (!p) throw new Error("Pedido esperado não foi gerado.");
    return p;
  };
  const centroA = pedidoDe(centro.id, f.a.id);
  const centroLat = pedidoDe(centro.id, f.lat.id);
  const sulB = pedidoDe(sul.id, f.b.id);
  // O do Sul com o Laticínio fica esperando aprovação, para a tela ter o que
  // mostrar.
  for (const p of [centroA, centroLat, sulB]) {
    await aprovarPedido(cDiretora, p.id, p.versao);
  }
  await mandarFila();

  const mensagemSulB = await db.mensagemAoFornecedor.findFirstOrThrow({
    where: { referenciaTipo: "Pedido", referenciaId: sulB.id },
  });
  await marcarEnviadaAMao(cComprador, mensagemSulB.id);
  await registrarConfirmacao(cComprador, centroA.id, {
    confirmacao: "CONFIRMADO",
    texto: "Confirmado. Entrega na quinta de manhã.",
  });

  // A entrega parcial: metade do molho, uma peça de calabresa avariada.
  const itensCentroA = await db.itemDePedido.findMany({
    where: { pedidoId: centroA.id },
    select: { id: true, insumoId: true },
  });
  const linha = (insumoId: string) =>
    itensCentroA.find((x) => x.insumoId === insumoId)!.id;
  const vazio = {
    decisaoExcedente: null,
    substitutoInsumoId: null,
    decisaoSubstituicao: null,
    observacao: null,
    fotoIds: [] as string[],
  };
  await conferirRecebimento(cCentro, {
    pedidoId: centroA.id,
    chave: randomUUID(),
    recebidaEm: new Date(),
    localDestinoId: depositoCentro.id,
    informados: [
      {
        ...vazio,
        itemDePedidoId: linha(i.molho.id),
        boas: 1000n,
        avariadas: 0n,
        lote: null,
        validade: null,
      },
      {
        ...vazio,
        itemDePedidoId: linha(i.calabresa.id),
        boas: 3000n,
        avariadas: 1000n,
        lote: "CAL-0936",
        validade: new Date(Date.now() + 20 * DIA),
        observacao: "Uma peça veio com a embalagem furada.",
      },
      {
        ...vazio,
        itemDePedidoId: linha(i.azeite.id),
        boas: 1000n,
        avariadas: 0n,
        lote: "AZ-2291",
        validade: new Date(Date.now() + 400 * DIA),
      },
    ],
    numeroNota: "123",
    serieNota: "1",
    chaveAcesso: null,
    notaExistenteId: null,
    observacao: "O entregador avisou que a outra caixa de molho vem amanhã.",
    gerarContaAPagar: false,
  });

  // ======================================================== RODADA 2 ======
  const r2 = await abrirRodada("Semana 37 — compra da semana");
  await pedir(cCentro, r2, [
    [i.molho, "20"],
    [i.farinha, "60"],
    [i.calabresa, "8"],
    [i.caixa, "250"],
    [i.azeite, "5"],
    [i.mussarela, "30"],
  ]);
  await pedir(cSul, r2, [
    [i.molho, "10"],
    [i.farinha, "40"],
    [i.caixa, "180"],
    [i.mussarela, "20"],
  ]);
  await mover(r2, "COTANDO");
  const s2 = await convidarTodos(r2);

  await pelaPagina(
    s2(f.a.id),
    resposta(
      s2(f.a.id),
      [
        {
          insumo: i.molho,
          nome: "Caixa",
          pecas: "12",
          conteudo: "900",
          unidade: "G",
          preco: "96",
        },
        {
          insumo: i.farinha,
          nome: "Saco",
          pecas: "1",
          conteudo: "25",
          unidade: "KG",
          preco: "102,50",
        },
        {
          insumo: i.calabresa,
          nome: "Peça",
          pecas: "1",
          conteudo: "2",
          unidade: "KG",
          preco: "47,90",
        },
        {
          insumo: i.azeite,
          nome: "Caixa",
          pecas: "12",
          conteudo: "500",
          unidade: "ML",
          preco: "222",
        },
        { insumo: i.caixa, nome: "Fardo", pecas: "50", preco: "64" },
      ],
      { frete: "45", pedidoMinimo: "250", prazoEntregaDias: "2" },
    ),
  );
  await digitada(
    s2(f.b.id),
    resposta(
      s2(f.b.id),
      [
        {
          insumo: i.molho,
          nome: "Balde",
          pecas: "1",
          conteudo: "10",
          unidade: "KG",
          preco: "92",
        },
        {
          insumo: i.farinha,
          nome: "Saco",
          pecas: "1",
          conteudo: "5",
          unidade: "KG",
          preco: "21,90",
          disponivel: "80",
        },
        { insumo: i.calabresa, nome: "Peça", preco: "44" },
        { insumo: i.azeite, situacao: "INDISPONIVEL" },
        { insumo: i.caixa, nome: "Fardo", pecas: "100", preco: "131" },
      ],
      {
        frete: "0",
        prazoEntregaDias: "3",
        observacao: "Frete grátis nesta semana.",
      },
    ),
  );
  await pelaPagina(
    s2(f.lat.id),
    resposta(
      s2(f.lat.id),
      [
        {
          insumo: i.mussarela,
          nome: "Caixa",
          pecas: "4",
          conteudo: "2,5",
          unidade: "KG",
          preco: "318",
        },
      ],
      { frete: "0", prazoEntregaDias: "2" },
    ),
  );

  await mover(r2, "REVISAO");
  await aplicarSugestao(cComprador, r2);
  const caixaR2 = await db.itemDaRodada.findFirstOrThrow({
    where: { rodadaId: r2, insumoId: i.caixa.id },
    select: { id: true },
  });
  await escolher(cComprador, r2, {
    itemDaRodadaId: caixaR2.id,
    fornecedorId: f.b.id,
    justificativa:
      "A caixa da B é mais firme; a da A amassou na última entrega.",
  });

  // ======================================================== RODADA 3 ======
  // Em cotação: o Centro mandou a lista; o Sul não mandou a tempo e ficou de
  // fora da consolidação. Os links dos fornecedores estão valendo.
  const r3 = await abrirRodada("Semana 38 — compra da semana");
  await pedir(cCentro, r3, [
    [i.molho, "18"],
    [i.farinha, "50"],
    [i.caixa, "200"],
  ]);
  await pedir(cSul, r3, [[i.farinha, "30"]], false);
  await mover(r3, "COTANDO");
  await convidarTodos(r3);

  // ======================================================== RODADA 4 ======
  // Coletando: a lista do Sul ainda está sendo montada.
  const r4 = await abrirRodada("Semana 39 — compra da semana");
  await pedir(
    cSul,
    r4,
    [
      [i.farinha, "40"],
      [i.caixa, "150"],
    ],
    false,
  );

  await mandarFila();

  console.log("Demonstração de Compras criada na organização “Rede Exemplo”:");
  console.log("  4 rodadas · 2 lojas · 4 fornecedores · 6 insumos");
  console.log(
    "  pedidos aprovados, um aguardando aprovação, e uma entrega parcial",
  );
  console.log(
    `  contas de acesso gravadas em: ${ARQUIVO.split(/[\\/]/).pop()} (fora do git)`,
  );
}

// --------------------------------------------------------------- PRINCIPAL

async function principal() {
  conferirQueEhDesenvolvimento();
  const { db } = await import("../src/server/db");
  try {
    if (process.argv.includes("--apagar")) {
      await apagar(db);
      return;
    }
    const existe = await db.organizacao.findUnique({
      where: { slug: SLUG },
      select: { id: true },
    });
    if (existe) {
      console.log(
        "A demonstração de Compras já existe neste banco. Para refazer: rode com --apagar e depois de novo.",
      );
      return;
    }
    await criar(db);
  } finally {
    await db.$disconnect();
  }
}

principal().catch((erro) => {
  console.error(erro instanceof Error ? erro.message : erro);
  process.exitCode = 1;
});
