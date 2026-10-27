# PDV integrado

## Escopo da primeira entrega

PDV online de produtos para uso próprio da Vitaliano, dentro da sessão, unidades e permissões do Tetteo. Sem emissão fiscal, venda offline, integração de adquirentes ou confirmação automática de Pix. Dinheiro, Pix, crédito e débito são registros manuais de valores conferidos pelo operador.

Referência inspecionada em 27/10/2026: painel autenticado `portal.cardapioweb.com/latest-orders`, novo pedido, complementos de pizza, pagamento e formulário de abertura de caixa. Observação pela aba do Chrome e reprodução local com Playwright. O REA foi diagnosticado, mas não conectado: o Node instalado não satisfaz sua versão mínima e falta registro MCP. Não há evidência de análise interna do código do Cardápio Web.

Após a mudança de direção solicitada pelo usuário, o visual passou a acompanhar mais de perto o Cardápio Web: barra de busca/ações, cartões compactos, detalhe à direita e novo pedido em janela ampla com categorias, produtos e carrinho. Os controles roxos ficam escopados ao PDV, conforme `DESIGN.md`; a marca é Tetteo e não são copiados logo, imagens ou dados de clientes da referência.

## Catálogo e estoque

- As fichas técnicas ativas de tipo PRATO com preço de venda são os produtos, sem segundo cadastro de nome/preço. Categoria vem da ficha; código e complementos são configurações do PDV.
- Cada grupo de complementos define mínimo, máximo e cálculo SOMA ou MEDIA. Preço unitário = preço base da ficha + acréscimos dos grupos. Para sabores com preços completos por média, o produto base deve ter preço zero; a receita base pode representar a massa.
- Uma opção pode apontar para outra ficha do catálogo. Os insumos dessa ficha são somados à receita base; em grupos MEDIA, entram proporcionalmente ao número de sabores escolhidos. Opção sem vínculo altera somente o preço, sem consumo adicional.
- O caixa escolhe um local de estoque da unidade. A venda consome insumos pelas receitas e guarda o consumo utilizado. Produto sem composição utilizável ou com estoque insuficiente é recusado pelo servidor.
- Cancelamento usa os preços e consumos gravados na venda, preservando a história mesmo se a receita ou o preço atual mudar.

## Operação

1. Abra `/pdv/caixa`, selecione local e informe o saldo inicial. Existe um caixa aberto por unidade nesta primeira versão.
2. Em `/pdv`, use **Novo pedido** para abrir `/pdv/novo-pedido`. Escolha categorias ou busque nome/código. Enter no código exato adiciona o produto (ou abre suas opções). Ctrl+B foca a busca e Ctrl+P abre pagamento.
3. Escolha complementos, quantidades, cliente opcional do CRM, retirada/balcão/entrega e observação. Entrega é classificação operacional; endereço, cálculo de frete e despacho automático não estão implementados.
4. Registre pagamentos conferidos. Pagamentos podem ser divididos; excedente só gera troco em dinheiro. Desconto exige permissão própria.
5. Conclua a venda. Preços, total, permissões, caixa e estoque são verificados no servidor, na mesma transação da auditoria.
6. A venda concluída cria o pedido **Na cozinha** e retorna à gestão. Acompanhe o kanban em `/pdv` e o histórico financeiro em `/pdv/vendas`. Cancelamentos exigem justificativa e permissão. Caixa já fechado não pode ser alterado por cancelamento tardio.
7. Registre sangria/suprimento com motivo e feche contando o dinheiro físico. O sistema registra esperado, contado e diferença.

## Gestão de pedidos

O quadro tem cinco colunas: **Na cozinha**, **Aguardando coleta**, **Saiu para entrega**, **Entregue** e **Cancelado**. Entregas avançam cozinha → coleta do motoboy → saiu para entrega → entregue. Retirada/balcão avançam cozinha → coleta → entregue, sem marcar uma saída de entrega inexistente. Há botões no detalhe e arraste para a próxima etapa no computador; cancelamento por arraste também pede confirmação e motivo.

O estado operacional (`PdvPedido`) é separado da situação financeira (`PdvVenda`). Avançar uma etapa não registra pagamento nem movimenta estoque. Cada alteração confere organização, unidade, permissão `pdv.operar` e versão do pedido, com histórico auditado e horários em São Paulo. Uma requisição repetida não cria outro pedido nem repete o evento.

O cancelamento usa o mesmo fluxo financeiro autorizado por `pdv.cancelar`: preserva a venda, estorna seu consumo original e sincroniza a coluna Cancelado na mesma transação. A versão é conferida antes do estorno; alterações concorrentes são recusadas. Pagamento é devolvido manualmente. Se os insumos já foram fisicamente consumidos, o responsável deve registrar a perda no Estoque; o estorno contábil não recupera ingredientes reais.

O quadro atualiza a cada 15 segundos enquanto visível, ao voltar à janela ou pelo botão Atualizar, sem sobrepor consultas. Respostas anteriores a uma mudança local não podem regredir o cartão. A busca por número/cliente filtra os cartões carregados. Pedidos ativos de qualquer dia continuam visíveis; entregues/cancelados seguem o dia selecionado no fuso `America/Sao_Paulo`. Os limites de 500 ativos e 200 finalizados são informados com contagens completas e aviso quando atingidos.

Somente vendas novas após a implantação geram a fila operacional. A migração não cria pedidos para vendas antigas nem presume que foram entregues: elas permanecem no histórico financeiro. O quadro não recebe pedidos do Cardápio Web automaticamente.

## Conexão e limites

Itens ainda não salvos ficam em memória na tela durante queda de conexão; mantenha a página aberta. Use “Salvar atendimento” para guardar os itens no servidor e liberar o caixa. Cada operador pode manter até 20 atendimentos ativos por unidade. É possível recarregar/fechar e retomar esses atendimentos depois, com o catálogo e preços atuais. Descontos, taxas e pagamentos não são guardados e precisam ser informados novamente. Salvar não reserva estoque nem conclui uma venda.

Ao editar um atendimento retomado, salve novamente para guardar as alterações. Versões impedem que outra aba sobrescreva silenciosamente o mesmo rascunho; diante de conflito conhecido, é possível salvar uma cópia explícita, preservando o original. A conclusão marca o rascunho como concluído na mesma transação da venda e baixa de estoque. Cancelar uma venda não reabre o rascunho.

O navegador avisa antes de recarregar uma página com itens, e os links da interface pedem confirmação antes de sair sem guardar alterações. Quando a resposta da conclusão falha, a interface mantém a identificação da tentativa, inclusive se a sessão expirar durante a confirmação, evitando criar automaticamente uma nova venda. A mesma proteção se aplica à confirmação de salvamento. Não mude de unidade com atendimento não salvo.

## Preparação da operação

`/pdv/preparacao` oferece diagnóstico administrativo por unidade e local de estoque; exige `pdv.ver` e `pdv.configurar`. Inclui pratos inativos ou sem preço, receitas e preparos indisponíveis, ciclos e unidades incompatíveis, grupos de complementos inválidos, códigos ausentes e complementos sem receita vinculada. Mostra links para os cadastros existentes. Não cria produtos, receitas, saldos ou caixa automaticamente.

“Sem impedimento de cadastro” não garante saldo suficiente para todas as combinações de complementos. O diagnóstico separa bloqueios de cadastro, alertas de estoque e avisos; a venda continua validando a combinação e o estoque dentro da transação.

Esta versão não contempla entrega com endereço/roteirização, agendamento de produção, mesas/comandas, múltiplos terminais de caixa por unidade, devolução parcial ou devolução após caixa fechado. Esses fluxos precisam de regras próprias; o histórico de vendas permanece preservado.

O histórico consulta as 100 vendas mais recentes e os 30 últimos caixas fechados. O seletor traz até 500 clientes ativos, somente para quem possui `crm.ver`. Nesta entrega as vendas aparecem no histórico próprio do PDV; não alimentam automaticamente os relatórios antigos de Saipos/Analytics, os lançamentos do Financeiro ou as métricas de campanhas do CRM.

## Verificações executadas

- `npm run check`: 613 testes aprovados, sem erros de lint; cinco avisos preexistentes no CRM.
- `npm run build`: aprovado; avisos preexistentes de rastreamento de arquivos em `server/arquivos.ts`.
- Integração PostgreSQL local: escopo, concorrência, repetição de venda, rollback de estoque insuficiente, cancelamento pelo consumo original após mudança da receita e disputa entre venda e fechamento.
- Playwright: login fictício, abertura, pizza de dois sabores pela média, pagamento dividido Pix/dinheiro com troco, venda concluída e histórico, cancelamento e fechamento conferido. Nenhuma venda de produção foi criada.

## Permissões e validação

`pdv.ver`, `pdv.vender`, `pdv.operar`, `pdv.caixa`, `pdv.desconto`, `pdv.cancelar`, `pdv.configurar`. O diretor já tem `*`; nenhum outro perfil recebe permissões automaticamente. Autorizações são aplicadas no servidor em cada ação. Permissão de avançar pedidos não concede permissão de cancelar vendas.

Schema em `prisma/schema/pdv.prisma`, migração aditiva em `prisma/schema/migrations`. Produção usa somente `prisma migrate deploy`. Nunca use banco de produção em testes. Antes de publicar: `npm run check`, `npm run build` e integração PDV em PostgreSQL local exclusivo com `_test` no nome.
