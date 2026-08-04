# Riscos e dívidas conhecidas

Registro do que foi encontrado e **não** corrigido, com o motivo. Só sai daqui
quando estiver resolvido no código.

A ordem é por custo de correção tardia, não por gravidade aparente.

---

## Fora do escopo desta rodada

Encontrados durante a consolidação de Cardápio, Fichas Técnicas, Estoque e
Pré-Preparo. Não foram tocados porque mexer neles agora espalharia a mudança
para módulos que ainda não têm dono.

### R1 · Cinco tabelas do Core não têm exclusão lógica

`papel`, `papel_permissao`, `convite`, `app_instalado` e `notificacao` não têm
`excluidoEm`, contrariando a regra declarada em `prisma/schema/core.prisma:9-11`
("nada é apagado de verdade").

O caso mais concreto é `papel`: apagar um cargo de verdade quebra o histórico de
`acesso` que apontava para ele, e a auditoria passa a referenciar um papel que
não existe mais.

**Quando corrigir:** antes do editor de papéis do App de Configurações.
**Custo se adiar:** cresce com o número de organizações reais na base.

### R2 · O seed concede permissões de um App que não existe

`prisma/seed.ts:44-45` dá `estoque.ver` e `estoque.contar` aos papéis Gerente e
Cozinha. Não há nenhum App com a chave `estoque` em `src/registro-de-apps.ts`.

Hoje é inofensivo — `pode()` só compara strings (`src/core/sessao/contexto.ts:142`)
e ninguém pergunta por essas chaves. Vira problema no dia em que o App de Estoque
existir e herdar permissões que ninguém revisou conscientemente.

**Quando corrigir:** junto com o manifesto do App de Estoque.

### R3 · `usuario.email` é único globalmente

`prisma/schema/core.prisma:105`. A mesma pessoa não consegue ter contas separadas
em duas redes diferentes com o mesmo e-mail.

É intencional no desenho atual (uma conta atravessa organizações via `acesso`), e
está certo enquanto o Tetteo servir uma rede. Se virar produto multi-cliente, o
contador que atende três pizzarias vira um problema de suporte.

**Quando corrigir:** só se o Tetteo for vendido para fora da Vitaliano.

---

## Dentro do escopo, corrigido — registrado para memória

Ficam aqui para que ninguém reintroduza o padrão ao criar tabela nova.

### R4 · Trava de unicidade que ignora exclusão lógica → corrigido na M1

`@@unique([organizacaoId, nome])` valia para todas as linhas, inclusive as
logicamente excluídas. Excluir "Mussarela" queimava o nome para sempre.

Todo campo único de tabela com `excluidoEm` precisa de **índice parcial**
(`WHERE "excluidoEm" IS NULL`), nunca `@@unique`. O Prisma não expressa isso —
ver `prisma/schema/README.md`.

### R5 · Chave estrangeira ausente → corrigido na M1

`insumo.organizacaoId` não tinha FK. Toda tabela de domínio nova precisa de FK
**composta** carregando `organizacaoId`, apoiada no `@@unique([organizacaoId, id])`
do alvo. É o que faz o isolamento entre organizações ser garantia do banco em vez
de disciplina de quem escreve a consulta.

---

## Ainda em aberto no escopo — corrigido nas próximas migrations

### R6 · Dinheiro atravessa a borda como `number`

`src/modules/cardapio/schemas/insumo.ts:26` faz `Number(v)` e entrega o resultado
ao Prisma em `services/insumos.ts:63`. A coluna é `Decimal`, mas o valor passa por
um ponto flutuante IEEE-754 no caminho.

Hoje é inofensivo — um valor, quatro casas, ida e volta. Deixa de ser quando o
custo passar a ser **calculado**: custo médio ponderado, cascata de ficha
recursiva e rateio de fração são exatamente as operações onde o erro acumula.

**Correção:** `numeroBr` devolve `string`; o Prisma aceita string em `Decimal`.

### R7 · RLS prometida na documentação e inexistente no banco

`src/server/README.md:23-25` afirma que "o próprio PostgreSQL recusa devolver
dados de outra organização". Não recusa: não há uma única policy no banco.

O risco não é técnico, é de confiança — a equipe escreve consulta acreditando ter
uma rede de proteção que não existe.

**Correção:** M8. Até lá, o README está mentindo.

### R8 · O manifesto declara eventos que ninguém publica

`src/modules/cardapio/manifest.ts:26` anuncia `insumo.criado`, `insumo.alterado` e
`insumo.excluido`. Não existe uma única escrita na tabela `evento` em todo o `src/`.

O barramento e a tabela de entrega (`entrega_evento`) existem no banco desde a
migration inicial e nunca foram usados. O App de Estoque vai ser construído
esperando eventos que não chegam.

### R9 · Escrita por `id` sem reescopo

`src/modules/cardapio/services/insumos.ts:87` faz `update({ where: { id } })`
depois de uma leitura escopada. Está correto hoje, mas é frágil como padrão:
sem RLS, é o `updateMany` com `organizacaoId` no `where` que dá a garantia — e
este arquivo é o modelo que os próximos Apps vão copiar.

### R10 · `insumo.custoMedio` é digitado à mão e não representa custo real

`prisma/schema/catalogo.prisma`. Nada no sistema o calcula: o formulário aceita o
número que a pessoa digitar. Alterar o valor hoje mudaria o CMV de todo o
histórico, se houvesse histórico.

**Correção:** M3 introduz `custoReferencia` (cadastro) e M4 traz
`saldo_estoque.custoMedio` (custo real, por loja, calculado). `custoMedio` some
na M9, depois que a interface parar de lê-lo.
