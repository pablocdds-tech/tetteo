# Unificação do CRM com a produção

## Fonte de verdade

A produção usa `pablocdds-tech/tetteo`, branch `main`, com um aplicativo Next.js
na raiz. O serviço `web` do Dokploy publica pushes nessa branch automaticamente
em `https://app.vitalianopizzaria.com.br`. O Dockerfile e as configurações dos
módulos existentes foram mantidos.

A pasta antiga `C:/Users/Lenovo/Desktop/tetteo` contém uma implementação diferente,
com `frontend/` e `backend/`, histórico Git independente e trabalho local ainda
não registrado. Ela foi preservada sem reset, limpeza ou envio forçado.
Não use `git pull --allow-unrelated-histories` para juntar as duas arquiteturas.

Nesta sessão a integração foi preparada em
`C:/Users/Lenovo/.codex/worktrees/crm-unificacao/tetteo`, a partir da `origin/main`.
Novos chats devem usar a arquitetura publicada e consultar `AGENTS.md` antes de
alterar código. Tarefas simultâneas usam branches e worktrees próprios a partir
da mesma `origin/main`; a integração em `main` é validada antes do push.

## O que foi integrado

- Contatos e leads por unidade, busca, filtros, histórico manual e consentimento.
- Vínculo explícito de vendas Saipos existentes. Nenhuma identidade é inferida.
  Totais e cancelamentos são refletidos antes das consultas do CRM sem modificar
  `saipos_venda`, o Financeiro ou o Analytics.
- Públicos de retenção, atualização em lotes, identificadores verificados e
  importação de visitas JSON com revisões e idempotência.
- Campanhas em rascunho, prévia, aprovação com versão e orçamento, grupo de
  controle, resultados descritivos e exportação.
- Sessão Auth.js e permissões `crm.ver`, `crm.editar`, `crm.gerenciar`, sem outro
  login, JWT no navegador ou nova API Express.

As permissões existentes não são ampliadas automaticamente. Diretor (`*`)
acessa o módulo; outros perfis precisam das permissões no editor de papéis.
O CRM exige uma unidade ativa; o servidor recusa pedidos para outra unidade,
mesmo quando o usuário consegue vê-la no seletor.

As tabelas `Crm*` referenciam as unidades existentes. `storeId` é o nome mantido
no contrato migrado e corresponde a `Unidade.id`, não a uma segunda loja. Os
identificadores e registros do banco local antigo não são copiados para produção
sem um mapeamento explícito e verificável de unidades, usuários e contatos.

## Processamento e mensagens

As consultas de públicos/importações e resultados avançam tarefas pendentes da
unidade autorizada em lotes limitados. Não há um cron global nem temporizadores
permanentes no processo Next.js. A atualização continua enquanto essas telas
consultam o andamento; sem consultas, tarefas aguardam a próxima abertura.

Envios reais de WhatsApp, SMS e e-mail continuam ausentes. A simulação também
começa desativada; `CRM_LOCAL_DELIVERY_ENABLED=true` habilita apenas recibos
locais, sem conexão de rede com destinatários.

Identificadores importados são cifrados e indexados por HMAC. Use uma chave
`CRM_IDENTITY_KEY` de 64 caracteres hexadecimais ou a derivação privada de
`AUTH_SECRET`, com separação por finalidade. Mantenha a chave estável e no
backup de segredos; trocar `AUTH_SECRET` sem preservar a chave derivada exige
revisão dos identificadores antigos. Nenhuma chave é enviada ao navegador.

## Validação e publicação

- `npm run check` e `npm run build`.
- Integração do CRM: banco PostgreSQL local exclusivo, com nome contendo `_test`;
  execute `tsx --import ./scripts/ambiente-de-teste.ts --test src/modules/crm/services/crm.integracao.ts`.
- Migração aditiva `20261026020000_crm_unificacao`: cria as tabelas CRM e um índice
  composto em Saipos; não remove tabelas nem altera os dados dos módulos atuais.
- A imagem de produção já executa `prisma migrate deploy` antes de iniciar.
  Nunca rode testes ou comandos de reset no banco da VPS.
- Confirme o commit e o estado do deploy no Dokploy; verifique Contatos,
  Públicos e Campanhas no domínio usando a sessão existente.

A migração histórica `20260911120000_compras_fluxo` falhou ao reconstruir um
banco vazio no PostgreSQL local de validação. O histórico de produção foi
preservado. O ensaio da migração CRM usa o schema atual anterior como baseline
e confirma que um registro preexistente permanece após a aplicação.
