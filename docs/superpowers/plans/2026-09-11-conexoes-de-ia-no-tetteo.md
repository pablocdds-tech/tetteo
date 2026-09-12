# Conexões de IA no Tetteo — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uma tela em Configurações › Integrações que lista as conexões de IA (quem, qual loja, qual cliente, uso) e permite revogar, com auditoria.

**Architecture:** Uma ponte em `src/connectors/mcp/` lê o esquema `mcp` por SQL direto e só escreve para revogar. A tela é server component; a confirmação é o único pedaço de cliente. O servidor MCP continua separado — só ganha o campo `fonte` no `/health`.

**Tech Stack:** Next.js 16 (App Router), Prisma 7 (`$queryRaw`), Zod 4, Tailwind 4, `node:test` via tsx.

**Spec:** `docs/superpowers/specs/2026-09-11-conexoes-de-ia-no-tetteo-design.md`

## Global Constraints

- A tela nunca mostra chave: o banco guarda só impressões digitais.
- A ponte escreve **apenas** `revogada_em` / `motivo_revogacao` e apaga as chaves daquela conexão. Nada mais.
- Permissão `configuracoes.integracoes` para ver e revogar.
- Sem o esquema `mcp` no banco, a tela explica em vez de quebrar.
- Textos em português do Brasil; comentários explicam o porquê, no estilo do projeto.
- Prettier da raiz; `npm run check` verde no fim.

## Mapa de arquivos

```
servicos/mcp/src/servidor.ts                      /health passa a dizer a fonte
servicos/mcp/src/servidor.integracao.ts           o teste do /health cobre a fonte
src/connectors/mcp/conexoes.ts                    listar e revogar (SQL direto)
src/connectors/mcp/saude.ts                       consulta o /health do servidor
src/connectors/mcp/index.ts                       o que a tela enxerga
src/connectors/mcp/saude.test.ts                  unidade
src/connectors/mcp/conexoes.integracao.ts         integração com banco real
src/core/configuracoes/permissoes.ts              chave configuracoes.integracoes
src/registro-de-apps.ts                           item "Conexões de IA" no menu
src/app/(shell)/configuracoes/page.tsx            a seção Integrações vira um link
src/app/(shell)/configuracoes/integracoes/page.tsx      a tela
src/app/(shell)/configuracoes/integracoes/acoes.ts      a ação de revogar
src/app/(shell)/configuracoes/integracoes/botao-revogar.tsx   confirmação (cliente)
.env.example                                      MCP_URL_PUBLICA
```

---

### Tarefa 1: O `/health` do MCP passa a dizer a fonte

**Files:**

- Modify: `servicos/mcp/src/servidor.ts`
- Modify: `servicos/mcp/src/servidor.integracao.ts`

- [ ] **Step 1: Ajustar o teste**

Em `servidor.integracao.ts`, no teste "/health responde sem nada sensível", trocar a lista de chaves esperadas e acrescentar a conferência da fonte:

```ts
assert.deepEqual(Object.keys(corpo).sort(), [
  "banco",
  "fonte",
  "servico",
  "status",
  "versao",
]);
assert.equal(corpo.banco, "ok");
assert.equal(corpo.fonte, "ficticia");
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `$env:MCP_ENSAIO_PG_URL = "<url local>"; npm run test:integracao --prefix servicos/mcp`
Expected: FAIL no teste do `/health` (falta `fonte`).

- [ ] **Step 3: Implementar**

Em `servicos/mcp/src/servidor.ts`, dentro de `app.get("/health", ...)`, a resposta passa a incluir a fonte:

```ts
res.set("Cache-Control", "no-store").json({
  status: "ok",
  servico: "tetteo-mcp",
  versao: VERSAO,
  banco: situacaoDoBanco,
  // A tela do Tetteo mostra isto: enquanto for "ficticia", ninguém deve
  // tomar decisão com esse número.
  fonte: deps.fonte.nome,
});
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:integracao --prefix servicos/mcp` e `npm run typecheck --prefix servicos/mcp`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add servicos/mcp/src/servidor.ts servicos/mcp/src/servidor.integracao.ts
git commit -m "MCP: o /health diz qual fonte de vendas está em uso"
```

---

### Tarefa 2: A ponte `connectors/mcp`

**Files:**

- Create: `src/connectors/mcp/conexoes.ts`, `src/connectors/mcp/saude.ts`, `src/connectors/mcp/index.ts`
- Test: `src/connectors/mcp/saude.test.ts`, `src/connectors/mcp/conexoes.integracao.ts`

**Interfaces:**

- Produces: `listarConexoesDeIa(contexto) → LeituraDeConexoes`, `revogarConexaoDeIa(contexto, id) → "revogada" | "ja-estava" | "nao-encontrada"`, `consultarSaudeDoMcp(env?) → SaudeDoMcp`.
- Tipos: `ConexaoDeIa { id, usuarioId, pessoa, email, unidadeNome, clienteNome, clienteHost, criadaEm, ultimoUsoEm, revogadaEm, motivo, consultas7Dias }`, `LeituraDeConexoes = { situacao: "ok"; conexoes } | { situacao: "sem-servidor" }`, `SaudeDoMcp = { situacao: "ok" | "nao-respondeu" | "sem-endereco"; endereco: string | null; versao?: string; fonte?: string; banco?: string }`.

- [ ] **Step 1: Escrever os testes**

```ts arquivo=src/connectors/mcp/saude.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { consultarSaudeDoMcp } from "./saude";

const endereco = "https://mcp.exemplo.com.br";

describe("saúde do servidor MCP", () => {
  it("sem endereço configurado, diz isso — não tenta adivinhar", async () => {
    const saude = await consultarSaudeDoMcp({}, async () => {
      throw new Error("não deveria buscar");
    });
    assert.equal(saude.situacao, "sem-endereco");
    assert.equal(saude.endereco, null);
  });

  it("resposta boa traz versão, fonte e banco", async () => {
    const saude = await consultarSaudeDoMcp(
      { MCP_URL_PUBLICA: endereco },
      async (url) => {
        assert.equal(url, `${endereco}/health`);
        return new Response(
          JSON.stringify({
            status: "ok",
            servico: "tetteo-mcp",
            versao: "1.0.0",
            banco: "ok",
            fonte: "ficticia",
          }),
          { status: 200 },
        );
      },
    );
    assert.equal(saude.situacao, "ok");
    assert.equal(saude.versao, "1.0.0");
    assert.equal(saude.fonte, "ficticia");
    assert.equal(saude.banco, "ok");
    assert.equal(saude.endereco, endereco);
  });

  it("erro de rede, demora ou status ruim viram 'não respondeu'", async () => {
    const casos = [
      async () => {
        throw new Error("timeout");
      },
      async () => new Response("", { status: 502 }),
      async () => new Response("isto não é json", { status: 200 }),
    ];
    for (const buscar of casos) {
      const saude = await consultarSaudeDoMcp(
        { MCP_URL_PUBLICA: endereco },
        buscar,
      );
      assert.equal(saude.situacao, "nao-respondeu");
      assert.equal(saude.endereco, endereco);
    }
  });
});
```

```ts arquivo=src/connectors/mcp/conexoes.integracao.ts
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { contextoDeFundo, type ContextoSessao } from "@/core/sessao/nucleo";
import { SemPermissao } from "@/lib/erros";
import { db } from "@/server/db";

import { listarConexoesDeIa, revogarConexaoDeIa } from "./conexoes";

/**
 * A ponte lê e revoga no esquema `mcp`, que pertence ao servidor MCP. O teste
 * cria esse esquema com o MESMO SQL do serviço, para não inventar um formato
 * que a produção não tem.
 */

const ESQUEMA_MCP = new URL(
  "../../../servicos/mcp/sql/02-tabelas.sql",
  import.meta.url,
);

let diretor: ContextoSessao;
let gerente: ContextoSessao;

async function limpar() {
  const [{ banco }] = await db.$queryRaw<{ banco: string }[]>`
    SELECT current_database() AS banco`;
  if (!banco.includes("_test")) throw new Error(`Recusado: ${banco}`);
  await db.$executeRawUnsafe("DROP SCHEMA IF EXISTS mcp CASCADE");
  await db.$executeRawUnsafe(
    `TRUNCATE "acesso", "papel_permissao", "papel", "usuario", "unidade", "organizacao", "auditoria" RESTART IDENTITY CASCADE`,
  );
}

async function montarCenario() {
  const { readFile } = await import("node:fs/promises");
  await db.$executeRawUnsafe("CREATE SCHEMA mcp");
  await db.$executeRawUnsafe(await readFile(ESQUEMA_MCP, "utf8"));

  const org = await db.organizacao.create({
    data: { nome: "Rede Exemplo", slug: `rede-${Date.now()}` },
  });
  const centro = await db.unidade.create({
    data: { organizacaoId: org.id, nome: "Centro", codigo: "CEN" },
  });
  const papelDiretor = await db.papel.create({
    data: {
      organizacaoId: org.id,
      nome: "Diretor",
      permissoes: { create: [{ chave: "*" }] },
    },
  });
  const papelGerente = await db.papel.create({
    data: {
      organizacaoId: org.id,
      nome: "Gerente",
      permissoes: { create: [{ chave: "financeiro.ver" }] },
    },
  });
  const dona = await db.usuario.create({
    data: { nome: "Dona", email: "dona@exemplo.test", status: "ATIVO" },
  });
  const outra = await db.usuario.create({
    data: { nome: "Gerente", email: "gerente@exemplo.test", status: "ATIVO" },
  });
  await db.acesso.create({
    data: {
      usuarioId: dona.id,
      organizacaoId: org.id,
      unidadeId: null,
      papelId: papelDiretor.id,
    },
  });
  await db.acesso.create({
    data: {
      usuarioId: outra.id,
      organizacaoId: org.id,
      unidadeId: centro.id,
      papelId: papelGerente.id,
    },
  });

  const conexao = await db.$queryRawUnsafe<{ id: string }[]>(
    `INSERT INTO mcp.conexao
       (usuario_id, unidade_id, versao_senha, client_id, cliente_nome, escopos, recurso, ultimo_uso_em)
     VALUES ($1, $2, 'versao', 'https://claude.ai/oauth/claude-code-client-metadata',
             'Claude Code', ARRAY['vendas:ler'], 'https://mcp.exemplo.com.br/mcp', now())
     RETURNING id`,
    dona.id,
    centro.id,
  );
  const conexaoId = conexao[0]!.id;

  // Duas consultas recentes e uma antiga: a tela conta os últimos 7 dias.
  await db.$executeRawUnsafe(
    `INSERT INTO mcp.chamada (conexao_id, ferramenta, argumentos, resultado, duracao_ms, criada_em) VALUES
       ($1, 'vendas_do_dia', '{}'::jsonb, 'ok', 12, now()),
       ($1, 'vendas_do_dia', '{}'::jsonb, 'ok', 15, now() - interval '2 days'),
       ($1, 'vendas_do_dia', '{}'::jsonb, 'erro', 9, now() - interval '30 days')`,
    conexaoId,
  );

  diretor = (await contextoDeFundo(dona.id, centro.id))!;
  gerente = (await contextoDeFundo(outra.id, centro.id))!;
  return { conexaoId, centro, dona };
}

describe("conexões de IA", () => {
  let cenario: Awaited<ReturnType<typeof montarCenario>>;

  before(async () => {
    await limpar();
  });

  beforeEach(async () => {
    await limpar();
    cenario = await montarCenario();
  });

  after(async () => {
    await db.$executeRawUnsafe("DROP SCHEMA IF EXISTS mcp CASCADE");
    await db.$disconnect();
  });

  it("lista com pessoa, loja, cliente e as consultas dos últimos 7 dias", async () => {
    const leitura = await listarConexoesDeIa(diretor);
    assert.equal(leitura.situacao, "ok");
    assert.ok(leitura.situacao === "ok");
    assert.equal(leitura.conexoes.length, 1);

    const linha = leitura.conexoes[0]!;
    assert.equal(linha.pessoa, "Dona");
    assert.equal(linha.email, "dona@exemplo.test");
    assert.equal(linha.unidadeNome, "Centro");
    assert.equal(linha.clienteNome, "Claude Code");
    assert.equal(linha.clienteHost, "claude.ai");
    assert.equal(linha.consultas7Dias, 2);
    assert.equal(linha.revogadaEm, null);
  });

  it("revoga, apaga as chaves, registra na auditoria e é idempotente", async () => {
    assert.equal(
      await revogarConexaoDeIa(diretor, cenario.conexaoId),
      "revogada",
    );

    const leitura = await listarConexoesDeIa(diretor);
    assert.ok(leitura.situacao === "ok");
    assert.ok(leitura.conexoes[0]!.revogadaEm instanceof Date);
    assert.match(leitura.conexoes[0]!.motivo ?? "", /Tetteo/);

    const [{ chaves }] = await db.$queryRaw<{ chaves: number }[]>`
      SELECT count(*)::int AS chaves FROM mcp.token`;
    assert.equal(chaves, 0);

    const auditoria = await db.auditoria.findFirst({
      where: { entidade: "ConexaoMcp" },
    });
    assert.equal(auditoria?.entidadeId, cenario.conexaoId);
    assert.equal(auditoria?.acao, "EXCLUIU");

    assert.equal(
      await revogarConexaoDeIa(diretor, cenario.conexaoId),
      "ja-estava",
    );
  });

  it("id desconhecido não é erro, é 'não encontrada'", async () => {
    assert.equal(
      await revogarConexaoDeIa(diretor, "id-que-nao-existe"),
      "nao-encontrada",
    );
  });

  it("sem a permissão, nem lista nem revoga", async () => {
    await assert.rejects(() => listarConexoesDeIa(gerente), SemPermissao);
    await assert.rejects(
      () => revogarConexaoDeIa(gerente, cenario.conexaoId),
      SemPermissao,
    );
  });

  it("sem o esquema mcp, a leitura avisa em vez de quebrar", async () => {
    await db.$executeRawUnsafe("DROP SCHEMA mcp CASCADE");
    const leitura = await listarConexoesDeIa(diretor);
    assert.equal(leitura.situacao, "sem-servidor");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test` e `npm run test:integracao`
Expected: FAIL — `./saude` e `./conexoes` não existem.

- [ ] **Step 3: Implementar**

```ts arquivo=src/connectors/mcp/saude.ts
/**
 * O SERVIDOR MCP RESPONDE?
 *
 * O `/health` dele não tem nada sensível: diz a versão, se o banco responde e
 * qual fonte de vendas está em uso. A tela do Tetteo mostra isso para que
 * ninguém precise abrir o painel do Dokploy para saber se a IA consegue
 * consultar.
 *
 * Dois segundos de limite: esta consulta não pode segurar o carregamento da
 * tela. Sem resposta, a tela diz "não respondeu agora" — nunca finge que está
 * tudo bem.
 */

export type SaudeDoMcp = {
  situacao: "ok" | "nao-respondeu" | "sem-endereco";
  endereco: string | null;
  versao?: string;
  fonte?: string;
  banco?: string;
};

type Buscar = (url: string, sinal: AbortSignal) => Promise<Response>;

const buscarNaRede: Buscar = (url, sinal) => fetch(url, { signal: sinal });

export async function consultarSaudeDoMcp(
  env: Record<string, string | undefined> = process.env,
  buscar: Buscar = buscarNaRede,
): Promise<SaudeDoMcp> {
  const endereco = (env.MCP_URL_PUBLICA ?? "").trim().replace(/\/$/, "");
  if (!endereco) return { situacao: "sem-endereco", endereco: null };

  try {
    const resposta = await buscar(
      `${endereco}/health`,
      AbortSignal.timeout(2000),
    );
    if (!resposta.ok) return { situacao: "nao-respondeu", endereco };
    const corpo = (await resposta.json()) as Record<string, unknown>;
    return {
      situacao: "ok",
      endereco,
      versao: typeof corpo.versao === "string" ? corpo.versao : undefined,
      fonte: typeof corpo.fonte === "string" ? corpo.fonte : undefined,
      banco: typeof corpo.banco === "string" ? corpo.banco : undefined,
    };
  } catch {
    return { situacao: "nao-respondeu", endereco };
  }
}
```

```ts arquivo=src/connectors/mcp/conexoes.ts
import { pode, type ContextoSessao } from "@/core/sessao/nucleo";
import { SemPermissao } from "@/lib/erros";
import { db } from "@/server/db";

/**
 * A PONTE COM O SERVIDOR MCP.
 *
 * O esquema `mcp` pertence ao servidor MCP, que roda em outro contêiner com um
 * papel de banco próprio. O Tetteo LÊ essas linhas para mostrar quem conectou
 * uma IA, e escreve numa única situação: revogar.
 *
 * Por que SQL direto: as tabelas não são do Prisma do Tetteo, e não devem ser.
 * Colocá-las no schema.prisma faria o Tetteo se achar dono delas — e a próxima
 * migração do Tetteo tentaria recriá-las.
 *
 * Nenhuma chave passa por aqui: o servidor MCP guarda só impressões digitais.
 */

export type ConexaoDeIa = {
  id: string;
  usuarioId: string;
  pessoa: string | null;
  email: string | null;
  unidadeNome: string | null;
  clienteNome: string;
  clienteHost: string;
  criadaEm: Date;
  ultimoUsoEm: Date | null;
  revogadaEm: Date | null;
  motivo: string | null;
  consultas7Dias: number;
};

export type LeituraDeConexoes =
  { situacao: "ok"; conexoes: ConexaoDeIa[] } | { situacao: "sem-servidor" };

const PERMISSAO = "configuracoes.integracoes";

function hostDe(clientId: string): string {
  try {
    return new URL(clientId).hostname;
  } catch {
    return clientId;
  }
}

/** O esquema existe neste banco? Em desenvolvimento, normalmente não. */
async function servidorPreparado(): Promise<boolean> {
  const [linha] = await db.$queryRaw<{ existe: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'mcp' AND table_name = 'conexao'
    ) AS existe`;
  return linha?.existe ?? false;
}

export async function listarConexoesDeIa(
  contexto: ContextoSessao,
): Promise<LeituraDeConexoes> {
  if (!pode(contexto, PERMISSAO)) {
    throw new SemPermissao("ver as conexões de IA");
  }
  if (!(await servidorPreparado())) return { situacao: "sem-servidor" };

  const linhas = await db.$queryRaw<
    {
      id: string;
      usuario_id: string;
      pessoa: string | null;
      email: string | null;
      unidade_nome: string;
      cliente_nome: string;
      client_id: string;
      criada_em: Date;
      ultimo_uso_em: Date | null;
      revogada_em: Date | null;
      motivo_revogacao: string | null;
      consultas: number;
    }[]
  >`
    SELECT x.id, x.usuario_id, u.nome AS pessoa, u.email,
           un.nome AS unidade_nome, x.cliente_nome, x.client_id,
           x.criada_em, x.ultimo_uso_em, x.revogada_em, x.motivo_revogacao,
           (SELECT count(*) FROM mcp.chamada c
             WHERE c.conexao_id = x.id
               AND c.criada_em > now() - interval '7 days')::int AS consultas
      FROM mcp.conexao x
      JOIN "unidade" un ON un.id = x.unidade_id
                       AND un."organizacaoId" = ${contexto.organizacao.id}
      LEFT JOIN "usuario" u ON u.id = x.usuario_id
     ORDER BY (x.revogada_em IS NOT NULL), x.criada_em DESC
     LIMIT 200`;

  return {
    situacao: "ok",
    conexoes: linhas.map((l) => ({
      id: l.id,
      usuarioId: l.usuario_id,
      pessoa: l.pessoa,
      email: l.email,
      unidadeNome: l.unidade_nome,
      clienteNome: l.cliente_nome,
      clienteHost: hostDe(l.client_id),
      criadaEm: l.criada_em,
      ultimoUsoEm: l.ultimo_uso_em,
      revogadaEm: l.revogada_em,
      motivo: l.motivo_revogacao,
      consultas7Dias: l.consultas,
    })),
  };
}

export type ResultadoDaRevogacao = "revogada" | "ja-estava" | "nao-encontrada";

/**
 * Revogar é o oposto de perigoso: tira acesso. Por isso vale a mesma permissão
 * de ver — exigir a permissão mais forte do sistema atrapalharia justamente na
 * hora em que se quer cortar rápido.
 */
export async function revogarConexaoDeIa(
  contexto: ContextoSessao,
  id: string,
): Promise<ResultadoDaRevogacao> {
  if (!pode(contexto, PERMISSAO)) {
    throw new SemPermissao("revogar conexões de IA");
  }
  if (!(await servidorPreparado())) return "nao-encontrada";

  const [conexao] = await db.$queryRaw<
    { id: string; revogada_em: Date | null }[]
  >`
    SELECT x.id, x.revogada_em
      FROM mcp.conexao x
      JOIN "unidade" un ON un.id = x.unidade_id
                       AND un."organizacaoId" = ${contexto.organizacao.id}
     WHERE x.id = ${id}`;
  if (!conexao) return "nao-encontrada";
  if (conexao.revogada_em) return "ja-estava";

  const motivo = `revogada no Tetteo por ${contexto.usuario.nome}`;
  await db.$executeRaw`
    UPDATE mcp.conexao
       SET revogada_em = now(), motivo_revogacao = ${motivo}
     WHERE id = ${id} AND revogada_em IS NULL`;
  // As chaves vão junto: enquanto existirem, valem até vencer.
  await db.$executeRaw`DELETE FROM mcp.token WHERE conexao_id = ${id}`;

  await db.auditoria.create({
    data: {
      organizacaoId: contexto.organizacao.id,
      unidadeId: contexto.unidadeAtiva?.id ?? null,
      usuarioId: contexto.usuario.id,
      entidade: "ConexaoMcp",
      entidadeId: id,
      acao: "EXCLUIU",
      valoresDepois: { revogada: true, motivo },
    },
  });

  return "revogada";
}
```

```ts arquivo=src/connectors/mcp/index.ts
export {
  listarConexoesDeIa,
  revogarConexaoDeIa,
  type ConexaoDeIa,
  type LeituraDeConexoes,
  type ResultadoDaRevogacao,
} from "./conexoes";
export { consultarSaudeDoMcp, type SaudeDoMcp } from "./saude";
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test` e `npm run test:integracao`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/connectors/mcp
git commit -m "Tetteo: a ponte que lê as conexões de IA e sabe revogar"
```

---

### Tarefa 3: A permissão, o menu e a tela

**Files:**

- Modify: `src/core/configuracoes/permissoes.ts`, `src/registro-de-apps.ts`, `src/app/(shell)/configuracoes/page.tsx`, `.env.example`
- Create: `src/app/(shell)/configuracoes/integracoes/page.tsx`, `acoes.ts`, `botao-revogar.tsx`

- [ ] **Step 1: A permissão**

Em `src/core/configuracoes/permissoes.ts`, dentro de `PERMISSOES_CONFIGURACOES`, depois de `configuracoes.auditoria`:

```ts
  {
    chave: "configuracoes.integracoes",
    descricao: "Ver e revogar as conexões de IA",
  },
```

- [ ] **Step 2: O menu**

Em `src/registro-de-apps.ts`, na navegação de Configurações, depois do item "Histórico":

```ts
      {
        rota: "/configuracoes/integracoes",
        nome: "Conexões de IA",
        permissao: "configuracoes.integracoes",
      },
```

- [ ] **Step 3: A variável de ambiente**

No fim de `.env.example`:

```
# -----------------------------------------------------------------------------
# SERVIDOR MCP (as ferramentas de consulta que o Claude usa)
# -----------------------------------------------------------------------------

# Endereço público do servidor MCP. Não é segredo — é ele que a tela
# Configurações › Conexões de IA consulta para dizer se o servidor respondeu.
MCP_URL_PUBLICA="https://mcp.vitalianopizzaria.com.br"
```

- [ ] **Step 4: A ação e a confirmação**

```ts arquivo=src/app/(shell)/configuracoes/integracoes/acoes.ts
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { revogarConexaoDeIa } from "@/connectors/mcp";
import { obterContexto } from "@/core/sessao/contexto";
import { SemPermissao } from "@/lib/erros";

export async function revogarConexaoAcao(dados: FormData): Promise<void> {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const id = String(dados.get("id") ?? "");
  if (!id) return;

  try {
    await revogarConexaoDeIa(contexto, id);
  } catch (erro) {
    // Sem permissão não é motivo para derrubar a tela: a lista recarrega e a
    // pessoa continua vendo o que já via.
    if (!(erro instanceof SemPermissao)) throw erro;
  }

  revalidatePath("/configuracoes/integracoes");
}
```

```tsx arquivo=src/app/(shell)/configuracoes/integracoes/botao-revogar.tsx
"use client";

import { useFormStatus } from "react-dom";

import { Botao } from "@/design-system/botao";

import { revogarConexaoAcao } from "./acoes";

/**
 * Revogar corta o acesso na chamada seguinte, e não tem desfazer: para voltar,
 * a pessoa conecta de novo pelo Claude, com a senha dela. Por isso pergunta
 * antes — com a pergunta do navegador, que já prende o foco, responde ao Esc e
 * é lida pelo leitor de tela.
 */
export function BotaoRevogar({ id, pessoa }: { id: string; pessoa: string }) {
  return (
    <form
      action={revogarConexaoAcao}
      onSubmit={(evento) => {
        if (
          !window.confirm(
            `Revogar a conexão de ${pessoa}? A IA para de consultar na próxima pergunta. Para voltar, é preciso conectar de novo pelo Claude.`,
          )
        ) {
          evento.preventDefault();
        }
      }}
    >
      <input type="hidden" name="id" value={id} />
      <Envio />
    </form>
  );
}

function Envio() {
  const { pending } = useFormStatus();
  return (
    <Botao
      type="submit"
      peso="destrutivo"
      tamanho="pequeno"
      carregando={pending}
    >
      Revogar
    </Botao>
  );
}
```

- [ ] **Step 5: A tela**

```tsx arquivo=src/app/(shell)/configuracoes/integracoes/page.tsx
import { notFound, redirect } from "next/navigation";

import { consultarSaudeDoMcp, listarConexoesDeIa } from "@/connectors/mcp";
import { obterContexto, pode } from "@/core/sessao/contexto";
import { Cartao } from "@/design-system/cartao";
import { Vazio } from "@/design-system/vazio";

import { BotaoRevogar } from "./botao-revogar";

/**
 * AS CONEXÕES DE IA.
 *
 * Quem autorizou uma IA a consultar o Tetteo, de qual loja, com qual programa,
 * e o que dá para fazer a respeito: revogar.
 *
 * Não existe "criar conexão" aqui de propósito. Conexão nasce só quando uma
 * pessoa entra com a própria senha na tela do servidor MCP, a pedido do
 * Claude. Um botão aqui criaria acesso sem esse gesto.
 */

const quando = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export default async function PaginaIntegracoes() {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");
  if (!pode(contexto, "configuracoes.integracoes")) notFound();

  const [leitura, saude] = await Promise.all([
    listarConexoesDeIa(contexto),
    consultarSaudeDoMcp(),
  ]);

  const ativas =
    leitura.situacao === "ok"
      ? leitura.conexoes.filter((c) => !c.revogadaEm).length
      : 0;

  return (
    <div className="mx-auto w-full max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight">Conexões de IA</h1>
      <p className="text-ink-3 mt-1 text-sm">
        Quem autorizou uma IA a consultar o Tetteo ·{" "}
        {ativas === 1 ? "1 conexão ativa" : `${ativas} conexões ativas`}
      </p>

      <Cartao className="mt-6 p-4">
        <p className="text-ink-3 font-mono text-[10px] tracking-[0.14em] uppercase">
          Servidor de consultas
        </p>
        {saude.situacao === "sem-endereco" ? (
          <p className="mt-1 text-sm">
            Falta configurar <code>MCP_URL_PUBLICA</code> no servidor. Sem isso
            não dá para saber se ele está no ar.
          </p>
        ) : (
          <>
            <p className="mt-1 font-medium break-all">{saude.endereco}</p>
            {saude.situacao === "ok" ? (
              <p className="text-ink-3 mt-1 text-sm">
                Respondeu agora · versão {saude.versao ?? "?"} · banco{" "}
                {saude.banco ?? "?"} · fonte das vendas:{" "}
                <strong>
                  {saude.fonte === "ficticia"
                    ? "fictícia"
                    : (saude.fonte ?? "?")}
                </strong>
                {saude.fonte === "ficticia" &&
                  " — os números que a IA devolve não são vendas reais."}
              </p>
            ) : (
              <p className="text-warn mt-1 text-sm">
                Não respondeu agora. Pode estar reiniciando; se continuar, veja
                a aplicação no painel do servidor.
              </p>
            )}
          </>
        )}
      </Cartao>

      {leitura.situacao === "sem-servidor" ? (
        <Cartao className="mt-6">
          <Vazio
            icone="engrenagem"
            titulo="O servidor MCP ainda não foi preparado neste banco"
            explicacao="Isto é o normal em desenvolvimento. Em produção, a preparação cria o espaço onde as conexões ficam."
          />
        </Cartao>
      ) : leitura.conexoes.length === 0 ? (
        <Cartao className="mt-6">
          <Vazio
            icone="brilho"
            titulo="Nenhuma IA conectada ainda"
            explicacao="Para conectar, adicione o endereço do servidor como conector no Claude e entre com sua conta do Tetteo. Cada pessoa conecta a sua."
          />
        </Cartao>
      ) : (
        <div className="border-line mt-6 overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[760px] text-sm">
            <caption className="sr-only">
              Conexões de IA autorizadas nesta rede
            </caption>
            <thead>
              <tr className="bg-surface-2 border-line border-b">
                <Cabecalho>Pessoa</Cabecalho>
                <Cabecalho>Loja</Cabecalho>
                <Cabecalho>Programa</Cabecalho>
                <Cabecalho>Consultas (7 dias)</Cabecalho>
                <Cabecalho>Último uso</Cabecalho>
                <th className="w-px px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {leitura.conexoes.map((conexao) => (
                <tr
                  key={conexao.id}
                  className={`border-line border-b last:border-b-0 ${conexao.revogadaEm ? "opacity-55" : ""}`}
                >
                  <td className="px-4 py-2.5">
                    <span className="block font-medium">
                      {conexao.pessoa ?? "(pessoa removida)"}
                      {conexao.revogadaEm && (
                        <span className="bg-bad-sub text-bad ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold">
                          revogada
                        </span>
                      )}
                    </span>
                    <span className="text-ink-3 block text-xs">
                      {conexao.email ?? conexao.usuarioId}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">{conexao.unidadeNome}</td>
                  <td className="px-4 py-2.5">
                    <span className="block">{conexao.clienteNome}</span>
                    <span className="text-ink-3 block text-xs">
                      {conexao.clienteHost}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 tabular-nums">
                    {conexao.consultas7Dias}
                  </td>
                  <td className="text-ink-2 px-4 py-2.5 text-xs tabular-nums">
                    {conexao.ultimoUsoEm
                      ? quando.format(conexao.ultimoUsoEm)
                      : "nunca usada"}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {conexao.revogadaEm ? (
                      <span className="text-ink-3 text-xs">
                        {conexao.motivo ?? "revogada"}
                      </span>
                    ) : (
                      <BotaoRevogar
                        id={conexao.id}
                        pessoa={conexao.pessoa ?? "esta pessoa"}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-ink-3 mt-4 text-sm">
        Revogar aqui corta o acesso na próxima pergunta que a IA fizer.
        Suspender a pessoa, tirar a permissão de Financeiro ou trocar a senha
        dela no Tetteo também derrubam as conexões.
      </p>
    </div>
  );
}

function Cabecalho({ children }: { children: React.ReactNode }) {
  return (
    <th className="text-ink-3 px-4 py-2.5 text-left text-xs font-semibold tracking-wider uppercase">
      {children}
    </th>
  );
}
```

- [ ] **Step 6: A seção Integrações vira um link**

Em `src/app/(shell)/configuracoes/page.tsx`, trocar o bloco tracejado "Nenhuma integração ligada" por:

```tsx
<Link
  href="/configuracoes/integracoes"
  className="border-line bg-surface-2 hover:border-accent mt-3 block rounded-xl border px-5 py-4 transition-colors"
>
  <p className="font-semibold">Conexões de IA</p>
  <p className="text-ink-3 mt-1 max-w-lg text-sm">
    Quem autorizou uma IA a consultar o Tetteo, de qual loja, e o botão de
    revogar. A ligação com o PDV ainda não existe — e um campo de token que não
    conecta em lugar nenhum seria só enfeite.
  </p>
</Link>
```

- [ ] **Step 7: Rodar tudo**

Run: `npm run check` (typecheck, lint, formatação e testes) e `npm run test:integracao`
Expected: tudo verde.

- [ ] **Step 8: Commit**

```bash
git add src .env.example
git commit -m "Tetteo: Configurações mostra as conexões de IA e deixa revogar"
```

---

### Tarefa 4: Verificação final e publicação

- [ ] **Step 1: A bateria inteira**

```powershell
npm run check
npm run test:integracao
npm run build
npm test --prefix servicos/mcp
$env:MCP_ENSAIO_PG_URL = "<url local>"; npm run test:integracao --prefix servicos/mcp
```

- [ ] **Step 2: Conferir na tela, com o app rodando**

`npm run dev` e abrir `/configuracoes/integracoes`: sem o esquema `mcp` no banco local, a tela precisa mostrar o aviso — não um erro.

- [ ] **Step 3: Publicar (com o OK do Pablo)**

Rebase sobre `origin/main`, `git push origin mcp-tela:main`, e acrescentar `MCP_URL_PUBLICA` ao ambiente da aplicação `tetteo-web` no Dokploy (não é segredo). Acompanhar o deploy e conferir a tela em produção.
