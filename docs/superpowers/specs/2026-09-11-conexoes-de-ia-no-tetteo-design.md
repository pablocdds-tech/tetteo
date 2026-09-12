# Conexões de IA dentro do Tetteo — desenho

Aprovado pelo Pablo em 11/09/2026, depois que o servidor MCP entrou no ar
(`docs/superpowers/specs/2026-09-11-servidor-mcp-design.md`).

## 1. O que é

Uma tela em **Configurações › Integrações** que mostra quem conectou uma IA ao Tetteo,
por qual loja, com qual cliente, e permite **revogar**.

O servidor MCP continua sendo um serviço separado. Ele fala HTTPS com a nuvem da
Anthropic, tem regras de OAuth próprias e um papel de banco que quase nada enxerga.
Trazê-lo para dentro do app do Tetteo daria ao app principal a mesma superfície pública e
acabaria com esse isolamento. O que vem para dentro é o **controle**, não o servidor.

## 2. A tela (`/configuracoes/integracoes`)

**Cartão do servidor, no alto:** o endereço público, se ele respondeu agora (consulta ao
`/health`, no máximo 2 s) e a fonte de vendas em uso — hoje, "fictícia". Sem o endereço
configurado, o cartão diz isso em vez de fingir que está tudo bem.

**Uma linha por conexão:** pessoa (nome e e-mail), loja, cliente (Claude, Claude Code),
quando foi criada, último uso, consultas nos últimos 7 dias e a situação — ativa, ou
revogada com o motivo.

**Uma ação: Revogar**, em botão destrutivo com confirmação. Não existe "criar conexão"
aqui: conexão nasce só pelo consentimento no Claude, com a senha da pessoa. Uma tela que
criasse acesso sem esse gesto seria um buraco.

**Nenhuma chave aparece** — o banco guarda só impressões digitais, nunca a chave.

## 3. Por dentro

- **`src/connectors/mcp/`**: a ponte. Lê o esquema `mcp` com SQL direto (`$queryRaw`) e
  só escreve para revogar (`revogada_em`, `motivo_revogacao`, e apaga as chaves daquela
  conexão — o mesmo que o servidor MCP faz). É a camada que o Tetteo já usa para WhatsApp
  e fornecedores; conector não é App, não tem manifesto nem ícone.
- **Permissão nova `configuracoes.integracoes`** — "Ver e revogar as conexões de IA" — em
  `PERMISSOES_CONFIGURACOES`. Ver e revogar ficam na mesma chave de propósito: revogar
  reduz acesso, e exigir a permissão mais perigosa do sistema (`configuracoes.editar`)
  para cortar um acesso suspeito atrapalharia justamente na hora errada.
- **Auditoria:** revogar grava em `auditoria` (entidade `ConexaoMcp`), com quem revogou.
  Aparece no Histórico como qualquer outra alteração.
- **Escopo de rede:** a lista mostra as conexões da organização inteira, com a loja de
  cada uma. Conexão é de uma pessoa e de uma loja; esconder as outras faria o dono perder
  a visão do todo.
- **Sem o esquema `mcp`** (bancos de desenvolvimento), a tela diz "o servidor MCP ainda
  não foi preparado neste banco" em vez de quebrar.
- **Configurações › Integrações** deixa de ser um bloco vazio e passa a levar para cá,
  com a contagem de conexões ativas.

## 4. Erros e limites

- A consulta ao `/health` tem 2 s de limite e nunca derruba a tela: sem resposta, o cartão
  diz "não respondeu agora".
- Revogar é idempotente: revogar de novo não muda nada e não dá erro.
- A tela é servidor (server component); a confirmação é o único pedaço de cliente.

## 5. Configuração

`MCP_URL_PUBLICA` no ambiente do app principal (não é segredo: é o endereço público).
Sem ela, a tela some do menu? Não — a tela aparece e o cartão explica que falta
configurar.

## 6. Testes

- **Unidade:** formatação das linhas (última atividade, situação, contagem) e o resumo do
  cartão do servidor com resposta boa, ruim e ausente.
- **Integração (banco real):** cria o esquema `mcp` com o SQL do próprio serviço, insere
  conexões e chamadas de mentira, e confere a listagem, a contagem de 7 dias, a revogação
  (inclusive a idempotência), o registro na auditoria e a recusa por falta de permissão.

## 7. Fora do escopo

- Criar ou editar conexão pela tela.
- Mover o servidor MCP para dentro do app do Tetteo.
- Mostrar o conteúdo das consultas (a tela mostra quantas, não o que foi perguntado).
- Gráficos de uso.
