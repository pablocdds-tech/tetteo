# Tetteo MCP

Servidor MCP remoto que dá ao Claude ferramentas de **consulta** do Tetteo. Hoje tem uma
ferramenta, `vendas_do_dia`, que recebe uma data (`AAAA-MM-DD`, horário de Brasília) e
devolve a quantidade de vendas e o total da loja ligada à conexão.

**A fonte é fictícia por enquanto.** Toda resposta diz "DADOS FICTÍCIOS" e traz
`"fonte": "ficticia"`. A fonte real entra quando o Tetteo tiver vendas (Cardápio Web → módulo
Pedidos).

- Endereço MCP: `https://mcp.vitalianopizzaria.com.br/mcp`. A URL não carrega senha e pode
  ser compartilhada: cada pessoa entra com a própria conta do Tetteo.
- Desenho completo: `docs/superpowers/specs/2026-09-11-servidor-mcp-design.md`.

## Segurança em um parágrafo

O login é **OAuth 2.1**, conforme a especificação MCP 2025-11-25:

- o Claude se identifica pela URL que a Anthropic publica (CIMD), e só hosts da lista
  `MCP_CLIENTES_CONFIAVEIS` são aceitos;
- a pessoa entra com e-mail e senha do Tetteo, e só conecta quem pode ver o Financeiro da
  loja;
- as chaves são aleatórias, guardadas só como hash, valem 1 hora (a de renovação é trocada
  a cada uso) e são conferidas a cada requisição — suspender alguém no Tetteo corta o acesso
  na hora.

No banco, o papel `tetteo_mcp` não enxerga nenhuma tabela do Tetteo: lê duas visões mínimas
(`mcp_leitura`), sem hash de senha, e escreve só no próprio esquema (`mcp`). O hash sai só por
uma função, de uma pessoa por vez. Trocar a senha no Tetteo derruba as conexões feitas com a
senha antiga, e as páginas abertas (`/oauth/*`, `/health`) têm limite de requisições por IP.

## Rodar na máquina

Precisa de um Postgres local de ensaio (por exemplo `embedded-postgres` instalado fora do
repositório, UTF-8, só em `127.0.0.1`).

```powershell
cd servicos/mcp
npm install
$env:MCP_ENSAIO_PG_URL = "postgresql://postgres:<senha>@127.0.0.1:<porta>/postgres"
npm run ensaio:subir          # cria banco de ensaio e escreve .env.local (fora do git)
npm run dev                   # servidor em http://127.0.0.1:8787
npm run ensaio:demonstrar -- http://127.0.0.1:8787 2026-09-10
```

Os testes de integração redefinem a senha do papel `tetteo_mcp` no Postgres de ensaio. Depois
de rodá-los, repita `npm run ensaio:subir` antes de subir o servidor local.

## Testes

```powershell
npm test                      # unidade
npm run test:integracao       # com banco (precisa de MCP_ENSAIO_PG_URL)
npm run typecheck
npm run build
```

## Variáveis de ambiente

| Variável                  | Exemplo                                                | Segredo?                |
| ------------------------- | ------------------------------------------------------ | ----------------------- |
| `DATABASE_URL`            | `postgresql://tetteo_mcp:…@<host-interno>:5432/tetteo` | **Sim** — só no Dokploy |
| `MCP_URL_PUBLICA`         | `https://mcp.vitalianopizzaria.com.br`                 | Não                     |
| `MCP_HOSTS_PERMITIDOS`    | (padrão: host público, localhost, 127.0.0.1)           | Não                     |
| `MCP_CLIENTES_CONFIAVEIS` | `claude.ai,claude.com`                                 | Não                     |
| `MCP_FONTE`               | `ficticia`                                             | Não                     |
| `PORT`                    | `8080`                                                 | Não                     |

## Publicar (Dokploy)

1. **Banco:** rodar `sql/01-preparar-banco.sql` uma vez, como administrador, no banco
   `tetteo`. Depois definir a senha do papel `tetteo_mcp` direto no servidor — ela nunca
   entra no repositório.
2. **Aplicação** no projeto `tetteo`:
   - GitHub `tetteo`, branch `main`;
   - build por Dockerfile, com contexto `servicos/mcp`;
   - watch path `servicos/mcp/**`;
   - porta 8080.
3. **Domínio** `mcp.vitalianopizzaria.com.br` com HTTPS (Let's Encrypt). Registro `A` `mcp`
   → IP da VPS.
4. **Variáveis** da tabela acima, na aba Environment.

## Conectar no Claude

Personalizar › Conectores › **Adicionar conector personalizado**:

1. nome `Tetteo`, URL `https://mcp.vitalianopizzaria.com.br/mcp`;
2. autenticação por login (OAuth), cliente "identidade publicada do Claude";
3. **Adicionar**, depois **Conectar**. Abre a tela do Tetteo: entre com seu e-mail e senha
   do Tetteo e autorize.

No chat, ligue o conector em **+ › Conectores** e pergunte, por exemplo: "Quanto vendi em
10/09/2026?".

## Revogar

- **No Claude:** remover ou desconectar o conector.
- **No Tetteo:** suspender a pessoa ou tirar a permissão de Financeiro. O acesso cai na
  chamada seguinte.
- **No terminal do contêiner:**
  `node dist/admin/conexoes.js listar | revogar <id> | revogar-usuario <email>`.
- **Tudo de uma vez:** trocar a senha do papel `tetteo_mcp`.
