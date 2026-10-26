<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Base do projeto e publicação

- A versão de produção é a branch `main` de `pablocdds-tech/tetteo`.
  O Dokploy publica automaticamente cada push nessa branch no domínio
  `app.vitalianopizzaria.com.br`.
- Inicie tarefas a partir da `origin/main` atualizada. Preserve alterações
  locais existentes; não substitua esta arquitetura pela cópia antiga com
  pastas `frontend/` e `backend/`. Veja `docs/unificacao-crm.md`.
- Para tarefas simultâneas, use branches e pastas de trabalho separadas.
  Antes de publicar, atualize a referência remota e integre as mudanças
  recentes sem descartar trabalho de outros chats.
- Ao concluir uma tarefa, execute `npm run check` e `npm run build` para
  mudanças de código. Só documentação exige revisão do diff.
- Após passar nas verificações, faça commit e push das alterações concluídas
  da tarefa, sem pedir nova confirmação. O push para `main` está autorizado
  a disparar o deploy no Dokploy. Nunca force o push.
- Inclua somente arquivos da tarefa. Não versione `.env`, credenciais,
  backups, dados de clientes ou alterações incompletas de outros chats.
- Preserve as regras dos READMEs de cada camada, os tokens de `DESIGN.md`,
  as permissões e o isolamento por organização e unidade no servidor.
- Migrações de produção usam somente `prisma migrate deploy`. Nunca use
  `migrate reset`, `db push` ou bancos de produção nos testes.
- Em caso de conflito ou verificação falha, preserve o trabalho e informe
  o impedimento. Confirme o deploy antes de afirmar que o domínio atualizou.
