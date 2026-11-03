# Revisão operacional de novembro de 2026

A primeira etapa corrige a integridade de estoque e dinheiro da aplicação
unificada. A referência é a `main` atual, preservando o CRM e os cadastros
existentes. Não houve exclusão de histórico, uso de banco de produção em testes
ou publicação de comentário no material Kairu.

## Comportamento implementado

| Área                     | Regra                                                                                                                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cancelamento do PDV      | O padrão mantém o consumo e registra perda. Ingredientes só retornam por escolha explícita, enquanto o pedido ainda não foi marcado pronto, saiu ou foi entregue. A receita usada é a fotografia da venda, mesmo se o cadastro mudou. |
| Recebimentos do PDV      | Configuração manual por unidade e forma, com empresa, conta, plano, taxa e prazo explícitos. Uma fila durável permite processar e reprocessar pagamentos mistos e recebimentos posteriores sem duplicar receitas.                     |
| Repetição de requisições | Cadastro de lançamento e sangria/suprimento exigem uma chave estável. Repetir a mesma operação retorna o registro anterior; reutilizar a chave com dados diferentes é recusado.                                                       |
| Inter sandbox            | Só simula correspondências. Não cria baixa nem pendência operacional; pendências antigas de sandbox também não podem baixar lançamentos.                                                                                              |
| Contagem de estoque      | Leitura, ajuste, fechamento e auditoria ficam na mesma transação. Fechamentos concorrentes não duplicam ajustes. Salvar a folha e fechar disputam a mesma trava; folha fechada não recebe alterações.                                 |
| Custo médio              | Como o cadastro de custo é compartilhado pela organização, a média pondera as posições de todas as suas unidades. Não é custo individual por loja.                                                                                    |
| CMV                      | As duas contagens precisam cobrir o mesmo local ou ambas a unidade inteira. Transferências internas entram e saem do cálculo do local sem virar consumo.                                                                              |
| Relatórios financeiros   | Indicadores e tabela usam o mesmo filtro. Resultado usa competência; fluxo usa a data dos pagamentos. Os saldos das contas mantêm a visão completa dos movimentos autorizados.                                                        |
| Consulta financeira      | Baixas são agrupadas no banco por conta, data e direção, evitando transportar cada pagamento histórico para renderizar uma página.                                                                                                    |
| Verificação contínua     | O CI passa a executar toda a suíte de integração em PostgreSQL local, além dos tipos, lint, formatação, testes unitários, ensaio de migrações e build.                                                                                |

Cancelamentos antigos sem destino de estoque preservam a interpretação histórica
de devolução. Esta etapa não reescreve perdas nem pagamentos passados. Um pagamento
já recebido continua exigindo devolução manual ao cliente; cancelar no sistema
não faz Pix de saída nem estorno de cartão.

O estoque não identifica automaticamente se uma pizza já começou a ser feita.
Enquanto o pedido aparece na cozinha, devolver ingredientes exige a confirmação
operacional de que eles não foram usados. A contagem deve ser feita em uma janela
controlada: a transação protege o fechamento, mas não substitui um processo de
inventário físico durante horas de operação.

## Testes reproduzíveis

Use PostgreSQL exclusivo, em localhost, com `_test` no nome. O carregador de testes
recusa outros destinos e usa chaves descartáveis para os dados sintéticos.

```bash
DATABASE_URL=postgresql://usuario:senha@localhost:5432/tetteo_test npx prisma migrate deploy
DATABASE_URL_TESTE=postgresql://usuario:senha@localhost:5432/tetteo_test npm run test:integracao
npm run check
npm run build
npm audit --omit=dev
```

`src/app/integridade-operacional.integracao.ts` cobre reenvio concorrente de
lançamento e suprimento, troca de payload, simulação e pendência antiga de sandbox,
perda de produto pronto, devolução explícita antes do uso, fechamento duplicado,
edição concorrente com fechamento, isolamento organizacional, média em duas lojas,
CMV por local e transferência, filtros e datas de competência/pagamento.

Na homologação, reproduza estes fluxos na tela com dados fictícios:

1. Venda dois produtos, marque-os prontos e cancele. O saldo continua consumido,
   há perda e o pagamento precisa ser devolvido pelo operador.
2. Cancele uma venda antes do preparo escolhendo devolver ingredientes. O saldo
   retorna ao valor anterior uma vez.
3. Salve um lançamento e confira a mensagem de sucesso, os filtros e os totais.
   Se a atualização da lista falhar após salvar, a tela informa que a operação
   foi gravada, evitando manter o formulário aberto para um novo cadastro.
4. Em uma integração sandbox, o botão deve indicar simulação. A confirmação e
   a resposta deixam explícita a ausência de baixas e pendências operacionais.
5. Abra a mesma folha em duas sessões. Feche uma e tente salvar/fechar a outra:
   o ajuste não se repete e a folha permanece fechada.

Os resultados locais não comprovam autenticação real com o Inter, emissão fiscal,
conciliação bancária real nem uso operacional pelo restaurante.

## Validação local executada

- 716 testes unitários e 238 testes de integração aprovados, preservando as
  mudanças recentes do atendimento na `main`.
- 16 regressões de integridade também executadas isoladamente, incluindo a
  separação entre competência da venda e data do recebimento posterior.
- Chromium autenticado no banco local: rascunho, configuração de Pix, simulação
  do Inter, processamento manual e tela em 390 px sem rolagem horizontal.
- Cancelamento de pedido pronto pela tela manteve a posição em 8 de 10 unidades,
  com destino `PERDA`.
- Falha simulada na recarga da lista após salvar um lançamento: a tela informou
  que a operação foi gravada, fechou o formulário e uma obrigação permaneceu.
- `npm audit --omit=dev` sem vulnerabilidades reportadas. Dependências de
  desenvolvimento ainda possuem avisos moderados; essa verificação não afirma
  ausência de vulnerabilidades no sistema inteiro.

## Configuração manual dos recebimentos do PDV

Abra **Financeiro → Recebimentos do PDV** como diretor. O endereço é
`/financeiro/recebimentos-pdv`. Primeiro cadastre empresas, contas e plano de
receita. Para cada forma, informe o destino, a taxa (inclusive zero) e o prazo
em dias corridos. Rascunhos podem ser salvos desativados e incompletos.

O botão **Processar recebimentos** integra lotes de até 50 eventos da unidade,
priorizando os menos tentados para que uma pendência antiga não bloqueie os novos.
Não há agendamento automático desta fila nesta etapa. A fila começa com os novos
recebimentos após esta implantação; vendas antigas não são importadas em massa.
Se uma forma de pagamento da venda não estiver configurada, a venda inteira
aguarda: não fica com apenas uma parte importada.

Cartões geram contas a receber abertas pelo valor bruto, com a taxa como desconto
e o vencimento no prazo informado. A competência usa a data da venda; o prazo
parte da data do recebimento no fuso da unidade. O crédito bancário precisa ser conferido na
conciliação ou por baixa manual. Dinheiro e Pix também ficam abertos por padrão;
o diretor pode escolher a baixa na data confirmada no PDV, com prazo zero.
Troco não é receita. Cada lançamento preserva a regra usada na integração; uma
mudança posterior não reescreve o histórico. Essa configuração simples não cobre
bandeiras, adquirentes, parcelas nem calendários de dias úteis.

Cancelar uma venda cancela os recebíveis abertos vinculados. Se já houver baixa,
a fila pede conferência da devolução e estorno explícito antes de concluir.
O sistema não faz devoluções bancárias ou de cartão. Uma venda recebida e cancelada
antes do processamento não gera receita nova.

## Próximas entregas

| Prioridade           | Entrega                                                         | Critério de aceite                                                                                                                                               |
| -------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Alta                 | Homologar o mapeamento do PDV e automatizar a fila, se desejado | Cadastrar as contas reais na tela pronta, conferir taxas/prazos e comparar o lote com o caixa. A automação exige rotina agendada, monitoração e alerta de falha. |
| Alta                 | Homologar Inter real                                            | Credenciais privadas no servidor, aprovação bancária e conferência com extrato; sandbox não comprova esse fluxo.                                                 |
| Alta                 | Devolução após fechamento de caixa                              | Criar evento de devolução vinculado à venda, com permissão e auditoria; não alterar um fechamento encerrado.                                                     |
| Alta                 | Tornar o inventário físico resistente a operação prolongada     | Definir janela de corte, contagem por item e tratamento explícito das movimentações durante a contagem.                                                          |
| Média                | Cozinha por item e área de produção                             | Roteamento, início/pronto por item e complementos; manter estado agregado do pedido coerente.                                                                    |
| Média                | Custos por unidade, se essa for a política de gestão            | Migrar o custo compartilhado para uma estrutura por unidade e adaptar fichas, estoque, compras e relatórios juntos.                                              |
| Média                | Modularizar a tela e o serviço financeiro                       | Extrair lançamentos, cadastros, relatórios e conciliação sem alterar contratos nem contornar as permissões.                                                      |
| Média                | Desempenho com histórico grande                                 | Medir consultas e índices com volume representativo; paginação de pendências e transferências, filtros e agregações com plano de execução conferido.             |
| Definição de produto | Fiscal e contingência de conexão                                | Levantar regime/UF, documentos fiscais e equipamentos; definir o que o PDV poderá fazer sem rede e como sincronizar sem conflito.                                |

A operação da integração PDV → financeiro depende do mapeamento das contas e das regras reais
de recebimento na tela já disponível. Não se presume que cartão seja dinheiro disponível imediatamente,
nem se inventam taxas ou prazos. A publicação de um relato na Kairu depende do
relato real do usuário, apresentação prévia do comentário e autorização explícita.
