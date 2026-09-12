# Severina · Fase 1 — Agentes de Aviso · Plano de Implementação

> ## ✅ EXECUTADO em 05/08/2026 — branch `severina/fase-1`
>
> **No ar em 11/09/2026.** A última tarefa, o relógio no ar, só aconteceu nesse dia: até lá nenhum agente tinha disparado em produção. O registro está no desenho, §3, "A fase 1 no ar".
>
> **Este documento é histórico. A verdade está no código.** Onde os dois divergirem, o código venceu — e a divergência costuma ser o próprio aprendizado:
>
> | O plano dizia                                               | O que era, de verdade                                                                               |
> | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
> | Tabelas com `@relation` para o Core, e editar `core.prisma` | Módulo do Tetteo guarda `unidadeId` como texto solto. Contra-relação faria o Kernel conhecer um App |
> | Status de rotina `"ATRASADA"` / `"HOJE"`                    | `"feita"`, `"aguardando"`, `"atrasada"` (`lib/agenda.ts`)                                           |
> | `server-only` já instalado                                  | Não estava                                                                                          |
> | Nada sobre o `proxy.ts`                                     | O `auth` engolia `/api/severina/tick` com 307 → `/login`. Só apareceu ao rodar                      |
> | `GEMINI_API_KEY`, uma só                                    | `GEMINI_API_KEYS` aceita lista, com revezamento e failover                                          |
>
> **Para quem executa:** SUB-SKILL OBRIGATÓRIA — use `superpowers:subagent-driven-development` ou `superpowers:executing-plans`. Os passos usam caixas (`- [ ]`) para marcação.

**Objetivo:** o dono cria, numa tela, agentes que mandam mensagem de WhatsApp para a equipe no horário certo — sem programador, sem receber resposta ainda.

**Arquitetura:** o agente é uma linha no banco. Um relógio externo bate em `/api/severina/tick` a cada minuto; o tick pergunta quais agentes venceram, grava mensagens na fila, e esvazia a fila com ritmo pela Evolution API. O Gemini só redige o texto a partir das instruções em português — não decide nada e não usa ferramenta.

**Stack:** Next.js 16 · TypeScript · Prisma 7 / PostgreSQL · Zod 4 · `node:test`

## Restrições globais

- **Fronteiras do linter são inegociáveis.** `modules/*` só importa de `core`, `design-system`, `lib`, `server` e de si mesmo. Nunca de `connectors/*` nem de outro módulo. `npm run lint` recusa.
- **Toda tabela carrega `organizacaoId`.** Consulta sem escopo é bug.
- **Nada é apagado de verdade** — `excluidoEm`.
- **Identificador é `cuid()`**, nunca sequencial.
- **Teste é de função pura.** O projeto não tem harness de banco; serviços que tocam o Prisma não ganham teste automatizado, seguindo o padrão de `estoque` e `checklists`. Toda lógica que dá para isolar (datas, telefone, ritmo, gatilho) sai do serviço e vira função pura testada.
- **`npm run check` antes de todo commit** — tipos, fronteiras, formatação e testes.
- **Next.js 16 quebra convenções antigas.** Antes de escrever rota ou server action, ler o guia correspondente em `node_modules/next/dist/docs/`. Vale especialmente para Route Handlers e `after`.
- **Comentários em português**, explicando o _porquê_, no registro dos arquivos existentes.

## Variáveis de ambiente novas

```bash
EVOLUTION_URL=http://evolution_api:8080
EVOLUTION_API_KEY=<a chave da instância>
EVOLUTION_INSTANCIA=severina-teste
SEVERINA_TICK_SEGREDO=<openssl rand -hex 32>
GEMINI_API_KEY=<do Google AI Studio>
GEMINI_MODELO=<confirmar o id atual na documentação do Google>
```

## Estrutura de arquivos

| Arquivo                                             | Responsabilidade                        |
| --------------------------------------------------- | --------------------------------------- |
| `prisma/schema/assistente.prisma`                   | As 5 tabelas                            |
| `src/lib/telefone.ts` + teste                       | Normalizar número para E.164 e comparar |
| `src/connectors/whatsapp/evolution.ts`              | Falar "Evolution API". Só isso          |
| `src/server/ia/gemini.ts`                           | Falar "Gemini". Só isso                 |
| `src/modules/assistente/permissoes.ts`              | O vocabulário do App                    |
| `src/modules/assistente/manifest.ts`                | A declaração ao Core                    |
| `src/modules/assistente/schemas/gatilho.ts` + teste | "Este agente vence agora?" — puro       |
| `src/modules/assistente/schemas/ritmo.ts` + teste   | Quantas mensagens por rodada — puro     |
| `src/modules/assistente/schemas/agente.ts`          | Zod dos formulários                     |
| `src/modules/assistente/services/agentes.ts`        | CRUD de agente                          |
| `src/modules/assistente/services/vinculos.ts`       | CRUD de vínculo + instância             |
| `src/modules/assistente/services/fila.ts`           | Enfileirar e esvaziar                   |
| `src/modules/assistente/services/disparo.ts`        | Quem vence, para quem, com que texto    |
| `src/modules/assistente/services/conversas.ts`      | Leitura para a tela                     |
| `src/modules/assistente/acoes.ts`                   | Server actions                          |
| `src/modules/assistente/components/*.tsx`           | As telas                                |
| `src/modules/estoque/assistente.ts`                 | Os avisos que o Estoque oferece         |
| `src/registro-de-ferramentas.ts`                    | Raiz de composição, server-only         |
| `src/app/api/severina/tick/route.ts`                | O relógio                               |
| `src/app/(shell)/assistente/**`                     | As rotas                                |

---

## Task 1: As tabelas

**Arquivos:**

- Criar: `prisma/schema/assistente.prisma`
- Criar: `prisma/schema/migrations/<gerada>/migration.sql`

**Interfaces:**

- Consome: `organizacaoId`, `unidadeId` e `usuarioId` **como texto**, nunca como `@relation`
- Produz: os modelos `InstanciaWhatsapp`, `VinculoWhatsapp`, `AgenteSeverina`, `ConversaWhatsapp`, `MensagemWhatsapp` no cliente do Prisma

> **A regra que este schema obedece, e que custa caro descobrir depois.**
> Nenhum módulo do Tetteo declara `@relation` para tabela do Core. `estoque.prisma:33` e `checklists.prisma:42` guardam `unidadeId String` e `organizacaoId String` como campo simples, e `core.prisma` não tem contra-relação para App nenhum.
>
> É a regra nº 2 virando banco: se `core.prisma` ganhasse `agentes AgenteSeverina[]`, o Core passaria a conhecer um App — e a próxima instalação de módulo exigiria migrar o Kernel.
>
> O preço é real e aceito: sem integridade referencial no banco para `usuarioId`, e sem `include: { usuario: true }`. Quem precisa do nome busca em `db.usuario` por id, como os outros módulos já fazem. Relação **dentro** do módulo (conversa → mensagem) continua sendo `@relation` normal.

- [ ] **Passo 1: Escrever o schema**

```prisma
// ===========================================================================
// SEVERINA — as tabelas do assistente
//
// A Severina não guarda regra de negócio de nenhum App. Ela guarda CONVERSA:
// quem falou, quando, o que foi dito e o que está para ser dito.
// ===========================================================================

/// O número de WhatsApp. Uma linha hoje.
///
/// Existe como tabela por dois motivos concretos: o botão de desligar precisa
/// de lugar para morar, e a queda de conexão precisa aparecer numa tela em vez
/// de ser descoberta por reclamação de quem não recebeu o aviso.
model InstanciaWhatsapp {
  id            String      @id @default(cuid())
  organizacaoId String
  organizacao   Organizacao @relation(fields: [organizacaoId], references: [id])

  /// O nome da instância na Evolution API — "severina-teste"
  nome          String
  numeroProprio String?

  ativa          Boolean   @default(true)
  conectadaEm    DateTime?
  desconectadaEm DateTime?
  ultimoErro     String?

  criadoEm     DateTime  @default(now())
  atualizadoEm DateTime  @updatedAt
  excluidoEm   DateTime?

  conversas ConversaWhatsapp[]

  @@unique([organizacaoId, nome])
  @@map("instancia_whatsapp")
}

/// QUEM EXISTE PARA A SEVERINA.
///
/// O WhatsApp migrou para o LID: o remetente chega como "2231708…@lid", sem
/// telefone dentro. Comparar com `Usuario.telefone` deixou de funcionar, e por
/// isso o vínculo é gravado em vez de deduzido.
///
/// Sem linha aqui, a pessoa não existe: mensagem de quem não tem vínculo é
/// descartada sem ser gravada. É o que impede conversa pessoal de entrar no
/// banco de gestão.
model VinculoWhatsapp {
  id            String      @id @default(cuid())
  organizacaoId String
  organizacao   Organizacao @relation(fields: [organizacaoId], references: [id])
  usuarioId     String
  usuario       Usuario     @relation(fields: [usuarioId], references: [id])

  /// O identificador que a Evolution entrega: LID ou @s.whatsapp.net
  remoteJid String

  /// O telefone em E.164, sem o "+" — "558481336549"
  telefone String

  confirmadoEm DateTime?

  criadoEm     DateTime  @default(now())
  atualizadoEm DateTime  @updatedAt
  excluidoEm   DateTime?

  @@unique([organizacaoId, remoteJid])
  @@index([organizacaoId, telefone])
  @@map("vinculo_whatsapp")
}

enum TipoAgente {
  AVISO
  COLETA
  MODULO
}

enum GatilhoAgente {
  HORARIO
  ROTINA_VENCIDA
  MENSAGEM_RECEBIDA
}

/// O que o dono cria na tela.
///
/// A divisão entre `instrucoes` e `limites` é a regra que sustenta tudo:
/// instrução é texto livre e INFLUENCIA o modelo; limite é campo estruturado e
/// é conferido pelo código antes de executar. "Nunca feche acima de R$ 5.000"
/// na caixa de texto é pedido; como campo, é parede. O modelo não convence um
/// `if`.
model AgenteSeverina {
  id            String      @id @default(cuid())
  organizacaoId String
  organizacao   Organizacao @relation(fields: [organizacaoId], references: [id])

  /// Vazio = vale para a rede inteira
  unidadeId String?
  unidade   Unidade? @relation(fields: [unidadeId], references: [id])

  nome  String
  tipo  TipoAgente @default(AVISO)
  ativo Boolean    @default(true)

  gatilho GatilhoAgente

  /// HORARIO       → { "horario": "07:00", "diasDaSemana": [1,2,3,4,5] }
  /// ROTINA_VENCIDA → { "modulo": "estoque" }
  gatilhoConfig Json @default("{}")

  destinatariosPapeis   String[] @default([])
  destinatariosUsuarios String[] @default([])

  /// MOLE — orienta o Gemini na redação
  instrucoes String

  /// Fases seguintes. Declarados agora para não migrar de novo depois.
  perguntas           Json     @default("[]")
  ferramentasLiberadas String[] @default([])

  /// DURO — { "janelaInicio": "06:00", "janelaFim": "22:00",
  ///          "maxAcoesPorConversa": 8, "aceitaAudio": true }
  limites Json @default("{}")

  criadoEm     DateTime  @default(now())
  atualizadoEm DateTime  @updatedAt
  excluidoEm   DateTime?

  conversas ConversaWhatsapp[]

  @@index([organizacaoId, ativo])
  @@map("agente_severina")
}

enum EstadoConversa {
  ABERTA
  AGUARDANDO_CONFIRMACAO
  ENCERRADA
}

/// O assunto em aberto com uma pessoa.
///
/// `unidadeId` é o que resolve o número único: a resposta "12 kg" sabe de qual
/// estoque é porque a CONVERSA sabe — não porque o telefone sabe.
model ConversaWhatsapp {
  id          String            @id @default(cuid())
  instanciaId String
  instancia   InstanciaWhatsapp @relation(fields: [instanciaId], references: [id])
  agenteId    String
  agente      AgenteSeverina    @relation(fields: [agenteId], references: [id])

  organizacaoId String
  organizacao   Organizacao @relation(fields: [organizacaoId], references: [id])
  unidadeId     String?
  unidade       Unidade?    @relation(fields: [unidadeId], references: [id])

  remoteJid String
  usuarioId String
  usuario   Usuario @relation(fields: [usuarioId], references: [id])

  referenciaTipo String?
  referenciaId   String?

  estado EstadoConversa @default(ABERTA)

  /// Congela ferramenta, argumentos e prazo enquanto espera a palavra de
  /// confirmação. Fase 3.
  acaoPendente Json?

  ultimaMensagemEm DateTime @default(now())

  criadoEm     DateTime @default(now())
  atualizadoEm DateTime @updatedAt

  mensagens MensagemWhatsapp[]

  @@index([organizacaoId, ultimaMensagemEm])
  @@index([agenteId, estado])
  @@map("conversa_whatsapp")
}

enum DirecaoMensagem {
  ENTRADA
  SAIDA
}

enum TipoMensagem {
  TEXTO
  IMAGEM
  DOCUMENTO
  AUDIO
}

enum StatusMensagem {
  PENDENTE
  ENVIADA
  ENTREGUE
  FALHOU
}

/// Tudo que entra e tudo que sai, numa tabela só.
///
/// É ela que vira a linha do tempo da aba Conversas, e a fila de saída é só
/// `direcao=SAIDA AND status=PENDENTE`. Duas tabelas dariam duas metades de uma
/// história que se lê junto.
///
/// `idExterno` ÚNICO é a trava contra webhook repetido: a Evolution reenvia
/// quando não tem certeza que chegou, e sem isso "entrou 12kg" viraria 24kg.
/// Mesma lógica da `entrega_evento` do Core.
model MensagemWhatsapp {
  id        String           @id @default(cuid())
  conversaId String
  conversa  ConversaWhatsapp @relation(fields: [conversaId], references: [id])

  direcao DirecaoMensagem
  tipo    TipoMensagem    @default(TEXTO)

  /// O id da mensagem na Evolution. Nulo enquanto a nossa não foi enviada.
  idExterno String? @unique

  texto    String?
  midiaUrl String?

  status     StatusMensagem @default(PENDENTE)
  tentativas Int            @default(0)
  erro       String?

  /// Por que a Severina falou — "agente:clx91…"
  origem String?

  agendadaPara DateTime?
  enviadaEm    DateTime?
  recebidaEm   DateTime?

  criadoEm DateTime @default(now())

  @@index([status, direcao, agendadaPara])
  @@index([conversaId, criadoEm])
  @@map("mensagem_whatsapp")
}
```

- [ ] **Passo 2: Acrescentar as relações inversas em `core.prisma`**

Em `model Organizacao`, junto das outras listas:

```prisma
  instanciasWhatsapp InstanciaWhatsapp[]
  vinculosWhatsapp   VinculoWhatsapp[]
  agentes            AgenteSeverina[]
  conversasWhatsapp  ConversaWhatsapp[]
```

Em `model Unidade`:

```prisma
  agentes           AgenteSeverina[]
  conversasWhatsapp ConversaWhatsapp[]
```

Em `model Usuario`:

```prisma
  vinculosWhatsapp  VinculoWhatsapp[]
  conversasWhatsapp ConversaWhatsapp[]
```

- [ ] **Passo 3: Gerar a migração**

```bash
npx prisma migrate dev --name severina_agentes
```

Esperado: cria a pasta de migração e regenera o cliente sem erro.

- [ ] **Passo 4: Conferir que compila**

```bash
npm run typecheck
```

Esperado: sem erro.

- [ ] **Passo 5: Commit**

```bash
git add prisma/
git commit -m "Severina: as cinco tabelas da conversa"
```

---

## Task 2: Telefone em E.164

**Arquivos:**

- Criar: `src/lib/telefone.ts`
- Testar: `src/lib/telefone.test.ts`

**Interfaces:**

- Consome: nada
- Produz:
  - `normalizarTelefone(bruto: string): string | null` — devolve E.164 sem "+", ou `null` se não der para normalizar
  - `telefoneDoJid(remoteJid: string): string | null` — extrai o telefone de um JID `@s.whatsapp.net`; devolve `null` para `@lid` e `@g.us`
  - `ehGrupo(remoteJid: string): boolean`

**Por que existe:** o vínculo guarda telefone em formato único. Sem isso, "84 98133-6549", "+5584981336549" e "558481336549" seriam três pessoas diferentes. E o Brasil tem a armadilha do nono dígito: o WhatsApp entrega números de celular antigos sem ele.

- [ ] **Passo 1: Escrever o teste que falha**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { ehGrupo, normalizarTelefone, telefoneDoJid } from "./telefone";

/**
 * O mesmo número chega de cinco jeitos diferentes: digitado pelo dono no
 * cadastro, colado de uma planilha, ou entregue pela Evolution. Se cada forma
 * virar uma linha de vínculo, a Severina responde a um cadastro e ignora o
 * outro — e ninguém entende por quê.
 */

test("aceita as formas que uma pessoa digita", () => {
  assert.equal(normalizarTelefone("84 98133-6549"), "5584981336549");
  assert.equal(normalizarTelefone("(84) 98133-6549"), "5584981336549");
  assert.equal(normalizarTelefone("+55 84 98133-6549"), "5584981336549");
  assert.equal(normalizarTelefone("5584981336549"), "5584981336549");
});

test("não inventa número a partir de lixo", () => {
  assert.equal(normalizarTelefone(""), null);
  assert.equal(normalizarTelefone("abc"), null);
  assert.equal(normalizarTelefone("123"), null);
});

/**
 * O nono dígito: o WhatsApp entrega celular brasileiro antigo com 12 dígitos
 * (55 + DDD + 8), e o cadastro tem 13. São a MESMA pessoa. Sem esta regra, a
 * cobrança da contagem não chega em quem trocou de aparelho antes de 2016.
 */
test("completa o nono dígito de celular brasileiro", () => {
  assert.equal(normalizarTelefone("558481336549"), "5584981336549");
});

test("não mexe em fixo nem em número estrangeiro", () => {
  // Fixo de Natal: 55 + 84 + 8 dígitos começando por 3
  assert.equal(normalizarTelefone("558432116549"), "558432116549");
  // Portugal
  assert.equal(normalizarTelefone("+351912345678"), "351912345678");
});

test("extrai telefone de JID antigo e recusa LID", () => {
  assert.equal(telefoneDoJid("558481336549@s.whatsapp.net"), "5584981336549");
  assert.equal(telefoneDoJid("223170845999336@lid"), null);
  assert.equal(telefoneDoJid("120363@g.us"), null);
});

test("reconhece grupo", () => {
  assert.equal(ehGrupo("120363@g.us"), true);
  assert.equal(ehGrupo("558481336549@s.whatsapp.net"), false);
});
```

- [ ] **Passo 2: Rodar e confirmar que falha**

```bash
npx tsx --test src/lib/telefone.test.ts
```

Esperado: FALHA — `Cannot find module './telefone'`.

- [ ] **Passo 3: Implementar**

```ts
/**
 * TELEFONE — uma forma só para o mesmo número.
 *
 * O vínculo da Severina compara telefone com telefone. Se "84 98133-6549" e
 * "+5584981336549" virarem chaves diferentes, o mesmo colaborador tem dois
 * cadastros e a Severina responde a um só.
 *
 * Mora em `lib/` porque não é vocabulário de negócio: Pessoas e CRM vão
 * precisar da mesma normalização, e duas cópias da regra é uma cópia esperando
 * para divergir.
 */

/** Celular brasileiro tem 9 na frente do número; fixo começa em 2..5. */
const DDDS_VALIDOS = /^[1-9][1-9]$/;

export function normalizarTelefone(bruto: string): string | null {
  const digitos = (bruto ?? "").replace(/\D/g, "");
  if (digitos.length < 8) return null;

  // Sem código de país e com cara de número brasileiro: assume 55.
  let numero = digitos;
  if (
    !numero.startsWith("55") &&
    (numero.length === 10 || numero.length === 11)
  ) {
    numero = `55${numero}`;
  }

  if (numero.startsWith("55")) {
    const ddd = numero.slice(2, 4);
    const resto = numero.slice(4);
    if (!DDDS_VALIDOS.test(ddd)) return null;

    // O nono dígito. Celular antigo chega com 8 dígitos começando em 6..9;
    // fixo também tem 8, mas começa em 2..5 — e não leva o 9.
    if (resto.length === 8 && /^[6-9]/.test(resto)) {
      return `55${ddd}9${resto}`;
    }
    if (resto.length === 8 || resto.length === 9) return `55${ddd}${resto}`;
    return null;
  }

  // Estrangeiro: devolve como veio, só sem símbolo.
  return numero.length >= 10 ? numero : null;
}

export function ehGrupo(remoteJid: string): boolean {
  return remoteJid.endsWith("@g.us");
}

export function telefoneDoJid(remoteJid: string): string | null {
  // O LID esconde o telefone de propósito — não há o que extrair.
  if (!remoteJid.endsWith("@s.whatsapp.net")) return null;
  return normalizarTelefone(remoteJid.split("@")[0]);
}
```

- [ ] **Passo 4: Rodar e confirmar que passa**

```bash
npx tsx --test src/lib/telefone.test.ts
```

Esperado: todos os testes PASSAM.

- [ ] **Passo 5: Commit**

```bash
npm run check
git add src/lib/telefone.ts src/lib/telefone.test.ts
git commit -m "Telefone: uma forma só para o mesmo número"
```

---

## Task 3: O gatilho — quem vence agora

**Arquivos:**

- Criar: `src/modules/assistente/schemas/gatilho.ts`
- Testar: `src/modules/assistente/schemas/gatilho.test.ts`

**Interfaces:**

- Consome: `prazoAtual` de `@/lib/agenda` (já existe)
- Produz:
  - `type ConfigHorario = { horario: string; diasDaSemana: number[] }`
  - `deveDispararAgora(config: ConfigHorario, ultimoDisparo: Date | null, agora: Date): boolean`
  - `dentroDaJanela(limites: { janelaInicio?: string; janelaFim?: string }, agora: Date): boolean`

**Por que é função pura:** é o coração do relógio, e relógio é onde os bugs se escondem — virada de dia, agente criado depois do horário, tick que roda duas vezes no mesmo minuto. Testar isso contra o banco seria lento e frágil.

- [ ] **Passo 1: Escrever o teste que falha**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { dentroDaJanela, deveDispararAgora } from "./gatilho";

const seteDaManha = { horario: "07:00", diasDaSemana: [1, 2, 3, 4, 5] };

/** Segunda-feira, 4 de agosto de 2026. */
const seg = (hora: number, minuto = 0) =>
  new Date(2026, 7, 3, hora, minuto, 0, 0);
/** Domingo. */
const dom = (hora: number, minuto = 0) =>
  new Date(2026, 7, 2, hora, minuto, 0, 0);

test("dispara quando a hora chega, num dia da semana escolhido", () => {
  assert.equal(deveDispararAgora(seteDaManha, null, seg(7, 0)), true);
  assert.equal(deveDispararAgora(seteDaManha, null, seg(7, 3)), true);
});

test("não dispara antes da hora", () => {
  assert.equal(deveDispararAgora(seteDaManha, null, seg(6, 59)), false);
});

/**
 * O tick roda a cada minuto. Sem esta regra, a equipe receberia a mesma
 * cobrança 60 vezes entre 7h e 8h — e desligaria a Severina no primeiro dia.
 */
test("não repete no mesmo dia depois de já ter disparado", () => {
  assert.equal(deveDispararAgora(seteDaManha, seg(7, 0), seg(7, 1)), false);
  assert.equal(deveDispararAgora(seteDaManha, seg(7, 0), seg(23, 0)), false);
});

test("volta a disparar no dia seguinte", () => {
  const ontem = new Date(2026, 7, 2, 7, 0, 0, 0);
  assert.equal(deveDispararAgora(seteDaManha, ontem, seg(7, 0)), true);
});

test("respeita os dias escolhidos", () => {
  assert.equal(deveDispararAgora(seteDaManha, null, dom(7, 0)), false);
});

/**
 * Agente criado às 10h com horário 7h não deve cuspir a cobrança de hoje —
 * o horário já passou, e a mensagem chegaria fora de contexto.
 */
test("não dispara retroativo no mesmo dia", () => {
  assert.equal(deveDispararAgora(seteDaManha, null, seg(10, 0)), false);
});

test("a janela de horário barra o que está fora dela", () => {
  const limites = { janelaInicio: "06:00", janelaFim: "22:00" };
  assert.equal(dentroDaJanela(limites, seg(7, 0)), true);
  assert.equal(dentroDaJanela(limites, seg(5, 59)), false);
  assert.equal(dentroDaJanela(limites, seg(22, 1)), false);
  assert.equal(dentroDaJanela({}, seg(3, 0)), true);
});
```

- [ ] **Passo 2: Rodar e confirmar que falha**

```bash
npx tsx --test src/modules/assistente/schemas/gatilho.test.ts
```

Esperado: FALHA — módulo não encontrado.

- [ ] **Passo 3: Implementar**

```ts
/**
 * O GATILHO — a pergunta que o relógio faz a cada minuto.
 *
 * Puro de propósito. O relógio bate 1.440 vezes por dia, e cada erro aqui é
 * uma mensagem repetida sessenta vezes ou uma cobrança que nunca sai. Nenhuma
 * das duas se descobre lendo código: se descobre com teste de data.
 */

export type ConfigHorario = {
  horario: string;
  /** 0 = domingo. Vazio significa todo dia. */
  diasDaSemana: number[];
};

/** Janela de tolerância: o tick pode atrasar, e a mensagem não pode se perder. */
const TOLERANCIA_MINUTOS = 15;

function emMinutos(hhmm: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm ?? "");
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function mesmoDia(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function deveDispararAgora(
  config: ConfigHorario,
  ultimoDisparo: Date | null,
  agora: Date,
): boolean {
  const alvo = emMinutos(config.horario);
  if (alvo === null) return false;

  const dias = config.diasDaSemana ?? [];
  if (dias.length > 0 && !dias.includes(agora.getDay())) return false;

  // Já falou hoje: não repete, por mais vezes que o relógio bata.
  if (ultimoDisparo && mesmoDia(ultimoDisparo, agora)) return false;

  const atual = agora.getHours() * 60 + agora.getMinutes();

  // A janela é fechada em cima: passou muito da hora, a mensagem perdeu o
  // sentido e o silêncio é melhor do que "bom dia" às três da tarde.
  return atual >= alvo && atual <= alvo + TOLERANCIA_MINUTOS;
}

export function dentroDaJanela(
  limites: { janelaInicio?: string; janelaFim?: string },
  agora: Date,
): boolean {
  const atual = agora.getHours() * 60 + agora.getMinutes();
  const inicio = emMinutos(limites.janelaInicio ?? "");
  const fim = emMinutos(limites.janelaFim ?? "");

  if (inicio !== null && atual < inicio) return false;
  if (fim !== null && atual > fim) return false;
  return true;
}
```

- [ ] **Passo 4: Rodar e confirmar que passa**

```bash
npx tsx --test src/modules/assistente/schemas/gatilho.test.ts
```

Esperado: todos PASSAM.

- [ ] **Passo 5: Commit**

```bash
npm run check
git add src/modules/assistente/schemas/gatilho.ts src/modules/assistente/schemas/gatilho.test.ts
git commit -m "Severina: o gatilho que não repete e não atrasa"
```

---

## Task 4: O ritmo da fila

**Arquivos:**

- Criar: `src/modules/assistente/schemas/ritmo.ts`
- Testar: `src/modules/assistente/schemas/ritmo.test.ts`

**Interfaces:**

- Produz:
  - `MAX_POR_RODADA: number`
  - `INTERVALO_MS: number`
  - `proximaTentativa(tentativas: number, ultimaFalhaEm: Date): Date`
  - `desistiu(tentativas: number): boolean`

**Por que existe:** o número é uma conta pessoal com 1016 contatos. Rajada de mensagens é o comportamento que a Meta bloqueia. O ritmo não é otimização — é o que protege a conta.

- [ ] **Passo 1: Escrever o teste que falha**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  desistiu,
  INTERVALO_MS,
  MAX_POR_RODADA,
  proximaTentativa,
} from "./ritmo";

/**
 * O número da Severina é uma conta pessoal com mais de mil contatos. Disparar
 * vinte mensagens em rajada é exatamente o padrão que faz a Meta bloquear —
 * e um bloqueio aqui derruba conversa de família junto.
 */

test("o teto por rodada é conservador", () => {
  assert.ok(MAX_POR_RODADA <= 12, "rajada é o que faz banir");
  assert.ok(MAX_POR_RODADA >= 1);
});

test("existe intervalo entre uma mensagem e outra", () => {
  assert.ok(INTERVALO_MS >= 3000, "sem respiro parece robô");
});

/**
 * Falhou porque a Evolution caiu? Tentar de novo no minuto seguinte, sessenta
 * vezes, é a receita para virar tempestade. O espaço entre tentativas cresce.
 */
test("a espera cresce a cada tentativa", () => {
  const base = new Date(2026, 7, 3, 7, 0, 0, 0);
  const primeira = proximaTentativa(1, base);
  const segunda = proximaTentativa(2, base);
  const terceira = proximaTentativa(3, base);

  assert.ok(primeira.getTime() > base.getTime());
  assert.ok(segunda.getTime() > primeira.getTime());
  assert.ok(terceira.getTime() > segunda.getTime());
});

test("desiste depois de um número finito de tentativas", () => {
  assert.equal(desistiu(1), false);
  assert.equal(desistiu(4), false);
  assert.equal(desistiu(5), true);
});
```

- [ ] **Passo 2: Rodar e confirmar que falha**

```bash
npx tsx --test src/modules/assistente/schemas/ritmo.test.ts
```

Esperado: FALHA.

- [ ] **Passo 3: Implementar**

```ts
/**
 * O RITMO — o que protege o número de ser banido.
 *
 * A fila existe porque o linter proíbe módulo importar conector. O efeito
 * colateral virou a peça mais importante: como a Severina não envia direto,
 * existe um lugar onde segurar a mão.
 */

/** Mensagens por rodada do relógio. O relógio bate a cada minuto. */
export const MAX_POR_RODADA = 8;

/** Espaço entre uma mensagem e a seguinte, dentro da mesma rodada. */
export const INTERVALO_MS = 4000;

const MAX_TENTATIVAS = 5;

export function desistiu(tentativas: number): boolean {
  return tentativas >= MAX_TENTATIVAS;
}

/**
 * Espera crescente: 1min, 4min, 9min, 16min. Quadrática em vez de dobrando,
 * porque o caso comum aqui é a Evolution reiniciando — volta em minutos, não
 * em horas, e esperar demais atrasaria a cobrança do dia.
 */
export function proximaTentativa(
  tentativas: number,
  ultimaFalhaEm: Date,
): Date {
  const minutos = tentativas * tentativas;
  return new Date(ultimaFalhaEm.getTime() + minutos * 60_000);
}
```

- [ ] **Passo 4: Rodar e confirmar que passa**

```bash
npx tsx --test src/modules/assistente/schemas/ritmo.test.ts
```

Esperado: todos PASSAM.

- [ ] **Passo 5: Commit**

```bash
npm run check
git add src/modules/assistente/schemas/ritmo.ts src/modules/assistente/schemas/ritmo.test.ts
git commit -m "Severina: o ritmo que protege o número"
```

---

## Task 5: O conector da Evolution

**Arquivos:**

- Criar: `src/connectors/whatsapp/evolution.ts`
- Criar: `src/connectors/whatsapp/README.md`

**Interfaces:**

- Consome: nada do Tetteo — só `fetch` e variáveis de ambiente
- Produz:
  - `type ResultadoEnvio = { ok: true; idExterno: string } | { ok: false; erro: string }`
  - `enviarTexto(para: string, texto: string): Promise<ResultadoEnvio>`
  - `estadoDaConexao(): Promise<{ conectado: boolean; estado: string }>`

**Atenção à fronteira:** este arquivo não importa de `modules/`. O linter recusa. Ele também não conhece `AgenteSeverina` nem `MensagemWhatsapp` — só texto e número.

- [ ] **Passo 1: Escrever o conector**

```ts
/**
 * A PONTE COM O WHATSAPP.
 *
 * Só este arquivo sabe o que é "Evolution API". Trocar de provedor um dia é
 * reescrever esta pasta, e nada mais — nenhum App ouviu falar dela.
 *
 * Fala com a Evolution POR DENTRO da rede do Docker (evolution_api:8080): não
 * sai da máquina, não passa pela internet, não gasta TLS.
 */

const URL_BASE = process.env.EVOLUTION_URL ?? "http://evolution_api:8080";
const CHAVE = process.env.EVOLUTION_API_KEY ?? "";
const INSTANCIA = process.env.EVOLUTION_INSTANCIA ?? "severina-teste";

export type ResultadoEnvio =
  { ok: true; idExterno: string } | { ok: false; erro: string };

async function chamar(caminho: string, corpo?: unknown) {
  const resposta = await fetch(`${URL_BASE}${caminho}`, {
    method: corpo ? "POST" : "GET",
    headers: {
      apikey: CHAVE,
      ...(corpo ? { "Content-Type": "application/json" } : {}),
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
    // O relógio tem um minuto. Pendurar aqui trava a fila inteira.
    signal: AbortSignal.timeout(20_000),
  });

  const texto = await resposta.text();
  if (!resposta.ok) {
    throw new Error(`Evolution ${resposta.status}: ${texto.slice(0, 300)}`);
  }
  return texto ? JSON.parse(texto) : null;
}

/** `para` é o telefone em E.164 sem "+": "558481336549". */
export async function enviarTexto(
  para: string,
  texto: string,
): Promise<ResultadoEnvio> {
  try {
    const resposta = await chamar(`/message/sendText/${INSTANCIA}`, {
      number: para,
      text: texto,
    });

    const idExterno = resposta?.key?.id;
    if (!idExterno) return { ok: false, erro: "resposta sem id de mensagem" };

    return { ok: true, idExterno };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : String(e) };
  }
}

export async function estadoDaConexao() {
  try {
    const r = await chamar(`/instance/connectionState/${INSTANCIA}`);
    const estado = r?.instance?.state ?? "desconhecido";
    return { conectado: estado === "open", estado };
  } catch (e) {
    return {
      conectado: false,
      estado: e instanceof Error ? e.message : "erro",
    };
  }
}
```

- [ ] **Passo 2: Escrever o README da pasta**

```markdown
# `connectors/whatsapp/` — a ponte com a Evolution API

Só este arquivo sabe o que é "Evolution API". Nenhum App ouviu falar dela.

## O que precisa no ambiente

    EVOLUTION_URL=http://evolution_api:8080
    EVOLUTION_API_KEY=<a chave>
    EVOLUTION_INSTANCIA=severina-teste

`EVOLUTION_URL` aponta para DENTRO da rede do Docker. A URL pública
(`https://evo.…`) serve só ao navegador, para ler o QR Code.

## Quem chama

Ninguém de `modules/`. O linter proíbe — módulo não importa conector.
Quem chama é a camada `app/`, no relógio (`/api/severina/tick`), que lê a
fila e entrega para cá.
```

- [ ] **Passo 3: Conferir a fronteira**

```bash
npm run lint
```

Esperado: sem erro de fronteira.

- [ ] **Passo 4: Commit**

```bash
npm run check
git add src/connectors/whatsapp/
git commit -m "Severina: o conector que fala Evolution, e só ele"
```

---

## Task 6: O redator — Gemini

**Arquivos:**

- Criar: `src/server/ia/gemini.ts`

**Interfaces:**

- Produz: `redigirAviso(entrada: { instrucoes: string; contexto: string }): Promise<string>`

**Por que em `server/` e não em `connectors/`:** o Gemini não é ponte que traz fatos de fora, como o PDV traz vendas. É serviço que o sistema consulta, como o banco. E é o único lugar de onde `modules/` o alcança sem furar a trava do linter.

**Atenção:** confirmar o id do modelo atual na documentação do Google antes de fixar `GEMINI_MODELO`. Não chutar.

- [ ] **Passo 1: Escrever o adaptador**

```ts
/**
 * O REDATOR.
 *
 * Na fase 1 o Gemini faz uma coisa só: transformar as instruções que o dono
 * escreveu em português numa mensagem curta de WhatsApp. Não decide nada, não
 * chama ferramenta, não lê resposta.
 *
 * Se ele falhar, a fila NÃO pode parar: um aviso sem graça sai; um aviso que
 * não sai é uma contagem que ninguém faz.
 */

const CHAVE = process.env.GEMINI_API_KEY ?? "";
const MODELO = process.env.GEMINI_MODELO ?? "";

const INSTRUCAO_DE_SISTEMA = `
Você redige mensagens de WhatsApp para a equipe de um restaurante no Brasil.

Regras:
- No máximo 3 linhas. Ninguém lê parágrafo no WhatsApp.
- Português do dia a dia, sem formalidade de escritório.
- Não invente número, valor, nome de pessoa nem prazo. Use só o que receber.
- Não use emoji a não ser que as instruções peçam.
- Devolva SOMENTE o texto da mensagem, sem aspas e sem explicação.
`.trim();

export async function redigirAviso(entrada: {
  instrucoes: string;
  contexto: string;
}): Promise<string> {
  if (!CHAVE || !MODELO) return entrada.contexto;

  try {
    const resposta = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODELO}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": CHAVE,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: INSTRUCAO_DE_SISTEMA }] },
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: `Instruções do dono:\n${entrada.instrucoes}\n\nO que precisa ser comunicado agora:\n${entrada.contexto}`,
                },
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(20_000),
      },
    );

    if (!resposta.ok) return entrada.contexto;

    const dados = await resposta.json();
    const texto = dados?.candidates?.[0]?.content?.parts?.[0]?.text;

    // Silêncio do modelo não pode virar mensagem vazia no WhatsApp de ninguém.
    return typeof texto === "string" && texto.trim()
      ? texto.trim()
      : entrada.contexto;
  } catch {
    return entrada.contexto;
  }
}
```

- [ ] **Passo 2: Conferir tipos e fronteira**

```bash
npm run check
```

Esperado: sem erro.

- [ ] **Passo 3: Commit**

```bash
git add src/server/ia/
git commit -m "Severina: o redator, e o que ela diz quando ele cala"
```

---

## Task 7: O que o Estoque oferece

**Arquivos:**

- Criar: `src/modules/estoque/assistente.ts`
- Criar: `src/registro-de-ferramentas.ts`

**Interfaces:**

- Consome: `listarRotinas` de `./services/rotinas` (já existe, devolve `RotinaComStatus[]` com `status` e `nome`), `ContextoSessao` de `@/core/sessao/contexto`
- Produz:
  - `type AvisoDoModulo = { chave: string; assunto: string; referenciaTipo: string; referenciaId: string }`
  - `type ParticipanteDoAssistente = { modulo: string; avisos(contexto: ContextoSessao, agora: Date): Promise<AvisoDoModulo[]> }`
  - `PARTICIPANTES: ParticipanteDoAssistente[]` em `registro-de-ferramentas.ts`

**A regra que este arquivo existe para respeitar:** a Severina não sabe o que é uma rotina de contagem. Ela pergunta; o Estoque responde. `modules/assistente/` nunca importa `modules/estoque/`.

- [ ] **Passo 1: Definir o tipo no Core**

Acrescentar em `src/core/registry/tipos.ts`:

```ts
/**
 * O que um App oferece à Severina.
 *
 * O Core define a FORMA, nunca o significado — do mesmo jeito que faz com
 * permissão, que ele guarda como string sem saber o que "estoque.contar" quer
 * dizer.
 */
export type AvisoDoModulo = {
  /** Identifica o aviso para não repetir: "rotina:clx91…" */
  chave: string;
  /** O fato, em português, que a Severina vai transformar em mensagem. */
  assunto: string;
  referenciaTipo: string;
  referenciaId: string;
};
```

- [ ] **Passo 2: Escrever o que o Estoque oferece**

```ts
import type { AvisoDoModulo } from "@/core/registry/tipos";
import type { ContextoSessao } from "@/core/sessao/contexto";

import { listarRotinas } from "./services/rotinas";

/**
 * O QUE O ESTOQUE OFERECE À SEVERINA.
 *
 * A Severina não sabe o que é rotina de contagem, e não pode saber: um App
 * nunca importa de outro. Ela pergunta "tem aviso para dar?" e este arquivo
 * responde, no vocabulário dela.
 *
 * Quem é dono da regra continua dono. Se amanhã a contagem passar a ser
 * quinzenal, quem muda é o Estoque — a Severina não fica sabendo.
 */
export const assistenteDoEstoque = {
  modulo: "estoque",

  async avisos(contexto: ContextoSessao): Promise<AvisoDoModulo[]> {
    // Sem unidade escolhida não existe estoque para cobrar: farinha da câmara
    // de uma loja não vira pizza na outra.
    if (!contexto.unidadeAtiva) return [];

    const rotinas = await listarRotinas(contexto);

    return rotinas
      .filter((r) => r.status === "ATRASADA" || r.status === "HOJE")
      .map((r) => ({
        chave: `rotina:${r.id}`,
        assunto:
          r.status === "ATRASADA"
            ? `A contagem "${r.nome}" está atrasada.`
            : `A contagem "${r.nome}" é para hoje.`,
        referenciaTipo: "rotina_de_contagem",
        referenciaId: r.id,
      }));
  },
};
```

**Conferir antes de escrever:** os valores possíveis de `StatusRotina` em `src/lib/agenda.ts`. Se não forem `"ATRASADA"` e `"HOJE"`, usar os que existem — não inventar.

- [ ] **Passo 3: Escrever a raiz de composição**

```ts
import "server-only";

import type { AvisoDoModulo } from "@/core/registry/tipos";
import type { ContextoSessao } from "@/core/sessao/contexto";
import { assistenteDoEstoque } from "@/modules/estoque/assistente";

/**
 * O REGISTRO DE FERRAMENTAS — a segunda raiz de composição do sistema.
 *
 * Mesma ideia do `registro-de-apps.ts`, e pelo mesmo motivo: alguém precisa
 * conhecer todos os módulos, e esse alguém não pode ser nem o Core nem um App.
 * É este arquivo.
 *
 * `server-only` é essencial: diferente do registro de apps, aqui os módulos
 * trazem serviço que fala com o banco. Se isto vazasse para o navegador, iria
 * junto o Prisma inteiro.
 */
export type ParticipanteDoAssistente = {
  modulo: string;
  avisos(contexto: ContextoSessao, agora: Date): Promise<AvisoDoModulo[]>;
};

export const PARTICIPANTES: ParticipanteDoAssistente[] = [assistenteDoEstoque];
```

- [ ] **Passo 4: Instalar `server-only`**

```bash
npm install server-only
```

- [ ] **Passo 5: Conferir**

```bash
npm run check
```

Esperado: sem erro. Se o linter reclamar de `registro-de-ferramentas.ts` importando módulo, conferir que o arquivo está em `src/` na raiz — o `boundaries/elements` não classifica arquivos soltos da raiz, exatamente como já acontece com `registro-de-apps.ts`.

- [ ] **Passo 6: Commit**

```bash
git add src/core/registry/tipos.ts src/modules/estoque/assistente.ts src/registro-de-ferramentas.ts package.json package-lock.json
git commit -m "Severina: o Estoque declara o que tem a avisar"
```

---

## Task 8: A fila e o disparo

**Arquivos:**

- Criar: `src/modules/assistente/services/fila.ts`
- Criar: `src/modules/assistente/services/disparo.ts`

**Interfaces:**

- Consome: `MAX_POR_RODADA`, `INTERVALO_MS`, `desistiu`, `proximaTentativa` de `../schemas/ritmo`; `deveDispararAgora`, `dentroDaJanela` de `../schemas/gatilho`; `PARTICIPANTES` de `@/registro-de-ferramentas`; `normalizarTelefone` de `@/lib/telefone`; `redigirAviso` de `@/server/ia/gemini`
- Produz:
  - `enfileirar(dados: { conversaId: string; texto: string; origem: string }): Promise<void>`
  - `pendentes(limite: number): Promise<Array<{ id: string; texto: string; telefone: string; tentativas: number }>>`
  - `marcarEnviada(id: string, idExterno: string): Promise<void>`
  - `marcarFalha(id: string, erro: string, tentativas: number): Promise<void>`
  - `dispararAgentes(agora: Date): Promise<number>` — devolve quantas mensagens enfileirou

**Por que `fila.ts` não envia:** `modules/` não pode importar `connectors/`. Quem envia é o relógio, na camada `app/`. A fila só grava e lê.

- [ ] **Passo 1: Escrever `fila.ts`**

Responsabilidades, uma função cada:

- `enfileirar` — cria `MensagemWhatsapp` com `direcao: "SAIDA"`, `status: "PENDENTE"`, `origem`
- `pendentes(limite)` — busca `SAIDA` + `PENDENTE` + (`agendadaPara` nulo ou já passou), ordena por `criadoEm`, `take: limite`, e traz o telefone pelo caminho `conversa → usuario → vinculo`
- `marcarEnviada` — grava `idExterno`, `status: "ENVIADA"`, `enviadaEm`
- `marcarFalha` — incrementa `tentativas`, grava `erro`; se `desistiu(tentativas)` grava `status: "FALHOU"`, senão mantém `PENDENTE` com `agendadaPara: proximaTentativa(...)`

Toda consulta filtra por `organizacaoId`.

- [ ] **Passo 2: Escrever `disparo.ts`**

`dispararAgentes(agora)` faz, em ordem:

1. Busca `AgenteSeverina` com `ativo: true`, `excluidoEm: null`, `tipo: "AVISO"`
2. Para cada um, conforme `gatilho`:
   - `HORARIO` — lê `gatilhoConfig` como `ConfigHorario`; consulta a última `MensagemWhatsapp` cuja `origem` seja `agente:<id>`; chama `deveDispararAgora`
   - `ROTINA_VENCIDA` — percorre `PARTICIPANTES`, chama `avisos(contexto, agora)`; para cada aviso, só segue se **não existir** mensagem com `origem` igual a `agente:<id>:<aviso.chave>` criada hoje
3. Confere `dentroDaJanela(agente.limites, agora)`
4. Resolve os destinatários: `destinatariosUsuarios` mais todos os usuários com `Acesso` ativo cujo papel esteja em `destinatariosPapeis`, na `unidadeId` do agente — **e que tenham `VinculoWhatsapp`**. Sem vínculo, não há para onde mandar
5. Para cada destinatário: acha ou cria `ConversaWhatsapp` (mesma `instancia`, `agente`, `usuario`, estado `ABERTA`)
6. Chama `redigirAviso({ instrucoes: agente.instrucoes, contexto: aviso.assunto })`
7. Chama `enfileirar`

**Cuidado com o contexto:** o disparo roda no relógio, sem usuário logado. `obterContexto()` não serve — ele lê cookie de sessão. Montar um `ContextoSessao` a partir do banco, para o **usuário destinatário**, com as permissões do `Acesso` dele. É o mesmo contexto que a tela usaria; a única diferença é a origem.

- [ ] **Passo 3: Conferir**

```bash
npm run check
```

- [ ] **Passo 4: Commit**

```bash
git add src/modules/assistente/services/
git commit -m "Severina: a fila que não perde mensagem e o disparo que não repete"
```

---

## Task 9: O relógio

**Arquivos:**

- Criar: `src/app/api/severina/tick/route.ts`

**Interfaces:**

- Consome: `dispararAgentes`, `pendentes`, `marcarEnviada`, `marcarFalha` de `@/modules/assistente/services/*`; `enviarTexto` de `@/connectors/whatsapp/evolution`
- Produz: `POST /api/severina/tick`

**Esta é a única costura do sistema.** A camada `app/` é a única que alcança módulo _e_ conector — por isso o envio acontece aqui e não dentro da Severina.

**Antes de escrever:** ler `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`.

- [ ] **Passo 1: Escrever a rota**

```ts
import { NextResponse } from "next/server";

import { enviarTexto } from "@/connectors/whatsapp/evolution";
import {
  marcarEnviada,
  marcarFalha,
  pendentes,
} from "@/modules/assistente/services/fila";
import { dispararAgentes } from "@/modules/assistente/services/disparo";
import {
  INTERVALO_MS,
  MAX_POR_RODADA,
} from "@/modules/assistente/schemas/ritmo";

/**
 * O RELÓGIO DA SEVERINA.
 *
 * Uma tarefa agendada bate aqui a cada minuto. Faz duas coisas, nesta ordem:
 * pergunta quem venceu e enfileira, depois esvaia a fila com ritmo.
 *
 * É a ÚNICA costura entre módulo e conector — a camada `app/` é a única que
 * alcança os dois. Por isso o envio mora aqui, e não dentro da Severina.
 *
 * Disparável à mão de propósito: quando o aviso das 7h não sair, você quer
 * poder rodar e ver o erro, não adivinhar.
 */

const SEGREDO = process.env.SEVERINA_TICK_SEGREDO ?? "";

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(request: Request) {
  // Sem segredo configurado, a rota fica fechada. Endpoint que dispara
  // WhatsApp aberto na internet é problema, não conveniência.
  if (!SEGREDO || request.headers.get("x-severina-segredo") !== SEGREDO) {
    return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  }

  const agora = new Date();
  const enfileiradas = await dispararAgentes(agora);

  let enviadas = 0;
  let falhas = 0;

  const fila = await pendentes(MAX_POR_RODADA);

  for (const [indice, mensagem] of fila.entries()) {
    // Uma de cada vez, com respiro. Rajada é o que faz banir o número.
    if (indice > 0) await espera(INTERVALO_MS);

    const resultado = await enviarTexto(mensagem.telefone, mensagem.texto);

    if (resultado.ok) {
      await marcarEnviada(mensagem.id, resultado.idExterno);
      enviadas++;
    } else {
      await marcarFalha(mensagem.id, resultado.erro, mensagem.tentativas + 1);
      falhas++;
    }
  }

  return NextResponse.json({ enfileiradas, enviadas, falhas });
}
```

- [ ] **Passo 2: Testar à mão, com o servidor rodando**

```bash
npm run dev
```

Noutro terminal:

```bash
curl -X POST http://localhost:3000/api/severina/tick \
  -H "x-severina-segredo: $SEVERINA_TICK_SEGREDO"
```

Esperado: `{"enfileiradas":0,"enviadas":0,"falhas":0}` enquanto não houver agente.

E sem o segredo:

```bash
curl -i -X POST http://localhost:3000/api/severina/tick
```

Esperado: `401`.

- [ ] **Passo 3: Commit**

```bash
npm run check
git add src/app/api/severina/
git commit -m "Severina: o relógio, e a única costura entre módulo e conector"
```

---

## Task 10: O App — manifesto, permissões e telas

**Arquivos:**

- Criar: `src/modules/assistente/permissoes.ts`
- Criar: `src/modules/assistente/manifest.ts`
- Criar: `src/modules/assistente/schemas/agente.ts`
- Criar: `src/modules/assistente/services/agentes.ts`, `vinculos.ts`, `conversas.ts`
- Criar: `src/modules/assistente/acoes.ts`
- Criar: `src/modules/assistente/components/*.tsx`
- Criar: `src/app/(shell)/assistente/page.tsx`, `agentes/page.tsx`, `agentes/novo/page.tsx`, `agentes/[id]/page.tsx`, `vinculos/page.tsx`
- Modificar: `src/registro-de-apps.ts` — trocar o bloco literal de `assistente` por `manifestoSeverina`

**Interfaces:**

- Consome: `pode`, `obterContexto` de `@/core/sessao/contexto`; `SemPermissao` de `@/lib/erros`; `botao.tsx` e `campo.tsx` de `@/design-system`
- Produz: `manifestoSeverina: ManifestoDoApp`

- [ ] **Passo 1: As permissões**

```ts
/**
 * O vocabulário da Severina.
 *
 * A separação que importa: VER conversa é uma coisa; CONFIGURAR agente é
 * outra, bem mais perigosa — quem configura decide o que a Severina fala, para
 * quem, e (nas fases seguintes) o que ela pode escrever no sistema.
 */
export const PERMISSOES_ASSISTENTE = [
  { chave: "assistente.ver", descricao: "Ver conversas da Severina" },
  { chave: "assistente.configurar", descricao: "Criar e alterar agentes" },
  {
    chave: "assistente.vincular",
    descricao: "Ligar números de WhatsApp a pessoas",
  },
] as const;
```

- [ ] **Passo 2: O manifesto**

```ts
import type { ManifestoDoApp } from "@/core/registry/tipos";

import { PERMISSOES_ASSISTENTE } from "./permissoes";

/**
 * Severina.
 *
 * Deixa de ser "atendimento virtual" e passa a ser o que de fato faz na fase
 * 1: falar com a EQUIPE. Cliente é outra conversa, e depende de módulos que
 * ainda não existem.
 *
 * Consolida: uma Severina para a rede inteira, um número só. A loja de cada
 * conversa vem do agente, não do telefone.
 */
export const manifestoSeverina: ManifestoDoApp = {
  chave: "assistente",
  nome: "Severina",
  subtitulo: "Avisos & conversas da equipe",
  icone: "✨",
  cor: { fundo: "#4F46E5", frente: "#FFFFFF" },
  area: "apoio",
  rota: "/assistente",
  navegacao: [
    { rota: "/assistente", nome: "Conversas" },
    {
      rota: "/assistente/agentes",
      nome: "Agentes",
      permissao: "assistente.configurar",
    },
    {
      rota: "/assistente/vinculos",
      nome: "Números",
      permissao: "assistente.vincular",
    },
  ],
  permissaoParaVer: "assistente.ver",
  permissoes: [...PERMISSOES_ASSISTENTE],
  comportamentoNaRede: "consolida",
  emConstrucao: true,
};
```

A rota `/assistente/treinamento` sai da navegação: ela **é** a tela de agentes, com outro nome. Manter as duas criaria a dúvida "configuro em qual?".

`emConstrucao` continua `true` até a tela de agentes estar de pé e um aviso ter saído de verdade.

- [ ] **Passo 3: O Zod do formulário**

```ts
import { z } from "zod";

/**
 * O formulário de agente é onde a regra MOLE × DURO aparece para o usuário.
 * `instrucoes` é texto livre e orienta o modelo. `limites` são campos, e o
 * código os confere antes de agir — o modelo não convence um `if`.
 */
const horario = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use o formato 07:00");

export const esquemaAgente = z.object({
  nome: z.string().trim().min(3, "Dê um nome que você reconheça depois"),
  unidadeId: z.string().nullable(),

  gatilho: z.enum(["HORARIO", "ROTINA_VENCIDA"]),
  horario: horario.optional(),
  diasDaSemana: z.array(z.number().int().min(0).max(6)).default([]),

  destinatariosPapeis: z.array(z.string()).default([]),
  destinatariosUsuarios: z.array(z.string()).default([]),

  instrucoes: z
    .string()
    .trim()
    .min(10, "Escreva o que ela deve dizer, em português")
    .max(2000),

  janelaInicio: horario.optional(),
  janelaFim: horario.optional(),
});

export type DadosAgente = z.infer<typeof esquemaAgente>;
```

- [ ] **Passo 4: Serviços, ações e telas**

Seguir literalmente o padrão de `modules/estoque`:

- `services/agentes.ts` — `listarAgentes`, `obterAgente`, `criarAgente`, `alterarAgente`, `desativarAgente`. Toda função começa com `pode(contexto, "assistente.configurar")` e lança `SemPermissao`
- `services/vinculos.ts` — `listarVinculos`, `criarVinculo` (normaliza com `normalizarTelefone`), `removerVinculo`, `obterInstancia`, `ligarDesligarInstancia`
- `services/conversas.ts` — `listarConversas`, `obterConversa` com as mensagens em ordem
- `acoes.ts` — `"use server"` no topo, uma função por formulário, validando com Zod e chamando o serviço; `revalidatePath` ao fim
- `components/` — `lista-de-agentes.tsx`, `formulario-agente.tsx`, `lista-de-conversas.tsx`, `linha-do-tempo.tsx`, `painel-de-vinculos.tsx`, `chave-geral.tsx` (o botão de desligar)

A tela de conversas mostra, por conversa: pessoa, unidade, agente que originou, última mensagem e status de envio. Mensagem `FALHOU` aparece em destaque — aviso que não saiu é a única falha que importa nesta fase.

- [ ] **Passo 5: Registrar o App**

Em `src/registro-de-apps.ts`, trocar o bloco literal do `assistente` por:

```ts
import { manifestoSeverina } from "@/modules/assistente/manifest";
```

e usar `manifestoSeverina` na posição onde o bloco estava.

- [ ] **Passo 6: Conferir tudo**

```bash
npm run check
```

- [ ] **Passo 7: Commit**

```bash
git add src/modules/assistente/ src/app/\(shell\)/assistente/ src/registro-de-apps.ts
git commit -m "Severina: as telas de agente, número e conversa"
```

---

## Task 11: O relógio no ar

**Arquivos:**

- Modificar: `docs/superpowers/specs/2026-08-04-severina-whatsapp-design.md` — §3, notas de instalação

- [x] **Passo 1: Publicar com as variáveis novas** — 11/09/2026. Menos a IA: `GEMINI_API_KEYS` e `GEMINI_MODELO` não estão no servidor.

No Dokploy, aba Environment do serviço Tetteo, acrescentar:

```bash
EVOLUTION_URL=http://evolution_api:8080
EVOLUTION_API_KEY=<a chave>
EVOLUTION_INSTANCIA=severina-teste
SEVERINA_TICK_SEGREDO=<gerado>
GEMINI_API_KEY=<do AI Studio>
GEMINI_MODELO=<confirmado na doc do Google>
```

- [x] **Passo 2: Agendar o relógio** — 11/09/2026, no Schedules do Dokploy, com `wget` em `127.0.0.1` dentro do contêiner. O `curl` abaixo não existe na imagem.

Tarefa agendada no Dokploy, a cada minuto:

```bash
curl -fsS -X POST http://tetteo:3000/api/severina/tick \
  -H "x-severina-segredo: $SEVERINA_TICK_SEGREDO"
```

Se o agendador do Dokploy não servir, um contêiner de cron na mesma rede resolve.

- [x] **Passo 3: A prova de fogo** — 11/09/2026. Quem provou foi um agente de rotina, não o de horário do roteiro: "A contagem "contagem freezer" é para hoje."

1. Criar um vínculo ligando o seu usuário ao seu número
2. Criar um agente de AVISO, gatilho HORARIO, para dali a dois minutos, com instruções curtas
3. Esperar
4. A mensagem tem que chegar no WhatsApp, e a conversa tem que aparecer em `/assistente`

- [x] **Passo 4: Registrar o resultado no spec e commitar** — 11/09/2026.

```bash
git add docs/
git commit -m "Severina: a fase 1 no ar, e o primeiro aviso que saiu sozinho"
```

---

## Auto-revisão

**Cobertura do spec (fase 1):** as 5 tabelas → Task 1. Conector de envio → Task 5. Redator → Task 6. Relógio, fila e ritmo → Tasks 4, 8, 9. `avisos` do Estoque e registro de composição → Task 7. Telas de agente, conversa, vínculo e botão de desligar → Task 10. Vínculo LID↔telefone → Tasks 1 e 2.

**Fora desta fase, por desenho:** webhook de entrada, ferramentas de escrita, confirmação por palavra-chave, áudio, foto (bloqueada pelo armazenamento — ver `2026-08-04-onde-os-arquivos-moram.md`), tipos COLETA e MODULO.

### Três pontos de atenção para quem executa

**1 · Com qual contexto o módulo é consultado.** `listarRotinas` exige `estoque.ver`. Se o disparo perguntar ao Estoque usando o contexto do **destinatário**, um colaborador sem essa permissão faz `SemPermissao` estourar e derruba a rodada inteira — inclusive os avisos de quem tinha permissão.

A pergunta "tem aviso para dar?" é sobre a **unidade**, não sobre a pessoa. Consultar uma vez por unidade do agente, com um contexto montado a partir do usuário que **criou** o agente, e envolver a chamada em `try/catch` que registra o erro e segue para o próximo módulo. Um módulo quebrado não pode calar a Severina inteira.

**2 · A Task 8 é a maior e a única sem teste automatizado**, porque é toda de banco. Se crescer demais, o corte natural é separar "quem vence" (`disparo.ts`) de "para quem mandar" (`destinatarios.ts`).

**3 · A Task 10 é a menos detalhada deste plano.** Serviços, ações e telas estão descritos por responsabilidade, não por código — porque são CRUD e seguem literalmente `modules/estoque` e `modules/checklists`, que já resolveram o mesmo problema duas vezes. Quem for executá-la deve **ler os dois antes de começar** e, se preferir, quebrá-la em três: serviços, ações, telas. Ela é a candidata natural a virar um plano próprio.
