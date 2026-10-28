# PDV integrado

## Escopo da primeira entrega

PDV online de produtos para uso próprio da Vitaliano, dentro da sessão, unidades e permissões do Tetteo. Sem emissão fiscal, venda offline, integração de adquirentes ou confirmação automática de Pix. Dinheiro, Pix, crédito e débito são registros manuais de valores conferidos pelo operador.

Referência inspecionada em 27/10/2026: painel autenticado `portal.cardapioweb.com/latest-orders`, novo pedido, complementos de pizza, pagamento e formulário de abertura de caixa. Observação pela aba do Chrome e reprodução local com Playwright. O REA foi diagnosticado, mas não conectado: o Node instalado não satisfaz sua versão mínima e falta registro MCP. Não há evidência de análise interna do código do Cardápio Web.

A exploração seguinte percorreu o menu principal e subseções de gestão, histórico, catálogo, KDS, delivery, clientes, caixa, empresa, configurações, campanhas, WhatsApp, fidelidade e fiado. O inventário, as páginas observadas, os bloqueios do plano e as diferenças pendentes estão em [Comparação com o Cardápio Web](pdv-referencia-cardapioweb.md). Não foram criados pedidos ou alterados dados na referência.

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
3. Escolha complementos, quantidades, cliente opcional do CRM, retirada/balcão/entrega e observação. Para entrega, informe destinatário, endereço e prazo, escolha uma área cadastrada ou justifique o frete manual. Frete e taxa adicional são separados no total.
4. Registre pagamentos conferidos ou confirme **Enviar à cozinha e cobrar depois**, sem pagamentos preenchidos. Pagamentos podem ser divididos; excedente só gera troco em dinheiro. Desconto exige permissão própria.
5. Confirme o pedido. Preços, total, permissões, caixa e estoque são verificados no servidor, na mesma transação da auditoria. A baixa de estoque ocorre neste momento, inclusive quando o pagamento fica pendente.
6. O pedido entra **Na cozinha** e retorna à gestão. Acompanhe o kanban em `/pdv` e o histórico financeiro em `/pdv/vendas`. Cancelamentos exigem justificativa e permissão; recebimentos e devoluções não reescrevem caixas já fechados.
7. Registre sangria/suprimento com motivo e feche contando o dinheiro físico. O sistema registra esperado, contado e diferença.

## Gestão de pedidos

O quadro tem cinco colunas: **Na cozinha**, **Aguardando coleta**, **Saiu para entrega**, **Entregue** e **Cancelado**. Entregas avançam cozinha → coleta do motoboy → saiu para entrega → entregue. Retirada/balcão avançam cozinha → coleta → entregue, sem marcar uma saída de entrega inexistente. Há botões no detalhe e arraste para a próxima etapa no computador; cancelamento por arraste também pede confirmação e motivo.

O estado operacional (`PdvPedido`) é separado da situação financeira (`PdvVenda`). Avançar uma etapa não registra pagamento nem movimenta estoque. Cada alteração confere organização, unidade, permissão `pdv.operar` e versão do pedido, com histórico auditado e horários em São Paulo. Uma requisição repetida não cria outro pedido nem repete o evento.

O cancelamento usa o mesmo fluxo financeiro autorizado por `pdv.cancelar`: preserva a venda, estorna seu consumo original e sincroniza a coluna Cancelado na mesma transação. As versões operacional e financeira são conferidas antes do estorno; alterações concorrentes são recusadas. Sem pagamento, é possível cancelar após fechar o caixa de origem, sem devolução de dinheiro. Com pagamento, o caixa do recebimento precisa estar aberto e a devolução é manual. Se os insumos já foram fisicamente consumidos, o responsável deve registrar a perda no Estoque; o estorno contábil não recupera ingredientes reais.

O quadro atualiza a cada 15 segundos enquanto visível, ao voltar à janela ou pelo botão Atualizar, sem sobrepor consultas. Respostas anteriores a uma mudança local não podem regredir o cartão. A busca por número/cliente filtra os cartões carregados. Pedidos ativos e entregues ainda não pagos continuam visíveis em qualquer dia; demais entregues/cancelados seguem o dia selecionado no fuso `America/Sao_Paulo`. Os limites de 500 ativos e 200 finalizados são informados com contagens completas e aviso quando atingidos.

Somente vendas novas após a implantação geram a fila operacional. A migração não cria pedidos para vendas antigas nem presume que foram entregues: elas permanecem no histórico financeiro. O quadro não recebe pedidos do Cardápio Web automaticamente.

## Pedido com pagamento pendente

O estado financeiro **Aguardando pagamento** é uma indicação no cartão, sem criar uma sexta coluna. O pedido pode avançar até entregue antes da cobrança. Criá-lo exige caixa aberto para definir o local da baixa, e consome o atendimento salvo na mesma transação. Não reserva estoque para baixar depois: o consumo original fica congelado junto dos preços, desconto, taxa e frete.

No detalhe do quadro ou histórico, **Receber pagamento** exige `pdv.ver` e `pdv.vender`. O operador quita todo o total congelado em uma operação, podendo dividir entre dinheiro, Pix, crédito e débito. Não há parcelas de cobrança ou depósitos progressivos nesta etapa. O recebimento usa o caixa atualmente aberto na unidade, mesmo se o caixa de origem já fechou ou utilizava outro local. Não consulta preços/receitas atuais e não baixa estoque novamente.

O caixa de origem e o caixa de recebimento são guardados separadamente. Fechar o primeiro não perde a pendência; o dinheiro só entra nos totais do segundo. Registros pagos anteriores à migração, sem metadados de recebimento, permanecem contabilizados no caixa original uma única vez, sem inventar data ou operador de recebimento. O fechamento gravado não é alterado.

Recebimento, cancelamento e fechamento usam a mesma trava por unidade. A versão financeira evita aceitar uma tela anterior à cobrança; a chave, o payload e o operador identificam retentativas, inclusive depois de fechar caixa ou cancelar. A interface mantém a tentativa inteira e bloqueia edição/saída quando a resposta é incerta. O evento de pagamento incrementa a versão do pedido sem mudar sua coluna.

Comprovante e cozinha destacam **AGUARDANDO PAGAMENTO**; somente o comprovante inclui o valor a receber. Histórico e CSV distinguem pendentes de pagamentos registrados. Os totais do histórico continuam usando a data de criação do pedido; data e operador reais do recebimento aparecem separadamente quando disponíveis.

## Agendamento de pedidos

No novo pedido, **Pedido para agora** abre a escolha entre atendimento imediato e **Agendar**. Informe data/hora prometida e quantos minutos antes deve começar o preparo. Todos os horários usam `America/Sao_Paulo`, independentemente do fuso do navegador/servidor. A promessa deve ficar entre cinco minutos e noventa dias no futuro; a antecedência pode ser de um minuto a vinte e quatro horas. Se o início calculado já chegou, a tela informa que o pedido entrará imediatamente na cozinha.

Confirmar o pedido continua validando caixa, catálogo, receita, preço e estoque. A baixa e o registro de pagamento ou pendência ocorrem uma única vez na confirmação. O agendamento controla a produção; não representa reserva sem consumo nem pagamento futuro automático. Frete e endereço permanecem congelados, com a previsão da entrega definida pelo horário prometido.

`/pdv/agendamentos` e a aba **Agendados** mostram os horários, início previsto/real, situação operacional e financeira, próximos preparos e pedidos atrasados. Há filtros pelo período prometido e situação, com páginas de vinte. O padrão traz todos os agendamentos em aberto, incluindo os atrasados de outros dias. O estado interno **AGENDADO** aguarda fora das cinco colunas do quadro; quando liberado, entra em **Na cozinha**.

O servidor verifica a fila a cada trinta segundos, em lotes de até cem, inclusive sem navegador aberto. Reinício ou indisponibilidade são recuperados pela próxima verificação. O quadro também confere os vencidos da unidade ao atualizar. Trava e revalidação no banco coordenam instâncias; o evento automático usa ator nulo e operador Sistema. A liberação não exige caixa aberto nem repete preço, pagamento ou estoque.

Enquanto aguarda preparo, **Reagendar** exige `pdv.vender`, motivo e versão; **Iniciar agora** exige `pdv.operar` e motivo. Reagendamento atualiza os horários e a previsão da entrega, preservando endereço, frete e valores. Após iniciar, o pedido segue o fluxo normal do quadro. **Receber pagamento** não libera produção. Cancelamento mantém `pdv.cancelar`, guarda financeira e estorno do consumo original. Retentativas preservam chave/payload/ator e recuperam a confirmação mesmo depois de outra mudança de estado.

Atendimentos salvos guardam a data escolhida. Ao retomar, um horário vencido precisa ser corrigido ou trocado explicitamente por **Para agora** antes da confirmação. Comprovante e cozinha mostram promessa e início previsto/real; cozinha continua sem valores financeiros ou endereço/telefone estruturados. Emissão fiscal, validação de expediente/capacidade por janela e regras avançadas de agenda permanecem fora desta etapa.

## Clientes e endereços no atendimento

O campo **Buscar cliente**, no topo do carrinho, consulta nome ou telefone no CRM da unidade ativa. Digite pelo menos dois caracteres; a pesquisa usa páginas de vinte resultados no servidor, sem restringir a busca aos primeiros 500 clientes. O atendimento salvo retoma o cliente pelo ID, sem substituir seu endereço ou cotação por dados atuais do cadastro.

**Novo cliente** abre cadastro rápido de nome e telefone sem sair do pedido. Exige `crm.ver` e `crm.editar`; consulta e seleção exigem `crm.ver`. O telefone segue a normalização e a unicidade do CRM. Uma duplicata ativa oferece **Usar cliente existente**, por escolha explícita, sem sobrescrever o cadastro. Contatos inativos ou fundidos não são selecionáveis. Criar contato não habilita marketing, não verifica posse do telefone e não registra consentimento ou identidade verificada.

Na entrega, escolha um endereço do cliente ou abra **Escolher ou salvar endereço do cliente**. É possível nomear endereços, salvar o endereço válido em revisão, editar, marcar um principal e desativar; não há exclusão física. Cada cliente pode ter vinte endereços ativos. Alterações conferem a versão e a unidade; somente um endereço ativo pode ser principal. Desativar/fundir o contato esconde os endereços antigos, sem transferi-los automaticamente para outra pessoa.

Selecionar um endereço preenche destinatário, telefone e endereço e pede nova conferência de frete/prazo. A área ou o frete anterior não são reaproveitados silenciosamente. Trocar cliente com uma entrega já preenchida permite escolher entre revisar os dados ou manter explicitamente a entrega atual. O pedido só muda ao confirmar o formulário. Editar o cadastro não altera vendas já gravadas, impressões anteriores ou o conteúdo congelado de um atendimento salvo.

O navegador usa `/api/crm/atendimento/clientes`, API do módulo proprietário do cadastro. O PDV não mantém outra base de pessoas nem escreve nas tabelas do CRM. A API conserva sessão, unidade ativa, permissões, origem autorizada, limites e resposta privada sem cache. Esses acessos não executam sincronização externa do Saipos. A auditoria guarda referências/campos alterados; o histórico de pedidos e a cozinha mantêm as restrições anteriores de dados pessoais.

Criação/edição usa chave, ator e hash na mesma transação, evitando duplicação após resposta perdida. A tela conserva a tentativa e bloqueia saída/edição enquanto a confirmação é incerta. Se o servidor confirma que a própria operação foi registrada, mas o cadastro mudou depois, a interface libera uma nova consulta sem repetir a escrita.

## Delivery — endereço, áreas e entregadores

As áreas são configuradas em `/pdv/entregas/areas`, com nome, cidade, UF, bairros, frete e prazo em minutos. Uma área sem bairros específicos atende qualquer bairro da cidade informada; não há cálculo por distância. O caixa seleciona explicitamente a área. O servidor confere atividade, versão, cidade/UF, bairro, frete e prazo antes de concluir. Alterações no cadastro exigem atualizar e conferir a cotação; nunca mudam uma venda já gravada. O frete manual exige justificativa, inclusive quando gratuito.

Em **Endereço e entrega**, o operador informa destinatário, telefone opcional, logradouro/número, bairro/cidade/UF e, quando necessários, complemento, CEP e referência. Os dados são copiados para o pedido na mesma transação da venda/estoque. A previsão é calculada no servidor a partir da criação do pedido e do prazo informado; é uma estimativa, sem confirmação por mapa ou contato externo. Novas vendas de entrega exigem esses dados. Vendas antigas permanecem sem endereço fabricado e suas retentativas idempotentes continuam válidas.

O atendimento salvo preserva destinatário/endereço e vínculo da área somente para o próprio operador. Não guarda o frete, a versão da cotação ou o prazo: ao retomar, é preciso conferir a área e os valores atuais. Frete manual precisa ser informado e justificado novamente. Alterar entrega/modalidade remove os pagamentos preenchidos para que o operador confira o novo total. Em confirmação de venda incerta, a retentativa mantém o payload original completo.

Entregadores são cadastrados em `/pdv/entregas/entregadores`, com nome, telefone opcional e atividade. No detalhe do kanban, é possível atribuir/remover um entregador enquanto o pedido está na cozinha ou aguardando coleta. A atribuição confere unidade, atividade e versão, incrementa a versão do pedido e registra o histórico sem movimentar caixa/estoque. Não é possível reatribuir depois da saída ou em pedido finalizado/cancelado. Para novas entregas com endereço, a saída exige entregador ativo e permissões de operação e entrega. Pedidos legados sem endereço mantêm o acompanhamento anterior.

`pdv.entrega` permite consultar os endereços e gerenciar entregadores/atribuições. `pdv.operar` continua necessária para avançar estados; `pdv.configurar` administra áreas. A captura no caixa usa `pdv.vender`; não concede leitura de endereços de outros pedidos. O comprovante só recebe endereço/telefone com `pdv.entrega`; a cozinha não recebe esses campos. O CSV não exporta contatos ou endereços. Os novos campos estruturados de entrega não são copiados para a auditoria.

Há limite explícito de 200 áreas e 200 entregadores por unidade, sem exclusão física: use atividade para pausar e preservar o histórico. Neste incremento não há polígonos/círculos no mapa, geocodificação/consulta automática de CEP, rota, rastreamento público, link de entregador, integração logística ou acerto financeiro de motoboy. O cardápio público e os pedidos de plataformas externas continuam separados.

## Impressão e reimpressão

Os detalhes do quadro e do histórico oferecem **Imprimir pedido** e **Versão para cozinha**. Abrem uma prévia autenticada em outra aba, fora da navegação lateral, em `/pdv/imprimir/[vendaId]`. A via padrão é um comprovante não fiscal com itens, complementos, observações, subtotal, desconto, taxa, total, pagamentos registrados, troco e operador. A via de cozinha não envia preços ou pagamentos ao navegador; mostra itens/opções por unidade, quantidade, observações e situação do pedido. Vendas canceladas têm destaque e motivo.

A prévia é preparada para bobina de 80 mm. O operador escolhe impressora/papel no diálogo do navegador; também pode usar A4 ou salvar PDF. Botão e Ctrl+P registram a solicitação antes de abrir esse diálogo. Repetir uma tentativa cuja resposta se perdeu não duplica seu registro. Uma nova solicitação da mesma via é auditada como reimpressão. O navegador não informa se saiu papel: a auditoria registra solicitação, sem afirmar emissão física.

O nome congelado do cliente do CRM só aparece nessas vias para quem possui `crm.ver`; dados atuais de contato não são buscados. O comprovante de entrega pode incluir destinatário/endereço/telefone congelados no pedido quando o leitor possui `pdv.entrega`; a cozinha nunca recebe esses campos. Cada leitura e solicitação verifica sessão, `pdv.ver`, organização e unidade ativa. Abrir a prévia não gera uma solicitação de impressão. Impressão automática, agente QzTray, setores/impressoras, múltiplas vias e resumo impresso de caixa permanecem pendentes.

## Histórico e exportação

`/pdv/vendas` consulta vendas no servidor por período de criação (dias de São Paulo), situação financeira, modalidade, forma de pagamento, operador e busca por número, identificação, operador ou cliente autorizado. O padrão é o dia atual, com páginas de dez registros. Vendas antigas continuam consultáveis ao escolher o período; totais de pendentes, pagamentos registrados e canceladas consideram **todo o filtro**, não apenas a página. Pendentes não integram o total de pagamentos registrados.

A exportação CSV aplica o mesmo filtro e não depende da página. Até 5.000 vendas podem ser exportadas por arquivo; acima disso, o sistema exige refinar o filtro, sem baixar uma parte silenciosamente. Exportações são auditadas e células de texto são protegidas contra interpretação como fórmula de planilha. Cliente só integra resultados, busca e CSV para quem tem `crm.ver`; o arquivo não inclui telefone/endereço ou dados de contato atuais do CRM.

O filtro de pagamento seleciona vendas que contêm aquele meio, inclusive pagamentos divididos. O total é o valor integral dessas vendas, não apenas a parcela recebida pelo meio escolhido. Pagamentos Pix/cartão continuam registros manuais. Não há filtro por canal ou agendamento enquanto esses fluxos não existirem.

## Conexão e limites

Itens ainda não salvos ficam em memória na tela durante queda de conexão; mantenha a página aberta. Use “Salvar atendimento” para guardar os itens no servidor e liberar o caixa. Cada operador pode manter até 20 atendimentos ativos por unidade. É possível recarregar/fechar e retomar esses atendimentos depois, com o catálogo e preços atuais. Descontos, taxas e pagamentos não são guardados e precisam ser informados novamente. Salvar não reserva estoque nem conclui uma venda.

Ao editar um atendimento retomado, salve novamente para guardar as alterações. Versões impedem que outra aba sobrescreva silenciosamente o mesmo rascunho; diante de conflito conhecido, é possível salvar uma cópia explícita, preservando o original. A conclusão marca o rascunho como concluído na mesma transação da venda e baixa de estoque. Cancelar uma venda não reabre o rascunho.

O navegador avisa antes de recarregar uma página com itens, e os links da interface pedem confirmação antes de sair sem guardar alterações. Quando a resposta da conclusão falha, a interface mantém a identificação da tentativa, inclusive se a sessão expirar durante a confirmação, evitando criar automaticamente uma nova venda. A mesma proteção se aplica à confirmação de salvamento. Não mude de unidade com atendimento não salvo.

## Preparação da operação

`/pdv/preparacao` oferece diagnóstico administrativo por unidade e local de estoque; exige `pdv.ver` e `pdv.configurar`. Inclui pratos inativos ou sem preço, receitas e preparos indisponíveis, ciclos e unidades incompatíveis, grupos de complementos inválidos, códigos ausentes e complementos sem receita vinculada. Mostra links para os cadastros existentes. Não cria produtos, receitas, saldos ou caixa automaticamente.

“Sem impedimento de cadastro” não garante saldo suficiente para todas as combinações de complementos. O diagnóstico separa bloqueios de cadastro, alertas de estoque e avisos; a venda continua validando a combinação e o estoque dentro da transação.

Esta versão não contempla roteirização, agendamento de produção, mesas/comandas, múltiplos terminais de caixa por unidade, devolução parcial ou devolução após caixa fechado. Esses fluxos precisam de regras próprias; o histórico de vendas permanece preservado.

O histórico de caixas ainda consulta os 30 últimos fechamentos. A busca de clientes é paginada no CRM e exige `crm.ver`. Nesta entrega as vendas aparecem no histórico próprio do PDV; não alimentam automaticamente os relatórios antigos de Saipos/Analytics, os lançamentos do Financeiro ou as métricas de campanhas do CRM.

## Verificações executadas

- `npm run check`: 613 testes aprovados, sem erros de lint; cinco avisos preexistentes no CRM.
- `npm run build`: aprovado; avisos preexistentes de rastreamento de arquivos em `server/arquivos.ts`.
- Integração PostgreSQL local: escopo, concorrência, repetição de venda, rollback de estoque insuficiente, cancelamento pelo consumo original após mudança da receita e disputa entre venda e fechamento.
- Playwright: login fictício, abertura, pizza de dois sabores pela média, pagamento dividido Pix/dinheiro com troco, venda concluída e histórico, cancelamento e fechamento conferido. Nenhuma venda de produção foi criada.

## Permissões e validação

`pdv.ver`, `pdv.vender`, `pdv.operar`, `pdv.entrega`, `pdv.caixa`, `pdv.desconto`, `pdv.cancelar`, `pdv.configurar`. O diretor já tem `*`; nenhum outro perfil recebe permissões automaticamente. Autorizações são aplicadas no servidor em cada ação. Permissão de avançar pedidos não concede permissão de cancelar vendas ou consultar endereços.

Schema em `prisma/schema/pdv.prisma`, migração aditiva em `prisma/schema/migrations`. Produção usa somente `prisma migrate deploy`. Nunca use banco de produção em testes. Antes de publicar: `npm run check`, `npm run build` e integração PDV em PostgreSQL local exclusivo com `_test` no nome.
