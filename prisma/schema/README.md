# `prisma/schema/` — o banco

O schema fica dividido em arquivos, um por camada, do mesmo jeito que o código.
O Prisma junta todos os `.prisma` da pasta num schema só.

| arquivo           | o que guarda                                                  |
| ----------------- | ------------------------------------------------------------- |
| `schema.prisma`   | só `generator` e `datasource`                                 |
| `core.prisma`     | o Kernel: organização, unidade, acesso, evento, auditoria     |
| `catalogo.prisma` | **dado central**: insumo, unidades de medida, fichas técnicas |
| `estoque.prisma`  | o razão de estoque, saldos, lotes, produção                   |
| `cardapio.prisma` | o App de Cardápio: produto, canal, preço, opcionais           |

## `catalogo.prisma` não pertence a nenhum App

`insumo` é lido pelo Estoque, pelas Compras, pelo Financeiro e pelo Analytics, e
escrito só pelo Cardápio. É o caso clássico do **dado central** descrito em
[`src/modules/README.md`](../../src/modules/README.md): todos leem, só o dono
escreve.

Deixá-lo dentro de `cardapio.prisma` obrigaria o App de Estoque a atravessar a
fronteira que o linter existe para impedir. Por isso ele vive numa camada
própria, e nenhum App é dono dela.

---

## ⚠️ O que o Prisma NÃO enxerga

Boa parte das garantias deste banco não cabe no schema do Prisma. Elas vivem em
SQL bruto dentro das migrations — e o Prisma **não sabe que existem**.

Consequência prática: `prisma migrate dev` vai enxergar cada objeto desta lista
como desvio (_drift_) e propor removê-lo. **Nunca aceite.** Ao revisar o SQL que
o Prisma gerar, apague as linhas que derrubem qualquer coisa listada abaixo.

Toda migration que criar um objeto invisível ao Prisma **precisa acrescentá-lo
aqui**. Esta tabela é a única memória que o projeto tem deles.

| objeto                      | tipo              | onde nasce | por que existe                                                         |
| --------------------------- | ----------------- | ---------- | ---------------------------------------------------------------------- |
| `insumo_nome_ativo_uk`      | índice parcial    | M1         | nome único **só entre os não excluídos** — Prisma não expressa `WHERE` |
| `insumo_organizacaoId_fkey` | chave estrangeira | M1         | (esta o Prisma enxerga; listada só por ter nascido em SQL)             |

## Rollback

O Prisma não tem migration de volta. Cada migration tem a sua em
[`prisma/rollback/`](../rollback/), com o mesmo nome. Elas não rodam sozinhas —
são executadas à mão, na ordem inversa, quando algo dá errado no deploy.
