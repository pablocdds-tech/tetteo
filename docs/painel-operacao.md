# Painel da operação

O início reúne decisões da unidade ativa. No desktop, as prioridades dos
checklists ficam à esquerda e os pedidos e vendas à direita; no celular,
os blocos seguem essa ordem em uma coluna. A extensão usa os componentes,
a fonte do sistema e os tokens Aurora existentes.

## Uso

- **Prioridades:** mostra até seis pendências abertas na ordem de urgência
  do módulo. Os filtros Todas, Atrasadas e Sem responsável preservam essa
  ordem. Selecione uma linha para consultar descrição, responsável, prazo e
  origem; atribuição e resolução continuam na fila de pendências.
- **Pedidos e faturamento:** os indicadores abrem os relatórios do PDV.
  Gerenciar pedidos e as referências dos pedidos em andamento abrem a gestão
  do PDV; a execução das ações continua nesse módulo.
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
visível, com horário da última consulta e botão Atualizar. Esse intervalo não
comprova a atualização de uma integração externa nem oferece uma leitura ao
vivo do Saipos.

Vendas Saipos aparecem em bloco separado, com os sete dias encerrados anteriores
a hoje. Esses valores não são somados ao faturamento do PDV.

O seletor **7, 30 ou 90 dias** controla somente contas e projeção de caixa,
a partir de hoje. Ele não altera a janela dos pedidos e vendas. Contas do
período incluem vencimentos até o fim selecionado, inclusive datas anteriores;
os indicadores de ação distinguem abertas vencidas de abertas a vencer.

## Permissões e limites

Prioridades exigem `checklists.ver`; pedidos e faturamento exigem `pdv.ver`;
contas exigem `financeiro.ver`; o bloco Saipos exige `analytics.ver`. Saldo e
projeção permanecem restritos ao diretor. A seleção de uma unidade é obrigatória
para os blocos operacionais e financeiros, e as consultas preservam o escopo da
organização e da unidade no servidor.

O painel financeiro exibe até 300 contas e avisa quando esse limite é atingido.
Os indicadores calculados dessas contas e sua exportação não substituem a
consulta completa do Financeiro. O resumo de pedidos é uma leitura: consultar
ou atualizar o bloco não processa recebimentos nem avança pedidos agendados.

Esta nota descreve a extensão operacional atual. As regras visuais gerais
continuam em [DESIGN.md](../DESIGN.md); a avaliação de acesso a dados está em
[Modelo de ameaças do painel](painel-operacao-threat-model.md).
