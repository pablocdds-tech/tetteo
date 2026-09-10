import { contextoDeFundo, type ContextoSessao } from "@/core/sessao/nucleo";
import { db } from "@/server/db";

/**
 * O CENÁRIO DOS TESTES COM BANCO.
 *
 * Uma rede FICTÍCIA completa: duas lojas, quatro pessoas com papéis
 * diferentes, insumos em quilo, litro e unidade, três fornecedores e um
 * depósito por loja. Nenhum nome, telefone ou preço aqui existe de verdade —
 * os telefones começam com 5500000, que não é um DDD.
 *
 * Só roda no banco de teste: `limparBanco` confere o nome do banco antes de
 * apagar qualquer coisa, além da trava de `scripts/ambiente-de-teste.ts`.
 */

export async function limparBanco(): Promise<void> {
  const [{ banco }] = await db.$queryRaw<{ banco: string }[]>`
    SELECT current_database() AS banco`;
  if (!banco.includes("_test")) {
    throw new Error(
      `Recusado: limparBanco rodaria em "${banco}", que não é banco de teste.`,
    );
  }

  const tabelas = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tabelas.length === 0) return;

  await db.$executeRawUnsafe(
    `TRUNCATE ${tabelas.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`,
  );
}

const PAPEIS = {
  Diretor: ["*"],
  Comprador: [
    "compras.ver",
    "compras.rodadas",
    "compras.cotar",
    "compras.pedir",
    "compras.enviar",
    "compras.fornecedores",
  ],
  Gerente: [
    "compras.ver",
    "compras.requisitar",
    "compras.receber",
    "estoque.ver",
    "estoque.lancar",
  ],
  Financeiro: ["financeiro.ver", "financeiro.lancar", "compras.ver"],
} as const;

export type Cenario = Awaited<ReturnType<typeof criarCenario>>;

export async function criarCenario() {
  const org = await db.organizacao.create({
    data: { nome: "Rede Exemplo", slug: `rede-exemplo-${Date.now()}` },
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

  const papeis: Record<keyof typeof PAPEIS, string> = {
    Diretor: "",
    Comprador: "",
    Gerente: "",
    Financeiro: "",
  };
  for (const [nome, chaves] of Object.entries(PAPEIS)) {
    const papel = await db.papel.create({
      data: {
        organizacaoId: org.id,
        nome,
        permissoes: { create: chaves.map((chave) => ({ chave })) },
      },
    });
    papeis[nome as keyof typeof PAPEIS] = papel.id;
  }

  async function pessoa(
    nome: string,
    papel: keyof typeof PAPEIS,
    unidadeId: string | null,
  ) {
    const usuario = await db.usuario.create({
      data: {
        nome,
        email: `${nome.toLowerCase().replace(/\s+/g, ".")}.${Date.now()}@exemplo.test`,
        status: "ATIVO",
      },
    });
    await db.acesso.create({
      data: {
        usuarioId: usuario.id,
        organizacaoId: org.id,
        unidadeId,
        papelId: papeis[papel],
      },
    });
    return usuario;
  }

  const diretor = await pessoa("Diretora Exemplo", "Diretor", null);
  const comprador = await pessoa("Comprador Exemplo", "Comprador", null);
  const gerenteCentro = await pessoa("Gerente Centro", "Gerente", centro.id);
  const gerenteSul = await pessoa("Gerente Sul", "Gerente", sul.id);
  const financeiro = await pessoa("Financeiro Exemplo", "Financeiro", null);

  const insumo = (
    nome: string,
    unidadeMedida: "KG" | "L" | "UN",
    estoqueMinimo: number,
    categoria: string,
  ) =>
    db.insumo.create({
      data: {
        organizacaoId: org.id,
        nome,
        unidadeMedida,
        estoqueMinimo,
        categoria,
        custoMedio: 0,
      },
    });

  const insumos = {
    mussarela: await insumo("Mussarela", "KG", 15, "Laticínios"),
    molho: await insumo("Molho de tomate", "KG", 10, "Mercearia"),
    embalagem: await insumo("Caixa de pizza", "UN", 200, "Embalagens"),
    oleo: await insumo("Óleo de soja", "L", 6, "Mercearia"),
  };

  const fornecedor = (nome: string, telefonePedidos: string) =>
    db.fornecedor.create({
      data: {
        organizacaoId: org.id,
        nome,
        telefonePedidos,
        autorizadoMensagens: true,
        autorizadoEm: new Date(),
        condicaoPagamento: "28 dias",
        prazoEntregaDias: 2,
      },
    });

  const fornecedores = {
    a: await fornecedor("Distribuidora Exemplo A", "5500000000001"),
    b: await fornecedor("Distribuidora Exemplo B", "5500000000002"),
    c: await fornecedor("Laticínio Exemplo", "5500000000003"),
  };

  const locais = {
    depositoCentro: await db.localEstoque.create({
      data: { unidadeId: centro.id, nome: "Depósito", ordem: 1 },
    }),
    depositoSul: await db.localEstoque.create({
      data: { unidadeId: sul.id, nome: "Depósito", ordem: 1 },
    }),
  };

  /** O contexto de uma pessoa numa loja (ou na rede, com `null`). */
  async function ctx(
    usuario: { id: string },
    unidade: { id: string } | null,
  ): Promise<ContextoSessao> {
    const c = await contextoDeFundo(usuario.id, unidade?.id ?? null);
    if (!c) {
      throw new Error("O cenário pediu um contexto que a pessoa não tem.");
    }
    return c;
  }

  return {
    org,
    centro,
    sul,
    papeis,
    diretor,
    comprador,
    gerenteCentro,
    gerenteSul,
    financeiro,
    insumos,
    fornecedores,
    locais,
    ctx,
  };
}
