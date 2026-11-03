# Atendimento virtual — evidências de aceite

Validação local com dados fictícios Kairu. Não houve envio para telefone real, reserva real ou leitura de dados de clientes da produção.

## Ambiente e migração

- PostgreSQL 17 local exclusivo, banco com sufixo `_test`; `scripts/ambiente-de-teste.ts` exige `DATABASE_URL_TESTE`, host local e nome de teste antes de importar o cliente.
- Schema da `main` anterior preservado como baseline fora do repositório; SQL inicial criado com `prisma migrate diff --from-empty`, aplicado somente no banco descartável.
- Migração aditiva `20261103010000_atendimento_virtual` aplicada com sucesso sobre esse baseline. Um registro fictício preexistente de organização permaneceu com mesmo ID e conteúdo.
- Migrações `20261103020000_outbox_claim` e `20261103021000_virtual_model_configuration` aplicadas no mesmo banco local. O registro preexistente continuou preservado. O índice da outbox não é recriado na migração de credenciais.
- `prisma validate` e `prisma generate` passaram. A migração não altera/remove dados ou tabelas de outros módulos.
- Restrições de banco testadas diretamente: conta em modo real, evento com organização/unidade incompatível com a conta e capacidade zero são recusados. Falhas esperadas geram somente a mensagem genérica de banco no log.

O ensaio usa baseline porque o histórico antigo de Compras tem uma migração que não reconstrói um banco vazio, conforme `docs/unificacao-crm.md`. Produção continua usando exclusivamente `prisma migrate deploy`; não há `db push`, reset ou acesso ao banco da VPS nos testes.

## Testes executados

Comando da integração:

```powershell
node node_modules/tsx/dist/cli.mjs --import ./scripts/ambiente-de-teste.ts --test --test-concurrency=1 src/modules/crm/services/virtual.integracao.ts src/modules/crm/services/virtual-model.integracao.ts
```

Resultado: **42 cenários aprovados**: 32 de atendimento/outbox e 10 de conexão privada do modelo. Incluem agente, serviços e PostgreSQL real. Os arquivos mantêm dados `demo:` e e-mails `.invalid`; fixtures não usam números reais e desativam as contas criadas ao final de cada cenário.

Também foi validada a continuação com respostas isoladas (“19” e “4”): o servidor associa o campo à pergunta anterior. Uma pergunta de cardápio durante a reserva recebe a informação pública e invalida o resumo antigo; um “sim” posterior não cria reserva até existir um novo resumo para confirmação.

| Aceite                           | Evidência executada                                                               | Resultado e limite                                                                                 |
| -------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Contato conhecido                | Identidade CRM verificada específica da conta; reserva parcial                    | Nome reaproveitado; pergunta somente horário, sem notas internas                                   |
| Nome corrigido                   | Correção Ana → Bia, nova mensagem e continuação da reserva                        | Alias e resumo usam Bia; cadastro original não é alterado                                          |
| Outro tenant/conta               | Mesmo remetente fictício e ID externo em outra organização; troca de IDs          | Conversas separadas, sem contato herdado; serviço recusa acesso cruzado                            |
| Cliente sem cadastro             | Reserva com data/nome e campos incompletos em mensagens separadas                 | Pergunta só horário e depois quantidade; nenhuma reserva antes da confirmação                      |
| Debounce e ordem                 | “amanhã” seguido de “às 19h, quatro pessoas”                                      | Um lote preserva a ordem original                                                                  |
| Duplicata                        | Duas entradas simultâneas com mesma conta + ID externo                            | Um evento e uma mensagem                                                                           |
| Bot, grupo e entrega             | Eventos de mensagem própria, grupo e callback                                     | Não criam falas de cliente nem novas conversas                                                     |
| Duas réplicas                    | Dois `processVirtualQueue` concorrentes                                           | Um turno e uma saída aceitos                                                                       |
| Mensagem durante geração         | Executor suspenso, nova mensagem, liberação e nova rodada                         | Turno velho descartado; lote novo conserva ambas as mensagens                                      |
| Lease recuperável                | Lease vencido e réplica interrompida                                              | Outra execução recupera a conversa; tentativas finais viram tarefa                                 |
| Takeover durante geração         | Humano assume com executor suspenso                                               | Turno é descartado; resposta manual idempotente sai uma vez                                        |
| Pausa/retomada                   | Pausa expirada sem tarefa; pausa expirada com escalação                           | Primeira retoma; segunda permanece humana até resumo e retomada explícita                          |
| Última capacidade                | Duas conversas consultam duas vagas e confirmam duas pessoas cada                 | Uma reserva; outra recebe disponibilidade alterada, sem sobrelotação                               |
| Retry de criação                 | Mesma chamada da ferramenta executada duas vezes na confirmação                   | Mesmo resultado/ID; uma reserva e uma execução persistida                                          |
| Cancelamento indevido            | Outro remetente tenta usar token/ID de reserva alheia                             | Falha acionável e reserva original preservada                                                      |
| Áudio incerto                    | Mensagem marcada AUDIO sem transcrição confiável                                  | Pede texto de confirmação e não executa reserva                                                    |
| Sucesso sem ferramenta           | Claim aponta para execução inexistente                                            | Sem saída; falha `CLAIM_BLOCKED` e tarefa rastreável                                               |
| Modelo tenta escrever sucesso    | Schema recebe texto livre, tenant, SQL/ferramenta ou segredo                      | Campos extras rejeitados; “confirmo” sem resumo não cria reserva                                   |
| Instrução em anexo               | Imagem fictícia contém instrução para segredo e reserva                           | Vai à equipe; não altera permissões, não reserva e mascara credencial                              |
| Base vencida/link ausente        | Cardápio com link vazio e versão expirada                                         | Informa ausência de link; base vencida cria tarefa, sem inventar URL                               |
| Escalação sem destino            | Tarefa sem usuário de alerta, retry e ack                                         | Falha visível; mesma tarefa; reconhecimento registra responsável/horário                           |
| Callback fora de ordem/duplicado | Callback fictício anterior à aceitação, replay e falha tardia                     | Estado entregue preservado, sem criar fala ou repetir envio                                        |
| Timeout/falha do canal           | Adaptador de teste devolve `UNCERTAIN`, depois `ACCEPTED`; outro devolve `FAILED` | Concilia pela mesma correlação com um envio, inclusive após takeover; falha definitiva não reenvia |
| Loop e limites                   | Nona ferramenta; tokens/resposta vazia; orçamento zerado                          | Sem sucesso falso; processamento interrompido e pendência criada                                   |
| Invariantes de banco             | Escritas diretas incompatíveis                                                    | FKs e CHECKs rejeitam escopo e valores inválidos                                                   |

Outros quatro cenários cobrem as alterações finais:

- Gestor salva limites/circuito/destino e pode limpar o destino; ator sem permissão e destinatário estrangeiro ou com acesso suspenso são recusados.
- Pausar a conta durante a geração invalida a resposta antiga e preserva a mensagem pendente para reativação.
- Alterar uma reserva no próprio horário lotado desconta a própria ocupação; mantém o mesmo ID e uma única reserva.
- A fronteira real do extrator recebe `fetch` substituído por saída maliciosa com texto de sucesso e tenant extra. O contrato rejeita, cria tarefa e conserva o custo reservado, sem rede externa nem reserva.

Testes puros adicionais:

```powershell
node node_modules/tsx/dist/cli.mjs --test src/modules/crm/services/virtual-agent-plan.test.ts src/server/atendimento-canal.test.ts src/server/atendimento-webhook.test.ts src/server/ia/credencial-atendimento.test.ts
```

Resultado: **9 testes aprovados**. Cobrem a virada do dia no fuso `America/Sao_Paulo`, data impossível, separação de intenção/campos, telefone internacional explícito e ambíguo, destinatários reais recusados, HMAC sobre corpo original, assinatura adulterada, segredo ausente, tipo incorreto, limite de 64 KiB contado mesmo quando o tamanho declarado mente e cifra autenticada com nonce aleatório/AAD por organização e unidade.

### Novas fronteiras de transporte e credenciais

- A saída persiste `SENDING`, lease e correlação antes de chamar o adaptador fora da transação. Duas réplicas executam um único envio; takeover conclui enquanto o transporte está pendente. Aceitação anterior à perda de resposta é reconciliada após o lease expirar, sem novo envio; a réplica antiga não sobrescreve a prova mais recente.
- Configuração Gemini exige gestor e unidade ativa. Chave e ciphertext não aparecem em DTO, catálogo ou auditoria; cifra copiada de outra unidade não pode ativar o modelo. FKs e CHECKs também recusam escopo incorreto e ativação sem revisão testada.
- Teste aprovado habilita somente a revisão atual. Salvar desativa e limpa o teste; conclusão de probe antigo não aprova revisão nova. Replay de teste não chama a API novamente; há limite de três provas por hora/unidade.
- Se o processo morrer após reservar custo, repetir o mesmo ID de teste depois de 60 segundos registra timeout e conserva o débito, sem nova chamada. Um novo ID explícito pode testar novamente quando cota e orçamento permitirem; o registro antigo continua falho e rastreável.
- Provedor recusando, timeout e intenção inesperada conservam o custo reservado e retornam somente códigos seguros. Teto de custo impede a chamada antes da rede. Tarifa zero exige confirmação explícita e não implica promessa de gratuidade da conta.
- Uma chave em variável de ambiente exige vínculo explícito com organização e unidade, não é adotada silenciosamente no primeiro cadastro e não faz chamadas por outra unidade. Um snapshot de configuração antiga é recusado antes de reservar custo/chamar o provedor, mesmo quando a invalidação do lease não foi observada.

Todas essas chamadas de modelo usam `fetch` substituído por respostas fictícias; os testes não validam uma chave Google real, não medem qualidade/custo real do Gemini e não habilitam WhatsApp.

## Limites da evidência

- Estados de aceitação e callbacks de entrega acima pertencem ao canal fictício. Não comprovam entrega WhatsApp real ou leitura humana de uma mensagem.
- Áudio é uma marcação de entrada com transcrição opcional; não há transcritor externo. Mídia real/upload/download não foi ativado; anexos são encaminhados à equipe.
- O extrator de intenção do modelo fica desativado por padrão. Os cenários usam regras de demonstração e um teste de resposta maliciosa com `fetch` substituído localmente; não medem qualidade, latência nem faturamento de chamada real ao modelo.
- Assinatura exercitada é do endpoint de demonstração autenticado. Contrato de um provedor oficial real ainda precisa da configuração, documentação vigente e teste autorizado próprios.
- Falha do alerta interno foi provocada por destino não configurado. Não se interpreta aceitação da notificação como reconhecimento da equipe; somente ack registra ciência.
- Busca, filtros e paginação usam consultas do servidor; inspeção visual, navegação responsiva e screenshots são evidências separadas dos testes de serviço.

O estado final de `npm run check`, `npm run build`, commit, push e deploy é informado no fechamento da tarefa. Esta matriz não substitui essas verificações nem afirma que o domínio foi atualizado.
