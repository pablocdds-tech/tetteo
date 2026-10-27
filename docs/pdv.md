# PDV integrado

## Escopo da primeira entrega

PDV online de produtos para uso próprio da Vitaliano, dentro da sessão, unidades e permissões do Tetteo. Sem emissão fiscal, venda offline, integração de adquirentes ou confirmação automática de Pix. Dinheiro, Pix, crédito e débito são registros manuais de valores conferidos pelo operador.

Referência inspecionada em 27/10/2026: painel autenticado `portal.cardapioweb.com/latest-orders`, novo pedido, complementos de pizza, pagamento e formulário de abertura de caixa. Observação pela aba do Chrome e reprodução local com Playwright. O REA foi diagnosticado, mas não conectado: o Node instalado não satisfaz sua versão mínima e falta registro MCP. Não há evidência de análise interna do código do Cardápio Web.

O layout usa categorias à esquerda, produtos no centro, carrinho à direita e pagamento em painel lateral. A identidade segue `DESIGN.md`; não são copiados marca, imagens ou dados de clientes da referência.

## Catálogo e estoque

- As fichas técnicas ativas de tipo PRATO com preço de venda são os produtos, sem segundo cadastro de nome/preço. Categoria vem da ficha; código e complementos são configurações do PDV.
- Cada grupo de complementos define mínimo, máximo e cálculo SOMA ou MEDIA. Preço unitário = preço base da ficha + acréscimos dos grupos. Para sabores com preços completos por média, o produto base deve ter preço zero; a receita base pode representar a massa.
- Uma opção pode apontar para outra ficha do catálogo. Os insumos dessa ficha são somados à receita base; em grupos MEDIA, entram proporcionalmente ao número de sabores escolhidos. Opção sem vínculo altera somente o preço, sem consumo adicional.
- O caixa escolhe um local de estoque da unidade. A venda consome insumos pelas receitas e guarda o consumo utilizado. Produto sem composição utilizável ou com estoque insuficiente é recusado pelo servidor.
- Cancelamento usa os preços e consumos gravados na venda, preservando a história mesmo se a receita ou o preço atual mudar.

## Operação

1. Abra `/pdv/caixa`, selecione local e informe o saldo inicial. Existe um caixa aberto por unidade nesta primeira versão.
2. Em `/pdv`, escolha categorias ou busque nome/código. Enter no código exato adiciona o produto (ou abre suas opções). Ctrl+B foca a busca e Ctrl+P abre pagamento.
3. Escolha complementos, quantidades, cliente opcional do CRM, retirada/balcão e observação.
4. Registre pagamentos conferidos. Pagamentos podem ser divididos; excedente só gera troco em dinheiro. Desconto exige permissão própria.
5. Conclua a venda. Preços, total, permissões, caixa e estoque são verificados no servidor, na mesma transação da auditoria.
6. Consulte `/pdv/vendas`; cancelamentos exigem justificativa e permissão. Caixa já fechado não pode ser alterado por cancelamento tardio.
7. Registre sangria/suprimento com motivo e feche contando o dinheiro físico. O sistema registra esperado, contado e diferença.

## Conexão e limites

O carrinho fica em memória na tela durante queda de conexão; mantenha a página aberta. Ele não é um mecanismo offline e não sobrevive a fechar o navegador. O navegador avisa antes de recarregar uma página com itens. Quando a resposta da conclusão falha, a interface mantém o payload para repetir a mesma identificação da venda, evitando duplicidade. Não mude de unidade com venda pendente.

Esta versão não contempla entrega com endereço/roteirização, agendamento de produção, mesas/comandas, múltiplos terminais de caixa por unidade, devolução parcial ou devolução após caixa fechado. Esses fluxos precisam de regras próprias; o histórico de vendas permanece preservado.

O histórico consulta as 100 vendas mais recentes e os 30 últimos caixas fechados. O seletor traz até 500 clientes ativos, somente para quem possui `crm.ver`. Nesta entrega as vendas aparecem no histórico próprio do PDV; não alimentam automaticamente os relatórios antigos de Saipos/Analytics, os lançamentos do Financeiro ou as métricas de campanhas do CRM.

## Verificações executadas

- `npm run check`: 613 testes aprovados, sem erros de lint; cinco avisos preexistentes no CRM.
- `npm run build`: aprovado; avisos preexistentes de rastreamento de arquivos em `server/arquivos.ts`.
- Integração PostgreSQL local: escopo, concorrência, repetição de venda, rollback de estoque insuficiente, cancelamento pelo consumo original após mudança da receita e disputa entre venda e fechamento.
- Playwright: login fictício, abertura, pizza de dois sabores pela média, pagamento dividido Pix/dinheiro com troco, venda concluída e histórico, cancelamento e fechamento conferido. Nenhuma venda de produção foi criada.

## Permissões e validação

`pdv.ver`, `pdv.vender`, `pdv.caixa`, `pdv.desconto`, `pdv.cancelar`, `pdv.configurar`. O diretor já tem `*`; nenhum outro perfil recebe permissões automaticamente. Autorizações são aplicadas no servidor em cada ação.

Schema em `prisma/schema/pdv.prisma`, migração aditiva em `prisma/schema/migrations`. Produção usa somente `prisma migrate deploy`. Nunca use banco de produção em testes. Antes de publicar: `npm run check`, `npm run build` e integração PDV em PostgreSQL local exclusivo com `_test` no nome.
