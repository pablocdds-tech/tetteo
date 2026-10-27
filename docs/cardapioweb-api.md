# Cardápio Web — referência para a integração Tetteo

Estudo em 27/10/2026. Esta referência reúne o comportamento documentado,
as divergências encontradas e as consequências para o Tetteo. Leitura de
documentação não comprova funcionamento em Sandbox nem autorização de produção.

## Fontes e cobertura

O endereço fornecido `https://cardapioweb.stoplight.io/docs/api` respondeu HTTP
404 nesta consulta. A fonte atual consultada foi a documentação oficial em
<https://docs.cardapioweb.com>, incluindo seus guias completos e sete OpenAPIs.
Não se infere, desse 404, que todos os links antigos do Stoplight foram removidos.

| Contrato                                                                     | Operações HTTP | Abrangência                                            |
| ---------------------------------------------------------------------------- | -------------: | ------------------------------------------------------ |
| [Autenticação](https://docs.cardapioweb.com/reference/api-autenticacao.json) |              2 | Troca/renovação de token e revogação                   |
| [Loja](https://docs.cardapioweb.com/reference/api-loja.json)                 |              9 | Loja, pagamentos, clientes, cupons e avaliações        |
| [Catálogo](https://docs.cardapioweb.com/reference/api-catalogo.json)         |             31 | Categorias, itens, grupos, opções, imagens e insumos   |
| [Pedidos](https://docs.cardapioweb.com/reference/api-pedidos.json)           |             19 | Consulta, criação, estados, entregadores e indicadores |
| [Identidade](https://docs.cardapioweb.com/reference/api-identidade.json)     |              2 | Contexto da instalação e validação de ticket SSO       |
| [Entregadores](https://docs.cardapioweb.com/reference/api-entregadores.json) |              1 | Consulta de entregadores                               |
| [Usuários](https://docs.cardapioweb.com/reference/api-usuarios.json)         |              2 | Lista e detalhe dos usuários da loja                   |

Total: 66 pares método/caminho nos contratos consultados. O
[índice oficial](https://docs.cardapioweb.com/llms.txt) permite conferir mudanças.

## Autenticação e autorização por unidade

Novas integrações devem usar OAuth Authorization Code com PKCE S256. O modelo
legado usa `X-API-KEY` da loja e, em determinados recursos, `X-PARTNER-KEY` da
integradora. Ele continua documentado para integrações existentes, com migração
recomendada. Não é um fallback automático para erros OAuth.

O consentimento ocorre em `https://portal.sandbox.cardapioweb.com/cw-apps` ou
`https://portal.cardapioweb.com/cw-apps`. Só o Proprietário pode autorizar. Cada
loja exige instalação e credenciais próprias, mesmo dentro da mesma conta.

Enviar `client_id`, `redirect_uri`, `state`, `code_challenge` e
`code_challenge_method=S256`. O `state` é aleatório, opaco, temporário e de uso
único; o verifier permanece no servidor. Não há `client_secret` nesse fluxo.

Troca e renovação usam `POST /api/partner/oauth/token` em formulário. A resposta
traz access/refresh token, tipo, validade e escopos; usar `expires_in` para calcular
a expiração. Revogação: `POST /api/partner/oauth/revoke`. Erro 403 exige revisar
escopos; renovar o token não concede novas permissões.

Fontes: [modelos](https://docs.cardapioweb.com/autenticacao/modelos-de-autenticacao),
[OAuth](https://docs.cardapioweb.com/autenticacao/oauth),
[legado](https://docs.cardapioweb.com/autenticacao/api-key-legado).

## Cadastro, ambientes e permissões

O suporte `integracao@cardapioweb.com` cadastra integradora e aplicativo. O
cadastro exige dados da empresa, contato, apresentação do app, URLs de
instalação/login/retorno e permissões. A URL de retorno deve coincidir exatamente
no cadastro, no consentimento e na troca de código.

Sandbox e produção têm cadastros e credenciais independentes:

| Ambiente | Base da API                                  |
| -------- | -------------------------------------------- |
| Sandbox  | `https://integracao.sandbox.cardapioweb.com` |
| Produção | `https://integracao.cardapioweb.com`         |

Apps privados também precisam de cadastro. A exigência de vídeo é documentada
para apps públicos. O fornecedor fornece loja própria de testes às integradoras
OAuth. Não usar uma loja de produção para ensaiar mutações.

| Escopo      | Recursos                                                 |
| ----------- | -------------------------------------------------------- |
| `store`     | Loja e métodos de pagamento                              |
| `orders`    | Pedidos, estados, resumos e rankings                     |
| `catalog`   | Catálogo e insumos                                       |
| `customers` | Clientes                                                 |
| `coupons`   | Cupons                                                   |
| `reviews`   | Avaliações                                               |
| `drivers`   | Entregadores; associação ao pedido também exige `orders` |
| `users`     | Usuários vinculados à loja                               |
| `auth`      | Identidade da instalação e SSO                           |

Os escopos são definidos no cadastro. Acrescentar permissões exige reinstalação
pelas lojas existentes; a documentação não permite remover permissões já
cadastradas. Planejar a evolução sem solicitar acesso que não será utilizado.

Fontes: [cadastro](https://docs.cardapioweb.com/cw-app-store/cadastro-e-publicacao),
[instalação](https://docs.cardapioweb.com/cw-app-store/instalacao-e-autorizacao).

## Pedidos e recuperação de histórico

Todos os caminhos desta seção têm prefixo `/api/partner/v1`.

| Operação    | Caminho e comportamento                                                                                     |
| ----------- | ----------------------------------------------------------------------------------------------------------- |
| Polling     | `GET /orders`: array de pedidos resumidos modificados nas últimas 8 horas                                   |
| Incremental | `updated_since` dentro das últimas 24 horas; usar sobreposição e confirmar o cursor após persistir o lote   |
| Detalhe     | `GET /orders/{order_id}`: itens, adicionais, cliente, endereço, pagamentos, descontos, taxas e total        |
| Histórico   | `GET /orders/history`: concluídos/cancelados por criação; `page`, `per_page` até 100; intervalo até 6 meses |
| Criação     | `POST /orders`: pedido imediato, canal `integration`, estado inicial `waiting_confirmation`                 |
| Carrinho    | `POST /orders/prefilled_order`: link válido por 24 horas; não representa pedido concluído                   |

O identificador do pedido é `id`; `display_id` serve para exibição. Deduplicação
deve incluir instalação/loja. Marketplaces integrados também aparecem; somar
esses pedidos às vendas Saipos pode contar a mesma venda duas vezes.

Mesas e comandas chegam depois de finalizar ou cancelar. A API não fornece a
sequência intermediária de salão nesses casos. O polling resumido não contém
todos os campos do detalhe; não inferir totais ou identidades ausentes.

As ações são POST em `/orders/{order_id}/confirm`, `start_preparation`,
`prepared`, `dispatch`, `delivered`, `finalize` e `cancel`. Pronto (`ready`),
despachado (`released`/`waiting_to_catch`) e finalizado (`closed`) são etapas
distintas. `canceling` ainda não é `canceled`. Estados desconhecidos precisam ser
preservados para revisão. Após timeout de uma escrita, consultar o resultado
antes de tentar novamente.

Criar pedido exige `order_id` próprio, `display_id`, `order_type`, `totals`,
`items` e `payments`: 1–50 itens e até 5 pagamentos. Delivery exige cliente e
endereço. Totais precisam conferir; os IDs de pagamento vêm de
`GET /merchant/payment_methods`. Não há criação de pedido agendado documentada.

Fonte: [contrato de pedidos](https://docs.cardapioweb.com/reference/api-pedidos.json).

## Webhooks e sincronização confiável

Somente eventos de pedidos estão documentados: `ORDER_CREATED` e
`ORDER_STATUS_UPDATED`. O payload resumido inclui `event_id`, `merchant_id`,
`order_id`, `order_status` e `created_at`.

Validar `X-Webhook-Token`, resolver a instalação pela loja e persistir uma inbox
durável antes de responder HTTP 200, em até 5 segundos. Deduplicar por evento e
consultar o detalhe no processamento assíncrono. Não inventar assinatura HMAC
que o contrato não fornece.

Há a entrega inicial e até 15 retentativas. Esgotá-las descarta o evento e pausa
o webhook; notificações novas também são descartadas durante a pausa. Apps da
Store solicitam reativação ao suporte. Polling/histórico continuam necessários
para reconciliação; não existe promessa de replay integral remoto.

Em mesas/comandas, há um único `ORDER_CREATED` com estado final. Não esperar
eventos intermediários. Não há webhook de alteração de catálogo/clientes
documentado nas fontes consultadas.

Fontes: [entrega](https://docs.cardapioweb.com/webhooks/visao-geral),
[eventos](https://docs.cardapioweb.com/webhooks/eventos).

## Catálogo, imagens e insumos

`GET /catalog` retorna categorias contendo itens. Sob `/api/partner/v1/catalog`,
as famílias de gestão são `/categories`, `/items`, `/option_groups` e `/options`.
Itens, grupos e opções mantêm identidades independentes. Uma opção
pode custar valores diferentes em grupos diferentes; respeitar cálculo SUM,
MEAN, MAX ou MIN e limites de escolha.

Combos são consultáveis e têm etapas ligadas a itens existentes. A criação de
combos não está disponível na API documentada. Não achatar etapas para simular
suporte de escrita.

Excluir categoria remove seus itens; remover item desvincula grupos; remover
grupo desfaz associações; remover opção é exclusão lógica e a retira dos grupos.
Apresentar impacto e conferir vínculos antes de oferecer essas operações.

Imagens usam `POST /catalog/{resource_type}/{resource_id}/image`,
`multipart/form-data`, campo binário `image`; formatos JPG/JPEG/PNG/WebP/GIF.
Há remoção de imagem por DELETE no mesmo caminho.

Insumos usam `/catalog/inventory/supply_categories` e `/supplies`, com consulta,
criação e atualização, sem DELETE documentado. `stock`, `minimum_stock` e
`active_stock_control` dos insumos são somente leitura: não implementar ajuste
de saldo remoto escrevendo nesses campos.

Fontes: [fluxos](https://docs.cardapioweb.com/fluxo-integracao),
[contrato do catálogo](https://docs.cardapioweb.com/reference/api-catalogo.json).

## CRM, indicadores e demais recursos

Clientes: `GET /merchant/customers`, páginas de até 50; detalhe por
`/merchant/customers/{customer_id}`. O schema inclui identificação, nome,
telefone/DDI, e-mail, nascimento, fidelidade, cashback e `notifications_enabled`.
Esses dados não autorizam campanhas do Tetteo por si só. Não inferir identidade
entre unidades por nome ou telefone compartilhado.

Cupons: lista paginada até 20, criação e edição em `/merchant/coupons`.
Avaliações: `/merchant/reviews`, paginação até 100 e filtros de datas. O contrato
consultado não expõe envio de campanhas WhatsApp nem edição de saldos de
fidelidade/cashback.

Indicadores: `/orders/summary`, `/summary/grouped` e rankings por `categories`,
`items` e `options`. Agrupamentos incluem tempo, canal, modalidade, pagamento,
estado e entregador. Usar `filters[campo_operador]`, sem inventar um objeto de
filtros aninhado diferente. Totais dos rankings abrangem o conjunto filtrado,
não apenas a página. Não equiparar faturamento dos pedidos a recebimento líquido.

Resumos admitem início até três anos atrás e intervalo de até seis meses.
`date_field=created_at` usa ISO 8601 com offset; `scheduled_date` usa data
`YYYY-MM-DD`. Agrupamento por hora não é compatível com `scheduled_date`;
os agrupamentos de tempo seguem o fuso da loja.

Entregadores: `GET /drivers`; vínculo por PUT e remoção por DELETE em
`/orders/{order_id}/driver`. Há condições sobre modalidade, responsável pela
entrega e rotas existentes. Usuários: `GET /users` e `/users/{id}`, com retorno
limitado a ID, nome e e-mail.

Identidade/SSO é opcional para o Tetteo, que já possui login. `/identity/context`
retorna usuário e loja; `/identity/sso_tickets/validate` consome ticket de uso
único com o Bearer da mesma loja/app. Permissões Cardápio Web não devem virar
automaticamente permissões administrativas no Tetteo.

Fontes: [loja](https://docs.cardapioweb.com/reference/api-loja.json),
[pedidos](https://docs.cardapioweb.com/reference/api-pedidos.json),
[SSO](https://docs.cardapioweb.com/cw-app-store/onboarding-e-acesso),
[entregadores](https://docs.cardapioweb.com/reference/api-entregadores.json),
[usuários](https://docs.cardapioweb.com/reference/api-usuarios.json).

## Quotas e divergências a validar

Limites por estabelecimento:

| Recurso                                           | Limite documentado      |
| ------------------------------------------------- | ----------------------- |
| GET/PUT de loja                                   | 5/minuto compartilhados |
| Catálogo completo, histórico, cada resumo/ranking | 5/minuto por endpoint   |
| Gestão `/catalog/*`                               | 100 a cada 3 minutos    |
| Demais endpoints                                  | 300 a cada 3 minutos    |

Se limites se sobrepõem, vale o mais restritivo. Tratar HTTP 429 e coordenar
consumidores da mesma loja. Fonte: [limites](https://docs.cardapioweb.com/sobre-a-api).

Divergências observadas no contrato de pedidos:

- Histórico: descrição limita início a um ano; `start_date` menciona três anos.
  Adotar um ano até confirmar o alcance com suporte/Sandbox.
- Criar pedido: descrição menciona autenticação dupla legada; segurança global
  do OpenAPI aceita Bearer e os guias atuais determinam OAuth para apps novos.
  Testar a operação antes de habilitar escrita; não mudar para API Key em silêncio.
- Lista de clientes: um exemplo do envelope contém cupons por engano. O schema
  define `customers` e `pagination`; exemplos não substituem os campos contratuais.

## Consequências para o Tetteo

Recomendações de implementação, distintas de exigências do fornecedor:

- Preservar Auth.js, organização/unidade, auditoria e fronteiras de conectores.
- Começar pelo modo consulta, com identidade da loja confirmada e segredos só
  no servidor. Registrar separadamente teste local, Sandbox e produção autorizada.
- Consulta manual não equivale a sincronização contínua. Recebimento automático
  exige inbox, worker, reconciliação, monitoramento e testes de reinício/duplicidade.
- CRM demanda escopo `customers`, paginação, minimização de dados e regras
  explícitas para associar compras; não somar fontes sobrepostas automaticamente.
- Uma prévia de catálogo não deve sobrescrever fichas técnicas ou o catálogo
  remoto. Escritas exigem mapeamento por ID e validação do impacto.
- A conexão com token legado, o recebimento durável e a conferência dos pedidos
  estão descritos em `docs/cardapioweb.md`, com limites e validação por ambiente.
  Testes locais não substituem a homologação do fornecedor.
