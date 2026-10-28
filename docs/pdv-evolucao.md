# Sequência de evolução do PDV

Plano iniciado em 27/10/2026. O objetivo é fechar primeiro o atendimento de balcão e retirada, depois a produção e a gestão, mantendo as mesmas fichas, unidades, sessão e permissões do Tetteo.

## Ordem e critérios de entrega

1. **Preparar a operação.** Diagnosticar produtos sem preço/receita, complementos, insumos indisponíveis, locais e saldos. Cada pendência deve apontar onde corrigir, sem inventar preços, receitas ou estoque. O diagnóstico deve diferenciar configuração, saldo e avisos; a venda continua fazendo a verificação definitiva.
2. **Guardar atendimentos.** Salvar, listar, retomar e descartar carrinhos por operador e unidade; não reservar estoque nem registrar pagamentos. Revalidar catálogo e preços ao retomar. Resolver concorrência de abas e consumir o rascunho na mesma transação da venda.
3. **Encaminhar para a cozinha.** Implementado o quadro escolhido pelo usuário: na cozinha → aguardando coleta → saiu para entrega → entregue, com cancelados em coluna própria. O andamento é separado do pagamento; pedidos de retirada/balcão passam de coleta diretamente a entregue. Setores de produção e integração com impressoras permanecem como evolução.
4. **Imprimir e reimprimir.** Implementadas prévias de cozinha e comprovante não fiscal, acessíveis no quadro/histórico, com impressão pelo navegador e auditoria de solicitação/reimpressão. Não há confirmação de papel. Agente local, configuração de impressoras e roteamento por setor permanecem como evolução.
5. **Integrar a gestão.** Publicar fatos de venda/cancelamento com idempotência e definir consumidores em Financeiro, Analytics e CRM, sem imports entre módulos. Distinguir dinheiro recebido, cartão/Pix registrados e liquidação real para evitar dupla contagem com Saipos.
6. **Tratar exceções.** Devolução parcial, troca e devolução após caixa fechado, com estoque e compensações financeiras auditadas. Preservar o fechamento original; nunca reescrever o passado.
7. **Ampliar consultas.** Histórico de vendas implementado com paginação, filtros por período/operador/forma de pagamento/situação/modalidade, busca e CSV de todo o filtro. Busca de clientes no atendimento e histórico de caixas continuam pendentes.
8. **Ampliar a operação.** Implementados endereço, áreas por cidade/bairro, frete/prazo e atribuição de entregador no quadro. Continuam pendentes mapas/rotas, rastreamento e acerto de motoboy; depois terminais/caixas independentes por unidade e permissões de supervisão.
9. **Adicionar integrações adiadas.** Emissão fiscal, adquirentes/Pix com confirmação automática e contingência offline somente com contratos, regras e testes próprios.

## Entrega iniciada

As etapas 1 e 2 foram implementadas. Em seguida, o usuário pediu maior proximidade visual com o Cardápio Web e priorizou o kanban da etapa 3, que foi implementado. A exploração seção por seção levou à impressão manual da etapa 4 e ao histórico de vendas da etapa 7. Os demais fluxos continuam pendentes, com modalidade entrega disponível para acompanhamento manual de estados.

O levantamento atualizado está em [Comparação com o Cardápio Web](pdv-referencia-cardapioweb.md). Após Delivery, pagamento pendente e clientes/endereços, foi implementado o agendamento com liberação de preparo. Próximas prioridades: KDS e catálogo comercial. A ordem detalhada foi ajustada ao pedido de maior semelhança operacional com a referência; não há promessa de paridade integral nesta etapa.

- Preparação em `/pdv/preparacao`, acessível a quem tem `pdv.ver` e `pdv.configurar`.
- Atendimentos salvos na frente de caixa; cada operador vê somente os próprios na unidade ativa.
- Salvamento explícito: o usuário escolhe “Salvar atendimento” antes de sair ou atender outra pessoa. Itens ainda não salvos continuam em memória. Nenhum dado de pagamento é guardado no rascunho.
- Dados reais do catálogo e os saldos precisam ser fornecidos/conferidos pelo responsável pela loja. O sistema oferece diagnóstico, sem copiar receitas ou deduzir quantidades a partir da referência visual.

## Validação e publicação por etapa

Cada incremento precisa de testes das regras afetadas, integração em PostgreSQL local exclusivo de teste, navegação Playwright com dados fictícios, `npm run check` e `npm run build`. Migrações devem ser aditivas e aplicadas em produção somente pelo `prisma migrate deploy` do deploy normal. Fazer commit apenas dos arquivos da tarefa, enviar sem força para a `main` configurada no Dokploy e confirmar o deploy antes de informar disponibilidade.

### Seção agendamento de pedidos

- Data/hora prometida de São Paulo e antecedência no checkout, carrinhos salvos e revalidação na confirmação. Página/aba de agendados, filtros/paginação, próximos preparos, atrasos e detalhes operacionais/financeiros. As cinco colunas do quadro continuam preservadas.
- Estado interno AGENDADO até o início planejado; relógio do servidor a cada trinta segundos e conferência na atualização do quadro. A criação mantém baixa e financeiro existentes; liberação apenas inicia produção. Reagendamento/início antecipado com motivo, versão e idempotência; cancelamento preserva regras financeiras.
- Migração aditiva `20261027220000_pdv_agendamentos`, mantendo os CHECKs anteriores, consistência de datas e metadados de retentativa. Aplicação local em transação protegida por host/porta/nome do banco `_test`; produção somente pelo `prisma migrate deploy` normal.
- Quatro testes de domínio novos cobrem fuso IANA, datas inválidas, limites e transições históricas de horário de verão. Uma integração própria e quatro cenários independentes passaram, incluindo dois workers, corridas com cancelamento/recebimento/reprogramação/início manual, inativos, paginação, rascunho vencido, comprovante/cozinha e rejeição no banco de metadados inválidos. Sete integrações de regressão passaram no PostgreSQL local exclusivo.
- A referência foi revista no Chrome, sem salvar: o novo pedido oferece **Pedido para agora**, **Agendar pedido**, data e faixa horária. O Tetteo usa data/hora prometida e antecedência explícitas; expediente/capacidade por janela e KDS por praça continuam como evolução.
- `npm run check`: 656 testes aprovados, sem erros de tipos, lint ou formatação; permanecem cinco avisos anteriores do CRM. `npm run build` aprovado, com os três avisos anteriores de `server/arquivos.ts`.
- Playwright com dados fictícios: horário inválido, salvar/retomar agendamento, receber sem liberar preparo, reagendar após perda de resposta e confirmar uma única alteração, início manual e cancelamento sem pagamento. O relógio liberou outro pedido pela agenda, sem consultar o quadro durante a espera. A conferência no banco confirmou um recebimento/baixa, um reagendamento/início manual e um evento automático com ator nulo, sem repetir estoque ou dinheiro.
- Filtros e prévias de comprovante/cozinha foram conferidos; cozinha continuou sem valores. Desktop compacto e celular 390×844 sem overflow do documento, com foco dentro do diálogo. Nenhum pedido de produção ou impressão física foi usado nos testes.

### Seção clientes e endereços no atendimento

- Busca de nome/telefone paginada no servidor, cadastro rápido no CRM com duplicata explícita, cliente salvo consultado por ID. O novo pedido mantém a disposição compacta da referência, com busca no topo do carrinho e formulário simples de nome/telefone.
- Carteira de até vinte endereços ativos por cliente, nome, principal único, edição versionada e desativação. Seleção preenche o pedido e exige conferir frete/prazo; não reescreve snapshots anteriores. Persistência e permissões continuam pertencendo ao CRM, sem cadastro concorrente ou consentimento de marketing automático.
- Migração aditiva `20261027210000_crm_enderecos_atendimento`; operação idempotente por chave/ator/hash e auditoria sem cópia dos valores pessoais. Produção aplica pelo `prisma migrate deploy` normal. O banco local de teste preserva o baseline histórico documentado, com SQL aditivo desta migração aplicado em transação com proteção de host/porta/nome.
- `npm run check`: 652 testes aprovados, sem erros de tipos, lint ou formatação; permanecem os cinco avisos anteriores do CRM. Três testes de domínio novos, duas integrações novas de cadastro/router e regressões de vendas, carrinhos, pedidos, delivery, recebimentos e CRM passaram no PostgreSQL local `_test`. Para a regressão antiga do CRM, foi completada somente a migração aditiva Saipos já existente e ausente nesse baseline local; nenhuma produção foi usada em teste.
- Playwright com dados fictícios: busca por nome/telefone, duplicata com seleção explícita, perda de resposta após cadastrar e repetição com um único cliente, dois endereços, troca do principal, edição e desativação. Seleção antiga detectou a versão alterada antes de preencher o pedido. Retomada consultou o cliente por ID e preservou endereço; a venda/impressão manteve o número anterior enquanto o CRM já mostrava o novo. Conferência direta no banco confirmou um cadastro, uma baixa e ausência de consentimento/identidade automática.
- Telas de busca/cadastro/endereços/entrega conferidas em 390×844 sem overflow do documento. Corrigidos o foco ao retornar do formulário à lista e o botão de gerenciar endereços para não submeter o formulário da entrega. Nenhum pedido de produção ou impressão física foi criado.
- `npm run build` aprovado, mantendo os três avisos anteriores de rastreamento de arquivos em `server/arquivos.ts`.

### Seção pedido e recebimento separados

- Pedido pendente entra na cozinha com baixa única de estoque, total/receita congelados e indicação financeira nas cinco colunas existentes. Entregue ainda não pago permanece visível em outros dias. Histórico e impressão identificam a pendência sem contabilizá-la como pagamento.
- Recebimento integral posterior com divisão de meios e troco somente em dinheiro, no caixa atual da unidade, sem repetir estoque ou reprecificar. Origem e recebimento são separados; o fechamento original permanece preservado. Cancelar pendente não exige devolução financeira; cancelar pago exige caixa do recebimento aberto e devolução manual.
- Migração aditiva `20261027200000_pdv_pagamento_pendente`; legados pagos com recebimento nulo usam o caixa original uma única vez, sem backfill de datas/atores. Trava, versões e idempotência protegem cobrança/cancelamento/fechamento concorrentes.
- `npm run check`: 649 testes aprovados, sem erros de tipos, lint ou formatação; permanecem cinco avisos anteriores do CRM. `npm run build` aprovado; permanecem os três avisos anteriores de `server/arquivos.ts`.
- Quatro testes de domínio novos, cinco cenários de integração de recebimento e sete integrações de regressão passaram em PostgreSQL local exclusivo `_test`. Cobrem total e consumo congelados, origem fechada/caixa novo em outro local, divisão/troco, legado nulo, permissões/PII, histórico/CSV, entregue pendente de outro dia, cancelamento, retentativas e disputas de cobrança/cancelamento/fechamento.
- Playwright local com dados fictícios: criar pedido pendente, indicação no quadro e recebimento dividido Pix/dinheiro com troco, mantendo a coluna e uma única baixa. Na perda simulada da resposta após COMMIT, Esc/edição foram bloqueados e a confirmação repetida registrou um só recebimento/evento, verificado também no banco. Desktop e celular de 390×844 sem overflow do documento nos formulários conferidos.
- Recebimento pelo histórico filtrado removeu o pedido da lista de pendentes e fechou o diálogo. Prévias de comprovante/cozinha mostraram o aviso, com valor a receber somente no comprovante. Cancelamento sem pagamento mostrou a mensagem correta e preservou o histórico; nenhuma impressão física ou operação de produção foi acionada.

### Seção Delivery — endereço, áreas e entregadores

- Cadastro por unidade de áreas com cidade/UF/bairros, frete e prazo; entregadores ativos/inativos; atribuição no detalhe do quadro antes da saída. Endereço e cotação são congelados no pedido; frete separado da taxa adicional no checkout, histórico, CSV e comprovante.
- `npm run check`: 645 testes aprovados, sem erros de tipos, lint ou formatação; cinco avisos anteriores do CRM. `npm run build` aprovado com as duas rotas de cadastro, mantendo os três avisos anteriores de `server/arquivos.ts`.
- Cinco testes de domínio novos, integração de cadastros/atribuição, integração independente do fluxo financeiro/logístico e quatro integrações de regressão passaram em PostgreSQL local exclusivo `_test`. Cobrem valores/versões/cobertura, frete manual, isolamento/permissões, concorrência, destinatário/endereço somente autorizados, snapshot/replay, troco, baixa/estorno e carrinhos sem cotação persistida.
- Migração aditiva `20261027190000_pdv_delivery` aplicada no banco local de teste; frete zero mantém as vendas antigas. Nenhum dado de clientes ou pedido da plataforma de referência foi importado.
- Playwright: criar/editar/inativar/reativar área, cadastrar entregador, capturar endereço, salvar/retomar atendimento e concluir venda fictícia. Mudança de frete em outra aba exige reaplicar cotação e confirmar, preservando o endereço. Áreas/entregadores e formulários foram conferidos em 390×844, sem overflow do documento após correção do cabeçalho acessível da tabela. Perfil somente de consulta não abre cadastros administrativos nem avança pedidos.
- A entrega fictícia percorreu cozinha → coleta → atribuição de motoboy → saída → entregue. Saída sem responsável foi recusada; atribuição permaneceu no mesmo estado com evento próprio. Comprovante autorizado mostrou endereço/frete; HTML de cozinha e perfil de consulta não continham os novos dados pessoais. Nenhuma impressão física foi acionada.
- Mapas/polígonos, rotas, rastreamento público e acerto de motoboy continuam pendentes. Cadastro rápido de cliente/carteira de endereços segue no CRM; pedido com pagamento pendente foi implementado na seção seguinte.

### Exploração por seção, impressão e histórico

- Inventário das entradas do menu e subseções relevantes no Chrome, com evidências e limites em `pdv-referencia-cardapioweb.md`. Mesas/comandas, Financeiro e Estoque Avançado bloqueados pelo plano foram registrados como não inspecionáveis. Nenhum pedido, caixa, envio, configuração ou integração da referência foi alterado.
- `npm run check`: 640 testes aprovados; sem erros de tipos, lint ou formatação. Permanecem os cinco avisos anteriores do CRM.
- `npm run build` aprovado com configuração exclusiva do banco local de teste, incluindo `/pdv/imprimir/[vendaId]`. Permanecem os três avisos anteriores de rastreamento de arquivos em `server/arquivos.ts`. Nenhuma migração nova neste incremento.
- Nove testes unitários novos e duas integrações PostgreSQL local passaram: autorização, escopo, nome do cliente condicionado ao CRM, idempotência/reimpressão, cozinha sem valores, cancelamento, datas/curingas, paginação/totais completos, pagamentos divididos, CSV do filtro integral e recusa de 5.001 registros.
- Playwright com dados fictícios: tabela desktop, páginas de dez, filtro de Pix incluindo pagamentos divididos, totais completos, CSV conferido, cartões no celular 390×844 sem overflow, detalhe/links de impressão, Voltar/Avançar sem detalhe antigo e erro de data inválida recuperável.
- PDF headless A4/cozinha e 80 mm/comprovante: uma página cada nos casos testados, sem corte ou página extra; via de cozinha sem preços, sabores/observações legíveis e cancelamento destacado. Ctrl+P/botão abrem a solicitação auditada; nenhuma impressora física foi acionada. Impressão automática/por setor continua pendente.

### Gestão de pedidos e aproximação visual

- Referência visual obtida na aba autenticada do Cardápio Web em 27/10/2026, incluindo gestão, opções de layout e novo pedido. O quadro de cinco colunas segue a escolha do usuário; não houve alteração de pedidos ou preferências na plataforma de referência.
- `npm run check`: 631 testes aprovados, sem erros de tipos, lint ou formatação. `npm run build` aprovado; permanecem os avisos anteriores de CRM/arquivos.
- Domínio e integração PostgreSQL local: sequência por modalidade, permissão operacional separada, concorrência, retry, cancelamento sincronizado e com versão antes do estorno, rollback, legado fora da cozinha, contagens corretas com 702 pedidos e limites explícitos. Regressões de vendas/carrinhos também passaram.
- Playwright: quadro desktop e mobile de 390×844 sem overflow do documento; busca, escolha de colunas, detalhe, avanço por botão/arraste e cancelamento com motivo. Uma venda fictícia de entrega foi registrada pelo novo checkout, retornou selecionada ao quadro e percorreu cozinha → coleta → saiu para entrega → entregue. Nenhum teste criou pedidos de produção.
- O novo checkout é um diálogo nativo, mantendo foco e fundo inerte, atalhos, carrinhos salvos e proteção de dados pendentes. A modalidade entrega permite acompanhamento manual; endereço, atribuição de entregador, rotas e confirmação bancária continuam fora desta etapa.

### Resultados das regras de preparação e carrinhos

- `npm run check` aprovado com 624 testes; sem erros de tipos, lint ou formatação. Os cinco avisos de lint do CRM já existiam antes desta entrega.
- `npm run build` aprovado, incluindo a rota de preparação. Permanecem os avisos preexistentes de rastreamento de arquivos em `server/arquivos.ts`.
- Playwright: preparação em tela móvel de 390×844 sem rolagem horizontal, filtros, busca e local inválido; salvamento, recarga da página, retomada e conclusão de venda fictícia, com retirada do atendimento da lista. Link interno recusado pelo operador preservou o carrinho.

- Os sete testes unitários de preparação passaram: preço e situação do produto, códigos opcionais, grupos inválidos isolados, receita pelos sabores, conversões e ciclos, além da distinção entre cadastro, saldo e avisos.
- A integração de preparação passou em PostgreSQL local com dados fictícios: isolamento de organização/unidade, permissão administrativa, rejeição de local inativo ou alheio, diagnóstico por produto e ausência de escritas nos cadastros.
- A integração de carrinhos passou no mesmo ambiente: isolamento por operador/unidade, revalidação do catálogo, versões e repetição de salvamentos, limite de rascunhos e conclusão única com duas chaves concorrentes. Uma disputa adicional entre salvar e concluir a mesma versão confirmou somente uma operação, preservando o estoque quando a conclusão foi recusada.

Esses resultados validam as regras testadas; não garantem saldo para todas as combinações de complementos nem substituem a conferência definitiva na venda. Os dados usados foram fictícios, em banco local exclusivo `_test`; nenhuma dessas verificações acessou produção.
