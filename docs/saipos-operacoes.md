# Integração Saipos: Dados, Pedidos e Logística

A interface do diretor fica em `/configuracoes/integracoes/saipos`, por unidade.
Ela mostra configuração, cobertura de detalhes, produtos e registros operacionais.
O painel é um console de integração/homologação; não substitui um aplicativo de
pedidos ou de entregadores. O envio avançado recebe os contratos JSON oficiais.
Nenhuma configuração presente equivale a homologação ou teste real aprovado.

## Dados

O cliente existente continua importando vendas e clientes. Com
`SAIPOS_DETAILS_ENABLED=true`, o mesmo relógio consulta `sales_items` e
`sales_status_histories` a cada 30 minutos. Primeira consulta: últimos 30 dias;
incremental: `updated_at`, com sobreposição de dois dias. Esse cursor é separado
do de vendas. A cobertura histórica anterior não é prometida por essa etapa.

Na validação real de 26/10/2026, `sales_items` retornou códigos PDV numéricos e
`items: null` em vendas sem itens na agregação. O conector normaliza o código
para texto e somente o `null` explícito para lista vazia; campos ausentes ou
itens malformados continuam recusados, sem avançar cursor. A inspeção registrou
apenas tipos/nomes de campos, sem persistir respostas pessoais.

O snapshot de itens e histórico só entra em vendas já vinculadas à unidade.
Campos desconhecidos, observações livres e dados de usuários são descartados.
As versões de detalhes impedem que uma resposta antiga sobrescreva a mais recente.
Itens excluídos/transferidos e vendas canceladas não compõem o ranking.
O preço de leitura já inclui adicionais. O CRM recebe o snapshot ao atualizar os
vínculos existentes; não ganha consentimento de marketing nem receita líquida.

Estoque permanece indisponível por manutenção documentada do fornecedor. O
conector financeiro existente não é alterado nem tratado como DRE completa.
As divergências de rate limit e atraso na origem continuam descritas em
`docs/saipos.md`. Importação bem-sucedida não certifica completude na Saipos.

## Credenciais e ambiente das operações

Preencher somente no ambiente privado do servidor:

- `SAIPOS_OPERATIONS_UNIDADE_ID`: ID interno da unidade autorizada.
- `SAIPOS_OPERATIONS_KEY`: 32 bytes aleatórios, representados por 64 hex.
  Manter estável e em backup de segredos. Trocar perde acesso aos conteúdos antigos.
- `SAIPOS_OPERATIONS_ENVIRONMENT`: `homologacao` (padrão) ou `producao`.
- Produção exige adicionalmente `SAIPOS_PRODUCTION_APPROVED=true`, somente após
  homologação e credenciais corretas. Essa variável é uma confirmação operacional,
  não uma verificação automática de aprovação junto ao fornecedor.

Este serviço comporta um canal/merchant de operações para uma unidade. Não ampliar
para outras unidades usando o mesmo segredo; é necessário cadastro por merchant
antes de escalar. A API de Dados mantém seu vínculo de produção independente;
a loja de testes de Pedidos não substitui esse vínculo.

Pedidos: `SAIPOS_ORDER_ENABLED=true`, `SAIPOS_ORDER_SECRET`,
`SAIPOS_ORDER_PARTNER_ID`, `SAIPOS_ORDER_STORE_CODE`. O servidor gera e reutiliza
o token por até 48 horas com margem de 10 minutos. Nenhum segredo vai ao cliente.

Logística: `SAIPOS_LOGISTICS_ENABLED=true`, `SAIPOS_LOGISTICS_CLIENT_ID`,
`SAIPOS_LOGISTICS_CLIENT_SECRET` (mínimo 32 caracteres aleatórios),
`SAIPOS_LOGISTICS_MERCHANT_ID` e `SAIPOS_LOGISTICS_APP_ID`. Os dois primeiros
identificam a credencial fornecida pelo Tetteo ao cadastro da loja na Saipos.
O merchant é fornecido pela loja. Não reutilizar as credenciais de Pedidos.

## Pedidos

`POST /api/saipos/operacoes` exige sessão, diretor, unidade ativa e Origin da
própria aplicação. Corpo `{ tipo: "pedido", dados: comando }`.

Comandos: `criar` com `pedido`; `status` com `order_id/status`; `cancelar` com
`order_id`; `fechar` com `order_id`; `transferir` com `order_id/table`; `converter`
com `table`. O `cod_store` é sempre fixado no servidor. Mudanças em pedido
exigem referência previamente registrada nesta unidade/canal.
`adicionar` recebe `comando_id` UUID único por intenção e `pedido` TABLE, com
itens novos, para consumo contínuo sem reenviar o comando após uma falha.
A conversão registra os `order_ids` devolvidos pela Saipos antes de permitir
novas alterações nesses pedidos.

Os comandos chamam `/order`, `/update-order-status`, `/cancel-order`,
`/close-sale`, `/change-table` e `/convert-orders-in-table` conforme o contrato.
O ID de criação não é trocado ao ocorrer erro. Mesma chave e outro conteúdo
são recusados. Um envio fica reservado antes da chamada HTTP; concorrência e
reinício não provocam reenvio automático. `RECEBIDO` significa apenas resposta
HTTP de sucesso. Timeout/5xx gera `INCERTO`, exigindo conferência no PDV.
Não há recuperação automática de envio incerto nem botão de forçar reenvio.

Consultas: `{ tipo: "consulta", dados: { consulta, parametros } }`.
`consulta` pode ser `catalogo`, `garcons`, `comandas`, `pedido`, `comanda` ou
`mesa`; parâmetros são restritos aos identificadores de cada rota.
O catálogo retorna o resultado oficial (link válido por 30 minutos), sem
download automático de URLs arbitrárias nem alteração do cardápio local.

### Eventos recebidos

O recebimento é configurado independentemente do envio: exige unidade, ambiente,
chave de cifragem, código da loja e chave do webhook. Não exige secret/partnerId
nem `SAIPOS_ORDER_ENABLED=true`. Assim, cadastrar o callback não libera comandos
de escrita no PDV. Pedidos desconhecidos continuam recusados.

URL: `https://SEU_DOMINIO/api/saipos/maquina/pedidos/eventos/CHAVE`.
`CHAVE` é o segredo aleatório de 64 hex `SAIPOS_ORDER_WEBHOOK_KEY`, cadastrado
privadamente no Developer. Tratar a URL como credencial, nunca em commit,
screenshot público, analytics ou logs de acesso. Configurar redação do segmento
no proxy ANTES de ativar. O contrato consultado não especifica assinatura de
Pedidos; essa capacidade é uma alternativa explícita, não alegação de HMAC
fornecido pela Saipos. Se o proxy não puder redigir, manter callback desativado
até confirmar um mecanismo de autenticação por header com o fornecedor.

O callback valida loja e pedido conhecido, deduplica evento e guarda histórico.
Sem sequência/instante no contrato, não regride o estado do pedido por ordem de
chegada. TABLE/comanda não possuem esses eventos segundo a documentação.

## Logística Open Delivery

Informar à Saipos a base `https://SEU_DOMINIO/api/saipos/maquina`:

| Método | Caminho relativo                         | Uso                                        |
| ------ | ---------------------------------------- | ------------------------------------------ |
| POST   | `/oauth/token`                           | client_credentials, JSON ou formulário     |
| POST   | `/v1/logistics/delivery`                 | recebe entrega, retorna 202 com deliveryId |
| POST   | `/v1/logistics/cancel/{orderId}`         | cancela entrega, additionalCharges=false   |
| POST   | `/v1/logistics/readyForPickup/{orderId}` | registra pronto para coleta                |

Tokens duram uma hora e são vinculados ao client e ambiente. As demais rotas
exigem Bearer e merchant correto. Unidade e organização ativas são verificadas.
O proxy de sessão libera somente o prefixo de máquina; a rota de operadores
permanece autenticada. Há teto local de 120 chamadas/minuto por processo; em
múltiplas réplicas, é necessário limitador distribuído no proxy para teto global.

A solicitação é gravada cifrada antes do 202, com deliveryId UUID estável nas
repetições. Repetição após encerramento é recusada até conciliar nova tentativa.
Nenhum entregador é despachado automaticamente. Prazo de aceitação: 15 minutos;
operações lentas são marcadas expiradas antes de qualquer despacho. Validar o
tempo real de resposta em homologação: a Saipos exige menos de 10 segundos.

Tracking: `{ tipo: "tracking", dados: eventoOpenDelivery }` no endpoint do
diretor. O corpo é serializado uma vez, assinado por HMAC-SHA256 com clientSecret
e enviado ao endpoint específico da Saipos com `X-App-Id`, `X-App-MerchantId` e
`X-App-Signature`. O par deliveryId/orderId deve existir na unidade. O estado só
é confirmado após sucesso remoto. Cancelamento concorrente da loja prevalece;
tracking incerto bloqueia novo envio e precisa de conciliação operacional.
Não há GPS, agrupamento, cálculo de frete ou aplicativo de entregador implícito.

## Banco, validação e ativação

Migração aditiva `20261026100000_saipos_operacoes` acrescenta snapshots/cursor e
`saipos_operacao`, com FK composta de organização/unidade e unicidade por
ambiente/tipo/chave. Não remove dados. Conteúdo de operações e respostas é
AES-256-GCM, vinculado ao escopo por AAD; auditoria não recebe payload/segredo.

Validar `npm run check`, `npm run build` e o teste de integração:

```sh
npx tsx --import ./scripts/ambiente-de-teste.ts --test src/connectors/saipos/operacao.integracao.ts
```

Testes usam PostgreSQL local exclusivo com `_test` no nome e transporte
controlado, sem chamadas reais de criação/cancelamento/entrega. O ensaio local
aplica o schema anterior como baseline e a migração aditiva. Não executar reset,
db push ou testes no banco da VPS. Produção usa somente `prisma migrate deploy`.

Antes de ativar: backup/restauração verificados, chave privada estável,
credenciais do ambiente correto, testes reais na loja de homologação, cadastro
das URLs pela Saipos e aprovação de cada módulo. Só depois habilitar produção.
O código publicado com flags falsas permanece aguardando configuração.

Fontes oficiais consultadas em 26/10/2026:

- https://saipos-data-api.readme.io/reference/consultar-itens-venda
- https://saipos-data-api.readme.io/reference/consultar-historico-status-vendas
- https://saipos-docs-order-api.readme.io/reference/estrutura-campos-endpoints
- https://saipos-docs-order-api.readme.io/reference/eventos-pedido
- https://saipos-api-logistica.readme.io/reference/rastreamento-eventos
- https://saipos-api-logistica.readme.io/reference/solicitar-nova-entrega
- https://abrasel-nacional.github.io/opendelivery/

A pesquisa completa está no relatório local desta sessão; não copiar
credenciais do Developer nem dados de clientes para o repositório.
