# Assistente privado — versões e fontes

Escrito em 12/09/2026, no dia em que tudo abaixo foi conferido ao vivo, direto
no servidor, na conta do próprio Pablo.

## Versões

Cada valor abaixo tem o comando que o provou — não uma suposição, uma
leitura direta do sistema rodando.

| #   | O quê                      | Valor                                                                                                                                                        | Como foi conferido                                                                                                                                                                       |
| --- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Imagem do OpenClaw         | `ghcr.io/openclaw/openclaw:2026.9.4`                                                                                                                         | `docker image inspect` na VPS                                                                                                                                                            |
| 2   | Digest da imagem           | `sha256:cc596b846506a5f4cfcee111394a2725f375f01cca2ebb492a161fd1b747f101`                                                                                    | `docker image inspect` na VPS                                                                                                                                                            |
| 3   | Node dentro da imagem      | v24.19.0                                                                                                                                                     | `docker exec central-openclaw node --version`                                                                                                                                            |
| 4   | Docker da VPS              | versão 29.5.3, build `d1c06ef`                                                                                                                               | `docker --version` na VPS                                                                                                                                                                |
| 5   | Docker Compose da VPS      | v5.1.4                                                                                                                                                       | `docker compose version` na VPS                                                                                                                                                          |
| 6   | Sistema operacional da VPS | Ubuntu 24.04.4 LTS, kernel 6.8.0-136-generic                                                                                                                 | `cat /etc/os-release` e `uname -r` na VPS                                                                                                                                                |
| 7   | Modelo escolhido           | `openai/gpt-5.6-sol`, pelo mecanismo (runtime) `codex`, com a assinatura ChatGPT do Pablo por OAuth — sem chave de API, sem modelo reserva (`fallbacks: []`) | Página de configurações do agente no painel (Modelo Principal / Ambiente de Execução) e o registro interno de cada resposta, confirmando o modelo certo e que nenhuma via paga foi usada |
| 8   | Data desta conferência     | 12/09/2026                                                                                                                                                   | Todos os itens acima foram checados neste mesmo dia, ao vivo                                                                                                                             |

O login por assinatura estava válido até **22/09/2026**, com aviso automático
24 horas antes do vencimento.

## Correções feitas em 12/09/2026 (decisões datadas)

No dia da verificação ao vivo, três ajustes de configuração foram necessários
para o assistente funcionar de verdade. Os três estão registrados aqui porque
mudam o comportamento do sistema e o Pablo autorizou cada um depois de ouvir
a explicação.

1. **O mecanismo de execução fixo foi removido.** A configuração original
   travava um runtime que exige uma chave de API paga — mas a credencial
   aqui é só a assinatura do Pablo. Sem essa trava, o OpenClaw escolhe
   sozinho a rota certa da assinatura (o mecanismo chamado "Codex").
2. **O plugin do Codex foi ligado.** Ele vem desligado de fábrica na
   imagem; sem ele, a rota da assinatura simplesmente não existe.
3. **A permissão de execução (`tools.exec.mode`) mudou de negar/lista para
   `auto` — nunca `full`.** O mecanismo da assinatura (Codex) precisa
   rodar um processo próprio para funcionar; com `deny` ou `allowlist`
   ligados, esse processo é bloqueado por completo e o assistente não
   responde nada. `auto` deixa o Codex Guardian revisar cada comando
   automaticamente, com o sandbox confinado à pasta de trabalho do
   assistente, e escala para aprovação humana o que for arriscado. O que
   continua de pé, como camada extra de proteção: nenhuma ferramenta de
   execução é oferecida ao modelo (isso continua negado), o contêiner roda
   sem privilégios extras, a ferramenta de fechamento é montada só para
   leitura, e a porta do painel só existe em `127.0.0.1`. O Pablo autorizou
   essa troca explicitamente, depois de eu apresentar as duas opções reais.
4. **O servidor MCP "fechamento" foi pré-aprovado, um por um — não para
   todo mundo.** Antes disso, toda chamada da ferramenta de fechamento
   ficava esperando uma aprovação que ninguém no servidor estava ali para
   dar. O comando usado foi `openclaw mcp configure fechamento --approval
approve`, que vale só para esse servidor específico (código escrito e
   revisado neste projeto, que só lê os CSVs autorizados e não executa
   nada) — não é uma liberação geral para qualquer ferramenta MCP.
5. **Corrigido, ainda em 12/09/2026: o arquivo de exemplo do repositório
   (`openclaw.exemplo.json`) continuava com o par antigo `security: deny` /
   `ask: always` — o mesmo valor de antes da correção do item 3 —, porque é
   esse arquivo que uma reinstalação (`scripts/instalar.sh`) copia como
   configuração inicial. Uma reinstalação de desastre, ou um segundo
   servidor, teria reproduzido o travamento já corrigido no servidor ao
   vivo. Corrigido para `tools.exec.mode: "auto"`, sem o par legado, e
   `configuracao.test.mjs` agora falha se `security` ou `ask` reaparecerem
   em `tools.exec` — travar só `mode` não bastaria, porque o par legado,
   se voltasse, venceria por ser mais restrito.

## Documentação oficial consultada (docs.openclaw.ai)

- `getting-started` — visão geral do produto
- `providers/openai/setup` — a diferença entre a rota da assinatura
  (Codex subscription) e a rota de chave de API; foi aqui que se confirmou
  que nenhuma configuração de runtime deve ser fixada para a assinatura
- `runtimes` — os mecanismos de execução disponíveis e como o OpenClaw
  escolhe um automaticamente
- `coverage-and-cost` — o que a assinatura cobre e o que não cobre
- `gateway/security` e subpáginas — publicação da porta, autenticação por
  token, o que fica exposto e o que não fica
- `install/docker` — como a imagem é publicada e versionada
- `cli/models` — os comandos de login, status e listagem de modelos
- `concepts/oauth` — o fluxo de login por código de dispositivo
- `cli/mcp` — como configurar, aprovar e sondar servidores MCP
- `automation/cron-jobs` — como funcionam as rotinas agendadas
- `gateway/logging` — o que fica registrado e como consultar
- `tools/exec` e `tools/permission-modes` — os quatro modos de
  execução (`deny`, `allowlist`, `ask`/`auto`, `full`) e por que os dois
  primeiros bloqueiam o mecanismo da assinatura por completo
- `tools/exec-approvals` — como funciona a aprovação de comandos quando o
  modo não é totalmente automático
- `gateway/permission-modes` — os níveis de permissão do próprio gateway
  (o painel), separados dos modos de execução de ferramentas acima
- `cli/mcp/registry` — como o OpenClaw guarda e lista os servidores MCP
  configurados
- `automation/hooks` e `cli/hooks` — os gatilhos automáticos do sistema e
  como consultá-los pela linha de comando; foi aqui que se confirmou que
  os gatilhos de aviso e a função técnica interna de suporte citados na
  auditoria de segurança (Task 17, item 17) seguem desligados por nunca
  terem sido ligados, não por falha

## Limites conhecidos

Copiados do desenho aprovado (§13), mais o que os testes ao vivo (roteiro
de 17 perguntas) confirmaram na prática:

- **A assinatura não é ilimitada.** O limite depende do plano do ChatGPT e
  muda com o tempo. Quando chega, o agente para até liberar — não se
  promete custo zero para sempre.
- **OAuth não cobre tudo.** Voz, embeddings, geração de imagem e parte das
  ferramentas da OpenAI exigem cobrança por API. Nada disso está ligado
  aqui; ligar qualquer um deles pede decisão e conferência de cobrança
  antes.
- **Não há teto financeiro na assinatura**, além da própria franquia. O
  que impede cobrança avulsa é a ausência de qualquer chave de API — e
  isso é conferido regularmente.
- **Login por código de dispositivo é recurso em beta** na OpenAI e
  depende de estar ativado na conta.
- **A mesma conta em dois lugares** (o Codex de outro computador e o
  OpenClaw na VPS) pode, de vez em quando, derrubar o login de um deles
  quando o outro renova. O sintoma é "login expirado"; o remédio é
  refazer o login (ver `operacao.md`).
- **O OpenClaw não separa usuários hostis entre si.** Um gateway tem um
  dono só. Por isso o acesso ao painel é só do responsável.
- **O túnel usa a chave SSH de administrador da VPS.** Um usuário SSH só
  para o túnel seria mais seguro; fica como melhoria futura.
- **O passo de conferência `models list --provider openai` responde "No
  models found"**, mesmo com tudo funcionando. É uma particularidade do
  catálogo do mecanismo da assinatura (o Codex não popula essa listagem),
  não um bloqueio real — o assistente responde normalmente e o rastro de
  cada resposta mostra o modelo certo em uso. Registrado aqui sem fingir
  que esse passo específico da documentação passou.
- **Três rotinas vêm prontas de fábrica na imagem.** Nenhuma delas roda
  hoje, porque o agendador está desligado (`cron.enabled: false`, sem
  nenhum próximo horário previsto). Duas das três continuam marcadas como
  "ligadas" mas inertes por causa do agendador desligado; o Pablo ainda
  não decidiu se quer desligá-las de vez.
- **A permissão de execução teve de ser afrouxada de "negar" para
  "automático"** porque os modos mais restritos (`deny` e `allowlist`)
  bloqueiam o processo do Codex por completo — ele não expõe um executável
  fixo que pudesse entrar numa lista permitida. As proteções que
  compensam essa troca: nenhuma ferramenta de execução é oferecida ao
  modelo, o contêiner roda sem privilégios extras, a ferramenta de
  fechamento é montada só para leitura, e a porta do painel só existe em
  `127.0.0.1`.
