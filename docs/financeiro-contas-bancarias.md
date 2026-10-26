# Contas bancárias — fase 2

Fonte: [Cada Real no Seu Lugar](https://portal.kairulabs.com.br/v3/comunidade/e3ac0d53-6fee-4acb-93f5-388890e292d0),
de Fill, Empada da Casa, consultado pelo MCP Kairu. A fase 2 foi aprovada pelo
usuário. Esta implementação usa o módulo Financeiro da base de produção,
Next.js na raiz; a árvore antiga com frontend/backend não é publicada.

## Uso

Abra `/financeiro/contas`. Cadastre os três CNPJs reais em **Empresas da
operação**; selecione o regime atual, inclusive Lucro Presumido com retorno ao
Simples em andamento quando aplicável. Somente um cadastro pode estar marcado
como emissor das notas na operação Saipos. Nome, regime, situação e emissor são
editáveis; o CNPJ identifica o histórico e permanece fixo.

Selecione uma empresa e cadastre Santander, PagBank, Cappta, contas pessoais
usadas pela loja ou o caixa físico. Informe nome, banco, agência, número, tipo,
titular, saldo e data de abertura, cor e situação. Nomes iguais são permitidos
em CNPJs diferentes. Os seletores usados nas baixas exibem também a empresa,
para evitar escolher uma conta homônima. Conforme confirmação do usuário,
contas PF têm a mesma visibilidade das PJ para quem possui `financeiro.ver`.

O saldo de abertura representa o início do dia informado, no fuso da unidade.
Para implantar com o extrato do fechamento de domingo, informe esse saldo e
a data de segunda. As baixas de segunda entram; as anteriores ficam fora.
Valores e contas reais não são preenchidos com suposições.

**Transferir entre contas** registra origem, destino, data, valor e descrição.
As duas contas devem pertencer ao mesmo CNPJ e estar ativas. A transferência
aparece nos dois extratos e não cria receita/despesa no DRE. A mesma solicitação
repetida não duplica o movimento. Quem transfere ou estorna precisa de
`financeiro.lancar` e `financeiro.quitar`; o resultado continua exigindo sua
permissão própria.

Clique em uma conta para abrir o extrato, filtrar o período e conferir abertura,
movimentos e fechamento dos dias com movimento. Até 366 dias e 1.000 movimentos:
um período maior pede filtro menor, sem truncar os valores silenciosamente.
Uma transferência incorreta recebe um estorno de mesmo valor e pernas
invertidas, com motivo e data. O original continua no histórico. Há no máximo
um estorno por transferência.

## Repasse entre CNPJs

Cada empresa recebe uma conta **Compensação**, com abertura zero, e duas
categorias identificadas pelo CNPJ para a ponta a pagar e a ponta a receber.
As categorias têm `entraDre=false`, inclusive nas consultas do resultado.
Não se aceita uma transferência direta entre empresas diferentes.

A fase 3 do prompt é responsável por completar os títulos por empresa,
baixas parciais, juros e descontos. A fase 2 prepara a compensação; não cria
repasses automáticos nem altera títulos antigos em massa.

## Dados e compatibilidade

- Reutiliza `ContaFinanceira`, `Lancamento`, Auth.js, permissões, auditoria e
  escopo por organização/unidade. Não há um segundo financeiro paralelo.
- Novos saldos de abertura e transferências persistem centavos inteiros em
  `BigInt`. O cálculo usa `bigint`; valores decimais legados são convertidos
  exatamente na leitura. Conversão para número ocorre na apresentação e na
  interface já existente da projeção.
- A coluna decimal de abertura é mantida para compatibilidade e validada pelo
  banco contra os centavos. Não existe saldo atual editável.
- Cadastros antigos continuam sem empresa e sem corte retroativo até revisão.
  Vincular um CNPJ preserva seu saldo e suas baixas históricas. A migração não
  reescreve esses registros.
- O saldo atual inclui baixas quitadas até o instante da consulta e as duas
  pernas das transferências até o dia da unidade. Contas inativas continuam
  contribuindo com seu saldo. Baixas sem banco permanecem explicitadas na visão
  do caixa, fora dos saldos individuais.
- O primeiro movimento protege abertura, CNPJ e identidade bancária. Nome,
  cor e situação continuam editáveis com controle de versão.
- Transações serializáveis, chaves únicas, vínculos compostos e gatilhos
  protegem concorrência, escopo, estorno e imutabilidade. Auditoria participa
  da mesma transação da escrita.
- A sessão descarta permissões de outra organização e acessos a unidades
  inativas/excluídas, tanto no navegador como em tarefas de fundo.

Diagrama: [fluxo bancário](financeiro-contas-bancarias.excalidraw).
Revisão: [modelo de ameaças](financeiro-contas-bancarias-threat-model.md).

## Validação e publicação

Execute `npm run check` e `npm run build`. Os testes puros estão em
`src/modules/financeiro/schemas/bancos.test.ts` e
`src/core/sessao/escopo-acessos.test.ts`. O teste com PostgreSQL está em
`src/modules/financeiro/services/bancos.integracao.ts` e usa as travas de
`scripts/ambiente-de-teste.ts`: somente banco local com nome contendo
`_test`.

A migração `20261026045345_contas_bancarias` foi validada sobre um banco
descartável construído com o schema anterior, com histórico anterior marcado
como aplicado e uma conta existente de valor conhecido. `prisma migrate deploy`
aplicou somente a migração nova e preservou valor e vínculo nulo dessa conta.
Isso evita reescrever o histórico de migrações, cuja reconstrução vazia tem a
limitação já documentada em `docs/unificacao-crm.md`.

Produção usa somente `prisma migrate deploy`, já executado pelo contêiner
do Dokploy. Nenhum teste acessa o banco publicado. Cadastro bancário não conecta
APIs, não paga boletos/PIX e não realiza conciliação de extrato. Essas integrações
pertencem às fases posteriores; emissão de boletos não integra a operação
solicitada pelo usuário.
