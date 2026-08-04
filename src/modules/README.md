# `modules/` — os Apps do Tetteo

Cardápio, Estoque, Compras, Financeiro, Analytics, CRM, Checklists…

> A pasta não se chama `apps/` porque o Next.js já reservou a palavra `app` para
> roteamento. Manter as duas seria fonte permanente de confusão.

## A regra

**Um App nunca importa de outro App.**

```
modules/cardapio/  →  modules/estoque/   ❌  bloqueado pelo linter
modules/cardapio/  →  modules/cardapio/  ✅
modules/cardapio/  →  core/  design-system/  lib/  server/   ✅
```

Quando dois Apps precisam conversar, existem exatamente dois caminhos:

1. **Evento** — "algo aconteceu, reaja se quiser". O Cardápio publica
   `ficha.custo_alterado`; quem se interessa, escuta.
2. **Dado central** — entidades que vários Apps legitimamente compartilham
   (produtos, pessoas, clientes). Todos leem; só o App dono escreve.

Nunca por chamada direta.

## O template

Todo App tem o mesmo formato — o primeiro e o décimo oitavo:

```
modules/<app>/
├── manifest.ts       ← declaração ao Core: nome, ícone, cor, rota,
│                       permissões, eventos, aba de configuração
├── routes.tsx
├── permissions.ts    ← o vocabulário DELE
├── components/
├── layouts/
├── hooks/
├── stores/
├── services/         ← as regras de negócio
├── schemas/
├── types.ts
├── events/
│   ├── published.ts
│   └── handlers.ts
├── search.ts         ← como responde à Busca Global
├── widgets/          ← o que mostra na Home, se mostrar
└── settings/         ← sua aba em Configurações
```

Um módulo sem `manifest.ts` válido não aparece no sistema.
