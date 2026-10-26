# Importação de clientes e compras Saipos

O worker usa a credencial existente `SAIPOS_TOKEN` e o vínculo autorizado da
unidade `SAIPOS_UNIDADE_ID`, com `SAIPOS_SYNC_ENABLED=true`. A composição em
`src/instrumentation.ts` conecta os contratos sem dependência entre módulos e
conectores. A consulta operacional de Analytics continua descartando clientes.

A API `search_sales` documenta `customer.id_customer`, `name`, `phone`, `email`:
https://saipos-data-api.readme.io/reference/layout-definicoes-vendas
São importados os clientes identificados nas vendas disponíveis; clientes sem
qualquer compra não são expostos por esse endpoint. Não se inventam dados de
consumidores anônimos nem receita líquida a partir do total bruto.

## Histórico completo e continuidade

A carga começa nas compras recentes e retrocede em janelas de 15 dias,
inclusive atravessando janelas vazias. O limite inicial padrão é 2010-01-01,
anterior à criação da Saipos (2017), sem corte de 12 meses. Se a conta possuir
dados legados anteriores, `SAIPOS_CRM_HISTORY_START` aceita uma data anterior
desde 2000. Não há promessa de recuperar dados removidos ou indisponíveis na API.

Cada lote confirma dados e cobertura na mesma transação, sob concessão por
unidade. Reinícios e erros retomam a cobertura persistida, com chaves únicas e
versões de compras. O cursor incremental começa no instante da primeira janela,
para recuperar alterações ocorridas durante a carga. Após concluir o histórico,
a rotina consulta `updated_at` a cada 15 minutos com sobreposição de dois dias.
Falhas aguardam 15 minutos antes de nova tentativa. O status aparece em Contatos;
`GET /api/crm/saipos?storeId=...` usa a sessão e o escopo existentes.

O consentimento de marketing é sempre falso em novos contatos. Um telefone
inválido ou ausente permite cadastro pelo ID Saipos, sem entrega de mensagens.
Telefones já ligados a outro ID ou nome não unificam pessoas automaticamente:
a compra permanece sem vínculo e o conflito é auditado para revisão manual.
Edições manuais de nome, telefone ou e-mail interrompem a atualização automática
do perfil; compras novas continuam vinculadas pela identidade.

## Validação e publicação

Migração `20261026043000_crm_saipos_clientes`: acrescenta controle de sincronização
e origem dos perfis; permite telefone nulo, preservando registros existentes.
Validar com `npm run check`, `npm run build` e integração em PostgreSQL local
isolado (`saipos-customers.integracao.ts` e `crm.integracao.ts`). Em produção,
somente `prisma migrate deploy`, após backup verificado.

Na validação inicial de 26/10/2026, a API real retornou HTTP 504 e 503, inclusive
com página de uma venda. Não foi possível confirmar o conteúdo dos clientes com
o token atual. Os testes usam contratos documentados e dados sintéticos; a carga
real só estará comprovada quando a API voltar e o status registrar cobertura.

## Diagnóstico de 26/10/2026

A resposta foi identificada como `PGRST003`, HTTP 504, emitida pelo
`postgrest/14.3` do fornecedor: `Timed out acquiring connection from connection pool.`
O mesmo erro ocorreu na VPS com token, sem token, numa janela de uma hora e num
dia vazio em 2010, sempre com página de um registro. Uma conexão local independente
confirmou o erro sem token em **26/10/2026 às 01:39:34 de Brasília**.

Segundo a [documentação do PostgREST](https://docs.postgrest.org/en/stable/references/errors.html),
`PGRST003` significa que a API esgotou o prazo aguardando uma conexão disponível
com seu banco. Isso impede confirmar a autorização do token e obter clientes.
Diminuir o período/paginação não resolveu. A recuperação do serviço de dados
depende da Saipos; não existe acesso administrativo a esse banco nesta VPS.

O cliente agora reconhece apenas os códigos de conexão `PGRST000`–`PGRST003`,
com leitura do corpo de erro limitada a 4 KB e sem guardar o conteúdo. As consultas
compartilham uma pausa mínima de cinco minutos (ou `Retry-After` maior), sem repetir
imediatamente o mesmo erro. A importação CRM tenta novamente após 15 minutos e
registra uma mensagem específica para falha do fornecedor. Nenhum cursor avança.
Erros transitórios sem esses códigos mantêm as três tentativas existentes.

### Texto para chamado ao Saipos

> A API de Dados `GET /v1/search_sales` está retornando HTTP 503/504. Em 26/10/2026,
> às 01:39:34 de Brasília, uma chamada mínima retornou `PGRST003`:
> `Timed out acquiring connection from connection pool.` Ocorre a partir de duas
> conexões independentes, inclusive sem autenticação e para período vazio, com
> `p_limit=1`. Favor verificar a disponibilidade e o pool de conexões do PostgREST
> da API de Dados. Identificador CloudFront da consulta de controle:
> `zvyItbhMBX-Q4XnUUIpj7mbb1pxGa632rKX_QJrtpEquda6kgC0VSQ==`.

Nenhum chamado foi enviado automaticamente; o texto não contém token ou dados
de clientes. Após recuperação da API, conferir os contadores e a cobertura no
CRM; não marcar o histórico como concluído antes dessa confirmação.
