# Integrações — o cofre de chaves · Plano de Implementação

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA: use `superpowers:subagent-driven-development` (recomendado) ou `superpowers:executing-plans` para implementar tarefa a tarefa. Os passos usam caixinha (`- [ ]`) para acompanhamento.

**Objetivo:** Um módulo onde o dono cola chaves de API e secret keys pela tela, guardadas cifradas, separadas por integração e por loja — e onde o MCP do Tetteo tem casa.

**Arquitetura:** O valor cifrado mora no banco; a chave-mestra mora no ambiente. A cifra e a leitura crua ficam em `server/cofre/`, alcançável por módulo **e** por conector; a verificação de permissão fica nos serviços do módulo, que é a única camada que enxerga o Core. O catálogo de integrações é declaração em código, como as permissões.

**Base:** [docs/superpowers/specs/2026-09-12-integracoes-cofre-de-chaves-design.md](../specs/2026-09-12-integracoes-cofre-de-chaves-design.md)

**Tecnologias:** Next.js 16.3 (App Router, Server Actions), React 19.2, Prisma 7 (pasta `prisma/schema/`), Zod 4, `node:crypto`, testes com `node:test` via `tsx`.

## Restrições globais

Valem para **todas** as tarefas.

- **`npm run check` precisa passar antes de todo commit.** Ele roda `typecheck` + `lint` + `format:check` + `test`.
- **Testes rodam sem banco.** `npm test` é `tsx --test "src/**/*.test.ts"`, com `node:test` e `node:assert/strict`. Nada de Prisma dentro de teste — por isso toda lógica que precisa de prova mora em função pura.
- **Fronteiras do linter (o build recusa compilar se violar):** `modules/*` importa só `core`, `design-system`, `lib`, `server` e ele mesmo. `server/*` importa só `server` e `lib` — **não enxerga o Core**. `connectors/*` importa `connector`, `core`, `lib`, `server`.
- **Cifra:** AES-256-GCM do `node:crypto`. Chave-mestra de 32 bytes em `TETTEO_CHAVE_MESTRA` (base64), lida do ambiente, **nunca do banco**.
- **`unidadeId` guarda `""` para "vale para a rede"**, nunca `null` — o Postgres trata dois `NULL` como diferentes e a trava de unicidade não valeria no caso mais comum.
- **Permissões novas:** `integracoes.ver` e `integracoes.editar`. Exatamente essas chaves.
- **A auditoria nunca grava o valor de um segredo, nem o tamanho dele.** Grava `{ integracao, campo, acao: "chave trocada", ultimos4 }`.
- **Nenhuma tela e nenhuma ação devolve o valor de um segredo ao navegador.**
- **Idioma:** nomes de arquivo, funções, variáveis e comentários em português, como o resto do projeto. Comentário explica o **porquê**, não o quê.
- **Prisma 7:** a URL de conexão vive em `prisma.config.ts`, lida do ambiente; o schema é a pasta `prisma/schema/`, um arquivo por camada.

---

## Estrutura de arquivos

| Arquivo                                                           | Responsabilidade                                                           |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `src/core/auditoria.ts`                                           | **Criar.** `auditar()` extraído de Configurações, usável por qualquer App  |
| `src/core/configuracoes/servicos.ts`                              | **Modificar.** Passa a usar a versão extraída; perde a cópia privada       |
| `src/server/cofre/cifra.ts`                                       | **Criar.** Cifrar, decifrar, mascarar. Puro: recebe a chave por parâmetro  |
| `src/server/cofre/cifra.test.ts`                                  | **Criar.** Ida e volta, adulteração, chave errada, versão desconhecida     |
| `src/server/cofre/index.ts`                                       | **Criar.** `segredo()` — lê do banco, cai para o ambiente, com cache curto |
| `src/server/cofre/ordem.ts`                                       | **Criar.** A regra de precedência, pura                                    |
| `src/server/cofre/ordem.test.ts`                                  | **Criar.** Cofre vence ambiente; vazio não vence nada                      |
| `src/modules/integracoes/manifest.ts`                             | **Criar.** Declaração ao Core                                              |
| `src/modules/integracoes/permissoes.ts`                           | **Criar.** `integracoes.ver`, `integracoes.editar`                         |
| `src/modules/integracoes/catalogo.ts`                             | **Criar.** As integrações declaradas, e o estado de cada uma. Puro         |
| `src/modules/integracoes/catalogo.test.ts`                        | **Criar.** Estados, campos faltando, chaves únicas                         |
| `src/modules/integracoes/schemas/auditoria.ts`                    | **Criar.** A linha de auditoria sem valor. Puro                            |
| `src/modules/integracoes/schemas/auditoria.test.ts`               | **Criar.** O segredo não aparece na linha                                  |
| `src/modules/integracoes/services/integracoes.ts`                 | **Criar.** Listar, obter, salvar, alternar — com permissão e auditoria     |
| `src/modules/integracoes/services/mcp.ts`                         | **Criar.** Emitir, listar, revogar, validar chave de MCP                   |
| `src/modules/integracoes/schemas/chave-mcp.ts`                    | **Criar.** Gerar e resumir chave. Puro                                     |
| `src/modules/integracoes/schemas/chave-mcp.test.ts`               | **Criar.** Formato, unicidade, resumo irreversível                         |
| `src/modules/integracoes/acoes.ts`                                | **Criar.** Ações de formulário das telas                                   |
| `src/modules/integracoes/components/lista-de-integracoes.tsx`     | **Criar.** Os cartões agrupados por categoria                              |
| `src/modules/integracoes/components/formulario-de-integracao.tsx` | **Criar.** Os campos de uma integração                                     |
| `src/modules/integracoes/components/painel-de-mcp.tsx`            | **Criar.** Chaves do MCP: emitir, listar, revogar                          |
| `src/app/(shell)/integracoes/page.tsx`                            | **Criar.** A lista                                                         |
| `src/app/(shell)/integracoes/[chave]/page.tsx`                    | **Criar.** Uma integração                                                  |
| `src/app/(shell)/integracoes/mcp/page.tsx`                        | **Criar.** A aba do MCP                                                    |
| `prisma/schema/integracoes.prisma`                                | **Criar.** `Integracao`, `CampoDeIntegracao`, `ChaveDeMcp`                 |
| `src/registro-de-apps.ts`                                         | **Modificar.** Entra o módulo; muda o subtítulo de Configurações           |
| `.env.example`                                                    | **Modificar.** `TETTEO_CHAVE_MESTRA=` vazia                                |

---

## Task 1: `auditar()` sai de dentro de Configurações

Hoje `auditar()` é função privada de `core/configuracoes/servicos.ts`. O módulo novo precisa dela. Copiar seria perder a regra em duas cópias; extrair é o certo, e Configurações continua idêntica por fora.

**Arquivos:**

- Criar: `src/core/auditoria.ts`
- Modificar: `src/core/configuracoes/servicos.ts` (remover a função privada do fim do arquivo e importar a nova)

**Interfaces:**

- Produz: `auditar(contexto: ContextoSessao, acao: AcaoDeAuditoria, entidade: string, entidadeId: string, antes: unknown, depois: unknown): Promise<void>` e `type AcaoDeAuditoria = "CRIOU" | "ALTEROU" | "EXCLUIU"`

- [ ] **Passo 1: Criar `src/core/auditoria.ts`**

```ts
import type { ContextoSessao } from "@/core/sessao/contexto";
import { db } from "@/server/db";

/**
 * O REGISTRO DE QUEM MUDOU O QUÊ.
 *
 * Nasceu dentro de Configurações e saiu de lá quando o segundo App precisou
 * auditar. Função copiada é regra perdida: a primeira cópia que esquecer de
 * recortar o valor é a que vaza um segredo para a tela de histórico.
 *
 * O que NUNCA entra aqui: senha, chave de API, token. Quem audita um segredo
 * grava o FATO ("chave trocada") e uma pista curta — nunca o valor, nunca o
 * tamanho.
 */
export type AcaoDeAuditoria = "CRIOU" | "ALTEROU" | "EXCLUIU";

export async function auditar(
  contexto: ContextoSessao,
  acao: AcaoDeAuditoria,
  entidade: string,
  entidadeId: string,
  antes: unknown,
  depois: unknown,
): Promise<void> {
  await db.auditoria.create({
    data: {
      organizacaoId: contexto.organizacao.id,
      unidadeId: contexto.unidadeAtiva?.id ?? null,
      usuarioId: contexto.usuario.id,
      entidade,
      entidadeId,
      acao,
      valoresAntes:
        antes === null ? undefined : JSON.parse(JSON.stringify(antes)),
      valoresDepois:
        depois === null ? undefined : JSON.parse(JSON.stringify(depois)),
    },
  });
}
```

- [ ] **Passo 2: Apagar a função privada de `core/configuracoes/servicos.ts`**

Remova o bloco `async function auditar(...) { ... }` do fim do arquivo (é a última função, logo abaixo de `entidadesAuditadas`), junto com nada mais.

- [ ] **Passo 3: Importar a versão extraída**

No topo de `src/core/configuracoes/servicos.ts`, junto dos outros imports de `@/core`:

```ts
import { auditar } from "@/core/auditoria";
```

As doze chamadas existentes a `auditar(...)` não mudam: a assinatura é a mesma.

- [ ] **Passo 4: Provar que nada quebrou**

Run: `npm run check`
Expected: PASS. Não há comportamento novo a testar — é extração pura, e o typecheck é quem prova que as doze chamadas continuam casando.

- [ ] **Passo 5: Commit**

```bash
git add src/core/auditoria.ts src/core/configuracoes/servicos.ts
git commit -m "Core: a auditoria sai de dentro de Configurações"
```

---

## Task 2: A cifra

O coração do cofre, e a única parte que precisa ser provada caso a caso. Recebe a chave por parâmetro em vez de ler o ambiente: é o que a torna testável sem banco e sem variável.

**Arquivos:**

- Criar: `src/server/cofre/cifra.ts`
- Testar: `src/server/cofre/cifra.test.ts`

**Interfaces:**

- Produz: `cifrar(valor: string, chave: Buffer): string`, `decifrar(pacote: string, chave: Buffer): string`, `ultimos4(valor: string): string`, `lerChaveMestra(bruta: string | undefined): Buffer | null`, `VERSAO_DA_CHAVE: number`

- [ ] **Passo 1: Escrever o teste que falha**

Criar `src/server/cofre/cifra.test.ts`:

```ts
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

import { cifrar, decifrar, lerChaveMestra, ultimos4 } from "./cifra";

const CHAVE = randomBytes(32);

test("o que entra cifrado volta igual", () => {
  const pacote = cifrar("sk-abc-123456", CHAVE);
  assert.equal(decifrar(pacote, CHAVE), "sk-abc-123456");
});

test("o valor cifrado não contém o valor original", () => {
  const pacote = cifrar("sk-abc-123456", CHAVE);
  assert.ok(!pacote.includes("sk-abc-123456"));
});

/**
 * A razão de ser do GCM. Sem autenticação, um byte trocado no banco viraria
 * lixo silencioso indo parar dentro de uma chamada de API — e o erro
 * apareceria três camadas adiante, como "credencial inválida".
 */
test("valor adulterado no banco faz a decifra falhar", () => {
  const pacote = cifrar("sk-abc-123456", CHAVE);
  const partes = pacote.split(".");
  const dados = Buffer.from(partes[3], "base64");
  dados[0] = dados[0] ^ 0xff;
  partes[3] = dados.toString("base64");

  assert.throws(() => decifrar(partes.join("."), CHAVE));
});

test("chave errada não decifra", () => {
  const pacote = cifrar("sk-abc-123456", CHAVE);
  assert.throws(() => decifrar(pacote, randomBytes(32)));
});

/**
 * A versão existe para permitir trocar a chave-mestra um dia. Se um valor
 * cifrado com a chave 2 chegar a um sistema que só conhece a 1, o certo é
 * falhar dizendo isso — não tentar e devolver texto torto.
 */
test("versão desconhecida falha com mensagem clara", () => {
  const pacote = cifrar("sk-abc-123456", CHAVE);
  const adulterado = pacote.replace(/^v\d+\./, "v9.");
  assert.throws(() => decifrar(adulterado, CHAVE), /vers/i);
});

test("duas cifras do mesmo valor são diferentes", () => {
  assert.notEqual(cifrar("igual", CHAVE), cifrar("igual", CHAVE));
});

test("ultimos4 mostra quatro caracteres e nada mais", () => {
  assert.equal(ultimos4("sk-abc-123456"), "3456");
  assert.equal(ultimos4("ab"), "ab");
  assert.equal(ultimos4(""), "");
});

test("a chave-mestra precisa ter 32 bytes", () => {
  assert.equal(lerChaveMestra(undefined), null);
  assert.equal(lerChaveMestra(""), null);
  assert.equal(lerChaveMestra(randomBytes(16).toString("base64")), null);
  assert.ok(
    lerChaveMestra(randomBytes(32).toString("base64")) instanceof Buffer,
  );
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL — `Cannot find module './cifra'`.

- [ ] **Passo 3: Escrever a implementação**

Criar `src/server/cofre/cifra.ts`:

```ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * A CIFRA DO COFRE.
 *
 * AES-256-GCM, e o GCM não é detalhe: ele AUTENTICA. Valor adulterado direto
 * no banco faz a decifra falhar, em vez de devolver lixo que seguiria viagem
 * dentro de uma chamada de API e apareceria como erro em outro lugar.
 *
 * A chave vem por PARÂMETRO, não do ambiente. É o que permite provar estas
 * funções sem variável configurada — e o que impede este arquivo de decidir
 * de onde a chave vem, que é assunto de quem chama.
 *
 * O pacote guardado é texto: "v1.<iv>.<etiqueta>.<dados>", tudo em base64. Uma
 * coluna de texto atravessa dump, backup e restauração sem surpresa de
 * codificação — coisa que Bytes já custou caro a este projeto.
 */
export const VERSAO_DA_CHAVE = 1;

const ALGORITMO = "aes-256-gcm";
const TAMANHO_DO_IV = 12;

export function lerChaveMestra(bruta: string | undefined): Buffer | null {
  if (!bruta) return null;
  try {
    const chave = Buffer.from(bruta, "base64");
    // 32 bytes é o que o AES-256 exige. Chave curta não é "menos segura": é
    // erro de configuração, e o certo é o cofre não abrir.
    return chave.length === 32 ? chave : null;
  } catch {
    return null;
  }
}

export function cifrar(valor: string, chave: Buffer): string {
  const iv = randomBytes(TAMANHO_DO_IV);
  const cifrador = createCipheriv(ALGORITMO, chave, iv);
  const dados = Buffer.concat([
    cifrador.update(valor, "utf8"),
    cifrador.final(),
  ]);
  const etiqueta = cifrador.getAuthTag();

  return [
    `v${VERSAO_DA_CHAVE}`,
    iv.toString("base64"),
    etiqueta.toString("base64"),
    dados.toString("base64"),
  ].join(".");
}

export function decifrar(pacote: string, chave: Buffer): string {
  const [versao, iv, etiqueta, dados] = pacote.split(".");

  if (versao !== `v${VERSAO_DA_CHAVE}`) {
    throw new Error(
      `Versão de chave desconhecida (${versao}). Este valor foi cifrado com outra chave-mestra.`,
    );
  }

  const decifrador = createDecipheriv(
    ALGORITMO,
    chave,
    Buffer.from(iv, "base64"),
  );
  decifrador.setAuthTag(Buffer.from(etiqueta, "base64"));

  return Buffer.concat([
    decifrador.update(Buffer.from(dados, "base64")),
    decifrador.final(),
  ]).toString("utf8");
}

/** A pista que a tela mostra. Quatro caracteres não reconstroem nada. */
export function ultimos4(valor: string): string {
  return valor.slice(-4);
}
```

- [ ] **Passo 4: Rodar e ver passar**

Run: `npm test`
Expected: PASS — oito testes de `cifra.test.ts`.

- [ ] **Passo 5: Commit**

```bash
git add src/server/cofre/cifra.ts src/server/cofre/cifra.test.ts
git commit -m "Cofre: a cifra que falha quando mexem no banco"
```

---

## Task 3: A linha de auditoria que não vaza

O teste desta tarefa é o mais importante do módulo inteiro: é a regra mais fácil de quebrar sem ninguém notar.

**Arquivos:**

- Criar: `src/modules/integracoes/schemas/auditoria.ts`
- Testar: `src/modules/integracoes/schemas/auditoria.test.ts`

**Interfaces:**

- Consome: `ultimos4` de `@/server/cofre/cifra`
- Produz: `linhaDeAuditoria(dados: { integracao: string; campo: string; ehSegredo: boolean; valor: string }): Record<string, string>`

- [ ] **Passo 1: Escrever o teste que falha**

Criar `src/modules/integracoes/schemas/auditoria.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { linhaDeAuditoria } from "./auditoria";

const SEGREDO = "sk-live-91827364554637281";

test("o segredo não aparece em lugar nenhum da linha", () => {
  const linha = linhaDeAuditoria({
    integracao: "evolution",
    campo: "apiKey",
    ehSegredo: true,
    valor: SEGREDO,
  });

  const texto = JSON.stringify(linha);
  assert.ok(!texto.includes(SEGREDO), "o valor vazou");
  assert.ok(!texto.includes(SEGREDO.slice(0, 8)), "um pedaço do valor vazou");
});

/**
 * O tamanho também não entra. Saber que a chave tem 43 caracteres estreita a
 * busca de quem for tentar adivinhá-la, e não ajuda ninguém a investigar nada.
 */
test("o tamanho do segredo não aparece", () => {
  const linha = linhaDeAuditoria({
    integracao: "evolution",
    campo: "apiKey",
    ehSegredo: true,
    valor: SEGREDO,
  });

  assert.ok(!JSON.stringify(linha).includes(String(SEGREDO.length)));
});

test("a linha diz o que aconteceu, com a pista curta", () => {
  const linha = linhaDeAuditoria({
    integracao: "evolution",
    campo: "apiKey",
    ehSegredo: true,
    valor: SEGREDO,
  });

  assert.equal(linha.integracao, "evolution");
  assert.equal(linha.campo, "apiKey");
  assert.equal(linha.acao, "chave trocada");
  assert.equal(linha.ultimos4, "7281");
});

/**
 * Endereço e nome de instância não são segredo, e esconder o valor deles
 * tornaria o histórico inútil justamente onde ele mais serve: descobrir que
 * alguém apontou a integração para outro servidor.
 */
test("campo que não é segredo grava o valor", () => {
  const linha = linhaDeAuditoria({
    integracao: "evolution",
    campo: "url",
    ehSegredo: false,
    valor: "http://evolution_api:8080",
  });

  assert.equal(linha.acao, "valor alterado");
  assert.equal(linha.valor, "http://evolution_api:8080");
  assert.equal(linha.ultimos4, undefined);
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL — `Cannot find module './auditoria'`.

- [ ] **Passo 3: Escrever a implementação**

Criar `src/modules/integracoes/schemas/auditoria.ts`:

```ts
import { ultimos4 } from "@/server/cofre/cifra";

/**
 * O QUE O HISTÓRICO GUARDA QUANDO UMA CHAVE MUDA.
 *
 * O precedente é `redefinirSenha`, que audita "senha redefinida" e mais nada.
 * Aqui vale o mesmo: o FATO e uma pista de quatro caracteres — nunca o valor,
 * nunca o tamanho, que estreitaria a adivinhação sem ajudar investigação
 * nenhuma.
 *
 * Campo que não é segredo grava o valor de propósito: descobrir que alguém
 * apontou a Evolution para outro servidor é exatamente para isso que o
 * histórico existe.
 */
export function linhaDeAuditoria(dados: {
  integracao: string;
  campo: string;
  ehSegredo: boolean;
  valor: string;
}): Record<string, string> {
  if (dados.ehSegredo) {
    return {
      integracao: dados.integracao,
      campo: dados.campo,
      acao: "chave trocada",
      ultimos4: ultimos4(dados.valor),
    };
  }

  return {
    integracao: dados.integracao,
    campo: dados.campo,
    acao: "valor alterado",
    valor: dados.valor,
  };
}
```

- [ ] **Passo 4: Rodar e ver passar**

Run: `npm test`
Expected: PASS — quatro testes de `auditoria.test.ts`.

- [ ] **Passo 5: Commit**

```bash
git add src/modules/integracoes/schemas/auditoria.ts src/modules/integracoes/schemas/auditoria.test.ts
git commit -m "Integrações: o histórico que registra a troca sem registrar a chave"
```

---

## Task 4: O catálogo e o estado de cada integração

**Arquivos:**

- Criar: `src/modules/integracoes/catalogo.ts`
- Testar: `src/modules/integracoes/catalogo.test.ts`

**Interfaces:**

- Produz: `INTEGRACOES: DefinicaoDeIntegracao[]`, `acharIntegracao(chave: string): DefinicaoDeIntegracao | null`, `estadoDaIntegracao(entrada): EstadoDeIntegracao`, e os tipos `DefinicaoDeIntegracao`, `CampoDeCatalogo`, `EstadoDeIntegracao`

- [ ] **Passo 1: Escrever o teste que falha**

Criar `src/modules/integracoes/catalogo.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { acharIntegracao, estadoDaIntegracao, INTEGRACOES } from "./catalogo";

test("as chaves do catálogo são únicas", () => {
  const chaves = INTEGRACOES.map((i) => i.chave);
  assert.equal(new Set(chaves).size, chaves.length);
});

test("toda integração tem ao menos um campo", () => {
  for (const integracao of INTEGRACOES) {
    assert.ok(integracao.campos.length > 0, integracao.chave);
  }
});

test("acha pela chave, e devolve nulo para o que não existe", () => {
  assert.equal(acharIntegracao("evolution")?.nome, "Evolution API");
  assert.equal(acharIntegracao("nao-existe"), null);
});

test("falta campo obrigatório preenchido → falta a chave", () => {
  const definicao = acharIntegracao("evolution")!;
  const estado = estadoDaIntegracao({
    definicao,
    preenchidos: ["url"],
    ligada: true,
    ultimoTesteOk: null,
  });
  assert.equal(estado, "falta_chave");
});

test("tudo preenchido e ligada → configurada", () => {
  const definicao = acharIntegracao("evolution")!;
  const estado = estadoDaIntegracao({
    definicao,
    preenchidos: definicao.campos.map((c) => c.chave),
    ligada: true,
    ultimoTesteOk: null,
  });
  assert.equal(estado, "configurada");
});

/**
 * Desligada vence tudo: uma integração que o dono desligou não pode aparecer
 * como "configurada" e deixá-lo achando que está funcionando.
 */
test("desligada vence configurada", () => {
  const definicao = acharIntegracao("evolution")!;
  const estado = estadoDaIntegracao({
    definicao,
    preenchidos: definicao.campos.map((c) => c.chave),
    ligada: false,
    ultimoTesteOk: true,
  });
  assert.equal(estado, "desligada");
});

test("último teste falhou → erro", () => {
  const definicao = acharIntegracao("evolution")!;
  const estado = estadoDaIntegracao({
    definicao,
    preenchidos: definicao.campos.map((c) => c.chave),
    ligada: true,
    ultimoTesteOk: false,
  });
  assert.equal(estado, "erro");
});

/**
 * Campo opcional não pode segurar o estado em "falta a chave" — senão a tela
 * cobra para sempre algo que ninguém precisa preencher.
 */
test("campo opcional vazio não impede estar configurada", () => {
  const definicao = {
    chave: "teste",
    nome: "Teste",
    categoria: "IA" as const,
    escopo: "rede" as const,
    campos: [
      { chave: "a", rotulo: "A", tipo: "texto" as const, obrigatorio: true },
      { chave: "b", rotulo: "B", tipo: "texto" as const, obrigatorio: false },
    ],
  };

  assert.equal(
    estadoDaIntegracao({
      definicao,
      preenchidos: ["a"],
      ligada: true,
      ultimoTesteOk: null,
    }),
    "configurada",
  );
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL — `Cannot find module './catalogo'`.

- [ ] **Passo 3: Escrever a implementação**

Criar `src/modules/integracoes/catalogo.ts`:

```ts
/**
 * O CATÁLOGO DE INTEGRAÇÕES.
 *
 * Declarado em código, e não cadastrado em tela, pelo mesmo motivo que não
 * existe tabela de permissões: cadastro viraria uma cópia desatualizada disto
 * aqui, com alguém sincronizando na mão. Pior — sem declaração o sistema não
 * saberia dizer "falta a chave da Evolution", não saberia testar nada, e um
 * nome digitado torto quebraria a integração em silêncio.
 *
 * A chave é ESTÁVEL e vitalícia: ela é o que liga a linha do banco à
 * definição. Renomear "evolution" órfã o que já foi guardado.
 */
export type CategoriaDeIntegracao =
  | "Pedidos & cardápio"
  | "WhatsApp"
  | "IA"
  | "Fiscal"
  | "Bancos"
  | "Armazenamento"
  | "Outras";

export type CampoDeCatalogo = {
  chave: string;
  rotulo: string;
  /** `segredo` é o que nunca volta para a tela. */
  tipo: "texto" | "url" | "segredo";
  obrigatorio: boolean;
  ajuda?: string;
};

export type DefinicaoDeIntegracao = {
  chave: string;
  nome: string;
  categoria: CategoriaDeIntegracao;
  /** `loja` faz a tela mostrar um cartão por unidade. */
  escopo: "rede" | "loja";
  /** O que aparece embaixo do nome quando falta configurar. */
  consequencia?: string;
  campos: CampoDeCatalogo[];
};

export const INTEGRACOES: DefinicaoDeIntegracao[] = [
  {
    chave: "evolution",
    nome: "Evolution API",
    categoria: "WhatsApp",
    escopo: "rede",
    consequencia: "a Severina não consegue enviar mensagem",
    campos: [
      {
        chave: "url",
        rotulo: "Endereço",
        tipo: "url",
        obrigatorio: true,
        ajuda: "Por dentro do Docker é http://evolution_api:8080",
      },
      {
        chave: "apiKey",
        rotulo: "API Key",
        tipo: "segredo",
        obrigatorio: true,
        ajuda: "Está no painel da Evolution, em Configurações",
      },
      {
        chave: "instancia",
        rotulo: "Instância",
        tipo: "texto",
        obrigatorio: true,
        ajuda: "O nome da instância conectada ao número",
      },
    ],
  },

  {
    chave: "gemini",
    nome: "Gemini",
    categoria: "IA",
    escopo: "rede",
    consequencia: "a Severina escreve seco, sem redator",
    campos: [
      {
        chave: "apiKeys",
        rotulo: "API Keys",
        tipo: "segredo",
        obrigatorio: true,
        ajuda: "Uma ou várias, separadas por vírgula",
      },
      {
        chave: "modelo",
        rotulo: "Modelo",
        tipo: "texto",
        obrigatorio: true,
        ajuda: "O identificador do modelo, como aparece na documentação",
      },
    ],
  },

  {
    chave: "cardapio-web",
    nome: "Cardápio Web",
    categoria: "Pedidos & cardápio",
    escopo: "loja",
    campos: [
      {
        chave: "merchantUuid",
        rotulo: "UUID da loja",
        tipo: "texto",
        obrigatorio: true,
      },
      {
        chave: "token",
        rotulo: "Token de acesso",
        tipo: "segredo",
        obrigatorio: true,
      },
    ],
  },

  {
    chave: "outra",
    nome: "Outra integração",
    categoria: "Outras",
    escopo: "rede",
    consequencia:
      "guardado em cofre; nenhuma parte do sistema consome esta chave automaticamente",
    campos: [
      {
        chave: "nome",
        rotulo: "Nome do serviço",
        tipo: "texto",
        obrigatorio: true,
      },
      { chave: "chave", rotulo: "Chave", tipo: "segredo", obrigatorio: true },
      {
        chave: "segundoValor",
        rotulo: "Segundo valor",
        tipo: "segredo",
        obrigatorio: false,
      },
    ],
  },
];

export function acharIntegracao(chave: string): DefinicaoDeIntegracao | null {
  return INTEGRACOES.find((i) => i.chave === chave) ?? null;
}

export type EstadoDeIntegracao =
  "configurada" | "falta_chave" | "erro" | "desligada";

/**
 * A ordem das perguntas importa. "Desligada" vem primeiro porque uma
 * integração que o dono desligou não pode aparecer como configurada e deixá-lo
 * achando que está funcionando.
 */
export function estadoDaIntegracao(entrada: {
  definicao: DefinicaoDeIntegracao;
  /** As chaves dos campos que têm valor guardado. */
  preenchidos: string[];
  ligada: boolean;
  ultimoTesteOk: boolean | null;
}): EstadoDeIntegracao {
  if (!entrada.ligada) return "desligada";

  const faltando = entrada.definicao.campos
    .filter((c) => c.obrigatorio)
    .some((c) => !entrada.preenchidos.includes(c.chave));

  if (faltando) return "falta_chave";
  if (entrada.ultimoTesteOk === false) return "erro";
  return "configurada";
}
```

- [ ] **Passo 4: Rodar e ver passar**

Run: `npm test`
Expected: PASS — oito testes de `catalogo.test.ts`.

- [ ] **Passo 5: Commit**

```bash
git add src/modules/integracoes/catalogo.ts src/modules/integracoes/catalogo.test.ts
git commit -m "Integrações: o catálogo declarado em código, e o estado de cada uma"
```

---

## Task 5: As tabelas

**Arquivos:**

- Criar: `prisma/schema/integracoes.prisma`
- Criar: `prisma/schema/migrations/<timestamp>_integracoes_cofre/migration.sql` (gerado)

**Interfaces:**

- Produz: os modelos `Integracao`, `CampoDeIntegracao` e `ChaveDeMcp` no client do Prisma

- [ ] **Passo 1: Escrever o arquivo de schema**

Criar `prisma/schema/integracoes.prisma`:

```prisma
// ===========================================================================
// APP: INTEGRAÇÕES — o cofre de chaves
//
// Como os outros Apps, este arquivo não declara `@relation` para
// `Organizacao`, `Unidade` ou `Usuario`: os identificadores são texto simples.
// Se o Core precisasse de uma contra-relação por App instalado, instalar
// módulo novo viraria migração do Kernel.
// ===========================================================================

/// Uma integração ligada, num escopo.
///
/// `unidadeId` guarda "" para "vale para a rede inteira", e NÃO nulo: o
/// Postgres considera dois nulos como diferentes, e a trava de unicidade não
/// valeria justamente no caso mais comum.
model Integracao {
  id            String @id @default(cuid())
  organizacaoId String
  unidadeId     String @default("")

  /// A chave do catálogo: "evolution", "gemini", "cardapio-web"
  chave String

  ligada Boolean @default(true)

  ultimoTesteEm DateTime?
  ultimoTesteOk Boolean?
  ultimoErro    String?

  criadoEm     DateTime  @default(now())
  atualizadoEm DateTime  @updatedAt
  excluidoEm   DateTime?

  campos CampoDeIntegracao[]

  @@unique([organizacaoId, unidadeId, chave])
  @@index([organizacaoId, chave])
  @@map("integracao")
}

/// Um campo de uma integração.
///
/// Segredo mora em `valorCifrado`; o que não é segredo mora em `valor`, em
/// texto, porque esconder o endereço do servidor tornaria o histórico inútil
/// sem proteger nada.
///
/// `versaoDaChave` é sempre 1 hoje e não serve para nada — existe para que
/// trocar a chave-mestra um dia não vire adivinhação sobre o que foi cifrado
/// com qual. Acrescentar agora custa uma linha; depois custa migração.
model CampoDeIntegracao {
  id           String     @id @default(cuid())
  integracaoId String
  integracao   Integracao @relation(fields: [integracaoId], references: [id], onDelete: Cascade)

  campo    String
  ehSegredo Boolean @default(false)

  valor         String?
  valorCifrado  String?
  versaoDaChave Int      @default(1)

  /// Os quatro últimos caracteres — a pista que a tela mostra.
  ultimos4 String?

  atualizadoPorId String?

  criadoEm     DateTime @default(now())
  atualizadoEm DateTime @updatedAt

  @@unique([integracaoId, campo])
  @@map("campo_de_integracao")
}

/// A chave que o TETTEO EMITE para o MCP.
///
/// Guardada como HASH, não cifrada, e a diferença é o ponto: chave que vem de
/// fora precisa ser USADA, então volta a ser legível na hora de chamar o
/// serviço; esta só precisa ser CONFERIDA. Banco vazado não entrega acesso.
///
/// Ela age como a PESSOA que a criou: validar monta o contexto daquele
/// usuário, e o MCP enxerga exatamente o que ele enxergaria na tela.
model ChaveDeMcp {
  id            String @id @default(cuid())
  organizacaoId String
  unidadeId     String @default("")

  nome String

  /// sha-256 do valor entregue uma única vez, na criação.
  resumo String @unique

  ultimos4 String

  criadaPorId String

  ultimoUsoEm DateTime?
  usos        Int       @default(0)

  revogadaEm DateTime?

  criadoEm DateTime @default(now())

  @@index([organizacaoId, revogadaEm])
  @@map("chave_de_mcp")
}
```

- [ ] **Passo 2: Gerar a migração**

Run: `npx prisma migrate dev --name integracoes_cofre`

Expected: cria `prisma/schema/migrations/<timestamp>_integracoes_cofre/migration.sql` e regenera o client.

> **Se não houver Postgres nesta máquina** (é o caso da máquina de desenvolvimento hoje): suba um banco descartável e aponte `DATABASE_URL` para ele antes de rodar, ou gere só o SQL com
> `npx prisma migrate diff --from-migrations prisma/schema/migrations --to-schema-datamodel prisma/schema --shadow-database-url "$DATABASE_URL" --script > migration.sql`
> e crie a pasta da migração à mão. Não invente o SQL: ele precisa sair do Prisma.

- [ ] **Passo 3: Provar que o client enxerga as tabelas**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Passo 4: Commit**

```bash
git add prisma/schema/integracoes.prisma prisma/schema/migrations
git commit -m "Integrações: as três tabelas do cofre"
```

---

## Task 6: O módulo aparece no sistema

**Arquivos:**

- Criar: `src/modules/integracoes/permissoes.ts`
- Criar: `src/modules/integracoes/manifest.ts`
- Modificar: `src/registro-de-apps.ts`
- Modificar: `.env.example`

**Interfaces:**

- Consome: `ManifestoDoApp` de `@/core/registry/tipos`
- Produz: `manifestoIntegracoes`, `PERMISSOES_INTEGRACOES`

- [ ] **Passo 1: As permissões**

Criar `src/modules/integracoes/permissoes.ts`:

```ts
/**
 * O vocabulário das Integrações.
 *
 * Existe separado de `configuracoes.editar` por um motivo concreto: aquela
 * permissão é a mais perigosa do sistema e é ela que cadastra um garçom. Se as
 * chaves morassem lá, cadastrar garçom e trocar a chave de API da rede seriam
 * a mesma permissão.
 *
 * E repare no que NÃO existe aqui: permissão de LER o valor de uma chave. Não
 * é esquecimento — esse caminho não existe no sistema, nem para o Diretor.
 */
export const PERMISSOES_INTEGRACOES = [
  {
    chave: "integracoes.ver",
    descricao: "Ver integrações, estados e os quatro últimos dígitos",
  },
  {
    chave: "integracoes.editar",
    descricao: "Colar e trocar chaves, ligar e desligar integrações",
  },
] as const;
```

- [ ] **Passo 2: O manifesto**

Criar `src/modules/integracoes/manifest.ts`:

```ts
import type { ManifestoDoApp } from "@/core/registry/tipos";

import { PERMISSOES_INTEGRACOES } from "./permissoes";

/**
 * Integrações.
 *
 * O cofre das chaves dos serviços de fora, e a casa do MCP do Tetteo.
 *
 * `emConstrucao` sai daqui quando a primeira chave real estiver guardada e
 * sendo usada — até lá a equipe não vê um módulo que promete guardar e não
 * guarda.
 */
export const manifestoIntegracoes: ManifestoDoApp = {
  chave: "integracoes",
  nome: "Integrações",
  subtitulo: "Chaves & conexões",
  icone: "cadeado",
  cor: { fundo: "#0F766E", frente: "#FFFFFF" },
  area: "apoio",
  rota: "/integracoes",
  navegacao: [
    { rota: "/integracoes", nome: "Integrações" },
    { rota: "/integracoes/mcp", nome: "MCP do Tetteo" },
  ],
  permissaoParaVer: "integracoes.ver",
  permissoes: [...PERMISSOES_INTEGRACOES],
  comportamentoNaRede: "consolida",
  emConstrucao: true,
};
```

- [ ] **Passo 3: Registrar, e fechar a porta duplicada**

Em `src/registro-de-apps.ts`:

```ts
import { manifestoIntegracoes } from "@/modules/integracoes/manifest";
```

Acrescente `manifestoIntegracoes,` na lista `APPS_REGISTRADOS`, logo depois de `manifestoSeverina,`.

E no manifesto de Configurações, no fim do mesmo arquivo, troque o subtítulo:

```ts
    subtitulo: "Usuários & permissões",
```

O subtítulo antigo era "Integrações & usuários". Ele passaria a prometer o que não está mais lá, e duas portas para a mesma coisa é o erro que este projeto documenta ter duplicado trinta produtos no sistema antigo.

- [ ] **Passo 4: A variável nova**

Em `.env.example`, junto das outras, acrescente a linha **vazia**:

```
# 32 bytes em base64. Sem ela, o cofre abre trancado e recusa salvar segredo.
TETTEO_CHAVE_MESTRA=
```

- [ ] **Passo 5: Provar**

Run: `npm run check`
Expected: PASS.

- [ ] **Passo 6: Commit**

```bash
git add src/modules/integracoes src/registro-de-apps.ts .env.example
git commit -m "Integrações: o módulo entra no painel, e Configurações para de prometer integração"
```

---

## Task 7: A ordem de leitura, e o `segredo()`

**Arquivos:**

- Criar: `src/server/cofre/ordem.ts`
- Testar: `src/server/cofre/ordem.test.ts`
- Criar: `src/server/cofre/index.ts`

**Interfaces:**

- Consome: `decifrar`, `lerChaveMestra` de `./cifra`
- Produz: `escolherValor(doCofre: string | null, doAmbiente: string | undefined): string | null` e `segredo(entrada: { organizacaoId: string; integracao: string; campo: string; unidadeId?: string; variavelDeAmbiente?: string }): Promise<string | null>`, `limparCacheDoCofre(): void`

- [ ] **Passo 1: Escrever o teste que falha**

Criar `src/server/cofre/ordem.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { escolherValor } from "./ordem";

/**
 * Esta ordem é a rede de segurança da migração: no dia em que o cofre entrar,
 * Evolution, Gemini e o relógio continuam funcionando pelo ambiente, e cada
 * chave migra quando for colada na tela.
 */
test("o cofre vence o ambiente", () => {
  assert.equal(escolherValor("do-cofre", "do-ambiente"), "do-cofre");
});

test("sem nada no cofre, usa o ambiente", () => {
  assert.equal(escolherValor(null, "do-ambiente"), "do-ambiente");
});

test("sem nada em lugar nenhum, devolve nulo", () => {
  assert.equal(escolherValor(null, undefined), null);
});

/**
 * Valor em branco não é valor. Uma variável declarada e vazia no Dokploy
 * ganharia da chave guardada, e a integração pararia sem ninguém entender.
 */
test("valor em branco não conta como preenchido", () => {
  assert.equal(escolherValor("", "do-ambiente"), "do-ambiente");
  assert.equal(escolherValor(null, "   "), null);
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL — `Cannot find module './ordem'`.

- [ ] **Passo 3: Escrever a regra pura**

Criar `src/server/cofre/ordem.ts`:

```ts
/**
 * QUEM GANHA QUANDO OS DOIS EXISTEM.
 *
 * Mora numa função pura porque é a regra que sustenta a migração inteira, e
 * regra de migração é onde ninguém olha de novo depois que "funcionou".
 */
export function escolherValor(
  doCofre: string | null,
  doAmbiente: string | undefined,
): string | null {
  if (doCofre && doCofre.trim()) return doCofre;
  if (doAmbiente && doAmbiente.trim()) return doAmbiente;
  return null;
}
```

- [ ] **Passo 4: Rodar e ver passar**

Run: `npm test`
Expected: PASS — quatro testes de `ordem.test.ts`.

- [ ] **Passo 5: Escrever a leitura do cofre**

Criar `src/server/cofre/index.ts`:

```ts
import "server-only";

import { db } from "@/server/db";

import { decifrar, lerChaveMestra } from "./cifra";
import { escolherValor } from "./ordem";

/**
 * A PORTA DE LEITURA DO COFRE.
 *
 * Mora em `server/` porque é a única camada que módulo E conector alcançam —
 * `core/` não é alcançável pelo conector, e `modules/` não é alcançável por
 * ninguém de fora. E, justamente por não enxergar o Core, esta camada NÃO
 * verifica permissão: quem verifica é o serviço do módulo, do mesmo jeito que
 * o `db.ts` não verifica nada.
 *
 * A ordem é cofre, depois ambiente. É o que faz o dia da migração não quebrar
 * nada.
 */
const VALIDADE_DO_CACHE_MS = 60_000;

const cache = new Map<string, { valor: string | null; ate: number }>();

/** Chamado quando alguém salva uma chave nova — senão a tela mente por um minuto. */
export function limparCacheDoCofre(): void {
  cache.clear();
}

export async function segredo(entrada: {
  organizacaoId: string;
  integracao: string;
  campo: string;
  /** Vazio = a linha da rede. */
  unidadeId?: string;
  /** O nome da variável antiga, para a reserva durante a migração. */
  variavelDeAmbiente?: string;
}): Promise<string | null> {
  const unidadeId = entrada.unidadeId ?? "";
  const memoria = `${entrada.organizacaoId}:${unidadeId}:${entrada.integracao}:${entrada.campo}`;

  const guardado = cache.get(memoria);
  if (guardado && guardado.ate > Date.now()) return guardado.valor;

  const doAmbiente = entrada.variavelDeAmbiente
    ? process.env[entrada.variavelDeAmbiente]
    : undefined;

  const linha = await db.campoDeIntegracao.findFirst({
    where: {
      campo: entrada.campo,
      integracao: {
        organizacaoId: entrada.organizacaoId,
        unidadeId,
        chave: entrada.integracao,
        ligada: true,
        excluidoEm: null,
      },
    },
    select: { valor: true, valorCifrado: true },
  });

  let doCofre: string | null = linha?.valor ?? null;

  if (linha?.valorCifrado) {
    const chave = lerChaveMestra(process.env.TETTEO_CHAVE_MESTRA);
    // Sem chave-mestra o cofre está TRANCADO. Cair para o ambiente aqui seria
    // a falha silenciosa: a integração passaria a usar uma chave antiga sem
    // ninguém saber que a nova ficou ilegível.
    if (!chave) {
      throw new Error(
        "O cofre está trancado: falta a chave-mestra no servidor (TETTEO_CHAVE_MESTRA).",
      );
    }
    doCofre = decifrar(linha.valorCifrado, chave);
  }

  const valor = escolherValor(doCofre, doAmbiente);
  cache.set(memoria, { valor, ate: Date.now() + VALIDADE_DO_CACHE_MS });
  return valor;
}
```

- [ ] **Passo 6: Provar**

Run: `npm run check`
Expected: PASS.

- [ ] **Passo 7: Commit**

```bash
git add src/server/cofre/ordem.ts src/server/cofre/ordem.test.ts src/server/cofre/index.ts
git commit -m "Cofre: a leitura que cai para o ambiente no dia da migração"
```

---

## Task 8: Os serviços do módulo

**Arquivos:**

- Criar: `src/modules/integracoes/services/integracoes.ts`

**Interfaces:**

- Consome: `pode`, `ContextoSessao` de `@/core/sessao/contexto`; `auditar` de `@/core/auditoria`; `cifrar`, `ultimos4`, `lerChaveMestra`, `VERSAO_DA_CHAVE` de `@/server/cofre/cifra`; `limparCacheDoCofre` de `@/server/cofre`; `linhaDeAuditoria` de `../schemas/auditoria`; `INTEGRACOES`, `acharIntegracao`, `estadoDaIntegracao` de `../catalogo`
- Produz: `listarIntegracoes(contexto)`, `obterIntegracao(contexto, chave, unidadeId)`, `salvarCampos(contexto, entrada)`, `alternarIntegracao(contexto, chave, unidadeId)`, `cofreDestrancado(): boolean`

- [ ] **Passo 1: Escrever o serviço**

Criar `src/modules/integracoes/services/integracoes.ts`:

```ts
import { auditar } from "@/core/auditoria";
import { pode, type ContextoSessao } from "@/core/sessao/contexto";
import { SemPermissao } from "@/lib/erros";
import { limparCacheDoCofre } from "@/server/cofre";
import {
  cifrar,
  lerChaveMestra,
  ultimos4,
  VERSAO_DA_CHAVE,
} from "@/server/cofre/cifra";
import { db } from "@/server/db";

import {
  acharIntegracao,
  estadoDaIntegracao,
  INTEGRACOES,
  type EstadoDeIntegracao,
} from "../catalogo";
import { linhaDeAuditoria } from "../schemas/auditoria";

/**
 * AS REGRAS DO COFRE.
 *
 * Esta camada existe para fazer o que `server/cofre` não pode: verificar
 * permissão. Lá embaixo não há Core para consultar — é a mesma divisão que o
 * `db.ts` já tem, e é de propósito.
 *
 * A regra que atravessa o arquivo inteiro: NADA aqui devolve o valor de um
 * segredo. As funções de leitura entregam `ultimos4` e mais nada, e não existe
 * função de "ver a chave" para ser chamada por engano.
 */

function exigirVer(contexto: ContextoSessao) {
  if (!pode(contexto, "integracoes.ver")) {
    throw new SemPermissao("ver as integrações");
  }
}

function exigirEditar(contexto: ContextoSessao) {
  if (!pode(contexto, "integracoes.editar")) {
    throw new SemPermissao("alterar as chaves das integrações");
  }
}

/** Sem chave-mestra a tela lista e mostra estados, mas recusa salvar segredo. */
export function cofreDestrancado(): boolean {
  return lerChaveMestra(process.env.TETTEO_CHAVE_MESTRA) !== null;
}

export type IntegracaoNaLista = {
  chave: string;
  nome: string;
  categoria: string;
  escopo: "rede" | "loja";
  unidadeId: string;
  unidadeNome: string | null;
  estado: EstadoDeIntegracao;
  consequencia: string | null;
  atualizadaEm: Date | null;
};

export async function listarIntegracoes(
  contexto: ContextoSessao,
): Promise<IntegracaoNaLista[]> {
  exigirVer(contexto);

  const [linhas, unidades] = await Promise.all([
    db.integracao.findMany({
      where: { organizacaoId: contexto.organizacao.id, excluidoEm: null },
      include: { campos: { select: { campo: true, atualizadoEm: true } } },
    }),
    db.unidade.findMany({
      where: { organizacaoId: contexto.organizacao.id, excluidoEm: null },
      select: { id: true, nome: true },
    }),
  ]);

  const nomeDaUnidade = new Map(unidades.map((u) => [u.id, u.nome]));
  const guardadas = new Map(
    linhas.map((l) => [`${l.chave}:${l.unidadeId}`, l]),
  );

  const lista: IntegracaoNaLista[] = [];

  for (const definicao of INTEGRACOES) {
    // Integração por loja aparece uma vez por unidade: duas pizzarias
    // dividirem uma credencial só é errado na raiz.
    const escopos =
      definicao.escopo === "loja" ? unidades.map((u) => u.id) : [""];

    for (const unidadeId of escopos) {
      const guardada = guardadas.get(`${definicao.chave}:${unidadeId}`);
      const preenchidos = (guardada?.campos ?? [])
        .map((c) => c.campo)
        .filter(Boolean);

      lista.push({
        chave: definicao.chave,
        nome: definicao.nome,
        categoria: definicao.categoria,
        escopo: definicao.escopo,
        unidadeId,
        unidadeNome: unidadeId ? (nomeDaUnidade.get(unidadeId) ?? null) : null,
        estado: estadoDaIntegracao({
          definicao,
          preenchidos,
          ligada: guardada?.ligada ?? true,
          ultimoTesteOk: guardada?.ultimoTesteOk ?? null,
        }),
        consequencia: definicao.consequencia ?? null,
        atualizadaEm: guardada?.atualizadoEm ?? null,
      });
    }
  }

  return lista;
}

export type CampoNaTela = {
  chave: string;
  rotulo: string;
  tipo: "texto" | "url" | "segredo";
  obrigatorio: boolean;
  ajuda: string | null;
  /** Só para quem NÃO é segredo. Segredo nunca volta. */
  valor: string | null;
  /** A pista. Vazio quando nunca foi preenchido. */
  ultimos4: string | null;
};

export async function obterIntegracao(
  contexto: ContextoSessao,
  chave: string,
  unidadeId = "",
) {
  exigirVer(contexto);

  const definicao = acharIntegracao(chave);
  if (!definicao) return null;

  const guardada = await db.integracao.findFirst({
    where: {
      organizacaoId: contexto.organizacao.id,
      unidadeId,
      chave,
      excluidoEm: null,
    },
    include: { campos: true },
  });

  const porCampo = new Map((guardada?.campos ?? []).map((c) => [c.campo, c]));

  const campos: CampoNaTela[] = definicao.campos.map((c) => {
    const guardado = porCampo.get(c.chave);
    return {
      chave: c.chave,
      rotulo: c.rotulo,
      tipo: c.tipo,
      obrigatorio: c.obrigatorio,
      ajuda: c.ajuda ?? null,
      valor: c.tipo === "segredo" ? null : (guardado?.valor ?? null),
      ultimos4: guardado?.ultimos4 ?? null,
    };
  });

  return {
    chave: definicao.chave,
    nome: definicao.nome,
    escopo: definicao.escopo,
    unidadeId,
    ligada: guardada?.ligada ?? true,
    ultimoTesteEm: guardada?.ultimoTesteEm ?? null,
    ultimoTesteOk: guardada?.ultimoTesteOk ?? null,
    ultimoErro: guardada?.ultimoErro ?? null,
    campos,
  };
}

/**
 * Grava os campos que vieram preenchidos.
 *
 * CAMPO VAZIO SIGNIFICA "NÃO MEXER", e isso não é conveniência: é o que
 * permite a tela nunca pré-preencher um segredo. Pré-preencher exigiria mandar
 * o valor ao navegador, e aí bastaria abrir o inspetor para lê-lo.
 */
export async function salvarCampos(
  contexto: ContextoSessao,
  entrada: {
    chave: string;
    unidadeId?: string;
    valores: Record<string, string>;
  },
) {
  exigirEditar(contexto);

  const definicao = acharIntegracao(entrada.chave);
  if (!definicao) throw new Error("Integração não encontrada.");

  const unidadeId = entrada.unidadeId ?? "";
  const chaveMestra = lerChaveMestra(process.env.TETTEO_CHAVE_MESTRA);

  const temSegredoNovo = definicao.campos.some(
    (c) => c.tipo === "segredo" && (entrada.valores[c.chave] ?? "").trim(),
  );
  if (temSegredoNovo && !chaveMestra) {
    throw new Error(
      "O cofre está trancado: falta a chave-mestra no servidor (TETTEO_CHAVE_MESTRA).",
    );
  }

  const integracao = await db.integracao.upsert({
    where: {
      organizacaoId_unidadeId_chave: {
        organizacaoId: contexto.organizacao.id,
        unidadeId,
        chave: entrada.chave,
      },
    },
    create: {
      organizacaoId: contexto.organizacao.id,
      unidadeId,
      chave: entrada.chave,
    },
    update: {},
    select: { id: true },
  });

  for (const campo of definicao.campos) {
    const valor = (entrada.valores[campo.chave] ?? "").trim();
    if (!valor) continue;

    const ehSegredo = campo.tipo === "segredo";

    await db.campoDeIntegracao.upsert({
      where: {
        integracaoId_campo: { integracaoId: integracao.id, campo: campo.chave },
      },
      create: {
        integracaoId: integracao.id,
        campo: campo.chave,
        ehSegredo,
        valor: ehSegredo ? null : valor,
        valorCifrado: ehSegredo ? cifrar(valor, chaveMestra!) : null,
        versaoDaChave: VERSAO_DA_CHAVE,
        ultimos4: ultimos4(valor),
        atualizadoPorId: contexto.usuario.id,
      },
      update: {
        ehSegredo,
        valor: ehSegredo ? null : valor,
        valorCifrado: ehSegredo ? cifrar(valor, chaveMestra!) : null,
        versaoDaChave: VERSAO_DA_CHAVE,
        ultimos4: ultimos4(valor),
        atualizadoPorId: contexto.usuario.id,
      },
    });

    await auditar(
      contexto,
      "ALTEROU",
      "Integracao",
      integracao.id,
      null,
      linhaDeAuditoria({
        integracao: entrada.chave,
        campo: campo.chave,
        ehSegredo,
        valor,
      }),
    );
  }

  // A tela mentiria por um minuto sem isto.
  limparCacheDoCofre();
}

export async function alternarIntegracao(
  contexto: ContextoSessao,
  chave: string,
  unidadeId = "",
) {
  exigirEditar(contexto);

  const guardada = await db.integracao.findFirst({
    where: {
      organizacaoId: contexto.organizacao.id,
      unidadeId,
      chave,
      excluidoEm: null,
    },
    select: { id: true, ligada: true },
  });
  if (!guardada) throw new Error("Integração não encontrada.");

  await db.integracao.update({
    where: { id: guardada.id },
    data: { ligada: !guardada.ligada },
  });

  await auditar(
    contexto,
    "ALTEROU",
    "Integracao",
    guardada.id,
    { ligada: guardada.ligada },
    { ligada: !guardada.ligada },
  );

  limparCacheDoCofre();
}
```

- [ ] **Passo 2: Provar**

Run: `npm run check`
Expected: PASS.

- [ ] **Passo 3: Commit**

```bash
git add src/modules/integracoes/services/integracoes.ts
git commit -m "Integrações: os serviços do cofre, com permissão e histórico"
```

---

## Task 9: As telas

**Arquivos:**

- Criar: `src/modules/integracoes/acoes.ts`
- Criar: `src/modules/integracoes/components/lista-de-integracoes.tsx`
- Criar: `src/modules/integracoes/components/formulario-de-integracao.tsx`
- Criar: `src/app/(shell)/integracoes/page.tsx`
- Criar: `src/app/(shell)/integracoes/[chave]/page.tsx`

**Interfaces:**

- Consome: `listarIntegracoes`, `obterIntegracao`, `salvarCampos`, `alternarIntegracao`, `cofreDestrancado` da Task 8
- Produz: as rotas `/integracoes` e `/integracoes/<chave>`

- [ ] **Passo 1: As ações**

Criar `src/modules/integracoes/acoes.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { obterContexto } from "@/core/sessao/contexto";
import { SemPermissao } from "@/lib/erros";

import { acharIntegracao } from "./catalogo";
import { alternarIntegracao, salvarCampos } from "./services/integracoes";

export type EstadoFormulario = { erro?: string; ok?: boolean };

export async function salvarIntegracaoAcao(
  _anterior: EstadoFormulario,
  dados: FormData,
): Promise<EstadoFormulario> {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const chave = String(dados.get("chave") ?? "");
  const unidadeId = String(dados.get("unidadeId") ?? "");
  const definicao = acharIntegracao(chave);
  if (!definicao) return { erro: "Integração não encontrada." };

  const valores: Record<string, string> = {};
  for (const campo of definicao.campos) {
    valores[campo.chave] = String(dados.get(campo.chave) ?? "");
  }

  try {
    await salvarCampos(contexto, { chave, unidadeId, valores });
  } catch (erro) {
    if (erro instanceof SemPermissao) return { erro: erro.message };
    if (erro instanceof Error) return { erro: erro.message };
    throw erro;
  }

  revalidatePath("/integracoes");
  revalidatePath(`/integracoes/${chave}`);
  return { ok: true };
}

export async function alternarIntegracaoAcao(dados: FormData) {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const chave = String(dados.get("chave") ?? "");
  const unidadeId = String(dados.get("unidadeId") ?? "");
  if (!chave) return;

  await alternarIntegracao(contexto, chave, unidadeId);
  revalidatePath("/integracoes");
  revalidatePath(`/integracoes/${chave}`);
}
```

- [ ] **Passo 2: A lista**

Criar `src/modules/integracoes/components/lista-de-integracoes.tsx`:

```tsx
import Link from "next/link";

import { Cartao } from "@/design-system/cartao";
import { Etiqueta } from "@/design-system/etiqueta";
import type { IntegracaoNaLista } from "@/modules/integracoes/services/integracoes";

/**
 * Quatro estados, e cada um diz o que fazer.
 *
 * "Configurada" significa TEM CHAVE, não "está no ar" — por isso a data do
 * último toque fica ao lado: a tela não pode prometer o que não sabe.
 */
const ROTULOS: Record<IntegracaoNaLista["estado"], string> = {
  configurada: "Configurada",
  falta_chave: "Falta a chave",
  erro: "Erro na última checagem",
  desligada: "Desligada",
};

/** Os tons são os que a Etiqueta declara: ok, aviso, ruim, neutro. */
const TONS: Record<
  IntegracaoNaLista["estado"],
  "ok" | "aviso" | "ruim" | "neutro"
> = {
  configurada: "ok",
  falta_chave: "aviso",
  erro: "ruim",
  desligada: "neutro",
};

export function ListaDeIntegracoes({ itens }: { itens: IntegracaoNaLista[] }) {
  const categorias = [...new Set(itens.map((i) => i.categoria))];

  return (
    <div className="flex flex-col gap-8">
      {categorias.map((categoria) => (
        <section key={categoria}>
          <h2 className="text-ink-3 text-xs font-semibold tracking-wide uppercase">
            {categoria}
          </h2>

          <div className="mt-3 flex flex-col gap-3">
            {itens
              .filter((i) => i.categoria === categoria)
              .map((item) => (
                <Link
                  key={`${item.chave}:${item.unidadeId}`}
                  href={`/integracoes/${item.chave}?unidade=${item.unidadeId}`}
                  className="block"
                >
                  <Cartao className="p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="font-semibold">
                          {item.nome}
                          {item.unidadeNome ? ` · ${item.unidadeNome}` : ""}
                        </p>
                        <p className="text-ink-3 mt-0.5 text-sm">
                          {item.estado === "configurada" && item.atualizadaEm
                            ? `atualizada em ${item.atualizadaEm.toLocaleDateString("pt-BR")}`
                            : (item.consequencia ?? "")}
                        </p>
                      </div>

                      <Etiqueta tom={TONS[item.estado]}>
                        {ROTULOS[item.estado]}
                      </Etiqueta>
                    </div>
                  </Cartao>
                </Link>
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}
```

> `Cartao` não traz espaçamento interno de propósito (quem decide é quem usa), por isso o `p-4`. E `Etiqueta` sempre desenha ponto **e** palavra — nunca só cor: oito por cento dos homens não distinguem vermelho de verde, e o README do componente explica isso.

- [ ] **Passo 3: O formulário de uma integração**

Criar `src/modules/integracoes/components/formulario-de-integracao.tsx`:

```tsx
"use client";

import { useActionState } from "react";

import { Botao } from "@/design-system/botao";
import { Campo } from "@/design-system/campo";
import {
  salvarIntegracaoAcao,
  type EstadoFormulario,
} from "@/modules/integracoes/acoes";
// `import type` e nunca import comum: o serviço fala com o banco, e um import
// de valor arrastaria o Prisma inteiro para dentro do navegador. O tipo some
// na compilação; o código não vai junto.
import type { CampoNaTela } from "@/modules/integracoes/services/integracoes";

/**
 * CAMPO DE SEGREDO ABRE VAZIO, SEMPRE.
 *
 * Pré-preencher exigiria mandar o valor ao navegador, e aí bastaria abrir o
 * inspetor para lê-lo. O que aparece é a pista (••••4f2a) como texto de dica,
 * e deixar em branco mantém o que já está guardado.
 */
export function FormularioDeIntegracao({
  chave,
  unidadeId,
  campos,
  podeEditar,
  destrancado,
}: {
  chave: string;
  unidadeId: string;
  campos: CampoNaTela[];
  podeEditar: boolean;
  destrancado: boolean;
}) {
  const [estado, acao, enviando] = useActionState<EstadoFormulario, FormData>(
    salvarIntegracaoAcao,
    {},
  );

  return (
    <form action={acao} className="flex max-w-xl flex-col gap-4">
      <input type="hidden" name="chave" value={chave} />
      <input type="hidden" name="unidadeId" value={unidadeId} />

      {!destrancado && (
        <p className="border-bad text-bad rounded-md border border-dashed p-3 text-sm">
          O cofre está trancado: falta a chave-mestra no servidor. Dá para ver,
          não dá para salvar chave nova.
        </p>
      )}

      {campos.map((campo) => (
        <Campo
          key={campo.chave}
          name={campo.chave}
          rotulo={campo.rotulo}
          type={campo.tipo === "segredo" ? "password" : "text"}
          autoComplete="off"
          defaultValue={campo.tipo === "segredo" ? "" : (campo.valor ?? "")}
          placeholder={
            campo.tipo === "segredo" && campo.ultimos4
              ? `••••••${campo.ultimos4}`
              : undefined
          }
          disabled={!podeEditar || (campo.tipo === "segredo" && !destrancado)}
          ajuda={
            campo.tipo === "segredo" && campo.ultimos4
              ? "Deixe em branco para manter a chave atual."
              : (campo.ajuda ?? undefined)
          }
        />
      ))}

      {estado.erro && <p className="text-bad text-sm">{estado.erro}</p>}
      {estado.ok && <p className="text-ink-3 text-sm">Guardado.</p>}

      {podeEditar && (
        <div>
          <Botao type="submit" carregando={enviando}>
            Salvar
          </Botao>
        </div>
      )}
    </form>
  );
}
```

- [ ] **Passo 4: As páginas**

Criar `src/app/(shell)/integracoes/page.tsx`:

```tsx
import { redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { ListaDeIntegracoes } from "@/modules/integracoes/components/lista-de-integracoes";
import { listarIntegracoes } from "@/modules/integracoes/services/integracoes";

export default async function PaginaIntegracoes() {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");
  if (!pode(contexto, "integracoes.ver")) redirect("/");

  const itens = await listarIntegracoes(contexto);

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Integrações</h1>
        <p className="text-ink-3 mt-1 text-sm">
          As chaves dos serviços que o Tetteo usa — guardadas, nunca mostradas
        </p>
      </div>

      <div className="mt-6">
        <ListaDeIntegracoes itens={itens} />
      </div>

      {/*
        Histórico não ganha aba aqui: ele já existe em Configurações, e duas
        telas de histórico seria a mesma porta duplicada que o subtítulo antigo
        criava.
      */}
      <p className="text-ink-3 mt-8 text-sm">
        Quem trocou o quê fica em{" "}
        <Link href="/configuracoes/auditoria" className="underline">
          Configurações › Histórico
        </Link>
        .
      </p>
    </div>
  );
}
```

O `Link` vem de `next/link` — acrescente o import no topo da página.

Criar `src/app/(shell)/integracoes/[chave]/page.tsx`:

```tsx
import { redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { alternarIntegracaoAcao } from "@/modules/integracoes/acoes";
import { FormularioDeIntegracao } from "@/modules/integracoes/components/formulario-de-integracao";
import {
  cofreDestrancado,
  obterIntegracao,
} from "@/modules/integracoes/services/integracoes";

export default async function PaginaDaIntegracao({
  params,
  searchParams,
}: {
  params: Promise<{ chave: string }>;
  searchParams: Promise<{ unidade?: string }>;
}) {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");
  if (!pode(contexto, "integracoes.ver")) redirect("/");

  const { chave } = await params;
  const { unidade } = await searchParams;

  const integracao = await obterIntegracao(contexto, chave, unidade ?? "");
  if (!integracao) redirect("/integracoes");

  return (
    <div className="mx-auto w-full max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight">
        {integracao.nome}
      </h1>

      <div className="mt-6">
        <FormularioDeIntegracao
          chave={integracao.chave}
          unidadeId={integracao.unidadeId}
          campos={integracao.campos}
          podeEditar={pode(contexto, "integracoes.editar")}
          destrancado={cofreDestrancado()}
        />
      </div>

      {pode(contexto, "integracoes.editar") && (
        <form action={alternarIntegracaoAcao} className="mt-8">
          <input type="hidden" name="chave" value={integracao.chave} />
          <input type="hidden" name="unidadeId" value={integracao.unidadeId} />
          <button type="submit" className="text-ink-3 text-sm underline">
            {integracao.ligada ? "Desligar integração" : "Ligar integração"}
          </button>
        </form>
      )}
    </div>
  );
}
```

> `params` e `searchParams` são **promessas** nesta versão do Next — é uma das quebras de convenção que o `AGENTS.md` avisa. Não tire o `await`.

- [ ] **Passo 5: Provar na tela**

Run: `npm run dev` e abra `/integracoes` como Diretor.
Expected: os cartões aparecem agrupados por categoria; abrir "Evolution API" mostra três campos, com o de API Key vazio; salvar uma chave qualquer e voltar mostra `••••` com os quatro últimos, **nunca o valor**.

Confira também em Configurações › Histórico: a linha diz "chave trocada" e os quatro dígitos.

- [ ] **Passo 6: `npm run check` e commit**

```bash
npm run check
git add src/modules/integracoes "src/app/(shell)/integracoes"
git commit -m "Integrações: a tela onde a chave entra e não volta"
```

---

## Task 10: A casa do MCP

**Arquivos:**

- Criar: `src/modules/integracoes/schemas/chave-mcp.ts`
- Testar: `src/modules/integracoes/schemas/chave-mcp.test.ts`
- Criar: `src/modules/integracoes/services/mcp.ts`
- Criar: `src/modules/integracoes/components/painel-de-mcp.tsx`
- Criar: `src/app/(shell)/integracoes/mcp/page.tsx`
- Modificar: `src/modules/integracoes/acoes.ts` (duas ações novas)

**Interfaces:**

- Produz: `gerarChaveDeMcp(): string`, `resumoDaChave(chave: string): string`, `emitirChaveDeMcp(contexto, nome, unidadeId)`, `listarChavesDeMcp(contexto)`, `revogarChaveDeMcp(contexto, id)`, `validarChaveDeMcp(chave: string): Promise<ContextoSessao | null>`

- [ ] **Passo 1: Escrever o teste que falha**

Criar `src/modules/integracoes/schemas/chave-mcp.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { gerarChaveDeMcp, resumoDaChave } from "./chave-mcp";

test("a chave tem prefixo reconhecível e tamanho suficiente", () => {
  const chave = gerarChaveDeMcp();
  assert.ok(chave.startsWith("tetteo_"), chave);
  assert.ok(chave.length >= 40, "chave curta é chave adivinhável");
});

test("duas chaves nunca são iguais", () => {
  const chaves = new Set(Array.from({ length: 200 }, () => gerarChaveDeMcp()));
  assert.equal(chaves.size, 200);
});

/**
 * O resumo é o que vai para o banco. Se ele contivesse a chave, guardar o
 * resumo seria guardar a chave — e o banco vazado entregaria acesso.
 */
test("o resumo não contém a chave e é estável", () => {
  const chave = gerarChaveDeMcp();
  const resumo = resumoDaChave(chave);

  assert.ok(!resumo.includes(chave));
  assert.equal(resumo, resumoDaChave(chave));
  assert.notEqual(resumo, resumoDaChave(gerarChaveDeMcp()));
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL — `Cannot find module './chave-mcp'`.

- [ ] **Passo 3: Escrever a implementação**

Criar `src/modules/integracoes/schemas/chave-mcp.ts`:

```ts
import { createHash, randomBytes } from "node:crypto";

/**
 * A CHAVE QUE O TETTEO EMITE.
 *
 * Aqui a direção é o contrário do resto do módulo: não guardamos um segredo de
 * terceiro para usar depois — nós emitimos um, e só precisamos CONFERIR se o
 * que chegou é ele. Conferir sem guardar é exatamente o que um resumo faz, e é
 * por isso que esta chave é guardada como hash e não cifrada. Banco vazado não
 * entrega acesso.
 *
 * O prefixo existe para ser reconhecível: chave vazada num log ou num print é
 * identificada de longe, e dá para revogar sem descobrir de qual sistema era.
 */
export function gerarChaveDeMcp(): string {
  return `tetteo_${randomBytes(32).toString("base64url")}`;
}

export function resumoDaChave(chave: string): string {
  return createHash("sha256").update(chave).digest("hex");
}
```

- [ ] **Passo 4: Rodar e ver passar**

Run: `npm test`
Expected: PASS — três testes de `chave-mcp.test.ts`.

- [ ] **Passo 5: O serviço**

Criar `src/modules/integracoes/services/mcp.ts`:

```ts
import { auditar } from "@/core/auditoria";
import {
  contextoDeFundo,
  pode,
  type ContextoSessao,
} from "@/core/sessao/contexto";
import { SemPermissao } from "@/lib/erros";
import { db } from "@/server/db";

import { ultimos4 } from "@/server/cofre/cifra";

import { gerarChaveDeMcp, resumoDaChave } from "../schemas/chave-mcp";

/**
 * AS CHAVES DO MCP DO TETTEO.
 *
 * O servidor MCP em si não mora aqui — está sendo construído à parte. Esta é a
 * casa dele: emitir, listar, revogar, e a função que ele chama para saber quem
 * está do outro lado.
 */

export async function emitirChaveDeMcp(
  contexto: ContextoSessao,
  nome: string,
  unidadeId = "",
): Promise<{ chave: string }> {
  if (!pode(contexto, "integracoes.editar")) {
    throw new SemPermissao("emitir chaves do MCP");
  }

  const chave = gerarChaveDeMcp();

  const linha = await db.chaveDeMcp.create({
    data: {
      organizacaoId: contexto.organizacao.id,
      unidadeId,
      nome,
      resumo: resumoDaChave(chave),
      ultimos4: ultimos4(chave),
      criadaPorId: contexto.usuario.id,
    },
    select: { id: true },
  });

  await auditar(contexto, "CRIOU", "ChaveDeMcp", linha.id, null, {
    nome,
    acao: "chave de MCP emitida",
    ultimos4: ultimos4(chave),
  });

  // A ÚNICA vez que o valor existe fora do hash. Quem chama mostra uma vez e
  // esquece — não guarde isto em lugar nenhum.
  return { chave };
}

export async function listarChavesDeMcp(contexto: ContextoSessao) {
  if (!pode(contexto, "integracoes.ver")) {
    throw new SemPermissao("ver as chaves do MCP");
  }

  return db.chaveDeMcp.findMany({
    where: { organizacaoId: contexto.organizacao.id },
    orderBy: { criadoEm: "desc" },
    select: {
      id: true,
      nome: true,
      unidadeId: true,
      ultimos4: true,
      ultimoUsoEm: true,
      usos: true,
      revogadaEm: true,
      criadoEm: true,
    },
  });
}

export async function revogarChaveDeMcp(
  contexto: ContextoSessao,
  id: string,
): Promise<void> {
  if (!pode(contexto, "integracoes.editar")) {
    throw new SemPermissao("revogar chaves do MCP");
  }

  const linha = await db.chaveDeMcp.findFirst({
    where: { id, organizacaoId: contexto.organizacao.id },
    select: { id: true, nome: true },
  });
  if (!linha) throw new Error("Chave não encontrada.");

  await db.chaveDeMcp.update({
    where: { id },
    data: { revogadaEm: new Date() },
  });

  await auditar(contexto, "ALTEROU", "ChaveDeMcp", id, null, {
    nome: linha.nome,
    acao: "chave de MCP revogada",
  });
}

/**
 * O CONTRATO COM O SERVIDOR MCP.
 *
 * A chave age como a PESSOA que a criou: o contexto montado é o dela, com as
 * permissões dela. Daí em diante `pode(contexto, "estoque.ver")` funciona
 * exatamente como quando ela está logada — nenhuma permissão nova, nenhum
 * caminho paralelo. Uma chave criada por alguém só de leitura produz um MCP só
 * de leitura, sem ninguém programar nada.
 */
export async function validarChaveDeMcp(
  chave: string,
): Promise<ContextoSessao | null> {
  if (!chave) return null;

  const linha = await db.chaveDeMcp.findUnique({
    where: { resumo: resumoDaChave(chave) },
    select: {
      id: true,
      criadaPorId: true,
      unidadeId: true,
      revogadaEm: true,
    },
  });

  if (!linha || linha.revogadaEm) return null;

  const contexto = await contextoDeFundo(
    linha.criadaPorId,
    linha.unidadeId || null,
  );
  // Acesso revogado ou pessoa desligada: a chave morre junto, sem ninguém
  // precisar lembrar de revogá-la.
  if (!contexto) return null;

  await db.chaveDeMcp.update({
    where: { id: linha.id },
    data: { ultimoUsoEm: new Date(), usos: { increment: 1 } },
  });

  return contexto;
}
```

- [ ] **Passo 6: As ações e a tela**

Acrescente em `src/modules/integracoes/acoes.ts`:

```ts
import { emitirChaveDeMcp, revogarChaveDeMcp } from "./services/mcp";

export type EstadoDaChave = { erro?: string; chaveEmitida?: string };

/**
 * A chave emitida volta para a tela UMA vez — é a única exceção da regra "o
 * valor não volta", e é inevitável: chave que nunca é mostrada não serve para
 * ser colada no ChatGPT.
 */
export async function emitirChaveDeMcpAcao(
  _anterior: EstadoDaChave,
  dados: FormData,
): Promise<EstadoDaChave> {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const nome = String(dados.get("nome") ?? "").trim();
  if (!nome) return { erro: "Dê um nome para saber de quem é esta chave." };

  try {
    const { chave } = await emitirChaveDeMcp(
      contexto,
      nome,
      String(dados.get("unidadeId") ?? ""),
    );
    revalidatePath("/integracoes/mcp");
    return { chaveEmitida: chave };
  } catch (erro) {
    if (erro instanceof SemPermissao) return { erro: erro.message };
    if (erro instanceof Error) return { erro: erro.message };
    throw erro;
  }
}

export async function revogarChaveDeMcpAcao(dados: FormData) {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const id = String(dados.get("id") ?? "");
  if (!id) return;

  await revogarChaveDeMcp(contexto, id);
  revalidatePath("/integracoes/mcp");
}
```

Criar `src/modules/integracoes/components/painel-de-mcp.tsx`:

```tsx
"use client";

import { useActionState } from "react";

import { Botao } from "@/design-system/botao";
import { Campo } from "@/design-system/campo";
import { Etiqueta } from "@/design-system/etiqueta";
import {
  emitirChaveDeMcpAcao,
  revogarChaveDeMcpAcao,
  type EstadoDaChave,
} from "@/modules/integracoes/acoes";

type ChaveNaLista = {
  id: string;
  nome: string;
  ultimos4: string;
  ultimoUsoEm: Date | null;
  usos: number;
  revogadaEm: Date | null;
  criadoEm: Date;
};

export function PainelDeMcp({
  chaves,
  podeEditar,
}: {
  chaves: ChaveNaLista[];
  podeEditar: boolean;
}) {
  const [estado, acao, emitindo] = useActionState<EstadoDaChave, FormData>(
    emitirChaveDeMcpAcao,
    {},
  );

  return (
    <div className="flex flex-col gap-6">
      {podeEditar && (
        <form action={acao} className="flex max-w-xl items-end gap-3">
          <Campo
            name="nome"
            rotulo="Nome da chave"
            placeholder="ChatGPT do Pablo"
            ajuda="Para você saber de quem é quando precisar revogar."
          />
          <Botao type="submit" carregando={emitindo}>
            Emitir
          </Botao>
        </form>
      )}

      {estado.erro && <p className="text-bad text-sm">{estado.erro}</p>}

      {/*
        A ÚNICA vez que uma chave aparece na tela. Fechou, acabou — e o aviso
        precisa ser tão direto quanto a consequência de ignorá-lo.
      */}
      {estado.chaveEmitida && (
        <div className="border-accent bg-accent-sub rounded-md border p-4">
          <p className="text-sm font-semibold">
            Copie agora — ela não será mostrada de novo.
          </p>
          <code className="mt-2 block text-sm break-all">
            {estado.chaveEmitida}
          </code>
        </div>
      )}

      <ul className="flex flex-col gap-2">
        {chaves.map((chave) => (
          <li
            key={chave.id}
            className="border-line flex items-center justify-between gap-4 rounded-md border p-3"
          >
            <div>
              <p className="font-semibold">
                {chave.nome}{" "}
                <span className="text-ink-3 font-normal">
                  ••••{chave.ultimos4}
                </span>
              </p>
              <p className="text-ink-3 mt-0.5 text-sm">
                {chave.ultimoUsoEm
                  ? `último uso em ${chave.ultimoUsoEm.toLocaleDateString("pt-BR")} · ${chave.usos} consultas`
                  : "nunca usada"}
              </p>
            </div>

            {chave.revogadaEm ? (
              <Etiqueta tom="neutro">Revogada</Etiqueta>
            ) : (
              podeEditar && (
                <form action={revogarChaveDeMcpAcao}>
                  <input type="hidden" name="id" value={chave.id} />
                  <button type="submit" className="text-bad text-sm underline">
                    Revogar
                  </button>
                </form>
              )
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

Criar `src/app/(shell)/integracoes/mcp/page.tsx`:

```tsx
import { redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { PainelDeMcp } from "@/modules/integracoes/components/painel-de-mcp";
import { listarChavesDeMcp } from "@/modules/integracoes/services/mcp";

export default async function PaginaDoMcp() {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");
  if (!pode(contexto, "integracoes.ver")) redirect("/");

  const chaves = await listarChavesDeMcp(contexto);

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">MCP do Tetteo</h1>
        <p className="text-ink-3 mt-1 text-sm">
          As chaves que dão à sua IA acesso aos seus dados — com as permissões
          de quem as criou
        </p>
      </div>

      <div className="mt-6">
        <PainelDeMcp
          chaves={chaves}
          podeEditar={pode(contexto, "integracoes.editar")}
        />
      </div>
    </div>
  );
}
```

- [ ] **Passo 7: Provar na tela**

Run: `npm run dev`, abra `/integracoes/mcp`, emita uma chave.
Expected: a chave aparece **uma vez**; recarregar a página mostra só `••••` e os quatro últimos; revogar marca a linha como revogada.

- [ ] **Passo 8: `npm run check` e commit**

```bash
npm run check
git add src/modules/integracoes "src/app/(shell)/integracoes/mcp"
git commit -m "Integrações: a casa do MCP — emitir uma vez, conferir por hash, revogar na hora"
```

---

## O que fica para um segundo plano

Está no spec e **não** está neste plano, de propósito:

- **A migração das chaves atuais** (Evolution, Gemini, segredo do relógio) para o cofre, e o conector da Evolution passando a **receber** a credencial em vez de ler o ambiente. A ordem de leitura da Task 7 já deixa isso pronto para acontecer sem quebrar nada — mas mexer no conector é mexer na Severina que está no ar, e merece plano e ensaio próprios.
- **O botão "Testar conexão"**. O catálogo já prevê o campo; implementar exige uma consulta inofensiva por integração, e cada uma é um caso.
- **Rotação da chave-mestra.** `versaoDaChave` está gravada em cada valor para tornar possível; o procedimento espera motivo.
