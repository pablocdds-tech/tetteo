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

## Atualização diária

O hook instrumentation do Next.js inicia o relógio no processo Node.
Verifica uma vez por minuto, roda às 05h15 de America/Sao_Paulo e recupera
uma execução perdida ao voltar mais tarde no mesmo dia. Não depende do Codex,
de agendamento no chat nem de computador ligado. O backend/VPS precisa estar ativo.

Carga inicial: desde 30 dias atrás, por shift_date, mais updated_at do mesmo
intervalo. Incremental: updated_at desde o cursor com sobreposição de dois dias.
Reconciliação: últimos três dias de shift_date para atraso D+1.

Cursor e vendas são gravados na mesma transação. Cancelamentos atualizam a
mesma chave organizacaoId+unidadeId+vendaExternaId e deixam de compor os totais.
Versões anteriores não sobrescrevem versões mais recentes. Um lease de 45 minutos
e fencing transacional impedem dois workers de gravar a mesma execução.
Uma falha não avança cursor e preserva os dados anteriores.

Há uma tentativa automática por dia, com até três tentativas HTTP para falhas
de rede/5xx. 401/403 não repetem. 429 interrompe e pede aguardar ao menos cinco
minutos. Uma primeira carga vazia é tratada como não validada, pois 200 vazio
também pode indicar loja cancelada. Não se apresenta ausência como sucesso.

Para repetir manualmente, o diretor escolhe Matriz em Analytics > Vendas e
aciona Solicitar atualização do Saipos. A Server Action valida sessão, papel,
permissão analytics.ver e unidade visível; audita a solicitação e a guarda no
banco. A rodada seguinte a processa sem depender da duração da requisição web.
Repetir um pedido pendente não cria outra execução. Recarregue a tela para conferir.

Em caso de queda, o lease expira; a tentativa diária continua no dia seguinte,
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
diferença R$ 0,00. Esse resultado ainda precisa ser conferido depois da
importação no banco desta versão da produção.

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

O limite conservador é uma requisição a cada 700ms, páginas de 300, janelas de
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
