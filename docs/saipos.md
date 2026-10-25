# Vendas Saipos na Matriz

## Escopo

Implementação para o Business OS Next.js da branch main publicada na VPS.
A arquitetura antiga backend/frontend da outra pasta local não é compatível
com este banco e não deve ser publicada sobre ele.

Saipos é apenas consultado por GET. Nenhum dado é alterado no provedor.
Apenas vendas foram ligadas ao Analytics e ao relógio; financeiro e estoque
não entram no painel. O cliente mantém a consulta financeira validada e informa
a manutenção documentada do estoque, sem inventar resultados.

## Ativação

1. Obter backup do PostgreSQL e verificar restauração antes de publicar.
2. Publicar a branch revisada. O entrypoint existente executa migrate deploy.
   A migration adiciona saipos_vinculo, saipos_venda e índice composto em unidade;
   não altera dados financeiros, contas, permissões ou tabelas existentes.
3. Configurar privadamente SAIPOS_TOKEN, SAIPOS_STORE_ID e SAIPOS_UNIDADE_ID.
   Usar o ID exato da Matriz confirmado no banco. O valor do token não aparece
   em documentação, código, terminal ou screenshots. Token sem prefixo Bearer.
4. Definir SAIPOS_SYNC_ENABLED=true e reiniciar/reimplantar o serviço.
5. O relógio cria o vínculo auditado e faz a carga inicial em segundo plano.
   Se uma loja já estiver vinculada a outra unidade, a unicidade recusa a mudança.
6. Abrir Analytics > Vendas, selecionar Matriz e consultar o período conciliado.

O painel administrativo observado estava em HTTP e sem HTTPS configurado.
Antes de inserir o token, usar HTTPS administrativo ou um canal SSH protegido.
Não alterar credenciais ou abrir PostgreSQL para a internet para resolver isso.
O login e o token devem ser inseridos apenas em interface privada pelo operador.

## Atualização automática

O hook instrumentation do Next.js inicia o relógio no processo Node.
Verifica uma vez por minuto e roda a cada 15 minutos desde a última tentativa;
após falha aguarda 30 minutos. Recupera a execução ao voltar após uma queda. Não depende do Codex,
de agendamento no chat nem de computador ligado. O backend/VPS precisa estar ativo.

Carga inicial: desde 30 dias atrás, por shift_date, mais updated_at do mesmo
intervalo. Incremental: updated_at desde o cursor com sobreposição de dois dias.
Reconciliação: últimos três dias de shift_date para atraso D+1.

Cursor e vendas são gravados na mesma transação. Cancelamentos atualizam a
mesma chave organizacaoId+unidadeId+vendaExternaId e deixam de compor os totais.
Versões anteriores não sobrescrevem versões mais recentes. Um lease de 45 minutos
e fencing transacional impedem dois workers de gravar a mesma execução.
Uma falha não avança cursor e preserva os dados anteriores.

Há uma rodada automática por intervalo, com até três tentativas HTTP para falhas
de rede/5xx. 401/403 não repetem. 429 interrompe e pede aguardar ao menos cinco
minutos. Uma primeira carga vazia é tratada como não validada, pois 200 vazio
também pode indicar loja cancelada. Não se apresenta ausência como sucesso.

Para repetir manualmente, o diretor escolhe Matriz em Analytics > Vendas e
aciona Solicitar atualização do Saipos. A Server Action valida sessão, papel,
permissão analytics.ver e unidade visível; audita a solicitação e a guarda no
banco. A rodada seguinte a processa sem depender da duração da requisição web.
Repetir um pedido pendente não cria outra execução. A tela acompanha o resultado automaticamente.

Em caso de queda, o lease expira; a próxima rodada recupera a atualização,
ou o diretor solicita outra execução após a expiração. A integração não executa
em unidades desativadas, excluídas ou de organização inativa.

## Dashboard e conciliação

Analytics > Vendas mostra faturamento, vendas não canceladas, ticket médio,
cancelamentos e totais por data de turno. O painel inicial mostra sete dias
completos anteriores, com link para o detalhamento. Valores são somados em centavos.
O timestamp de criação preserva a hora real; o turno pode ser do dia anterior.
Não se importa cadastro de cliente, contato, endereço nem observações.

Somente pessoas já autorizadas em analytics.ver veem os dados; nenhuma permissão
nova foi concedida. Consultas incluem organização e unidades visíveis. Chaves
estrangeiras compostas também recusam vínculos entre organizações diferentes.

Quando falta cobertura do período, os indicadores mostram ausência de dado.
Tabela parcial é identificada como parcial. Não há comparação inventada com
histórico anterior à carga. A tela informa cobertura, último sucesso e erro.
Isso não equivale ao saldo do caixa ou ao total recebido em meios de pagamento.

Ensaio autorizado anterior: 17 a 23/10/2026, 711 vendas não canceladas,
11 canceladas, R$ 50.419,29. O usuário informou o mesmo total no relatório,
diferença R$ 0,00. A carga em produção e uma atualização incremental posterior
confirmaram o mesmo total, com 3.057 identificadores únicos sem duplicação.

## Verificação

- npm ci
- npx prisma generate
- npx next typegen
- npm run check
- npm run build

Os testes HTTP usam transporte controlado para falhas e limites; não inventam
um ensaio real. O teste de persistência valida o protocolo com repositório isolado.
A migration também foi aplicada em PostgreSQL embarcado isolado, verificando
FK de organização, unicidade e rollback de cursor. Isso não substitui backup,
restauração e conferência da carga na VPS.

O teto escolhido pelo operador é 8.500 requisições por janela móvel de um minuto,
com espaçamento mínimo de 7ms e orçamento móvel limitando o total, páginas de 1.000, janelas de
15 dias e no máximo 1000 páginas por janela. Em vários processos/consumidores
no mesmo IP, manter um worker único ou um limitador distribuído por IP.
Atualizações atrasadas além da sobreposição exigem reconciliação adicional.

Fontes oficiais consultadas ao vivo:

- https://saipos-data-api.readme.io/reference/consultar-vendas
- https://saipos-data-api.readme.io/reference/consultar-lancamentos-financeiros
- https://saipos-data-api.readme.io/reference/movimentacao-de-estoque
- https://saipos-data-api.readme.io/reference/funcionamento-filtros-consultas
- https://saipos-data-api.readme.io/reference/limite-consultas
- https://saipos-data-api.readme.io/reference/duvidas-frequentes

## Painel Bento da Matriz — 25/10/2026

O painel completo abre no dia atual (Brasília), marcado como parcial, com atalhos
Hoje, Ontem e últimos sete dias completos. Períodos explícitos continuam disponíveis.
O resumo da Home mantém os sete dias completos. Faturamento e ticket excluem
canceladas; valores permanecem em centavos. A série de 24 horas usa a hora de
criação em Brasília das vendas pertencentes ao turno final selecionado, inclusive
vendas após meia-noite vinculadas ao turno anterior. A tabela textual oferece os
mesmos valores do gráfico. A comparação desloca o período sete dias; hoje limita a
base anterior ao mesmo horário. Sem cobertura ou base positiva não há percentual.

A tela consulta novamente o Tetteo a cada minuto enquanto visível, online e sem
edição de filtros. Há botão de pausa e aviso offline. Isso não chama o Saipos no
navegador. O worker consulta a origem a cada 15 minutos desde a última tentativa;
após falha espera pelo menos 30 minutos antes da próxima rodada agendada. Falhas permanentes de acesso ou contrato suspendem as rodadas automáticas até
correção e solicitação manual. Cada
requisição mantém o máximo de três tentativas, e 401/403/429 interrompem a rodada.
A concessão persistida e a reserva temporal evitam duplicação em réplicas. A opção
manual continua restrita ao diretor autorizado. Não há segredo nem novo endpoint
público no navegador. O cursor é confirmado junto com os registros na transação.

### Tempo real: resultado da pesquisa oficial

- API de Dados: admite atraso até D+1; consulta frequente não garante completude.
  https://saipos-data-api.readme.io/reference/duvidas-frequentes
- App de Gestão Saipos: o fornecedor anuncia acompanhamento de vendas, ticket,
  cancelamentos e operação em tempo real dentro do próprio aplicativo.
  https://saipos.com/sistema/app-de-gestao
- API de Logística: integração de parceiros de entrega, com credenciamento e
  homologação. Seus eventos de entrega não comprovam cobertura de todas as vendas
  de salão, balcão e delivery nem substituem uma API geral de vendas.
  https://saipos-api-logistica.readme.io/reference/introducao

Não foi encontrada nas fontes públicas consultadas uma API de eventos de todas as
vendas com garantia de tempo real e já autorizada para esta conta. Essa capacidade
não foi ativada nem simulada no Tetteo.

Pergunta pronta para o suporte (não enviada): “Precisamos consumir no Tetteo todas
as vendas da Matriz em tempo real, incluindo salão, balcão e delivery, com eventos
de criação, alteração e cancelamento. Existe API operacional, webhook ou stream
oficial disponível para nossa conta? Quais são a documentação, latência, cobertura,
requisitos de homologação e condições de acesso? A API de Dados atual admite D+1.”

Referência de composição: Kairu Bento, de autoria Kairu, obtida via MCP.
https://portal.kairulabs.com.br/v3/aprender/biblioteca/design-mosaico-bento
A marca e os tokens Aurora do Tetteo foram preservados.

## Dados recentes e divergência do relatório

Hoje e ontem exibem aviso destacado de total provisório junto ao faturamento.
A variação percentual de desempenho fica suspensa nesses períodos: uma importação
bem-sucedida confirma a gravação da resposta, não a completude da API na origem.
A janela de dois dias é conservadora; períodos mais antigos também não ganham
certificação automática de conciliação. Para afirmar fechamento, compare com o
relatório da mesma loja e turno. Não ajuste totais nem crie vendas para forçar
igualdade. O valor do relatório não é gravado como venda na integração.

## Revisão anterior de contrato e capacidade — 25/10/2026

Fontes oficiais consultadas novamente: a página Limites informa 500 requisições
por cinco minutos/IP; a FAQ informa 8.500/minuto/IP. Até confirmação formal do
fornecedor, o cliente usa o maior ritmo compatível com ambas: teto de 500 por
janela móvel e 600ms entre inícios. É teto de capacidade, não meta de gerar tráfego.
Os testes do limitador usam relógio simulado; não disparamos 500 chamadas reais.
A fila e o orçamento são compartilhados por instâncias/tokens/endpoints no mesmo
processo. O worker da Matriz é único pela concessão persistida no banco. Antes de
ativar outros consumidores/processos com o mesmo IP, centralizar o limitador por
IP: o cliente local não controla integrações de terceiros ou processos externos.

HTTP 429 interrompe a operação e bloqueia novos envios no processo por pelo menos
cinco minutos; Retry-After maior é respeitado em segundos ou data HTTP. O worker
persiste o erro e mantém intervalo mínimo de 30 minutos antes de outra rodada.
401/403 não são repetidos e exigem intervenção. Não há aumento automático para
8.500/minuto com base em respostas sem 429.

Páginas de 1.000 foram validadas com token privado real em 25/10/2026: vendas de
17–23/10 retornaram 722 registros (711 válidos, R$ 50.419,29); financeiro de 17/10
retornou 17 lançamentos, 13 com children, paid observado como string Y e campos
básicos com tipos esperados. O contrato Y/N também é validado para paid.
A consulta financeira pública do conector devolve apenas os campos operacionais
do lançamento principal, sem dados pessoais e sem agregar children; não é uma
DRE nem uma integração financeira com o dashboard. A prova de acesso financeiro
também passa a exigir id_store e os filtros financeiros válidos.

Vendas usam total_amount já composto: não há soma adicional de entrega, serviço,
descontos ou complementos. Itens e histórico não são consultados pela integração
atual; portanto, não se alega cobertura de escolhas, exclusões ou transferências
de itens. Um futuro consumidor de sales_items deverá validar o contrato real,
unit_price com adicionais e id_sale_to/id_sale_from antes de calcular agregados.
Estoque continua em manutenção e não é substituído por dados simulados.
Checkpoint de vendas continua transacional e separado do cursor financeiro.
As validações de calendário rejeitam datas impossíveis, preservando o turno.

Fontes de limites:

- https://saipos-data-api.readme.io/reference/limite-consultas
- https://saipos-data-api.readme.io/reference/duvidas-frequentes

## Teto atual escolhido pelo operador: 8.500/minuto

Por solicitação explícita, o teto passou para 8.500 chamadas por janela móvel de
60 segundos, conforme a FAQ. O espaçamento mínimo é 7ms; o orçamento da janela
impede a chamada 8.501, inclusive quando ainda caberia pelo espaçamento. Mantém-se
p_limit=1.000. O ritmo real depende da latência; não geramos tráfego artificial
para consumir a quota. A cadência de importação continua em 15 minutos.

A divergência com a página Limites (500/5 minutos/IP) permanece não resolvida.
Esta é uma escolha de configuração do operador, sem confirmação do fornecedor de
que o teto maior será aceito. HTTP 429 prevalece: interrompe a operação e bloqueia
novos envios por pelo menos CINCO minutos, independentemente da nova janela de
um minuto, respeitando Retry-After maior. Os testes garantem essa independência.
Continua a exigência de coordenação por IP antes de ativar outros consumidores.

## Conciliação e canais — Matriz

### Origem dos campos

Dados reais de 24/10/2026 consultados em 25/10 confirmaram 136 registros, 133
válidos, três cancelados e R$ 10.457,38, com última criação às 23:15:14.
O canal é partner_sale.desc_partner_sale: iFood, Cardápio Web ou ausência.
Não usar desc_store_partner: esse campo contém marca/loja do parceiro. Não usar
partner_delivery: o parceiro logístico não é a origem do pedido. Modalidade vem
de id_sale_type (1 entrega, 2 balcão, 3 salão, 4 ficha). Ausência vira Não informado.
São armazenados apenas esses campos operacionais, sem dados de clientes, marcas,
códigos de pedidos do parceiro ou informações de entregadores.

Exemplo agregado real, sem dados pessoais:

| Origem        | Válidas | Faturamento |
| ------------- | ------: | ----------: |
| iFood         |      56 | R$ 3.827,92 |
| Cardápio Web  |      37 | R$ 2.982,06 |
| Não informado |      40 | R$ 3.647,40 |

As duas tabelas são visões distintas do mesmo conjunto: origem e modalidade.
Cada uma deve somar ao faturamento importado, sem somar uma visão à outra.
Canceladas são contadas separadamente e não compõem receita ou participação.

### Histórico e checkpoints

A migração preserva os registros antigos, inicialmente identificados como ainda
sem detalhamento. A sincronização normal traz canal e modalidade dos registros
recentes; o complemento histórico processa no máximo sete dias por rodada.
SaiposVinculo.canaisAte é o checkpoint dessa operação, independente do cursor de
updated_at das vendas. Uma falha histórica preserva canaisAte e informa
ultimoErroCanais sem impedir a confirmação das vendas recentes já consultadas.
O preenchimento de metadados pode atualizar registros de mesma versão sem
sobrescrever seu valor financeiro; versões antigas continuam ignoradas. A
transação salva vendas, auditoria e ambos os checkpoints de forma atômica.

### Referências do relatório

A referência é informada pelo diretor autorizado para a unidade ativa. Não é um
valor extraído automaticamente do relatório Saipos. O usuário confirmou o uso dos
R$ 10.457,38 de 24/10 como primeira referência. Esse valor deve ser registrado pela
interface autenticada após a implantação; não é fixado no código nem em seed.

O servidor valida analytics.ver, papel diretor, unidade ativa visível, vínculo
ativo, período até hoje em Brasília e moeda em centavos. A FK composta recusa
outra organização. Existe uma referência por organização, unidade e período.
Correções incrementam versão com comparação otimista; conflitos pedem recarregar.
Referência e auditoria são gravadas em transação serializável. Uma falha da
auditoria cancela a alteração. Autor e momento aparecem na tela, sem e-mail.

Estados calculados em cada leitura: Sem referência; Cobertura incompleta;
Diferença a conferir; Bateu com a referência. O último exige igualdade EXATA em
centavos e cobertura do período. Não certifica completude na origem nem trava o
fechamento: venda ou cancelamento tardio pode reabrir a diferença. Valores,
referência e checkpoint são lidos em snapshot RepeatableRead consistente.
A visão de rede não compara um agregado com referência de uma unidade.

A atualização da tela pausa enquanto o formulário tem edição pendente, mesmo
fora do foco; erros preservam o valor. Somente o diretor vê o formulário, e o
servidor repete a autorização. Nenhum dado é alterado no Saipos.

Fluxo documentado em saipos-conferencia-canais.excalidraw.
