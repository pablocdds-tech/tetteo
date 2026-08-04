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

### Índices parciais

O Prisma não expressa `WHERE` em índice. Todo campo único de tabela com
`excluidoEm` precisa de um destes — `@@unique` comum queimaria o valor de um
registro excluído para sempre.

| índice                           | M   | garante                                                 |
| -------------------------------- | --- | ------------------------------------------------------- |
| `insumo_nome_ativo_uk`           | M1  | nome único entre os insumos não excluídos               |
| `unidade_medida_codigo_ativo_uk` | M2  | código único entre as unidades não excluídas            |
| `unidade_medida_base_unica_uk`   | M2  | **uma** unidade base por grandeza                       |
| `conversao_unidade_vigente_uk`   | M2  | **uma** conversão vigente por (insumo, origem, destino) |

### CHECKs

| tabela               | M   | recusa                                                                   |
| -------------------- | --- | ------------------------------------------------------------------------ |
| `unidade_medida`     | M2  | fator ≤ 0; unidade marcada como base com fator diferente de 1            |
| `conversao_unidade`  | M2  | fator ≤ 0; origem igual ao destino; vigência terminando antes de começar |
| `insumo`             | M3  | custo ou estoque mínimo negativo; validade de zero dia                   |
| `insumo_por_unidade` | M3  | estoque máximo menor que o mínimo                                        |

## Rollback

O Prisma não tem migration de volta. Cada migration tem a sua em
[`prisma/rollback/`](../rollback/), com o mesmo nome. Elas não rodam sozinhas —
são executadas à mão, na ordem inversa, quando algo dá errado no deploy.
