# Servidor MCP do Tetteo — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Servidor MCP remoto (Express 5 + SDK 2.0.0) com a ferramenta somente-leitura `vendas_do_dia`, protegido por OAuth 2.1 (CIMD, login com a conta do Tetteo), sem sessão em memória, pronto para o Dokploy.

**Architecture:** Serviço próprio em `servicos/mcp/` no repositório do Tetteo. O mesmo processo é servidor de recurso (`/mcp`) e servidor de autorização (`/oauth/*`). O estado (conexões, chaves em hash) mora no esquema `mcp` do Postgres do Tetteo, acessado por um papel `tetteo_mcp` que só lê duas visões do esquema `mcp_leitura`. A fonte das vendas é uma interface; hoje só existe a fictícia.

**Tech Stack:** Node 24, TypeScript 5.9 (NodeNext/ESM), Express 5.2.1, `@modelcontextprotocol/server|express|node` 2.0.0, `@modelcontextprotocol/client` 2.0.0 (testes), Zod 4.4.3, `pg` 8.23, `bcryptjs` 3.0.3, `node:test` via `tsx`.

**Spec:** `docs/superpowers/specs/2026-09-11-servidor-mcp-design.md`

## Global Constraints

- Somente consulta. Nenhuma ferramenta escreve, paga ou altera pedido.
- Token, código, senha e e-mail nunca aparecem em log, URL ou código. Chaves só em hash SHA-256 no banco.
- Sem sessão em memória: `createMcpHandler(..., { legacy: "stateless" })`. Cache do documento CIMD em memória é permitido (não é sessão).
- Recurso canônico: `${MCP_URL_PUBLICA}/mcp`. Emissor: `MCP_URL_PUBLICA` sem barra final.
- Escopo único: `vendas:ler`. Permissão do Tetteo exigida: `*`, `financeiro.*` ou `financeiro.ver` na loja.
- Chave de acesso 1 h (`tmcp_`), renovação 30 dias com troca a cada uso (`tmcr_`), código 2 min (`tmcc_`), pedido 10 min (`tmcq_`).
- Limites: JSON 64 KB, formulário 16 KB; `requestTimeout` 30 s, `headersTimeout` 15 s, ferramenta 8 s, consulta 5 s, conexão ao banco 3 s.
- Clientes: só CIMD de hosts em `MCP_CLIENTES_CONFIAVEIS` (padrão `claude.ai,claude.com`). Sem DCR.
- Textos para pessoas em português do Brasil. Comentários explicam o porquê, no estilo do resto do Tetteo.
- Formatação: Prettier da raiz (`semi`, aspas duplas, `trailingComma: all`, 80 colunas).
- Testes de integração só com `MCP_ENSAIO_PG_URL` apontando para Postgres **local**; o banco criado tem `_test` no nome e é apagado no fim.

## Mapa de arquivos

```
servicos/mcp/
  package.json, package-lock.json, tsconfig.json, tsconfig.build.json
  .gitignore, .dockerignore, Dockerfile, README.md
  sql/01-preparar-banco.sql     papel, esquemas, visões, permissões (roda o administrador)
  sql/02-tabelas.sql            tabelas do esquema mcp (roda o serviço ao subir)
  src/
    config.ts                   variáveis de ambiente → Config
    registro.ts                 log JSON sem segredos
    principal.ts                sobe o servidor, tempos, sinais
    servidor.ts                 monta o Express: proteções, rotas, /mcp
    fontes/tipos.ts             interface FonteDeVendas
    fontes/ficticia.ts          fonte determinística
    mcp/data.ts                 schema da data
    mcp/vendas-do-dia.ts        registra a ferramenta
    mcp/servidor-mcp.ts         fábrica do McpServer por requisição
    banco/conexao.ts            pool pg com tempos
    banco/tabelas.ts            aplica 02-tabelas.sql
    banco/tetteo.ts             leituras nas visões mcp_leitura
    oauth/segredos.ts           geração, hash, PKCE
    oauth/escopos.ts            escopos
    oauth/redirecionamento.ts   comparação de redirect_uri
    oauth/cliente.ts            resolvedor CIMD
    oauth/metadados.ts          metadados RFC 8414 / 9728
    oauth/armazem.ts            SQL do esquema mcp (pedido, conexão, código, chave)
    oauth/paginas.ts            HTML de login, escolha, erro
    oauth/rotas-autorizar.ts    GET/POST /oauth/authorize
    oauth/rotas-token.ts        POST /oauth/token e /oauth/revoke
    oauth/verificador.ts        OAuthTokenVerifier
    admin/conexoes.ts           listar/revogar pelo terminal
    ensaio/banco-de-ensaio.ts   cria banco descartável com as migrações reais
    ensaio/semente.ts           organização, lojas, pessoas de ensaio
    ensaio/ambiente.ts          sobe o app num porto livre + fluxo OAuth pronto
    **/*.test.ts                testes de unidade
    **/*.integracao.ts          testes com banco
Raiz do Tetteo: tsconfig.json (exclude), eslint.config.mjs (globalIgnores),
.dockerignore e .prettierignore — para o app principal ignorar servicos/.
```

Cada bloco de código marcado com `arquivo=<caminho>` é o conteúdo integral daquele
arquivo, relativo à raiz do repositório.

---

### Tarefa 1: Esqueleto do serviço e configuração

**Files:**

- Create: `servicos/mcp/package.json`, `servicos/mcp/tsconfig.json`, `servicos/mcp/tsconfig.build.json`, `servicos/mcp/.gitignore`
- Create: `servicos/mcp/src/config.ts`, Test: `servicos/mcp/src/config.test.ts`
- Modify: `tsconfig.json` (exclude), `eslint.config.mjs` (globalIgnores), `.dockerignore`, `.prettierignore`

**Interfaces:**

- Produces: `lerConfig(env?): Config` e o tipo `Config` = `{ ambiente, porta, bancoUrl, emissor, urlPublica, urlMcp, hostsPermitidos, clientesConfiaveis, fonte }`.

- [ ] **Step 1: Criar o pacote**

```json arquivo=servicos/mcp/package.json
{
  "name": "tetteo-mcp",
  "version": "1.0.0",
  "private": true,
  "description": "Servidor MCP do Tetteo: ferramentas de consulta para o Claude",
  "type": "module",
  "engines": {
    "node": ">=24"
  },
  "scripts": {
    "dev": "tsx watch src/principal.ts",
    "build": "tsc -p tsconfig.build.json",
    "start": "node dist/principal.js",
    "typecheck": "tsc --noEmit",
    "test": "tsx --test \"src/**/*.test.ts\"",
    "test:integracao": "tsx --test --test-concurrency=1 \"src/**/*.integracao.ts\"",
    "conexoes": "tsx src/admin/conexoes.ts"
  },
  "dependencies": {
    "@modelcontextprotocol/express": "2.0.0",
    "@modelcontextprotocol/node": "2.0.0",
    "@modelcontextprotocol/server": "2.0.0",
    "bcryptjs": "3.0.3",
    "express": "5.2.1",
    "hono": "4.13.7",
    "pg": "8.23.0",
    "zod": "4.4.3"
  },
  "devDependencies": {
    "@modelcontextprotocol/client": "2.0.0",
    "@types/express": "5.0.6",
    "@types/node": "24.13.4",
    "@types/pg": "8.23.1",
    "tsx": "4.23.13",
    "typescript": "5.9.3"
  }
}
```

```json arquivo=servicos/mcp/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "types": ["node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src"]
}
```

```json arquivo=servicos/mcp/tsconfig.build.json
{
  "extends": "./tsconfig.json",
  "exclude": ["src/**/*.test.ts", "src/**/*.integracao.ts", "src/ensaio/**"]
}
```

```gitignore arquivo=servicos/mcp/.gitignore
node_modules/
dist/
.env*
```

Run: `npm install --prefix servicos/mcp --no-audit --no-fund`
Expected: cria `servicos/mcp/node_modules` e `servicos/mcp/package-lock.json`.

- [ ] **Step 2: Fazer o app principal ignorar `servicos/`**

Em `tsconfig.json`, trocar `"exclude": ["node_modules"]` por `"exclude": ["node_modules", "servicos"]`.

Em `eslint.config.mjs`, dentro de `globalIgnores([...])`, logo depois de `".impeccable/**",`:

```js
    // Serviços com package.json, lint e testes próprios (ex.: servicos/mcp).
    "servicos/**",
```

No fim de `.dockerignore`:

```
# serviços publicados como aplicações próprias no Dokploy
servicos
```

No fim de `.prettierignore`:

```
# saída de compilação dos serviços
servicos/*/dist/
```

- [ ] **Step 3: Escrever o teste da configuração**

```ts arquivo=servicos/mcp/src/config.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { lerConfig } from "./config.js";

const base = {
  DATABASE_URL: "postgresql://tetteo_mcp:segredo@localhost:5432/tetteo",
  MCP_URL_PUBLICA: "https://mcp.exemplo.com.br",
};

describe("lerConfig", () => {
  it("monta emissor e recurso a partir da URL pública", () => {
    const config = lerConfig({ ...base, NODE_ENV: "production" });

    assert.equal(config.emissor, "https://mcp.exemplo.com.br");
    assert.equal(config.urlMcp.href, "https://mcp.exemplo.com.br/mcp");
    assert.deepEqual(config.hostsPermitidos, [
      "mcp.exemplo.com.br",
      "localhost",
      "127.0.0.1",
    ]);
    assert.deepEqual(config.clientesConfiaveis, ["claude.ai", "claude.com"]);
    assert.equal(config.porta, 8080);
    assert.equal(config.fonte, "ficticia");
  });

  it("recusa http em produção", () => {
    assert.throws(
      () =>
        lerConfig({
          ...base,
          NODE_ENV: "production",
          MCP_URL_PUBLICA: "http://mcp.exemplo.com.br",
        }),
      /https/,
    );
  });

  it("aceita http em desenvolvimento", () => {
    const config = lerConfig({
      ...base,
      MCP_URL_PUBLICA: "http://127.0.0.1:8787",
    });
    assert.equal(config.emissor, "http://127.0.0.1:8787");
  });

  it("recusa URL pública com caminho", () => {
    assert.throws(
      () =>
        lerConfig({
          ...base,
          MCP_URL_PUBLICA: "https://mcp.exemplo.com.br/mcp",
        }),
      /sem caminho/,
    );
  });

  it("nomeia a variável que falta", () => {
    assert.throws(
      () => lerConfig({ MCP_URL_PUBLICA: base.MCP_URL_PUBLICA }),
      /DATABASE_URL/,
    );
  });

  it("nunca repete o valor da DATABASE_URL no erro", () => {
    assert.throws(
      () => lerConfig({ ...base, DATABASE_URL: "mysql://u:segredo@h/banco" }),
      (erro: Error) =>
        /DATABASE_URL/.test(erro.message) && !erro.message.includes("segredo"),
    );
  });

  it("normaliza listas com espaços e maiúsculas", () => {
    const config = lerConfig({
      ...base,
      MCP_HOSTS_PERMITIDOS: " MCP.exemplo.com.br , localhost ",
      MCP_CLIENTES_CONFIAVEIS: "Claude.ai",
    });
    assert.deepEqual(config.hostsPermitidos, [
      "mcp.exemplo.com.br",
      "localhost",
    ]);
    assert.deepEqual(config.clientesConfiaveis, ["claude.ai"]);
  });
});
```

- [ ] **Step 4: Rodar e ver falhar**

Run: `npm test --prefix servicos/mcp`
Expected: FAIL — `Cannot find module './config.js'`.

- [ ] **Step 5: Implementar**

```ts arquivo=servicos/mcp/src/config.ts
import { z } from "zod";

/**
 * A CONFIGURAÇÃO DO SERVIDOR, lida uma vez e validada na subida.
 *
 * Um servidor que sobe com a URL pública errada publica metadados OAuth que o
 * Claude rejeita sem dizer por quê — a pessoa só vê "não consegui conectar".
 * Por isso a validação acontece na largada, e o erro nomeia a variável. Nunca
 * o valor: `DATABASE_URL` carrega a senha do banco.
 */

const lista = (texto: string) =>
  texto
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

const esquema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, {
    error: "precisa começar com postgresql://",
  }),
  MCP_URL_PUBLICA: z.string().min(1),
  MCP_HOSTS_PERMITIDOS: z.string().optional(),
  MCP_CLIENTES_CONFIAVEIS: z.string().default("claude.ai,claude.com"),
  MCP_FONTE: z.enum(["ficticia"]).default("ficticia"),
});

export type Config = {
  ambiente: "development" | "production" | "test";
  porta: number;
  bancoUrl: string;
  /** A origem pública, sem barra final. É o `issuer` do OAuth. */
  emissor: string;
  urlPublica: URL;
  /** O recurso canônico (RFC 8707): o endereço onde o Claude fala MCP. */
  urlMcp: URL;
  hostsPermitidos: string[];
  clientesConfiaveis: string[];
  fonte: "ficticia";
};

export function lerConfig(
  env: Record<string, string | undefined> = process.env,
): Config {
  const analise = esquema.safeParse(env);
  if (!analise.success) {
    const problemas = analise.error.issues
      .map((problema) => `${problema.path.join(".")}: ${problema.message}`)
      .join("; ");
    throw new Error(`Configuração inválida — ${problemas}`);
  }
  const e = analise.data;

  let url: URL;
  try {
    url = new URL(e.MCP_URL_PUBLICA);
  } catch {
    throw new Error("Configuração inválida — MCP_URL_PUBLICA não é uma URL");
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error(
      "Configuração inválida — MCP_URL_PUBLICA deve ser só a origem, sem caminho (ex.: https://mcp.exemplo.com.br)",
    );
  }
  if (e.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error(
      "Configuração inválida — em produção MCP_URL_PUBLICA precisa ser https",
    );
  }

  const emissor = url.origin;
  return {
    ambiente: e.NODE_ENV,
    porta: e.PORT,
    bancoUrl: e.DATABASE_URL,
    emissor,
    urlPublica: new URL(emissor),
    urlMcp: new URL("/mcp", emissor),
    hostsPermitidos: lista(
      e.MCP_HOSTS_PERMITIDOS ?? `${url.hostname},localhost,127.0.0.1`,
    ),
    clientesConfiaveis: lista(e.MCP_CLIENTES_CONFIAVEIS),
    fonte: e.MCP_FONTE,
  };
}
```

- [ ] **Step 6: Rodar e ver passar**

Run: `npm test --prefix servicos/mcp` e `npm run typecheck --prefix servicos/mcp`
Expected: 7 testes PASS; typecheck sem erros.

- [ ] **Step 7: Commit**

```bash
git add servicos/mcp tsconfig.json eslint.config.mjs .dockerignore .prettierignore
git commit -m "MCP: o esqueleto do serviço e a configuração que recusa subir errada"
```

---

### Tarefa 2: Registro sem segredos, fonte fictícia e schema da data

**Files:**

- Create: `servicos/mcp/src/registro.ts`, Test: `servicos/mcp/src/registro.test.ts`
- Create: `servicos/mcp/src/fontes/tipos.ts`, `servicos/mcp/src/fontes/ficticia.ts`, Test: `servicos/mcp/src/fontes/ficticia.test.ts`
- Create: `servicos/mcp/src/mcp/data.ts`, Test: `servicos/mcp/src/mcp/data.test.ts`

**Interfaces:**

- Produces: `criarRegistro(escrever?)`, `registroSilencioso`, tipo `Registro` com `info|aviso|erro(mensagem, dados?)`.
- Produces: `FonteDeVendas { nome; ehFicticia; vendasDoDia({unidadeId, data}, sinal) → {quantidade, totalCentavos} }`, `criarFonteFicticia()`, `pedidosFicticios({unidadeId, data}) → {numero, valorCentavos}[]`.
- Produces: `esquemaData(agora?)`, `hojeEmSaoPaulo(agora?)`, `DATA_MINIMA`.

- [ ] **Step 1: Escrever os testes**

```ts arquivo=servicos/mcp/src/registro.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { criarRegistro } from "./registro.js";

function capturar() {
  const linhas: Record<string, unknown>[] = [];
  const registro = criarRegistro((linha) => linhas.push(JSON.parse(linha)));
  return { linhas, registro };
}

describe("registro", () => {
  it("escreve uma linha JSON com hora, nível e mensagem", () => {
    const { linhas, registro } = capturar();
    registro.info("requisicao", { caminho: "/mcp", status: 200 });

    assert.equal(linhas.length, 1);
    assert.equal(linhas[0]?.nivel, "info");
    assert.equal(linhas[0]?.mensagem, "requisicao");
    assert.equal(linhas[0]?.caminho, "/mcp");
    assert.match(String(linhas[0]?.hora), /^\d{4}-\d{2}-\d{2}T/);
  });

  it("apaga token, senha, e-mail e cabeçalho de autorização, inclusive aninhados", () => {
    const { linhas, registro } = capturar();
    registro.aviso("tentativa", {
      access_token: "tmcp_abc",
      senha: "123",
      email: "a@b.c",
      cabecalhos: { authorization: "Bearer tmcp_abc", accept: "json" },
    });

    const texto = JSON.stringify(linhas[0]);
    assert.ok(!texto.includes("tmcp_abc"));
    assert.ok(!texto.includes("a@b.c"));
    assert.ok(!texto.includes('"123"'));
    assert.equal(
      (linhas[0]?.cabecalhos as Record<string, string>).accept,
      "json",
    );
  });

  it("transforma Error em nome e mensagem", () => {
    const { linhas, registro } = capturar();
    registro.erro("falhou", { erro: new TypeError("quebrou") });

    const erro = linhas[0]?.erro as Record<string, string>;
    assert.equal(erro.nome, "TypeError");
    assert.equal(erro.mensagem, "quebrou");
  });
});
```

```ts arquivo=servicos/mcp/src/fontes/ficticia.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { criarFonteFicticia, pedidosFicticios } from "./ficticia.js";

const consulta = { unidadeId: "uni_centro", data: "2026-09-10" };

describe("fonte fictícia", () => {
  it("gera sempre os mesmos pedidos para a mesma loja e data", () => {
    assert.deepEqual(pedidosFicticios(consulta), pedidosFicticios(consulta));
  });

  it("muda quando muda a data ou a loja", () => {
    const base = JSON.stringify(pedidosFicticios(consulta));
    assert.notEqual(
      JSON.stringify(pedidosFicticios({ ...consulta, data: "2026-09-09" })),
      base,
    );
    assert.notEqual(
      JSON.stringify(pedidosFicticios({ ...consulta, unidadeId: "uni_sul" })),
      base,
    );
  });

  it("gera quantidades e valores plausíveis", () => {
    const pedidos = pedidosFicticios(consulta);
    assert.ok(pedidos.length >= 45 && pedidos.length < 140);
    for (const pedido of pedidos) {
      assert.ok(Number.isInteger(pedido.valorCentavos));
      assert.ok(pedido.valorCentavos >= 3500 && pedido.valorCentavos < 16000);
    }
  });

  it("devolve a soma exata dos pedidos", async () => {
    const fonte = criarFonteFicticia();
    const pedidos = pedidosFicticios(consulta);
    const resumo = await fonte.vendasDoDia(
      consulta,
      new AbortController().signal,
    );

    assert.equal(resumo.quantidade, pedidos.length);
    assert.equal(
      resumo.totalCentavos,
      pedidos.reduce((soma, pedido) => soma + pedido.valorCentavos, 0),
    );
    assert.equal(fonte.ehFicticia, true);
    assert.equal(fonte.nome, "ficticia");
  });

  it("respeita o cancelamento", async () => {
    const controle = new AbortController();
    controle.abort();
    await assert.rejects(
      criarFonteFicticia().vendasDoDia(consulta, controle.signal),
    );
  });
});
```

```ts arquivo=servicos/mcp/src/mcp/data.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { esquemaData, hojeEmSaoPaulo } from "./data.js";

// 11/09/2026 às 01h UTC ainda é 10/09 em Brasília.
const agora = () => new Date("2026-09-11T01:00:00Z");
const esquema = esquemaData(agora);

describe("esquema da data", () => {
  it("usa o dia de Brasília, não o de Greenwich", () => {
    assert.equal(hojeEmSaoPaulo(agora()), "2026-09-10");
  });

  it("aceita hoje e dias passados", () => {
    assert.equal(esquema.parse("2026-09-10"), "2026-09-10");
    assert.equal(esquema.parse("2024-02-29"), "2024-02-29");
  });

  for (const [caso, valor] of [
    ["formato brasileiro", "10/09/2026"],
    ["dia que não existe", "2026-02-31"],
    ["29 de fevereiro fora de ano bissexto", "2026-02-29"],
    ["texto solto", "ontem"],
    ["data futura", "2026-09-11"],
    ["antes de 2020", "2019-12-31"],
  ] as const) {
    it(`recusa ${caso}`, () => {
      assert.equal(esquema.safeParse(valor).success, false);
    });
  }

  it("explica o formato esperado quando recusa", () => {
    const analise = esquema.safeParse("10/09/2026");
    assert.match(String(analise.error?.issues[0]?.message), /AAAA-MM-DD/);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test --prefix servicos/mcp`
Expected: FAIL — módulos `./registro.js`, `./ficticia.js` e `./data.js` não existem.

- [ ] **Step 3: Implementar**

```ts arquivo=servicos/mcp/src/registro.ts
/**
 * O REGISTRO DO SERVIDOR: uma linha JSON por evento, que o Dokploy guarda.
 *
 * Duas regras que não se negociam. Nada de token, código, senha ou e-mail aqui
 * dentro — as chaves perigosas são apagadas pelo NOME, porque ninguém lembra
 * de limpar o valor em todo lugar que registra. E nada de query string: quem
 * registra uma requisição passa `req.path`, nunca `req.url`.
 */

export type Nivel = "info" | "aviso" | "erro";

export type Registro = Record<
  Nivel,
  (mensagem: string, dados?: Record<string, unknown>) => void
>;

const PROIBIDAS =
  /token|senha|password|secret|segredo|authorization|cookie|code|codigo|verifier|email/i;

function limpar(valor: unknown, profundidade = 0): unknown {
  if (valor instanceof Error) {
    return { nome: valor.name, mensagem: valor.message, pilha: valor.stack };
  }
  if (profundidade > 4 || valor === null || typeof valor !== "object") {
    return valor;
  }
  if (Array.isArray(valor)) {
    return valor.map((item) => limpar(item, profundidade + 1));
  }
  return Object.fromEntries(
    Object.entries(valor).map(([chave, item]) => [
      chave,
      PROIBIDAS.test(chave) ? "[omitido]" : limpar(item, profundidade + 1),
    ]),
  );
}

export function criarRegistro(
  escrever: (linha: string) => void = (linha) =>
    process.stdout.write(`${linha}\n`),
): Registro {
  const emitir =
    (nivel: Nivel) =>
    (mensagem: string, dados: Record<string, unknown> = {}) => {
      escrever(
        JSON.stringify({
          hora: new Date().toISOString(),
          nivel,
          mensagem,
          ...(limpar(dados) as Record<string, unknown>),
        }),
      );
    };
  return { info: emitir("info"), aviso: emitir("aviso"), erro: emitir("erro") };
}

/** Para testes que não querem poluir a saída. */
export const registroSilencioso: Registro = {
  info() {},
  aviso() {},
  erro() {},
};
```

```ts arquivo=servicos/mcp/src/fontes/tipos.ts
/**
 * DE ONDE VÊM AS VENDAS.
 *
 * A ferramenta não sabe — e não deve saber — se o número vem de um gerador de
 * ensaio, do banco do Tetteo ou do Cardápio Web. Trocar a fonte é trocar a
 * implementação desta interface; o contrato que o Claude enxerga não muda.
 */

export type ConsultaDeVendas = {
  unidadeId: string;
  /** AAAA-MM-DD, dia de Brasília. */
  data: string;
};

export type ResumoDeVendas = {
  quantidade: number;
  /** Dinheiro em centavos inteiros: somar reais em ponto flutuante erra. */
  totalCentavos: number;
};

export interface FonteDeVendas {
  readonly nome: "ficticia";
  /** Quando verdadeiro, toda resposta leva o aviso de dados fictícios. */
  readonly ehFicticia: boolean;
  vendasDoDia(
    consulta: ConsultaDeVendas,
    sinal: AbortSignal,
  ): Promise<ResumoDeVendas>;
}
```

```ts arquivo=servicos/mcp/src/fontes/ficticia.ts
import { createHash } from "node:crypto";

import type { ConsultaDeVendas, FonteDeVendas } from "./tipos.js";

/**
 * A FONTE DE ENSAIO.
 *
 * Existe para testar o contrato antes de haver venda real no Tetteo. É
 * DETERMINÍSTICA: a mesma loja e a mesma data geram sempre os mesmos pedidos.
 * É isso que permite conferir a resposta da ferramenta contra "a fonte
 * original" — recalcular por fora, a partir da mesma lista, e comparar.
 *
 * Os números são plausíveis de propósito (mais pedidos de sexta a domingo),
 * mas cada resposta sai marcada como fictícia pela ferramenta.
 */

export type PedidoFicticio = { numero: number; valorCentavos: number };

/** mulberry32: pequeno, rápido e repetível a partir de uma semente. */
function gerador(semente: Buffer): () => number {
  let estado = semente.readUInt32LE(0);
  return () => {
    estado = (estado + 0x6d2b79f5) | 0;
    let t = Math.imul(estado ^ (estado >>> 15), 1 | estado);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pedidosFicticios({
  unidadeId,
  data,
}: ConsultaDeVendas): PedidoFicticio[] {
  const aleatorio = gerador(
    createHash("sha256").update(`${unidadeId}|${data}`).digest(),
  );
  const diaDaSemana = new Date(`${data}T12:00:00Z`).getUTCDay();
  const movimentado = diaDaSemana === 0 || diaDaSemana >= 5;
  const quantidade = (movimentado ? 90 : 45) + Math.floor(aleatorio() * 50);

  return Array.from({ length: quantidade }, (_, indice) => ({
    numero: indice + 1,
    valorCentavos: 3500 + Math.floor(aleatorio() * 12500),
  }));
}

export function criarFonteFicticia(): FonteDeVendas {
  return {
    nome: "ficticia",
    ehFicticia: true,
    async vendasDoDia(consulta, sinal) {
      sinal.throwIfAborted();
      const pedidos = pedidosFicticios(consulta);
      return {
        quantidade: pedidos.length,
        totalCentavos: pedidos.reduce(
          (soma, pedido) => soma + pedido.valorCentavos,
          0,
        ),
      };
    },
  };
}
```

```ts arquivo=servicos/mcp/src/mcp/data.ts
import { z } from "zod";

/**
 * A DATA QUE O CLAUDE PODE PEDIR.
 *
 * "Hoje" é o dia de Brasília: a loja fecha à meia-noite daqui, não de
 * Greenwich. Às 22h de uma quinta, "hoje" ainda é quinta — no relógio do
 * servidor em UTC já seria sexta, e a pergunta "quanto vendi hoje?" viraria
 * uma data futura recusada.
 */

export const DATA_MINIMA = "2020-01-01";

export function hojeEmSaoPaulo(agora: Date = new Date()): string {
  // en-CA formata como AAAA-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(agora);
}

export function esquemaData(agora: () => Date = () => new Date()) {
  return z.iso
    .date({
      error:
        "Use o formato AAAA-MM-DD com uma data que exista (ex.: 2026-09-10).",
    })
    .refine((data) => data >= DATA_MINIMA, {
      error: `A data precisa ser a partir de ${DATA_MINIMA}.`,
    })
    .refine((data) => data <= hojeEmSaoPaulo(agora()), {
      error: "A data não pode estar no futuro (horário de Brasília).",
    })
    .describe(
      "Dia a consultar, no formato AAAA-MM-DD, no horário de Brasília. Ex.: 2026-09-10",
    );
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test --prefix servicos/mcp` e `npm run typecheck --prefix servicos/mcp`
Expected: todos PASS; typecheck sem erros.

- [ ] **Step 5: Commit**

```bash
git add servicos/mcp/src
git commit -m "MCP: o registro que não guarda segredo, a fonte de ensaio e a data de Brasília"
```

---

### Tarefa 3: A ferramenta `vendas_do_dia` e a fábrica do servidor MCP

**Files:**

- Create: `servicos/mcp/src/mcp/vendas-do-dia.ts`, `servicos/mcp/src/mcp/servidor-mcp.ts`
- Test: `servicos/mcp/src/mcp/vendas-do-dia.test.ts`

**Interfaces:**

- Consumes: `FonteDeVendas`, `Registro`, `esquemaData` (Tarefa 2).
- Produces: `registrarVendasDoDia(servidor, deps)`, `AVISO_FICTICIO`, `TEMPO_MAXIMO_MS`, tipos `ConexaoAtual { conexaoId, unidadeId, unidadeNome }`, `ChamadaRegistrada { conexaoId, ferramenta, argumentos, resultado: "ok"|"erro", duracaoMs }`, `DependenciasDaFerramenta`.
- Produces: `criarServidorMcp(authInfo, deps): McpServer`, `lerExtra(authInfo): ExtraDaChave | null`, `ExtraDaChave { conexaoId, usuarioId, unidadeId, unidadeNome }`, `VERSAO`.

- [ ] **Step 1: Escrever o teste**

```ts arquivo=servicos/mcp/src/mcp/vendas-do-dia.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, type AuthInfo } from "@modelcontextprotocol/server";

import { criarFonteFicticia, pedidosFicticios } from "../fontes/ficticia.js";
import type { FonteDeVendas } from "../fontes/tipos.js";
import { registroSilencioso } from "../registro.js";
import { criarServidorMcp, lerExtra } from "./servidor-mcp.js";
import { AVISO_FICTICIO, type ChamadaRegistrada } from "./vendas-do-dia.js";

const authInfo: AuthInfo = {
  token: "tmcp_ensaio",
  clientId: "https://claude.ai/oauth/ensaio",
  scopes: ["vendas:ler"],
  expiresAt: Math.floor(Date.now() / 1000) + 3600,
  extra: {
    conexaoId: "cx_1",
    usuarioId: "usr_gerente",
    unidadeId: "uni_centro",
    unidadeNome: "Vitaliano Centro",
  },
};

async function conectar(
  opcoes: {
    fonte?: FonteDeVendas;
    tempoMaximoMs?: number;
    registrarChamada?: (chamada: ChamadaRegistrada) => Promise<void>;
  } = {},
) {
  const chamadas: ChamadaRegistrada[] = [];
  const servidor = criarServidorMcp(authInfo, {
    fonte: opcoes.fonte ?? criarFonteFicticia(),
    registro: registroSilencioso,
    registrarChamada:
      opcoes.registrarChamada ??
      (async (chamada) => {
        chamadas.push(chamada);
      }),
    agora: () => new Date("2026-09-11T15:00:00Z"),
    tempoMaximoMs: opcoes.tempoMaximoMs,
  });
  const [ladoCliente, ladoServidor] = InMemoryTransport.createLinkedPair();
  await servidor.connect(ladoServidor);
  const cliente = new Client({ name: "ensaio", version: "1.0.0" });
  await cliente.connect(ladoCliente);
  return {
    cliente,
    chamadas,
    async fechar() {
      await cliente.close();
      await servidor.close();
    },
  };
}

function textoDe(resultado: { content?: unknown }): string {
  const blocos = (resultado.content ?? []) as { type: string; text?: string }[];
  return blocos.map((bloco) => bloco.text ?? "").join(" ");
}

describe("vendas_do_dia", () => {
  it("aparece na lista como somente leitura, pedindo só a data", async () => {
    const { cliente, fechar } = await conectar();
    const { tools } = await cliente.listTools();
    await fechar();

    const ferramenta = tools.find((t) => t.name === "vendas_do_dia");
    assert.ok(ferramenta);
    assert.equal(ferramenta.annotations?.readOnlyHint, true);
    assert.equal(ferramenta.annotations?.destructiveHint, false);
    assert.deepEqual(Object.keys(ferramenta.inputSchema.properties ?? {}), [
      "data",
    ]);
  });

  it("devolve quantidade e total iguais ao cálculo independente da fonte", async () => {
    const { cliente, chamadas, fechar } = await conectar();
    const resultado = await cliente.callTool({
      name: "vendas_do_dia",
      arguments: { data: "2026-09-10" },
    });
    await fechar();

    const pedidos = pedidosFicticios({
      unidadeId: "uni_centro",
      data: "2026-09-10",
    });
    const esperado = pedidos.reduce((s, p) => s + p.valorCentavos, 0);
    const dados = resultado.structuredContent as Record<string, unknown>;

    assert.equal(resultado.isError, undefined);
    assert.equal(dados.quantidade_vendas, pedidos.length);
    assert.equal(dados.total_centavos, esperado);
    assert.equal(dados.total, esperado / 100);
    assert.equal(dados.unidade, "Vitaliano Centro");
    assert.equal(dados.fonte, "ficticia");
    assert.equal(dados.aviso, AVISO_FICTICIO);
    assert.ok(textoDe(resultado).startsWith("DADOS FICTÍCIOS"));
    assert.equal(chamadas.length, 1);
    assert.equal(chamadas[0]?.resultado, "ok");
    assert.deepEqual(chamadas[0]?.argumentos, { data: "2026-09-10" });
    assert.equal(chamadas[0]?.conexaoId, "cx_1");
  });

  it("recusa data em formato errado como erro de ferramenta", async () => {
    const { cliente, fechar } = await conectar();
    const resultado = await cliente.callTool({
      name: "vendas_do_dia",
      arguments: { data: "10/09/2026" },
    });
    await fechar();

    assert.equal(resultado.isError, true);
    assert.match(textoDe(resultado), /AAAA-MM-DD/);
  });

  it("transforma falha da fonte em isError sem vazar o detalhe interno", async () => {
    const quebrada: FonteDeVendas = {
      nome: "ficticia",
      ehFicticia: true,
      async vendasDoDia() {
        throw new Error("senha do banco: xyz123");
      },
    };
    const { cliente, chamadas, fechar } = await conectar({ fonte: quebrada });
    const resultado = await cliente.callTool({
      name: "vendas_do_dia",
      arguments: { data: "2026-09-10" },
    });
    await fechar();

    assert.equal(resultado.isError, true);
    assert.ok(!textoDe(resultado).includes("xyz123"));
    assert.equal(chamadas[0]?.resultado, "erro");
  });

  it("interrompe a fonte que demora demais", async () => {
    const lenta: FonteDeVendas = {
      nome: "ficticia",
      ehFicticia: true,
      vendasDoDia: () => new Promise(() => {}),
    };
    const { cliente, fechar } = await conectar({
      fonte: lenta,
      tempoMaximoMs: 50,
    });
    const resultado = await cliente.callTool({
      name: "vendas_do_dia",
      arguments: { data: "2026-09-10" },
    });
    await fechar();

    assert.equal(resultado.isError, true);
    assert.match(textoDe(resultado), /demorou/);
  });

  it("responde mesmo quando o registro da chamada falha", async () => {
    const { cliente, fechar } = await conectar({
      registrarChamada: async () => {
        throw new Error("banco fora");
      },
    });
    const resultado = await cliente.callTool({
      name: "vendas_do_dia",
      arguments: { data: "2026-09-10" },
    });
    await fechar();

    assert.equal(resultado.isError, undefined);
  });

  it("só aceita o extra completo da chave", () => {
    assert.equal(lerExtra(undefined), null);
    assert.equal(lerExtra({ ...authInfo, extra: { conexaoId: 1 } }), null);
    assert.deepEqual(lerExtra(authInfo), authInfo.extra);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test --prefix servicos/mcp`
Expected: FAIL — `./servidor-mcp.js` e `./vendas-do-dia.js` não existem.

- [ ] **Step 3: Implementar**

```ts arquivo=servicos/mcp/src/mcp/vendas-do-dia.ts
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import type { FonteDeVendas } from "../fontes/tipos.js";
import type { Registro } from "../registro.js";
import { esquemaData } from "./data.js";

/**
 * A FERRAMENTA `vendas_do_dia`.
 *
 * A loja NÃO é um parâmetro. Ela vem da conexão, escolhida por uma pessoa na
 * tela de consentimento. Se fosse argumento, bastaria o modelo — ou um texto
 * malicioso colado na conversa — pedir a loja de outra pessoa.
 *
 * Falhas viram `isError: true` com uma frase segura. A mensagem crua do erro
 * nunca sai: o SDK repassaria `error.message` ao modelo, e uma mensagem de
 * banco pode carregar detalhe interno.
 */

export type ConexaoAtual = {
  conexaoId: string;
  unidadeId: string;
  unidadeNome: string;
};

export type ChamadaRegistrada = {
  conexaoId: string;
  ferramenta: string;
  argumentos: Record<string, unknown>;
  resultado: "ok" | "erro";
  duracaoMs: number;
};

export type DependenciasDaFerramenta = {
  fonte: FonteDeVendas;
  conexao: ConexaoAtual;
  registrarChamada: (chamada: ChamadaRegistrada) => Promise<void>;
  registro: Registro;
  agora?: () => Date;
  tempoMaximoMs?: number;
};

export const AVISO_FICTICIO =
  "DADOS FICTÍCIOS — gerados para testar o contrato. Não são vendas reais.";

export const TEMPO_MAXIMO_MS = 8000;

const saida = z.object({
  data: z.string(),
  unidade: z.string(),
  quantidade_vendas: z.number().int().nonnegative(),
  total: z.number().nonnegative(),
  total_centavos: z.number().int().nonnegative(),
  moeda: z.literal("BRL"),
  fonte: z.string(),
  aviso: z.string().optional(),
});

type Resultado = z.infer<typeof saida>;

const reais = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function frase(resultado: Resultado): string {
  const [ano, mes, dia] = resultado.data.split("-");
  const texto = `${dia}/${mes}/${ano} · ${resultado.unidade}: ${resultado.quantidade_vendas} vendas, total de ${reais.format(resultado.total)}.`;
  return resultado.aviso ? `${resultado.aviso} ${texto}` : texto;
}

/** Rejeita quando o sinal aborta — para cortar até fonte que ignora o sinal. */
function corteQuandoAbortar(sinal: AbortSignal): Promise<never> {
  const corte = new Promise<never>((_, rejeitar) => {
    if (sinal.aborted) return rejeitar(sinal.reason);
    sinal.addEventListener("abort", () => rejeitar(sinal.reason), {
      once: true,
    });
  });
  // Depois que a corrida acaba ninguém mais escuta este corte; sem o catch,
  // o disparo tardio do tempo viraria "unhandledRejection".
  corte.catch(() => {});
  return corte;
}

export function registrarVendasDoDia(
  servidor: McpServer,
  deps: DependenciasDaFerramenta,
): void {
  const limite = deps.tempoMaximoMs ?? TEMPO_MAXIMO_MS;

  servidor.registerTool(
    "vendas_do_dia",
    {
      title: "Vendas do dia",
      description:
        "Quantidade de vendas e valor total (R$) de UM dia, na loja ligada a esta conexão. Somente leitura. Informe a data no formato AAAA-MM-DD, no horário de Brasília.",
      inputSchema: z.object({ data: esquemaData(deps.agora) }),
      outputSchema: saida,
      annotations: {
        title: "Vendas do dia",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ data }, ctx) => {
      const inicio = performance.now();
      const tempo = AbortSignal.timeout(limite);
      const sinal = AbortSignal.any([ctx.mcpReq.signal, tempo]);

      const anotar = async (resultado: "ok" | "erro") => {
        try {
          await deps.registrarChamada({
            conexaoId: deps.conexao.conexaoId,
            ferramenta: "vendas_do_dia",
            argumentos: { data },
            resultado,
            duracaoMs: Math.round(performance.now() - inicio),
          });
        } catch (erro) {
          deps.registro.aviso("não consegui registrar a chamada", { erro });
        }
      };

      try {
        const resumo = await Promise.race([
          deps.fonte.vendasDoDia(
            { unidadeId: deps.conexao.unidadeId, data },
            sinal,
          ),
          corteQuandoAbortar(sinal),
        ]);
        const resultado: Resultado = {
          data,
          unidade: deps.conexao.unidadeNome,
          quantidade_vendas: resumo.quantidade,
          total: resumo.totalCentavos / 100,
          total_centavos: resumo.totalCentavos,
          moeda: "BRL",
          fonte: deps.fonte.nome,
          ...(deps.fonte.ehFicticia ? { aviso: AVISO_FICTICIO } : {}),
        };
        await anotar("ok");
        return {
          content: [{ type: "text", text: frase(resultado) }],
          structuredContent: resultado,
        };
      } catch (erro) {
        await anotar("erro");
        deps.registro.erro("vendas_do_dia falhou", {
          erro,
          conexaoId: deps.conexao.conexaoId,
          demorou: tempo.aborted,
        });
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: tempo.aborted
                ? "A consulta das vendas demorou demais e foi interrompida. Tente de novo em instantes."
                : "Não consegui consultar as vendas agora. Tente de novo em instantes.",
            },
          ],
        };
      }
    },
  );
}
```

```ts arquivo=servicos/mcp/src/mcp/servidor-mcp.ts
import { McpServer, type AuthInfo } from "@modelcontextprotocol/server";

import {
  registrarVendasDoDia,
  type DependenciasDaFerramenta,
} from "./vendas-do-dia.js";

/**
 * UM SERVIDOR MCP POR REQUISIÇÃO.
 *
 * `createMcpHandler` chama esta fábrica a cada requisição HTTP, com a chave já
 * validada. Nada fica guardado entre uma chamada e outra: é isso que deixa
 * publicar uma versão nova sem derrubar a conversa de ninguém.
 */

export const VERSAO = "1.0.0";

/** O que o verificador pendura na chave validada. */
export type ExtraDaChave = {
  conexaoId: string;
  usuarioId: string;
  unidadeId: string;
  unidadeNome: string;
};

export function lerExtra(authInfo: AuthInfo | undefined): ExtraDaChave | null {
  const extra = authInfo?.extra;
  if (
    !extra ||
    typeof extra.conexaoId !== "string" ||
    typeof extra.usuarioId !== "string" ||
    typeof extra.unidadeId !== "string" ||
    typeof extra.unidadeNome !== "string"
  ) {
    return null;
  }
  return {
    conexaoId: extra.conexaoId,
    usuarioId: extra.usuarioId,
    unidadeId: extra.unidadeId,
    unidadeNome: extra.unidadeNome,
  };
}

export type DependenciasDoServidorMcp = Omit<
  DependenciasDaFerramenta,
  "conexao"
>;

export function criarServidorMcp(
  authInfo: AuthInfo | undefined,
  deps: DependenciasDoServidorMcp,
): McpServer {
  const servidor = new McpServer(
    { name: "tetteo-mcp", title: "Tetteo — consultas", version: VERSAO },
    {
      instructions:
        "Ferramentas de consulta do Tetteo, o sistema da Vitaliano Pizzaria. Tudo aqui é somente leitura. As vendas são da loja escolhida quando a conexão foi autorizada.",
    },
  );

  // Sem a chave validada não há loja — e sem loja não há ferramenta. A rota
  // /mcp já exige a chave; isto é a segunda trava, não a primeira.
  const extra = lerExtra(authInfo);
  if (extra) {
    registrarVendasDoDia(servidor, {
      ...deps,
      conexao: {
        conexaoId: extra.conexaoId,
        unidadeId: extra.unidadeId,
        unidadeNome: extra.unidadeNome,
      },
    });
  }
  return servidor;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test --prefix servicos/mcp` e `npm run typecheck --prefix servicos/mcp`
Expected: todos PASS.

- [ ] **Step 5: Commit**

```bash
git add servicos/mcp/src/mcp
git commit -m "MCP: vendas_do_dia, a loja que vem da conexão e o erro que não vaza"
```

---

### Tarefa 4: Peças do OAuth — chaves, PKCE, escopos, redirecionamento e metadados

**Files:**

- Create: `servicos/mcp/src/oauth/segredos.ts`, `escopos.ts`, `redirecionamento.ts`, `metadados.ts` (todos em `servicos/mcp/src/oauth/`)
- Test: `servicos/mcp/src/oauth/pecas.test.ts`

**Interfaces:**

- Consumes: `Config` (Tarefa 1).
- Produces: `gerarSegredo(tipo)`, `ehDoTipo(segredo, tipo)`, `impressaoDigital(texto)`, `desafioValido(desafio)`, `desafioDe(verificador)`, `pkceConfere(verificador, desafio)`, tipo `TipoDeSegredo = "acesso"|"renovacao"|"codigo"|"pedido"`.
- Produces: `ESCOPO_VENDAS`, `ESCOPOS_SUPORTADOS`, `escoposConcedidos(pedido?) → string[] | null`.
- Produces: `redirecionamentoPermitido(pedido, registrados) → boolean`, `ehLoopback(url)`, `descreverDestino(redirectUri) → string`.
- Produces: `metadadosDoEmissor({ emissor }) → MetadadosDoEmissor`.

- [ ] **Step 1: Escrever o teste**

```ts arquivo=servicos/mcp/src/oauth/pecas.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ESCOPO_VENDAS, escoposConcedidos } from "./escopos.js";
import { metadadosDoEmissor } from "./metadados.js";
import {
  descreverDestino,
  redirecionamentoPermitido,
} from "./redirecionamento.js";
import {
  desafioDe,
  desafioValido,
  ehDoTipo,
  gerarSegredo,
  impressaoDigital,
  pkceConfere,
} from "./segredos.js";

describe("segredos", () => {
  it("gera chaves com prefixo, 256 bits e sem repetir", () => {
    const a = gerarSegredo("acesso");
    const b = gerarSegredo("acesso");
    assert.match(a, /^tmcp_[A-Za-z0-9_-]{43}$/);
    assert.notEqual(a, b);
    assert.ok(ehDoTipo(a, "acesso"));
    assert.ok(!ehDoTipo(a, "renovacao"));
    assert.match(gerarSegredo("renovacao"), /^tmcr_/);
    assert.match(gerarSegredo("codigo"), /^tmcc_/);
    assert.match(gerarSegredo("pedido"), /^tmcq_/);
  });

  it("guarda só a impressão digital, sempre igual para o mesmo segredo", () => {
    const segredo = gerarSegredo("codigo");
    assert.match(impressaoDigital(segredo), /^[0-9a-f]{64}$/);
    assert.equal(impressaoDigital(segredo), impressaoDigital(segredo));
    assert.ok(!impressaoDigital(segredo).includes(segredo));
  });

  it("confere o PKCE S256 com o exemplo da RFC 7636", () => {
    const verificador = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const desafio = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
    assert.equal(desafioDe(verificador), desafio);
    assert.ok(desafioValido(desafio));
    assert.ok(pkceConfere(verificador, desafio));
    assert.ok(!pkceConfere(`${verificador}x`, desafio));
    assert.ok(!pkceConfere("curto", desafio));
    assert.ok(!desafioValido("plain-nao-serve"));
  });
});

describe("escopos", () => {
  it("concede vendas:ler quando nada é pedido", () => {
    assert.deepEqual(escoposConcedidos(undefined), [ESCOPO_VENDAS]);
    assert.deepEqual(escoposConcedidos(""), [ESCOPO_VENDAS]);
  });

  it("descarta o que não existe aqui e recusa quando nada sobra", () => {
    assert.deepEqual(escoposConcedidos("vendas:ler offline_access"), [
      ESCOPO_VENDAS,
    ]);
    assert.equal(escoposConcedidos("pedidos:escrever"), null);
  });
});

describe("redirecionamento", () => {
  const claude = "https://claude.ai/api/mcp/auth_callback";
  const codigo = ["http://localhost/callback", "http://127.0.0.1/callback"];

  it("exige igualdade exata fora do loopback", () => {
    assert.ok(redirecionamentoPermitido(claude, [claude]));
    assert.ok(!redirecionamentoPermitido(`${claude}x`, [claude]));
    assert.ok(!redirecionamentoPermitido("https://evil.example/cb", [claude]));
  });

  it("ignora a porta no loopback, como pede a RFC 8252", () => {
    assert.ok(
      redirecionamentoPermitido("http://127.0.0.1:3118/callback", codigo),
    );
    assert.ok(
      redirecionamentoPermitido("http://localhost:51000/callback", codigo),
    );
    assert.ok(
      !redirecionamentoPermitido("http://127.0.0.1:3118/outro", codigo),
    );
  });

  it("recusa http fora do loopback, fragmento e lixo", () => {
    assert.ok(
      !redirecionamentoPermitido("http://claude.ai/cb", [
        "http://claude.ai/cb",
      ]),
    );
    assert.ok(!redirecionamentoPermitido(`${claude}#x`, [`${claude}#x`]));
    assert.ok(!redirecionamentoPermitido("não é url", [claude]));
  });

  it("descreve o destino para a tela de consentimento", () => {
    assert.equal(descreverDestino(claude), "claude.ai");
    assert.match(
      descreverDestino("http://127.0.0.1:3118/callback"),
      /este computador/,
    );
  });
});

describe("metadados", () => {
  it("anuncia CIMD, cliente público e PKCE S256", () => {
    const m = metadadosDoEmissor({ emissor: "https://mcp.exemplo.com.br" });
    assert.equal(m.issuer, "https://mcp.exemplo.com.br");
    assert.equal(m.token_endpoint, "https://mcp.exemplo.com.br/oauth/token");
    assert.equal(m.client_id_metadata_document_supported, true);
    assert.deepEqual(m.token_endpoint_auth_methods_supported, ["none"]);
    assert.deepEqual(m.code_challenge_methods_supported, ["S256"]);
    assert.deepEqual(m.scopes_supported, ["vendas:ler"]);
    assert.equal("registration_endpoint" in m, false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test --prefix servicos/mcp`
Expected: FAIL — módulos de `oauth/` não existem.

- [ ] **Step 3: Implementar**

```ts arquivo=servicos/mcp/src/oauth/segredos.ts
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * AS CHAVES QUE ESTE SERVIDOR ENTREGA.
 *
 * Aleatórias, 256 bits, com um prefixo que diz o que são: `tmcp_` acesso,
 * `tmcr_` renovação, `tmcc_` código de autorização, `tmcq_` pedido em
 * andamento. Se uma delas aparecer onde não devia, o prefixo diz de onde veio.
 *
 * No banco vai só a impressão digital (SHA-256). Quem ler a tabela não
 * consegue usar nenhuma chave. SHA-256 simples, sem sal nem bcrypt, é o certo
 * aqui: com 256 bits aleatórios não há dicionário a testar — sal só protege
 * segredo fraco, e estes não são.
 */

const PREFIXOS = {
  acesso: "tmcp_",
  renovacao: "tmcr_",
  codigo: "tmcc_",
  pedido: "tmcq_",
} as const;

export type TipoDeSegredo = keyof typeof PREFIXOS;

/** 32 bytes em base64url dão exatamente 43 caracteres. */
const TAMANHO = 43;

export function gerarSegredo(tipo: TipoDeSegredo): string {
  return PREFIXOS[tipo] + randomBytes(32).toString("base64url");
}

export function ehDoTipo(segredo: string, tipo: TipoDeSegredo): boolean {
  return (
    segredo.startsWith(PREFIXOS[tipo]) &&
    segredo.length === PREFIXOS[tipo].length + TAMANHO
  );
}

export function impressaoDigital(texto: string): string {
  return createHash("sha256").update(texto, "utf8").digest("hex");
}

// PKCE (RFC 7636), só o método S256. "plain" não protege nada.
const VERIFICADOR = /^[A-Za-z0-9\-._~]{43,128}$/;
const DESAFIO = /^[A-Za-z0-9_-]{43}$/;

export function desafioValido(desafio: string): boolean {
  return DESAFIO.test(desafio);
}

export function desafioDe(verificador: string): string {
  return createHash("sha256").update(verificador, "ascii").digest("base64url");
}

export function pkceConfere(verificador: string, desafio: string): boolean {
  if (!VERIFICADOR.test(verificador) || !DESAFIO.test(desafio)) return false;
  const calculado = Buffer.from(desafioDe(verificador));
  const esperado = Buffer.from(desafio);
  return (
    calculado.length === esperado.length && timingSafeEqual(calculado, esperado)
  );
}
```

```ts arquivo=servicos/mcp/src/oauth/escopos.ts
/**
 * O QUE UMA CONEXÃO PODE FAZER.
 *
 * Um escopo só, e ele é de leitura. Quando surgir uma ferramenta nova, ela
 * ganha escopo próprio — a pessoa aprova o que a IA vai poder fazer, item a
 * item, em vez de um "acesso total" que ninguém lê.
 */

export const ESCOPO_VENDAS = "vendas:ler";

export const ESCOPOS_SUPORTADOS: readonly string[] = [ESCOPO_VENDAS];

/**
 * Pedido sem escopo recebe o único que existe. Escopos desconhecidos (como
 * `offline_access`, que alguns clientes pedem por hábito) são descartados: o
 * OAuth permite conceder menos do que foi pedido, e a resposta diz o que foi
 * concedido. Só é erro quando nada do que foi pedido existe aqui.
 */
export function escoposConcedidos(pedido: string | undefined): string[] | null {
  const itens = (pedido ?? "").split(" ").filter(Boolean);
  if (itens.length === 0) return [ESCOPO_VENDAS];
  const conhecidos = [
    ...new Set(itens.filter((item) => ESCOPOS_SUPORTADOS.includes(item))),
  ];
  return conhecidos.length > 0 ? conhecidos : null;
}
```

```ts arquivo=servicos/mcp/src/oauth/redirecionamento.ts
/**
 * PARA ONDE O CÓDIGO DE AUTORIZAÇÃO PODE VOLTAR.
 *
 * O código só vale para quem o recebe — se ele voltar para o endereço errado,
 * quem está lá troca por uma chave. Por isso a comparação é EXATA, com uma
 * única exceção, a do loopback (`localhost`, `127.0.0.1`): programas no
 * computador da pessoa, como o Claude Code, abrem uma porta diferente a cada
 * vez, e a RFC 8252 manda ignorar a porta nesse caso.
 */

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function ehLoopback(url: URL): boolean {
  return url.protocol === "http:" && LOOPBACK.has(url.hostname);
}

function lerUrl(texto: string): URL | null {
  try {
    return new URL(texto);
  } catch {
    return null;
  }
}

export function redirecionamentoPermitido(
  pedido: string,
  registrados: readonly string[],
): boolean {
  const alvo = lerUrl(pedido);
  if (!alvo || alvo.hash || alvo.username || alvo.password) return false;
  // Fora do loopback, só https: um código em http viaja à vista.
  if (!ehLoopback(alvo) && alvo.protocol !== "https:") return false;

  return registrados.some((registrado) => {
    const base = lerUrl(registrado);
    if (!base) return false;
    if (ehLoopback(alvo) && ehLoopback(base)) {
      return (
        alvo.hostname === base.hostname &&
        alvo.pathname === base.pathname &&
        alvo.search === base.search
      );
    }
    return alvo.href === base.href && pedido === registrado;
  });
}

/** Como a tela de consentimento nomeia o destino. */
export function descreverDestino(redirectUri: string): string {
  const url = lerUrl(redirectUri);
  if (!url) return redirectUri;
  return ehLoopback(url)
    ? "este computador (um programa rodando nele, como o Claude Code)"
    : url.hostname;
}
```

```ts arquivo=servicos/mcp/src/oauth/metadados.ts
import type { OAuthMetadata } from "@modelcontextprotocol/server";

import type { Config } from "../config.js";
import { ESCOPOS_SUPORTADOS } from "./escopos.js";

/**
 * O CARTÃO DE VISITAS DO SERVIDOR DE AUTORIZAÇÃO (RFC 8414).
 *
 * É a partir daqui que o Claude descobre onde fica o login e como trocar o
 * código por chave. Dois campos decidem se ele consegue conectar:
 *
 *   client_id_metadata_document_supported + "none" em
 *   token_endpoint_auth_methods_supported
 *
 * Com os dois, o Claude se identifica pela URL que a Anthropic publica (CIMD)
 * e dispensa cadastro. Sem `registration_endpoint` de propósito: este servidor
 * não aceita que clientes desconhecidos se registrem sozinhos.
 */

export type MetadadosDoEmissor = OAuthMetadata & {
  client_id_metadata_document_supported: true;
  authorization_response_iss_parameter_supported: true;
};

export function metadadosDoEmissor(
  config: Pick<Config, "emissor">,
): MetadadosDoEmissor {
  const emissor = config.emissor;
  return {
    issuer: emissor,
    authorization_endpoint: `${emissor}/oauth/authorize`,
    token_endpoint: `${emissor}/oauth/token`,
    revocation_endpoint: `${emissor}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: [...ESCOPOS_SUPORTADOS],
    client_id_metadata_document_supported: true,
    // RFC 9207: o código volta com `iss`, e o cliente confere de quem veio.
    authorization_response_iss_parameter_supported: true,
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test --prefix servicos/mcp` e `npm run typecheck --prefix servicos/mcp`
Expected: todos PASS.

- [ ] **Step 5: Commit**

```bash
git add servicos/mcp/src/oauth
git commit -m "MCP: as chaves em hash, o PKCE S256 e o retorno que só volta para quem pediu"
```

---

### Tarefa 5: Quem pode se conectar — o resolvedor CIMD

**Files:**

- Create: `servicos/mcp/src/oauth/cliente.ts`
- Test: `servicos/mcp/src/oauth/cliente.test.ts`

**Interfaces:**

- Produces: `criarResolvedorDeClientes({ hostsConfiaveis, buscar?, validadeMs?, agora? }) → ResolverCliente`, `ResolverCliente = (clientId) => Promise<ClienteOAuth>`, `ClienteOAuth { clientId, nome, redirectUris }`, `ErroDeCliente`, `BuscarDocumento = (url, sinal) => Promise<Response>`.

- [ ] **Step 1: Escrever o teste**

```ts arquivo=servicos/mcp/src/oauth/cliente.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  criarResolvedorDeClientes,
  ErroDeCliente,
  type BuscarDocumento,
} from "./cliente.js";

const CLAUDE_CODE = "https://claude.ai/oauth/claude-code-client-metadata";

const documento = {
  client_id: CLAUDE_CODE,
  client_name: "Claude Code",
  redirect_uris: ["http://localhost/callback", "http://127.0.0.1/callback"],
  token_endpoint_auth_method: "none",
};

function buscarQueDevolve(corpo: unknown, status = 200) {
  const chamadas: string[] = [];
  const buscar: BuscarDocumento = async (url) => {
    chamadas.push(url.href);
    const texto = typeof corpo === "string" ? corpo : JSON.stringify(corpo);
    return new Response(texto, { status });
  };
  return { buscar, chamadas };
}

const hostsConfiaveis = ["claude.ai", "claude.com"];

describe("resolvedor de clientes (CIMD)", () => {
  it("aceita a identificação publicada pelo Claude", async () => {
    const { buscar } = buscarQueDevolve(documento);
    const cliente = await criarResolvedorDeClientes({
      hostsConfiaveis,
      buscar,
    })(CLAUDE_CODE);

    assert.equal(cliente.clientId, CLAUDE_CODE);
    assert.equal(cliente.nome, "Claude Code");
    assert.deepEqual(cliente.redirectUris, documento.redirect_uris);
  });

  it("recusa host fora da lista SEM buscar nada na rede", async () => {
    const { buscar, chamadas } = buscarQueDevolve(documento);
    const resolver = criarResolvedorDeClientes({ hostsConfiaveis, buscar });

    await assert.rejects(
      resolver("https://evil.example/cliente.json"),
      ErroDeCliente,
    );
    await assert.rejects(resolver("http://claude.ai/x"), ErroDeCliente);
    await assert.rejects(resolver("https://claude.ai/"), ErroDeCliente);
    await assert.rejects(resolver("não é url"), ErroDeCliente);
    assert.equal(chamadas.length, 0);
  });

  it("recusa documento que não é dele mesmo", async () => {
    const { buscar } = buscarQueDevolve({
      ...documento,
      client_id: "https://claude.ai/outro",
    });
    await assert.rejects(
      criarResolvedorDeClientes({ hostsConfiaveis, buscar })(CLAUDE_CODE),
      /não corresponde/,
    );
  });

  it("recusa cliente com segredo, documento incompleto, não-JSON e erro HTTP", async () => {
    const casos: [unknown, number][] = [
      [
        { ...documento, token_endpoint_auth_method: "client_secret_basic" },
        200,
      ],
      [{ ...documento, token_endpoint_auth_method: undefined }, 200],
      [{ client_id: CLAUDE_CODE }, 200],
      ["<html>", 200],
      [documento, 404],
    ];
    for (const [corpo, status] of casos) {
      const { buscar } = buscarQueDevolve(corpo, status);
      await assert.rejects(
        criarResolvedorDeClientes({ hostsConfiaveis, buscar })(CLAUDE_CODE),
        ErroDeCliente,
      );
    }
  });

  it("recusa documento maior que 64 KB", async () => {
    const { buscar } = buscarQueDevolve({
      ...documento,
      client_name: "x".repeat(70 * 1024),
    });
    await assert.rejects(
      criarResolvedorDeClientes({ hostsConfiaveis, buscar })(CLAUDE_CODE),
      /grande demais/,
    );
  });

  it("transforma falha de rede em ErroDeCliente", async () => {
    const buscar: BuscarDocumento = async () => {
      throw new TypeError("redirect");
    };
    await assert.rejects(
      criarResolvedorDeClientes({ hostsConfiaveis, buscar })(CLAUDE_CODE),
      ErroDeCliente,
    );
  });

  it("guarda o documento por um tempo e busca de novo depois", async () => {
    const { buscar, chamadas } = buscarQueDevolve(documento);
    let relogio = 0;
    const resolver = criarResolvedorDeClientes({
      hostsConfiaveis,
      buscar,
      validadeMs: 1000,
      agora: () => relogio,
    });

    await resolver(CLAUDE_CODE);
    await resolver(CLAUDE_CODE);
    assert.equal(chamadas.length, 1);

    relogio = 1001;
    await resolver(CLAUDE_CODE);
    assert.equal(chamadas.length, 2);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test --prefix servicos/mcp`
Expected: FAIL — `./cliente.js` não existe.

- [ ] **Step 3: Implementar**

```ts arquivo=servicos/mcp/src/oauth/cliente.ts
import { z } from "zod";

/**
 * QUEM PODE PEDIR ACESSO: o Client ID Metadata Document (CIMD).
 *
 * O Claude se identifica com uma URL (`client_id`) que aponta para um JSON
 * publicado pela Anthropic, com o nome dele e os endereços de retorno. Este
 * servidor busca esse JSON e confere.
 *
 * Buscar uma URL que veio de fora é perigoso: sem cuidado, alguém usaria este
 * servidor para acessar endereços internos da VPS (SSRF). Por isso a ordem é:
 * primeiro o host precisa estar na lista de confiáveis — só então há busca, e
 * ainda assim só https, sem seguir redirecionamento, com tempo e tamanho
 * limitados.
 *
 * O documento fica guardado em memória por alguns minutos. É cache, não
 * sessão: perdê-lo num deploy só custa uma busca a mais.
 */

export type ClienteOAuth = {
  clientId: string;
  nome: string;
  redirectUris: string[];
};

export type BuscarDocumento = (
  url: URL,
  sinal: AbortSignal,
) => Promise<Response>;

export type ResolverCliente = (clientId: string) => Promise<ClienteOAuth>;

export class ErroDeCliente extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroDeCliente";
  }
}

const LIMITE_BYTES = 64 * 1024;
const TEMPO_MS = 5000;

const documento = z.object({
  client_id: z.string(),
  client_name: z.string().max(200).optional(),
  redirect_uris: z.array(z.string().max(2000)).min(1).max(20),
  token_endpoint_auth_method: z.string().optional(),
});

export const buscarNaRede: BuscarDocumento = (url, sinal) =>
  fetch(url, {
    signal: sinal,
    redirect: "error",
    headers: { accept: "application/json" },
  });

async function lerComLimite(
  resposta: Response,
  limite: number,
): Promise<string> {
  const leitor = resposta.body?.getReader();
  if (!leitor) return "";
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > limite) {
      await leitor.cancel();
      throw new ErroDeCliente("A identificação do cliente é grande demais.");
    }
    partes.push(value);
  }
  return Buffer.concat(partes).toString("utf8");
}

export function criarResolvedorDeClientes(opcoes: {
  hostsConfiaveis: readonly string[];
  buscar?: BuscarDocumento;
  validadeMs?: number;
  agora?: () => number;
}): ResolverCliente {
  const buscar = opcoes.buscar ?? buscarNaRede;
  const validade = opcoes.validadeMs ?? 5 * 60_000;
  const agora = opcoes.agora ?? Date.now;
  const guardados = new Map<string, { cliente: ClienteOAuth; ate: number }>();

  return async (clientId) => {
    let url: URL;
    try {
      url = new URL(clientId);
    } catch {
      throw new ErroDeCliente("O client_id precisa ser uma URL.");
    }
    if (
      url.protocol !== "https:" ||
      url.pathname === "/" ||
      url.hash ||
      url.username ||
      url.password
    ) {
      throw new ErroDeCliente(
        "O client_id precisa ser uma URL https com caminho.",
      );
    }
    const host = url.hostname.toLowerCase();
    if (!opcoes.hostsConfiaveis.includes(host)) {
      throw new ErroDeCliente(
        `Este servidor só aceita conexões de: ${opcoes.hostsConfiaveis.join(", ")}.`,
      );
    }

    const guardado = guardados.get(clientId);
    if (guardado && guardado.ate > agora()) return guardado.cliente;

    let resposta: Response;
    try {
      resposta = await buscar(url, AbortSignal.timeout(TEMPO_MS));
    } catch {
      throw new ErroDeCliente("Não consegui ler a identificação do cliente.");
    }
    if (!resposta.ok) {
      throw new ErroDeCliente(
        `A identificação do cliente respondeu ${resposta.status}.`,
      );
    }

    let json: unknown;
    try {
      json = JSON.parse(await lerComLimite(resposta, LIMITE_BYTES));
    } catch (erro) {
      if (erro instanceof ErroDeCliente) throw erro;
      throw new ErroDeCliente(
        "A identificação do cliente não é um JSON válido.",
      );
    }

    const analise = documento.safeParse(json);
    if (!analise.success) {
      throw new ErroDeCliente("A identificação do cliente está incompleta.");
    }
    if (analise.data.client_id !== clientId) {
      throw new ErroDeCliente(
        "A identificação do cliente não corresponde ao client_id.",
      );
    }
    // Sem o campo, o padrão da RFC 7591 é cliente COM segredo. Este servidor
    // só atende quem declara explicitamente que é público.
    if (analise.data.token_endpoint_auth_method !== "none") {
      throw new ErroDeCliente(
        "Só clientes públicos (sem segredo) podem se conectar.",
      );
    }

    const cliente: ClienteOAuth = {
      clientId,
      nome: analise.data.client_name ?? host,
      redirectUris: analise.data.redirect_uris,
    };
    guardados.set(clientId, { cliente, ate: agora() + validade });
    return cliente;
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test --prefix servicos/mcp` e `npm run typecheck --prefix servicos/mcp`
Expected: todos PASS.

- [ ] **Step 5: Commit**

```bash
git add servicos/mcp/src/oauth/cliente.ts servicos/mcp/src/oauth/cliente.test.ts
git commit -m "MCP: só a identidade publicada do Claude, buscada com trava contra SSRF"
```

---

### Tarefa 6: O banco — papel mínimo, visões, tabelas próprias e banco de ensaio

**Files:**

- Create: `servicos/mcp/sql/01-preparar-banco.sql`, `servicos/mcp/sql/02-tabelas.sql`
- Create: `servicos/mcp/src/banco/conexao.ts`, `tabelas.ts`, `tetteo.ts` (em `servicos/mcp/src/banco/`)
- Create: `servicos/mcp/src/ensaio/banco-de-ensaio.ts`, `servicos/mcp/src/ensaio/semente.ts`
- Test: `servicos/mcp/src/banco/banco.integracao.ts`

**Interfaces:**

- Produces: `criarBanco(url, registro) → Banco` (`pg.Pool`), `prepararTabelas(banco)`, `buscarUsuarioParaLogin(banco, email) → { id, nome, senhaHash } | null`, `lojasComVendasVisiveis(banco, usuarioId) → Loja[]` com `Loja { id, nome }`.
- Produces (ensaio): `urlDeEnsaio() → string | null`, `criarBancoDeEnsaio() → { urlDoServico, admin: pg.Client, encerrar() }`, `semear(admin)`, `SENHA_DE_ENSAIO`, `PESSOAS { dono, gerente, caixa, suspenso }`, `LOJAS { centro, sul }`.

Para rodar os testes de integração localmente: um Postgres 18 local (por exemplo `embedded-postgres` instalado **fora** do repositório, UTF-8, só em `127.0.0.1`) e `MCP_ENSAIO_PG_URL=postgresql://postgres:<senha>@127.0.0.1:<porta>/postgres` na mesma linha de comando.

- [ ] **Step 1: Escrever o SQL**

```sql arquivo=servicos/mcp/sql/01-preparar-banco.sql
-- =============================================================================
-- SERVIDOR MCP — preparação do banco do Tetteo
--
-- Roda UMA vez, pelo administrador do banco (o dono das tabelas do Tetteo).
-- Idempotente: rodar de novo não estraga nada.
--
-- NÃO define senha. A senha do papel tetteo_mcp é gerada e aplicada direto no
-- servidor, fora deste arquivo e fora do repositório.
--
-- O que este papel pode, e só isto:
--   · ler DUAS visões do esquema mcp_leitura (login e lojas visíveis);
--   · criar e usar as próprias tabelas no esquema mcp.
-- Nenhuma tabela do Tetteo fica visível para ele.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tetteo_mcp') THEN
    CREATE ROLE tetteo_mcp LOGIN;
  END IF;
END
$$;

ALTER ROLE tetteo_mcp
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS
  CONNECTION LIMIT 10;
ALTER ROLE tetteo_mcp SET statement_timeout = '5s';
ALTER ROLE tetteo_mcp SET idle_in_transaction_session_timeout = '10s';
ALTER ROLE tetteo_mcp SET search_path = mcp;

CREATE SCHEMA IF NOT EXISTS mcp AUTHORIZATION tetteo_mcp;
CREATE SCHEMA IF NOT EXISTS mcp_leitura;
REVOKE ALL ON SCHEMA mcp_leitura FROM PUBLIC;
GRANT USAGE ON SCHEMA mcp_leitura TO tetteo_mcp;

-- Deixa explícito: nada do esquema public. Se um dia alguém der um GRANT
-- amplo em public, esta linha, rodada de novo, desfaz para este papel.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM tetteo_mcp;

-- Quem pode entrar: ativo, não excluído, com senha. security_barrier impede
-- que uma consulta esperta enxergue as linhas que o filtro esconde.
CREATE OR REPLACE VIEW mcp_leitura.usuario_login
  WITH (security_barrier = true) AS
SELECT
  u.id,
  lower(u.email) AS email,
  u.nome,
  u."senhaHash" AS senha_hash
FROM public.usuario u
WHERE u.status = 'ATIVO'
  AND u."excluidoEm" IS NULL
  AND u."senhaHash" IS NOT NULL;

-- Em que lojas a pessoa pode ver vendas. A mesma regra de contextoDeFundo()
-- + pode() em src/core/sessao/contexto.ts: acesso de rede (unidadeId nulo)
-- vale para toda loja ativa da organização; acesso de loja vale para ela; o
-- papel precisa de '*', 'financeiro.*' ou 'financeiro.ver'.
CREATE OR REPLACE VIEW mcp_leitura.loja_com_vendas_visiveis
  WITH (security_barrier = true) AS
SELECT DISTINCT
  a."usuarioId" AS usuario_id,
  un.id AS unidade_id,
  un.nome AS unidade_nome
FROM public.acesso a
JOIN public.organizacao o
  ON o.id = a."organizacaoId" AND o.ativa AND o."excluidoEm" IS NULL
JOIN public.papel_permissao pp
  ON pp."papelId" = a."papelId"
 AND pp.chave IN ('*', 'financeiro.*', 'financeiro.ver')
JOIN public.unidade un
  ON un."organizacaoId" = a."organizacaoId"
 AND un.ativa
 AND un."excluidoEm" IS NULL
 AND (a."unidadeId" IS NULL OR a."unidadeId" = un.id)
WHERE a.status = 'ATIVO'
  AND a."excluidoEm" IS NULL;

GRANT SELECT ON mcp_leitura.usuario_login TO tetteo_mcp;
GRANT SELECT ON mcp_leitura.loja_com_vendas_visiveis TO tetteo_mcp;
```

```sql arquivo=servicos/mcp/sql/02-tabelas.sql
-- =============================================================================
-- SERVIDOR MCP — as tabelas do próprio serviço (esquema mcp)
--
-- Roda o próprio serviço, ao subir, como tetteo_mcp. IF NOT EXISTS: rodar de
-- novo não muda nada. Nenhuma chave em claro: só a impressão digital (hash).
-- =============================================================================

-- Um pedido de autorização em andamento: do "Conectar" no Claude até a
-- pessoa aprovar (10 minutos).
CREATE TABLE IF NOT EXISTS mcp.pedido_autorizacao (
  hash text PRIMARY KEY,
  client_id text NOT NULL,
  cliente_nome text NOT NULL,
  redirect_uri text NOT NULL,
  state text,
  code_challenge text NOT NULL,
  escopos text[] NOT NULL,
  recurso text NOT NULL,
  usuario_id text,
  autenticado_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now(),
  expira_em timestamptz NOT NULL
);

-- Uma conexão aprovada: quem, qual loja, qual cliente. Revogar é marcar aqui.
CREATE TABLE IF NOT EXISTS mcp.conexao (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  usuario_id text NOT NULL,
  unidade_id text NOT NULL,
  client_id text NOT NULL,
  cliente_nome text NOT NULL,
  escopos text[] NOT NULL,
  recurso text NOT NULL,
  criada_em timestamptz NOT NULL DEFAULT now(),
  ultimo_uso_em timestamptz,
  revogada_em timestamptz,
  motivo_revogacao text
);
CREATE INDEX IF NOT EXISTS conexao_usuario ON mcp.conexao (usuario_id);

CREATE TABLE IF NOT EXISTS mcp.codigo_autorizacao (
  hash text PRIMARY KEY,
  conexao_id text NOT NULL REFERENCES mcp.conexao (id) ON DELETE CASCADE,
  client_id text NOT NULL,
  redirect_uri text NOT NULL,
  code_challenge text NOT NULL,
  expira_em timestamptz NOT NULL,
  usado_em timestamptz
);

CREATE TABLE IF NOT EXISTS mcp.token (
  hash text PRIMARY KEY,
  conexao_id text NOT NULL REFERENCES mcp.conexao (id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('acesso', 'renovacao')),
  criado_em timestamptz NOT NULL DEFAULT now(),
  expira_em timestamptz NOT NULL,
  -- Só renovação: já foi trocada por outra. Reapresentar = roubo provável.
  substituido_em timestamptz
);
CREATE INDEX IF NOT EXISTS token_conexao ON mcp.token (conexao_id);

-- Tentativas de login, para o limite. E-mail e IP só em hash.
CREATE TABLE IF NOT EXISTS mcp.tentativa_login (
  id bigserial PRIMARY KEY,
  email_hash text NOT NULL,
  ip_hash text NOT NULL,
  sucesso boolean NOT NULL,
  criada_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tentativa_email ON mcp.tentativa_login (email_hash, criada_em);
CREATE INDEX IF NOT EXISTS tentativa_ip ON mcp.tentativa_login (ip_hash, criada_em);

-- O que a IA consultou, quando e se deu certo. Sem chave, sem resposta.
CREATE TABLE IF NOT EXISTS mcp.chamada (
  id bigserial PRIMARY KEY,
  conexao_id text NOT NULL,
  ferramenta text NOT NULL,
  argumentos jsonb NOT NULL,
  resultado text NOT NULL CHECK (resultado IN ('ok', 'erro')),
  duracao_ms integer NOT NULL,
  criada_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chamada_conexao ON mcp.chamada (conexao_id, criada_em);
```

- [ ] **Step 2: Escrever o ambiente de ensaio e o teste**

```ts arquivo=servicos/mcp/src/ensaio/banco-de-ensaio.ts
import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

/**
 * UM BANCO DESCARTÁVEL PARA OS TESTES DE INTEGRAÇÃO.
 *
 * Cria um banco novo (com `_test` no nome) e aplica as MIGRAÇÕES REAIS do
 * Tetteo — as mesmas SQL que o Prisma roda em produção —, depois o
 * `01-preparar-banco.sql` como administrador. O teste enxerga as colunas de
 * verdade: se uma migração futura mudar `usuario`, a visão quebra aqui antes
 * de quebrar em produção.
 *
 * Duas travas, como no ambiente de teste do app principal: sem
 * MCP_ENSAIO_PG_URL não roda, e fora de localhost recusa.
 */

export type BancoDeEnsaio = {
  /** Conecta como `tetteo_mcp` — o mesmo papel que o serviço usa. */
  urlDoServico: string;
  /** Conexão de administrador, para montar e bagunçar cenários. */
  admin: pg.Client;
  encerrar(): Promise<void>;
};

const MIGRACOES = fileURLToPath(
  new URL("../../../../prisma/schema/migrations/", import.meta.url),
);
const PREPARAR = fileURLToPath(
  new URL("../../sql/01-preparar-banco.sql", import.meta.url),
);

export function urlDeEnsaio(): string | null {
  const url = process.env.MCP_ENSAIO_PG_URL;
  if (!url) return null;
  const { hostname } = new URL(url);
  if (hostname !== "localhost" && hostname !== "127.0.0.1") {
    throw new Error(
      `Recusado: MCP_ENSAIO_PG_URL aponta para ${hostname}. Testes só rodam em banco local.`,
    );
  }
  return url;
}

export async function criarBancoDeEnsaio(): Promise<BancoDeEnsaio> {
  const base = urlDeEnsaio();
  if (!base) throw new Error("Falta MCP_ENSAIO_PG_URL.");
  const nome = `mcp_ensaio_${randomBytes(4).toString("hex")}_test`;

  const raiz = new pg.Client({ connectionString: base });
  await raiz.connect();
  await raiz.query(`CREATE DATABASE ${nome}`);
  await raiz.end();

  const urlAdmin = new URL(base);
  urlAdmin.pathname = `/${nome}`;
  const admin = new pg.Client({ connectionString: urlAdmin.href });
  await admin.connect();

  const pastas = (await readdir(MIGRACOES, { withFileTypes: true }))
    .filter((item) => item.isDirectory())
    .map((item) => item.name)
    .sort();
  for (const pasta of pastas) {
    await admin.query(
      await readFile(join(MIGRACOES, pasta, "migration.sql"), "utf8"),
    );
  }
  await admin.query(await readFile(PREPARAR, "utf8"));

  // base64url: sem aspas nem barras, seguro dentro do literal SQL e da URL.
  const senha = randomBytes(18).toString("base64url");
  await admin.query(`ALTER ROLE tetteo_mcp PASSWORD '${senha}'`);
  const urlDoServico = new URL(urlAdmin.href);
  urlDoServico.username = "tetteo_mcp";
  urlDoServico.password = senha;

  return {
    urlDoServico: urlDoServico.href,
    admin,
    async encerrar() {
      await admin.end();
      const final = new pg.Client({ connectionString: base });
      await final.connect();
      await final.query(`DROP DATABASE IF EXISTS ${nome} WITH (FORCE)`);
      await final.end();
    },
  };
}
```

```ts arquivo=servicos/mcp/src/ensaio/semente.ts
import bcrypt from "bcryptjs";
import type pg from "pg";

/**
 * AS PESSOAS E LOJAS DE ENSAIO.
 *
 * Cada uma existe para um caso da regra de permissão:
 *   dono      acesso de REDE com papel '*'           → vê todas as lojas ativas
 *   gerente   acesso da loja Centro, 'financeiro.ver' → vê só o Centro
 *   caixa     acesso da loja Centro, sem financeiro   → não vê nenhuma
 *   suspenso  pessoa suspensa                         → nem entra
 * A "Loja Fechada" está inativa: nem o dono a enxerga.
 */

export const SENHA_DE_ENSAIO = "senha-de-ensaio-123";

export const PESSOAS = {
  dono: "dono@ensaio.test",
  gerente: "gerente@ensaio.test",
  caixa: "caixa@ensaio.test",
  suspenso: "suspenso@ensaio.test",
} as const;

export const LOJAS = {
  centro: { id: "uni_centro", nome: "Vitaliano Centro" },
  sul: { id: "uni_sul", nome: "Vitaliano Zona Sul" },
} as const;

export async function semear(admin: pg.Client): Promise<void> {
  // Custo 4: é teste. Produção usa o custo 12 do Tetteo.
  const hash = await bcrypt.hash(SENHA_DE_ENSAIO, 4);

  await admin.query(`
    INSERT INTO organizacao (id, nome, slug, "atualizadoEm")
      VALUES ('org_ensaio', 'Vitaliano', 'vitaliano', now());
    INSERT INTO unidade (id, "organizacaoId", nome, codigo, "atualizadoEm") VALUES
      ('uni_centro', 'org_ensaio', 'Vitaliano Centro', 'CEN', now()),
      ('uni_sul', 'org_ensaio', 'Vitaliano Zona Sul', 'SUL', now()),
      ('uni_fechada', 'org_ensaio', 'Loja Fechada', 'FEC', now());
    UPDATE unidade SET ativa = false WHERE id = 'uni_fechada';
    INSERT INTO papel (id, "organizacaoId", nome, "atualizadoEm") VALUES
      ('pap_diretor', 'org_ensaio', 'Diretor', now()),
      ('pap_gerente', 'org_ensaio', 'Gerente', now()),
      ('pap_caixa', 'org_ensaio', 'Caixa', now());
    INSERT INTO papel_permissao (id, "papelId", chave) VALUES
      ('pp_1', 'pap_diretor', '*'),
      ('pp_2', 'pap_gerente', 'financeiro.ver'),
      ('pp_3', 'pap_caixa', 'checklists.ver');
  `);

  await admin.query(
    `INSERT INTO usuario (id, nome, email, "senhaHash", status, "atualizadoEm") VALUES
      ('usr_dono', 'Dono', 'dono@ensaio.test', $1, 'ATIVO', now()),
      ('usr_gerente', 'Gerente', 'gerente@ensaio.test', $1, 'ATIVO', now()),
      ('usr_caixa', 'Caixa', 'caixa@ensaio.test', $1, 'ATIVO', now()),
      ('usr_suspenso', 'Suspenso', 'suspenso@ensaio.test', $1, 'SUSPENSO', now())`,
    [hash],
  );

  await admin.query(`
    INSERT INTO acesso (id, "usuarioId", "organizacaoId", "unidadeId", "papelId", "atualizadoEm") VALUES
      ('ac_dono', 'usr_dono', 'org_ensaio', NULL, 'pap_diretor', now()),
      ('ac_gerente', 'usr_gerente', 'org_ensaio', 'uni_centro', 'pap_gerente', now()),
      ('ac_caixa', 'usr_caixa', 'org_ensaio', 'uni_centro', 'pap_caixa', now()),
      ('ac_suspenso', 'usr_suspenso', 'org_ensaio', 'uni_centro', 'pap_gerente', now());
  `);
}
```

```ts arquivo=servicos/mcp/src/banco/banco.integracao.ts
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import {
  criarBancoDeEnsaio,
  urlDeEnsaio,
  type BancoDeEnsaio,
} from "../ensaio/banco-de-ensaio.js";
import { LOJAS, semear } from "../ensaio/semente.js";
import { registroSilencioso } from "../registro.js";
import { criarBanco, type Banco } from "./conexao.js";
import { prepararTabelas } from "./tabelas.js";
import { buscarUsuarioParaLogin, lojasComVendasVisiveis } from "./tetteo.js";

const pular = urlDeEnsaio()
  ? false
  : "defina MCP_ENSAIO_PG_URL (Postgres local) para rodar";

const semPermissao = (erro: unknown) =>
  (erro as { code?: string }).code === "42501";

describe("banco do MCP", { skip: pular }, () => {
  let ensaio: BancoDeEnsaio;
  let banco: Banco;

  before(async () => {
    ensaio = await criarBancoDeEnsaio();
    await semear(ensaio.admin);
    banco = criarBanco(ensaio.urlDoServico, registroSilencioso);
    await prepararTabelas(banco);
  });

  after(async () => {
    await banco?.end();
    await ensaio?.encerrar();
  });

  it("o papel tetteo_mcp não lê nenhuma tabela do Tetteo", async () => {
    for (const tabela of [
      "usuario",
      "acesso",
      "unidade",
      "papel_permissao",
      "lancamento",
    ]) {
      await assert.rejects(
        banco.query(`SELECT 1 FROM public.${tabela} LIMIT 1`),
        semPermissao,
        tabela,
      );
    }
  });

  it("não consegue escrever nas visões", async () => {
    await assert.rejects(
      banco.query("UPDATE mcp_leitura.usuario_login SET nome = 'x'"),
      semPermissao,
    );
  });

  it("preparar as tabelas de novo não dá erro", async () => {
    await prepararTabelas(banco);
  });

  it("o login só enxerga pessoa ativa, com e-mail normalizado", async () => {
    const dono = await buscarUsuarioParaLogin(banco, "  DONO@ensaio.test ");
    assert.equal(dono?.id, "usr_dono");
    assert.match(dono?.senhaHash ?? "", /^\$2[aby]\$/);
    assert.equal(
      await buscarUsuarioParaLogin(banco, "suspenso@ensaio.test"),
      null,
    );
    assert.equal(
      await buscarUsuarioParaLogin(banco, "ninguem@ensaio.test"),
      null,
    );
  });

  it("as lojas seguem a regra de permissão do Tetteo", async () => {
    assert.deepEqual(await lojasComVendasVisiveis(banco, "usr_dono"), [
      LOJAS.centro,
      LOJAS.sul,
    ]);
    assert.deepEqual(await lojasComVendasVisiveis(banco, "usr_gerente"), [
      LOJAS.centro,
    ]);
    assert.deepEqual(await lojasComVendasVisiveis(banco, "usr_caixa"), []);
  });

  it("acesso suspenso deixa de valer na hora", async () => {
    await ensaio.admin.query(
      `UPDATE acesso SET status = 'SUSPENSO' WHERE id = 'ac_gerente'`,
    );
    assert.deepEqual(await lojasComVendasVisiveis(banco, "usr_gerente"), []);
    await ensaio.admin.query(
      `UPDATE acesso SET status = 'ATIVO' WHERE id = 'ac_gerente'`,
    );
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run (PowerShell): `$env:MCP_ENSAIO_PG_URL = "<url local>"; npm run test:integracao --prefix servicos/mcp`
Expected: FAIL — `./conexao.js`, `./tabelas.js` e `./tetteo.js` não existem.

- [ ] **Step 4: Implementar**

```ts arquivo=servicos/mcp/src/banco/conexao.ts
import pg from "pg";

import type { Registro } from "../registro.js";

/**
 * O POOL DE CONEXÕES COM O BANCO.
 *
 * Pequeno e com tempos curtos. O servidor MCP responde perguntas simples; uma
 * consulta que passa de 5 s é defeito, e é melhor falhar cedo com `isError`
 * do que segurar a conversa do Claude. O papel `tetteo_mcp` também tem
 * `statement_timeout` no próprio banco — as duas travas se somam de propósito.
 */

export type Banco = pg.Pool;

export function criarBanco(url: string, registro: Registro): Banco {
  const banco = new pg.Pool({
    connectionString: url,
    max: 5,
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 5000,
    query_timeout: 6000,
    application_name: "tetteo-mcp",
  });
  // Sem este ouvinte, uma conexão ociosa que cai derruba o processo inteiro.
  banco.on("error", (erro) =>
    registro.aviso("uma conexão ociosa com o banco caiu", { erro }),
  );
  return banco;
}
```

```ts arquivo=servicos/mcp/src/banco/tabelas.ts
import { readFile } from "node:fs/promises";

import type { Banco } from "./conexao.js";

const ARQUIVO = new URL("../../sql/02-tabelas.sql", import.meta.url);

/** Cria as tabelas do esquema `mcp`, se ainda não existirem. */
export async function prepararTabelas(banco: Banco): Promise<void> {
  const sql = await readFile(ARQUIVO, "utf8");
  const cliente = await banco.connect();
  try {
    await cliente.query("BEGIN");
    // Duas cópias do serviço subindo juntas não brigam pelo CREATE TABLE.
    await cliente.query(
      "SELECT pg_advisory_xact_lock(hashtext('tetteo_mcp.tabelas'))",
    );
    await cliente.query(sql);
    await cliente.query("COMMIT");
  } catch (erro) {
    await cliente.query("ROLLBACK").catch(() => {});
    throw erro;
  } finally {
    cliente.release();
  }
}
```

```ts arquivo=servicos/mcp/src/banco/tetteo.ts
import type { Banco } from "./conexao.js";

/**
 * O QUE O MCP LÊ DO TETTEO — e é só isto.
 *
 * Duas visões do esquema `mcp_leitura`, criadas pelo administrador. O papel
 * `tetteo_mcp` não enxerga nenhuma tabela do Tetteo. Se um dia precisar de
 * mais um dado, a visão é ampliada de propósito, com revisão — nunca "só
 * desta vez".
 */

export type UsuarioParaLogin = { id: string; nome: string; senhaHash: string };

export type Loja = { id: string; nome: string };

export async function buscarUsuarioParaLogin(
  banco: Banco,
  email: string,
): Promise<UsuarioParaLogin | null> {
  const { rows } = await banco.query<{
    id: string;
    nome: string;
    senha_hash: string;
  }>(
    "SELECT id, nome, senha_hash FROM mcp_leitura.usuario_login WHERE email = $1 LIMIT 1",
    [email.trim().toLowerCase()],
  );
  const linha = rows[0];
  return linha
    ? { id: linha.id, nome: linha.nome, senhaHash: linha.senha_hash }
    : null;
}

export async function lojasComVendasVisiveis(
  banco: Banco,
  usuarioId: string,
): Promise<Loja[]> {
  const { rows } = await banco.query<{
    unidade_id: string;
    unidade_nome: string;
  }>(
    "SELECT unidade_id, unidade_nome FROM mcp_leitura.loja_com_vendas_visiveis WHERE usuario_id = $1 ORDER BY unidade_nome",
    [usuarioId],
  );
  return rows.map((linha) => ({
    id: linha.unidade_id,
    nome: linha.unidade_nome,
  }));
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `$env:MCP_ENSAIO_PG_URL = "<url local>"; npm run test:integracao --prefix servicos/mcp` e `npm run typecheck --prefix servicos/mcp`
Expected: 6 testes PASS.

- [ ] **Step 6: Commit**

```bash
git add servicos/mcp/sql servicos/mcp/src/banco servicos/mcp/src/ensaio
git commit -m "MCP: o papel de banco que não lê o Tetteo, duas visões e o banco de ensaio com as migrações reais"
```

---

### Tarefa 7: O armazém do OAuth — pedidos, conexões, códigos e chaves

**Files:**

- Create: `servicos/mcp/src/oauth/armazem.ts`
- Test: `servicos/mcp/src/oauth/armazem.integracao.ts`

**Interfaces:**

- Consumes: `Banco` (Tarefa 6); `gerarSegredo`, `ehDoTipo`, `impressaoDigital`, `pkceConfere` (Tarefa 4).
- Produces:
  - `DURACAO = { pedidoS: 600, codigoS: 120, acessoS: 3600, renovacaoS: 2592000 }`
  - `criarPedido(banco, NovoPedido) → id em claro`; `lerPedido(banco, id) → Pedido | null`; `marcarPedidoAutenticado(banco, hash, usuarioId)`; `apagarPedido(banco, hash)`
  - `falhasRecentes(banco, { emailHash, ipHash }) → { porEmail, porIp }`; `registrarTentativa(banco, { emailHash, ipHash, sucesso })`
  - `aprovarConexao(banco, NovaConexao) → código em claro`
  - `trocarCodigo(banco, { codigo, clientId, redirectUri, verificador }) → ResultadoDaTroca`; `renovar(banco, { refreshToken, clientId }) → ResultadoDaTroca`
  - `ResultadoDaTroca = { ok: true; chaves: ChavesEmitidas } | { ok: false; erro: "invalid_grant"; descricao: string }`, `ChavesEmitidas { accessToken, refreshToken, expiresIn, escopos }`
  - `buscarChaveDeAcesso(banco, token, recurso) → ChaveValida | null`, `ChaveValida { conexaoId, clientId, escopos, usuarioId, unidadeId, unidadeNome, expiraEm: Date }`
  - `revogarPorChave(banco, { token, clientId })`, `revogarConexao(banco, conexaoId, motivo)`, `revogarConexoesDoUsuario(banco, email) → número`, `listarConexoes(banco)`
  - `marcarUso(banco, conexaoId)`, `registrarChamada(banco, ChamadaRegistrada)`, `limparVencidos(banco)`

- [ ] **Step 1: Escrever o teste**

```ts arquivo=servicos/mcp/src/oauth/armazem.integracao.ts
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { criarBanco, type Banco } from "../banco/conexao.js";
import { prepararTabelas } from "../banco/tabelas.js";
import {
  criarBancoDeEnsaio,
  urlDeEnsaio,
  type BancoDeEnsaio,
} from "../ensaio/banco-de-ensaio.js";
import { LOJAS, semear } from "../ensaio/semente.js";
import { registroSilencioso } from "../registro.js";
import {
  aprovarConexao,
  buscarChaveDeAcesso,
  criarPedido,
  falhasRecentes,
  lerPedido,
  limparVencidos,
  registrarChamada,
  registrarTentativa,
  renovar,
  revogarConexoesDoUsuario,
  revogarPorChave,
  trocarCodigo,
  type ChavesEmitidas,
} from "./armazem.js";
import { desafioDe } from "./segredos.js";

const pular = urlDeEnsaio()
  ? false
  : "defina MCP_ENSAIO_PG_URL (Postgres local) para rodar";

const RECURSO = "https://mcp.exemplo.com.br/mcp";
const CLIENTE = "https://claude.ai/oauth/ensaio";
const RETORNO = "https://claude.ai/api/mcp/auth_callback";
const VERIFICADOR = "v".repeat(43) + "erificador-de-ensaio";

describe("armazém do OAuth", { skip: pular }, () => {
  let ensaio: BancoDeEnsaio;
  let banco: Banco;

  before(async () => {
    ensaio = await criarBancoDeEnsaio();
    await semear(ensaio.admin);
    banco = criarBanco(ensaio.urlDoServico, registroSilencioso);
    await prepararTabelas(banco);
  });

  after(async () => {
    await banco?.end();
    await ensaio?.encerrar();
  });

  async function conectar(usuarioId = "usr_gerente", unidadeId = "uni_centro") {
    const codigo = await aprovarConexao(banco, {
      usuarioId,
      unidadeId,
      clientId: CLIENTE,
      clienteNome: "Claude",
      escopos: ["vendas:ler"],
      recurso: RECURSO,
      redirectUri: RETORNO,
      codeChallenge: desafioDe(VERIFICADOR),
    });
    const troca = await trocarCodigo(banco, {
      codigo,
      clientId: CLIENTE,
      redirectUri: RETORNO,
      verificador: VERIFICADOR,
    });
    assert.ok(troca.ok, "a troca do código deveria funcionar");
    return { codigo, chaves: troca.chaves };
  }

  const valida = (chaves: ChavesEmitidas) =>
    buscarChaveDeAcesso(banco, chaves.accessToken, RECURSO);

  it("guarda e devolve o pedido só com o id certo e dentro do prazo", async () => {
    const id = await criarPedido(banco, {
      clientId: CLIENTE,
      clienteNome: "Claude",
      redirectUri: RETORNO,
      state: "abc",
      codeChallenge: desafioDe(VERIFICADOR),
      escopos: ["vendas:ler"],
      recurso: RECURSO,
    });
    const pedido = await lerPedido(banco, id);
    assert.equal(pedido?.state, "abc");
    assert.equal(pedido?.redirectUri, RETORNO);
    assert.equal(await lerPedido(banco, "tmcq_inventado"), null);

    await ensaio.admin.query(
      "UPDATE mcp.pedido_autorizacao SET expira_em = now() - interval '1 second'",
    );
    assert.equal(await lerPedido(banco, id), null);
  });

  it("troca o código por chaves e a chave de acesso leva a loja", async () => {
    const { chaves } = await conectar();
    assert.match(chaves.accessToken, /^tmcp_/);
    assert.match(chaves.refreshToken, /^tmcr_/);
    assert.equal(chaves.expiresIn, 3600);

    const chave = await valida(chaves);
    assert.equal(chave?.unidadeId, LOJAS.centro.id);
    assert.equal(chave?.unidadeNome, LOJAS.centro.nome);
    assert.equal(chave?.clientId, CLIENTE);
    assert.equal(
      await buscarChaveDeAcesso(banco, chaves.accessToken, "https://outro/mcp"),
      null,
    );
  });

  it("código usado duas vezes revoga a conexão inteira", async () => {
    const { codigo, chaves } = await conectar();
    const segunda = await trocarCodigo(banco, {
      codigo,
      clientId: CLIENTE,
      redirectUri: RETORNO,
      verificador: VERIFICADOR,
    });
    assert.equal(segunda.ok, false);
    assert.equal(await valida(chaves), null);
  });

  it("recusa PKCE errado, outro cliente, outro retorno e código vencido", async () => {
    const aprovar = () =>
      aprovarConexao(banco, {
        usuarioId: "usr_gerente",
        unidadeId: "uni_centro",
        clientId: CLIENTE,
        clienteNome: "Claude",
        escopos: ["vendas:ler"],
        recurso: RECURSO,
        redirectUri: RETORNO,
        codeChallenge: desafioDe(VERIFICADOR),
      });
    const base = {
      clientId: CLIENTE,
      redirectUri: RETORNO,
      verificador: VERIFICADOR,
    };

    for (const troca of [
      { verificador: "x".repeat(43) },
      { clientId: "https://claude.ai/outro" },
      { redirectUri: "https://claude.ai/outro" },
    ]) {
      const resultado = await trocarCodigo(banco, {
        ...base,
        ...troca,
        codigo: await aprovar(),
      });
      assert.equal(resultado.ok, false);
    }

    const vencido = await aprovar();
    await ensaio.admin.query(
      "UPDATE mcp.codigo_autorizacao SET expira_em = now() - interval '1 second' WHERE usado_em IS NULL",
    );
    assert.equal(
      (await trocarCodigo(banco, { ...base, codigo: vencido })).ok,
      false,
    );
  });

  it("renova trocando a chave, e a antiga reapresentada derruba tudo", async () => {
    const { chaves } = await conectar();
    const renovada = await renovar(banco, {
      refreshToken: chaves.refreshToken,
      clientId: CLIENTE,
    });
    assert.ok(renovada.ok);
    assert.notEqual(renovada.chaves.refreshToken, chaves.refreshToken);
    assert.ok(await valida(renovada.chaves));

    const reuso = await renovar(banco, {
      refreshToken: chaves.refreshToken,
      clientId: CLIENTE,
    });
    assert.equal(reuso.ok, false);
    assert.equal(await valida(renovada.chaves), null);
  });

  it("chave de renovação apresentada por outro cliente revoga a conexão", async () => {
    const { chaves } = await conectar();
    const roubo = await renovar(banco, {
      refreshToken: chaves.refreshToken,
      clientId: "https://claude.ai/outro",
    });
    assert.equal(roubo.ok, false);
    assert.equal(await valida(chaves), null);
  });

  it("quem perde a permissão perde a chave na hora", async () => {
    const { chaves } = await conectar();
    await ensaio.admin.query(
      `UPDATE acesso SET status = 'SUSPENSO' WHERE id = 'ac_gerente'`,
    );
    assert.equal(await valida(chaves), null);
    const renovada = await renovar(banco, {
      refreshToken: chaves.refreshToken,
      clientId: CLIENTE,
    });
    assert.equal(renovada.ok, false);
    await ensaio.admin.query(
      `UPDATE acesso SET status = 'ATIVO' WHERE id = 'ac_gerente'`,
    );
  });

  it("revoga pela própria chave e por pessoa", async () => {
    const primeira = await conectar();
    await revogarPorChave(banco, {
      token: primeira.chaves.refreshToken,
      clientId: CLIENTE,
    });
    assert.equal(await valida(primeira.chaves), null);

    const segunda = await conectar("usr_dono", "uni_sul");
    assert.ok(await valida(segunda.chaves));
    assert.ok((await revogarConexoesDoUsuario(banco, "DONO@ensaio.test")) >= 1);
    assert.equal(await valida(segunda.chaves), null);
  });

  it("guarda só impressões digitais, nunca a chave em claro", async () => {
    const { chaves } = await conectar();
    const { rows } = await ensaio.admin.query(
      "SELECT hash FROM mcp.token UNION ALL SELECT hash FROM mcp.codigo_autorizacao",
    );
    for (const { hash } of rows as { hash: string }[]) {
      assert.match(hash, /^[0-9a-f]{64}$/);
    }
    assert.ok(
      !rows.some((l: { hash: string }) => l.hash === chaves.accessToken),
    );
  });

  it("conta tentativas falhas por e-mail e por IP", async () => {
    await registrarTentativa(banco, {
      emailHash: "e1",
      ipHash: "i1",
      sucesso: false,
    });
    await registrarTentativa(banco, {
      emailHash: "e1",
      ipHash: "i2",
      sucesso: false,
    });
    await registrarTentativa(banco, {
      emailHash: "e1",
      ipHash: "i1",
      sucesso: true,
    });
    assert.deepEqual(
      await falhasRecentes(banco, { emailHash: "e1", ipHash: "i1" }),
      {
        porEmail: 2,
        porIp: 1,
      },
    );
  });

  it("registra chamadas e limpa o que venceu", async () => {
    await registrarChamada(banco, {
      conexaoId: "cx",
      ferramenta: "vendas_do_dia",
      argumentos: { data: "2026-09-10" },
      resultado: "ok",
      duracaoMs: 3,
    });
    await limparVencidos(banco);
    const { rows } = await ensaio.admin.query(
      "SELECT count(*)::int AS n FROM mcp.chamada",
    );
    assert.equal(rows[0].n, 1);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `$env:MCP_ENSAIO_PG_URL = "<url local>"; npm run test:integracao --prefix servicos/mcp`
Expected: FAIL — `./armazem.js` não existe.

- [ ] **Step 3: Implementar**

```ts arquivo=servicos/mcp/src/oauth/armazem.ts
import type pg from "pg";

import type { Banco } from "../banco/conexao.js";
import type { ChamadaRegistrada } from "../mcp/vendas-do-dia.js";
import {
  ehDoTipo,
  gerarSegredo,
  impressaoDigital,
  pkceConfere,
} from "./segredos.js";

/**
 * O ARMAZÉM DO OAUTH: todo o estado do login mora aqui, no esquema `mcp`.
 *
 * Nada fica na memória do processo. Um deploy no meio de um login não perde o
 * pedido; um deploy no meio de uma conversa não derruba a chave.
 *
 * Três regras de segurança vivem neste arquivo:
 *
 *   1. Só a impressão digital de cada chave vai para o banco.
 *   2. Código de autorização vale uma vez. Usado de novo = alguém copiou;
 *      a conexão inteira cai.
 *   3. Chave de renovação é trocada a cada uso. A antiga reapresentada, ou
 *      apresentada por outro cliente = roubo provável; a conexão inteira cai.
 *
 * Nas regras 2 e 3 a revogação precisa SOBREVIVER ao erro. Por isso as
 * funções de troca devolvem `{ ok: false }` em vez de lançar: a transação
 * confirma a revogação, e só depois quem chamou responde `invalid_grant`.
 */

export const DURACAO = {
  pedidoS: 10 * 60,
  codigoS: 2 * 60,
  acessoS: 60 * 60,
  renovacaoS: 30 * 24 * 60 * 60,
} as const;

type Executor = Pick<pg.Pool | pg.PoolClient, "query">;

async function emTransacao<T>(
  banco: Banco,
  trabalho: (cliente: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const cliente = await banco.connect();
  try {
    await cliente.query("BEGIN");
    const resultado = await trabalho(cliente);
    await cliente.query("COMMIT");
    return resultado;
  } catch (erro) {
    await cliente.query("ROLLBACK").catch(() => {});
    throw erro;
  } finally {
    cliente.release();
  }
}

// ---------------------------------------------------------------------------
// Pedidos de autorização em andamento

export type NovoPedido = {
  clientId: string;
  clienteNome: string;
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
  escopos: string[];
  recurso: string;
};

export type Pedido = NovoPedido & {
  hash: string;
  usuarioId: string | null;
  autenticadoEm: Date | null;
};

export async function criarPedido(
  banco: Banco,
  pedido: NovoPedido,
): Promise<string> {
  const id = gerarSegredo("pedido");
  await banco.query(
    `INSERT INTO mcp.pedido_autorizacao
       (hash, client_id, cliente_nome, redirect_uri, state, code_challenge, escopos, recurso, expira_em)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now() + make_interval(secs => $9))`,
    [
      impressaoDigital(id),
      pedido.clientId,
      pedido.clienteNome,
      pedido.redirectUri,
      pedido.state,
      pedido.codeChallenge,
      pedido.escopos,
      pedido.recurso,
      DURACAO.pedidoS,
    ],
  );
  return id;
}

export async function lerPedido(
  banco: Banco,
  id: string,
): Promise<Pedido | null> {
  if (!ehDoTipo(id, "pedido")) return null;
  const { rows } = await banco.query(
    `SELECT hash, client_id, cliente_nome, redirect_uri, state, code_challenge,
            escopos, recurso, usuario_id, autenticado_em
       FROM mcp.pedido_autorizacao
      WHERE hash = $1 AND expira_em > now()`,
    [impressaoDigital(id)],
  );
  const linha = rows[0];
  if (!linha) return null;
  return {
    hash: linha.hash,
    clientId: linha.client_id,
    clienteNome: linha.cliente_nome,
    redirectUri: linha.redirect_uri,
    state: linha.state,
    codeChallenge: linha.code_challenge,
    escopos: linha.escopos,
    recurso: linha.recurso,
    usuarioId: linha.usuario_id,
    autenticadoEm: linha.autenticado_em,
  };
}

export async function marcarPedidoAutenticado(
  banco: Banco,
  hash: string,
  usuarioId: string,
): Promise<void> {
  await banco.query(
    `UPDATE mcp.pedido_autorizacao
        SET usuario_id = $2, autenticado_em = now()
      WHERE hash = $1`,
    [hash, usuarioId],
  );
}

export async function apagarPedido(banco: Banco, hash: string): Promise<void> {
  await banco.query("DELETE FROM mcp.pedido_autorizacao WHERE hash = $1", [
    hash,
  ]);
}

// ---------------------------------------------------------------------------
// Tentativas de login

export async function falhasRecentes(
  banco: Banco,
  chaves: { emailHash: string; ipHash: string },
): Promise<{ porEmail: number; porIp: number }> {
  const { rows } = await banco.query(
    `SELECT count(*) FILTER (WHERE email_hash = $1)::int AS por_email,
            count(*) FILTER (WHERE ip_hash = $2)::int AS por_ip
       FROM mcp.tentativa_login
      WHERE NOT sucesso
        AND criada_em > now() - interval '15 minutes'
        AND (email_hash = $1 OR ip_hash = $2)`,
    [chaves.emailHash, chaves.ipHash],
  );
  return { porEmail: rows[0].por_email, porIp: rows[0].por_ip };
}

export async function registrarTentativa(
  banco: Banco,
  tentativa: { emailHash: string; ipHash: string; sucesso: boolean },
): Promise<void> {
  await banco.query(
    "INSERT INTO mcp.tentativa_login (email_hash, ip_hash, sucesso) VALUES ($1, $2, $3)",
    [tentativa.emailHash, tentativa.ipHash, tentativa.sucesso],
  );
}

// ---------------------------------------------------------------------------
// Conexões, códigos e chaves

export type NovaConexao = {
  usuarioId: string;
  unidadeId: string;
  clientId: string;
  clienteNome: string;
  escopos: string[];
  recurso: string;
  redirectUri: string;
  codeChallenge: string;
};

export type ChavesEmitidas = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  escopos: string[];
};

export type ResultadoDaTroca =
  | { ok: true; chaves: ChavesEmitidas }
  | { ok: false; erro: "invalid_grant"; descricao: string };

const falha = (descricao: string): ResultadoDaTroca => ({
  ok: false,
  erro: "invalid_grant",
  descricao,
});

/** A pessoa continua ativa e continua podendo ver as vendas daquela loja? */
async function podeContinuar(
  executor: Executor,
  usuarioId: string,
  unidadeId: string,
): Promise<boolean> {
  const { rows } = await executor.query(
    `SELECT 1
       FROM mcp_leitura.usuario_login u
       JOIN mcp_leitura.loja_com_vendas_visiveis l ON l.usuario_id = u.id
      WHERE u.id = $1 AND l.unidade_id = $2`,
    [usuarioId, unidadeId],
  );
  return rows.length > 0;
}

async function revogarNaTransacao(
  executor: Executor,
  conexaoId: string,
  motivo: string,
): Promise<void> {
  await executor.query(
    `UPDATE mcp.conexao SET revogada_em = now(), motivo_revogacao = $2
      WHERE id = $1 AND revogada_em IS NULL`,
    [conexaoId, motivo],
  );
  await executor.query("DELETE FROM mcp.token WHERE conexao_id = $1", [
    conexaoId,
  ]);
}

async function emitirPar(
  cliente: pg.PoolClient,
  conexaoId: string,
  escopos: string[],
): Promise<ChavesEmitidas> {
  const accessToken = gerarSegredo("acesso");
  const refreshToken = gerarSegredo("renovacao");
  await cliente.query(
    `INSERT INTO mcp.token (hash, conexao_id, tipo, expira_em) VALUES
       ($1, $3, 'acesso', now() + make_interval(secs => $4)),
       ($2, $3, 'renovacao', now() + make_interval(secs => $5))`,
    [
      impressaoDigital(accessToken),
      impressaoDigital(refreshToken),
      conexaoId,
      DURACAO.acessoS,
      DURACAO.renovacaoS,
    ],
  );
  return { accessToken, refreshToken, expiresIn: DURACAO.acessoS, escopos };
}

export async function aprovarConexao(
  banco: Banco,
  conexao: NovaConexao,
): Promise<string> {
  const codigo = gerarSegredo("codigo");
  await emTransacao(banco, async (cliente) => {
    const { rows } = await cliente.query(
      `INSERT INTO mcp.conexao (usuario_id, unidade_id, client_id, cliente_nome, escopos, recurso)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        conexao.usuarioId,
        conexao.unidadeId,
        conexao.clientId,
        conexao.clienteNome,
        conexao.escopos,
        conexao.recurso,
      ],
    );
    await cliente.query(
      `INSERT INTO mcp.codigo_autorizacao (hash, conexao_id, client_id, redirect_uri, code_challenge, expira_em)
       VALUES ($1, $2, $3, $4, $5, now() + make_interval(secs => $6))`,
      [
        impressaoDigital(codigo),
        rows[0].id,
        conexao.clientId,
        conexao.redirectUri,
        conexao.codeChallenge,
        DURACAO.codigoS,
      ],
    );
  });
  return codigo;
}

export async function trocarCodigo(
  banco: Banco,
  pedido: {
    codigo: string;
    clientId: string;
    redirectUri: string;
    verificador: string;
  },
): Promise<ResultadoDaTroca> {
  if (!ehDoTipo(pedido.codigo, "codigo")) {
    return falha("Código inválido ou expirado.");
  }
  return emTransacao(banco, async (cliente) => {
    const { rows } = await cliente.query(
      `SELECT k.hash, k.conexao_id, k.client_id, k.redirect_uri, k.code_challenge,
              k.usado_em, k.expira_em > now() AS vigente,
              x.usuario_id, x.unidade_id, x.escopos, x.revogada_em
         FROM mcp.codigo_autorizacao k
         JOIN mcp.conexao x ON x.id = k.conexao_id
        WHERE k.hash = $1
          FOR UPDATE OF k`,
      [impressaoDigital(pedido.codigo)],
    );
    const linha = rows[0];
    if (!linha) return falha("Código inválido ou expirado.");

    if (linha.usado_em) {
      await revogarNaTransacao(cliente, linha.conexao_id, "código reutilizado");
      return falha("Este código já foi usado.");
    }
    // Qualquer tentativa queima o código: ele não serve para tentar de novo.
    await cliente.query(
      "UPDATE mcp.codigo_autorizacao SET usado_em = now() WHERE hash = $1",
      [linha.hash],
    );
    if (!linha.vigente || linha.revogada_em) {
      return falha("Código inválido ou expirado.");
    }
    if (
      linha.client_id !== pedido.clientId ||
      linha.redirect_uri !== pedido.redirectUri
    ) {
      return falha("O código não pertence a este cliente ou retorno.");
    }
    if (!pkceConfere(pedido.verificador, linha.code_challenge)) {
      return falha("A verificação PKCE não confere.");
    }
    if (!(await podeContinuar(cliente, linha.usuario_id, linha.unidade_id))) {
      await revogarNaTransacao(cliente, linha.conexao_id, "sem permissão");
      return falha("A conta não tem mais permissão para esta loja.");
    }
    return {
      ok: true,
      chaves: await emitirPar(cliente, linha.conexao_id, linha.escopos),
    };
  });
}

export async function renovar(
  banco: Banco,
  pedido: { refreshToken: string; clientId: string },
): Promise<ResultadoDaTroca> {
  if (!ehDoTipo(pedido.refreshToken, "renovacao")) {
    return falha("Chave de renovação inválida.");
  }
  return emTransacao(banco, async (cliente) => {
    const { rows } = await cliente.query(
      `SELECT t.hash, t.conexao_id, t.substituido_em, t.expira_em > now() AS vigente,
              x.client_id, x.usuario_id, x.unidade_id, x.escopos, x.revogada_em
         FROM mcp.token t
         JOIN mcp.conexao x ON x.id = t.conexao_id
        WHERE t.hash = $1 AND t.tipo = 'renovacao'
          FOR UPDATE OF t`,
      [impressaoDigital(pedido.refreshToken)],
    );
    const linha = rows[0];
    if (!linha || linha.revogada_em) {
      return falha("Chave de renovação inválida.");
    }
    if (linha.client_id !== pedido.clientId) {
      await revogarNaTransacao(
        cliente,
        linha.conexao_id,
        "chave de renovação apresentada por outro cliente",
      );
      return falha("Chave de renovação inválida.");
    }
    if (linha.substituido_em) {
      await revogarNaTransacao(
        cliente,
        linha.conexao_id,
        "chave de renovação reutilizada",
      );
      return falha("Chave de renovação já usada.");
    }
    if (!linha.vigente) return falha("Chave de renovação expirada.");
    if (!(await podeContinuar(cliente, linha.usuario_id, linha.unidade_id))) {
      await revogarNaTransacao(cliente, linha.conexao_id, "sem permissão");
      return falha("A conta não tem mais permissão para esta loja.");
    }
    await cliente.query(
      "UPDATE mcp.token SET substituido_em = now() WHERE hash = $1",
      [linha.hash],
    );
    return {
      ok: true,
      chaves: await emitirPar(cliente, linha.conexao_id, linha.escopos),
    };
  });
}

// ---------------------------------------------------------------------------
// Verificação a cada requisição

export type ChaveValida = {
  conexaoId: string;
  clientId: string;
  escopos: string[];
  usuarioId: string;
  unidadeId: string;
  unidadeNome: string;
  expiraEm: Date;
};

/**
 * A chave vale se: existe, é de acesso, não venceu, a conexão não foi
 * revogada, foi emitida para ESTE recurso, a pessoa continua ativa e continua
 * podendo ver as vendas da loja. Tudo numa consulta só.
 */
export async function buscarChaveDeAcesso(
  banco: Banco,
  token: string,
  recurso: string,
): Promise<ChaveValida | null> {
  if (!ehDoTipo(token, "acesso")) return null;
  const { rows } = await banco.query(
    `SELECT x.id AS conexao_id, x.client_id, x.escopos, x.usuario_id,
            x.unidade_id, l.unidade_nome, t.expira_em
       FROM mcp.token t
       JOIN mcp.conexao x ON x.id = t.conexao_id AND x.revogada_em IS NULL
       JOIN mcp_leitura.usuario_login u ON u.id = x.usuario_id
       JOIN mcp_leitura.loja_com_vendas_visiveis l
         ON l.usuario_id = x.usuario_id AND l.unidade_id = x.unidade_id
      WHERE t.hash = $1
        AND t.tipo = 'acesso'
        AND t.expira_em > now()
        AND x.recurso = $2`,
    [impressaoDigital(token), recurso],
  );
  const linha = rows[0];
  if (!linha) return null;
  return {
    conexaoId: linha.conexao_id,
    clientId: linha.client_id,
    escopos: linha.escopos,
    usuarioId: linha.usuario_id,
    unidadeId: linha.unidade_id,
    unidadeNome: linha.unidade_nome,
    expiraEm: linha.expira_em,
  };
}

export async function marcarUso(
  banco: Banco,
  conexaoId: string,
): Promise<void> {
  // No máximo uma escrita por minuto por conexão: é informação, não trava.
  await banco.query(
    `UPDATE mcp.conexao SET ultimo_uso_em = now()
      WHERE id = $1
        AND (ultimo_uso_em IS NULL OR ultimo_uso_em < now() - interval '1 minute')`,
    [conexaoId],
  );
}

// ---------------------------------------------------------------------------
// Revogação

export async function revogarPorChave(
  banco: Banco,
  pedido: { token: string; clientId: string },
): Promise<void> {
  await emTransacao(banco, async (cliente) => {
    const { rows } = await cliente.query(
      `SELECT x.id FROM mcp.token t
         JOIN mcp.conexao x ON x.id = t.conexao_id
        WHERE t.hash = $1 AND x.client_id = $2`,
      [impressaoDigital(pedido.token), pedido.clientId],
    );
    if (rows[0]) {
      await revogarNaTransacao(cliente, rows[0].id, "revogada pelo cliente");
    }
  });
}

export async function revogarConexao(
  banco: Banco,
  conexaoId: string,
  motivo: string,
): Promise<void> {
  await emTransacao(banco, (cliente) =>
    revogarNaTransacao(cliente, conexaoId, motivo),
  );
}

export async function revogarConexoesDoUsuario(
  banco: Banco,
  email: string,
): Promise<number> {
  return emTransacao(banco, async (cliente) => {
    const { rows } = await cliente.query(
      `SELECT x.id FROM mcp.conexao x
         JOIN mcp_leitura.usuario_login u ON u.id = x.usuario_id
        WHERE u.email = $1 AND x.revogada_em IS NULL`,
      [email.trim().toLowerCase()],
    );
    for (const { id } of rows) {
      await revogarNaTransacao(cliente, id, "revogada pelo administrador");
    }
    return rows.length;
  });
}

export type ConexaoListada = {
  id: string;
  email: string | null;
  unidadeNome: string | null;
  clienteNome: string;
  criadaEm: Date;
  ultimoUsoEm: Date | null;
  revogadaEm: Date | null;
  motivo: string | null;
};

export async function listarConexoes(banco: Banco): Promise<ConexaoListada[]> {
  const { rows } = await banco.query(
    `SELECT x.id, u.email, l.unidade_nome, x.cliente_nome, x.criada_em,
            x.ultimo_uso_em, x.revogada_em, x.motivo_revogacao
       FROM mcp.conexao x
       LEFT JOIN mcp_leitura.usuario_login u ON u.id = x.usuario_id
       LEFT JOIN mcp_leitura.loja_com_vendas_visiveis l
         ON l.usuario_id = x.usuario_id AND l.unidade_id = x.unidade_id
      ORDER BY x.criada_em DESC
      LIMIT 100`,
  );
  return rows.map((linha) => ({
    id: linha.id,
    email: linha.email,
    unidadeNome: linha.unidade_nome,
    clienteNome: linha.cliente_nome,
    criadaEm: linha.criada_em,
    ultimoUsoEm: linha.ultimo_uso_em,
    revogadaEm: linha.revogada_em,
    motivo: linha.motivo_revogacao,
  }));
}

// ---------------------------------------------------------------------------
// Registro de uso e faxina

export async function registrarChamada(
  banco: Banco,
  chamada: ChamadaRegistrada,
): Promise<void> {
  await banco.query(
    `INSERT INTO mcp.chamada (conexao_id, ferramenta, argumentos, resultado, duracao_ms)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      chamada.conexaoId,
      chamada.ferramenta,
      JSON.stringify(chamada.argumentos),
      chamada.resultado,
      chamada.duracaoMs,
    ],
  );
}

/** Apaga o que venceu há tempo. Chaves de renovação trocadas ficam até
 * vencer: são elas que denunciam o reuso. */
export async function limparVencidos(banco: Banco): Promise<void> {
  await banco.query(`
    DELETE FROM mcp.pedido_autorizacao WHERE expira_em < now() - interval '1 hour';
    DELETE FROM mcp.codigo_autorizacao WHERE expira_em < now() - interval '1 day';
    DELETE FROM mcp.token WHERE expira_em < now() - interval '1 day';
    DELETE FROM mcp.tentativa_login WHERE criada_em < now() - interval '1 day';
  `);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `$env:MCP_ENSAIO_PG_URL = "<url local>"; npm run test:integracao --prefix servicos/mcp` e `npm run typecheck --prefix servicos/mcp`
Expected: todos PASS.

- [ ] **Step 5: Commit**

```bash
git add servicos/mcp/src/oauth/armazem.ts servicos/mcp/src/oauth/armazem.integracao.ts
git commit -m "MCP: o armazém do OAuth — código de uso único, chave trocada a cada renovação e reuso que derruba a conexão"
```

---

### Tarefa 8: A tela de login e consentimento (`/oauth/authorize`)

**Files:**

- Create: `servicos/mcp/src/oauth/paginas.ts`, `servicos/mcp/src/oauth/rotas-autorizar.ts`
- Test: `servicos/mcp/src/oauth/paginas.test.ts`, `servicos/mcp/src/oauth/autorizar.integracao.ts`

**Interfaces:**

- Consumes: `Config`, `Registro`, `Banco`, `ResolverCliente`/`ErroDeCliente`, `redirecionamentoPermitido`/`descreverDestino`/`ehLoopback`, `escoposConcedidos`, `desafioValido`/`impressaoDigital`, `buscarUsuarioParaLogin`/`lojasComVendasVisiveis`, e do armazém `criarPedido`, `lerPedido`, `marcarPedidoAutenticado`, `apagarPedido`, `falhasRecentes`, `registrarTentativa`, `aprovarConexao`.
- Produces: `rotasDeAutorizacao(deps: DependenciasDoLogin) → express.Router` (monte em `/oauth`; precisa de `express.urlencoded` antes), `DependenciasDoLogin { banco, config, resolverCliente, registro }`.
- Produces: `escaparHtml`, `paginaDeLogin`, `paginaDeEscolha`, `paginaDeErro`, `aplicarCabecalhosDePagina(res, origensDoFormulario)`, `ESTILO`.

- [ ] **Step 1: Escrever os testes**

```ts arquivo=servicos/mcp/src/oauth/paginas.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  escaparHtml,
  paginaDeEscolha,
  paginaDeErro,
  paginaDeLogin,
} from "./paginas.js";

const login = {
  pedidoId: "tmcq_x",
  clienteNome: "Claude",
  clienteHost: "claude.ai",
  destino: "claude.ai",
  loopback: false,
};

describe("páginas", () => {
  it("escapa HTML", () => {
    assert.equal(
      escaparHtml(`<a href="x">'&'</a>`),
      "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;",
    );
  });

  it("a tela de login diz quem pede, para onde volta, o que pode e o que não pode", () => {
    const html = paginaDeLogin(login);
    assert.match(html, /claude\.ai/);
    assert.match(html, /Vai poder/);
    assert.match(html, /Não vai poder/);
    assert.match(html, /somente leitura/);
    assert.match(html, /name="pedido" value="tmcq_x"/);
    assert.match(html, /autocomplete="current-password"/);
    assert.ok(!html.includes("Só continue se"));
  });

  it("avisa quando o retorno é o próprio computador", () => {
    assert.match(paginaDeLogin({ ...login, loopback: true }), /Só continue se/);
  });

  it("nunca injeta o que veio de fora", () => {
    const html = paginaDeLogin({
      ...login,
      clienteNome: "<script>alert(1)</script>",
      email: `"><img src=x>`,
      erro: "<b>x</b>",
    });
    assert.ok(!html.includes("<script>alert"));
    assert.ok(!html.includes("<img src=x>"));
    assert.ok(!html.includes("<b>x</b>"));
  });

  it("lista as lojas para escolher e mostra erros", () => {
    const html = paginaDeEscolha({
      pedidoId: "tmcq_x",
      clienteNome: "Claude",
      lojas: [
        { id: "uni_centro", nome: "Vitaliano Centro" },
        { id: "uni_sul", nome: "Vitaliano Zona Sul" },
      ],
    });
    assert.match(html, /value="uni_centro"/);
    assert.match(html, /Vitaliano Zona Sul/);
    assert.match(paginaDeErro({ titulo: "T", mensagem: "M" }), /<h1>T<\/h1>/);
  });
});
```

```ts arquivo=servicos/mcp/src/oauth/autorizar.integracao.ts
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

import express from "express";

import { criarBanco, type Banco } from "../banco/conexao.js";
import { prepararTabelas } from "../banco/tabelas.js";
import { lerConfig } from "../config.js";
import {
  criarBancoDeEnsaio,
  urlDeEnsaio,
  type BancoDeEnsaio,
} from "../ensaio/banco-de-ensaio.js";
import { PESSOAS, SENHA_DE_ENSAIO, semear } from "../ensaio/semente.js";
import { registroSilencioso } from "../registro.js";
import { ErroDeCliente, type ResolverCliente } from "./cliente.js";
import { rotasDeAutorizacao } from "./rotas-autorizar.js";
import { desafioDe } from "./segredos.js";

const pular = urlDeEnsaio()
  ? false
  : "defina MCP_ENSAIO_PG_URL (Postgres local) para rodar";

const CLIENTE = "https://claude.ai/oauth/ensaio";
const RETORNO = "http://127.0.0.1:4555/callback";
const DESAFIO = desafioDe("v".repeat(50));

describe("/oauth/authorize", { skip: pular }, () => {
  let ensaio: BancoDeEnsaio;
  let banco: Banco;
  let base: string;
  let fecharServidor: () => void;
  let nomeDoCliente = "Claude de ensaio";

  const resolverCliente: ResolverCliente = async (clientId) => {
    if (clientId !== CLIENTE) throw new ErroDeCliente("Cliente desconhecido.");
    return {
      clientId,
      nome: nomeDoCliente,
      redirectUris: ["http://127.0.0.1/callback"],
    };
  };

  before(async () => {
    ensaio = await criarBancoDeEnsaio();
    await semear(ensaio.admin);
    banco = criarBanco(ensaio.urlDoServico, registroSilencioso);
    await prepararTabelas(banco);
    const config = lerConfig({
      DATABASE_URL: ensaio.urlDoServico,
      MCP_URL_PUBLICA: "http://127.0.0.1:9",
    });
    const app = express();
    app.use("/oauth", express.urlencoded({ extended: false, limit: "16kb" }));
    app.use(
      "/oauth",
      rotasDeAutorizacao({
        banco,
        config,
        resolverCliente,
        registro: registroSilencioso,
      }),
    );
    const servidor = app.listen(0);
    await new Promise((pronto) => servidor.once("listening", pronto));
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
    fecharServidor = () => servidor.close();
  });

  after(async () => {
    fecharServidor?.();
    await banco?.end();
    await ensaio?.encerrar();
  });

  function urlDeAutorizacao(extra: Record<string, string> = {}) {
    const url = new URL("/oauth/authorize", base);
    const parametros = {
      response_type: "code",
      client_id: CLIENTE,
      redirect_uri: RETORNO,
      code_challenge: DESAFIO,
      code_challenge_method: "S256",
      state: "estado-123",
      scope: "vendas:ler",
      resource: "http://127.0.0.1:9/mcp",
      ...extra,
    };
    for (const [chave, valor] of Object.entries(parametros)) {
      if (valor !== "") url.searchParams.set(chave, valor);
    }
    return url;
  }

  async function abrirPedido(extra: Record<string, string> = {}) {
    const resposta = await fetch(urlDeAutorizacao(extra), {
      redirect: "manual",
    });
    const html = await resposta.text();
    const pedido = /name="pedido" value="([^"]+)"/.exec(html)?.[1];
    return { resposta, html, pedido };
  }

  const enviar = (campos: Record<string, string>) =>
    fetch(new URL("/oauth/authorize", base), {
      method: "POST",
      body: new URLSearchParams(campos),
      redirect: "manual",
    });

  it("mostra a tela com as travas de página", async () => {
    const { resposta, html, pedido } = await abrirPedido();
    assert.equal(resposta.status, 200);
    assert.match(pedido ?? "", /^tmcq_/);
    assert.match(html, /Claude de ensaio/);
    assert.match(html, /este computador/);
    const csp = resposta.headers.get("content-security-policy") ?? "";
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /form-action 'self' http:\/\/127\.0\.0\.1:4555/);
    assert.equal(resposta.headers.get("x-frame-options"), "DENY");
    assert.equal(resposta.headers.get("cache-control"), "no-store");
  });

  it("cliente desconhecido ou retorno estranho: página de erro, sem redirecionar", async () => {
    for (const extra of [
      { client_id: "https://evil.example/c" },
      { redirect_uri: "https://evil.example/cb" },
      { client_id: "" },
    ]) {
      const { resposta } = await abrirPedido(extra);
      assert.equal(resposta.status, 400);
      assert.equal(resposta.headers.get("location"), null);
    }
  });

  it("sem PKCE, com escopo inexistente ou outro recurso: devolve o erro ao cliente", async () => {
    for (const [extra, erro] of [
      [{ code_challenge: "" }, "invalid_request"],
      [{ code_challenge_method: "plain" }, "invalid_request"],
      [{ scope: "pedidos:escrever" }, "invalid_scope"],
      [{ resource: "https://outro.example/mcp" }, "invalid_target"],
      [{ response_type: "token" }, "unsupported_response_type"],
    ] as const) {
      const { resposta } = await abrirPedido(extra);
      assert.equal(resposta.status, 303);
      const destino = new URL(resposta.headers.get("location") ?? "");
      assert.equal(destino.origin, "http://127.0.0.1:4555");
      assert.equal(destino.searchParams.get("error"), erro);
      assert.equal(destino.searchParams.get("state"), "estado-123");
    }
  });

  it("gerente com a senha certa recebe o código direto (uma loja só)", async () => {
    const { pedido } = await abrirPedido();
    const resposta = await enviar({
      pedido: pedido!,
      acao: "autorizar",
      email: PESSOAS.gerente,
      senha: SENHA_DE_ENSAIO,
    });
    assert.equal(resposta.status, 303);
    const destino = new URL(resposta.headers.get("location") ?? "");
    assert.match(destino.searchParams.get("code") ?? "", /^tmcc_/);
    assert.equal(destino.searchParams.get("state"), "estado-123");
    assert.equal(destino.searchParams.get("iss"), "http://127.0.0.1:9");

    // O pedido foi consumido: não serve de novo.
    const deNovo = await enviar({
      pedido: pedido!,
      acao: "autorizar",
      email: PESSOAS.gerente,
      senha: SENHA_DE_ENSAIO,
    });
    assert.equal(deNovo.status, 400);
  });

  it("senha errada, pessoa suspensa e caixa sem permissão não recebem código", async () => {
    for (const [email, senha, status] of [
      [PESSOAS.gerente, "errada", 401],
      [PESSOAS.suspenso, SENHA_DE_ENSAIO, 401],
      [PESSOAS.caixa, SENHA_DE_ENSAIO, 403],
    ] as const) {
      const { pedido } = await abrirPedido();
      const resposta = await enviar({
        pedido: pedido!,
        acao: "autorizar",
        email,
        senha,
      });
      assert.equal(resposta.status, status, email);
      assert.equal(resposta.headers.get("location"), null);
    }
  });

  it("dono com duas lojas escolhe uma, e loja fora da lista é recusada", async () => {
    const { pedido } = await abrirPedido();
    const escolha = await enviar({
      pedido: pedido!,
      acao: "autorizar",
      email: PESSOAS.dono,
      senha: SENHA_DE_ENSAIO,
    });
    assert.equal(escolha.status, 200);
    const html = await escolha.text();
    assert.match(html, /Vitaliano Centro/);
    assert.match(html, /Vitaliano Zona Sul/);
    assert.ok(!html.includes("Loja Fechada"));

    const fechada = await enviar({
      pedido: pedido!,
      acao: "autorizar",
      unidade: "uni_fechada",
    });
    assert.equal(fechada.status, 400);

    const certa = await enviar({
      pedido: pedido!,
      acao: "autorizar",
      unidade: "uni_sul",
    });
    assert.equal(certa.status, 303);
    assert.match(certa.headers.get("location") ?? "", /code=tmcc_/);
  });

  it("cancelar devolve access_denied", async () => {
    const { pedido } = await abrirPedido();
    const resposta = await enviar({ pedido: pedido!, acao: "cancelar" });
    const destino = new URL(resposta.headers.get("location") ?? "");
    assert.equal(destino.searchParams.get("error"), "access_denied");
  });

  it("pedido inventado é recusado", async () => {
    const resposta = await enviar({
      pedido: "tmcq_inventado",
      acao: "autorizar",
      email: PESSOAS.gerente,
      senha: SENHA_DE_ENSAIO,
    });
    assert.equal(resposta.status, 400);
  });

  it("depois de 10 falhas o e-mail fica bloqueado por 15 minutos", async () => {
    for (let i = 0; i < 10; i++) {
      const { pedido } = await abrirPedido();
      await enviar({
        pedido: pedido!,
        acao: "autorizar",
        email: PESSOAS.dono,
        senha: `errada-${i}`,
      });
    }
    const { pedido } = await abrirPedido();
    const resposta = await enviar({
      pedido: pedido!,
      acao: "autorizar",
      email: PESSOAS.dono,
      senha: SENHA_DE_ENSAIO,
    });
    assert.equal(resposta.status, 429);
  });

  it("escapa o nome do cliente", async () => {
    nomeDoCliente = "<script>alert(1)</script>";
    const { html } = await abrirPedido();
    nomeDoCliente = "Claude de ensaio";
    assert.ok(!html.includes("<script>alert"));
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test --prefix servicos/mcp` e `$env:MCP_ENSAIO_PG_URL = "<url local>"; npm run test:integracao --prefix servicos/mcp`
Expected: FAIL — `./paginas.js` e `./rotas-autorizar.js` não existem.

- [ ] **Step 3: Implementar**

```ts arquivo=servicos/mcp/src/oauth/paginas.ts
import type { Response } from "express";

import type { Loja } from "../banco/tetteo.js";

/**
 * AS TELAS DO LOGIN: entrar, escolher a loja, ou entender o que deu errado.
 *
 * HTML feito à mão, sem framework: são três telas pequenas, e cada byte que
 * vem de fora passa por `escaparHtml`. Abrem no celular, então o layout é de
 * uma coluna só e os botões são grandes.
 *
 * A tela diz QUEM pede (o host do client_id) e PARA ONDE a autorização volta
 * (o host do redirect_uri). A especificação exige isso: é o que permite à
 * pessoa perceber um pedido que não fez.
 */

export function escaparHtml(texto: string): string {
  return texto.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}

const e = escaparHtml;

function moldura(titulo: string, corpo: string): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${e(titulo)} · Tetteo</title>
<link rel="stylesheet" href="/oauth/estilo.css">
</head>
<body>
<main class="cartao">
<p class="marca">Tetteo</p>
${corpo}
</main>
</body>
</html>`;
}

export function paginaDeLogin(dados: {
  pedidoId: string;
  clienteNome: string;
  clienteHost: string;
  destino: string;
  loopback: boolean;
  erro?: string;
  email?: string;
}): string {
  return moldura(
    "Conectar",
    `<h1>Conectar o ${e(dados.clienteNome)} ao Tetteo</h1>
<p class="quem">Pedido feito por <strong>${e(dados.clienteHost)}</strong>. A autorização volta para <strong>${e(dados.destino)}</strong>.</p>
${
  dados.loopback
    ? `<p class="alerta">Só continue se você acabou de pedir esta conexão neste computador, por exemplo no Claude Code.</p>`
    : ""
}
<section class="escopo">
<h2>Vai poder</h2>
<ul><li>Ver a quantidade de vendas e o total de um dia, da loja que você autorizar.</li></ul>
<h2>Não vai poder</h2>
<ul><li>Alterar pedidos, pagamentos ou qualquer outro dado. É somente leitura.</li></ul>
</section>
${dados.erro ? `<p class="erro" role="alert">${e(dados.erro)}</p>` : ""}
<form method="post" action="/oauth/authorize">
<input type="hidden" name="pedido" value="${e(dados.pedidoId)}">
<label for="email">E-mail do Tetteo</label>
<input id="email" name="email" type="email" autocomplete="username" required value="${e(dados.email ?? "")}">
<label for="senha">Senha do Tetteo</label>
<input id="senha" name="senha" type="password" autocomplete="current-password" required>
<div class="acoes">
<button type="submit" name="acao" value="autorizar">Autorizar</button>
<button type="submit" name="acao" value="cancelar" formnovalidate class="secundario">Cancelar</button>
</div>
</form>
<p class="nota">Você pode desconectar quando quiser. A conexão também para sozinha se sua conta for suspensa no Tetteo.</p>`,
  );
}

export function paginaDeEscolha(dados: {
  pedidoId: string;
  clienteNome: string;
  lojas: Loja[];
  erro?: string;
}): string {
  const opcoes = dados.lojas
    .map(
      (loja, indice) =>
        `<label class="opcao"><input type="radio" name="unidade" value="${e(loja.id)}"${indice === 0 ? " checked" : ""} required> ${e(loja.nome)}</label>`,
    )
    .join("\n");
  return moldura(
    "Escolher a loja",
    `<h1>Qual loja o ${e(dados.clienteNome)} vai consultar?</h1>
<p class="quem">Cada conexão enxerga uma loja. Para outra loja, conecte de novo.</p>
${dados.erro ? `<p class="erro" role="alert">${e(dados.erro)}</p>` : ""}
<form method="post" action="/oauth/authorize">
<input type="hidden" name="pedido" value="${e(dados.pedidoId)}">
<fieldset><legend>Loja</legend>
${opcoes}
</fieldset>
<div class="acoes">
<button type="submit" name="acao" value="autorizar">Autorizar esta loja</button>
<button type="submit" name="acao" value="cancelar" formnovalidate class="secundario">Cancelar</button>
</div>
</form>`,
  );
}

export function paginaDeErro(dados: {
  titulo: string;
  mensagem: string;
}): string {
  return moldura(
    dados.titulo,
    `<h1>${e(dados.titulo)}</h1>
<p>${e(dados.mensagem)}</p>
<p class="nota">Volte ao Claude e tente conectar de novo. Se continuar, fale com quem administra o Tetteo.</p>`,
  );
}

/**
 * As travas de toda tela. `form-action` lista também a origem do retorno:
 * alguns navegadores aplicam a regra ao redirecionamento que vem depois do
 * envio do formulário, e sem ela o código não chegaria ao Claude.
 */
export function aplicarCabecalhosDePagina(
  res: Response,
  origensDoFormulario: string[] = [],
): void {
  const formAction = ["'self'", ...origensDoFormulario].join(" ");
  res.set({
    "Content-Security-Policy": `default-src 'none'; style-src 'self'; form-action ${formAction}; frame-ancestors 'none'; base-uri 'none'`,
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
  });
}

export const ESTILO = `
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px 16px;background:#f4f1ec;color:#1f1b16;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.cartao{width:100%;max-width:440px;background:#fff;border:1px solid #e4ded5;border-radius:14px;padding:28px 24px;box-shadow:0 1px 2px rgba(0,0,0,.04)}
.marca{margin:0 0 12px;font-weight:700;letter-spacing:.02em;color:#9a3412}
h1{margin:0 0 8px;font-size:22px;line-height:1.3}
h2{margin:16px 0 4px;font-size:14px;text-transform:uppercase;letter-spacing:.04em;color:#57534e}
ul{margin:0;padding-left:20px}
.quem{margin:0 0 8px;color:#44403c}
.alerta{margin:12px 0;padding:10px 12px;border-radius:10px;background:#fef3c7;color:#78350f}
.erro{margin:16px 0 0;padding:10px 12px;border-radius:10px;background:#fee2e2;color:#7f1d1d}
.nota{margin:16px 0 0;font-size:14px;color:#57534e}
form{margin-top:16px}
label{display:block;margin:12px 0 4px;font-weight:600}
input[type=email],input[type=password]{width:100%;padding:12px;border:1px solid #c9c1b6;border-radius:10px;font:inherit}
input:focus-visible,button:focus-visible{outline:3px solid #fdba74;outline-offset:2px}
fieldset{margin:8px 0 0;padding:0;border:0}
legend{font-weight:600}
.opcao{display:flex;gap:10px;align-items:center;padding:12px;border:1px solid #e4ded5;border-radius:10px;font-weight:400}
.acoes{display:flex;gap:12px;margin-top:20px;flex-wrap:wrap}
button{flex:1 1 140px;min-height:48px;border:0;border-radius:10px;background:#9a3412;color:#fff;font:600 16px/1 inherit;cursor:pointer}
button.secundario{background:#f4f1ec;color:#1f1b16;border:1px solid #c9c1b6}
`;
```

```ts arquivo=servicos/mcp/src/oauth/rotas-autorizar.ts
import { randomBytes } from "node:crypto";

import bcrypt from "bcryptjs";
import { Router, type Response } from "express";
import { z } from "zod";

import type { Banco } from "../banco/conexao.js";
import {
  buscarUsuarioParaLogin,
  lojasComVendasVisiveis,
} from "../banco/tetteo.js";
import type { Config } from "../config.js";
import type { Registro } from "../registro.js";
import {
  apagarPedido,
  aprovarConexao,
  criarPedido,
  falhasRecentes,
  lerPedido,
  marcarPedidoAutenticado,
  registrarTentativa,
  type Pedido,
} from "./armazem.js";
import { ErroDeCliente, type ResolverCliente } from "./cliente.js";
import { escoposConcedidos } from "./escopos.js";
import {
  aplicarCabecalhosDePagina,
  ESTILO,
  paginaDeErro,
  paginaDeEscolha,
  paginaDeLogin,
} from "./paginas.js";
import {
  descreverDestino,
  ehLoopback,
  redirecionamentoPermitido,
} from "./redirecionamento.js";
import { desafioValido, impressaoDigital } from "./segredos.js";

/**
 * O LOGIN E O CONSENTIMENTO.
 *
 * GET mostra a tela; POST confere a senha do Tetteo, escolhe a loja e manda o
 * código de volta ao Claude.
 *
 * A ordem dos cuidados importa. Enquanto o cliente e o endereço de retorno
 * não estão validados, NENHUM erro é redirecionado — mostrar uma página é
 * seguro, mandar a pessoa para um endereço que não sabemos de quem é, não.
 *
 * A senha é conferida pela mesma resposta em todas as falhas, e com bcrypt
 * mesmo quando o e-mail não existe: quem fica tentando não descobre quais
 * e-mails têm conta. Dez falhas por e-mail (ou trinta por IP) em 15 minutos
 * travam novas tentativas.
 */

export type DependenciasDoLogin = {
  banco: Banco;
  config: Config;
  resolverCliente: ResolverCliente;
  registro: Registro;
};

const LIMITE_POR_EMAIL = 10;
const LIMITE_POR_IP = 30;

const consulta = z.object({
  response_type: z.string().max(50).optional(),
  client_id: z.string().min(1).max(500),
  redirect_uri: z.string().min(1).max(2000),
  code_challenge: z.string().max(200).optional(),
  code_challenge_method: z.string().max(20).optional(),
  state: z.string().max(1000).optional(),
  scope: z.string().max(500).optional(),
  resource: z.string().max(500).optional(),
});

const formulario = z.object({
  pedido: z.string().min(1).max(100),
  acao: z.enum(["autorizar", "cancelar"]),
  email: z.string().max(320).optional(),
  senha: z.string().max(500).optional(),
  unidade: z.string().max(100).optional(),
});

let hashFalso: Promise<string> | undefined;
const obterHashFalso = () =>
  (hashFalso ??= bcrypt.hash(randomBytes(16).toString("hex"), 12));

function hostDe(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "?";
  }
}

/** O `resource` pedido (RFC 8707) é este MCP? Barra final e fragmento não contam. */
export function mesmoRecurso(pedido: string, canonico: URL): boolean {
  try {
    const url = new URL(pedido);
    url.hash = "";
    return url.href.replace(/\/$/, "") === canonico.href.replace(/\/$/, "");
  } catch {
    return false;
  }
}

function mostrar(
  res: Response,
  status: number,
  html: string,
  origensDoFormulario: string[] = [],
): void {
  aplicarCabecalhosDePagina(res, origensDoFormulario);
  res.status(status).type("html").send(html);
}

function voltar(
  res: Response,
  redirectUri: string,
  parametros: Record<string, string | null | undefined>,
): void {
  const url = new URL(redirectUri);
  for (const [chave, valor] of Object.entries(parametros)) {
    if (valor) url.searchParams.set(chave, valor);
  }
  res.set("Cache-Control", "no-store");
  res.redirect(303, url.href);
}

function dadosDaTela(
  pedido: Pick<Pedido, "clientId" | "clienteNome" | "redirectUri">,
) {
  return {
    clienteNome: pedido.clienteNome,
    clienteHost: hostDe(pedido.clientId),
    destino: descreverDestino(pedido.redirectUri),
    loopback: ehLoopback(new URL(pedido.redirectUri)),
  };
}

export function rotasDeAutorizacao(deps: DependenciasDoLogin): Router {
  const rotas = Router();

  rotas.get("/estilo.css", (_req, res) => {
    res.set("Cache-Control", "public, max-age=3600").type("css").send(ESTILO);
  });

  rotas.get("/authorize", async (req, res) => {
    const analise = consulta.safeParse(req.query);
    if (!analise.success) {
      return mostrar(
        res,
        400,
        paginaDeErro({
          titulo: "Pedido incompleto",
          mensagem: "Faltam informações no pedido de conexão.",
        }),
      );
    }
    const q = analise.data;

    let cliente: Awaited<ReturnType<ResolverCliente>>;
    try {
      cliente = await deps.resolverCliente(q.client_id);
    } catch (erro) {
      if (!(erro instanceof ErroDeCliente)) throw erro;
      deps.registro.aviso("cliente recusado", {
        host: hostDe(q.client_id),
        motivo: erro.message,
      });
      return mostrar(
        res,
        400,
        paginaDeErro({
          titulo: "Cliente não autorizado",
          mensagem: erro.message,
        }),
      );
    }

    if (!redirecionamentoPermitido(q.redirect_uri, cliente.redirectUris)) {
      return mostrar(
        res,
        400,
        paginaDeErro({
          titulo: "Endereço de retorno inválido",
          mensagem: "O endereço de retorno não pertence a este cliente.",
        }),
      );
    }

    // Daqui em diante o retorno é confiável: os erros voltam para o cliente.
    const devolver = (erro: string, descricao: string) =>
      voltar(res, q.redirect_uri, {
        error: erro,
        error_description: descricao,
        state: q.state,
        iss: deps.config.emissor,
      });

    if (q.response_type !== "code") {
      return devolver("unsupported_response_type", "Use response_type=code.");
    }
    if (
      q.code_challenge_method !== "S256" ||
      !q.code_challenge ||
      !desafioValido(q.code_challenge)
    ) {
      return devolver("invalid_request", "PKCE com S256 é obrigatório.");
    }
    const escopos = escoposConcedidos(q.scope);
    if (!escopos) {
      return devolver("invalid_scope", "Nenhum escopo pedido existe aqui.");
    }
    if (
      q.resource !== undefined &&
      !mesmoRecurso(q.resource, deps.config.urlMcp)
    ) {
      return devolver(
        "invalid_target",
        "Este servidor só emite chaves para o próprio MCP.",
      );
    }

    const pedidoId = await criarPedido(deps.banco, {
      clientId: cliente.clientId,
      clienteNome: cliente.nome,
      redirectUri: q.redirect_uri,
      state: q.state ?? null,
      codeChallenge: q.code_challenge,
      escopos,
      recurso: deps.config.urlMcp.href,
    });
    const tela = dadosDaTela({
      clientId: cliente.clientId,
      clienteNome: cliente.nome,
      redirectUri: q.redirect_uri,
    });
    return mostrar(res, 200, paginaDeLogin({ pedidoId, ...tela }), [
      new URL(q.redirect_uri).origin,
    ]);
  });

  rotas.post("/authorize", async (req, res) => {
    const analise = formulario.safeParse(req.body ?? {});
    if (!analise.success) {
      return mostrar(
        res,
        400,
        paginaDeErro({
          titulo: "Formulário inválido",
          mensagem: "Não entendi o que foi enviado.",
        }),
      );
    }
    const f = analise.data;

    const pedido = await lerPedido(deps.banco, f.pedido);
    if (!pedido) {
      return mostrar(
        res,
        400,
        paginaDeErro({
          titulo: "Pedido expirado",
          mensagem: "Este pedido de conexão expirou ou já foi usado.",
        }),
      );
    }
    const origens = [new URL(pedido.redirectUri).origin];
    const devolver = (parametros: Record<string, string>) =>
      voltar(res, pedido.redirectUri, {
        ...parametros,
        state: pedido.state,
        iss: deps.config.emissor,
      });

    if (f.acao === "cancelar") {
      await apagarPedido(deps.banco, pedido.hash);
      return devolver({
        error: "access_denied",
        error_description: "A pessoa não autorizou a conexão.",
      });
    }

    const concluir = async (usuarioId: string, unidadeId: string) => {
      const code = await aprovarConexao(deps.banco, {
        usuarioId,
        unidadeId,
        clientId: pedido.clientId,
        clienteNome: pedido.clienteNome,
        escopos: pedido.escopos,
        recurso: pedido.recurso,
        redirectUri: pedido.redirectUri,
        codeChallenge: pedido.codeChallenge,
      });
      await apagarPedido(deps.banco, pedido.hash);
      deps.registro.info("conexão aprovada", {
        cliente: hostDe(pedido.clientId),
      });
      return devolver({ code });
    };

    // Segunda etapa: a pessoa já entrou e está escolhendo a loja.
    if (pedido.usuarioId) {
      const lojas = await lojasComVendasVisiveis(deps.banco, pedido.usuarioId);
      const loja = lojas.find((item) => item.id === f.unidade);
      if (!loja) {
        return mostrar(
          res,
          400,
          paginaDeEscolha({
            pedidoId: f.pedido,
            clienteNome: pedido.clienteNome,
            lojas,
            erro: "Escolha uma das lojas da lista.",
          }),
          origens,
        );
      }
      return concluir(pedido.usuarioId, loja.id);
    }

    // Primeira etapa: e-mail e senha do Tetteo.
    const email = (f.email ?? "").trim().toLowerCase();
    const senha = f.senha ?? "";
    const refazer = (status: number, erro: string) =>
      mostrar(
        res,
        status,
        paginaDeLogin({
          pedidoId: f.pedido,
          ...dadosDaTela(pedido),
          erro,
          email,
        }),
        origens,
      );

    if (!email || !senha) return refazer(400, "Informe e-mail e senha.");

    const chaves = {
      emailHash: impressaoDigital(email),
      ipHash: impressaoDigital(req.ip ?? ""),
    };
    const falhas = await falhasRecentes(deps.banco, chaves);
    if (falhas.porEmail >= LIMITE_POR_EMAIL || falhas.porIp >= LIMITE_POR_IP) {
      return refazer(
        429,
        "Muitas tentativas. Espere 15 minutos e tente de novo.",
      );
    }

    const usuario = await buscarUsuarioParaLogin(deps.banco, email);
    const confere = await bcrypt.compare(
      senha,
      usuario?.senhaHash ?? (await obterHashFalso()),
    );
    await registrarTentativa(deps.banco, {
      ...chaves,
      sucesso: Boolean(usuario && confere),
    });
    if (!usuario || !confere)
      return refazer(401, "E-mail ou senha incorretos.");

    const lojas = await lojasComVendasVisiveis(deps.banco, usuario.id);
    if (lojas.length === 0) {
      await apagarPedido(deps.banco, pedido.hash);
      return mostrar(
        res,
        403,
        paginaDeErro({
          titulo: "Sem permissão",
          mensagem:
            "Sua conta não tem permissão para ver as vendas de nenhuma loja. Peça a quem administra o Tetteo.",
        }),
      );
    }
    if (lojas.length === 1) return concluir(usuario.id, lojas[0]!.id);

    await marcarPedidoAutenticado(deps.banco, pedido.hash, usuario.id);
    return mostrar(
      res,
      200,
      paginaDeEscolha({
        pedidoId: f.pedido,
        clienteNome: pedido.clienteNome,
        lojas,
      }),
      origens,
    );
  });

  return rotas;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test --prefix servicos/mcp`, `$env:MCP_ENSAIO_PG_URL = "<url local>"; npm run test:integracao --prefix servicos/mcp` e `npm run typecheck --prefix servicos/mcp`
Expected: todos PASS.

- [ ] **Step 5: Commit**

```bash
git add servicos/mcp/src/oauth
git commit -m "MCP: a tela de login do Tetteo que diz quem pede, para onde volta e o que a IA não vai poder fazer"
```

---

### Tarefa 9: Troca, renovação e revogação de chaves + o verificador

**Files:**

- Create: `servicos/mcp/src/oauth/rotas-token.ts`, `servicos/mcp/src/oauth/verificador.ts`, `servicos/mcp/src/ensaio/fluxo.ts`
- Test: `servicos/mcp/src/oauth/token.integracao.ts`

**Interfaces:**

- Consumes: `trocarCodigo`, `renovar`, `revogarPorChave`, `limparVencidos`, `buscarChaveDeAcesso`, `marcarUso` (Tarefa 7); `escoposConcedidos` (Tarefa 4); `mesmoRecurso` exportado de `rotas-autorizar.ts` (Tarefa 8).
- Produces: `rotasDeToken({ banco, config, registro }) → express.Router` (monte em `/oauth`, depois de `express.urlencoded`); `criarVerificador({ banco, config, registro }) → OAuthTokenVerifier` cujo `AuthInfo.extra` é `ExtraDaChave`.
- Produces (ensaio): `obterCodigo(base, OpcoesDoFluxo) → code`, `pedirChaves(base, campos) → { status, corpo }`, `OpcoesDoFluxo { email, senha, clientId, redirectUri, verificador, recurso, unidade? }`.

- [ ] **Step 1: Escrever o fluxo de ensaio e o teste**

```ts arquivo=servicos/mcp/src/ensaio/fluxo.ts
import { desafioDe } from "../oauth/segredos.js";

/**
 * O CAMINHO QUE O CLAUDE FAZ, feito à mão para os testes: abre a tela, envia
 * e-mail e senha, escolhe a loja se precisar e pega o código no retorno.
 */

export type OpcoesDoFluxo = {
  email: string;
  senha: string;
  clientId: string;
  redirectUri: string;
  verificador: string;
  recurso: string;
  unidade?: string;
};

const postar = (base: string, campos: Record<string, string>) =>
  fetch(new URL("/oauth/authorize", base), {
    method: "POST",
    body: new URLSearchParams(campos),
    redirect: "manual",
  });

export async function obterCodigo(
  base: string,
  opcoes: OpcoesDoFluxo,
): Promise<string> {
  const url = new URL("/oauth/authorize", base);
  for (const [chave, valor] of Object.entries({
    response_type: "code",
    client_id: opcoes.clientId,
    redirect_uri: opcoes.redirectUri,
    code_challenge: desafioDe(opcoes.verificador),
    code_challenge_method: "S256",
    state: "estado-de-ensaio",
    scope: "vendas:ler",
    resource: opcoes.recurso,
  })) {
    url.searchParams.set(chave, valor);
  }

  const tela = await fetch(url, { redirect: "manual" });
  const pedido = /name="pedido" value="([^"]+)"/.exec(await tela.text())?.[1];
  if (!pedido) throw new Error(`a tela de login não abriu (${tela.status})`);

  let resposta = await postar(base, {
    pedido,
    acao: "autorizar",
    email: opcoes.email,
    senha: opcoes.senha,
  });
  if (resposta.status === 200 && opcoes.unidade) {
    resposta = await postar(base, {
      pedido,
      acao: "autorizar",
      unidade: opcoes.unidade,
    });
  }
  const destino = resposta.headers.get("location");
  const code = destino ? new URL(destino).searchParams.get("code") : null;
  if (!code)
    throw new Error(`o retorno não trouxe código (${resposta.status})`);
  return code;
}

export async function pedirChaves(
  base: string,
  campos: Record<string, string>,
): Promise<{
  status: number;
  corpo: Record<string, unknown>;
  resposta: Response;
}> {
  const resposta = await fetch(new URL("/oauth/token", base), {
    method: "POST",
    body: new URLSearchParams(campos),
  });
  return { status: resposta.status, corpo: await resposta.json(), resposta };
}
```

```ts arquivo=servicos/mcp/src/oauth/token.integracao.ts
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

import {
  getOAuthProtectedResourceMetadataUrl,
  requireBearerAuth,
} from "@modelcontextprotocol/express";
import express from "express";

import { criarBanco, type Banco } from "../banco/conexao.js";
import { prepararTabelas } from "../banco/tabelas.js";
import { lerConfig } from "../config.js";
import {
  criarBancoDeEnsaio,
  urlDeEnsaio,
  type BancoDeEnsaio,
} from "../ensaio/banco-de-ensaio.js";
import { obterCodigo, pedirChaves } from "../ensaio/fluxo.js";
import { PESSOAS, SENHA_DE_ENSAIO, semear } from "../ensaio/semente.js";
import { registroSilencioso } from "../registro.js";
import type { ResolverCliente } from "./cliente.js";
import { rotasDeAutorizacao } from "./rotas-autorizar.js";
import { rotasDeToken } from "./rotas-token.js";
import { criarVerificador } from "./verificador.js";

const pular = urlDeEnsaio()
  ? false
  : "defina MCP_ENSAIO_PG_URL (Postgres local) para rodar";

const CLIENTE = "https://claude.ai/oauth/ensaio";
const RETORNO = "https://claude.ai/api/mcp/auth_callback";
const VERIFICADOR = "a".repeat(64);
const RECURSO = "http://127.0.0.1:9/mcp";

describe("/oauth/token, /oauth/revoke e o verificador", { skip: pular }, () => {
  let ensaio: BancoDeEnsaio;
  let banco: Banco;
  let base: string;
  let fecharServidor: () => void;

  before(async () => {
    ensaio = await criarBancoDeEnsaio();
    await semear(ensaio.admin);
    banco = criarBanco(ensaio.urlDoServico, registroSilencioso);
    await prepararTabelas(banco);
    const config = lerConfig({
      DATABASE_URL: ensaio.urlDoServico,
      MCP_URL_PUBLICA: "http://127.0.0.1:9",
    });
    const resolverCliente: ResolverCliente = async (clientId) => ({
      clientId,
      nome: "Claude",
      redirectUris: [RETORNO],
    });
    const deps = { banco, config, registro: registroSilencioso };

    const app = express();
    app.use("/oauth", express.urlencoded({ extended: false, limit: "16kb" }));
    app.use("/oauth", rotasDeAutorizacao({ ...deps, resolverCliente }));
    app.use("/oauth", rotasDeToken(deps));
    app.get(
      "/protegido",
      requireBearerAuth({
        verifier: criarVerificador(deps),
        requiredScopes: ["vendas:ler"],
        resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(
          config.urlMcp,
        ),
      }),
      (req, res) => {
        res.json(req.auth?.extra);
      },
    );
    const servidor = app.listen(0);
    await new Promise((pronto) => servidor.once("listening", pronto));
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
    fecharServidor = () => servidor.close();
  });

  after(async () => {
    fecharServidor?.();
    await banco?.end();
    await ensaio?.encerrar();
  });

  const codigo = () =>
    obterCodigo(base, {
      email: PESSOAS.gerente,
      senha: SENHA_DE_ENSAIO,
      clientId: CLIENTE,
      redirectUri: RETORNO,
      verificador: VERIFICADOR,
      recurso: RECURSO,
    });

  const trocar = async (extra: Record<string, string> = {}) =>
    pedirChaves(base, {
      grant_type: "authorization_code",
      code: await codigo(),
      redirect_uri: RETORNO,
      client_id: CLIENTE,
      code_verifier: VERIFICADOR,
      resource: RECURSO,
      ...extra,
    });

  const protegido = (cabecalhos: Record<string, string> = {}, sufixo = "") =>
    fetch(new URL(`/protegido${sufixo}`, base), { headers: cabecalhos });

  it("troca o código por chaves no formato da RFC 6749", async () => {
    const { status, corpo, resposta } = await trocar();
    assert.equal(status, 200);
    assert.equal(corpo.token_type, "Bearer");
    assert.equal(corpo.expires_in, 3600);
    assert.equal(corpo.scope, "vendas:ler");
    assert.match(String(corpo.access_token), /^tmcp_/);
    assert.match(String(corpo.refresh_token), /^tmcr_/);
    assert.equal(resposta.headers.get("cache-control"), "no-store");

    const liberado = await protegido({
      Authorization: `Bearer ${corpo.access_token}`,
    });
    assert.equal(liberado.status, 200);
    assert.equal((await liberado.json()).unidadeId, "uni_centro");
  });

  it("sem chave: 401 com resource_metadata e escopo no WWW-Authenticate", async () => {
    const resposta = await protegido();
    assert.equal(resposta.status, 401);
    const desafio = resposta.headers.get("www-authenticate") ?? "";
    assert.match(
      desafio,
      /resource_metadata="http:\/\/127\.0\.0\.1:9\/\.well-known\/oauth-protected-resource\/mcp"/,
    );
    assert.match(desafio, /scope="vendas:ler"/);
  });

  it("chave na URL não vale, e chave de renovação não abre a porta", async () => {
    const { corpo } = await trocar();
    assert.equal(
      (await protegido({}, `?access_token=${corpo.access_token}`)).status,
      401,
    );
    assert.equal(
      (await protegido({ Authorization: `Bearer ${corpo.refresh_token}` }))
        .status,
      401,
    );
  });

  it("recusa verificador errado, JSON, grant desconhecido e outro recurso", async () => {
    assert.equal(
      (await trocar({ code_verifier: "b".repeat(64) })).corpo.error,
      "invalid_grant",
    );
    assert.equal(
      (await trocar({ resource: "https://outro/mcp" })).corpo.error,
      "invalid_target",
    );
    assert.equal(
      (await pedirChaves(base, { grant_type: "password", client_id: CLIENTE }))
        .corpo.error,
      "unsupported_grant_type",
    );
    const json = await fetch(new URL("/oauth/token", base), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant_type: "authorization_code" }),
    });
    assert.equal(json.status, 400);
    assert.equal((await json.json()).error, "invalid_request");
  });

  it("renova trocando a chave; reusar a antiga derruba a nova", async () => {
    const primeira = (await trocar()).corpo;
    const renovada = await pedirChaves(base, {
      grant_type: "refresh_token",
      refresh_token: String(primeira.refresh_token),
      client_id: CLIENTE,
    });
    assert.equal(renovada.status, 200);
    const nova = renovada.corpo;
    assert.equal(
      (await protegido({ Authorization: `Bearer ${nova.access_token}` }))
        .status,
      200,
    );

    const reuso = await pedirChaves(base, {
      grant_type: "refresh_token",
      refresh_token: String(primeira.refresh_token),
      client_id: CLIENTE,
    });
    assert.equal(reuso.status, 400);
    assert.equal(reuso.corpo.error, "invalid_grant");
    assert.equal(
      (await protegido({ Authorization: `Bearer ${nova.access_token}` }))
        .status,
      401,
    );
  });

  it("revogar corta o acesso, e revogar chave desconhecida responde 200", async () => {
    const { corpo } = await trocar();
    const revogar = (token: string) =>
      fetch(new URL("/oauth/revoke", base), {
        method: "POST",
        body: new URLSearchParams({ token, client_id: CLIENTE }),
      });
    assert.equal((await revogar(String(corpo.refresh_token))).status, 200);
    assert.equal(
      (await protegido({ Authorization: `Bearer ${corpo.access_token}` }))
        .status,
      401,
    );
    assert.equal((await revogar("tmcr_desconhecida")).status, 200);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `$env:MCP_ENSAIO_PG_URL = "<url local>"; npm run test:integracao --prefix servicos/mcp`
Expected: FAIL — `./rotas-token.js` e `./verificador.js` não existem.

- [ ] **Step 3: Implementar**

```ts arquivo=servicos/mcp/src/oauth/verificador.ts
import {
  OAuthError,
  OAuthErrorCode,
  type OAuthTokenVerifier,
} from "@modelcontextprotocol/server";

import type { Banco } from "../banco/conexao.js";
import type { Config } from "../config.js";
import type { ExtraDaChave } from "../mcp/servidor-mcp.js";
import type { Registro } from "../registro.js";
import { buscarChaveDeAcesso, marcarUso } from "./armazem.js";

/**
 * A PORTA DO /mcp: confere a chave a cada requisição.
 *
 * Consulta o banco toda vez, de propósito. Custa uma consulta indexada e
 * compra revogação na hora: suspender alguém no Tetteo, tirar a permissão ou
 * revogar a conexão vale já na chamada seguinte, sem esperar a chave vencer.
 *
 * Chave inválida vira `OAuthError(invalid_token)` → 401 com o cabeçalho que
 * leva o Claude ao login. Banco fora do ar vira erro comum → 500: não é
 * "faça login de novo", é "tente mais tarde".
 */
export function criarVerificador(deps: {
  banco: Banco;
  config: Config;
  registro: Registro;
}): OAuthTokenVerifier {
  return {
    async verifyAccessToken(token) {
      const chave = await buscarChaveDeAcesso(
        deps.banco,
        token,
        deps.config.urlMcp.href,
      );
      if (!chave) {
        throw new OAuthError(
          OAuthErrorCode.InvalidToken,
          "Chave inválida, vencida ou revogada.",
        );
      }
      marcarUso(deps.banco, chave.conexaoId).catch((erro) =>
        deps.registro.aviso("não consegui marcar o uso da conexão", { erro }),
      );
      const extra: ExtraDaChave = {
        conexaoId: chave.conexaoId,
        usuarioId: chave.usuarioId,
        unidadeId: chave.unidadeId,
        unidadeNome: chave.unidadeNome,
      };
      return {
        token,
        clientId: chave.clientId,
        scopes: chave.escopos,
        expiresAt: Math.floor(chave.expiraEm.getTime() / 1000),
        resource: new URL(deps.config.urlMcp.href),
        extra,
      };
    },
  };
}
```

```ts arquivo=servicos/mcp/src/oauth/rotas-token.ts
import { Router, type Response } from "express";
import { z } from "zod";

import type { Banco } from "../banco/conexao.js";
import type { Config } from "../config.js";
import type { Registro } from "../registro.js";
import {
  limparVencidos,
  renovar,
  revogarPorChave,
  trocarCodigo,
  type ResultadoDaTroca,
} from "./armazem.js";
import { escoposConcedidos } from "./escopos.js";
import { mesmoRecurso } from "./rotas-autorizar.js";

/**
 * ONDE O CÓDIGO VIRA CHAVE, E A CHAVE SE RENOVA OU MORRE.
 *
 * Só aceita formulário (`application/x-www-form-urlencoded`), como manda a
 * RFC 6749 e como o Claude envia. Toda resposta leva `Cache-Control:
 * no-store`: chave não pode ficar guardada em proxy nenhum. Os erros usam os
 * códigos da RFC — o Claude decide o que fazer a partir deles (um
 * `invalid_grant` na renovação, por exemplo, faz ele pedir login de novo).
 */

const troca = z.object({
  grant_type: z.literal("authorization_code"),
  code: z.string().min(1).max(200),
  redirect_uri: z.string().min(1).max(2000),
  client_id: z.string().min(1).max(500),
  code_verifier: z.string().min(1).max(200),
  resource: z.string().max(500).optional(),
});

const renovacao = z.object({
  grant_type: z.literal("refresh_token"),
  refresh_token: z.string().min(1).max(200),
  client_id: z.string().min(1).max(500),
  scope: z.string().max(500).optional(),
  resource: z.string().max(500).optional(),
});

const revogacao = z.object({
  token: z.string().min(1).max(200),
  token_type_hint: z.string().max(50).optional(),
  client_id: z.string().min(1).max(500),
});

function semCache(res: Response): Response {
  return res.set({ "Cache-Control": "no-store", Pragma: "no-cache" });
}

function erroOAuth(
  res: Response,
  status: number,
  erro: string,
  descricao: string,
): void {
  semCache(res)
    .status(status)
    .json({ error: erro, error_description: descricao });
}

export function rotasDeToken(deps: {
  banco: Banco;
  config: Config;
  registro: Registro;
}): Router {
  const rotas = Router();

  rotas.post("/token", async (req, res) => {
    if (!req.is("application/x-www-form-urlencoded")) {
      return erroOAuth(
        res,
        400,
        "invalid_request",
        "Envie como application/x-www-form-urlencoded.",
      );
    }
    const corpo: Record<string, unknown> = req.body ?? {};
    const alvoErrado = (recurso: string | undefined) =>
      recurso !== undefined && !mesmoRecurso(recurso, deps.config.urlMcp);

    let resultado: ResultadoDaTroca;
    if (corpo.grant_type === "authorization_code") {
      const analise = troca.safeParse(corpo);
      if (!analise.success) {
        return erroOAuth(
          res,
          400,
          "invalid_request",
          "Faltam campos: code, redirect_uri, client_id e code_verifier.",
        );
      }
      if (alvoErrado(analise.data.resource)) {
        return erroOAuth(res, 400, "invalid_target", "Recurso desconhecido.");
      }
      resultado = await trocarCodigo(deps.banco, {
        codigo: analise.data.code,
        clientId: analise.data.client_id,
        redirectUri: analise.data.redirect_uri,
        verificador: analise.data.code_verifier,
      });
    } else if (corpo.grant_type === "refresh_token") {
      const analise = renovacao.safeParse(corpo);
      if (!analise.success) {
        return erroOAuth(
          res,
          400,
          "invalid_request",
          "Faltam campos: refresh_token e client_id.",
        );
      }
      if (alvoErrado(analise.data.resource)) {
        return erroOAuth(res, 400, "invalid_target", "Recurso desconhecido.");
      }
      if (
        analise.data.scope !== undefined &&
        escoposConcedidos(analise.data.scope) === null
      ) {
        return erroOAuth(res, 400, "invalid_scope", "Escopo desconhecido.");
      }
      resultado = await renovar(deps.banco, {
        refreshToken: analise.data.refresh_token,
        clientId: analise.data.client_id,
      });
    } else {
      return erroOAuth(
        res,
        400,
        "unsupported_grant_type",
        "Use authorization_code ou refresh_token.",
      );
    }

    if (!resultado.ok) {
      deps.registro.aviso("troca de chave recusada", {
        tipo: corpo.grant_type,
        motivo: resultado.descricao,
      });
      return erroOAuth(res, 400, resultado.erro, resultado.descricao);
    }

    limparVencidos(deps.banco).catch((erro) =>
      deps.registro.aviso("a faxina das chaves vencidas falhou", { erro }),
    );
    semCache(res).json({
      access_token: resultado.chaves.accessToken,
      token_type: "Bearer",
      expires_in: resultado.chaves.expiresIn,
      refresh_token: resultado.chaves.refreshToken,
      scope: resultado.chaves.escopos.join(" "),
    });
  });

  rotas.post("/revoke", async (req, res) => {
    const analise = revogacao.safeParse(req.body ?? {});
    if (!analise.success) {
      return erroOAuth(res, 400, "invalid_request", "Envie token e client_id.");
    }
    await revogarPorChave(deps.banco, {
      token: analise.data.token,
      clientId: analise.data.client_id,
    });
    // RFC 7009: responde 200 mesmo quando a chave não existe — não confirma
    // para ninguém quais chaves são válidas.
    semCache(res).status(200).end();
  });

  return rotas;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `$env:MCP_ENSAIO_PG_URL = "<url local>"; npm run test:integracao --prefix servicos/mcp` e `npm run typecheck --prefix servicos/mcp`
Expected: todos PASS.

- [ ] **Step 5: Commit**

```bash
git add servicos/mcp/src/oauth servicos/mcp/src/ensaio/fluxo.ts
git commit -m "MCP: a troca de código por chave, a renovação que troca a chave e o verificador que revoga na hora"
```

---

### Tarefa 10: O servidor completo — proteções, rotas, `/mcp` sem sessão e a subida

**Files:**

- Create: `servicos/mcp/src/servidor.ts`, `servicos/mcp/src/principal.ts`, `servicos/mcp/src/ensaio/ambiente.ts`
- Test: `servicos/mcp/src/servidor.integracao.ts`

**Interfaces:**

- Consumes: tudo das tarefas 1–9.
- Produces: `criarAplicacao(DependenciasDoServidor) → { app: Express; handler: McpHttpHandler }`, `DependenciasDoServidor { config, banco, fonte, registro, resolverCliente?, agora?, tempoMaximoMs? }`.
- Produces (ensaio): `subirAmbiente({ fonte? }) → Ambiente { base, config, ensaio, banco, linhasDeLog, encerrar() }`, `chavesPara(ambiente, email?, unidade?) → { accessToken, refreshToken }`, `CLIENTE_DE_ENSAIO`.

- [ ] **Step 1: Escrever o ambiente e o teste de ponta a ponta**

```ts arquivo=servicos/mcp/src/ensaio/ambiente.ts
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { criarBanco, type Banco } from "../banco/conexao.js";
import { prepararTabelas } from "../banco/tabelas.js";
import { lerConfig, type Config } from "../config.js";
import { criarFonteFicticia } from "../fontes/ficticia.js";
import type { FonteDeVendas } from "../fontes/tipos.js";
import { ErroDeCliente, type ResolverCliente } from "../oauth/cliente.js";
import { criarRegistro } from "../registro.js";
import { criarAplicacao } from "../servidor.js";
import { criarBancoDeEnsaio, type BancoDeEnsaio } from "./banco-de-ensaio.js";
import { obterCodigo, pedirChaves } from "./fluxo.js";
import { PESSOAS, SENHA_DE_ENSAIO, semear } from "./semente.js";

/**
 * O SERVIDOR INTEIRO, DE VERDADE, NUMA PORTA LIVRE — com banco de ensaio, as
 * mesmas proteções de produção e um cliente fictício no lugar do Claude (a
 * busca do CIMD na internet tem teste próprio). Os logs ficam guardados em
 * `linhasDeLog` para o teste conferir que nenhum segredo vazou.
 */

export const CLIENTE_DE_ENSAIO = "https://claude.ai/oauth/ensaio";
const RETORNO = "http://127.0.0.1:4555/callback";

const clienteDeEnsaio: ResolverCliente = async (clientId) => {
  if (clientId !== CLIENTE_DE_ENSAIO) {
    throw new ErroDeCliente("Cliente desconhecido.");
  }
  return {
    clientId,
    nome: "Claude de ensaio",
    redirectUris: ["http://127.0.0.1/callback"],
  };
};

export type Ambiente = {
  base: string;
  config: Config;
  ensaio: BancoDeEnsaio;
  banco: Banco;
  linhasDeLog: string[];
  encerrar(): Promise<void>;
};

export async function subirAmbiente(
  opcoes: { fonte?: FonteDeVendas; tempoMaximoMs?: number } = {},
): Promise<Ambiente> {
  const ensaio = await criarBancoDeEnsaio();
  await semear(ensaio.admin);
  const linhasDeLog: string[] = [];
  const registro = criarRegistro((linha) => linhasDeLog.push(linha));
  const banco = criarBanco(ensaio.urlDoServico, registro);
  await prepararTabelas(banco);

  // Primeiro a porta, depois a configuração: a URL pública precisa dela.
  const servidor = createServer();
  await new Promise<void>((pronto) => servidor.listen(0, "127.0.0.1", pronto));
  const base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  const config = lerConfig({
    NODE_ENV: "test",
    DATABASE_URL: ensaio.urlDoServico,
    MCP_URL_PUBLICA: base,
  });
  const { app, handler } = criarAplicacao({
    config,
    banco,
    fonte: opcoes.fonte ?? criarFonteFicticia(),
    registro,
    resolverCliente: clienteDeEnsaio,
    agora: () => new Date("2026-09-11T15:00:00Z"),
    tempoMaximoMs: opcoes.tempoMaximoMs,
  });
  servidor.on("request", app);

  return {
    base,
    config,
    ensaio,
    banco,
    linhasDeLog,
    async encerrar() {
      servidor.close();
      await handler.close();
      await banco.end();
      await ensaio.encerrar();
    },
  };
}

export async function chavesPara(
  ambiente: Ambiente,
  email: string = PESSOAS.gerente,
  unidade?: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const verificador = randomBytes(40).toString("base64url");
  const code = await obterCodigo(ambiente.base, {
    email,
    senha: SENHA_DE_ENSAIO,
    clientId: CLIENTE_DE_ENSAIO,
    redirectUri: RETORNO,
    verificador,
    recurso: ambiente.config.urlMcp.href,
    unidade,
  });
  const { corpo } = await pedirChaves(ambiente.base, {
    grant_type: "authorization_code",
    code,
    redirect_uri: RETORNO,
    client_id: CLIENTE_DE_ENSAIO,
    code_verifier: verificador,
  });
  return {
    accessToken: String(corpo.access_token),
    refreshToken: String(corpo.refresh_token),
  };
}
```

```ts arquivo=servicos/mcp/src/servidor.integracao.ts
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";

import { chavesPara, subirAmbiente, type Ambiente } from "./ensaio/ambiente.js";
import { urlDeEnsaio } from "./ensaio/banco-de-ensaio.js";
import { PESSOAS } from "./ensaio/semente.js";
import { criarFonteFicticia, pedidosFicticios } from "./fontes/ficticia.js";
import type { FonteDeVendas } from "./fontes/tipos.js";

const pular = urlDeEnsaio()
  ? false
  : "defina MCP_ENSAIO_PG_URL (Postgres local) para rodar";

describe("servidor completo, de ponta a ponta", { skip: pular }, () => {
  let ambiente: Ambiente;
  let fonteQuebrada = false;
  const chavesEmitidas: string[] = [];

  // Uma fonte que o teste consegue quebrar no meio do caminho.
  const ficticia = criarFonteFicticia();
  const fonte: FonteDeVendas = {
    nome: "ficticia",
    ehFicticia: true,
    vendasDoDia: (consulta, sinal) =>
      fonteQuebrada
        ? Promise.reject(new Error("conexão recusada em 10.0.0.5:5432"))
        : ficticia.vendasDoDia(consulta, sinal),
  };

  before(async () => {
    ambiente = await subirAmbiente({ fonte });
  });

  after(async () => {
    await ambiente?.encerrar();
  });

  async function chaves(email?: string, unidade?: string) {
    const par = await chavesPara(ambiente, email, unidade);
    chavesEmitidas.push(par.accessToken, par.refreshToken);
    return par;
  }

  async function conectar(token: string, modo: "legacy" | "auto") {
    const cliente = new Client(
      { name: "ensaio", version: "1.0.0" },
      { versionNegotiation: { mode: modo } },
    );
    await cliente.connect(
      new StreamableHTTPClientTransport(new URL("/mcp", ambiente.base), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    return cliente;
  }

  const mcp = (
    cabecalhos: Record<string, string>,
    corpo: unknown,
    metodo = "POST",
  ) =>
    fetch(new URL("/mcp", ambiente.base), {
      method: metodo,
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...cabecalhos,
      },
      body: metodo === "POST" ? JSON.stringify(corpo) : undefined,
    });

  const inicializar = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "curl", version: "1" },
    },
  };

  for (const [modo, versao] of [
    ["legacy", "2025-11-25"],
    ["auto", "2026-07-28"],
  ] as const) {
    it(`inicializa, lista e chama vendas_do_dia (protocolo ${versao})`, async () => {
      const { accessToken } = await chaves();
      const cliente = await conectar(accessToken, modo);
      assert.equal(cliente.getNegotiatedProtocolVersion(), versao);

      const { tools } = await cliente.listTools();
      assert.deepEqual(
        tools.map((t) => t.name),
        ["vendas_do_dia"],
      );

      const resultado = await cliente.callTool({
        name: "vendas_do_dia",
        arguments: { data: "2026-09-10" },
      });
      await cliente.close();

      // A "fonte original": os mesmos pedidos fictícios, somados por fora.
      const pedidos = pedidosFicticios({
        unidadeId: "uni_centro",
        data: "2026-09-10",
      });
      const dados = resultado.structuredContent as Record<string, unknown>;
      assert.equal(dados.quantidade_vendas, pedidos.length);
      assert.equal(
        dados.total_centavos,
        pedidos.reduce((soma, pedido) => soma + pedido.valorCentavos, 0),
      );
      assert.equal(dados.fonte, "ficticia");
    });
  }

  it("data inválida e data futura voltam como erro de ferramenta", async () => {
    const { accessToken } = await chaves();
    const cliente = await conectar(accessToken, "legacy");
    for (const data of ["10/09/2026", "2026-09-12"]) {
      const resultado = await cliente.callTool({
        name: "vendas_do_dia",
        arguments: { data },
      });
      assert.equal(resultado.isError, true, data);
    }
    await cliente.close();
  });

  it("fonte quebrada vira isError sem vazar detalhe, e o processo segue de pé", async () => {
    const { accessToken } = await chaves();
    const cliente = await conectar(accessToken, "legacy");
    fonteQuebrada = true;
    const resultado = await cliente.callTool({
      name: "vendas_do_dia",
      arguments: { data: "2026-09-10" },
    });
    fonteQuebrada = false;
    await cliente.close();

    assert.equal(resultado.isError, true);
    assert.ok(!JSON.stringify(resultado).includes("10.0.0.5"));
    assert.equal((await fetch(new URL("/health", ambiente.base))).status, 200);
  });

  it("sem chave: 401 que leva o cliente à descoberta do login", async () => {
    const resposta = await mcp({}, inicializar);
    assert.equal(resposta.status, 401);
    const desafio = resposta.headers.get("www-authenticate") ?? "";
    assert.ok(
      desafio.includes(
        `resource_metadata="${ambiente.base}/.well-known/oauth-protected-resource/mcp"`,
      ),
    );
    assert.match(desafio, /scope="vendas:ler"/);
  });

  it("publica os dois documentos de descoberta", async () => {
    for (const caminho of [
      "/.well-known/oauth-protected-resource/mcp",
      "/.well-known/oauth-protected-resource",
    ]) {
      const recurso = await (
        await fetch(new URL(caminho, ambiente.base))
      ).json();
      assert.equal(recurso.resource, `${ambiente.base}/mcp`);
      assert.deepEqual(recurso.authorization_servers, [ambiente.base]);
    }
    const emissor = await (
      await fetch(
        new URL("/.well-known/oauth-authorization-server", ambiente.base),
      )
    ).json();
    assert.equal(emissor.issuer, ambiente.base);
    assert.equal(emissor.client_id_metadata_document_supported, true);
    assert.deepEqual(emissor.code_challenge_methods_supported, ["S256"]);
  });

  it("GET /mcp responde 405: não há sessão para abrir", async () => {
    const { accessToken } = await chaves();
    const resposta = await mcp(
      { Authorization: `Bearer ${accessToken}` },
      null,
      "GET",
    );
    assert.equal(resposta.status, 405);
  });

  it("corpo acima de 64 KB: 413 com chave, 401 sem chave (a chave vem antes do corpo)", async () => {
    const { accessToken } = await chaves();
    const grande = { ...inicializar, lixo: "x".repeat(70 * 1024) };
    assert.equal(
      (await mcp({ Authorization: `Bearer ${accessToken}` }, grande)).status,
      413,
    );
    assert.equal((await mcp({}, grande)).status, 401);
  });

  it("Host ou Origin estranhos: 403", async () => {
    const saude = new URL("/health", ambiente.base);
    // fetch não deixa trocar o Host; o teste usa http.request.
    const { request } = await import("node:http");
    const status = await new Promise<number>((pronto, falha) => {
      request(saude, { headers: { host: "evil.example" } }, (resposta) => {
        resposta.resume();
        pronto(resposta.statusCode ?? 0);
      })
        .on("error", falha)
        .end();
    });
    assert.equal(status, 403);
    assert.equal(
      (await fetch(saude, { headers: { origin: "https://evil.example" } }))
        .status,
      403,
    );
  });

  it("/health responde sem nada sensível", async () => {
    const resposta = await fetch(new URL("/health", ambiente.base));
    const corpo = await resposta.json();
    assert.deepEqual(Object.keys(corpo).sort(), [
      "banco",
      "servico",
      "status",
      "versao",
    ]);
    assert.equal(corpo.banco, "ok");
    assert.ok(!JSON.stringify(corpo).includes("postgres"));
  });

  it("registra as chamadas no banco", async () => {
    const { rows } = await ambiente.ensaio.admin.query(
      "SELECT resultado, count(*)::int AS n FROM mcp.chamada GROUP BY resultado",
    );
    const contagem = Object.fromEntries(
      (rows as { resultado: string; n: number }[]).map((l) => [
        l.resultado,
        l.n,
      ]),
    );
    assert.ok((contagem.ok ?? 0) >= 2);
    assert.ok((contagem.erro ?? 0) >= 1);
  });

  it("pessoa suspensa no Tetteo perde o acesso na chamada seguinte", async () => {
    const { accessToken } = await chaves(PESSOAS.dono, "uni_sul");
    const cabecalho = { Authorization: `Bearer ${accessToken}` };
    assert.equal((await mcp(cabecalho, inicializar)).status, 200);
    await ambiente.ensaio.admin.query(
      `UPDATE usuario SET status = 'SUSPENSO' WHERE id = 'usr_dono'`,
    );
    assert.equal((await mcp(cabecalho, inicializar)).status, 401);
  });

  it("nenhuma chave, código ou senha aparece nos logs", () => {
    const logs = ambiente.linhasDeLog.join("\n");
    assert.ok(ambiente.linhasDeLog.length > 10);
    for (const chave of chavesEmitidas) assert.ok(!logs.includes(chave));
    assert.ok(!/tmc[pcrq]_[A-Za-z0-9_-]{20}/.test(logs));
    assert.ok(!logs.includes("senha-de-ensaio"));

    const caminhos = ambiente.linhasDeLog
      .map((linha) => JSON.parse(linha) as { caminho?: string })
      .flatMap((linha) => (linha.caminho ? [linha.caminho] : []));
    assert.ok(caminhos.includes("/oauth/authorize"));
    assert.ok(
      caminhos.every((caminho) => !caminho.includes("?")),
      "nenhuma query string registrada",
    );
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `$env:MCP_ENSAIO_PG_URL = "<url local>"; npm run test:integracao --prefix servicos/mcp`
Expected: FAIL — `./servidor.js` não existe.

- [ ] **Step 3: Implementar**

```ts arquivo=servicos/mcp/src/servidor.ts
import { randomUUID } from "node:crypto";

import {
  getOAuthProtectedResourceMetadataUrl,
  hostHeaderValidation,
  mcpAuthMetadataRouter,
  originValidation,
  requireBearerAuth,
} from "@modelcontextprotocol/express";
import { toNodeHandler } from "@modelcontextprotocol/node";
import {
  createMcpHandler,
  type McpHttpHandler,
} from "@modelcontextprotocol/server";
import express, {
  type ErrorRequestHandler,
  type Express,
  type RequestHandler,
} from "express";

import type { Banco } from "./banco/conexao.js";
import type { Config } from "./config.js";
import type { FonteDeVendas } from "./fontes/tipos.js";
import { criarServidorMcp, VERSAO } from "./mcp/servidor-mcp.js";
import { registrarChamada } from "./oauth/armazem.js";
import {
  criarResolvedorDeClientes,
  type ResolverCliente,
} from "./oauth/cliente.js";
import { ESCOPO_VENDAS, ESCOPOS_SUPORTADOS } from "./oauth/escopos.js";
import { metadadosDoEmissor } from "./oauth/metadados.js";
import { rotasDeAutorizacao } from "./oauth/rotas-autorizar.js";
import { rotasDeToken } from "./oauth/rotas-token.js";
import { criarVerificador } from "./oauth/verificador.js";
import type { Registro } from "./registro.js";

/**
 * A MONTAGEM DO SERVIDOR.
 *
 * A ordem das camadas é a segurança:
 *
 *   1. registro     toda requisição vira uma linha (sem query, sem corpo)
 *   2. Host         só o nosso nome — barra DNS rebinding
 *   3. Origin       navegador de outro site não entra
 *   4. rotas        /health, descoberta, /oauth/*, /mcp
 *   5. em /mcp:     a CHAVE antes do corpo. Quem não tem chave não consegue
 *                   nem fazer o servidor ler 64 KB de JSON.
 *
 * `/mcp` é servido por `createMcpHandler` no modo sem sessão: cada requisição
 * monta um McpServer novo (2026-07-28) ou cai no modo sem sessão de 2025
 * (`legacy: "stateless"`). Nada fica em memória entre chamadas.
 */

export type DependenciasDoServidor = {
  config: Config;
  banco: Banco;
  fonte: FonteDeVendas;
  registro: Registro;
  resolverCliente?: ResolverCliente;
  agora?: () => Date;
  tempoMaximoMs?: number;
};

const NOME_DO_RECURSO = "Tetteo — consultas";

async function comLimite<T>(promessa: Promise<T>, ms: number): Promise<T> {
  let relogio: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promessa,
      new Promise<never>((_, rejeitar) => {
        relogio = setTimeout(() => rejeitar(new Error("tempo esgotado")), ms);
      }),
    ]);
  } finally {
    clearTimeout(relogio);
  }
}

function registrarRequisicoes(registro: Registro): RequestHandler {
  return (req, res, next) => {
    const inicio = performance.now();
    const id = randomUUID();
    res.setHeader("X-Request-Id", id);
    res.on("finish", () => {
      registro.info("requisicao", {
        id,
        metodo: req.method,
        // Só o caminho: a query de /oauth/authorize carrega state e desafio.
        caminho: req.originalUrl.split("?")[0],
        status: res.statusCode,
        ms: Math.round(performance.now() - inicio),
      });
    });
    next();
  };
}

function tratarErros(registro: Registro): ErrorRequestHandler {
  return (erro, req, res, _proximo) => {
    const informado = (erro as { status?: unknown })?.status;
    const status =
      typeof informado === "number" && informado >= 400 && informado < 600
        ? informado
        : 500;
    if (status >= 500) {
      registro.erro("erro inesperado", { erro, caminho: req.path });
    } else {
      // O erro de JSON malformado traz um pedaço do corpo na mensagem: fica
      // de fora do registro.
      registro.aviso("requisição recusada", {
        status,
        caminho: req.path,
        tipo: (erro as { type?: string })?.type,
      });
    }
    if (res.headersSent) return;

    if (req.path === "/mcp") {
      res.status(status).json({
        jsonrpc: "2.0",
        error: {
          code: status === 400 ? -32700 : status === 413 ? -32600 : -32603,
          message:
            status === 413
              ? "Requisição grande demais."
              : status === 400
                ? "JSON inválido."
                : "Erro interno.",
        },
        id: null,
      });
      return;
    }
    res.status(status).json({
      error:
        status === 413
          ? "request_too_large"
          : status < 500
            ? "invalid_request"
            : "server_error",
    });
  };
}

export function criarAplicacao(deps: DependenciasDoServidor): {
  app: Express;
  handler: McpHttpHandler;
} {
  const { config, banco, registro } = deps;
  const app = express();
  app.disable("x-powered-by");
  // Atrás do Traefik: o IP de quem chama vem no X-Forwarded-For (um salto).
  app.set("trust proxy", 1);

  app.use(registrarRequisicoes(registro));
  app.use(hostHeaderValidation(config.hostsPermitidos));
  app.use(originValidation([config.urlPublica.hostname]));

  app.get("/health", async (_req, res) => {
    let situacaoDoBanco: "ok" | "indisponivel" = "ok";
    try {
      await comLimite(banco.query("SELECT 1"), 1500);
    } catch {
      situacaoDoBanco = "indisponivel";
    }
    res.set("Cache-Control", "no-store").json({
      status: "ok",
      servico: "tetteo-mcp",
      versao: VERSAO,
      banco: situacaoDoBanco,
    });
  });

  // Descoberta: RFC 9728 (recurso) e RFC 8414 (servidor de autorização).
  app.use(
    mcpAuthMetadataRouter({
      oauthMetadata: metadadosDoEmissor(config),
      resourceServerUrl: config.urlMcp,
      scopesSupported: [...ESCOPOS_SUPORTADOS],
      resourceName: NOME_DO_RECURSO,
    }),
  );
  // O mesmo documento na raiz: clientes que não acham o caminho com /mcp
  // tentam aqui.
  app.get("/.well-known/oauth-protected-resource", (_req, res) => {
    res.set("Access-Control-Allow-Origin", "*").json({
      resource: config.urlMcp.href,
      authorization_servers: [config.emissor],
      scopes_supported: [...ESCOPOS_SUPORTADOS],
      resource_name: NOME_DO_RECURSO,
    });
  });

  app.use(
    "/oauth",
    express.urlencoded({ extended: false, limit: "16kb", parameterLimit: 50 }),
  );
  app.use(
    "/oauth",
    rotasDeAutorizacao({
      banco,
      config,
      registro,
      resolverCliente:
        deps.resolverCliente ??
        criarResolvedorDeClientes({
          hostsConfiaveis: config.clientesConfiaveis,
        }),
    }),
  );
  app.use("/oauth", rotasDeToken({ banco, config, registro }));

  const handler = createMcpHandler(
    ({ authInfo }) =>
      criarServidorMcp(authInfo, {
        fonte: deps.fonte,
        registro,
        registrarChamada: (chamada) => registrarChamada(banco, chamada),
        agora: deps.agora,
        tempoMaximoMs: deps.tempoMaximoMs,
      }),
    {
      legacy: "stateless",
      onerror: (erro) =>
        registro.aviso("o MCP recusou uma requisição", { erro }),
    },
  );
  const atenderMcp = toNodeHandler(handler, {
    onerror: (erro) => registro.erro("falha no adaptador MCP", { erro }),
  });

  app.all(
    "/mcp",
    requireBearerAuth({
      verifier: criarVerificador({ banco, config, registro }),
      requiredScopes: [ESCOPO_VENDAS],
      resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(config.urlMcp),
    }),
    express.json({ limit: "64kb" }),
    async (req, res) => {
      await atenderMcp(req, res, req.body);
    },
  );

  app.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });
  app.use(tratarErros(registro));

  return { app, handler };
}
```

```ts arquivo=servicos/mcp/src/principal.ts
import { existsSync } from "node:fs";

import { criarBanco } from "./banco/conexao.js";
import { prepararTabelas } from "./banco/tabelas.js";
import { lerConfig } from "./config.js";
import { criarFonteFicticia } from "./fontes/ficticia.js";
import { criarRegistro } from "./registro.js";
import { criarAplicacao } from "./servidor.js";

/**
 * A SUBIDA DO SERVIDOR MCP.
 *
 * Em desenvolvimento lê `.env.local` (fora do git). Em produção as variáveis
 * vêm do Dokploy — nunca de arquivo.
 *
 * Erros: promessa rejeitada sem tratamento é registrada e o processo segue;
 * exceção não tratada é registrada e o processo SAI, porque depois dela o
 * estado é desconhecido — o contêiner reinicia limpo em segundos. Erro de
 * ferramenta não chega aqui: vira `isError` lá dentro.
 */

if (process.env.NODE_ENV !== "production" && existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

const registro = criarRegistro();

process.on("unhandledRejection", (motivo) => {
  registro.erro("promessa rejeitada sem tratamento", { erro: motivo });
});
process.on("uncaughtException", (erro) => {
  registro.erro("exceção não tratada — encerrando para reiniciar limpo", {
    erro,
  });
  process.exit(1);
});

const config = lerConfig();
const banco = criarBanco(config.bancoUrl, registro);
await prepararTabelas(banco);

const fonte = criarFonteFicticia();
const { app, handler } = criarAplicacao({ config, banco, fonte, registro });

const servidor = app.listen(config.porta, "0.0.0.0", () => {
  registro.info("servidor MCP no ar", {
    porta: config.porta,
    recurso: config.urlMcp.href,
    fonte: fonte.nome,
  });
});
servidor.requestTimeout = 30_000;
servidor.headersTimeout = 15_000;
servidor.keepAliveTimeout = 65_000;

let encerrando = false;
async function encerrar(sinal: string) {
  if (encerrando) return;
  encerrando = true;
  registro.info("encerrando", { sinal });
  servidor.close();
  await handler.close().catch(() => {});
  await banco.end().catch(() => {});
  process.exit(0);
}
process.once("SIGTERM", () => void encerrar("SIGTERM"));
process.once("SIGINT", () => void encerrar("SIGINT"));
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test --prefix servicos/mcp`, `$env:MCP_ENSAIO_PG_URL = "<url local>"; npm run test:integracao --prefix servicos/mcp`, `npm run typecheck --prefix servicos/mcp` e `npm run build --prefix servicos/mcp`
Expected: todos PASS; `servicos/mcp/dist/principal.js` existe.

- [ ] **Step 5: Commit**

```bash
git add servicos/mcp/src
git commit -m "MCP: o servidor montado — a chave antes do corpo, /mcp sem sessão nas duas versões do protocolo"
```

---

### Tarefa 11: Revogação pelo terminal, imagem de produção e demonstração real

**Files:**

- Create: `servicos/mcp/src/admin/conexoes.ts`
- Create: `servicos/mcp/Dockerfile`, `servicos/mcp/.dockerignore`
- Create: `servicos/mcp/src/ensaio/subir-local.ts`, `servicos/mcp/src/ensaio/demonstracao.ts`
- Modify: `servicos/mcp/package.json` (scripts `ensaio:subir` e `ensaio:demonstrar`)

**Interfaces:**

- Consumes: `listarConexoes`, `revogarConexao`, `revogarConexoesDoUsuario` (Tarefa 7); `criarBancoDeEnsaio`, `semear` (Tarefa 6); `obterCodigo`, `pedirChaves` (Tarefa 9); `pedidosFicticios` (Tarefa 2).

- [ ] **Step 1: A revogação pelo terminal**

```ts arquivo=servicos/mcp/src/admin/conexoes.ts
import { existsSync } from "node:fs";

import { criarBanco } from "../banco/conexao.js";
import {
  listarConexoes,
  revogarConexao,
  revogarConexoesDoUsuario,
} from "../oauth/armazem.js";
import { criarRegistro } from "../registro.js";

/**
 * AS CONEXÕES, PELO TERMINAL.
 *
 *   node dist/admin/conexoes.js listar
 *   node dist/admin/conexoes.js revogar <id-da-conexão>
 *   node dist/admin/conexoes.js revogar-usuario <e-mail>
 *
 * Roda dentro do contêiner (terminal do Dokploy), com a mesma DATABASE_URL do
 * serviço. Não mostra chave nenhuma — o banco nem as tem em claro.
 */

if (process.env.NODE_ENV !== "production" && existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

const [comando, argumento] = process.argv.slice(2);
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Falta DATABASE_URL.");
  process.exit(1);
}

const banco = criarBanco(
  url,
  criarRegistro((linha) => process.stderr.write(`${linha}\n`)),
);

try {
  if (comando === "listar") {
    const conexoes = await listarConexoes(banco);
    if (conexoes.length === 0) console.log("Nenhuma conexão.");
    for (const conexao of conexoes) {
      console.log(
        [
          conexao.id,
          conexao.revogadaEm ? `REVOGADA (${conexao.motivo})` : "ativa",
          conexao.email ?? "(pessoa sem acesso)",
          conexao.unidadeNome ?? "-",
          conexao.clienteNome,
          `criada ${conexao.criadaEm.toISOString()}`,
          conexao.ultimoUsoEm
            ? `último uso ${conexao.ultimoUsoEm.toISOString()}`
            : "nunca usada",
        ].join(" · "),
      );
    }
  } else if (comando === "revogar" && argumento) {
    await revogarConexao(banco, argumento, "revogada pelo administrador");
    console.log(`Conexão ${argumento}: revogada (se existia).`);
  } else if (comando === "revogar-usuario" && argumento) {
    const quantas = await revogarConexoesDoUsuario(banco, argumento);
    console.log(`${quantas} conexão(ões) revogada(s).`);
  } else {
    console.log(
      "Uso: conexoes listar | revogar <id> | revogar-usuario <e-mail>",
    );
    process.exitCode = 1;
  }
} finally {
  await banco.end();
}
```

- [ ] **Step 2: A imagem de produção**

```dockerfile arquivo=servicos/mcp/Dockerfile
# =============================================================================
# TETTEO MCP — imagem de produção
#
# Três etapas: instala, compila, e monta a imagem final só com o que roda —
# sem TypeScript, sem testes, sem ferramentas de compilação.
# Node 24, a mesma versão do app principal e do desenvolvimento.
# =============================================================================

FROM node:24-alpine AS base
WORKDIR /app

FROM base AS dependencias
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM dependencias AS compilacao
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM base AS execucao
ENV NODE_ENV=production
ENV PORT=8080
# "Hoje" é o dia de Brasília. O código já calcula em America/Sao_Paulo; o
# fuso do contêiner deixa os registros no mesmo relógio da loja.
ENV TZ=America/Sao_Paulo

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=compilacao /app/dist ./dist
COPY sql ./sql

# Usuário sem privilégios, que já vem na imagem do Node.
USER node
EXPOSE 8080

# O Host 127.0.0.1 está na lista de hosts permitidos.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/health > /dev/null || exit 1

CMD ["node", "dist/principal.js"]
```

```gitignore arquivo=servicos/mcp/.dockerignore
node_modules
dist
.env*
src/**/*.test.ts
src/**/*.integracao.ts
src/ensaio
```

- [ ] **Step 3: Os scripts de demonstração local**

```ts arquivo=servicos/mcp/src/ensaio/subir-local.ts
import { writeFileSync } from "node:fs";

import { criarBancoDeEnsaio } from "./banco-de-ensaio.js";
import { semear } from "./semente.js";

/**
 * PREPARA UM BANCO DE ENSAIO PARA RODAR O SERVIDOR DE VERDADE NA MÁQUINA.
 *
 * Cria o banco (com as migrações reais do Tetteo e o 01-preparar-banco.sql),
 * semeia as pessoas de ensaio e escreve `servicos/mcp/.env.local` (fora do
 * git) com a DATABASE_URL do papel tetteo_mcp. Não imprime a URL.
 * O banco some quando o Postgres de ensaio for desligado.
 */

const porta = process.argv[2] ?? "8787";
const ensaio = await criarBancoDeEnsaio();
await semear(ensaio.admin);
await ensaio.admin.end();

writeFileSync(
  ".env.local",
  [
    `DATABASE_URL=${ensaio.urlDoServico}`,
    `MCP_URL_PUBLICA=http://127.0.0.1:${porta}`,
    `PORT=${porta}`,
    "",
  ].join("\n"),
);
console.log(
  `Banco de ensaio pronto e .env.local escrito. Rode: npm run dev (porta ${porta}).`,
);
```

```ts arquivo=servicos/mcp/src/ensaio/demonstracao.ts
import { randomBytes } from "node:crypto";

import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";

import { pedidosFicticios } from "../fontes/ficticia.js";
import { hojeEmSaoPaulo } from "../mcp/data.js";
import { obterCodigo, pedirChaves } from "./fluxo.js";
import { PESSOAS, SENHA_DE_ENSAIO } from "./semente.js";

/**
 * O CAMINHO COMPLETO CONTRA O SERVIDOR RODANDO — com a identidade REAL do
 * Claude Code (o documento CIMD publicado em claude.ai), não um cliente de
 * mentira. Faz login, troca o código, conecta pelo SDK oficial, lista as
 * ferramentas, chama vendas_do_dia e compara com a fonte fictícia somada por
 * fora. Não imprime chave nenhuma.
 *
 *   npm run ensaio:demonstrar -- http://127.0.0.1:8787 2026-09-10
 */

const CLAUDE_CODE = "https://claude.ai/oauth/claude-code-client-metadata";
const base = process.argv[2] ?? "http://127.0.0.1:8787";
const ontem = hojeEmSaoPaulo(new Date(Date.now() - 24 * 60 * 60 * 1000));
const data = process.argv[3] ?? ontem;
const redirectUri = "http://127.0.0.1:53682/callback";
const verificador = randomBytes(40).toString("base64url");

const code = await obterCodigo(base, {
  email: PESSOAS.gerente,
  senha: SENHA_DE_ENSAIO,
  clientId: CLAUDE_CODE,
  redirectUri,
  verificador,
  recurso: `${base}/mcp`,
});
console.log("1. login e consentimento: código recebido");

const { status, corpo } = await pedirChaves(base, {
  grant_type: "authorization_code",
  code,
  redirect_uri: redirectUri,
  client_id: CLAUDE_CODE,
  code_verifier: verificador,
  resource: `${base}/mcp`,
});
if (status !== 200) throw new Error(`troca recusada: ${JSON.stringify(corpo)}`);
console.log(
  `2. chaves emitidas (expira em ${corpo.expires_in} s, escopo ${corpo.scope})`,
);

const cliente = new Client(
  { name: "demonstracao", version: "1.0.0" },
  { versionNegotiation: { mode: "auto" } },
);
await cliente.connect(
  new StreamableHTTPClientTransport(new URL("/mcp", base), {
    requestInit: {
      headers: { Authorization: `Bearer ${String(corpo.access_token)}` },
    },
  }),
);
console.log(
  `3. conectado (protocolo ${cliente.getNegotiatedProtocolVersion()})`,
);

const { tools } = await cliente.listTools();
console.log(`4. ferramentas: ${tools.map((t) => t.name).join(", ")}`);

const resultado = await cliente.callTool({
  name: "vendas_do_dia",
  arguments: { data },
});
await cliente.close();
const dados = resultado.structuredContent as Record<string, number | string>;
console.log(`5. vendas_do_dia(${data}):`, JSON.stringify(dados));

const pedidos = pedidosFicticios({ unidadeId: "uni_centro", data });
const esperado = pedidos.reduce(
  (soma, pedido) => soma + pedido.valorCentavos,
  0,
);
const confere =
  dados.quantidade_vendas === pedidos.length &&
  dados.total_centavos === esperado;
console.log(
  `6. fonte original: ${pedidos.length} pedidos, ${esperado} centavos → ${confere ? "CONFERE" : "NÃO CONFERE"}`,
);
process.exitCode = confere ? 0 : 1;
```

Em `servicos/mcp/package.json`, dentro de `"scripts"`, depois de `"conexoes"`:

```json
    "ensaio:subir": "tsx src/ensaio/subir-local.ts",
    "ensaio:demonstrar": "tsx src/ensaio/demonstracao.ts"
```

- [ ] **Step 4: Rodar a demonstração contra o processo real**

```powershell
$env:MCP_ENSAIO_PG_URL = "<url local>"; npm run ensaio:subir --prefix servicos/mcp
npm run build --prefix servicos/mcp
# em outro terminal, dentro de servicos/mcp: node dist/principal.js
curl.exe -s http://127.0.0.1:8787/health
curl.exe -si -X POST http://127.0.0.1:8787/mcp -H "content-type: application/json" -d "{}"
npm run ensaio:demonstrar --prefix servicos/mcp -- http://127.0.0.1:8787 2026-09-10
```

Expected: `/health` → `{"status":"ok",...,"banco":"ok"}`; `/mcp` sem chave → `401` com `WWW-Authenticate`; a demonstração termina em `CONFERE`.

- [ ] **Step 5: Commit**

```bash
git add servicos/mcp
git commit -m "MCP: revogar pelo terminal, a imagem de produção e a demonstração com a identidade real do Claude Code"
```

---

### Tarefa 12: README, verificação final e publicação

**Files:**

- Create: `servicos/mcp/README.md`

- [ ] **Step 1: O README do serviço**

````markdown arquivo=servicos/mcp/README.md
# Tetteo MCP

Servidor MCP remoto que dá ao Claude ferramentas de **consulta** do Tetteo. Hoje tem uma
ferramenta, `vendas_do_dia`, que recebe uma data (`AAAA-MM-DD`, horário de Brasília) e
devolve a quantidade de vendas e o total da loja ligada à conexão.

**A fonte é fictícia por enquanto.** Toda resposta diz "DADOS FICTÍCIOS" e traz
`"fonte": "ficticia"`. A fonte real entra quando o Tetteo tiver vendas (Cardápio Web → módulo
Pedidos).

- Endereço MCP: `https://mcp.vitalianopizzaria.com.br/mcp`. A URL não carrega senha e pode
  ser compartilhada: cada pessoa entra com a própria conta do Tetteo.
- Desenho completo: `docs/superpowers/specs/2026-09-11-servidor-mcp-design.md`.

## Segurança em um parágrafo

O login é **OAuth 2.1**, conforme a especificação MCP 2025-11-25:

- o Claude se identifica pela URL que a Anthropic publica (CIMD), e só hosts da lista
  `MCP_CLIENTES_CONFIAVEIS` são aceitos;
- a pessoa entra com e-mail e senha do Tetteo, e só conecta quem pode ver o Financeiro da
  loja;
- as chaves são aleatórias, guardadas só como hash, valem 1 hora (a de renovação é trocada
  a cada uso) e são conferidas a cada requisição — suspender alguém no Tetteo corta o acesso
  na hora.

No banco, o papel `tetteo_mcp` não enxerga nenhuma tabela do Tetteo: lê duas visões mínimas
(`mcp_leitura`) e escreve só no próprio esquema (`mcp`).

## Rodar na máquina

Precisa de um Postgres local de ensaio (por exemplo `embedded-postgres` instalado fora do
repositório, UTF-8, só em `127.0.0.1`).

```powershell
cd servicos/mcp
npm install
$env:MCP_ENSAIO_PG_URL = "postgresql://postgres:<senha>@127.0.0.1:<porta>/postgres"
npm run ensaio:subir          # cria banco de ensaio e escreve .env.local (fora do git)
npm run dev                   # servidor em http://127.0.0.1:8787
npm run ensaio:demonstrar -- http://127.0.0.1:8787 2026-09-10
```

## Testes

```powershell
npm test                      # unidade
npm run test:integracao       # com banco (precisa de MCP_ENSAIO_PG_URL)
npm run typecheck
npm run build
```

## Variáveis de ambiente

| Variável                  | Exemplo                                                | Segredo?                |
| ------------------------- | ------------------------------------------------------ | ----------------------- |
| `DATABASE_URL`            | `postgresql://tetteo_mcp:…@<host-interno>:5432/tetteo` | **Sim** — só no Dokploy |
| `MCP_URL_PUBLICA`         | `https://mcp.vitalianopizzaria.com.br`                 | Não                     |
| `MCP_HOSTS_PERMITIDOS`    | (padrão: host público, localhost, 127.0.0.1)           | Não                     |
| `MCP_CLIENTES_CONFIAVEIS` | `claude.ai,claude.com`                                 | Não                     |
| `MCP_FONTE`               | `ficticia`                                             | Não                     |
| `PORT`                    | `8080`                                                 | Não                     |

## Publicar (Dokploy)

1. **Banco:** rodar `sql/01-preparar-banco.sql` uma vez, como administrador, no banco
   `tetteo`. Depois definir a senha do papel `tetteo_mcp` direto no servidor — ela nunca
   entra no repositório.
2. **Aplicação** no projeto `tetteo`:
   - GitHub `tetteo`, branch `main`;
   - build por Dockerfile, com contexto `servicos/mcp`;
   - watch path `servicos/mcp/**`;
   - porta 8080.
3. **Domínio** `mcp.vitalianopizzaria.com.br` com HTTPS (Let's Encrypt). Registro `A` `mcp`
   → IP da VPS.
4. **Variáveis** da tabela acima, na aba Environment.

## Conectar no Claude

Personalizar › Conectores › **Adicionar conector personalizado**:

1. nome `Tetteo`, URL `https://mcp.vitalianopizzaria.com.br/mcp`;
2. autenticação por login (OAuth), cliente "identidade publicada do Claude";
3. **Adicionar**, depois **Conectar**. Abre a tela do Tetteo: entre com seu e-mail e senha
   do Tetteo e autorize.

No chat, ligue o conector em **+ › Conectores** e pergunte, por exemplo: "Quanto vendi em
10/09/2026?".

## Revogar

- **No Claude:** remover ou desconectar o conector.
- **No Tetteo:** suspender a pessoa ou tirar a permissão de Financeiro. O acesso cai na
  chamada seguinte.
- **No terminal do contêiner:**
  `node dist/admin/conexoes.js listar | revogar <id> | revogar-usuario <email>`.
- **Tudo de uma vez:** trocar a senha do papel `tetteo_mcp`.
````

- [ ] **Step 2: Verificação final (local)**

```powershell
npm test --prefix servicos/mcp
$env:MCP_ENSAIO_PG_URL = "<url local>"; npm run test:integracao --prefix servicos/mcp
npm run typecheck --prefix servicos/mcp; npm run build --prefix servicos/mcp
# app principal continua limpo com as três exclusões:
npm run typecheck; npm run lint; npm run format:check
```

Expected: tudo verde; `format:check` da raiz cobre `servicos/mcp` (menos `dist/`).

- [ ] **Step 3: Commit**

```bash
git add servicos/mcp/README.md
git commit -m "MCP: o README — rodar, testar, publicar, conectar e revogar"
```

- [ ] **Step 4: Publicação — o que depende da conta do Pablo e o que é feito com o OK dele**

1. **(Pablo, Registro.br)** Criar o registro `A` com nome `mcp` e valor `187.77.35.238`.
   Conferir com `Resolve-DnsName mcp.vitalianopizzaria.com.br`.
2. **(Pablo, Dokploy)** Criar a aplicação `tetteo-mcp` no projeto `tetteo` / `production`,
   com o GitHub `tetteo`, a branch `main`, build por Dockerfile no caminho `servicos/mcp`,
   watch path `servicos/mcp/**` e o domínio `mcp.vitalianopizzaria.com.br`, porta 8080,
   HTTPS com Let's Encrypt. Variáveis: `MCP_URL_PUBLICA`, `MCP_FONTE=ficticia`.
3. **(Com OK do Pablo, via SSH)** Rodar `01-preparar-banco.sql` no banco `tetteo`, como o
   usuário do próprio contêiner do Postgres. Gerar a senha do `tetteo_mcp` no servidor e
   gravar a `DATABASE_URL` (host interno do banco) direto no ambiente da aplicação — sem
   aparecer no terminal.
4. **(Com OK do Pablo)** Publicar a branch no `main`. O `tetteo-web` também republica,
   porque as exclusões mexem no `tsconfig`, no ESLint e no `.dockerignore`. Acompanhar até
   `/health` responder.
5. **Conferir por fora:**
   - `curl.exe -s https://mcp.vitalianopizzaria.com.br/health`;
   - o `401` em `/mcp`;
   - os dois documentos em `/.well-known/`.
6. **(Pablo, Claude)** Adicionar o conector, conectar, autorizar e perguntar as vendas de
   uma data.
7. **(Com OK do Pablo)** Conferir no banco, só com contagens, que a conexão e a chamada
   foram registradas.
