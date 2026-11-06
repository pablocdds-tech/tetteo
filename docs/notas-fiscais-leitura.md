# Leitura fiscal v2

Decisões do responsável: consulta externa desativada; Gemini atual e Free Tier;
segunda tentativa com recortes; confirmação antes de estoque e financeiro.
Em 06/11/2026, o responsável definiu: foto inteira pelo Gemini primeiro, QR por último.
Fixtures disponíveis são sintéticas. **Acurácia em notas reais não medida.**

## Rascunho editável no sistema

Em **Severina → Equipe e avisos → Notas pelo WhatsApp → Ler documento e salvar
rascunho**, a rota `/assistente/equipe/notas/rascunhos` recebe XML, PDF e fotos
de até 20 MB e chama o mesmo `lerDocumentoFiscal`, com a mesma configuração,
reserva de orçamento e limites de tentativas do Gemini. Não há segundo leitor.

A transcrição pode estar incompleta. O formulário mostra os campos lidos,
destaca pendências e permite editar, adicionar/remover a última linha e salvar
mesmo sem documento do fornecedor, número fiscal, quantidade ou ajustes. Ausências
permanecem `null`; não se presume zero nem se recalculam valores impressos.
Erros de JSON, provedor e imagem ilegível oferecem rascunho vazio para digitação,
com aviso de que a leitura não foi concluída. Arquivos de tipo ou tamanho inválido
são recusados. A transcrição original e as correções permanecem separadas.

O armazenamento reutiliza `NotaFiscalWhatsapp`, cujos identificadores de canal
são escalares: `instanciaId=WEB`, `vinculoId=usuarioId`, `mensagemId=web:<hash>` e
estados exclusivos `LENDO_WEB`/`RASCUNHO_WEB`. Não cria conversa nem mensagem de
WhatsApp, proposta de lançamento, código de confirmação ou evento de compra.
O fluxo existente de WhatsApp permanece inalterado. Nenhuma migração é necessária.

Cada operação exige sessão ativa, unidade ativa visível e permissões atuais
`assistente.ver`, `estoque.ver` e `estoque.lancar`. Consultas e alterações exigem
organização, unidade e autor; essas permissões não conferem lançamento nesta tela.
A API valida origem nas escritas, limita o corpo durante a leitura e responde
com `private, no-store`. Os arquivos usam o armazenamento privado existente.
O limite diário e as reservas são conservados; reenvio com a mesma identidade
não gera outra leitura. Salvar exige a revisão atual para evitar sobrescrever
outra aba. Auditoria registra identidade, revisão e pendências, sem conteúdo
fiscal em logs do aplicativo. Não há persistência fiscal em localStorage.

Esta etapa termina em **Salvar rascunho**. Não oferece confirmação nem chama
rotinas de compra, estoque ou financeiro. As validações obrigatórias desses
lançamentos não foram alteradas. A validação automatizada usa fixtures sintéticas,
Gemini simulado e PostgreSQL local exclusivo; isso não comprova acurácia em fotos
reais. Nenhum deploy faz parte desta entrega.

Validação desta etapa em 06/11/2026: `npm run check` aprovado; execução final
com 877 testes unitários aprovados e 79 verificações de integração aprovadas
(seis novas e 73 dos fluxos existentes), em banco local exclusivo. Playwright
validou login, XML, PDF textual, imagem sintética ilegível, edição, salvamento,
reabertura e layout de 390 px. `npm run build` aprovado com os três avisos
preexistentes de tracing de `server/arquivos.ts`. Nenhuma chamada real ao Gemini.

## Fluxo e implementação

```mermaid
flowchart TD
  A[Equipe autorizada no WhatsApp] --> B[Original privado, download por ID]
  B --> C{Tipo pela assinatura}
  C -->|XML| D[Parser fiscal direto]
  C -->|PDF com texto| E[Extração e parser conservador]
  C -->|Imagem ou PDF digitalizado| F[Orientação, contraste, nitidez e bordas]
  F --> I[Gemini: original inteiro e derivado, JSON fixo]
  I --> J{Validação aprovada?}
  J -->|Não| K[Uma segunda leitura com recortes]
  D --> L[Validações e conferência humana]
  E --> L
  J -->|Sim| L
  K --> G{Ainda incompleto?}
  G -->|Não| L
  G -->|Sim| H[QR como último recurso, sem abrir URL]
  H --> P[Consulta desligada: conservar leitura visual para conferência]
  P --> L
  L --> M[Vínculos, conversões e pagamento]
  M --> N[Resumo e OK com código vigente]
  N --> O[Transação única: cadastros, estoque e financeiro]
```

| Etapa                                                                        | Arquivos                                                                                                                                          |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entrada e original de até 20 MB                                              | `connectors/whatsapp/webhook-evolution.ts`, `nota-midia.ts`                                                                                       |
| Seleção do método                                                            | `server/notas/pipeline.ts`                                                                                                                        |
| XML sem entidades externas                                                   | `server/notas/xml.ts`                                                                                                                             |
| PDF em processo separado                                                     | `server/notas/pdf.ts`, `scripts/pdf-fiscal-worker.cjs`                                                                                            |
| EXIF, cinza, contraste, nitidez, bordas e inclinação até 7°                  | `server/notas/imagem.ts`                                                                                                                          |
| QR em thread terminável; sem navegação na URL                                | `server/notas/qr.ts`                                                                                                                              |
| Interface substituível, desativada por padrão                                | `server/notas/consulta.ts`                                                                                                                        |
| Prompt `PROMPT_FISCAL`, temperatura 0, JSON Schema fixo nullable e confiança | `server/notas/gemini.ts`                                                                                                                          |
| Reserva por tentativa, orçamento compartilhado, mesmo modelo                 | `server/notas/orcamento.ts`                                                                                                                       |
| Dígitos, totais e rateio de centavos                                         | `lib/documento-fiscal.ts`, `server/notas/extracao.ts`, `nota-assistida-contrato.ts`                                                               |
| Casamento e conversa                                                         | `server/notas/casamento.ts`, `modules/assistente/schemas/leitura-fiscal.ts`, `conferencia-nota.ts`, `app/api/whatsapp/_costura/notas-conversa.ts` |
| Transação serializável, autorização e idempotência                           | `app/api/whatsapp/_costura/lancar-nota.ts`                                                                                                        |

O conector conserva os bytes fornecidos pela Evolution. Enviar a foto **como
documento** evita a compressão do WhatsApp. Não é possível recuperar a resolução
de uma foto já comprimida. A aplicação não usa resize para caber nos limites;
pede XML ou outro documento. Original, derivados e recortes permanecem privados.

## Validações e confirmação

CPF/CNPJ e chave têm dígitos verificados; chave precisa concordar com emitente,
número, série e mês. Duplicidade por chave ou fornecedor/número/série é conferida
novamente na transação. Quantidade × preço precisa explicar cada linha; brutos
menos descontos mais acréscimos precisam explicar o total. Parcelas somam o total
e exigem datas válidas. A tolerância é de um centavo, configurável de zero a cinco
por `NOTAS_TOLERANCIA_CENTAVOS`. O rateio por maiores restos conserva os centavos e
a transcrição original; eventual arredondamento permitido fica no rascunho.

Campos ilegíveis permanecem `null`. Confiança abaixo de 0,9 e alertas impedem
proposta pronta até conferência. `CONFERI LEITURA` confirma campos presentes e
alertas; não completa ausências nem resolve inconsistências. `SEM AJUSTES`
confirma descontos e acréscimos zero quando não estavam legíveis. Correções
invalidam o código anterior. `ITENS` exibe descrições, valores e conversões;
`OK CODIGO` ou `CONFIRMAR CODIGO` autoriza a versão entregue por até 30 minutos e
declara que as mercadorias foram recebidas. `OK` sozinho nunca lança.

O WhatsApp apresenta um resumo curto e uma pergunta por vez. A pessoa pode
responder apenas o dado pedido; a pergunta é derivada das validações vigentes,
sem mudar a transcrição original. `ITENS` mostra a lista completa, inclusive antes
de resolver as pendências. O resumo não imprime mensagens técnicas, valores
divergentes de todas as tentativas nem exemplos com documentos fictícios.
Evidências e pendências completas continuam salvas. `CONFERI` é um atalho para
conferir a leitura apenas quando não há campos inválidos; o aceite financeiro
com código permanece separado.

Fornecedor é encontrado pelo documento. Novos fornecedores/insumos ficam como
propostas e são criados no commit confirmado. Itens usam código confirmado do
fornecedor, depois EAN. Sem identificador impresso, descrição exata já confirmada
para o mesmo fornecedor e unidade pode reutilizar o vínculo e a conversão;
conflitos impedem a escolha. Similaridade gera sugestões para escolha humana.
Contradições, unidades diferentes e embalagem com conversão alterada exigem nova
conferência. Vínculos são aprendidos apenas após lançamento concluído.

A segunda leitura usa recortes sobrepostos de cabeçalho, itens e totais no mesmo
modelo. Divergências entre leituras ficam pendentes. Cota, rede e credencial não
repetem geração. A falha da segunda leitura conserva a primeira parcial para
conferência. Reservas impedem repetir gerações em replay, inclusive com custo zero.

## Provedor externo pendente

Nenhum provedor foi escolhido. O Gemini lê a foto inteira antes de tentar QR;
se a leitura visual ficar válida, o QR nem é decodificado. Se ficar incompleta,
o QR é tentado depois dos recortes. A consulta desligada conserva os dados visuais
e suas pendências, sem exigir XML só por haver QR. Sem leitura visual aproveitável,
pede XML ou nova foto. A URL impressa nunca é aberta. O futuro conector implementará `ConsultaFiscal` e será
injetado pela camada `app`, após decisão sobre provedor, autenticação e custos.
O XML retornado precisará ter a chave solicitada. Não existe variável de ambiente
que ative consulta genérica nesta entrega. Assinatura digital e situação atual na
SEFAZ não são verificadas; esse limite aparece na conferência do XML.

Retomada operacional de uma foto antiga bloqueada pelo QR: somente a nota ativa
`AGUARDANDO_XML`, método QR, original privado presente, sem rascunho, confirmação,
resultado ou tentativa de IA pode ser reenfileirada, sob trava da conversa e
revalidação da autorização atual. Preservar a leitura anterior em auditoria;
não zerar contadores de IA. A resposta da foto usa identidade `foto-2.1`, de modo
que o antigo pedido de XML permaneça no histórico e não impeça a nova pergunta.
Repetições conservam a mesma resposta e não repetem gerações. A retomada apenas
extrai dados e nunca constitui confirmação financeira.

## Testar e comparar

```powershell
npm run check
npm run build
npm run fixtures:notas
npm run avaliar:notas -- --saida caminho-privado/atual.json
npm run avaliar:notas -- --baseline caminho-privado/antes.json --saida caminho-privado/depois.json
```

O avaliador padrão não usa banco nem rede. Fotos sem Gemini aparecem sem leitura;
ausências não aumentam acertos. Resultados incluem taxa por campo, valores
ausentes/indevidos, quantidade de linhas, duração e tokens, separados por
proveniência. Relatórios contêm dados fiscais: guardar fora do Git.
`--predicoes arquivo.json` aceita um mapa de nome de fixture para extração
canônica anterior, usando o mesmo gabarito. `--baseline` compara taxas por campo.

Para avaliação visual opcional, usar `--gemini-free` e definir **no ambiente
privado** `NOTAS_AVALIACAO_GEMINI_KEY` e `NOTAS_AVALIACAO_FREE_TIER=confirmado`.
O script usa `gemini-2.5-flash`, até duas leituras por fixture e tarifas zero;
consome a cota gratuita da chave. Não busca a chave do painel, não troca para
modelo pago e não cadastra notas. Testes automatizados do Gemini usam mocks.

`npm run test:integracao` exige `DATABASE_URL_TESTE` local com nome `_test`.
O histórico antigo falha ao migrar banco vazio em `20260911120000_compras_fluxo`;
isso não foi alterado aqui. Nesta tarefa, um banco descartável UTF-8 recebeu SQL
da estrutura anterior (`prisma migrate diff --from-empty --to-schema ... --script`)
e a nova migração aditiva. Nenhum teste usa banco de produção.
As restrições e a política RLS históricas de recebimentos do PDV também foram
reproduzidas nesse banco, pois `migrate diff` não inclui SQL personalizado.

Validação desta entrega: `npm run check` aprovado com **849 testes unitários**;
`npm run build` aprovado. **80 verificações de integração** passaram, em dois
lotes: 39 para lançamento/conversa/fila/orçamento e 41 para autorização, leitor
legado e integridade operacional. Os nove casos sintéticos foram avaliados sem
API; uma segunda execução com baseline reproduziu as taxas, com zero tokens.
Gemini foi simulado nos testes. Não houve nota real, envio real de WhatsApp ou
lançamento de teste em produção. Permanecem cinco avisos de lint no CRM e três
avisos de tracing do arquivo `server/arquivos.ts`, anteriores a esta mudança.

## Commits da implementação

| Commit    | Mudança                                                                                                    |
| --------- | ---------------------------------------------------------------------------------------------------------- |
| `322d7f1` | Remove dependência de tempo no teste da trava do assistente privado, usando o sinal de início da operação. |
| `81e74ca` | Introduz extração canônica, validação de dígitos/totais e casamento fiscal.                                |
| `18bd908` | Adiciona XML/PDF/QR, preparação de imagens, schema Gemini, fixtures e avaliador.                           |
| `d56d393` | Persiste evidências privadas, contagem de tentativas e reserva para até duas leituras.                     |
| `eccc743` | Integra a leitura ao WhatsApp, correções, resumo com código e contrato de lançamento preservado.           |

A documentação de operação e o modelo de ameaças são entregues em um commit
separado. Os commits foram preparados na branch `codex/notas-fiscais-leitura`
para publicação em `main`, destino confirmado na configuração do Dokploy.

## Limites e auditoria

Uma nota por arquivo, até 100 itens, arquivo de 20 MB e imagem de 20 megapixels.
PDF: até cinco páginas, 240 mil caracteres, renderização a 3× com geometria
verificada antes do canvas, máximo de 20 megapixels por página. Processo sem
credenciais herdadas, prazo de 25 segundos e heap de 256 MB; isso não representa
sandbox de sistema operacional nem teto absoluto de memória nativa. QR: thread
de oito segundos. Gemini: 16 MB agregados, até 15 imagens, contagem limitada a
32.768 tokens e 16.384 tokens de saída. Lease de quatro minutos na fila.

Auditoria registra IDs dos arquivos, método, versão, tentativas, tokens,
validações e códigos de rejeição. Erros não expõem segredos ou corpo do provedor.
Original e correções ficam separados. XML é entregue como anexo na rota
autenticada, com CSP restritiva. Layout desconhecido permanece pendente.

Pendências do responsável: escolher provedor depois e fornecer notas reais
anonimizadas com gabarito revisado para avaliar acurácia visual antes/depois.
