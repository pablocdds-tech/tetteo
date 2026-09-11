# WhatsApp — conexão, eventos e avisos confirmados

**Data:** 10/09/2026
**Módulo:** `assistente` (Severina)
**Estado:** desenho aprovado pelo Pablo em 10/09/2026, em implementação na branch `whatsapp-avisos`

---

## 1 · O que é

O Tetteo passa a **receber** eventos do WhatsApp e a **enviar um aviso interno** a um contato autorizado — sempre com um humano confirmando antes de sair.

O primeiro caso é o **relatório do fechamento pronto para revisão**: quando alguém conclui o checklist de Fechamento de uma loja, nasce um rascunho de aviso com quem fechou, a hora, a nota e os itens fora do padrão. Um responsável escolhe o destinatário entre os autorizados, confere a prévia e confirma. Sai **uma** mensagem.

O que este trabalho **não** faz, por pedido do dono:

- não dispara em massa, não importa lista de contatos
- não envia nada sozinho no primeiro teste
- não liga agendamento nenhum até o dono escolher horário, fuso, público e conteúdo

---

## 2 · Decisões travadas

| Decisão                            | Escolha                                                                                     | Por quê                                                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Modalidade**                     | **Baileys** via Evolution API 2.3.7, a **instância que já existe**                          | Já instalada e conectada; nada a reinstalar nem desconectar. Decisão do dono, com o risco apresentado (§11)             |
| **O "fechamento"**                 | Checklist cujo modelo tem **"Fechamento" no nome**, ao ser fechado                          | Já existe no Tetteo. Fechamento de caixa depende do PDV, que não existe                                                 |
| **Onde mora**                      | No módulo **Severina** (`assistente`), que já é dono do número                              | Módulo não escreve em tabela de outro módulo — um App novo não poderia usar a tabela do número                          |
| **Fila**                           | O próprio **PostgreSQL** do Tetteo (estado + horário + troca atômica de estado)             | Poucos avisos por dia; Redis + worker seria mais uma peça para manter e para fazer backup                               |
| **Chave da Evolution**             | O Tetteo usa só a **chave da instância**, nunca a global                                    | Na 2.3.7 a chave da instância vale em toda rota com `{instance}` (§3). A global fica só dentro da Evolution             |
| **Eventos assinados**              | `CONNECTION_UPDATE`, `MESSAGES_UPDATE`, `SEND_MESSAGE`                                      | O número é pessoal: o Tetteo não precisa ver conversa nenhuma. `QRCODE_UPDATED` fica fora para o QR nunca viajar em log |
| **Envio depois de tempo esgotado** | **Nunca reenvia sozinho.** Consulta o provedor; se não achar, vira pendência para um humano | A 2.3.7 não tem chave de idempotência no envio. Reenvio automático pode virar duas mensagens iguais                     |

Alternativas consideradas e recusadas: Redis + BullMQ (infra demais para o volume) e reaproveitar `MensagemWhatsapp` (mistura conversa de agente com rascunho que exige confirmação, e toda mensagem ali exige um agente dono).

---

## 3 · O ambiente, conferido em 10/09/2026

| Peça      | O que é                                                                                                                                    | Como foi conferido                        |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| Sistema   | Tetteo — Next.js 16.3.0, React 19.2.8, Prisma 7.9, Node 24 (imagem alpine)                                                                 | `package.json`, `Dockerfile`              |
| Banco     | PostgreSQL 18 no Dokploy (banco `tetteo`)                                                                                                  | memória do projeto; `prisma/schema`       |
| Onde roda | VPS Hostinger KVM 2 (Ubuntu 24.04), Dokploy v0.29.8 + Traefik v3.6.7, `https://app.vitalianopizzaria.com.br`, deploy a cada push no `main` | memória do projeto                        |
| WhatsApp  | **Evolution API 2.3.7**, WhatsApp Web `2.3000.1047236770`, `https://evo.vitalianopizzaria.com.br`                                          | `GET /` público, sem chave, em 10/09/2026 |
| Local     | Windows 11, sem Docker nem PostgreSQL. Ensaio num `embedded-postgres` descartável, fora do repositório                                     | máquina do Pablo                          |

### Fontes consultadas

- Código-fonte oficial na etiqueta **`2.3.7`** (commit `cd800f2`, 05/12/2025): <https://github.com/evolution-foundation/evolution-api/tree/2.3.7> — `instance.controller.ts`, `whatsapp.baileys.service.ts`, `webhook.controller.ts`, `webhook.schema.ts`, `channel.service.ts`, `auth.guard.ts`, `message.schema.ts`, `env.example`
- Documentação oficial: <https://docs.evolutionfoundation.com.br/> (o antigo `doc.evolution-api.com` redireciona para lá)
- Next.js 16: `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md` e `03-file-conventions/route.md`; `next/dist/server/base-server.js` (cabeçalhos `x-forwarded-*`)

**Onde a documentação diverge do código da 2.3.7, vale o código.** As divergências que importam para nós:

| Assunto             | Documentação                    | Código 2.3.7                                             |
| ------------------- | ------------------------------- | -------------------------------------------------------- |
| Configurar webhook  | corpo plano                     | aninhado em `webhook: {…}`, com `byEvents` / `base64`    |
| `sendText`          | `textMessage: {text}`, HTTP 200 | `text` plano, **HTTP 201**                               |
| `findMessages`      | `take/skip/orderBy`             | `where/page/offset`                                      |
| Reiniciar instância | —                               | **POST** `/instance/restart/{instance}`, mantém a sessão |
| `QRCODE_LIMIT`      | "quanto tempo o QR dura"        | **quantos** QR Codes, não tempo (cada um dura 45 s)      |

### O que a 2.3.7 oferece — e o que não

- **Estado:** `GET /instance/connectionState/{instance}` → `open` / `connecting` / `close`
- **QR:** `GET /instance/connect/{instance}` → com o número já conectado é **inofensivo** (devolve `open`); desconectado, devolve `{base64, code, pairingCode, count}`. Cada QR dura 45 s
- **Nada desconecta o número a não ser `logout`/`delete` — que o Tetteo nunca chama.** Não existe no código do Tetteo nenhuma chamada a essas rotas
- **Webhook:** `POST /webhook/set/{instance}` aceita `headers`. Um cabeçalho chamado `jwt_key` é retirado pela Evolution e trocado por `Authorization: Bearer <JWT HS256>`, assinado com esse valor, válido por 10 minutos, com `{app: "evolution", action: "webhook"}`
- **Não existe assinatura do corpo (HMAC).** O JWT prova quem mandou, não que o conteúdo não mudou
- **Retentativa da Evolution:** até 10 tentativas com espera dobrando; **400, 401, 403, 404 e 422 param na hora**
- **Envio:** `POST /message/sendText/{instance}` → 201 com `key.id`. **Sem chave de idempotência**
- **Consulta de enviada:** `POST /chat/findMessages/{instance}` — só funciona se a Evolution guardar mensagens (`DATABASE_SAVE_DATA_NEW_MESSAGE=true`)

---

## 4 · Arquitetura

```
 NAVEGADOR ──(sessão do Auth.js)──► TETTEO  (Next.js, contêiner na VPS)
   nunca vê chave nenhuma            │
                                     ├─ telas e ações ── permissão conferida no servidor, na loja da conexão
                                     ├─► PostgreSQL do Tetteo ── conexão, eventos, avisos (e a FILA)
                                     └─► connectors/whatsapp ──(rede interna do Docker)──► EVOLUTION 2.3.7
                                           chave da INSTÂNCIA                               │
                                                                                            │
 EVOLUTION ──POST (rede interna + JWT)──► /api/whatsapp/webhook ──► grava ─► 200 ─► after(): processa
 RELÓGIO (1×/min) ──► /api/severina/tick ──► saúde · rascunhos · eventos parados · verificações · entrega
```

### Onde cada peça mora

| Peça                                | Camada   | Faz                                                                                       |
| ----------------------------------- | -------- | ----------------------------------------------------------------------------------------- |
| `connectors/whatsapp/`              | conector | Fala "Evolution" e só isso: estado, QR, eventos, envio, consulta, leitura do webhook, JWT |
| `connectors/whatsapp/simulado.ts`   | conector | O mesmo contrato, sem rede — para o ensaio. **Recusado em produção**                      |
| `modules/assistente/services/`      | módulo   | Conexão, eventos, avisos, rascunhos, autorização de destinatário. Não conhece a Evolution |
| `modules/checklists/assistente.ts`  | módulo   | Declara o fato "fechamento concluído". A Severina pergunta; o Checklists responde         |
| `app/api/whatsapp/webhook/route.ts` | app      | A porta de entrada                                                                        |
| `app/api/whatsapp/_costura/`        | app      | A única costura entre módulo e conector: entrega da fila, verificação, saúde, telas       |
| `app/api/severina/tick/route.ts`    | app      | O relógio, que já existia, ganha as rodadas novas                                         |

As travas do linter continuam intactas: módulo não importa conector; o Checklists não importa a Severina; o Core não conhece nenhum dos dois.

### A peça de integração — o contrato

```ts
consultarConexao()   → pendente {faltando} | ok {estado, numero} | erro {motivo}
configurarEventos()  → aplica url + jwt_key + os 3 eventos
lerEventos()         → o que está configurado hoje (url mascarada)
pedirQrCode()        → {imagem, expiraEmMs} | "já conectado"
enviarMensagem()     → aceito {id} | nao-chegou | incerto | recusado
consultarMensagem()  → achou {id} | não achou   (depois de tempo esgotado)
```

Todo erro sai **limpo**: sem chave, token, `Bearer`, JWT, base64 longo ou telefone. Quem limpa é uma função pura, testada.

---

## 5 · Os dados

Três regras do Core valem para tudo: organização em toda linha, nada de negócio apagado de verdade, id aleatório. Nenhuma tabela nova declara `@relation` para o Core.

### Connection → `InstanciaWhatsapp` (a tabela que já existe, com colunas novas)

```
já tinha:  id, organizacaoId, nome (= instanceRef), numeroProprio, ativa,
           conectadaEm, desconectadaEm, ultimoErro
ganha:     unidadeId?            ← loja autorizada (vazio = rede)
           provedor              ← EVOLUTION_BAILEYS | SIMULADO
           estado                ← DESCONECTADO | CONECTANDO | CONECTADO | ATENCAO
           estadoDesde, vistoEm  ← lastSeenAt: última notícia do provedor
           motivoAtencao?        ← limpo
           agendamentosPausados  ← começa TRUE
           eventosConfiguradosEm?, ultimoEnvioEm?
```

- `ativa` continua sendo a **chave geral**: desligada, **nada sai** — nem aviso confirmado.
- `agendamentosPausados` segura só o disparo automático dos agentes da Severina. Começa pausado; quem libera é o dono, na tela.
- **"Configuração pendente" não é um estado gravado:** é calculado na leitura, a partir de quais variáveis faltam. Um segredo que falta não vira linha no banco.
- **Atenção** é gravada quando: o provedor recusou a credencial, não respondeu, estourou o limite de QR, ou ficou "conectando" por mais de 5 minutos.

### IncomingEvent → `EventoWhatsapp` (nova)

```
id, organizacaoId, instanciaId,
idExterno            ← providerEventId
tipo                 ← connection.update | messages.update | send.message | messages.upsert
status               ← RECEBIDO | PROCESSADO | IGNORADO | FALHOU
motivo?              ← por que foi ignorado ou falhou
resumo Json          ← SÓ campos permitidos (§6.3)
repeticoes           ← quantas vezes o mesmo evento chegou de novo
tentativas, recebidoEm, processadoEm?, ultimaRepeticaoEm?

@@unique([instanciaId, idExterno])     ← a trava contra duplicata
```

O `idExterno` de cada tipo:

| Tipo                | idExterno                                                            |
| ------------------- | -------------------------------------------------------------------- |
| `messages.update`   | `status:<keyId>:<status>` — a mesma mensagem tem "entregue" e "lida" |
| `send.message`      | `envio:<key.id>`                                                     |
| `messages.upsert`   | `entrada:<key.id>`                                                   |
| `connection.update` | `conexao:` + SHA-256 do corpo — a Evolution reenvia o corpo idêntico |

"Duplicado" não é um status: é o evento que chegou de novo e só somou em `repeticoes`. O trabalho não se repete.

**Evento ignorado com mais de 30 dias é apagado pelo relógio.** É registro técnico sem dado pessoal — o Core já diz que log técnico não pertence ao banco. Evento processado ou com falha fica.

### OutgoingMessage → `AvisoWhatsapp` (nova)

```
id, organizacaoId, unidadeId?, instanciaId,
idPedido             ← requestId: chave de idempotência. "checklists:fechamento:<id>"
referencia           ← "AV-7K2PQX", curta, vai no fim do texto
origemTipo, origemId?, permissaoNecessaria?
titulo, corpo, link?
destinatarioRef?     ← VinculoWhatsapp.id — nunca o telefone solto
status               ← RASCUNHO | CONFIRMADO | NA_FILA | ACEITO | ENTREGUE | LIDO
                       | INCERTO | FALHOU | DESCARTADO
idMensagemProvedor?  ← providerMessageId
tentativas, proximaTentativaEm?, tentativaIniciadaEm?, verificacoes, verificadoEm?, erro?
solicitadoPorId?     ← requestedBy (vazio = nasceu de um evento do sistema)
confirmadoPorId?     ← confirmedBy
descartadoPorId?
criadoEm, confirmadoEm?, enfileiradoEm?, aceitoEm?, entregueEm?, lidoEm?, falhouEm?, descartadoEm?

@@unique([organizacaoId, idPedido])
@@unique([instanciaId, idMensagemProvedor])
@@unique([referencia])
```

**Cada etapa só ganha horário com prova.** `aceitoEm` vem da resposta 201 da Evolution; `entregueEm` do `DELIVERY_ACK`; `lidoEm` do `READ`. "Lido" sem "entregue" antes fica com `entregueEm` vazio — não se inventa horário.

### `VinculoWhatsapp` ganha

```
autorizadoEm?, autorizadoPorId?   ← "autorizado para avisos", por um responsável
```

Só vínculo autorizado vira destinatário. `confirmadoEm` (que já existia) fica com a Severina, para o LID da fase 2.

---

## 6 · Os fluxos

### 6.1 · De um fechamento a uma mensagem

```
checklist "Fechamento…" FECHADO
      │  (o relógio pergunta ao Checklists: "algo fechou nas últimas 24h?")
      ▼
RASCUNHO  ── idPedido = "checklists:fechamento:<respostaId>" → o mesmo fechamento nunca vira dois rascunhos
      │  responsável escolhe o destinatário (só autorizados) e confirma
      ▼
CONFIRMADO ── confirmar duas vezes não faz nada: a troca só vale se ainda for RASCUNHO
      │  entrega (logo depois da confirmação, e o relógio como reserva)
      ▼
NA_FILA   ── a entrega "pega" o aviso com UPDATE … WHERE status = 'CONFIRMADO'. Dois relógios, uma mensagem
      │  Evolution: 201 + key.id
      ▼
ACEITO ──► ENTREGUE (DELIVERY_ACK) ──► LIDO (READ)
```

Antes de pegar o aviso, a entrega confere:

- chave geral ligada (`ativa`) — senão **não sai**, fica CONFIRMADO com "envio pausado"
- número conectado — senão fica CONFIRMADO com "aguardando conexão"
- destinatário ainda autorizado, ainda com acesso à loja, ainda com a permissão que o aviso exige (`checklists.ver`) — senão FALHOU com o motivo
- ritmo: 4 s entre mensagens do mesmo número

O texto:

```
*Fechamento pronto para revisão*
Loja: Vitaliano Centro
Checklist: Fechamento da Pizzaria
Concluído às 23:41 por Ana
Nota: 92% · 2 itens fora do padrão

Revise: https://app.vitalianopizzaria.com.br/checklists/…
Ref. AV-7K2PQX
```

### 6.2 · Quando o envio dá errado

| O que aconteceu                                                    | Vira                                                            | Por quê                                   |
| ------------------------------------------------------------------ | --------------------------------------------------------------- | ----------------------------------------- |
| Não conectou (`ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN`), ou 429    | CONFIRMADO de novo, em 1, 4, 9 min — até 3 vezes; depois FALHOU | O pedido **não chegou**: repetir é seguro |
| Tempo esgotado (15 s), conexão caiu no meio, 5xx, 201 sem `key.id` | **INCERTO**                                                     | Pode ter saído. Repetir pode duplicar     |
| 400 / 401 / 403 / 404                                              | FALHOU, com frase limpa                                         | Repetir não resolve                       |
| O processo morreu com o aviso em NA_FILA há mais de 2 min          | INCERTO                                                         | Mesmo caso do tempo esgotado              |

**O INCERTO, passo a passo:**

1. o relógio consulta a Evolution: mensagens `fromMe` desde o início da tentativa, com o **texto idêntico** — a referência `AV-…` torna o texto único
2. achou → ACEITO, com o id e o horário do provedor
3. o evento `send.message` também resolve: se chegar com o mesmo texto, o aviso vira ACEITO
4. não achou → tenta de novo a cada minuto, até 5 vezes; depois **para e espera um humano**
5. na tela: "Não encontrada no provedor. Pode não ter saído — ou a Evolution não guarda mensagens enviadas." Botões: **Reenviar mesmo assim** (responsável, com o aviso de risco de duplicar) e **Descartar**

Um erro de rede nunca vira cinco mensagens iguais: no máximo uma tentativa automática por pedido em que o resultado é desconhecido.

### 6.3 · A entrada do webhook

A ordem das travas, e a resposta de cada uma:

| #   | Trava                                                                                              | Se falhar |
| --- | -------------------------------------------------------------------------------------------------- | --------- |
| 1   | Senha do webhook configurada no servidor                                                           | 503       |
| 2   | **Veio pela rede interna** — pedido com `X-Forwarded-Server` ou `X-Real-Ip` passou pelo Traefik    | 403       |
| 3   | `Content-Type: application/json`                                                                   | 415       |
| 4   | Até **256 KB**, contados na leitura (não no cabeçalho)                                             | 413       |
| 5   | `Authorization: Bearer` com JWT HS256 válido, `app: evolution`, `action: webhook`, dentro do prazo | 401       |
| 6   | JSON que abre                                                                                      | 400       |
| 7   | Tipo previsto (os 4 da tabela do §5)                                                               | 422       |
| 8   | Formato do tipo — esquema estrito no envelope, campos exigidos em `data`                           | 400       |
| 9   | Instância existe **no cadastro do Tetteo** e é a da credencial configurada                         | 404       |
| 10  | Grava com a trava de duplicata → `200 {ok, duplicado}` na hora                                     | —         |

Depois da resposta, `after()` processa. Se o processo cair antes, o relógio pega o evento que ficou RECEBIDO há mais de 30 s.

**A organização e a loja saem do cadastro da instância, nunca do corpo recebido.** O corpo diz só o nome da instância; o Tetteo procura esse nome na sua tabela.

Por que 2 é assim: o Next.js preenche `x-forwarded-for/host/proto/port` sozinho em toda requisição (`base-server.js`), então esses não dizem nada. `X-Forwarded-Server` e `X-Real-Ip` são postos **só** pelo Traefik, que não aceita os que vêm do cliente. A Evolution chama pela rede interna do Docker e não passa por ele. **A confirmar no servidor:** um `curl` de fora recebe 403 e a Evolution passa.

O que o `resumo` guarda, por tipo — e nada além:

| Tipo                | Guarda                                                             | Nunca guarda                          |
| ------------------- | ------------------------------------------------------------------ | ------------------------------------- |
| `connection.update` | estado, código, os 4 últimos dígitos do número                     | nome de perfil, foto                  |
| `messages.update`   | id da mensagem, status, se é nossa                                 | `remoteJid`                           |
| `send.message`      | id da mensagem, SHA-256 do texto                                   | o texto, o destinatário               |
| `messages.upsert`   | id, se é do próprio número, se é grupo, se o remetente é vinculado | texto, `remoteJid`, `pushName`, mídia |

### 6.4 · Processar um evento

| Tipo                | O que faz                                                                                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `connection.update` | `open` → CONECTADO · `connecting` → CONECTANDO · `close` → DESCONECTADO · `refused` → ATENÇÃO ("limite de QR")                                              |
| `messages.update`   | acha o aviso pelo id → avança o estado, **nunca volta** (LIDO não vira ENTREGUE). Não é aviso nosso → IGNORADO                                              |
| `send.message`      | confirma um ACEITO, ou resolve um INCERTO pelo texto. Mensagem mandada fora do Tetteo → IGNORADO                                                            |
| `messages.upsert`   | **sempre IGNORADO nesta fase**, com o motivo: do próprio número (é o que impede ciclo), grupo, remetente não autorizado, ou "respostas ainda não são lidas" |

**Nenhum evento dispara envio.** É a trava contra ciclo por construção, não por disciplina: o único caminho até `enviarMensagem` passa por CONFIRMADO, e só uma pessoa confirma.

### 6.5 · Conexão e QR Code

- A tela lê o estado na hora (4 s de limite) e grava. O relógio faz o mesmo a cada minuto — é o que pega a queda que a Evolution não avisa (ela reconecta calada)
- **Reconectar** = `GET /instance/connect`. Conectado: não faz nada. Desconectado: devolve QR. **Nunca `logout`.**
- O QR vai do servidor ao navegador **dentro da resposta da ação**, fica só na memória da página, some em 45 s ("Gerar novo"), e some de vez quando o estado vira CONECTADO. Não é gravado no banco, não entra em log, não entra em print — os prints do ensaio usam o provedor simulado, que não produz QR de verdade

---

## 7 · As telas

Dentro da Severina. Uma coluna no celular, ações sempre visíveis, nada de bloco longo de texto.

| Tela         | Mostra                                                                                                                                                                      | Ações                                                                                                     |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **WhatsApp** | Estado (Desconectado · Conectando · Conectado · Atenção · Configuração pendente), número mascarado, última atualização, loja autorizada, webhook atual (endereço mascarado) | Reconectar · QR (só quem pode) · Aplicar eventos · Envio ligado/pausado · Agendamentos pausados           |
| **Eventos**  | Recebidos · Ignorados · Duplicados · Falhas no período; a lista                                                                                                             | Abrir um evento: painel lateral com o resumo limpo                                                        |
| **Avisos**   | Para revisar · Em andamento · Pendências · Todos; cada aviso com destinatário e estado                                                                                      | Painel: prévia, destinatário, linha do tempo das etapas, erro · Confirmar · Salvar · Descartar · Reenviar |
| **Números**  | (já existia) + "Autorizado para avisos"                                                                                                                                     | Autorizar · Revogar                                                                                       |

Número mascarado: `(84) •••••-6549` — DDD e os 4 últimos.

---

## 8 · Permissões

| Chave                         | Quem                | Pode                                                                    |
| ----------------------------- | ------------------- | ----------------------------------------------------------------------- |
| `assistente.ver`              | já existia          | Ver WhatsApp (sem QR), Eventos e Avisos das lojas que enxerga           |
| `assistente.preparar` (nova)  | operador autorizado | Criar e editar rascunho                                                 |
| `assistente.conectar` (nova)  | responsável         | Reconectar, ver o QR, aplicar eventos, loja autorizada, chaves de envio |
| `assistente.autorizar` (nova) | responsável         | Autorizar destinatário, confirmar envio, reenviar                       |

**A permissão vale na loja da conexão, não na loja que está aberta na tela.** Quem é Gerente no Centro e só Consulta na Zona Sul não vê o QR da Zona Sul, mesmo com o Centro aberto. O Tetteo monta o contexto daquela pessoa naquela loja (`contextoDeFundo`) e pergunta `pode()` ali. Conexão da rede inteira exige acesso de rede.

Credencial não se troca por tela nenhuma — nem pelo responsável. A Severina continua "em construção": no primeiro teste, só o Diretor a vê.

---

## 9 · Segredos, rotação e backup

### Variáveis (vazias no `.env.example`, preenchidas só no Dokploy)

| Variável                          | O que é                                                     |
| --------------------------------- | ----------------------------------------------------------- |
| `EVOLUTION_URL`                   | `http://evolution_api:8080` — rede interna                  |
| `EVOLUTION_INSTANCIA`             | nome da instância na Evolution                              |
| `EVOLUTION_API_KEY`               | **chave da instância**, nunca a global                      |
| `WHATSAPP_WEBHOOK_URL`            | endereço interno que a Evolution chama                      |
| `WHATSAPP_WEBHOOK_CHAVE`          | a senha do JWT (`openssl rand -hex 32`, gerada no servidor) |
| `WHATSAPP_WEBHOOK_CHAVE_ANTERIOR` | só durante a troca                                          |

### Rotação

- **Senha do webhook:** põe a atual em `_ANTERIOR`, gera a nova, reaplica os eventos pela tela, apaga `_ANTERIOR`. Nada para.
- **Chave da instância: a 2.3.7 não troca pela API.** É limite conhecido. As saídas são recriar a instância (novo QR) ou editar no banco da Evolution — as duas fora deste trabalho.

### Backup

- **Configuração** (conexão, vínculos autorizados, avisos, eventos) vive no banco do Tetteo → o backup do banco do Tetteo cobre. **Não contém segredo nenhum**: os segredos estão só no ambiente. O ensaio prova isso procurando os valores dentro do dump.
- **Sessão do número** vive na Evolution: banco dela (tabela `Session`) e, conforme a configuração do contêiner, Redis ou o volume `evolution_instances`. Este backup **contém segredo por natureza** (a sessão e a chave da instância) — pasta de root, `chmod 600`, fora do Git, retenção de 14 dias.
- Instalar o backup na VPS exige acesso ao servidor: fica como passo da fase real, com autorização do dono.

---

## 10 · Ensaio, testes e aceite

| Degrau          | O que é                                                                                                                                  |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Simulação**   | Testes automáticos com o provedor simulado, sem rede. Funções puras em `npm test`; os 12 cenários contra um banco descartável            |
| **Teste local** | O Tetteo rodando na máquina, com o banco descartável e o provedor simulado; o webhook recebe POST de verdade, assinado; prints das telas |
| **Sandbox**     | **Não existe para Baileys.** Declarado, não fingido                                                                                      |
| **Uso real**    | Número real, **um** destinatário autorizado pelo dono, uma mensagem — só depois de ele ver os testes e as pendências                     |

Os 12 cenários de aceite, cada um um teste:

1. Conexão sem segredo mostra **configuração pendente**, com o nome do que falta — nunca o valor
2. Credencial inválida **não vaza**: o provedor devolve a chave no corpo do erro, e ela não aparece no que é gravado nem no log
3. Evento repetido **não duplica trabalho**: uma linha, `repeticoes = 1`, o aviso avançou uma vez
4. Mensagem própria **não inicia ciclo**: `send.message` e `messages.upsert` com `fromMe` não criam aviso nem envio
5. Usuário de outra loja **não vê o QR**
6. **Uma confirmação, uma mensagem** — mesmo com confirmação dupla e duas entregas ao mesmo tempo
7. Tempo esgotado vira **pendência rastreável** (INCERTO), sem reenvio automático
8. Desconexão **muda o estado**
9. Reconexão **não apaga o histórico** — e o simulado nem tem `logout`
10. Webhook malformado é **rejeitado** — JSON quebrado, tipo desconhecido, JWT errado ou vencido, grande demais, instância desconhecida, vindo pelo proxy
11. Envio pausado **não dispara** — nem aviso confirmado, nem agente
12. Restauração recupera a configuração **sem publicar segredo** — dump, restauração num banco novo, e os valores dos segredos não estão no arquivo

**Um build verde não prova a integração.** O que prova é o degrau "uso real", e ele fica registrado à parte.

---

## 11 · Riscos e limites conhecidos

| Risco / limite                                                                                         | O que o desenho faz                                                                                     |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| **Baileys não é API oficial.** A Meta não dá suporte; automação fora dos termos pode bloquear o número | Um destinatário, confirmação humana, ritmo, nada em massa. Trocar para a Cloud API é trocar o conector  |
| O número conectado era, em agosto, a conta **pessoal** do dono (~1000 contatos)                        | Nenhuma conversa pessoal entra no Tetteo: `messages.upsert` fica fora da assinatura                     |
| A 2.3.7 não assina o corpo do webhook                                                                  | JWT com prazo + rede interna + esquema estrito + trava de duplicata (que também anula repetição de JWT) |
| A 2.3.7 não tem idempotência no envio                                                                  | INCERTO + consulta ao provedor + humano decide                                                          |
| A consulta depende de `DATABASE_SAVE_DATA_NEW_MESSAGE=true` na Evolution                               | A tela diz que não achou **e** que pode ser configuração; nunca conclui que "não saiu"                  |
| "Entregue/Lido" dependem de a Evolution mandar `messages.update`                                       | Sem o evento, o aviso fica em ACEITO — que é a verdade que se tem                                       |
| Queda que se recupera sozinha não gera evento                                                          | O relógio consulta o estado a cada minuto                                                               |
| A chave da instância não troca pela API                                                                | Registrado em §9                                                                                        |
| O relógio de produção precisa existir (tarefa agendada batendo no `tick`)                              | Conferir na fase real; sem ele, os rascunhos não nascem sozinhos e a entrega depende do `after()`       |
| `date_time` da Evolution tem um `Z` enganoso (é hora local)                                            | O Tetteo não usa esse campo como horário — usa o do próprio servidor                                    |

---

## 12 · Notas para a implementação

- Next.js 16: `after()` em Route Handler e Server Action; `params` é `Promise`. Ler `node_modules/next/dist/docs/` antes de cada tipo de arquivo
- O `proxy.ts` precisa deixar `/api/whatsapp` passar — como o `tick`, é máquina, não gente. A autenticação dela é o JWT
- `npm run check` antes de todo commit; `npm run build` antes de publicar
- Banco do ensaio: `embedded-postgres` com `--encoding=UTF8 --locale=C`, porta 5435, fora do repositório
- Publicar a partir desta worktree, com fast-forward no `main`, só com autorização do dono (o push publica)
