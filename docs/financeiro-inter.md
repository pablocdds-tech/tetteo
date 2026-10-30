# Financeiro integrado e Banco Inter

O financeiro anterior foi substituído na navegação por lançamentos unificados,
pessoas, plano de contas, centros de custo, empresas/contas, transferências e
conciliação Inter. As rotas antigas redirecionam para os novos fluxos. A API da
auditoria anterior responde 410. Tabelas, migrações e evidências históricas não
são apagadas. A entrada de notas de Compras continua criando as obrigações
existentes, que podem ser revisadas no novo financeiro.

Referência: [material de Daniel Garcia na Kairu](https://portal.kairulabs.com.br/v3/comunidade/59131d47-7b78-423d-b5d5-33af688142d3),
lido pelo MCP. As três imagens anexas exigiram autenticação e não foram
visualizadas; a interface usa a descrição do material e os tokens Aurora do
Tetteo. Nenhum resultado foi publicado na Kairu.

## Adaptações ao projeto

- Mantidos Next.js 16, React 19, Prisma **7**, Auth.js 5 e PostgreSQL. Não há novo
  login, banco ou serviço de backend em produção.
- `Unidade` continua sendo a fronteira física e de autorização. Empresas com
  CNPJ e contas existentes são reaproveitadas. Vários CNPJs/contas podem operar
  na mesma unidade; operações entre unidades exigem trocar o seletor. Não há
  mudança automática de unidade para forçar uma conciliação.
- O plano hierárquico estende `CategoriaFinanceira`. Pessoas financeiras unificam
  clientes/fornecedores nesse cadastro, com documento, plano e operação padrão.
  Os cadastros comerciais de Compras/CRM continuam preservados. Lançamentos
  antigos ainda mostram o fornecedor original; novos usam Pessoas.
- A migração `20261030223000_financeiro_inter` é aditiva e transacional. Preenche
  competência com o vencimento antigo, vincula CNPJ pela conta quando conhecido
  e converte pagamentos históricos com conta em baixas detalhadas. Cadastros
  sem CNPJ conhecido exigem revisão humana antes de uma baixa nova.
- Dinheiro é calculado em centavos inteiros e persistido como Decimal. A baixa
  pode ser parcial; excesso é recusado. Edição concorrente usa versão e as
  escritas usam transações serializáveis com repetição limitada.
- `composeDre` e `CategoriaFinanceira.entraDre` controlam o resultado. Baixas de
  lançamentos excluídos continuam no fluxo. O resumo por competência não
  recalcula CMV nem constitui DRE contábil completa. Relatórios detalhados
  permanecem fora desta entrega, conforme o escopo detalhado do material.
- Diretor (`*`) é o master: sincroniza, vê restritos, estorna e executa ações
  em massa. `financeiro.*` sozinho não concede esses privilégios. Operadores
  usam `financeiro.ver`, `financeiro.lancar` e `financeiro.quitar`. A lista,
  busca, detalhe, baixa e painel inicial ocultam lançamentos restritos. O saldo
  bancário consolidado fica restrito ao diretor para não revelar pagamentos
  sensíveis por diferença de valores.
- Novas tabelas têm RLS por organização/unidade. Escopo e referências são
  validados também pelo servidor. Toda escrita é auditada. Exclusão de
  pendências é lógica: o identificador permanece para impedir reaparecimento.
- Pessoas aceitam documentos PDF/JPG/PNG/WebP de até 5 MB, guardados em
  `ARQUIVOS_DIR`, com download autenticado.

## Pré-requisitos e configuração privada

1. PostgreSQL e volume de arquivos já usados pelo projeto; domínio HTTPS.
2. Em **Financeiro → Empresas e contas**, confirme a unidade, cadastre/revise a
   empresa com CNPJ válido e vincule uma conta bancária a esse CNPJ.
3. No Internet Banking Inter Empresas, crie e ative uma integração com escopo
   **extrato.read**. Use o certificado e a chave da aplicação fornecidos pelo
   Inter. Não é necessário comprar um certificado A1 apenas por causa deste
   código; siga os requisitos vigentes do banco.
4. Configure no host, sem enviar pela conversa ou versionar:

   ```text
   INTER_CENTRO_CLIENT_ID
   INTER_CENTRO_CLIENT_SECRET
   INTER_CENTRO_CERT
   INTER_CENTRO_KEY
   ```

   `CENTRO` é um exemplo: substitua pelo identificador da integração. Os campos
   CERT/KEY são PEM privados; aspas externas e quebras `\n` literais são
   normalizadas no servidor. As credenciais nunca vão para o navegador.

5. Em **Integrações bancárias**, escolha empresa, conta, identificador e
   ambiente. Comece com **sandbox** e seu próprio par de credenciais de teste.
   Ambiente e vínculos são imutáveis depois do cadastro, para preservar a
   identidade das transações. Produção exige um cadastro com as credenciais
   correspondentes.
6. Use **Testar conexão**, que consulta o saldo. Depois, **Sincronizar agora**.
   Sincronizar pode dar baixa nos lançamentos compatíveis já cadastrados, mas
   não efetua pagamentos no banco.

O endpoint de consulta manual é `POST /api/inter/sincronizar?id=<integração>`;
o teste usa `POST /api/inter/teste?id=<integração>`. Ambos exigem sessão de diretor,
unidade ativa, permissão de baixa e origem da aplicação. Não há tarefa noturna
instalada nem webhook: o agendamento pode ser definido posteriormente.

## Contrato bancário consultado

[Documentação oficial Banking](https://developers.inter.co/references/banking#tag/Extrato),
consultada em 30/10/2026: OAuth2/mTLS; `/oauth/v2/token`,
`/banking/v2/saldo` e `/banking/v2/extrato/completo`. O contrato enriquecido usa
`dataTransacao`, `totalPaginas` e `detalhes`. O conector reconhece também os
campos de compatibilidade descritos no material.

Cada consulta tem prazo máximo de 30 s. A paginação tradicional usa 1.000 itens
por página, limite de 10.000 transações e intervalo entre páginas compatível com
dez chamadas/minuto. Extratos maiores ou com IDs repetidos falham sem iniciar
as baixas daquela consulta. O extrato completo é obtido antes do processamento;
se houver falha depois, a próxima execução retoma sem duplicar o que concluiu.
Não há transporte de pagamentos, emissão de boletos ou Pix cobrança.

Janela padrão: sete datas UTC, incluindo hoje. O ID usa o identificador Inter
quando disponível, com namespace da integração; o fallback é um hash estável.
Documentos da própria empresa são descartados. Documento conhecido divergente
fica pendente, mesmo quando o valor é único. Candidatos exigem empresa, unidade,
direção, saldo em centavos e vencimento em ±5 dias; depois há desempate por
documento e data exata. Sem resposta única, não há baixa automática.

## Roteiro de teste humano

Use dados fictícios e sandbox, sem inserir registros de teste no banco de produção.

1. Cadastre plano de despesa, pessoa com documento e plano/operação padrão.
2. Crie lançamento de R$ 500,00. Escolher a pessoa deve preencher o plano e a
   operação. Registre baixa manual de R$ 200,00: saldo deve ficar R$ 300,00.
3. Tente pagar mais que o saldo: deve recusar. Complete os R$ 300,00 e confira
   situação baixada, conta, data e histórico.
4. Como diretor, marque outro lançamento como restrito. Como operador, ele não
   deve aparecer nem pela busca ou endereço direto.
5. Teste a conexão sandbox. Registre lançamentos compatíveis com as transações
   fictícias disponibilizadas pelo banco e sincronize duas vezes. A segunda
   execução não pode duplicar baixas.
6. Confira os casos de documento diferente, dois candidatos idênticos e ausência
   de lançamento: devem permanecer pendentes. Depois de criar a obrigação,
   reavalie ou vincule manualmente. Confirme a mesma empresa/direção.
7. Desmarque “Compõe o resultado” em um lançamento sem baixas e pague-o: o
   resultado deve excluí-lo, enquanto o fluxo deve manter o pagamento.

Depois do relato do usuário, preparar um comentário fiel ao teste para revisão.
Somente publicar no material Kairu com `kind=test` após autorização explícita.

## Validação desta implementação

- Testes unitários do matcher e mapeamento do contrato Inter.
- Integração em PostgreSQL local exclusivo: concorrência, idempotência, baixas
  parciais, ambiguidade, reavaliação, restritos, isolamento, estorno e RLS com
  papel sem bypass. A URL usa `DATABASE_URL_TESTE`, localhost e nome `_test`.
- Ensaio da migração sobre um registro do schema anterior: lançamento, conta,
  valor e pagamento preservados, com criação de baixa histórica.
- Fluxo no Chromium local: cadastro de pessoa, preenchimento de plano, novo
  lançamento e baixa parcial. Sem erros de JavaScript ou rolagem horizontal
  da página em 390 px; a tabela possui sua própria rolagem.

Não foi realizado teste autenticado contra o Inter real: faltam as credenciais
privadas. Resultados do autor do material não são resultados desta implementação.
