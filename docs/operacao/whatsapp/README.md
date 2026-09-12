# WhatsApp no Tetteo — como iniciar, testar, atualizar e recuperar

Escrito em 11/09/2026, junto com a implementação (branch `whatsapp-avisos`).
Em português simples, para quem opera — não só para quem programa.

## O que isto faz, em uma frase

Quando alguém conclui o **checklist de Fechamento** de uma loja, nasce um
**rascunho** de aviso. Um responsável escolhe quem recebe, confere a prévia e
confirma. Sai **uma** mensagem, pelo número já conectado na Evolution. Nada
sai sozinho.

## Os degraus — e em qual estamos

| Degrau          | O que é                                                                                 | Estado em 11/09/2026                                                                                     |
| --------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **Simulação**   | Testes automáticos com o provedor simulado, sem rede (`npm test` + o ensaio de aceite)  | feito, 23/23                                                                                             |
| **Teste local** | O Tetteo rodando na máquina com banco descartável e provedor simulado; prints das telas | feito                                                                                                    |
| **Sandbox**     | **Não existe para Baileys.** Está declarado, não fingido                                | —                                                                                                        |
| **Uso real**    | Número real, **um** destinatário autorizado pelo dono, uma mensagem                     | em andamento: conexão, relógio e webhook provados em 11/09; falta o aviso de fechamento de ponta a ponta |

Um build verde não prova a integração. O que prova é o degrau "uso real".

## Antes de começar (uso real)

Precisa existir:

1. A Evolution API **2.3.7** no ar, com a instância do número **já conectada**
   (é o caso: `evo.vitalianopizzaria.com.br`, versão conferida em 10/09/2026).
2. O Tetteo publicado com esta versão (a migração
   `20260910231616_whatsapp_avisos` roda sozinha quando o contêiner sobe).
3. Acesso ao painel do Dokploy para criar as variáveis — **só lá**. Nunca cole
   chave, senha ou token no chat, no Git ou num documento.

## As variáveis (sem valores)

| Variável                          | O que é                                                               | Onde obter                                |
| --------------------------------- | --------------------------------------------------------------------- | ----------------------------------------- |
| `EVOLUTION_URL`                   | `http://evolution_api:8080` — a Evolution pela rede interna do Docker | não é segredo                             |
| `EVOLUTION_INSTANCIA`             | o nome da instância que já existe na Evolution                        | painel da Evolution                       |
| `EVOLUTION_API_KEY`               | a chave **da instância** (o "token" dela), não a global               | painel da Evolution, na instância         |
| `WHATSAPP_WEBHOOK_URL`            | `http://<contêiner do tetteo>:3000/api/whatsapp/webhook`              | o nome do serviço do Tetteo no Dokploy    |
| `WHATSAPP_WEBHOOK_CHAVE`          | a senha do passe (mínimo 16 caracteres)                               | gerar no servidor: `openssl rand -hex 32` |
| `WHATSAPP_WEBHOOK_CHAVE_ANTERIOR` | só durante a troca da senha                                           | —                                         |
| `SEVERINA_TICK_SEGREDO`           | o cabeçalho que o relógio manda                                       | gerar no servidor: `openssl rand -hex 32` |
| `APP_URL`                         | `https://app.vitalianopizzaria.com.br` — vai no link do aviso         | já existe                                 |

Faltando qualquer uma das de WhatsApp, a tela mostra **Configuração pendente**
com o nome do que falta — e nada é enviado.

## Como iniciar (uso real), passo a passo

1. **No Dokploy**, na aplicação do Tetteo, crie as variáveis acima e publique.
2. **O relógio precisa existir.** Uma tarefa agendada deve bater em
   `/api/severina/tick` a cada minuto, com o cabeçalho `x-severina-segredo`.
   Sem ele, os rascunhos não nascem sozinhos e a consulta de saúde não roda.
   **A tela WhatsApp diz se ele está batendo** ("Relógio: bateu 11/09 12:40";
   "nunca bateu" quer dizer que a tarefa não existe). Para criar, no Dokploy →
   aplicação do Tetteo → **Schedules** → cron `* * * * *`, rodando dentro do
   contêiner da aplicação:

   ```
   wget -q -O - --post-data '' --header "x-severina-segredo: $SEVERINA_TICK_SEGREDO" http://127.0.0.1:3000/api/severina/tick
   ```

   Shell `sh`. Use `127.0.0.1`, **não** `localhost`: no Alpine, `localhost`
   aponta primeiro para o IPv6 (`::1`), e o Tetteo escuta só em IPv4
   (`0.0.0.0`) — o resultado é `Connection refused`. (O contêiner é Alpine:
   tem `wget`, não tem `curl`; a variável já está no
   ambiente dele, então o segredo não é digitado em lugar nenhum). Se o
   Dokploy não oferecer Schedules, o mesmo comando vai no `cron` da VPS, com
   `curl` e o endereço público — aí o segredo entra no crontab, que precisa
   ser `600` do root.

3. **Entre no Tetteo como Diretor** (desde 11/09 a Severina não está mais "em construção", mas só o Diretor tem
   as permissões dela; para outros papéis, Configurações). Menu Severina → **WhatsApp**. O bloco Conexão mostra dois
   **sinais de vida**: a última batida do relógio e o último evento que a
   Evolution entregou pelo webhook. Os dois precisam ter hora recente antes do
   primeiro envio real.
4. **Cadastre a conexão**: o nome da instância vem sugerido da variável. Escolha
   a loja. Nada é criado na Evolution; o número conectado continua conectado.
5. A tela mostra o estado (Conectado / Conectando / Desconectado / Atenção), o
   número mascarado e a última notícia. Se mostrar **Configuração pendente**, o
   nome do que falta está escrito ali.
6. **Aplicar configuração** (em "Eventos do provedor"). Isto **substitui** o
   webhook atual da instância na Evolution — a tela mostra o atual antes.
   Depois disso a Evolution passa a avisar o Tetteo sobre conexão, status das
   mensagens e mensagens enviadas. Só esses três; conversas não entram.
7. **Números** → na pessoa do contato de teste, **Autorizar para avisos**. Um
   só, no primeiro teste.
8. **Avisos** → "Preparar aviso" (ou espere um fechamento de checklist virar
   rascunho) → abra o aviso → escolha quem recebe → **Confirmar envio** → "Sim,
   enviar". Uma confirmação, uma mensagem.
9. Acompanhe em **Avisos** (linha do tempo: aceito → entregue → lido) e em
   **Eventos** (o que a Evolution contou).

Envio **pausado** e agendamentos **pausados** são as duas chaves da tela
WhatsApp. Os agendamentos da Severina nascem pausados e só o dono libera.

## Como conferir a trava do proxy (uma vez, no uso real)

O webhook só aceita chamada pela rede interna. De fora, deve recusar:

```
curl -s -o /dev/null -w "%{http_code}" -X POST https://app.vitalianopizzaria.com.br/api/whatsapp/webhook -H "content-type: application/json" -d "{}"
```

Esperado: `403` (chegou pelo proxy público). Enquanto isso, os eventos da
Evolution aparecem na tela Eventos — é a prova de que a chamada interna passa.

Se `WHATSAPP_WEBHOOK_URL` apontar para o domínio público por engano, a tela
WhatsApp avisa em "Eventos do provedor" — nesse caso toda chamada da Evolution
seria recusada, e a Evolution não repete um 403.

## Como testar na máquina (ensaio, sem número real)

O ensaio roda contra um banco **local e descartável**, com o provedor simulado.
Ele se recusa a rodar se o `DATABASE_URL` não for local com nome terminado em
`_ensaio`.

```bash
# 1. Um PostgreSQL descartável (UTF8), fora do repositório. Ex.: embedded-postgres na porta 5435.
# 2. .env.local apontando para ele: DATABASE_URL=postgresql://.../tetteo_ensaio
npx prisma migrate deploy
npx prisma generate

# Os testes de função pura (rápidos, sem banco)
npm test

# Os 12 cenários de aceite (com banco, provedor simulado e webhook de verdade)
npx tsx --require ./ensaio/whatsapp/sem-server-only.cjs --test ensaio/whatsapp/aceite.ensaio.ts

# Dados fictícios para olhar as telas
npx tsx --require ./ensaio/whatsapp/sem-server-only.cjs ensaio/whatsapp/demonstracao.ts
npx next dev --port 3001
```

Os 12 cenários (todos passam em 11/09/2026): configuração pendente · credencial
inválida não vaza · evento repetido não duplica · mensagem própria não inicia
ciclo · usuário de outra loja não vê QR · uma confirmação, uma mensagem · tempo
esgotado vira pendência · desconexão muda o estado · reconexão não apaga o
histórico · webhook malformado é rejeitado · envio pausado não dispara ·
restauração sem segredos. Mais seis, vindos da revisão do código: a prova
(`send.message`) que chega antes da resposta do envio; o "entregue" que chega
antes do id; o ritmo de 4 s entre duas pegadas; as tentativas em 1, 4 e 9
minutos antes de desistir; o mesmo evento processado por dois lados; a chave
geral só na loja do número.

## Como atualizar

Deploy normal: push no `main` → o Dokploy constrói → o contêiner aplica as
migrações pendentes ao subir. Nenhum passo manual. Antes de publicar:
`npm run check` e `npm run build` no repositório.

Para atualizar a **Evolution**: fixe a etiqueta (`v2.3.7` hoje). **Não use
`latest`**: aponta para uma versão de teste. Antes de subir para 2.4.x, releia
o código da nova versão — os caminhos e corpos que o Tetteo usa foram lidos da
2.3.7.

## Como trocar a senha do webhook (rotação, sem parar nada)

1. No Dokploy: copie o valor atual de `WHATSAPP_WEBHOOK_CHAVE` para
   `WHATSAPP_WEBHOOK_CHAVE_ANTERIOR`.
2. Gere a nova no servidor (`openssl rand -hex 32`) e ponha em
   `WHATSAPP_WEBHOOK_CHAVE`. Publique.
3. Na tela WhatsApp → **Aplicar configuração**. A Evolution passa a assinar com
   a nova. Até aqui, as duas valem — nenhum evento cai.
4. Apague `WHATSAPP_WEBHOOK_CHAVE_ANTERIOR` e publique de novo.

**Chave da instância (`EVOLUTION_API_KEY`)**: a 2.3.7 não a troca pela API.
É limite conhecido. Trocar exige recriar a instância (novo QR) ou editar no
banco da Evolution — fora deste trabalho.

## Backup e recuperação

- **Configuração do Tetteo** (conexão, autorizados, avisos, eventos): está no
  banco do Tetteo. O backup do banco cobre. **Não contém segredo** — os
  segredos só existem no ambiente. O cenário 12 do ensaio prova isso: exporta o
  banco inteiro, procura os valores dos segredos e não acha.
- **Sessão do número**: está na Evolution — no banco dela e, conforme a
  configuração do contêiner, no Redis ou no volume `evolution_instances`. Esse
  backup **contém segredo por natureza**: pasta do root, `chmod 600`, fora do
  Git, 14 dias. Script: `backup-evolution.sh`. Restauração: `restaurar.md`.
- Instalar o backup da sessão na VPS, uma vez, como root. O repositório é
  privado, mas o Dokploy já baixou o código na máquina, então o script sai de
  lá:

  ```
  find /etc/dokploy -name backup-evolution.sh -exec sh {} \;
  ```

  O script descobre sozinho os nomes dos contêineres, recusa um dump vazio,
  guarda 14 dias e se agenda para as 03:40. Rodar de novo não duplica o
  agendamento.

## Limites conhecidos

- Baileys **não é API oficial**. A Meta não dá suporte; automação fora dos
  termos pode bloquear o número. O desenho reduz o risco (um destinatário,
  confirmação humana, ritmo, nada em massa), não o elimina. Trocar para a
  Cloud API é trocar o conector.
- A 2.3.7 não assina o corpo do webhook (só o passe JWT) e não tem idempotência
  no envio. O Tetteo compensa; está escrito no desenho, §11.
- A consulta "a mensagem saiu?" depende de a Evolution guardar as mensagens
  enviadas. Confirmado com o dono em 11/09/2026: a instalação guarda as
  enviadas, que é justamente o que essa consulta procura (`key.fromMe: true`).
  Se um dia isso mudar, a tela passa a dizer "não consegui confirmar" e o
  reenvio vira decisão de uma pessoa, nunca automática.
- "Entregue" e "Lido" dependem do evento `MESSAGES_UPDATE`. Sem ele, o aviso
  fica em "Aceito pelo provedor", que é a verdade que se tem.
- O número conectado hoje é uma conta pessoal. Conversas **não** entram no
  Tetteo (o evento de mensagem recebida não é assinado).

## Fontes

- Código-fonte oficial, etiqueta `2.3.7`:
  https://github.com/evolution-foundation/evolution-api/tree/2.3.7
- Documentação oficial: https://docs.evolutionfoundation.com.br/
- Desenho e decisões: `docs/superpowers/specs/2026-09-10-whatsapp-avisos-design.md`
