# Compras — do pedido da loja ao recebimento: plano de implementação

> **Para agentes:** executar tarefa a tarefa (superpowers:executing-plans). Passos com `- [ ]`.
> Desenho: `docs/superpowers/specs/2026-09-10-compras-fluxo-design.md` — este plano não repete as regras de lá; aponta para a seção (§) quando precisa.

**Objetivo:** fluxo completo de compras — rodada, requisição da loja, cotação com link do fornecedor, comparação que conta frete e embalagem, aprovação com alçada, snapshot, adendo, fila de envio durável, conferência de recebimento que dá entrada pela nota de entrada.

**Arquitetura:** o App `compras` evolui (mesmas tabelas, novos campos e tabelas). Regras puras em `modules/compras/schemas/` (testadas com `node:test`); banco em `modules/compras/services/`; costuras com Estoque e Financeiro na camada `app/` (única que enxerga dois Apps), usando serviços que aceitam o cliente da transação. Envio por conector em `src/connectors/fornecedores/`, chamado só pelo relógio em `app/api/compras/tick`.

**Stack:** Next.js 16.3 (App Router, Server Actions, `proxy.ts`), React 19, Prisma 7 + `@prisma/adapter-pg`, PostgreSQL 18, Zod 4, Tailwind 4, `tsx --test`.

## Restrições globais

- Um App nunca importa de outro App (`eslint.config.mjs`). Costura só em `src/app/**`.
- Core não importa módulo. Conector não importa módulo.
- Dinheiro em centavos inteiros; quantidade em milésimos; fator em décimos de milésimo; contas com `BigInt`. Nunca `Number` para somar dinheiro.
- Toda consulta passa pelo `ContextoSessao`; id de outra loja é recusado no servidor.
- Auditoria (`db.auditoria`) em toda mudança de estado.
- Nenhuma mensagem real sai em teste: canal `simulador` por padrão; o conector WhatsApp recusa com `NODE_ENV=test`.
- Texto de interface em português, com verbo nos botões: **Enviar requisição**, **Revisar propostas**, **Aprovar pedido**, **Conferir recebimento**.
- Visual: `DESIGN.md` (Aurora), componentes de `src/design-system/`.
- Antes de cada tarefa com código Next, conferir o guia em `node_modules/next/dist/docs/` (regra do `AGENTS.md`).
- Verificação por tarefa: `npm run typecheck`, `npm run lint`, `npm run test`; tarefas com banco também `npm run test:integracao`.
- Commits pequenos, mensagem em português no estilo do repositório, com o `Co-Authored-By`.

## Mapa de arquivos

```
prisma/schema/compras.prisma                 reescrito (§1 do desenho)
prisma/schema/estoque.prisma                 + NotaEntrada.recebimentoId/pedidoId, + DEVOLUCAO
prisma/schema/core.prisma                    + Arquivo
prisma/schema/cardapio.prisma                contra-relações do Insumo
prisma/schema/migrations/20260910120000_compras_fluxo/migration.sql

src/core/sessao/permissao.ts                 `pode()` sem dependência do Next (testes)
src/server/arquivos.ts                       gravar/ler arquivo privado
src/app/api/arquivos/route.ts                POST (envio)  ·  [id]/route.ts GET (entrega)

src/modules/compras/
  manifest.ts, permissoes.ts                 navegação e vocabulário novos
  schemas/aritmetica.ts (+test)              centavos, milésimos, arredondamento
  schemas/embalagem.ts (+test)               fator por dimensão
  schemas/rodada.ts (+test)                  estados, transições, semana ISO
  schemas/sugestao.ts (+test)                sugestão de compra
  schemas/link.ts (+test)                    validade do link
  schemas/proposta.ts (+test)                validação da resposta (zod)
  schemas/comparacao.ts (+test)              grade e menor custo total
  schemas/pedido.ts (+test)                  linhas, arredondamento de embalagem, total
  schemas/alcada.ts (+test)                  qual alçada vale
  schemas/ritmo-envio.ts (+test)             novas tentativas
  schemas/mensagens.ts (+test)               texto das mensagens
  schemas/recebimento.ts (+test)             validação da conferência
  services/auditoria.ts                      registrar()
  services/rodadas.ts, agenda.ts, requisicoes.ts
  services/fornecedores.ts, produtos-do-fornecedor.ts
  services/solicitacoes.ts, cripto-do-link.ts, propostas.ts
  services/comparacao.ts, pedidos.ts, alcadas.ts, alteracoes.ts
  services/fila.ts, canal.ts
  services/recebimentos.ts, divergencias.ts
  integracao/*.integracao.ts                 testes com banco real
  components/…                               telas

src/modules/estoque/services/notas.ts        + funções com transação
src/modules/estoque/services/cmv.ts          desconta DEVOLUCAO
src/connectors/fornecedores/{contrato,simulador,whatsapp,index}.ts
src/connectors/whatsapp/evolution.ts         instância por parâmetro
src/app/api/compras/tick/route.ts            relógio
src/app/fornecedor/cotacao/{page,formulario,acoes}.tsx   página pública
src/app/(shell)/compras/**                    telas
src/app/(shell)/compras/recebimento/acoes.ts orquestrador da transação
src/app/(shell)/estoque/acoes-da-despensa.ts  lista → requisição
src/proxy.ts                                 exceções: api/compras/tick, fornecedor/
scripts/ambiente-de-teste.ts                 DATABASE_URL_TESTE para integração
prisma/compras-demo.ts                       dados fictícios
docs/compras/README.md                       instalação, operação, recuperação
DESIGN.md                                    seção de Compras
```

---

## Fase A — Fundação

### Tarefa A1: `pode()` sem Next e o banco de teste

**Arquivos:** criar `src/core/sessao/permissao.ts`, `scripts/ambiente-de-teste.ts`, `src/modules/compras/integracao/cenario.ts`; modificar `src/core/sessao/contexto.ts` (reexporta `pode`), `package.json`.

**Interfaces produzidas:**

- `pode(contexto: Pick<ContextoSessao,"permissoes">, chave: string): boolean` em `@/core/sessao/permissao`.
- `npm run test:integracao` → `tsx --conditions=react-server --import ./scripts/ambiente-de-teste.ts --test "src/**/*.integracao.ts"`. O script lê `.env.local`, recusa se `DATABASE_URL_TESTE` faltar, e faz `DATABASE_URL = DATABASE_URL_TESTE` antes de qualquer import do `db`. Recusa também se a URL não for `localhost`.
- `cenario.ts`: `limparBanco()` (TRUNCATE de todas as tabelas de negócio, `CASCADE`), `criarCenario()` → `{ org, centro, sul, diretor, gerenteCentro, gerenteSul, compradorRede, ctx(usuario, unidade|null) → ContextoSessao, insumos: {mussarela(KG), molho(KG), embalagem(UN), oleo(L)}, fornecedores: {a, b, c}, locais: {depositoCentro, depositoSul} }`. Todos fictícios.

- [ ] Mover `pode` para `permissao.ts`; `contexto.ts` passa a `export { pode } from "./permissao"`.
- [ ] Criar o script de ambiente e o `cenario.ts`; migrar o banco de teste com `DATABASE_URL=$DATABASE_URL_TESTE npx prisma migrate deploy`.
- [ ] Teste de fumaça `integracao/cenario.integracao.ts`: `criarCenario()` duas vezes seguidas com `limparBanco()` no meio não falha.
- [ ] `npm run typecheck && npm run lint && npm run test:integracao` → verde. Commit.

### Tarefa A2: aritmética exata

**Arquivo:** `src/modules/compras/schemas/aritmetica.ts` (+ `.test.ts`).

**Interfaces produzidas:**

```ts
export type Centavos = bigint; // R$ 1,00 = 100n
export type Milesimos = bigint; // 1 kg = 1000n (quantidade na unidade de estoque)
export type DezMilesimos = bigint; // fator 10,8 = 108000n
export type Micros = bigint; // preço por unidade: R$ 1,00 = 1_000_000n

export function centavosDe(valor: string | number): Centavos; // "12,50" | 12.5 → 1250n; recusa NaN/negativo? não: aceita negativo só se permitido pelo chamador
export function milesimosDe(valor: string | number): Milesimos;
export function dezMilesimosDe(valor: string | number): DezMilesimos;
export function decimalDeCentavos(c: Centavos): string; // 1250n → "12.50" (para o Prisma)
export function decimalDeMilesimos(m: Milesimos): string; // 6500n → "6.500"
export function decimalDeDezMilesimos(f: DezMilesimos): string;
export function dividirArredondando(
  numerador: bigint,
  denominador: bigint,
): bigint; // meio para cima, positivo
export function totalAGranel(q: Milesimos, precoPorUnidade: Centavos): Centavos; // ⌊q·p/1000 + ½⌋
export function embalagensNecessarias(
  q: Milesimos,
  fator: DezMilesimos,
): bigint; // ⌈q·10/fator⌉
export function quantidadeDeEmbalagens(
  n: bigint,
  fator: DezMilesimos,
): Milesimos; // n·fator/10 (exato quando fator tem até 3 casas; senão arredonda meio para cima)
export function precoPorUnidade(
  precoEmbalagem: Centavos,
  fator: DezMilesimos,
): Micros; // p·10⁴·10⁴/fator/10⁰… — ver teste
export function somar(...v: bigint[]): bigint;
```

**Testes (escrever antes):**

- `centavosDe("12,50") === 1250n`, `centavosDe(0.1 + 0.2)` → `30n`, `centavosDe("1.234,56") === 123456n`.
- `totalAGranel(6537n, 3190n) === 20853n` (6,537 kg × R$ 31,90 = 208,5303 → R$ 208,53); `totalAGranel(5n, 100n) === 1n` (0,005 → 0,01, meio para cima).
- `embalagensNecessarias(20000n, 108000n) === 2n` (20 kg em caixas de 10,8 kg); `embalagensNecessarias(10800n, 108000n) === 1n`.
- `quantidadeDeEmbalagens(2n, 108000n) === 21600n` (21,6 kg).
- `precoPorUnidade(30000n, 100000n) === 30_000_000n` (caixa 10 kg por R$ 300 → R$ 30,00/kg).

- [ ] Teste falhando → implementação → verde → commit.

### Tarefa A3: o fator da embalagem

**Arquivo:** `src/modules/compras/schemas/embalagem.ts` (+ `.test.ts`). Usa `converter` de `@/lib/unidades`.

**Interfaces produzidas:**

```ts
export type Embalagem = {
  pecas: number; // 12
  conteudo: number | null; // 900
  unidadeConteudo: Unidade | null; // "G"
  fracionavel: boolean; // a granel
};
export type ResultadoDoFator =
  | { ok: true; fator: DezMilesimos; descricao: string } // "Caixa 12 × 900 g = 10,8 kg"
  | {
      ok: false;
      motivo: "incompativel" | "desconhecido" | "invalido";
      mensagem: string;
    };
export function fatorDaEmbalagem(base: Unidade, e: Embalagem): ResultadoDoFator;
export function descreverEmbalagem(e: Embalagem): string; // "12 × 900 g"
```

Regras (§4 do desenho): base UN → fator = peças (conteúdo é só descrição). Base de massa/volume: conteúdo da mesma família → peças × conteúdo convertido; conteúdo nulo ou UN → `desconhecido`; família diferente → `incompativel`. Fracionável → fator 1 na base (a granel) quando `pecas=1` e conteúdo nulo. Peças ≤ 0 ou conteúdo ≤ 0 → `invalido`.

**Testes:** 12 × 900 g em KG = `108000n`; 12 × 900 g em UN = `120000n`; Caixa 100 un em UN = `1000000n`; "Caixa com 12" (sem conteúdo) em KG → desconhecido; 6 × 2 L em KG → incompatível; 6 × 2 L em L = `120000n`; 25 kg em G = `250000000n`.

- [ ] Teste → implementação → verde → commit.

### Tarefa A4: o banco novo

**Arquivos:** reescrever `prisma/schema/compras.prisma`; modificar `estoque.prisma`, `core.prisma`, `cardapio.prisma`; criar a migração à mão; apagar o código de Compras que usa os modelos antigos (`services/cotacoes.ts`, `schemas/comparacao.ts` antigo e teste, `schemas/entradas.ts`, componentes `editor-de-cotacao`, `grade-de-comparacao`, `lancar-proposta`, páginas `compras/cotacoes/**`, `compras/[id]`); substituir as páginas por uma tela provisória de "Compras em reconstrução" até a Fase H; em `acoes-da-despensa.ts`, a ação devolve `{ erro: "…" }` até a Tarefa H3.

Modelos (campos exatos no arquivo; regras no desenho §1–§7):
`Fornecedor` (+ `telefonePedidos`, `autorizadoMensagens`, `autorizadoPorId`, `autorizadoEm`), `FornecedorInsumo`, `AgendaDeRodada`, `RodadaDeCompra` (+ `numero` autoincremento), `Requisicao`, `ItemDeRequisicao`, `ItemDaRodada`, `SolicitacaoDeCotacao`, `ItemDaSolicitacao`, `VersaoDeProposta`, `ItemDeProposta`, `EscolhaDeItem`, `AlcadaDeCompra`, `AprovacaoDeCompra`, `Pedido` (+ `numero` autoincremento, `organizacaoId`, `rodadaId`, `pedidoOrigemId`, `sequencia`, `ultimaSequencia`, `versao`, snapshot, `confirmacao…`, `situacaoRecebimento`), `ItemDePedido` (+ snapshot), `AlteracaoDePedido`, `ItemDeAlteracao`, `CanalDeCompras`, `MensagemAoFornecedor`, `Recebimento`, `ItemDeRecebimento`, `DivergenciaDeCompra`; Core `Arquivo`; Estoque `NotaEntrada.recebimentoId @unique`, `NotaEntrada.pedidoId`, `TipoDeMovimento.DEVOLUCAO`, `MovimentoEstoque.recebimentoId`.

Migração: cria tipos e tabelas novas; converte `cotacao` → `rodada_de_compra` (mesmo id, `organizacaoId` pela unidade, `ABERTA→COTANDO`, `FECHADA→FECHADA`, `CANCELADA→CANCELADA`, uma `requisicao` ENVIADA da unidade), `item_de_cotacao` → `item_da_rodada` + `item_de_requisicao`, `proposta_de_cotacao` → `solicitacao_de_cotacao` (+ `item_da_solicitacao` para cada item) + `versao_de_proposta` nº 1 quando respondida, `preco_proposto` → `item_de_proposta` (embalagem livre vira `pecas=1`, conteúdo = fator, unidade = base do insumo; `naoAtende` → `INDISPONIVEL`), `pedido` (status `ENVIADO→APROVADO` com `enviadoManualmenteEm`, `RECEBIDO→CONCLUIDO`, `cotacaoId`→`rodadaId`), `item_de_pedido` (preenche snapshot pelo insumo). Remove as tabelas e tipos antigos. Índices únicos parciais em SQL: um fornecedor fixo ativo por insumo; uma alçada vigente por papel.

- [ ] Escrever os schemas; `npx prisma validate`.
- [ ] Gerar o esqueleto com `npx prisma migrate diff --from-migrations … --to-schema … --script` e completar à mão a conversão de dados.
- [ ] Aplicar no banco particular (que tem as cotações de demonstração antigas, se houver) e no de teste; conferir contagens antes/depois.
- [ ] Remover o código antigo e pôr as telas provisórias; `npm run typecheck && npm run lint && npm run test` verde. Commit.

---

## Fase B — Rodada e requisição

### Tarefa B1: estados e semana (puro)

**Arquivo:** `schemas/rodada.ts` (+test).

```ts
export const ESTADOS_DA_RODADA = [
  "RASCUNHO",
  "COLETANDO",
  "COTANDO",
  "REVISAO",
  "APROVADA",
  "DESPACHANDO",
  "FECHADA",
  "CANCELADA",
] as const;
export type EstadoDaRodada = (typeof ESTADOS_DA_RODADA)[number];
export function transicaoPermitida(
  de: EstadoDaRodada,
  para: EstadoDaRodada,
): { ok: true; exigeMotivo: boolean } | { ok: false; mensagem: string };
export function ocorrenciaDaSemana(momento: Date, fuso: string): string; // "2026-W37"
export function aberturaDaSemana(
  agenda: { diaDaSemana: number; horaAbertura: string },
  momento: Date,
  fuso: string,
): Date;
export const ROTULO_DO_ESTADO: Record<EstadoDaRodada, string>; // "Coletando requisições"…
```

Transições: avanço em ordem; `CANCELADA` de qualquer estado exceto `FECHADA`; reaberturas `REVISAO→COTANDO`, `FECHADA→DESPACHANDO`, `APROVADA→REVISAO` com motivo; o resto recusa.
**Testes:** avanço válido; salto `RASCUNHO→COTANDO` recusado; reabertura exige motivo; 2026-01-01 (quinta) → `2026-W01`; 2026-12-31 → `2026-W53`; domingo 23h30 em São Paulo com servidor em UTC cai na semana certa.

### Tarefa B2: sugestão (puro)

**Arquivo:** `schemas/sugestao.ts` (+test).

```ts
export type EntradaDaSugestao = {
  minimo: Milesimos | null;
  disponivel: Milesimos | null;
  emPedidoAberto: Milesimos;
  ultimaAtualizacao: Date | null;
  agora: Date;
  unidade: string;
};
export type Sugestao = {
  quantidade: Milesimos | null;
  formula: string | null;
  alertas: string[];
};
export function sugerirCompra(e: EntradaDaSugestao): Sugestao;
export const DIAS_PARA_SALDO_VELHO = 7;
```

**Testes:** 15 − 3,5 − 5 = 6,5 kg com fórmula "mínimo 15 kg − disponível 3,5 kg − em pedido 5 kg = 6,5 kg"; sem mínimo → `quantidade null` + alerta "sem mínimo cadastrado"; nunca contado → `null` + alerta; saldo de 12 dias → quantidade calculada + alerta "saldo de 12 dias atrás"; conta ≤ 0 → `null` + "pela conta, não precisa (sobram 2 kg)". Nunca devolve `0n`.

### Tarefa B3: serviço de rodadas

**Arquivos:** `services/auditoria.ts`, `services/rodadas.ts`, `integracao/rodadas.integracao.ts`.

```ts
// auditoria.ts
export async function registrar(
  cliente: Prisma.TransactionClient | typeof db,
  ctx: ContextoSessao | null,
  dados: {
    entidade: string;
    entidadeId: string;
    acao: "CRIOU" | "ALTEROU" | "EXCLUIU";
    unidadeId?: string | null;
    antes?: unknown;
    depois?: unknown;
    organizacaoId?: string;
  },
): Promise<void>;
// rodadas.ts
export async function criarRodada(
  ctx,
  dados: {
    descricao: string;
    unidadeIds: string[];
    prazoRequisicao: Date;
    prazoCotacao: Date;
    entregaDe: Date | null;
    entregaAte: Date | null;
    responsavelId: string | null;
  },
): Promise<{ id: string }>;
export async function listarRodadas(
  ctx,
  filtro: { unidadeId?: string; estado?: EstadoDaRodada; busca?: string },
): Promise<ResumoDaRodada[]>;
export async function obterRodada(
  ctx,
  id: string,
): Promise<RodadaCompleta | null>;
export async function moverRodada(
  ctx,
  id: string,
  dados: { versao: number; para: EstadoDaRodada; motivo?: string },
): Promise<void>; // condicional; ao entrar em COTANDO consolida (na mesma transação)
export class RodadaMudou extends Error {} // "A rodada mudou enquanto você olhava: agora está em X (por Fulano, HH:MM)."
```

Permissão `compras.rodadas` para criar/mover; `compras.ver` para ler. Loja sem visibilidade é recusada em `unidadeIds`.
**Testes de integração:** duas chamadas `moverRodada` com a mesma versão em paralelo → uma passa, outra `RodadaMudou`; consolidação soma Centro + Sul por insumo e ignora requisição em rascunho; item com fornecedor fixo vira `DIRECIONADO`; reabrir sem motivo recusado; gerente de loja não cria rodada.

### Tarefa B4: serviço de requisição

**Arquivos:** `services/requisicoes.ts`, `integracao/requisicoes.integracao.ts`.

```ts
export async function requisicaoDaLoja(
  ctx,
  rodadaId: string,
): Promise<RequisicaoCompleta>; // exige unidade ativa participante
export async function sugestoesDaLoja(
  ctx,
  rodadaId: string,
): Promise<LinhaSugerida[]>; // lê posição, contagem, notas e pedidos abertos da loja
export async function salvarItem(
  ctx,
  requisicaoId: string,
  dados: {
    insumoId: string;
    quantidade: string;
    embalagemPreferida: string | null;
    observacao: string | null;
    sugestao: Sugestao | null;
  },
): Promise<void>;
export async function removerItem(
  ctx,
  requisicaoId: string,
  itemId: string,
): Promise<void>;
export async function enviarRequisicao(
  ctx,
  requisicaoId: string,
  versao: number,
): Promise<void>;
export async function devolverRequisicao(
  ctx,
  requisicaoId: string,
  motivo: string,
): Promise<void>; // compras.rodadas
export async function adicionarDaDespensa(
  ctx,
  itens: { insumoId: string; quantidade: string; origem: string | null }[],
): Promise<{ rodadaId: string; requisicaoId: string }>; // rodada COLETANDO que inclui a loja
```

**Testes:** gerente do Sul não lê nem grava requisição do Centro; enviada não aceita item; rodada fora de COLETANDO não aceita envio; quantidade vazia ou zero recusada; `adicionarDaDespensa` sem rodada aberta → erro claro.

### Tarefa B5: agenda e abertura automática

**Arquivos:** `services/agenda.ts`, `integracao/agenda.integracao.ts`.

```ts
export async function salvarAgenda(ctx, dados): Promise<void>; // compras.rodadas; sobe versao
export async function listarAgendas(ctx): Promise<Agenda[]>;
export async function abrirRodadasAgendadas(agora: Date): Promise<number>; // sem contexto; createMany skipDuplicates por (agendaId, ocorrencia)
```

**Testes:** duas chamadas simultâneas no mesmo minuto → 1 rodada; mudar o dia da agenda na mesma semana e chamar de novo → continua 1; semana seguinte → 2.

---

## Fase C — Fornecedor, solicitação e link

### Tarefa C1: fornecedor e produto do fornecedor

**Arquivos:** `services/fornecedores.ts` (atualiza), `services/produtos-do-fornecedor.ts`.
Telefone de pedidos normalizado por `normalizarTelefone` (`@/lib/telefone`); autorizar exige `compras.fornecedores` e grava quem/quando; `FornecedorInsumo` com embalagem estruturada (fator por `fatorDaEmbalagem`, recusa `ok:false`), `fixo`, preço de referência com origem e data; marcar fixo quando já há outro fixo ativo → erro "Mussarela já tem fornecedor fixo: Laticínio Exemplo".

### Tarefa C2: o link (cripto + validade)

**Arquivos:** `services/cripto-do-link.ts` (Node `crypto`), `schemas/link.ts` (+test).

```ts
export function novoCodigo(): { codigo: string; hash: string; cifrado: string };
export function hashDoCodigo(codigo: string): string;
export function decifrar(cifrado: string): string; // HKDF(AUTH_SECRET, "compras-link") + AES-256-GCM
// schemas/link.ts
export function situacaoDoLink(
  s: {
    expiraEm: Date;
    revogadoEm: Date | null;
    tentativasInvalidas: number;
    versoes: number;
    ultimoEnvioEm: Date | null;
  },
  agora: Date,
): "valido" | "vencido" | "revogado" | "bloqueado" | "aguarde" | "limite";
```

**Testes:** cifrar/decifrar volta o mesmo; hash de 64 hex; vencido, revogado, 10 inválidos → bloqueado, envio há 5 s → aguarde, 30 versões → limite.

### Tarefa C3: solicitações

**Arquivo:** `services/solicitacoes.ts`.

```ts
export async function prepararSolicitacoes(
  ctx,
  rodadaId: string,
): Promise<number>; // na entrada em COTANDO: elegíveis por FornecedorInsumo; fixo recebe os seus DIRECIONADOS
export async function incluirFornecedor(
  ctx,
  rodadaId: string,
  fornecedorId: string,
  itemIds: string[],
): Promise<void>;
export async function convidar(ctx, solicitacaoId: string): Promise<void>; // gera código, enfileira CONVITE_COTACAO (corpo com {{LINK}}), estado CONVIDADO
export async function revogarLink(
  ctx,
  solicitacaoId: string,
  motivo: string,
): Promise<void>;
export async function reemitirLink(ctx, solicitacaoId: string): Promise<void>;
export async function linkParaCopiar(
  ctx,
  solicitacaoId: string,
): Promise<string>; // audita "link copiado"
export async function encerrarCotacao(tx, rodadaId: string): Promise<void>; // chamada por moverRodada ao ir a REVISAO
```

### Tarefa C4: propostas e versões

**Arquivos:** `schemas/proposta.ts` (+test, zod), `services/propostas.ts`, `integracao/propostas.integracao.ts`.

```ts
export const esquemaDaResposta: z.ZodType<RespostaDoFornecedor>; // frete|null, minimo|null, prazoDias|null, validaAte|null, observacao ≤ 500, itens[{ itemDaSolicitacaoId, situacao: "COTADO"|"INDISPONIVEL", pecas, conteudo|null, unidadeConteudo|null, fracionavel, precoEmbalagem (string "12,50"), disponivel|null, observacao ≤ 300 }]
export async function registrarPeloLink(
  codigo: string,
  bruto: unknown,
): Promise<{ ok: true; versao: number } | { ok: false; erro: string }>;
export async function registrarPeloComprador(
  ctx,
  solicitacaoId: string,
  bruto: unknown,
  origem: "COMPRADOR_DIGITOU" | "NEGOCIACAO",
  motivo?: string,
): Promise<{ versao: number }>;
export async function autorizarPrecoZero(
  ctx,
  itemDePropostaId: string,
  motivo: string,
): Promise<void>;
export async function dadosDoLink(
  codigo: string,
): Promise<
  | VistaDoFornecedor
  | { erro: "vencido" | "revogado" | "invalido" | "bloqueado" }
>; // só o que é dele
```

**Testes:** item de outra solicitação → recusado e conta tentativa inválida; preço "0" pelo link → recusado; link vencido/revogado → erro; resposta depois de encerrada pelo link → recusada; pelo comprador com NEGOCIACAO e motivo → versão nova; versões preservadas (v1 e v2 existem); fator desconhecido é aceito mas marcado.

### Tarefa C5: página pública do fornecedor

**Arquivos:** `src/app/fornecedor/cotacao/page.tsx` (casca mínima, `metadata.robots = noindex`, `referrer: "no-referrer"`), `formulario.tsx` (cliente: lê `location.hash`, chama as ações, nunca coloca o código na URL do servidor), `acoes.ts` (`"use server"`: `abrir(codigo)`, `responder(codigo, dados)`); `src/proxy.ts` exceção `fornecedor/`.
Conferir no navegador: sem login abre; código errado mostra "Este link não vale mais — peça outro a quem enviou"; o formulário não perde o que foi digitado em erro.

---

## Fase D — Comparação

### Tarefa D1: comparação pura

**Arquivo:** `schemas/comparacao.ts` (+test). Substitui a de 04/08.

```ts
export type ItemParaComparar = {
  id: string;
  nome: string;
  unidade: Unidade;
  modo: "COTAVEL" | "DIRECIONADO";
  porLoja: { unidadeId: string; quantidade: Milesimos }[];
};
export type OfertaDoItem = {
  itemId: string;
  situacao: "COTADO" | "INDISPONIVEL";
  fator: DezMilesimos | null;
  fatorMotivo: string | null;
  fracionavel: boolean;
  precoEmbalagem: Centavos;
  precoZeroAutorizado: boolean;
  disponivel: Milesimos | null;
};
export type PropostaParaComparar = {
  fornecedorId: string;
  nome: string;
  frete: Centavos | null;
  minimo: Centavos | null;
  prazoDias: number | null;
  ofertas: OfertaDoItem[];
};
export type Celula = {
  fornecedorId: string;
  estado:
    | "cotado"
    | "sem-resposta"
    | "indisponivel"
    | "conferir-fator"
    | "zero-sem-autorizacao"
    | "disponibilidade-insuficiente";
  precoPorUnidade: Micros | null;
  embalagens: bigint | null;
  comprado: Milesimos | null;
  adicional: Milesimos | null;
  custoAdicional: Centavos | null;
  total: Centavos | null;
  menorCustoDoItem: boolean;
};
export type Grade = {
  linhas: { item: ItemParaComparar; celulas: Celula[] }[];
  fornecedores: TotalDoFornecedor[];
};
export function montarGrade(
  itens: ItemParaComparar[],
  propostas: PropostaParaComparar[],
): Grade;
export type Sugestao = {
  escolhas: Map<string, string>;
  total: Centavos;
  fornecedores: string[];
  fora: { fornecedorId: string; motivo: string }[];
  metodo: "combinacoes" | "por-item";
} | null;
export function sugerirMenorCusto(
  itens: ItemParaComparar[],
  propostas: PropostaParaComparar[],
): Sugestao;
```

**Testes (dados fictícios):**

1. Item DIRECIONADO não aparece na grade da disputa.
2. Sem resposta ≠ indisponível ≠ zero: três estados distintos; zero sem autorização não é vencedor.
3. Unidade incompatível → `conferir-fator`, fora do vencedor e da sugestão.
4. 20 kg em caixa de 10,8 kg → 2 caixas, adicional 1,6 kg com custo mostrado.
5. Mínimo por loja não atendido → combinação descartada.
6. **Frete troca o vencedor**: A mais barato por item, mas frete de A (R$ 80) faz B ganhar no total.
7. Fornecedor sem frete informado → em `fora`, nunca vence.
8. Arredondamento: soma de linhas arredondadas + frete bate com o total do fornecedor ao centavo.
9. Dois fornecedores para duas lojas: frete contado por loja atendida.

### Tarefa D2: serviço da comparação e escolhas

**Arquivo:** `services/comparacao.ts`, `integracao/comparacao.integracao.ts`.

```ts
export async function compararRodada(
  ctx,
  rodadaId: string,
): Promise<{
  grade: Grade;
  sugestao: Sugestao;
  escolhas: EscolhaSalva[];
  direcionados: LinhaDirecionada[];
}>;
export async function escolher(
  ctx,
  rodadaId: string,
  dados: {
    itemDaRodadaId: string;
    fornecedorId: string;
    justificativa: string | null;
  },
): Promise<void>; // justificativa obrigatória se ≠ sugestão; recusa célula não comparável
export async function colocarEmDisputa(
  ctx,
  itemDaRodadaId: string,
  motivo: string,
): Promise<void>;
```

---

## Fase E — Pedido e aprovação

### Tarefa E1: linhas e alçada (puro)

**Arquivos:** `schemas/pedido.ts`, `schemas/alcada.ts` (+tests).

```ts
export function montarLinhas(
  entradas: {
    insumo: { id; nome; unidade };
    necessario: Milesimos;
    fator: DezMilesimos;
    fracionavel: boolean;
    precoEmbalagem: Centavos;
    origemPreco: string;
  }[],
): { linhas: LinhaDoPedido[]; subtotal: Centavos };
export function conferirTotal(
  linhas: LinhaDoPedido[],
  frete: Centavos,
  total: Centavos,
): boolean;
export function alcadaQueAprova(
  alcadas: { id; papelId; limite: Centavos | null; versao }[],
  papeisDaPessoa: string[],
  total: Centavos,
): { id; versao } | null;
```

**Testes:** caixa inteira sem arredondamento de dinheiro; granel arredonda por linha; `conferirTotal` pega diferença de 1 centavo; alçada sem limite aprova tudo; limite R$ 1.000 não aprova R$ 1.000,01; papel sem alçada → null.

### Tarefa E2: gerar, aprovar, recusar

**Arquivos:** `services/pedidos.ts` (reescrito), `services/alcadas.ts`, `integracao/pedidos.integracao.ts`.

```ts
export async function gerarPedidos(ctx, rodadaId: string): Promise<string[]>; // de EscolhaDeItem + direcionados; um por loja×fornecedor; snapshot completo; AGUARDANDO_APROVACAO; rodada → REVISAO mantém, vira APROVADA quando nenhum pendente
export async function aprovarPedido(
  ctx,
  pedidoId: string,
  versao: number,
): Promise<void>; // transação: update condicional + AprovacaoDeCompra + enfileirar(PEDIDO) + auditoria + rodada DESPACHANDO
export async function recusarPedido(
  ctx,
  pedidoId: string,
  versao: number,
  motivo: string,
): Promise<void>;
export async function registrarConfirmacao(
  ctx,
  pedidoId: string,
  dados: {
    confirmacao: "CONFIRMADO" | "CONFIRMADO_COM_RESSALVA" | "RECUSADO";
    texto: string;
  },
): Promise<void>;
export async function listarPedidos(ctx, filtro): Promise<ResumoDoPedido[]>;
export async function obterPedido(
  ctx,
  id: string,
): Promise<PedidoCompleto | null>;
export async function salvarAlcada(
  ctx,
  papelId: string,
  limite: string | null,
): Promise<void>; // compras.configurar; nova versão, encerra a vigente
```

**Testes:** duas aprovações simultâneas → uma passa, uma recebe "já foi aprovado por…"; gerente sem alçada → pendente com mensagem; alçada de R$ 1.000 contra pedido de R$ 1.200 → recusa; pedido aprovado não aceita edição de item; mudar preço do insumo/telefone do fornecedor depois não muda o pedido; gerente do Sul não aprova pedido do Centro.

### Tarefa E3: adendo e alteração

**Arquivo:** `services/alteracoes.ts`, testes em `pedidos.integracao.ts`.

```ts
export async function criarAdendo(
  ctx,
  pedidoOrigemId: string,
  itens: { insumoId: string; necessario: string }[],
  motivo: string,
): Promise<string>; // preço da mesma proposta/referência; sequencia = ++ultimaSequencia; AGUARDANDO_APROVACAO
export async function criarAlteracao(
  ctx,
  pedidoId: string,
  dados: {
    tipo: "ALTERACAO" | "CANCELAMENTO";
    linhas: { itemDePedidoId: string; embalagensDepois: string }[];
    motivo: string;
  },
): Promise<string>; // só diminui; enfileira mensagem; concordância PENDENTE
export async function registrarConcordancia(
  ctx,
  alteracaoId: string,
  resposta: "ACEITA" | "RECUSADA",
  texto: string,
): Promise<void>;
```

**Testes:** adendo leva só os itens novos, sequência 2, mensagem própria; alteração que aumenta → recusada ("aumentar é adendo"); duas alterações simultâneas recebem sequências 2 e 3, nunca iguais.

---

## Fase F — Envio

### Tarefa F1: ritmo e textos (puro)

**Arquivos:** `schemas/ritmo-envio.ts`, `schemas/mensagens.ts` (+tests).

```ts
export const MAX_TENTATIVAS = 5; export const LEASE_MS = 120_000; export const LOTE = 8; export const INTERVALO_MS = 4000;
export function proximaTentativa(tentativas: number, agora: Date): Date; // 1,4,9,16 min
export function desistiu(tentativas: number): boolean;
export function textoDoPedido(p: SnapshotParaMensagem): string;   // "*Pedido PC-0104/1 — Vitaliano Pizzaria*" … itens com embalagens e quantidade, preço combinado, total, entrega, "Ref. PC-0104/1"
export function textoDoAdendo(…), textoDaAlteracao(…), textoDoConvite(…): string; // convite contém "{{LINK}}"
```

### Tarefa F2: a fila

**Arquivo:** `services/fila.ts`, `services/canal.ts`, `integracao/fila.integracao.ts`.

```ts
export async function enfileirar(tx, dados: { organizacaoId; unidadeId|null; fornecedorId; tipo; referenciaTipo; referenciaId; sequencia; corpo: string; chave: string; ehTeste?: boolean }): Promise<string>; // resolve destino: fornecedor.telefonePedidos se autorizado, senão BLOQUEADA com motivo; chave única → devolve a existente
export async function reivindicar(dono: string, limite: number, agora: Date): Promise<Reivindicada[]>; // SQL cru, FOR UPDATE SKIP LOCKED, lease
export async function marcarResultado(id: string, dono: string, r: ResultadoDoCanal, agora: Date): Promise<void>; // só se ainda for do dono
export async function vencerTravas(agora: Date): Promise<number>; // ENVIANDO + lease vencido → INCERTA
export async function incertasParaConsultar(): Promise<{ id; chave; idProvedor }[]>;
export async function resolverIncerta(ctx, id: string, decisao: "saiu"|"reenviar"): Promise<void>;
export async function reprocessar(ctx, id: string): Promise<void>;          // FALHOU → NA_FILA
export async function reenfileirarParaNovoDestino(ctx, id: string): Promise<void>;
export async function marcarEnviadaAMao(ctx, id: string): Promise<void>;
export async function enviarTeste(ctx, texto: string): Promise<void>;       // só para CanalDeCompras.destinoTeste
export async function pausarCanal(ctx, motivo: string | null): Promise<void>;
export async function painelDeEnvios(ctx, filtro): Promise<PainelDeEnvios>;
export async function corpoParaEnvio(id: string): Promise<string>;          // troca {{LINK}} pelo link decifrado, só na hora de enviar
```

**Testes:** dois `reivindicar` simultâneos nunca devolvem a mesma mensagem; resultado `incerta` → INCERTA e não volta sozinha para a fila; `recusada-antes` 5× → FALHOU; trava vencida → INCERTA; fornecedor sem autorização → BLOQUEADA; telefone mudou com mensagem na fila → destino antigo mantido e painel acusa; teste sem número de teste → recusa; teste nunca vai ao número do fornecedor; canal pausado → `reivindicar` do relógio não pega nada.

### Tarefa F3: conectores

**Arquivos:** `src/connectors/fornecedores/contrato.ts` (tipos do desenho §10), `simulador.ts` (`criarSimulador(roteiro?)`), `whatsapp.ts` (Evolution, instância `COMPRAS_EVOLUTION_INSTANCIA`, classifica erros: `TimeoutError`/`ECONNRESET` → `incerta`; `ECONNREFUSED`/429/5xx → `recusada-antes` com nova tentativa; 4xx → `recusada-antes` sem), `index.ts` (`canalAtivo()` por `COMPRAS_CANAL`; `NODE_ENV=test` sempre simulador); `connectors/whatsapp/evolution.ts` ganha `chamarEvolution(instancia, caminho, corpo)` exportado sem mudar `enviarTexto`.
**Testes:** simulador obedece ao roteiro; `canalAtivo()` em teste é simulador mesmo com `COMPRAS_CANAL=whatsapp`.

### Tarefa F4: o relógio

**Arquivos:** `src/app/api/compras/tick/route.ts`, `src/proxy.ts`.
`POST` com `x-compras-segredo` = `COMPRAS_TICK_SEGREDO` (fechado sem segredo): `abrirRodadasAgendadas` → `vencerTravas` → reconciliar incertas (`consultar`) → se canal não pausado, `reivindicar` + enviar uma a uma com `INTERVALO_MS` → JSON `{ abertas, incertas, enviadas, falhas }`.
Teste de integração do laço (`tick.integracao.ts`) chamando a função que o `route.ts` usa (`rodarRelogio(canal, agora)` em `services/relogio.ts`… **não**: módulo não importa conector — a função mora em `src/app/api/compras/tick/relogio.ts` e recebe o canal por parâmetro).

---

## Fase G — Recebimento

### Tarefa G1: arquivos privados

**Arquivos:** `src/server/arquivos.ts`, `src/app/api/arquivos/route.ts` (POST multipart: exige sessão e `permissao` informada que o contexto tenha; ≤ 5 MB; assinatura JPEG/PNG/WebP), `src/app/api/arquivos/[id]/route.ts` (GET: confere organização, unidade visível e `pode(ctx, arquivo.permissaoLeitura)`; `Cache-Control: private, no-store`).

```ts
export const LIMITE_BYTES = 5 * 1024 * 1024;
export function tipoPelaAssinatura(
  bytes: Uint8Array,
): "image/jpeg" | "image/png" | "image/webp" | null;
export async function gravarArquivo(
  ctx,
  dados: {
    bytes: Uint8Array;
    nomeOriginal: string;
    unidadeId: string | null;
    permissaoLeitura: string;
  },
): Promise<{ id: string }>;
export async function vincularArquivos(
  tx,
  ids: string[],
  dono: { entidade: string; entidadeId: string; usuarioId: string },
): Promise<void>; // recusa arquivo de outro dono ou já vinculado
export async function lerArquivo(
  ctx,
  id: string,
): Promise<{ bytes: Buffer; tipo: string } | null>;
```

`ARQUIVOS_DIR` (padrão `/app/arquivos`; em desenvolvimento `./.arquivos`, no `.gitignore`).
**Testes:** assinatura de PNG/JPEG/WebP reconhecida; PDF e texto recusados.

### Tarefa G2: conferência (puro)

**Arquivo:** `schemas/recebimento.ts` (+test).

```ts
export type LinhaParaConferir = {
  itemDePedidoId: string;
  pedido: Milesimos;
  recebidoAntes: Milesimos;
  fator: DezMilesimos;
};
export type Informado = {
  itemDePedidoId: string;
  boa: Milesimos;
  avariada: Milesimos;
  excedente: "ACEITAR" | "RECUSAR" | null;
  substitutoInsumoId: string | null;
  substituicao: "ACEITAR" | "RECUSAR" | null;
  lote: string | null;
  validade: Date | null;
  observacao: string | null;
};
export function conferir(
  linhas: LinhaParaConferir[],
  informados: Informado[],
):
  | {
      ok: true;
      entradas: Entrada[];
      divergencias: DivergenciaNova[];
      completo: boolean;
    }
  | { ok: false; erros: { itemDePedidoId: string; mensagem: string }[] };
```

**Testes:** parcial deixa saldo e `completo=false`; excedente sem decisão → erro; excedente aceito → entra + divergência EXCEDENTE; recusado → não entra; avariada não entra e gera AVARIA; tudo recebido → `completo=true`; linha de outro pedido → erro.

### Tarefa G3: Estoque aceita transação

**Arquivos:** `src/modules/estoque/services/notas.ts`, `services/cmv.ts`, `src/app/(shell)/estoque/entradas/nova/page.tsx` (aviso de pedido aguardando).

```ts
export async function lancarEntradaDeRecebimento(tx: Prisma.TransactionClient, ctx, dados: { unidadeId; fornecedorId; recebimentoId; pedidoId; recebidaEm: Date; localDestinoId: string; numero|null; serie|null; chaveAcesso|null; itens: { insumoId; quantidadeNota: string; fator: string; quantidade: string; valorUnitario: string; valorTotal: string }[] }): Promise<{ notaId: string }>;
export async function vincularNotaAoRecebimento(tx, ctx, notaId: string, recebimentoId: string, pedidoId: string): Promise<{ itens: { insumoId; quantidade: string; valorTotal: string }[] }>; // recusa nota já vinculada
export async function registrarDevolucao(tx, ctx, dados: { unidadeId; localId; recebimentoId; itens: { insumoId; quantidade: string; custoUnitario: string }[]; motivo: string }): Promise<void>;
async function postarNota(tx, notaId: string, usuarioId: string): Promise<void>; // o miolo de lancarNota, com `SELECT … FOR UPDATE` nos insumos
```

`lancarNota` passa a abrir `db.$transaction(async tx => postarNota(tx, …))` — comportamento idêntico. CMV: compras do período = notas − devoluções (quantidade × custo).
**Testes:** `lancarNota` continua somando saldo e custo médio como antes (teste de integração novo em `src/modules/estoque/integracao/notas.integracao.ts`).

### Tarefa G4: recebimento em Compras

**Arquivos:** `services/recebimentos.ts`, `services/divergencias.ts`.

```ts
export async function prepararConferencia(ctx, pedidoId: string): Promise<VistaDaConferencia>; // linhas, acumulado, locais (lidos de local_estoque), notas lançadas do fornecedor sem vínculo
export async function registrarRecebimentoNaTransacao(tx, ctx, dados: { pedidoId; chave: string; informados: Informado[]; recebidaEm: Date; observacao|null; fotos: string[] }): Promise<{ recebimentoId: string; jaExistia: boolean; entradas: Entrada[]; completo: boolean; fornecedorId: string; unidadeId: string }>; // FOR UPDATE no pedido; chave já usada → devolve o existente
export async function concluirPedidoNaTransacao(tx, pedidoId: string, completo: boolean, notaId: string | null): Promise<void>;
export async function encerrarSaldo(ctx, pedidoId: string, motivo: string): Promise<void>;
export async function registrarDevolucaoNaTransacao(tx, ctx, dados): Promise<{ recebimentoId: string }>;
export async function listarDivergencias(ctx, filtro), resolverDivergencia(ctx, id, resolucao): Promise<…>;
```

### Tarefa G5: o orquestrador

**Arquivo:** `src/app/(shell)/compras/recebimento/acoes.ts` (`"use server"`).
`conferirRecebimento(estado, formData)`: lê e valida; `db.$transaction(async tx => { r = registrarRecebimentoNaTransacao(…); if jaExistia return; nota = vincular ? vincularNotaAoRecebimento(…) : lancarEntradaDeRecebimento(…); divergências de nota; concluirPedidoNaTransacao(…) }, { isolationLevel: "ReadCommitted", timeout: 20_000 })`; depois do commit, se marcado e permitido, `importarNotas(ctx, [notaId], categoriaId)` do Financeiro. Erro devolve o formulário preenchido.
`devolverMercadoria(estado, formData)`: mesma forma com `registrarDevolucao`.

### Tarefa G6: testes de integração do recebimento

**Arquivo:** `src/app/(shell)/compras/recebimento/recebimento.integracao.ts` (a camada que junta os dois Apps é a que se testa).
Parcial (saldo e posição de estoque conferidos); excedente aceito e recusado; avaria (não entra); duplo envio com a mesma chave → um recebimento, uma nota, saldo somado uma vez; duas conferências simultâneas com chaves diferentes → a segunda vê o acumulado e não passa do pedido sem decisão; falha forçada entre a nota e a conclusão → nada gravado (recebimento, nota, posição e pedido iguais a antes); nota já lançada à mão → vínculo sem nova entrada; importar a conta a pagar duas vezes → uma conta; devolução baixa o saldo e o CMV desconta.

---

## Fase H — Telas

Cada tarefa: ler os componentes de `src/design-system/` que usar; conferir no navegador (Playwright, `channel: "msedge"`) em 1440 px e 390 px; estados vazio, erro e sem permissão.

- **H1** Manifesto (`navegacao`: Rodadas `/compras`, Requisição `/compras/requisicao`, Comparação `/compras/comparacao`, Aprovação `/compras/aprovacao`, Pedidos e envios `/compras/pedidos`, Recebimento `/compras/recebimento`, Fornecedores, Configurações `/compras/configuracoes` com `permissao`), `permissoes.ts` (§8 do desenho), `comportamentoNaRede: "consolida"`; `prisma/seed.ts`: Gerente ganha `compras.requisitar`, `compras.receber`; alçada Diretor sem limite. Componentes comuns: `components/filtros-de-compras.tsx` (loja, rodada, estado no endereço), `components/estado.tsx` (etiquetas com texto e cor para rodada, pedido, envio, confirmação, recebimento).
- **H2** Rodadas: lista com filtros; detalhe com linha do tempo de estados, lojas e quem enviou, prazos (vencido em vermelho), botões de avanço com a versão, reabrir com motivo; nova rodada; agenda.
- **H3** Requisição da loja: tabela de insumos com sugestão e fórmula ao lado, alertas, quantidade, embalagem preferida; resumo lateral; **Enviar requisição**. Despensa: o botão vira "Levar para a requisição" (costura em `acoes-da-despensa.ts` com `adicionarDaDespensa`).
- **H4** Cotação da rodada (dentro da rodada): solicitações por fornecedor com estado, prazo, **Copiar link**, revogar/reemitir, lançar resposta pelo comprador (formulário com embalagem estruturada e fator ao vivo), versões.
- **H5** Comparação: grade por produto (preço por unidade de estoque, embalagens, adicional, total), colunas por fornecedor, resumo lateral (sugestão, fornecedores fora, alertas), compras direcionadas à parte, escolha por item com justificativa, **Revisar propostas** → **Gerar pedidos para aprovação**. Print 1.
- **H6** Aprovação: por loja e fornecedor, itens, conversões, preços, frete, condição, total, entrega; alçada de quem olha; **Aprovar pedido** / Recusar com motivo.
- **H7** Pedidos e envios: lista com situação do envio, confirmação e recebimento; detalhe com itens por versão (pedido inicial, adendos), "Situação do envio" em linha do tempo (aprovado → na fila → aceita pelo canal → entregue; confirmação do fornecedor separada), **Copiar mensagem**, **Marquei como enviada**, registrar confirmação, adendo, alteração; painel de envios (pausado, simulado, bloqueadas, incertas, falhas, teste). Print 2.
- **H8** Recebimento: lista de pedidos aguardando; conferência (tabela no computador, cartões grandes no celular, unidade explícita, foto, decisões de excedente/substituição), vincular nota existente, gerar conta a pagar; histórico de entregas e devolução; divergências. **Conferir recebimento**. Print 3.
- **H9** Fornecedores (destino, autorização, produtos do fornecedor com fixo e referência) e Configurações (alçadas com histórico de versões; canal: pausa e número de teste; simulador visível).

---

## Fase I — Dados, documentação e conferência final

- **I1** `prisma/compras-demo.ts` (+ `npm run demo:compras`): recusa fora de `localhost`; cria Unidade "Loja Exemplo Sul", fornecedores "Distribuidora Exemplo A/B", "Laticínio Exemplo" (fixo da mussarela), telefones fictícios `5500000000001…`, uma rodada em cada estado útil, propostas com caixa 12 × 900 g, frete que troca o vencedor, um pedido aprovado com mensagem simulada, um recebimento parcial.
- **I2** `docs/compras/README.md`: instalação e configuração (variáveis: `COMPRAS_CANAL`, `COMPRAS_EVOLUTION_INSTANCIA`, `COMPRAS_TICK_SEGREDO`, `ARQUIVOS_DIR`; tarefa agendada; volume), origem do preço, conversão, aprovação, envio, recebimento, conciliação, contrato dos adaptadores, **roteiro de recuperação** (mensagem incerta, falhou, canal fora, recebimento lançado errado → devolução, nota duplicada, link vazado → revogar), o que depende de integração real. `DESIGN.md`: seção de Compras.
- **I3** `npm run check`, `npm run test:integracao`, `npm run build` (com `DATABASE_URL` fictícia como o Dockerfile), navegador em computador e celular com três perfis (Diretor, gerente do Centro, gerente do Sul), três prints ≥ 2560 × 1440.
- **I4** Full Prompt único (a especificação adaptada + o que foi construído) e preparação da publicação na Kairu — **publicar só com confirmação do Pablo**.
