# WhatsApp — conexão, eventos e avisos · Plano de Implementação

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA — `superpowers:executing-plans` (ou `superpowers:subagent-driven-development`). Os passos usam caixas (`- [ ]`).
>
> Executado nesta mesma conversa, na worktree `C:\Users\Lenovo\tetteo-whats` (branch `whatsapp-avisos`, a partir de `48acc3f`). O desenho está em [`docs/superpowers/specs/2026-09-10-whatsapp-avisos-design.md`](../specs/2026-09-10-whatsapp-avisos-design.md) — este plano não repete o porquê, só o como.

**Objetivo:** o Tetteo recebe eventos da Evolution 2.3.7 (Baileys) e envia um aviso interno — nascido do checklist de Fechamento — a um contato autorizado, só depois de um responsável confirmar.

**Arquitetura:** a Severina (`modules/assistente`) guarda conexão, eventos e avisos no PostgreSQL, que também é a fila. `connectors/whatsapp` fala "Evolution" (e tem um simulado para o ensaio). A camada `app/` costura os dois: webhook, entrega, verificação, saúde e as ações que precisam do provedor.

**Stack:** Next.js 16.3 (App Router, `after()`) · TypeScript · Prisma 7 / PostgreSQL · Zod 4 · `node:test` via `tsx` · `node:crypto` (JWT HS256, SHA-256) — **nenhuma dependência nova no `package.json`** (mudar o `package.json` refaz o `npm ci` do deploy).

## Restrições globais

- Fronteiras do linter: `modules/*` só importa `core`, `design-system`, `lib`, `server` e a si mesmo. `connectors/*` só `connector`, `core`, `lib`, `server`. Só `app/` alcança módulo **e** conector.
- Toda tabela nova carrega `organizacaoId`; nenhuma declara `@relation` para o Core.
- Id `cuid()`. Nada de negócio apagado de verdade (exceção declarada: `EventoWhatsapp` IGNORADO > 30 dias).
- Teste de função pura em `src/**/*.test.ts` (roda no `npm test`). Teste com banco em `ensaio/whatsapp/*.ensaio.ts` (roda à parte, contra banco descartável; recusa rodar fora de `localhost`).
- Comentários em português explicando o porquê, no tom dos arquivos vizinhos.
- Nenhum segredo, telefone real, nome real ou QR Code em código, teste, log, doc ou print. Dados do ensaio são fictícios.
- `npm run check` antes de cada commit; `npm run build` antes de publicar.
- Endpoints e payloads: **só os da 2.3.7** (§3 do desenho). Nunca `logout`/`delete` de instância.

## Estrutura de arquivos

| Arquivo | Responsabilidade |
| --- | --- |
| `prisma/schema/assistente.prisma` + migração `20260910120000_whatsapp_avisos` | Colunas novas em `InstanciaWhatsapp` e `VinculoWhatsapp`; tabelas `EventoWhatsapp`, `AvisoWhatsapp` |
| `src/lib/telefone.ts` (+teste) | `mascararTelefone` |
| `src/connectors/whatsapp/tipos.ts` | O contrato `ProvedorWhatsapp` |
| `src/connectors/whatsapp/sanitizar.ts` (+teste) | `limparTexto` — tira chave, token, JWT, base64, telefone |
| `src/connectors/whatsapp/configuracao.ts` (+teste) | Lê o ambiente; diz o que falta |
| `src/connectors/whatsapp/passe.ts` (+teste) | `assinarPasse` / `verificarPasse` — JWT HS256 |
| `src/connectors/whatsapp/webhook-evolution.ts` (+teste) | `interpretarWebhook` — corpo da 2.3.7 → evento normalizado |
| `src/connectors/whatsapp/falhas.ts` (+teste) | `classificarFalha` — nao-chegou / incerto / recusado |
| `src/connectors/whatsapp/evolution.ts` (+teste com servidor HTTP falso) | Provedor real; mantém `enviarTexto`/`estadoDaConexao` da Severina |
| `src/connectors/whatsapp/simulado.ts` | Provedor simulado, com comportamento programável |
| `src/connectors/whatsapp/index.ts` | `provedorPara(conexao)` |
| `src/core/registry/tipos.ts` | Tipo `FatoDoModulo` |
| `src/modules/checklists/schemas/fato-de-fechamento.ts` (+teste) | Qual modelo é "fechamento"; as linhas do aviso |
| `src/modules/checklists/assistente.ts` | Participante: fatos "fechamento concluído" |
| `src/registro-de-ferramentas.ts` | `eventos?` no participante; registra o Checklists |
| `src/modules/assistente/schemas/aviso.ts` (+teste) | Transições, estado pelo status do provedor, corpo, referência, espera |
| `src/modules/assistente/schemas/conexao.ts` (+teste) | Estado da conexão, Atenção |
| `src/modules/assistente/schemas/evento.ts` | Tipo `EventoNormalizado` (vocabulário da Severina) |
| `src/modules/assistente/services/conexao.ts` | Conexão: leitura, alcance por loja, registrar consulta, chaves |
| `src/modules/assistente/services/eventos.ts` | Registrar (idempotente), processar, listar, contar, limpar |
| `src/modules/assistente/services/avisos.ts` | Rascunho, confirmação, descarte, reenvio; pegar para envio; resultado; verificação |
| `src/modules/assistente/services/rascunhos.ts` | Fatos dos módulos → rascunhos |
| `src/modules/assistente/services/vinculos.ts` | + autorizar / revogar |
| `src/modules/assistente/services/disparo.ts` | Respeita `agendamentosPausados` |
| `src/modules/assistente/permissoes.ts`, `manifest.ts` | 3 permissões; navegação |
| `src/modules/assistente/acoes.ts` | Ações sem provedor (rascunho, autorizar, chaves, loja) |
| `src/modules/assistente/components/*` | Telas WhatsApp, Eventos, Avisos; Números |
| `src/app/api/whatsapp/_costura/*.ts` | `receberWebhook`, `entregarAvisos`, `verificarIncertos`, `atualizarSaude`, `rodadaWhatsapp` |
| `src/app/api/whatsapp/webhook/route.ts` | POST do webhook |
| `src/app/api/severina/tick/route.ts` | Chama `rodadaWhatsapp` |
| `src/app/(shell)/assistente/acoes-whatsapp.ts` | Ações com provedor (QR, reconectar, eventos, confirmar, reenviar) |
| `src/app/(shell)/assistente/{whatsapp,eventos,avisos}/page.tsx` | Rotas |
| `src/proxy.ts` | Deixa `/api/whatsapp` passar |
| `ensaio/whatsapp/*` | Banco fictício, os 12 cenários, demonstração |
| `docs/operacao/whatsapp/*`, `docs/telas/whatsapp/*`, `.env.example`, `connectors/whatsapp/README.md` | Operação, prints, roteiro |

---

## Task 1: O banco

**Arquivos:** modificar `prisma/schema/assistente.prisma`; criar a migração.

**Produz** (cliente Prisma):

```prisma
enum ProvedorWhatsapp { EVOLUTION_BAILEYS SIMULADO }
enum EstadoConexao    { DESCONECTADO CONECTANDO CONECTADO ATENCAO }
enum StatusEventoWhatsapp { RECEBIDO PROCESSADO IGNORADO FALHOU }
enum StatusAvisoWhatsapp  { RASCUNHO CONFIRMADO NA_FILA ACEITO ENTREGUE LIDO INCERTO FALHOU DESCARTADO }

InstanciaWhatsapp += unidadeId String?, provedor ProvedorWhatsapp @default(EVOLUTION_BAILEYS),
  estado EstadoConexao @default(DESCONECTADO), estadoDesde DateTime?, vistoEm DateTime?,
  motivoAtencao String?, agendamentosPausados Boolean @default(true),
  eventosConfiguradosEm DateTime?, ultimoEnvioEm DateTime?, eventos EventoWhatsapp[], avisos AvisoWhatsapp[]
VinculoWhatsapp += autorizadoEm DateTime?, autorizadoPorId String?

model EventoWhatsapp { id, organizacaoId, instanciaId→InstanciaWhatsapp, idExterno, tipo,
  status @default(RECEBIDO), motivo?, resumo Json @default("{}"), repeticoes Int @default(0),
  tentativas Int @default(0), recebidoEm @default(now()), processadoEm?, ultimaRepeticaoEm?
  @@unique([instanciaId, idExterno]) @@index([organizacaoId, recebidoEm]) @@index([status, recebidoEm]) @@map("evento_whatsapp") }

model AvisoWhatsapp { id, organizacaoId, unidadeId?, instanciaId→InstanciaWhatsapp, idPedido, referencia,
  origemTipo, origemId?, permissaoNecessaria?, titulo, corpo, link?, destinatarioRef?,
  status @default(RASCUNHO), idMensagemProvedor?, tentativas, proximaTentativaEm?, tentativaIniciadaEm?,
  verificacoes, verificadoEm?, erro?, solicitadoPorId?, confirmadoPorId?, descartadoPorId?,
  criadoEm, atualizadoEm, confirmadoEm?, enfileiradoEm?, aceitoEm?, entregueEm?, lidoEm?, falhouEm?, descartadoEm?
  @@unique([organizacaoId, idPedido]) @@unique([instanciaId, idMensagemProvedor]) @@unique([referencia])
  @@index([organizacaoId, status, criadoEm]) @@index([status, proximaTentativaEm]) @@map("aviso_whatsapp") }
```

- [ ] Ligar o banco descartável (`embedded-postgres`, porta 5435, `--encoding=UTF8 --locale=C`, fora do repositório) e o `.env.local` da worktree apontando para ele
- [ ] `npx prisma migrate deploy` no banco vazio — as 14 migrações existentes aplicam
- [ ] Escrever o schema; `npx prisma migrate dev --create-only --name whatsapp_avisos`; renomear a pasta para `20260910120000_whatsapp_avisos`; conferir o SQL (só `ADD COLUMN`, `CREATE TABLE`, `CREATE TYPE`, índices — nada de `DROP`)
- [ ] `npx prisma migrate deploy` + `npx prisma generate` + `npm run typecheck`
- [ ] Commit

## Task 2: As peças puras do conector

**Arquivos:** `lib/telefone.ts`, `connectors/whatsapp/{sanitizar,configuracao,passe,webhook-evolution,falhas}.ts`, cada um com `.test.ts`.

**Produz:**

```ts
mascararTelefone(e164: string | null | undefined): string            // "5584981336549" → "(84) •••••-6549"; vazio → "—"
limparTexto(texto: string, segredos?: string[]): string              // troca por "[oculto]"
configuracaoEvolution(env): { tipo: "ok"; url; instancia; chave } | { tipo: "pendente"; faltando: string[] }
configuracaoWebhook(env): { tipo: "ok"; url; chaves: string[] } | { tipo: "pendente"; faltando: string[] }
assinarPasse(chave: string, agora: Date): string                     // igual ao da Evolution 2.3.7
verificarPasse(authorization: string | null, chaves: string[], agora: Date): { ok: true } | { ok: false; motivo: string }
interpretarWebhook(texto: string): { ok: true; evento: EventoDaEvolution } | { ok: false; status: 400 | 422; motivo: string }
classificarFalha(entrada: { tipo: "rede"; codigo?: string } | { tipo: "tempo" } | { tipo: "http"; status: number }): "nao-chegou" | "incerto" | "recusado"
```

`EventoDaEvolution` = `{ instancia: string; tipo: "connection.update" | "messages.update" | "send.message" | "messages.upsert"; idExterno: string; dados: … }` com, por tipo, exatamente os campos do §6.3 do desenho — `remoteJid` só transita (upsert) para a busca do vínculo e **não** entra no que é gravado.

Casos de teste (cada linha um `test`):

- máscara: celular com 9, fixo com 8, estrangeiro (últimos 4), vazio
- limpeza: `apikey: abc…`, `Authorization: Bearer x.y.z`, JWT solto, base64 de 200+ chars, telefone de 10–13 dígitos, valor exato de segredo passado em `segredos` — todos somem; texto comum fica
- configuração: tudo vazio → `faltando` com os 3 nomes; só a chave → falta instância; nunca devolve valor no `faltando`
- passe: assinado com a chave → ok; chave errada → recusa; vencido (exp no passado + 30 s) → recusa; `iat` no futuro (> 60 s) → recusa; `alg: none` → recusa; `app`≠`evolution` → recusa; aceita a chave anterior; sem `Bearer` → recusa
- webhook: um corpo real de cada tipo (montado a partir do código da 2.3.7) → normalizado com o `idExterno` do §5; JSON quebrado → 400; `event: "qrcode.updated"` → 422; envelope com campo a mais → 400; `messages.update` sem `keyId` → 400; `connection.update` repetido com o mesmo corpo → mesmo `idExterno`
- falhas: `ECONNREFUSED`/`ENOTFOUND`/`EAI_AGAIN`/`EHOSTUNREACH` → nao-chegou; `ECONNRESET` → incerto; tempo → incerto; 429 → nao-chegou; 500/502/503 → incerto; 400/401/403/404 → recusado

- [ ] Para cada arquivo: teste primeiro, `npx tsx --test <arquivo>` falha, implementa, passa
- [ ] `npm run check`; commit

## Task 3: Os provedores

**Arquivos:** `connectors/whatsapp/{tipos,evolution,simulado,index}.ts`, `evolution.test.ts`.

**Produz:**

```ts
type ResultadoConsulta = { tipo: "pendente"; faltando: string[] }
  | { tipo: "ok"; estado: "CONECTADO" | "CONECTANDO" | "DESCONECTADO"; numero: string | null }
  | { tipo: "erro"; motivo: string };
type ResultadoEnvio = { tipo: "aceito"; idMensagem: string; aceitoEm: Date }
  | { tipo: "nao-chegou" | "incerto" | "recusado"; motivo: string };
type Resultado<T> = { ok: true; valor: T } | { ok: false; motivo: string; pendente?: string[] };

interface ProvedorWhatsapp {
  consultarConexao(): Promise<ResultadoConsulta>;
  lerEventos(): Promise<Resultado<{ ativo: boolean; url: string | null; eventos: string[]; comChave: boolean }>>;
  configurarEventos(p: { url: string; chave: string; eventos: string[] }): Promise<Resultado<{ eventos: string[] }>>;
  pedirQrCode(): Promise<Resultado<{ tipo: "qr"; imagem: string; expiraEmMs: number } | { tipo: "ja-conectado" }>>;
  enviarMensagem(p: { para: string; texto: string }): Promise<ResultadoEnvio>;
  consultarMensagem(p: { texto: string; desde: Date }): Promise<Resultado<{ idMensagem: string; enviadaEm: Date } | null>>;
}
provedorPara(conexao: { provedor: "EVOLUTION_BAILEYS" | "SIMULADO"; nome: string }, env?): ProvedorWhatsapp
EVENTOS_ASSINADOS = ["CONNECTION_UPDATE", "MESSAGES_UPDATE", "SEND_MESSAGE"]
```

Evolution (2.3.7): `GET /instance/connectionState/{i}` · `GET /webhook/find/{i}` · `POST /webhook/set/{i}` com `{webhook:{enabled:true,url,headers:{jwt_key},byEvents:false,base64:false,events}}` · `GET /instance/connect/{i}` · `POST /message/sendText/{i}` `{number,text}` → 201 · `POST /chat/findMessages/{i}` `{where:{key:{fromMe:true},messageTimestamp:{gte}},page:1,offset:50}`. Cabeçalho `apikey` = chave **da instância**. Limites: 4 s consulta, 15 s envio. A instância usada é sempre a do ambiente, e só se bater com `conexao.nome`.

Simulado: estado, fila de QR falsos (imagem SVG "QR de ensaio"), registro de envios, comportamento programável (`aceita`, `tempo-esgotado`, `sem-rede`, `erro-5xx`, `credencial-invalida-vazando`), `consultarMensagem` que acha o que "saiu". Estado em `globalThis`. `provedorPara` recusa o simulado com `NODE_ENV=production`.

Teste do `evolution.ts` contra um `node:http` local: 201 → aceito; 401 com a chave ecoada no corpo → recusado **sem** a chave no motivo; servidor que não responde → incerto em ≤ 15 s (usar limite curto injetado); porta fechada → nao-chegou; `connect` com `open` → `ja-conectado`; o corpo do `webhook/set` sai aninhado.

- [ ] Teste primeiro; implementa; passa; `npm run check`; commit

## Task 4: O vocabulário puro da Severina e do Checklists

**Arquivos:** `core/registry/tipos.ts` (`FatoDoModulo`), `modules/assistente/schemas/{aviso,conexao,evento}.ts` (+testes), `modules/checklists/schemas/fato-de-fechamento.ts` (+teste).

**Produz:**

```ts
type FatoDoModulo = { chave: string; tipo: string; unidadeId: string; titulo: string; linhas: string[];
  caminho: string; ocorridoEm: Date; permissaoNecessaria: string };

// aviso.ts
podeTransitar(de: StatusAviso, para: StatusAviso): boolean
estadoPeloStatusDoProvedor(atual: StatusAviso, status: "SERVER_ACK"|"DELIVERY_ACK"|"READ"|"PLAYED"|"ERROR"|"PENDING"|"DELETED"): StatusAviso | null  // null = não muda
montarCorpo(p: { titulo: string; linhas: string[]; link: string | null; referencia: string }): string
gerarReferencia(aleatorio?: () => number): string        // "AV-" + 6 de "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
esperaAntesDaTentativa(tentativas: number): number       // ms: 1, 4, 9 min
MAX_TENTATIVAS_SEM_CHEGAR = 3; MAX_VERIFICACOES = 5; INTERROMPIDO_APOS_MS = 120_000
GRUPOS = { revisar: [RASCUNHO], andamento: [CONFIRMADO, NA_FILA, ACEITO, ENTREGUE], pendencias: [INCERTO, FALHOU], concluidos: [LIDO, DESCARTADO] }

// conexao.ts
estadoPelaConsulta(r: "CONECTADO"|"CONECTANDO"|"DESCONECTADO", anterior: {estado, estadoDesde}, agora): { estado, motivoAtencao: string | null }
estadoPeloEventoDeConexao(state: "open"|"connecting"|"close"|"refused"): EstadoConexao
// fato-de-fechamento.ts
ehModeloDeFechamento(nome: string): boolean              // "Fechamento da Pizzaria" ✓, "FECHAMENTO" ✓, "Abertura" ✗
linhasDoFechamento(p: { loja; modelo; fechadaEm; fuso; quem; pontuacao: number | null; naoConformes: number }): string[]
```

Testes: toda transição permitida e as proibidas (LIDO→ENTREGUE, DESCARTADO→*, RASCUNHO→ACEITO); status do provedor nunca volta; corpo com `*título*`, linhas, "Revise:", "Ref."; sem link omite a linha; referência no alfabeto sem ambíguos; "conectando" há 6 min → ATENÇÃO; fuso `America/Sao_Paulo` na hora; nota nula → "Sem nota (só registros)".

- [ ] Teste primeiro; implementa; passa; `npm run check`; commit

## Task 5: Os serviços — e os 12 cenários escritos antes

**Arquivos:** `ensaio/whatsapp/{banco,aceite.ensaio}.ts` primeiro; depois `modules/assistente/services/{conexao,eventos,avisos,rascunhos}.ts`, `vinculos.ts`, `disparo.ts`, `modules/checklists/assistente.ts`, `registro-de-ferramentas.ts`.

**Produz** (assinaturas usadas pelas Tasks 6 e 7):

```ts
// conexao.ts
listarConexoes(contexto): Promise<ConexaoNaTela[]>
obterConexao(contexto, id): Promise<ConexaoNaTela | null>
permissaoNaLojaDaConexao(usuarioId: string, conexao: { unidadeId: string | null }, chave: string): Promise<boolean>
exigirNaLojaDaConexao(contexto, conexaoId, chave, acao): Promise<ConexaoInterna>        // lança SemPermissao
registrarConsulta(conexaoId, r: ResultadoDaConsulta, agora): Promise<void>
conexoesAtivas(): Promise<ConexaoInterna[]>
alternarEnvio / alternarAgendamentos / definirLoja (contexto, id, …)
registrarEventosConfigurados(conexaoId, agora)
// eventos.ts
registrarEvento(conexao: {id, organizacaoId}, e: EventoNormalizado): Promise<{ id: string; duplicado: boolean }>
processarEvento(id: string, agora: Date): Promise<void>
eventosParados(agora): Promise<string[]>; limparIgnorados(agora): Promise<number>
contarEventos(contexto, desde), listarEventos(contexto, filtro), obterEvento(contexto, id)
// avisos.ts
criarRascunho(contexto, dados), editarRascunho(contexto, id, dados), descartarAviso(contexto, id)
confirmarAviso(contexto, id, destinatarioRef): Promise<{ confirmado: boolean }>   // false = já não era rascunho
reenviarAviso(contexto, id)
listarAvisos(contexto, grupo), obterAviso(contexto, id)
candidatosParaEntrega(agora, limite, apenasId?): Promise<AvisoParaEntrega[]>
pegarParaEnvio(id, agora): Promise<boolean>
registrarResultado(id, r: ResultadoDoEnvio, agora): Promise<void>
marcarInterrompidos(agora), incertosParaVerificar(agora), registrarVerificacao(id, achado, agora)
// rascunhos.ts
coletarRascunhos(agora): Promise<number>
// vinculos.ts
autorizarVinculo(contexto, id), revogarAutorizacao(contexto, id), destinatariosAutorizados(contexto, unidadeId)
```

O ensaio (`ensaio/whatsapp/aceite.ensaio.ts`) monta tudo com dados **fictícios** (Organização "Pizzaria Ensaio", lojas "Loja Centro (ensaio)" e "Loja Sul (ensaio)", pessoas "Ana Ensaio", "Bruno Ensaio", "Carla Ensaio", telefones `55119000000xx`) e roda os 12 cenários do §10 do desenho, chamando os serviços e a costura da Task 6 com o provedor simulado. Recusa rodar se `DATABASE_URL` não for `localhost` com banco `*_ensaio`.

Rodar: `npx tsx --conditions=react-server --test ensaio/whatsapp/aceite.ensaio.ts`

- [ ] Escrever `banco.ts` e os 12 cenários; rodar → falham
- [ ] Implementar os serviços; o participante do Checklists; o registro
- [ ] Rodar os cenários que não dependem da costura; `npm run check`; commit

## Task 6: A costura, o webhook e o relógio

**Arquivos:** `app/api/whatsapp/_costura/{receber,entrega,verificacao,saude,rodada}.ts`, `app/api/whatsapp/webhook/route.ts`, `app/api/severina/tick/route.ts`, `src/proxy.ts`.

**Produz:**

```ts
receberWebhook(request: Request, deps: { agendar(fn: () => Promise<void>): void; agora?: () => Date; env?: NodeJS.ProcessEnv }): Promise<Response>
entregarAvisos(p: { agora: Date; limite: number; apenasId?: string; esperar?: (ms) => Promise<void> }): Promise<{ enviados; incertos; falhas; adiados }>
verificarIncertos(agora: Date): Promise<{ achados; naoAchados }>
atualizarSaude(agora: Date): Promise<number>
rodadaWhatsapp(agora: Date): Promise<ResumoDaRodada>
```

- [ ] A rota só chama `receberWebhook(request, { agendar: after })`; o `tick` chama `rodadaWhatsapp` antes da fila da Severina; o `proxy.ts` exclui `api/whatsapp`
- [ ] Os 12 cenários passam; `npm run check`; `npm run build`; commit

## Task 7: As telas

**Arquivos:** `permissoes.ts`, `manifest.ts`, `acoes.ts`, `app/(shell)/assistente/acoes-whatsapp.ts`, `components/{painel-whatsapp,qr-code,lista-de-eventos,lista-de-avisos,novo-aviso,etapas-do-aviso}.tsx`, `painel-de-vinculos.tsx`, as 3 páginas.

- [ ] Permissões `assistente.preparar`, `assistente.conectar`, `assistente.autorizar`; navegação Conversas · Avisos · Eventos · WhatsApp · Agentes · Números
- [ ] Ações com provedor no `app/`, recebidas pelas telas como propriedade (módulo não importa `app/`)
- [ ] QR só na memória do componente; 45 s; "Gerar novo"; consulta a cada 5 s enquanto aberto
- [ ] Uma coluna no celular; `Tabela` vira cartão; `PainelLateral` para detalhe; `Etiqueta` com ponto + texto; alvo de toque de 44 px
- [ ] `npm run check`; `npm run build`; conferir no navegador; commit

## Task 8: Demonstração e prints

**Arquivos:** `ensaio/whatsapp/demonstracao.ts`, `docs/telas/whatsapp/*.png`, `docs/telas/whatsapp/roteiro.md`.

- [ ] Popular o banco descartável com a demonstração; `next dev` da worktree na porta 3001
- [ ] Levar um aviso de ponta a ponta com o simulado, com webhook assinado via HTTP de verdade
- [ ] Prints reais (Edge via Playwright, fora do repositório): configuração (WhatsApp), fluxo principal (Avisos → confirmação), resultado (aviso lido + Eventos). 2560×1440 e celular 900×1600. Sem QR
- [ ] Roteiro de demonstração; commit

## Task 9: Operação e entrega

**Arquivos:** `.env.example`, `src/connectors/whatsapp/README.md`, `docs/operacao/whatsapp/README.md`, `docs/operacao/whatsapp/backup-evolution.sh`, `docs/operacao/whatsapp/restaurar.md`.

- [ ] Variáveis vazias; iniciar, testar, atualizar, recuperar, rotacionar — em português simples
- [ ] Backup: script com `pg_dump` da Evolution + Redis/volume, `chmod 600`, 14 dias; restauração
- [ ] `npm run check` + `npm run build` + os 12 cenários; relatório com o que foi simulação, teste local e o que falta para o uso real
