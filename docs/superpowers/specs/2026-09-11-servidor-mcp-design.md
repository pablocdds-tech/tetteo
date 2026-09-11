# Servidor MCP do Tetteo — desenho

Aprovado pelo Pablo em 11/09/2026.

## 1. O que é

Um servidor MCP remoto que dá ao Claude ferramentas de **consulta** dos sistemas do
Pablo. A primeira ferramenta é `vendas_do_dia`: recebe uma data e devolve a quantidade
de vendas e o total daquele dia na loja ligada à conexão.

A primeira versão é **somente de consulta**. Não há ferramenta de pagamento, de
alteração de pedido nem de escrita em nenhum sistema.

## 2. Decisões e o porquê

| Decisão              | Escolha                                                                                              | Por quê                                                                                                                                                                                                     |
| -------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cliente de IA        | Claude (claude.ai, app de computador, celular); o mesmo acesso serve ao Claude Code                  | A conta do Pablo já usa conectores personalizados (Cardápio Web, Kairu)                                                                                                                                     |
| Autenticação         | OAuth 2.1 conforme a especificação MCP 2025-11-25, com Client ID Metadata Document (CIMD)            | É a única forma que funciona em todos os planos do Claude. Cabeçalho fixo (`static_headers`) está em beta para poucas organizações. CIMD é a opção recomendada pela Anthropic e dispensa registrar clientes |
| Registro de clientes | **Só CIMD, só de hosts confiáveis** (padrão: `claude.ai`, `claude.com`). Sem registro dinâmico (DCR) | Menos superfície de ataque. A especificação permite política de confiança por domínio                                                                                                                       |
| Quem faz o login     | O próprio servidor MCP, com e-mail e senha **do Tetteo**                                             | Uma conta por pessoa, respeita suspensão e permissões do Tetteo, nenhuma senha nova para administrar. Não mexe no app principal                                                                             |
| Quem pode autorizar  | Quem tem `financeiro.ver` (ou `financeiro.*`, ou `*`) na loja                                        | É a permissão que já libera o caixa no Painel. Uma chave própria pode vir depois                                                                                                                            |
| Onde fica o código   | `servicos/mcp/` no repositório do Tetteo, com `package.json`, testes e `Dockerfile` próprios         | "Use o projeto existente". Serviço separado para não inchar o app Next nem ser publicado junto                                                                                                              |
| SDK                  | `@modelcontextprotocol/server`, `/express` e `/node` **2.0.0** + Express 5                           | Versão estável atual (28/07/2026). `createMcpHandler` serve 2026-07-28 e, no modo sem sessão, 2025-11-25                                                                                                    |
| Sessão               | Nenhuma em memória. Todo estado (conexões, chaves) no Postgres                                       | Uma publicação nova não derruba ninguém                                                                                                                                                                     |
| Chaves (tokens)      | Opacas, aleatórias (256 bits), guardadas **só como hash SHA-256**                                    | Revogação instantânea e nenhuma chave de assinatura para administrar                                                                                                                                        |
| Fonte das vendas     | Fictícia agora, com aviso em toda resposta. Troca por variável de ambiente                           | O Tetteo ainda não tem vendas; o Cardápio Web depende do cadastro de parceiro                                                                                                                               |

## 3. Arquitetura

```
Claude (nuvem Anthropic, 160.79.104.0/21)
   │  HTTPS
   ▼
Traefik (Dokploy, Let's Encrypt)
   │
   ▼
tetteo-mcp  (Express 5 + SDK MCP 2.0.0, porta 8080, sem sessão)
   ├─ GET  /health                                   vivo? sem dados sensíveis
   ├─ GET  /.well-known/oauth-protected-resource[/mcp]  RFC 9728
   ├─ GET  /.well-known/oauth-authorization-server      RFC 8414
   ├─ GET  /oauth/authorize   página de login e consentimento
   ├─ POST /oauth/authorize   confere senha, escolhe loja, devolve o código
   ├─ POST /oauth/token       troca código e renova (form-urlencoded)
   ├─ POST /oauth/revoke      RFC 7009
   └─ POST /mcp               exige Bearer → createMcpHandler → vendas_do_dia
          │
          ▼
Postgres do Tetteo, papel de banco próprio `tetteo_mcp`
   ├─ esquema mcp_leitura  (do administrador)  SÓ LEITURA
   │     usuario_login, loja_com_vendas_visiveis
   └─ esquema mcp          (do tetteo_mcp)      conexões, códigos, chaves, tentativas, chamadas
```

O `tetteo_mcp` **não enxerga nenhuma tabela do Tetteo**. Lê apenas duas visões mínimas e
escreve apenas no próprio esquema.

## 4. Contrato da ferramenta `vendas_do_dia`

- **Entrada** (Zod 4, `z.object`): `data` no formato `AAAA-MM-DD`, que precisa ser uma data
  real, não futura (fuso `America/Sao_Paulo`) e não anterior a `2020-01-01`.
- **Anotações:** `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`,
  `openWorldHint: false`.
- **Saída estruturada** (`outputSchema`):

  ```json
  {
    "data": "2026-09-10",
    "unidade": "Vitaliano Centro",
    "quantidade_vendas": 87,
    "total": 6234.5,
    "total_centavos": 623450,
    "moeda": "BRL",
    "fonte": "ficticia",
    "aviso": "DADOS FICTÍCIOS — gerados para testar o contrato. Não são vendas reais."
  }
  ```

- **Texto** para o modelo: uma linha em português com o aviso na frente quando a fonte é
  fictícia.
- A **loja** vem da conexão (escolhida no consentimento), não da entrada. Assim a IA não
  consegue pedir a loja de outra pessoa.
- **Erros de execução** (fonte fora do ar, demora acima de 8 s) voltam como
  `isError: true` com mensagem segura, sem detalhes internos. O processo continua de pé.
- Cada chamada fica registrada em `mcp.chamada` (conexão, ferramenta, argumentos,
  resultado `ok`/`erro`, duração). Nunca registra token.

### Fonte fictícia

É determinística: a mesma loja e a mesma data geram sempre a mesma lista de pedidos
(semente = SHA-256 de `unidade|data`). A lista crua fica exposta para os testes, que
recalculam quantidade e total por fora e comparam com a resposta da ferramenta.

A interface `FonteDeVendas` recebe `{ unidadeId, data }` e um `AbortSignal`, e devolve
`{ quantidade, totalCentavos }`. A fonte é escolhida por `MCP_FONTE` (hoje só `ficticia`).

## 5. OAuth

### Descoberta

- `401` em `/mcp` sem chave válida:
  `WWW-Authenticate: Bearer error="invalid_token", resource_metadata="<url>/.well-known/oauth-protected-resource/mcp", scope="vendas:ler"`.
- **Metadados do recurso:** `resource` = `https://mcp.vitalianopizzaria.com.br/mcp`, com
  `authorization_servers` = [emissor], `scopes_supported` = `["vendas:ler"]` e
  `resource_name` = `"Tetteo — consultas"`, servido também na raiz
  (`/.well-known/oauth-protected-resource`).
- **Metadados do servidor de autorização:**
  - `issuer`, `authorization_endpoint`, `token_endpoint`, `revocation_endpoint`
  - `response_types_supported`: `["code"]`
  - `grant_types_supported`: `["authorization_code", "refresh_token"]`
  - `token_endpoint_auth_methods_supported`: `["none"]`
  - `code_challenge_methods_supported`: `["S256"]`
  - `client_id_metadata_document_supported`: `true`
  - `scopes_supported`: `["vendas:ler"]`

### Cliente (CIMD)

- O `client_id` precisa ser uma URL `https` com caminho, cujo host esteja em
  `MCP_CLIENTES_CONFIAVEIS` (padrão `claude.ai`). Outros hosts são recusados **antes** de
  qualquer busca na rede, o que evita que o servidor seja usado para buscar endereços
  arbitrários (SSRF).
- O documento é buscado com limite de 5 s e 64 KB, sem seguir redirecionamentos. Ele
  precisa trazer `client_id` idêntico à URL, `redirect_uris` e
  `token_endpoint_auth_method: "none"`. Fica em cache na memória por 5 minutos (é só um
  cache, não uma sessão).
- **`redirect_uri`**: comparação exata. Para loopback (`http://localhost/…`,
  `http://127.0.0.1/…`), a porta é ignorada (RFC 8252 §7.3), como exige o Claude Code.
- Enquanto o cliente e o `redirect_uri` não estiverem validados, erros **não** são
  redirecionados: aparecem numa página de erro.

### Autorização

1. `GET /oauth/authorize`: valida os parâmetros (`response_type=code`, `client_id`,
   `redirect_uri`, `code_challenge` S256, `state`, `scope`, `resource`). `resource`, se
   vier, precisa ser igual ao endereço canônico do MCP; caso contrário, `invalid_target`.
   Grava um `pedido_autorizacao` (10 min) e mostra a página.
2. **A página** mostra:
   - quem pede (o host do `client_id`) e para onde volta (o host do `redirect_uri`, com
     aviso extra quando é loopback);
   - o que a conexão poderá fazer (ver quantidade e total de vendas de um dia) e o que não
     poderá (alterar pedidos, pagamentos ou qualquer dado);
   - os campos de e-mail e senha do Tetteo e os botões Autorizar e Cancelar.
3. `POST /oauth/authorize`: limite de tentativas por e-mail e por IP (no banco, janela de
   15 min). A senha é conferida com bcrypt, com a mesma resposta para todas as falhas e
   bcrypt contra um hash falso quando o e-mail não existe. Depois:
   - **0 lojas** com a permissão → página "sem permissão";
   - **1 loja** → cria a conexão;
   - **mais de uma** → o pedido guarda quem entrou e mostra a escolha de loja.
4. **Cancelar** volta com `error=access_denied` e o `state`.
5. O código de autorização vale 2 minutos, só pode ser usado uma vez e fica ligado a
   `client_id`, `redirect_uri` e `code_challenge`.

### Chaves

- A chave de acesso (`tmcp_…`) vale 1 hora. A chave de renovação (`tmcr_…`) vale 30 dias a
  partir do último uso e **é trocada a cada renovação**.
- Se uma chave de renovação já trocada for reapresentada, ou um código já usado, **a
  conexão inteira é revogada** (detecção de reuso).
- `/oauth/token` aceita apenas `application/x-www-form-urlencoded`, responde com
  `Cache-Control: no-store` e usa códigos de erro da RFC 6749 (`invalid_grant`,
  `invalid_request`, `unsupported_grant_type`, `invalid_scope`, `invalid_target`).
- **O verificador** (a cada requisição em `/mcp`) confere a chave de acesso pelo hash:
  existe, não expirou, a conexão não foi revogada, o recurso é este MCP, a pessoa continua
  ativa **e** continua com a permissão na loja. Suspender alguém no Tetteo corta o acesso
  na chamada seguinte.
- **Revogação:**
  - `POST /oauth/revoke`, usado pelo cliente;
  - o comando `node dist/admin/conexoes.js listar | revogar <id> | revogar-usuario <email>`,
    no terminal do contêiner;
  - suspender a pessoa ou tirar a permissão dela no Tetteo;
  - trocar a senha do papel `tetteo_mcp`, que corta tudo.

## 6. Banco

`sql/01-preparar-banco.sql` é idempotente e rodado **uma vez pelo administrador** do
banco. Ele:

- cria o papel `tetteo_mcp` (LOGIN, `CONNECTION LIMIT 10`, `statement_timeout 5s`,
  `idle_in_transaction_session_timeout 10s`). **Sem senha no arquivo**: ela é definida à
  parte, direto no servidor;
- cria o esquema `mcp` (dono `tetteo_mcp`) e o esquema `mcp_leitura` (dono o
  administrador; `USAGE` só para `tetteo_mcp`);
- cria as visões:
  - `mcp_leitura.usuario_login(id, email, nome, senha_hash)`: só usuários `ATIVO`, não
    excluídos e com senha;
  - `mcp_leitura.loja_com_vendas_visiveis(usuario_id, unidade_id, unidade_nome)`: acessos
    `ATIVO`, não excluídos, de organização ativa, com papel que tenha `*`, `financeiro.*`
    ou `financeiro.ver`. Um acesso de rede (`unidadeId` nulo) vale para toda loja ativa
    da organização; um acesso de loja vale para aquela loja. É a mesma regra de
    `contextoDeFundo` + `pode()` em `src/core/sessao/contexto.ts`;
- dá `GRANT SELECT` só nessas duas visões.

As visões dependem das colunas `usuario."senhaHash"`, `usuario.status`,
`usuario."excluidoEm"`, `acesso.*`, `papel_permissao.chave`, `unidade.ativa|nome` e
`organizacao.ativa`. O Postgres impede apagar uma coluna usada por visão. Se uma migração
futura do Tetteo mexer nelas, ela vai falhar alto, e a visão precisa ser ajustada no mesmo
passo.

`sql/02-tabelas.sql` é rodado pelo próprio serviço ao subir, como `tetteo_mcp`, com
`CREATE TABLE IF NOT EXISTS`. Cria as tabelas:

- `pedido_autorizacao`
- `conexao`
- `codigo_autorizacao`
- `token` (tipo `acesso` ou `renovacao`, `substituido_em`)
- `tentativa_login` (e-mail e IP guardados como hash)
- `chamada`

Linhas vencidas são apagadas no caminho, a cada emissão de chave.

## 7. Proteções HTTP

- `createMcpExpressApp` com `allowedHosts` (host público, `localhost`, `127.0.0.1`) e
  `allowedOrigins` (host público). Clientes sem `Origin` passam; um `Origin` estranho
  recebe `403`.
- Limite de corpo: 64 KB para JSON e 16 KB para formulário. Acima disso, `413`.
- **Tempos:**
  - `requestTimeout` de 30 s e `headersTimeout` de 15 s;
  - 8 s por ferramenta;
  - no banco: 5 s por consulta e 3 s para conectar.
- `trust proxy` = 1 (atrás do Traefik) para o IP do limitador.
- **Páginas HTML:** `Content-Security-Policy` com `default-src 'none'`, CSS servido pelo
  próprio servidor e `form-action` só para `'self'` e a origem do `redirect_uri` daquele
  pedido. Também `frame-ancestors 'none'`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer` e `Cache-Control: no-store`.
- `GET /mcp` e `DELETE /mcp` respondem `405` (não há sessão).

## 8. Erros e registros

- **Registros** em JSON, uma linha por requisição: método, **caminho sem query**, status,
  duração e id. Nunca registram cabeçalhos, corpo, token, código, senha ou e-mail.
- **Erro de ferramenta** → `isError: true`. Erro inesperado numa rota → `500` genérico.
- `unhandledRejection` é registrado. `uncaughtException` é registrado e encerra o processo;
  o contêiner reinicia sozinho. Seguir depois de uma exceção não tratada deixaria o
  processo em estado desconhecido.
- **`SIGTERM`:** para de aceitar requisições, fecha o handler MCP e o pool do banco.

## 9. Configuração (variáveis de ambiente)

| Variável                  | Exemplo                                            | Segredo?                                       |
| ------------------------- | -------------------------------------------------- | ---------------------------------------------- |
| `DATABASE_URL`            | `postgresql://tetteo_mcp:…@<host>:5432/tetteo`     | **Sim**: só no Dokploy e no `.env.local` local |
| `MCP_URL_PUBLICA`         | `https://mcp.vitalianopizzaria.com.br`             | Não                                            |
| `MCP_HOSTS_PERMITIDOS`    | `mcp.vitalianopizzaria.com.br,localhost,127.0.0.1` | Não                                            |
| `MCP_CLIENTES_CONFIAVEIS` | `claude.ai`                                        | Não                                            |
| `MCP_FONTE`               | `ficticia`                                         | Não                                            |
| `PORT`                    | `8080`                                             | Não                                            |

Em produção, `MCP_URL_PUBLICA` precisa ser `https`. `http` só é aceito em
desenvolvimento.

## 10. Testes

- **Unidade:**
  - schema da data (válida, formato errado, 31/02, futura, antes de 2020);
  - fonte fictícia (determinismo, total = soma dos pedidos);
  - PKCE;
  - comparação de `redirect_uri` (exata e loopback sem porta);
  - validação do CIMD (host fora da lista, `client_id` divergente, documento grande
    demais);
  - leitura de escopo;
  - configuração.
- **Integração** (Postgres descartável, migrações reais do Tetteo aplicadas do próprio
  `prisma/schema/migrations`, mais `01` e `02`, com dados mínimos):
  - o papel `tetteo_mcp` **não consegue** ler `public.usuario`;
  - fluxo completo: página → login → código → chave;
  - com o cliente oficial do SDK: inicialização, `tools/list` e `tools/call` com uma data,
    comparando o total com o cálculo independente;
  - renovação com troca de chave;
  - reuso da chave antiga revoga a conexão;
  - pessoa suspensa → `401`;
  - sem chave → `401` com o cabeçalho certo;
  - chave revogada → `401`;
  - data inválida → erro de ferramenta;
  - fonte que falha ou demora → `isError: true` e o processo segue;
  - corpo grande → `413`;
  - `Host` ou `Origin` estranhos → `403`;
  - `/health` sem segredos;
  - `GET /mcp` → `405`.

  Rodam quando `MCP_ENSAIO_PG_URL` aponta para um Postgres de ensaio; sem ele, avisam em
  voz alta que foram pulados.

- **Depois da publicação:** `curl` em `/health`, o `401` e os dois documentos de
  descoberta; depois o Pablo conecta no Claude e pergunta as vendas de uma data.

## 11. Publicação

- **Dokploy:** aplicação nova no projeto `tetteo`, a partir do repositório `tetteo`, branch
  `main`, tipo Dockerfile, **caminho de build `servicos/mcp`** e **watch path
  `servicos/mcp/**`** (só republica quando esta pasta muda). Domínio
  `mcp.vitalianopizzaria.com.br` com Let's Encrypt, porta do contêiner 8080. Mesma rede
  interna do banco.
- **O app principal** ganha três linhas: `servicos` fora do `tsconfig`, do ESLint e do
  `.dockerignore`.
- **DNS:** registro `A` `mcp` → `187.77.35.238` no Registro.br.
- **Segredo:** a senha do `tetteo_mcp` é gerada no servidor e gravada direto no ambiente do
  Dokploy. Nunca passa pelo chat nem pelo repositório.

## 12. Fora do escopo

- Ferramentas de escrita, pagamento ou pedidos.
- Registro dinâmico de clientes.
- Tela de "conexões" no Tetteo (a revogação é por comando).
- Chave de permissão própria.
- A Severina como cliente MCP.

## 13. Fonte real (próxima etapa)

O caminho é Cardápio Web → conector do Tetteo (spec `2026-09-10-cardapio-web-integracao`)
→ módulo Pedidos → visão `mcp_leitura.vendas_por_dia` (só leitura) → `FonteTetteo` no MCP.
Liga-se com `MCP_FONTE=tetteo`, sem mudar o contrato da ferramenta. O total será comparado
com o `GET /orders/summary` oficial da mesma data.
