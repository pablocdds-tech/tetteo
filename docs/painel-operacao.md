# Painel da operação

O início reúne decisões da unidade ativa. No desktop, as prioridades dos
checklists ficam à esquerda e os pedidos e vendas à direita; no celular,
os blocos seguem essa ordem em uma coluna. A extensão usa os componentes,
a fonte do sistema e os tokens Aurora existentes.

O monitor do assistente privado OpenClaw fica em **Configurações › Integrações ›
OpenClaw**, em `/configuracoes/integracoes/openclaw`. O painel principal não
consulta nem exibe seus registros.

## Uso

- **Prioridades:** mostra até seis pendências abertas na ordem de urgência
  do módulo. Os filtros Todas, Atrasadas e Sem responsável preservam essa
  ordem. Selecione uma linha para consultar descrição, responsável, prazo e
  origem; atribuição e resolução continuam na fila de pendências.
- **Pedidos e faturamento:** reúne PDV Tetteo e Saipos hoje, com valores
  separados por origem. Os indicadores do PDV abrem seus relatórios; Gerenciar
  pedidos e as referências em andamento abrem a gestão do PDV. O bloco Saipos
  permite expandir até cinco vendas recentes e abrir o turno de hoje no Analytics.
- **Contas e caixa:** os indicadores de vencidas e a vencer abrem a lista
  financeira com o filtro correspondente. Busca e situação filtram as contas
  carregadas; a exportação leva essas mesmas linhas. Selecione uma conta para
  consultar o detalhe e abrir o lançamento no Financeiro.
- **Projeção do caixa:** consulte um dia pelo ponteiro ou pelo seletor,
  operável com as setas do teclado. A tabela equivalente permanece disponível.

## Períodos e fontes

Os números do PDV usam dias civis de Brasília. Hoje vai da meia-noite até a
consulta; os sete dias incluem hoje e os seis dias anteriores. Faturamento
considera somente vendas concluídas no PDV Tetteo, sem pendentes ou canceladas.
Pedidos importados sem venda do PDV não compõem esse faturamento; os pagamentos
continuam sendo consultados na origem. A quantidade de pedidos em sete dias
exclui cancelados e pode incluir pedidos importados registrados no PDV.

Pedidos ao vivo são os registros do PDV nas etapas Na cozinha, Prontos para
coleta e Em entrega. As referências exibem até cinco pedidos há mais tempo em
andamento. A consulta é atualizada a cada 30 segundos enquanto a aba está
visível, com horário da última consulta e botão Atualizar tela. Esse intervalo não
comprova a atualização de uma integração externa nem oferece uma leitura ao
vivo do Saipos.

**Saipos hoje** usa o turno da data atual em Brasília, limitado às vendas já
importadas e criadas até a consulta. O turno pode atravessar a meia-noite e,
portanto, difere do dia civil usado no PDV. O faturamento e a quantidade excluem
canceladas; estas são contadas separadamente. A lista expansível mostra até cinco
vendas mais recentes desse turno, inclusive canceladas identificadas, com código,
horário, canal e valor. Ela não informa a etapa atual de preparo ou entrega.

Os números aparecem como parciais: a API de Dados Saipos pode disponibilizar
vendas somente no dia seguinte (D+1). O horário **Última importação** corresponde
ao último sucesso do worker; **Consultado às** registra a leitura do painel no
Tetteo. Atualizar tela não solicita importação nem consulta diretamente a Saipos.
A cadência do worker permanece em 15 minutos; falhas temporárias aguardam pelo
menos 30 minutos e erros permanentes exigem intervenção, conforme
[a integração existente](saipos.md). Uma consulta bem-sucedida não comprova
completude na origem. Sem dados do turno nem importação bem-sucedida hoje, o
painel mostra ausência de informação; falta de vínculo e falha de importação
têm avisos próprios, preservando os dados anteriores.

O resumo Saipos dos sete dias encerrados anteriores a hoje continua separado.
Nenhum valor Saipos é somado ao faturamento do PDV, pois não há deduplicação
comprovada entre as fontes. Não foi habilitado novo webhook, ambiente de
produção da API de Pedidos nem acesso operacional em tempo real à Saipos.

O seletor **7, 30 ou 90 dias** controla somente contas e projeção de caixa,
a partir de hoje. Ele não altera a janela dos pedidos e vendas. Contas do
período incluem vencimentos até o fim selecionado, inclusive datas anteriores;
os indicadores de ação distinguem abertas vencidas de abertas a vencer.

## Permissões e limites

Prioridades exigem `checklists.ver`; o bloco PDV exige `pdv.ver`;
contas exigem `financeiro.ver`; os blocos Saipos exigem `analytics.ver`. Saldo e
projeção permanecem restritos ao diretor. A seleção de uma unidade é obrigatória
para os blocos operacionais e financeiros, e as consultas preservam o escopo da
organização e da unidade no servidor.

O painel financeiro exibe até 300 contas e avisa quando esse limite é atingido.
Os indicadores calculados dessas contas e sua exportação não substituem a
consulta completa do Financeiro. Os resumos operacionais são somente leitura:
consultar ou atualizar não processa recebimentos, avança pedidos agendados,
altera vendas ou checkpoints de importação. Saipos hoje revalida permissão,
unidade e organização ativas no servidor, e lê totais, vínculo e lista em uma
transação consistente. Dados de clientes, pagamentos, itens e histórico bruto
não são selecionados. Não há nova rota pública, variável de ambiente ou chamada
de rede ao fornecedor nesta extensão.

Esta nota descreve a extensão operacional atual. As regras visuais gerais
continuam em [DESIGN.md](../DESIGN.md); a avaliação de acesso a dados está em
[Modelo de ameaças do painel](painel-operacao-threat-model.md).
