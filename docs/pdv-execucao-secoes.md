# Continuação das seções do PDV

## Autorização e escopo

Em 28/10/2026, o usuário autorizou continuar sem interrupções ou novas aprovações,
implementar as seções restantes, validar e publicar para revisão pela manhã.
Referência: painel de gestão do Cardápio Web, mantendo a marca Vitaliano e a
integração com o Tetteo. Produtos online; fiscal e operação offline continuam
adiados. A conta de referência é usada somente para leitura.

Base: `origin/main`, repositório Next.js em
`C:/Users/Lenovo/.codex/worktrees/crm-unificacao/tetteo`.
Branch de trabalho inicial: `codex/pdv-secoes-completas`.
Publicação: `main`, com deploy automático Dokploy. Registrar somente entregas
testadas e concluídas; não misturar alterações de outros chats.

## Sequência e critérios de conclusão

| Seção                           | Entrega esperada                                                                                                     | Estado                               |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Gestão de pedidos e novo pedido | Gestão unificada, listas/kanban, resumo e atendimento no padrão visual de referência                                 | Publicada em `83fe978`               |
| Caixa                           | Tabela, filtros, resumo, diálogos, histórico e impressão                                                             | Publicada em `6e0b261`               |
| Histórico de pedidos            | Barra de filtros compacta, tabela e detalhe coerentes com a referência, preservando consultas/exportação/recebimento | Publicada em `ed2b494`               |
| Catálogo                        | Navegação por categorias, produtos e complementos; configuração clara e conectada ao cadastro existente              | Publicada em `ed2b494`               |
| Áreas de entrega                | Listagem, busca, situação e cadastro/edição no mesmo padrão visual                                                   | Publicada em `ed2b494`               |
| Entregadores                    | Consulta, cadastro e edição no contexto do Delivery                                                                  | Publicada em `ed2b494`               |
| Clientes                        | Seção própria do PDV usando CRM e endereços existentes, sem duplicar cadastros                                       | Implementada; validação em andamento |
| Configurações                   | Central operacional clara e preparação da operação com controles realmente aplicados                                 | Implementada; validação em andamento |
| Cozinha                         | Tela operacional de preparo usando pedidos e estados reais, com foco nos itens e próximas ações                      | Implementada; validação em andamento |
| Desempenho                      | Visão de vendas e operação com período e números reais da unidade                                                    | Implementada; validação em andamento |
| Revisão final                   | Navegação entre seções, responsividade, permissões, testes, build e deploy confirmados                               | Pendente                             |

Esta sequência cobre a operação do PDV. Marketing, fidelidade, fiado, módulos
financeiros adicionais e integrações comerciais não são presumidos como parte
da reprodução visual. Recursos avançados sem implementação real devem ser
registrados como limitações, nunca exibidos como botões fictícios.

## Método

Inspecionar a seção da referência, definir a composição, implementar com os
serviços existentes, validar com dados fictícios locais e revisar capturas em
desktop/celular. Usar as skills frontend-design, Playwright e React; revisar
ameaças quando o acesso a dados ou as regras financeiras mudarem. Manter
autorização e isolamento por organização/unidade no servidor.

Executar `npm run check` e `npm run build`, além das integrações afetadas.
Somente depois fazer commit/push e confirmar o Dokploy. Atualizar esta tabela e
registrar o commit e a validação de cada lote. Não usar banco de produção nos
testes e não alterar pedidos, caixa ou configurações reais da referência.

## Continuidade

Continuação automática vinculada ao mesmo chat: `concluir-se-es-do-pdv`, a cada
30 minutos, enquanto houver seções pendentes. Deve ser desativada ao concluir o
plano. Se uma sessão for interrompida, retomar por este documento e pelo diff
local, sem descartar trabalho. Não declarar conclusão enquanto houver item
necessário pendente.

## Entregas e validações

- Base ao iniciar: `6e0b261`, domínio confirmado em produção. Árvore limpa.
- Primeira etapa: inspeção do Histórico, Catálogo e Delivery e preparação de uma
  camada visual comum para tabelas, filtros e diálogos do PDV.

### Lote 1 — Histórico, Catálogo e Delivery

- Histórico com busca, tabela compacta, filtros em janela, paginação, exportação
  CSV, detalhe centralizado e resumo recolhido. Serviços e regras financeiras
  existentes preservados.
- Catálogo com categorias, produtos em duas colunas no computador, consulta de
  complementos e edição centralizada. Cadastro principal permanece integrado ao
  Tetteo; nenhuma cópia de produto foi criada.
- Áreas e entregadores com pesquisa, situação, ações e diálogos no padrão visual
  do PDV. Mantidas validação, controle de versão e repetição idempotente.
- Playwright local: filtros de datas, paginação, detalhe, exportação, categorias,
  salvar complementos, criar/reabrir área, criar/desativar entregador e pesquisar.
  Revisadas telas a 1440 e 390 pixels, sem transbordamento horizontal da página
  nem erros de console. Usados exclusivamente cadastros fictícios locais.
- Diferenças conhecidas: área por raio/mapa e acerto financeiro de entregador
  não existem nesta base; entrega continua por cidade/bairro. O Histórico deste
  lote consulta vendas locais; pedidos externos continuam na Gestão de pedidos.
  Esses recursos não aparecem como controles simulados.
- Validação: `npm run check` aprovado (674 testes; cinco avisos preexistentes no CRM), `npm run build` aprovado (três avisos preexistentes de arquivos dinâmicos).

- Lote 1 publicado no commit `ed2b494`, push para `main` concluído. Dokploy
  confirmou atualização em 28/10/2026 às 05:10:14 UTC; CSS público e quatro pesos
  de Muli conferidos por HTTP 200 e SHA-256 igual ao contêiner.

### Lote 2 — Clientes, Configurações, Cozinha e Desempenho

- Clientes: lista de 20 por página, busca por nome/telefone, cadastro com
  idempotência e tratamento de duplicidade, consulta e manutenção de endereços
  no CRM. Edição do contato e segmentação permanecem no CRM do Tetteo.
- Configurações: central por subseções, layout aplicado à gestão por operador e
  unidade, distribuição das listas, visibilidade dos estados opcionais, impressão,
  agendamento e integrações existentes. Preparação visual revisada.
- Cozinha: itens e complementos reais, observações, tempo desde o início, filtros
  de modalidade e busca, visões Em preparo/Prontos, atualização a cada 15 segundos
  e conclusão de preparo usando a transição da gestão. DTO sem contatos/preços.
- Desempenho: período e comparação anterior, totais de pedidos locais/externos,
  cancelamentos separados, pendências locais, gráfico por dia, modalidades,
  origens e produtos mais pedidos. Dias no fuso São Paulo e teto explícito.
- Testes de domínio novos: DTO mínimo de cozinha, datas/totais e rejeição de
  somas financeiras inseguras. Integração nova de seções: aprovada, junto às
  duas integrações existentes de atendimento CRM (3/3 no lote final).
- Inspeção da referência realizada em Histórico (`/pedidos`), Catálogo
  (`/cardapio/produtos`), Delivery (`/entrega-taxas`, `/entregadores`), Clientes
  (`/clientes` e janela de cadastro), Cozinha (`/kds` e configurações), Desempenho
  (`/analise-vendas`) e Configurações (`/configuracoes/geral`), somente leitura.
- Diferenças preservadas: sem raio/mapa, repasse financeiro ou link de motoboy,
  impressão automática, alteração de regras globais de modalidades, personalização
  de site público ou segmentação duplicada no PDV. Esses controles não foram
  simulados; os recursos reais do Tetteo permanecem acessíveis por links.
- Playwright local: criação de cliente, busca por telefone, resultado vazio e
  retorno à lista, telefone duplicado abrindo o cadastro existente, cadastro e
  reabertura do endereço principal, escolha do endereço no novo pedido e frete
  por área. A mudança descartada no endereço não alterou o cadastro persistido.
- Cozinha: conclusão do preparo, permanência em Prontos após recarregar, busca
  por número e atualização do mesmo pedido na gestão. Configurações: troca de
  listas/kanban, persistência após recarregar e navegação nas subseções.
- Desempenho: intervalo de datas, mudança de indicador, tabela diária, período
  inválido e retorno à consulta. Capturas desktop (1440) e celular (390) revistas;
  nenhuma página das novas seções apresentou transbordamento horizontal.
  No fluxo normal não houve erros de console; o teste de duplicata produziu o
  HTTP 409 esperado e exibiu a alternativa de abrir o cadastro existente.
- Ajustes encontrados na revisão: controles de layout aguardam as preferências
  locais antes de aceitar mudanças; gráfico móvel permite rolagem com eixos
  legíveis; endereços usam janela centralizada e mantêm proteção contra saída
  com alterações pendentes.
- Verificação final: `npm run check` aprovado com 678 testes, sem erro de lint
  (cinco avisos preexistentes do CRM); `npm run build` aprovado, com três avisos
  preexistentes de rastreamento de arquivos dinâmicos. As quatro novas rotas
  constam do build. Publicação do lote 2 em andamento.
