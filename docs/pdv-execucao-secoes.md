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

| Seção                           | Entrega esperada                                                                                                     | Estado                 |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Gestão de pedidos e novo pedido | Gestão unificada, listas/kanban, resumo e atendimento no padrão visual de referência                                 | Publicada em `83fe978` |
| Caixa                           | Tabela, filtros, resumo, diálogos, histórico e impressão                                                             | Publicada em `6e0b261` |
| Histórico de pedidos            | Barra de filtros compacta, tabela e detalhe coerentes com a referência, preservando consultas/exportação/recebimento | Em andamento           |
| Catálogo                        | Navegação por categorias, produtos e complementos; configuração clara e conectada ao cadastro existente              | Pendente               |
| Áreas de entrega                | Listagem, busca, situação e cadastro/edição no mesmo padrão visual                                                   | Pendente               |
| Entregadores                    | Consulta, cadastro e edição no contexto do Delivery                                                                  | Pendente               |
| Clientes                        | Seção própria do PDV usando CRM e endereços existentes, sem duplicar cadastros                                       | Pendente               |
| Configurações                   | Central operacional clara e preparação da operação com controles realmente aplicados                                 | Pendente               |
| Cozinha                         | Tela operacional de preparo usando pedidos e estados reais, com foco nos itens e próximas ações                      | Pendente               |
| Desempenho                      | Visão de vendas e operação com período e números reais da unidade                                                    | Pendente               |
| Revisão final                   | Navegação entre seções, responsividade, permissões, testes, build e deploy confirmados                               | Pendente               |

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
- Validação: `npm run check` aprovado (674 testes; cinco avisos preexistentes no CRM), `npm run build` aprovado (três avisos preexistentes de arquivos dinâmicos). Publicação: aguardando confirmação do deploy.
