# Conferência de vendas e recebimentos

Implementação do material Kairu Pass 1.0.1 (20/10/2026), adaptada ao Tetteo da
VPS: Next.js 16.3, Auth.js, Prisma 7 e PostgreSQL. O código antigo da pasta
Desktop não é a base publicada. A entrada fica em **Financeiro → Auditoria
financeira**, `/financeiro/conferencia`.

## Reformulação com as referências Nina — 29/10/2026

O prompt e os arquivos fornecidos foram tratados como especificação do módulo;
os prints orientam o visual, sem copiar seus dados reais. A estrutura existente
já continha o schema e o motor. A reformulação preserva essa base, sem criar um
segundo financeiro nem alterar as contas a pagar/receber.

| Incremento                         | Implementação e verificação                                                                                                                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Schema e originais privados     | Modelos `Conferencia*`, bytes privados, hashes e FKs compostas preservados. Histórico de 36 migrations reproduzido em PostgreSQL 17 vazio com `migrate deploy`.           |
| 2. Adapters e cobertura            | CSV/JSON existentes; área de arraste, validação do formato/tamanho, prévia vinculada à fonte/conta/período e cobertura antes da primeira execução.                        |
| 3. Conciliação exata e ambiguidade | Motor conservador preservado; testes do kit fornecido e do projeto executados. A lista identifica origem/data; sugestões recebem aviso explícito no detalhe.              |
| 4. Lotes e contratos               | Alocações e contratos versionados preservados. Exemplo interativo usa o motor real: depósito de R$ 1.691,25 distribui R$ 1.206,25 e R$ 485,00, sem reutilização integral. |
| 5. Fila e decisões                 | Novo resumo visual, pendências filtráveis, quatro totais, detalhe das três fontes e histórico. Ensaio verifica concorrência e preservação da decisão ao reprocessar.      |
| 6. Exportação e observação         | Exportação autenticada existente mantida. CI passa a recriar banco descartável, aplicar todo o histórico e executar `conferencia-ensaio.ts`. Nenhuma baixa automática.    |

O botão **Exemplo guiado** é acessível mesmo com importações existentes. Seus cinco
cenários são locais e fictícios, sem escrita: taxa divergente, fonte parcial,
ausência de crédito, NSU repetido e crédito agregado. A taxa de R$ 6,25 continua
visível quando a fonte está parcial; isso não autoriza fechar o período.

A cobertura atual reflete os arquivos disponíveis e as contas citadas; os totais
continuam sendo o snapshot da execução selecionada. Novos arquivos ou contratos
pedem nova conferência. A cobertura declarada não certifica completude do fornecedor.

Verificação visual e funcional em 1366×768 e 390×844: importação, rejeição de formato,
prévia, confirmação, execução, exportação, filtros, cenários, diálogo e teclado.
O layout preserva os temas do sistema. Integrações automáticas com Takeat,
adquirentes ou bancos continuam dependendo de documentação e autorização próprias;
os formatos iniciais são CSV/JSON, não Excel/OFX.

## O que a pessoa faz

1. Escolhe a loja no seletor do Tetteo e informa o período.
2. Em Arquivos e cobertura, baixa um modelo CSV de cada fonte, prepara os
   arquivos reais e confirma a referência da conta, datas e separador.
3. Analisa a leitura, confere as colunas, a amostra e as rejeições. Só confirma
   depois de conferir. Um lote parcial permanece em revisão sem entrar na soma.
4. Cadastra os contratos de taxa, com vigência, bandeira, método e parcelas.
5. Executa a conferência e abre uma ocorrência para ver as três fontes, o
   cálculo, os lotes e os arquivos originais.
6. Anexa PDF/JPG/PNG, comenta ou registra uma decisão com motivo. Exporta o
   período com os mesmos filtros. A decisão não baixa uma conta.

O exemplo fictício está disponível na tela vazia e nos modelos: bruto 125000
centavos, contrato 300 bps, taxa prevista 3750, cobrada 4375, líquido e crédito 120625. A diferença de 625 centavos continua aberta mesmo com o banco batendo.
Não são inseridos dados fictícios na produção.

## Formato dos arquivos

CSV ou lista JSON em UTF-8. Até 2 MB e 5.000 registros por arquivo. CSV aceita
ponto e vírgula, vírgula ou tabulação, aspas escapadas e quebras dentro de células.
Moeda BRL; datas explicitamente ISO (`AAAA-MM-DD`) ou BR (`DD/MM/AAAA`).

Campos canônicos comuns: `externalId` (quando existir), `provider`, `merchantRef`,
`accountRef`, `businessDay`. A referência da conta deve coincidir nas três fontes.
Um timestamp `occurredAt` exige fuso explícito; se não houver dia informado, ele
é convertido no fuso cadastrado da loja. Timestamp e dia operacional são preservados.

| Fonte      | Campos adicionais                                                                                        |
| ---------- | -------------------------------------------------------------------------------------------------------- |
| VENDA      | saleExternalId, nsu, grossCents, method, brand, installments, status COMPLETED/CANCELLED                 |
| ADQUIRENTE | nsu, grossCents, feeCents, netCents, payoutRef, expectedSettlementDay, status PENDING/SETTLED/CHARGEBACK |
| BANCO      | amountCents, direction CREDIT/DEBIT, payoutRef, description                                              |

O parser também aceita os aliases portugueses documentados em
`schemas/importacao-conferencia.ts`. Campos terminados em `Cents` exigem inteiros.
`bruto`, `taxa`, `liquido`, `valor` e `ajuste` aceitam **texto** brasileiro, como
`"1.250,00"`. Sem flutuação monetária na persistência. Parcelas individualizadas
exigem `installmentNumber` e `installments`; uma repetição continua ambígua.
Descontos/antecipações entram em `adjustmentCents` com `adjustmentReason`, e
seguem para revisão. Não há inferência automática de prazo ou de calendário.

Colunas desconhecidas são informadas para revisão. Linhas inválidas ficam em
quarentena; o lote parcial não participa da conferência. Para corrigir, importe
um arquivo corrigido e descarte a leitura pendente com motivo. Isso preserva o
original e retira o lote descartado da avaliação de cobertura.

## Persistência, repetição e histórico

Os modelos `Conferencia*` ficam em `prisma/schema/conferencia.prisma`.
`organizacaoId` corresponde a tenantId e `unidadeId` a storeId. FKs compostas
impedem vincular arquivo, linha, caso, execução, lote e alocação entre lojas.
Não há dependência de RLS para a autorização.

Os originais pequenos e as evidências ficam em BYTEA privado no PostgreSQL,
incluídos no backup do banco, em vez de depender de um novo volume no Dokploy.
O ID/hash é a referência privada do objeto; nenhuma rota estática os serve.
Triggers impedem alteração/remoção dos bytes, leituras, decisões e execuções.
Somente a participação ativa de uma linha pode mudar após revisão explícita.

Arquivo repetido é único por organização, loja, fonte, conta e SHA-256.
`externalId` identifica a ocorrência dentro de provedor/estabelecimento/conta.
Ocorrências iguais sem ID não são eliminadas por valor/data/descrição. Arquivos
sobrepostos sem identidade ficam em revisão; o responsável confirma que são
distintos ou descarta a leitura. Identificadores com valores alterados só
substituem a interpretação anterior após revisão e motivo. A versão anterior
continua no banco. A chave de confirmação e a chave de execução são idempotentes.

Parser e regras são fixados e registrados em cada leitura/execução. A versão
inicial suporta um único parser; uma futura evolução precisa acrescentar sua
versão de leitura preservando o original e as linhas anteriores, sem alterar o
parser de uma importação existente. Não existe reprocessamento destrutivo.

Uma correção de contrato cria nova versão e desativa a anterior; execuções
passadas mantêm o contrato que usaram. Decisões e comentários são append-only,
com autor e versão otimista. Comentários não substituem a decisão efetiva.
Evidência nova contraditória marca revisão adicional na próxima execução.

## Conferência conservadora

- Provedor, estabelecimento, conta, NSU e dia operacional formam a chave forte.
  Terminal/autorização contraditórios recusam o casamento.
- Valor/data/bandeira só geram sugestão. Duplicidade em qualquer fonte é ambígua.
- Bruto, taxa, liquidação e banco são verificados separadamente. Taxa ausente
  permanece desconhecida. Tolerância é versionada; o detalhe mantém a diferença.
- Lotes usam referência, conta, provedor, estabelecimento, dia e valor. Os
  componentes e a alocação ficam registrados. Um trigger limita a soma por crédito
  e por lote **dentro de cada execução**. Reexecuções são snapshots históricos.
- Chargeback, cancelamento, parcelas incompletas e ajustes não viram receita
  confirmada. O extrato é consultado até as datas de liquidação informadas.
- Cobertura declara o alcance dos arquivos, não certifica que o fornecedor
  entregou toda a história. Falta de registro não comprova prejuízo.

As quatro colunas representam o mesmo dinheiro em etapas distintas. O total de
créditos bancários inclui créditos sem lote, que aparecem na fila como ausentes;
não é receita atribuída ao PDV. Débitos são separados.

## Acesso e rotas

Escopo vem da sessão, sem organização/loja aceitas no corpo da importação.
`financeiro.ver` consulta/exporta; `financeiro.lancar` importa, executa e cadastra
contrato; `financeiro.quitar` decide, resolve conflitos e descarta leituras
pendentes. Essa distribuição foi confirmada pelo usuário. Nenhuma permissão foi
concedida e nenhuma escrita altera `Lancamento` ou o Saipos.

As rotas internas ficam sob `/api/finance`: `imports/preview`, `imports/confirm`,
`imports/:id`, `imports/:id/original`, `imports/:id/discard`, `contracts`,
`reconciliation/runs`, `reconciliation`, `reconciliation/:id`,
`reconciliation/:id/reviews`, `reconciliation/:id/evidence`,
`reconciliation/export`, `evidence/:id` e `models/:fonte`.
Os nomes são internos, sem endpoints inventados de fornecedores.

Escritas exigem sessão, permissão, origem exata e JSON limitado a 3 MB antes do
parsing. Arquivo até 2 MB; rate limit compartilhado por usuário/organização.
As leituras retornam private/no-store; downloads são attachments com nosniff e
sandbox. CSV neutraliza fórmulas inclusive após espaços/tabulações. Auditoria
guarda hashes e IDs, sem copiar extrato ou credenciais para o log.

## Validação e publicação

`npm run check` e `npm run build`. Os testes puros ficam em
`src/modules/financeiro/schemas/conferencia.test.ts`.
`npx tsx scripts/conferencia-ensaio.ts` exige conexão local e banco `_test`, cria
loja fictícia e verifica persistência, concorrência, isolamento e triggers.
O banco de ensaio deve ser descartável: o script preserva seu histórico.

Antes de publicar: backup privado, restauração em cópia isolada, migrations
aditivas com `prisma migrate deploy`, repetição do histórico em banco vazio,
ensaio com dados fictícios e revisão visual em 1366×768/390×844.
O entrypoint do Docker já aplica as migrations antes de subir o servidor.

O rollout permanece em observação. Integrações reais com banco/adquirente exigem
adapters validados e autorização; a API Saipos de vendas atual não oferece NSU,
taxa e lote suficientes para substituírem estes arquivos.
