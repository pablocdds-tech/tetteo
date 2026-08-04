# Tetteo

Sistema operacional da **Vitaliano Pizzaria**.

Não é um ERP tradicional. É um **Business OS**: uma plataforma (o Core) sobre a qual
vivem Apps independentes — Cardápio, Estoque, Compras, Financeiro, Analytics — que
compartilham login, permissões, navegação, busca, notificações, banco e design, mas
permanecem desacoplados entre si.

## Como rodar

```bash
npm install
npm run dev
```

Abre em http://localhost:3000

| Comando          | O que faz                                                       |
| ---------------- | --------------------------------------------------------------- |
| `npm run dev`    | Roda em desenvolvimento                                         |
| `npm run build`  | Compila para produção                                           |
| `npm run check`  | Tipos + fronteiras + formatação. **Rode antes de todo commit.** |
| `npm run format` | Formata o código automaticamente                                |

## A arquitetura em uma tela

```
src/
├── app/            roteamento — a casca (sidebar + header) que NUNCA recarrega
├── core/           o Kernel: login, unidades, permissões, registro de Apps,
│                   barramento de eventos, busca, notificações
├── modules/        os Apps do Tetteo (Cardápio, Estoque, Compras, …)
├── design-system/  os tijolos visuais — não conhecem negócio
├── connectors/     pontes com o mundo externo (PDV, iFood) → viram eventos
├── server/         banco, autorização, entrega de eventos, auditoria
└── lib/            utilitários genéricos
```

Cada pasta tem um `README.md` com a sua regra. **Leia antes de criar arquivo nela.**

## As três regras que sustentam tudo

**1. Um App nunca importa de outro App.**
Para conversar existem dois caminhos: um **evento** ("compra foi criada" — quem se
interessa, escuta) ou um **dado central** (produtos, pessoas, clientes: todos leem,
só o dono escreve). Nunca chamada direta.

**2. O Core não conhece nenhum App.**
Ele sabe _como_ verificar uma permissão ou entregar um evento — nunca _o que_ elas
significam. O único ponto de contato é o App Registry, que lê os manifestos que os
Apps declaram sobre si mesmos.

**3. As fronteiras são verificadas pela máquina, não pela disciplina.**
`npm run lint` recusa o código quando alguém atravessa uma fronteira. Estrutura de
pasta não impede ninguém de fazer besteira — ela só torna a besteira visível.
Sem a trava, em seis meses a arquitetura existe só no papel.

## Criar um App novo

1. Uma pasta em `src/modules/<nome>/`, seguindo o template do
   [README de modules](src/modules/README.md).
2. Um `manifest.ts` declarando nome, ícone, cor, rota, permissões e eventos.
3. Registrar o manifesto no App Registry.

O Core faz o resto sozinho: o ícone aparece na Home, a rota resolve, as permissões
entram no editor de papéis, a busca passa a incluí-lo. **Nenhum arquivo do Core é
alterado.**

## Decisões travadas

- **Multi-unidade desde o início.** Toda tabela carrega organização e unidade.
  Adicionar depois significaria migrar o banco inteiro com dados reais dentro.
- **Duas densidades.** Modo Gestão (computador, 38px de alvo) e Modo Operação
  (tablet de cozinha, 48px, tema escuro forçado). O mesmo App, cascas diferentes.
- **Nada é apagado de verdade.** Exclusão é lógica, sempre.
- **Toda escrita é auditada.** Quem mudou, o quê, de qual valor para qual.

## Stack

Next.js · TypeScript · PostgreSQL · Prisma · Auth.js · Tailwind · Radix ·
TanStack Query · Zustand · Zod · Docker

Tudo roda em VPS própria. Sem dependência de serviço pago externo.

## Estado atual

**Fase 0 · Componente 1** — repositório, estrutura, tokens de design e travas
arquiteturais. Sem banco, sem login e sem telas ainda.
