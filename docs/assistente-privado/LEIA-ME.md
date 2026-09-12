# Assistente privado — leia-me

O assistente privado é um assistente de IA que roda por conta própria na
VPS, usando a assinatura ChatGPT do próprio responsável pela operação
(Pablo) — sem chave de API, sem custo por fora da assinatura. Ele hoje só
sabe fazer uma coisa: ler um arquivo de vendas autorizado e calcular o
fechamento do período (total, pedidos, ticket médio, dias sem venda,
anomalias), sempre citando a fonte e nunca inventando número. Ele não
executa nada sozinho — só consulta e prepara rascunhos, que outra pessoa
decide se usa ou não.

Nesta fase, tudo o que ele tocou foi **dado fictício**, feito de propósito
para teste. Usar com dados reais da Vitaliano Pizzaria é um passo futuro,
que só começa depois de o Pablo decidir e autorizar.

## Isto não é a tela "Conexões de IA"

Em **Configurações › Conexões de IA** existe outra lista, parecida no nome
mas diferente na função: ali aparecem as pessoas da equipe que ligaram um
assistente como o Claude à própria conta do Tetteo (entrando com a própria
senha), com um botão para revogar esse acesso. O assistente privado desta
pasta é outra coisa — roda sozinho na VPS, não usa a senha de ninguém, e
por isso nunca aparece nessa lista. Para saber se ele respondeu hoje, olhe
o cartão "Assistente privado" no Painel; para ver ou revogar o acesso de
alguém da equipe a uma IA, use Configurações › Conexões de IA; para
desligar ou revogar o assistente privado em si, o caminho é outro,
descrito em `operacao.md`.

## Onde cada coisa mora

**Neste repositório (o código):**

- `assistente-privado/` — a ferramenta em si (o servidor MCP "fechamento"
  que lê os arquivos, calcula e salva), a configuração de exemplo do
  contêiner, e os testes automáticos.
- `src/modules/assistente-privado/` — o módulo do Tetteo que recebe os
  registros do assistente e monta o cartão no Painel.
- `docs/assistente-privado/` — esta pasta: os quatro documentos abaixo.
- `docs/telas/assistente-privado/` — os prints reais das três telas da
  demonstração.

**Na VPS (o que roda de verdade):**

- Contêiner `central-openclaw`, em `/opt/central-de-comando/openclaw/` —
  a imagem do OpenClaw, sempre ligada, fora do sistema de publicação do
  Tetteo.
- `/opt/central-de-comando/segredos/openclaw.env` — o token do painel e
  os segredos do contêiner (nunca neste repositório).
- `/opt/central-de-comando/backups/` — as cópias de segurança da
  configuração.
- O login da assinatura ChatGPT e as conversas do assistente vivem só
  dentro dos volumes Docker da VPS — nunca neste repositório.

## Os outros quatro documentos

- **[`operacao.md`](./operacao.md)** — como operar no dia a dia: abrir o
  painel, ligar e desligar, refazer login, ver a franquia, verificar a
  conexão, revogar acesso, backup e restauração, atualizar, gerar dados
  de teste, repetir o roteiro de perguntas, e o que nunca fazer.
- **[`versoes-e-fontes.md`](./versoes-e-fontes.md)** — as versões exatas
  em uso, as correções de configuração feitas em 12/09/2026, a
  documentação oficial consultada, e os limites conhecidos.
- **[`verificacao.md`](./verificacao.md)** — o que foi testado, onde
  (testes automáticos, ensaio local, 17 perguntas ao vivo no servidor), e
  o resultado de cada um, com os dois problemas encontrados e corrigidos.
- **[`demonstracao.md`](./demonstracao.md)** — o roteiro de três telas
  para mostrar o assistente a alguém: o que mostrar, o que falar, e o
  print de cada tela.

## O desenho original

A decisão de arquitetura, as regras de segurança e os limites conhecidos
foram aprovados antes da implementação, em:

`docs/superpowers/specs/2026-09-11-assistente-privado-openclaw-design.md`
