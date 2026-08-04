/**
 * Dados iniciais do Tetteo.
 *
 * Cria a organização, a primeira unidade, os papéis padrão e o usuário
 * administrador. É idempotente: rodar duas vezes não duplica nada.
 *
 * A senha do primeiro acesso é sorteada e gravada em
 * `credenciais-primeiro-acesso.txt` na raiz do projeto — nunca aparece no
 * terminal nem vai para o repositório. Deve ser trocada no primeiro login.
 */

import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { config as carregarEnv } from "dotenv";

carregarEnv({ path: ".env.local", quiet: true });

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

/**
 * Papéis padrão da rede.
 *
 * As permissões são TEXTO, e o vocabulário pertence a cada App — o Core só
 * guarda e confere a string. `*` significa "tudo", usado só pelo Diretor.
 */
const PAPEIS = [
  {
    nome: "Diretor",
    descricao: "Acesso total à rede inteira",
    permissoes: ["*"],
  },
  {
    nome: "Gerente",
    descricao: "Gerencia a operação de uma unidade",
    permissoes: [
      "cardapio.ver",
      "cardapio.editar",
      "estoque.ver",
      "estoque.contar",
      "compras.ver",
      "compras.lancar",
      "financeiro.ver",
    ],
  },
  {
    nome: "Caixa",
    descricao: "Operação de caixa e atendimento",
    permissoes: ["cardapio.ver", "financeiro.ver"],
  },
  {
    nome: "Cozinha",
    descricao: "Produção e conferência de insumos",
    permissoes: ["cardapio.ver", "estoque.ver", "estoque.contar"],
  },
  {
    nome: "Financeiro",
    descricao: "Contas a pagar, receber e fluxo de caixa",
    permissoes: ["financeiro.ver", "financeiro.lancar", "compras.ver"],
  },
] as const;

/**
 * As unidades que toda cozinha usa.
 *
 * "saco", "caixa" e "fardo" NÃO entram aqui: são vocabulário do fornecedor e
 * cada rede cadastra os seus. O que uma pizzaria compra em saco, outra compra
 * em fardo — e quanto pesa cada um depende do que está dentro, o que se
 * resolve em `conversao_unidade`, por insumo.
 *
 * Exatamente uma base por grandeza — o banco recusa a segunda.
 */
const UNIDADES_DE_MEDIDA = [
  {
    codigo: "kg",
    nome: "Quilograma",
    grandeza: "MASSA",
    fatorParaBase: "1",
    ehBase: true,
  },
  {
    codigo: "g",
    nome: "Grama",
    grandeza: "MASSA",
    fatorParaBase: "0.001",
    ehBase: false,
  },
  {
    codigo: "L",
    nome: "Litro",
    grandeza: "VOLUME",
    fatorParaBase: "1",
    ehBase: true,
  },
  {
    codigo: "ml",
    nome: "Mililitro",
    grandeza: "VOLUME",
    fatorParaBase: "0.001",
    ehBase: false,
  },
  {
    codigo: "un",
    nome: "Unidade",
    grandeza: "CONTAGEM",
    fatorParaBase: "1",
    ehBase: true,
  },
] as const;

async function main() {
  const organizacao = await db.organizacao.upsert({
    where: { slug: "vitaliano" },
    update: {},
    create: {
      nome: "Vitaliano Pizzaria",
      slug: "vitaliano",
      fusoHorario: "America/Sao_Paulo",
      moeda: "BRL",
    },
  });
  console.log(`organização: ${organizacao.nome}`);

  const unidade = await db.unidade.upsert({
    where: {
      organizacaoId_codigo: { organizacaoId: organizacao.id, codigo: "MATRIZ" },
    },
    update: {},
    create: {
      organizacaoId: organizacao.id,
      nome: "Matriz",
      codigo: "MATRIZ",
    },
  });
  console.log(`unidade: ${unidade.nome}`);

  // As unidades de medida são POR ORGANIZAÇÃO, e toda rede precisa das suas
  // antes de cadastrar o primeiro insumo — `insumo.unidadeEstoqueId` é
  // obrigatória desde a M3.
  //
  // Não dá para usar `upsert`: o código só é único entre as unidades não
  // excluídas, e isso vive num índice parcial que o Prisma não enxerga
  // (`prisma/schema/README.md`). Daí o findFirst antes.
  for (const medida of UNIDADES_DE_MEDIDA) {
    const jaExiste = await db.unidadeMedida.findFirst({
      where: {
        organizacaoId: organizacao.id,
        codigo: medida.codigo,
        excluidoEm: null,
      },
      select: { id: true },
    });
    if (jaExiste) continue;

    await db.unidadeMedida.create({
      data: { organizacaoId: organizacao.id, ...medida },
    });
  }
  console.log(
    `unidades de medida: ${UNIDADES_DE_MEDIDA.map((u) => u.codigo).join(", ")}`,
  );

  for (const papel of PAPEIS) {
    const registro = await db.papel.upsert({
      where: {
        organizacaoId_nome: {
          organizacaoId: organizacao.id,
          nome: papel.nome,
        },
      },
      update: { descricao: papel.descricao },
      create: {
        organizacaoId: organizacao.id,
        nome: papel.nome,
        descricao: papel.descricao,
        ehSistema: true,
      },
    });

    for (const chave of papel.permissoes) {
      await db.papelPermissao.upsert({
        where: { papelId_chave: { papelId: registro.id, chave } },
        update: {},
        create: { papelId: registro.id, chave },
      });
    }
  }
  console.log(`papéis: ${PAPEIS.map((p) => p.nome).join(", ")}`);

  const EMAIL_ADMIN = "pablocdds@gmail.com";
  const existente = await db.usuario.findUnique({
    where: { email: EMAIL_ADMIN },
  });

  let senhaGerada: string | null = null;
  if (!existente?.senhaHash) {
    // Sorteada aqui e gravada em arquivo — nunca impressa no terminal.
    senhaGerada = randomBytes(9).toString("base64url");
  }

  const usuario = await db.usuario.upsert({
    where: { email: EMAIL_ADMIN },
    update: {},
    create: {
      nome: "Pablo",
      email: EMAIL_ADMIN,
      status: "ATIVO",
      senhaHash: await bcrypt.hash(senhaGerada!, 12),
    },
  });
  console.log(`usuário: ${usuario.email}`);

  const diretor = await db.papel.findUniqueOrThrow({
    where: {
      organizacaoId_nome: { organizacaoId: organizacao.id, nome: "Diretor" },
    },
  });

  // unidadeId vazio = REDE INTEIRA. É o que separa o dono do gerente de loja.
  const acessoRede = await db.acesso.findFirst({
    where: {
      usuarioId: usuario.id,
      organizacaoId: organizacao.id,
      unidadeId: null,
    },
  });
  if (!acessoRede) {
    await db.acesso.create({
      data: {
        usuarioId: usuario.id,
        organizacaoId: organizacao.id,
        unidadeId: null,
        papelId: diretor.id,
      },
    });
  }
  console.log("acesso: Diretor · rede inteira");

  if (senhaGerada) {
    const caminho = join(process.cwd(), "credenciais-primeiro-acesso.txt");
    writeFileSync(
      caminho,
      [
        "TETTEO — PRIMEIRO ACESSO",
        "",
        `e-mail: ${EMAIL_ADMIN}`,
        `senha:  ${senhaGerada}`,
        "",
        "Troque esta senha no primeiro login.",
        "Este arquivo não vai para o repositório — apague depois de usar.",
        "",
      ].join("\n"),
      "utf8",
    );
    console.log(`\nsenha gravada em: credenciais-primeiro-acesso.txt`);
  } else {
    console.log("\nusuário já tinha senha — nada alterado");
  }
}

main()
  .catch((erro) => {
    console.error(erro);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
