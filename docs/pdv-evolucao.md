# Sequência de evolução do PDV

Plano iniciado em 27/10/2026. O objetivo é fechar primeiro o atendimento de balcão e retirada, depois a produção e a gestão, mantendo as mesmas fichas, unidades, sessão e permissões do Tetteo.

## Ordem e critérios de entrega

1. **Preparar a operação.** Diagnosticar produtos sem preço/receita, complementos, insumos indisponíveis, locais e saldos. Cada pendência deve apontar onde corrigir, sem inventar preços, receitas ou estoque. O diagnóstico deve diferenciar configuração, saldo e avisos; a venda continua fazendo a verificação definitiva.
2. **Guardar atendimentos.** Salvar, listar, retomar e descartar carrinhos por operador e unidade; não reservar estoque nem registrar pagamentos. Revalidar catálogo e preços ao retomar. Resolver concorrência de abas e consumir o rascunho na mesma transação da venda.
3. **Encaminhar para a cozinha.** Separar venda/pagamento do estado de produção; criar fila recebido → em preparo → pronto → entregue, tempos, responsáveis e atualização entre dispositivos. Definir setores e como cancelamentos aparecem na produção.
4. **Imprimir e reimprimir.** Gerar pedido para cozinha e comprovante não fiscal com identificação, itens, opções, observações, valores e operador. Registrar reimpressão; impressão pelo navegador primeiro, configuração de impressoras e roteamento por setor depois.
5. **Integrar a gestão.** Publicar fatos de venda/cancelamento com idempotência e definir consumidores em Financeiro, Analytics e CRM, sem imports entre módulos. Distinguir dinheiro recebido, cartão/Pix registrados e liquidação real para evitar dupla contagem com Saipos.
6. **Tratar exceções.** Devolução parcial, troca e devolução após caixa fechado, com estoque e compensações financeiras auditadas. Preservar o fechamento original; nunca reescrever o passado.
7. **Ampliar consultas.** Paginação, filtros por período/operador/forma de pagamento, exportação e busca de clientes no servidor. Totais devem considerar todo o filtro, não somente a página exibida.
8. **Ampliar a operação.** Delivery com endereço, áreas/frete, despacho e entregador; depois terminais/caixas independentes por unidade e permissões de supervisão.
9. **Adicionar integrações adiadas.** Emissão fiscal, adquirentes/Pix com confirmação automática e contingência offline somente com contratos, regras e testes próprios.

## Entrega iniciada

As etapas 1 e 2 foram implementadas nesta entrega. As etapas seguintes permanecem planejadas; não estão implementadas por este plano.

- Preparação em `/pdv/preparacao`, acessível a quem tem `pdv.ver` e `pdv.configurar`.
- Atendimentos salvos na frente de caixa; cada operador vê somente os próprios na unidade ativa.
- Salvamento explícito: o usuário escolhe “Salvar atendimento” antes de sair ou atender outra pessoa. Itens ainda não salvos continuam em memória. Nenhum dado de pagamento é guardado no rascunho.
- Dados reais do catálogo e os saldos precisam ser fornecidos/conferidos pelo responsável pela loja. O sistema oferece diagnóstico, sem copiar receitas ou deduzir quantidades a partir da referência visual.

## Validação e publicação por etapa

Cada incremento precisa de testes das regras afetadas, integração em PostgreSQL local exclusivo de teste, navegação Playwright com dados fictícios, `npm run check` e `npm run build`. Migrações devem ser aditivas e aplicadas em produção somente pelo `prisma migrate deploy` do deploy normal. Fazer commit apenas dos arquivos da tarefa, enviar sem força para a `main` configurada no Dokploy e confirmar o deploy antes de informar disponibilidade.

### Resultados das regras de preparação e carrinhos

- `npm run check` aprovado com 624 testes; sem erros de tipos, lint ou formatação. Os cinco avisos de lint do CRM já existiam antes desta entrega.
- `npm run build` aprovado, incluindo a rota de preparação. Permanecem os avisos preexistentes de rastreamento de arquivos em `server/arquivos.ts`.
- Playwright: preparação em tela móvel de 390×844 sem rolagem horizontal, filtros, busca e local inválido; salvamento, recarga da página, retomada e conclusão de venda fictícia, com retirada do atendimento da lista. Link interno recusado pelo operador preservou o carrinho.

- Os sete testes unitários de preparação passaram: preço e situação do produto, códigos opcionais, grupos inválidos isolados, receita pelos sabores, conversões e ciclos, além da distinção entre cadastro, saldo e avisos.
- A integração de preparação passou em PostgreSQL local com dados fictícios: isolamento de organização/unidade, permissão administrativa, rejeição de local inativo ou alheio, diagnóstico por produto e ausência de escritas nos cadastros.
- A integração de carrinhos passou no mesmo ambiente: isolamento por operador/unidade, revalidação do catálogo, versões e repetição de salvamentos, limite de rascunhos e conclusão única com duas chaves concorrentes. Uma disputa adicional entre salvar e concluir a mesma versão confirmou somente uma operação, preservando o estoque quando a conclusão foi recusada.

Esses resultados validam as regras testadas; não garantem saldo para todas as combinações de complementos nem substituem a conferência definitiva na venda. Os dados usados foram fictícios, em banco local exclusivo `_test`; nenhuma dessas verificações acessou produção.
