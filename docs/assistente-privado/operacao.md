# Assistente privado — como operar

Escrito em 12/09/2026, em português simples, para quem toca a operação —
não para quem programa. Cada bloco tem uma explicação curta e o comando
exato, para copiar e colar no PowerShell.

Em todos os comandos abaixo, troque `$HOME\.ssh\tetteo_vps` pelo caminho
real da sua chave, se for diferente.

## Abrir o painel

O painel do assistente (o "Control UI" do OpenClaw) só existe dentro da
VPS, na porta `18789`, e essa porta **nunca** é publicada na internet — só
em `127.0.0.1` (o próprio servidor). Para chegar até ele do seu
computador, é preciso abrir um túnel SSH primeiro.

1. Abra um PowerShell e deixe este comando rodando (ele não devolve o
   controle — é para ficar aberto enquanto você usa o painel):

   ```
   ssh -N -L 18789:127.0.0.1:18789 -i $HOME\.ssh\tetteo_vps root@187.77.35.238
   ```

2. Em outro PowerShell, ou no navegador, abra:

   ```
   http://localhost:18789
   ```

3. O painel vai pedir um token. Leia-o **no seu próprio terminal**, sem
   nunca colar ou digitar o valor em outro lugar além do campo do painel:

   ```
   ssh -i $HOME\.ssh\tetteo_vps root@187.77.35.238 "sed -n s/^OPENCLAW_GATEWAY_TOKEN=//p /opt/central-de-comando/segredos/openclaw.env"
   ```

   Cole o valor que aparecer no campo "Segredo do Gateway" do painel.

**Ponto de segurança que precisa ficar claro: o painel tem um terminal
embutido.** Quem abre o painel com o token em mãos tem acesso a um
terminal dentro do contêiner do assistente — não é um terminal que o
modelo (a IA) pode usar sozinho, isso continua bloqueado; é um recurso do
próprio painel, para quem estiver logado nele. Hoje isso é seguro
**só** porque a porta 18789 escuta apenas em `127.0.0.1` da VPS e exige o
token para entrar. É exatamente por isso que este painel **nunca** pode
ser publicado na internet, nem por engano, nem "só por um tempinho": ele
precisa continuar acessível apenas por este túnel SSH.

## Iniciar e parar

O assistente roda como um contêiner Docker fixo na VPS, fora do sistema
de publicação do Tetteo.

Iniciar (ou religar depois de uma parada):

```
ssh -i $HOME\.ssh\tetteo_vps root@187.77.35.238 "cd /opt/central-de-comando/openclaw && docker compose up -d"
```

Parar:

```
ssh -i $HOME\.ssh\tetteo_vps root@187.77.35.238 "cd /opt/central-de-comando/openclaw && docker compose stop"
```

## Refazer o login

Se o assistente disser "login expirado" ou parar de responder por causa da
autenticação, refaça o login da assinatura ChatGPT (o código aparece na
tela do seu próprio terminal — é a mesma tela que abre o comando, `-t`):

```
ssh -t -i $HOME\.ssh\tetteo_vps root@187.77.35.238 "docker exec -it central-openclaw node dist/index.js models auth login --provider openai --device-code"
```

Vai aparecer um código e um link. Abra o link no navegador, com a conta
ChatGPT certa, e digite o código.

## Onde ver a franquia (o quanto já foi usado da assinatura)

Duas fontes, sempre concordantes:

- Na sua própria conta ChatGPT (`chatgpt.com`), na página de uso do
  Codex/assinatura.
- Dentro do painel do assistente (depois de abrir, veja acima), digitando
  `/status` na conversa — o assistente mostra a janela de uso e quanto já
  foi consumido.

## Verificar a conexão

Checagem rápida, sem precisar entrar no painel:

```
ssh -i $HOME\.ssh\tetteo_vps root@187.77.35.238 "docker exec central-openclaw node /opt/ferramenta/verificar.mjs"
```

Saudável, o retorno é uma linha parecida com esta, e o comando termina sem
erro:

```
{"estado":"conectado","runtime":"codex","modelo":"openai/gpt-5.6-sol", ...}
```

## Revogar o acesso

Se precisar cortar o acesso do assistente (por exemplo, suspeita de
vazamento do token ou do segredo), faça os três passos, nesta ordem:

1. Descobrir o identificador exato do perfil logado (ele tem o formato
   `openai:<seu-e-mail>` — não fica escrito aqui por não expor e-mail em
   documento nenhum):

   ```
   ssh -i $HOME\.ssh\tetteo_vps root@187.77.35.238 "docker exec central-openclaw node dist/index.js models auth list"
   ```

   Depois, tirar o login da assinatura, dentro do contêiner:

   ```
   ssh -i $HOME\.ssh\tetteo_vps root@187.77.35.238 "docker exec -it central-openclaw node dist/index.js models auth logout <profileId>"
   ```

2. Revogar o acesso também do lado da OpenAI, na sua conta ChatGPT
   (gerenciamento de apps/sessões conectadas).

3. Trocar o segredo que liga o assistente ao Tetteo (o `TETTEO_REGISTRO_SEGREDO`),
   nos dois lados — no arquivo de segredos da VPS e na variável
   correspondente do Tetteo — para que o valor antigo pare de funcionar
   nos dois sentidos.

## Backup e restauração

A configuração do assistente pode ser copiada e restaurada sem mexer nos
dados nem nas conversas:

```
ssh -i $HOME\.ssh\tetteo_vps root@187.77.35.238 "docker exec -it central-openclaw node dist/index.js backup create --only-config"
```

Conferir se um backup está íntegro antes de confiar nele (troque
`<arquivo>` pelo caminho do `.tar.gz` gerado no passo anterior):

```
ssh -i $HOME\.ssh\tetteo_vps root@187.77.35.238 "docker exec -it central-openclaw node dist/index.js backup verify <arquivo>"
```

Restaurar (use com cuidado — isso extrai o backup verificado numa pasta
nova; `--target` é a pasta de destino, que precisa estar vazia):

```
ssh -i $HOME\.ssh\tetteo_vps root@187.77.35.238 "docker exec -it central-openclaw node dist/index.js backup restore <arquivo> --target <pasta-nova>"
```

Uma cópia dos backups também fica guardada fora do contêiner, em
`/opt/central-de-comando/backups` na VPS.

## Atualizar

1. Editar a tag da imagem em
   `/opt/central-de-comando/openclaw/compose.yml` para a nova versão
   (nunca usar uma tag "flutuante" como `latest` — sempre uma versão
   fixa, como `2026.9.4`).
2. Baixar e religar:

   ```
   ssh -i $HOME\.ssh\tetteo_vps root@187.77.35.238 "cd /opt/central-de-comando/openclaw && docker compose pull && docker compose up -d"
   ```

3. Repetir a conferência de sempre: rodar o "verificar a conexão" acima e
   confirmar que o login e o plugin do Codex sobreviveram à atualização
   (o mesmo que foi checado quando o assistente entrou no ar — ver
   `versoes-e-fontes.md`).

## Gerar dados de novo (arquivos fictícios para teste)

```
ssh -i $HOME\.ssh\tetteo_vps root@187.77.35.238 "docker exec central-openclaw node /opt/ferramenta/gerar-dados-exemplo.mjs /home/node/.openclaw/workspace/dados-exemplo"
```

Isso recria os cinco CSVs de demonstração — nenhum dado real do
restaurante é tocado.

## Repetir o teste

O roteiro completo de perguntas (o que cada uma deveria responder) está em
`verificacao.md`. Para repetir uma pergunta específica:

```
ssh -i $HOME\.ssh\tetteo_vps root@187.77.35.238 "docker exec central-openclaw node dist/index.js agent --session-key teste-NN --message '<a pergunta aqui>' --json"
```

Troque `teste-NN` por um nome de sessão novo (para não misturar com um
teste anterior) e `<a pergunta aqui>` pela pergunta.

## O que NÃO fazer

- **Não colocar nenhuma chave de API** — nem da OpenAI nem de qualquer
  outro provedor — em nenhum arquivo, variável ou configuração. É a
  ausência de chave de API que garante que só a assinatura é usada, nunca
  uma cobrança avulsa.
- **Não publicar a porta do painel (`18789`) para a internet.** Ela deve
  continuar só em `127.0.0.1` da VPS, acessível apenas pelo túnel SSH —
  lembre do terminal embutido no painel, explicado acima.
- **Não ligar navegador, terminal livre ou mensageria para o agente.**
  As únicas ferramentas que o assistente enxerga são as do servidor
  "fechamento" (ler os arquivos autorizados, calcular, salvar relatório
  e rascunho). Tudo o mais continua negado por configuração — não é uma
  promessa do modelo, é uma trava no código.
- **Não trocar `tools.exec.mode` para `full`.** O valor certo, autorizado
  pelo Pablo, é `auto` (ver `versoes-e-fontes.md` para o porquê). `full`
  libera qualquer comando sem revisão — exatamente o terminal irrestrito
  que este projeto foi desenhado para evitar.
