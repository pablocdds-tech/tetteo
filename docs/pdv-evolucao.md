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
8. **Ampliar a operação.** Delivery com endereço, áreas/frete, despacho e entregador; depois terminais/caixas independentes por unidade e permissões de supervisão.
9. **Adicionar integrações adiadas.** Emissão fiscal, adquirentes/Pix com confirmação automática e contingência offline somente com contratos, regras e testes próprios.

## Entrega iniciada

As etapas 1 e 2 foram implementadas. Em seguida, o usuário pediu maior proximidade visual com o Cardápio Web e priorizou o kanban da etapa 3, que foi implementado. A exploração seção por seção levou à impressão manual da etapa 4 e ao histórico de vendas da etapa 7. Os demais fluxos continuam pendentes, com modalidade entrega disponível para acompanhamento manual de estados.

O levantamento atualizado está em [Comparação com o Cardápio Web](pdv-referencia-cardapioweb.md). Próxima prioridade: endereço/frete/entregador e cliente no atendimento, depois pedido com pagamento pendente, agendamento/KDS e catálogo comercial. A ordem detalhada foi ajustada ao pedido de maior semelhança operacional com a referência; não há promessa de paridade integral nesta etapa.

- Preparação em `/pdv/preparacao`, acessível a quem tem `pdv.ver` e `pdv.configurar`.
- Atendimentos salvos na frente de caixa; cada operador vê somente os próprios na unidade ativa.
- Salvamento explícito: o usuário escolhe “Salvar atendimento” antes de sair ou atender outra pessoa. Itens ainda não salvos continuam em memória. Nenhum dado de pagamento é guardado no rascunho.
- Dados reais do catálogo e os saldos precisam ser fornecidos/conferidos pelo responsável pela loja. O sistema oferece diagnóstico, sem copiar receitas ou deduzir quantidades a partir da referência visual.

## Validação e publicação por etapa

Cada incremento precisa de testes das regras afetadas, integração em PostgreSQL local exclusivo de teste, navegação Playwright com dados fictícios, `npm run check` e `npm run build`. Migrações devem ser aditivas e aplicadas em produção somente pelo `prisma migrate deploy` do deploy normal. Fazer commit apenas dos arquivos da tarefa, enviar sem força para a `main` configurada no Dokploy e confirmar o deploy antes de informar disponibilidade.

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
