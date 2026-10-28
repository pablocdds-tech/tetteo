# PDV em domínio próprio

O PDV pode abrir em `https://pdv.vitalianopizzaria.com.br`, com navegação própria,
enquanto o Tetteo permanece em `https://app.vitalianopizzaria.com.br`.
Os dois endereços chegam ao mesmo serviço Next.js e ao mesmo banco. Produtos,
clientes, estoque, pedidos, caixa, organizações, unidades e permissões continuam
compartilhados. Não há segundo worker nem sincronização entre bancos.

## Comportamento

- A raiz do domínio do PDV abre `/pdv`, sem consultar o painel financeiro.
- O menu apresenta somente as seções do PDV e o link **Abrir Tetteo**.
- No Tetteo, o PDV passa a ser um atalho para o novo domínio. A busca deixa de
  listar cada seção operacional como um destino administrativo.
- Links de fichas técnicas e estoque saem para o domínio do Tetteo com navegação
  completa. As consultas de CRM necessárias ao atendimento permanecem disponíveis
  no PDV e repetem as permissões e o isolamento existentes no servidor.
- A conta é a mesma; cada endereço tem sua sessão. Não há cookie com escopo no
  domínio pai. Suspensão e redefinição de senha invalidam as sessões existentes
  por `versaoSessao`, conforme o login atual.
- Leituras de `/pdv/...` no endereço antigo redirecionam com caminho e filtros.
  POSTs de atendimentos antigos continuam na própria origem, sem reenvio entre
  domínios. As regras atuais de idempotência de vendas continuam aplicáveis.

## Configuração e ordem de ativação

1. Publicar o código com `APP_OPERACAO_URL` ausente. Todo o acesso existente
   continua funcionando nessa etapa.
2. No DNS do domínio, criar **A**, nome **pdv**, valor **187.77.35.238**.
   Preservar os registros existentes do domínio e do Tetteo.
3. Adicionar o domínio `pdv.vitalianopizzaria.com.br` ao aplicativo `web` do
   Dokploy, porta 3000, caminho `/`, HTTPS com Let's Encrypt. O destino é o
   mesmo serviço do Tetteo, com `passHostHeader` habilitado.
4. Confirmar resolução pública e certificado válido no novo endereço.
5. No ambiente do mesmo aplicativo, manter os segredos atuais e definir:

   ```dotenv
   APP_URL=https://app.vitalianopizzaria.com.br
   APP_OPERACAO_URL=https://pdv.vitalianopizzaria.com.br
   APP_OPERACAO_ROTA=/pdv
   AUTH_TRUST_HOST=true
   ```

   Remover `AUTH_URL` e `NEXTAUTH_URL`, se presentes. Eles fixariam a origem das
   ações do Auth.js no endereço antigo. Não trocar `AUTH_SECRET`, as chaves das
   integrações nem a conexão do banco.

6. Reimplantar o mesmo aplicativo e validar login, gestão, novo pedido, CRM,
   impressão, caixa, links administrativos e acesso ao Tetteo. Não criar vendas
   fictícias em produção. O domínio novo só deve ser anunciado após essa revisão.

Os redirecionamentos e a casca própria são habilitados juntos pelas variáveis
operacionais. Se DNS ou certificado estiverem pendentes, deixe-as ausentes.
Para reverter a separação visual, remova as duas variáveis operacionais e
reimplante. Os dados não precisam ser migrados ou revertidos.

O Google, quando configurado, usa o proxy de retorno nativo do Auth.js na origem
canônica `/api/auth`; mantém a URI cadastrada no provedor. O state continua
cifrado e os cookies de PKCE/state continuam na origem que iniciou o login.
Sem as credenciais do Google, o provedor permanece indisponível. A ativação
real de OAuth deve ser validada com uma conta autorizada quando for habilitada.

## Limites e validação

O domínio é uma separação de interface e sessão, não uma nova fronteira de
permissão: os serviços continuam responsáveis por autorizar cada operação.
O proxy aceita somente os dois hosts configurados, recusa cabeçalho encaminhado
divergente, limita as APIs do domínio operacional e impede POSTs administrativos
fora de suas rotas. As exceções de máquina do matcher continuam com sua
autenticação própria, sem novas exceções públicas.

Validação local usa `localhost` e `pdv.localhost`, banco exclusivo de teste e
credenciais fictícias. Os testes em `src/lib/dominios-publicos.test.ts` cobrem
configuração, hosts, redirecionamentos, POSTs e retorno seguro do login.
O Playwright valida menus, acesso com a mesma conta, cookies host-only, catálogo
compartilhado e navegação entre os dois endereços. Nenhuma migração é necessária.
