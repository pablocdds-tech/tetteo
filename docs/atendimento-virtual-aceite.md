# Atendimento virtual — evidências de aceite

Ensaios locais com dados fictícios Kairu. Não houve envio para telefone real nem reserva real. Números de ensaio usam a faixa fictícia +1 202 555; credenciais e respostas dos testes são simuladas. A conferência operacional de configuração descrita abaixo foi somente de leitura, separada dos testes de aceite.

## Ambiente e migração

- PostgreSQL 17 local exclusivo, banco com sufixo `_test`; `scripts/ambiente-de-teste.ts` exige `DATABASE_URL_TESTE`, host local e nome de teste antes de importar o cliente.
- Schema da `main` anterior preservado como baseline fora do repositório; SQL inicial criado com `prisma migrate diff --from-empty`, aplicado somente no banco descartável.
- Migração aditiva `20261103010000_atendimento_virtual` aplicada com sucesso sobre esse baseline. Um registro fictício preexistente de organização permaneceu com mesmo ID e conteúdo.
- Migrações `20261103020000_outbox_claim` e `20261103021000_virtual_model_configuration` aplicadas no mesmo banco local. O registro preexistente continuou preservado. O índice da outbox não é recriado na migração de credenciais.
- Migração `20261103030000_severina_canais` gerada a partir do schema da HEAD anterior e aplicada no banco local. Preservou o registro preexistente e contas DEMO; acrescenta conexões/testes/janelas, capacidade real compartilhada e política versionada. A unique antiga por organização/unidade/modo vira índice; o CHECK aceita somente DEMO/EVOLUTION/META. FKs compostas e CHECKs protegem revisão, prova VERIFIED, aprovação atribuída e capacidade positiva.
- `prisma validate` e `prisma generate` passaram. A migração não altera/remove dados ou tabelas de outros módulos.
- Restrições de banco testadas diretamente: modo desconhecido, evento com organização/unidade incompatível com a conta e capacidade zero são recusados. Falhas esperadas geram somente a mensagem genérica de banco no log.

O ensaio usa baseline porque o histórico antigo de Compras tem uma migração que não reconstrói um banco vazio, conforme `docs/unificacao-crm.md`. Produção continua usando exclusivamente `prisma migrate deploy`; não há `db push`, reset ou acesso ao banco da VPS nos testes.

## Testes executados

Comando da integração:

```powershell
$env:AV_WORKER_ENABLED = 'false'
$env:AV_HISTORY_WORKER_ENABLED = 'false'
node node_modules/tsx/dist/cli.mjs --import ./scripts/ambiente-de-teste.ts --test --test-concurrency=1 src/modules/crm/services/virtual.integracao.ts src/modules/crm/services/virtual-model.integracao.ts src/modules/crm/services/virtual-channel.integracao.ts src/modules/crm/services/virtual-temporal.integracao.ts src/app/api/atendimento/_costura/receber-live.integracao.ts src/modules/crm/services/virtual-evolution-config.integracao.ts src/modules/crm/services/virtual-channel-setup.integracao.ts src/modules/crm/services/virtual-history.integracao.ts src/modules/crm/services/virtual-message-page.integracao.ts
```

Resultado agregado em 03/11/2026: **99 cenários aprovados**: 32 de atendimento/outbox, 10 do modelo privado, 15 de canais/política/qualidade, 3 das rotas reais, 5 temporais, 7 de autorização da configuração privada, 12 de preparação/conexão, 13 de importação histórica e 2 de paginação cronológica. A suíte conjunta dos oito primeiros arquivos passou em 97/97; os dois casos de paginação passaram separadamente no mesmo banco e revisão de código. Incluem agente, serviços e PostgreSQL real. As fixtures desativam suas contas ou encerram suas filas ao final; adaptadores de canal não acessam rede. A prova dos modos reais é feita com contas fictícias META/EVOLUTION no banco local, sem credencial real. Servidor de desenvolvimento e workers externos ao ensaio devem ficar desligados para não consumir a mesma fila de fixtures.

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
node node_modules/tsx/dist/cli.mjs --test src/modules/crm/services/virtual-agent-plan.test.ts src/server/atendimento-canal.test.ts src/server/atendimento-webhook.test.ts src/server/ia/credencial-atendimento.test.ts src/server/atendimento-credenciais.test.ts src/server/atendimento-webhook-normalizar.test.ts src/server/atendimento-lid.test.ts src/connectors/whatsapp/atendimento-canais.test.ts
```

Resultado: **23 testes aprovados**. Cobrem fuso/data, intenção estrita, telefone internacional, bloqueio DEMO de destinatário real, HMAC sobre bytes originais, limite real de corpo e cifra/AAD. Os catorze novos cobrem AAD de organização/unidade/conta, ciphertext adulterado, allowlist Evolution, vínculo Meta WABA/phoneNumberId, status separado de fala/entrega, instância/grupo/fromMe/LID Evolution, mídia sem download, payloads de envio dos dois provedores, timeout/5xx sem repetição, webhook existente e conciliação restrita a destinatário/tempo/marcador. PN alternativo é aceito somente no campo do transporte de uma conversa direta LID; grupos e valores ambíguos continuam recusados.

### Novas fronteiras de transporte e credenciais

- A saída persiste `SENDING`, lease e correlação antes de chamar o adaptador fora da transação. Duas réplicas executam um único envio; takeover conclui enquanto o transporte está pendente. Aceitação anterior à perda de resposta é reconciliada após o lease expirar, sem novo envio; a réplica antiga não sobrescreve a prova mais recente.
- Configuração Gemini exige gestor e unidade ativa. Chave e ciphertext não aparecem em DTO, catálogo ou auditoria; cifra copiada de outra unidade não pode ativar o modelo. FKs e CHECKs também recusam escopo incorreto e ativação sem revisão testada.
- Teste aprovado habilita somente a revisão atual. Salvar desativa e limpa o teste; conclusão de probe antigo não aprova revisão nova. Replay de teste não chama a API novamente; há limite de três provas por hora/unidade.
- Se o processo morrer após reservar custo, repetir o mesmo ID de teste depois de 60 segundos registra timeout e conserva o débito, sem nova chamada. Um novo ID explícito pode testar novamente quando cota e orçamento permitirem; o registro antigo continua falho e rastreável.
- Provedor recusando, timeout e intenção inesperada conservam o custo reservado e retornam somente códigos seguros. Teto de custo impede a chamada antes da rede. Tarifa zero exige confirmação explícita e não implica promessa de gratuidade da conta.
- Uma chave em variável de ambiente exige vínculo explícito com organização e unidade, não é adotada silenciosamente no primeiro cadastro e não faz chamadas por outra unidade. Um snapshot de configuração antiga é recusado antes de reservar custo/chamar o provedor, mesmo quando a invalidação do lease não foi observada.

Todas essas chamadas de modelo usam `fetch` substituído por respostas fictícias; os testes não validam uma chave Google real nem medem qualidade/custo real do Gemini.

### Canais reais, política e qualidade — ensaio com adaptadores fictícios

| Fronteira              | Evidência executada                                                                       | Resultado                                                                                                    |
| ---------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Configuração privada   | Gestor, unidade, cifra, DTO, auditoria e mesmo número em outra organização                | Sem segredo/ciphertext no retorno; acesso cruzado e vínculo externo duplicado recusados                      |
| Legado Evolution       | Instância reservada de avisos internos e URL fora da allowlist                            | Cadastro recusado antes de chamar provedor                                                                   |
| Ativação               | Revisão verificada, janela Meta, teste aceito, entrega e observação                       | HTTP aceito não permite ack/ativar; somente entrega + observação + modelo/fatos aprovados completa as provas |
| Revisão nova           | Salvar após teste entregue e observado                                                    | Conta desativada; revisão anterior e prova antiga recusadas                                                  |
| Idempotência do teste  | Mesmo requestId repetido                                                                  | Um envio fictício; destinatário/ator/revisão não podem trocar o significado da chave                         |
| Callback antes do HTTP | Adaptador registra entrega sem correlação antes de devolver providerId                    | Conciliação pelo ID associa o recibo durável; replay não envia de novo                                       |
| Recibos contraditórios | providerId diferente, evento duplicado adulterado, FAILED → ACCEPTED e falha após READ    | Sem troca de objeto; conflito auditado; estado não regride; callback não vira fala                           |
| Entrada real           | Sem atestado, provedor errado, conta inativa e LID não resolvido                          | Entrada não autenticada recusada; inativa retém fila sem envio; LID fica ignorado/rastreável                 |
| Identidade confiável   | Telefone CRM sem verificação válida, identidade verificada e mesma pessoa em outro tenant | Só identidade válida é reconhecida; outro tenant não herda cadastro                                          |
| Vínculo administrativo | Sem confirmação, versão velha e cadastro estrangeiro                                      | Recusados; confirmação atual cria identidades verificadas idempotentes                                       |
| Capacidade por unidade | Evolution e Meta confirmam duas pessoas na última vaga ao mesmo tempo                     | Uma criação real; DEMO não consome vaga real; redução abaixo das reservas é recusada                         |
| Fábrica de transporte  | Adaptador retorna modo diferente da conta                                                 | Nenhum envio aceito                                                                                          |
| Loop entre turnos      | Trinta execuções em cinco minutos                                                         | Agente interrompido com tarefa e código CONVERSATION_LOOP                                                    |
| Política               | Dois rascunhos concorrentes, aprovação repetida e unidade estrangeira                     | Versões distintas; aprovação idempotente; trilha sem conteúdo sensível                                       |
| Texto estático         | Link, telefone, segredo e afirmação de reserva/equipe em saudação/fallback                | Recusados; sucesso segue dependente de efeito real                                                           |
| Qualidade              | Contagem, custo, tokens, mediana, erro bruto e conta estrangeira                          | Agregados coerentes; erro sanitizado; período e conta validados no servidor                                  |

As rotas também foram testadas diretamente: desafio Meta correto não autentica POST, HMAC ausente/adulterado/outro segredo não persiste evento, e vínculo errado não recebe mensagem. O dispatcher recebe dois números da mesma organização e outro tenant com App Secret igual; somente os dois vínculos locais são processados e replay não duplica. JWT Evolution ausente, errado ou vencido e instância divergente são recusados antes de persistir; evento válido repetido cria uma fala.

Os cinco cenários temporais preservam a referência de “amanhã” enviada às 23:59 quando o complemento chega às 00:01, inclusive com recepção fora de ordem. Texto e horário de origem seguem juntos. Evento histórico com mais de 24 horas fica durável como IGNORED/STALE_EVENT; mensagem real sem horário de origem fica IGNORED/MISSING_EVENT_TIME. Ambos não geram chamada ao modelo, resposta ou reserva automática. Um “confirmo” de 60 segundos antes do resumo atual não aprova a reserva: recebe novo resumo/token. A comparação temporal tem tolerância de um segundo pela precisão do timestamp do provedor.

Os casos chamam serviços de verdade e transações PostgreSQL, com `ChannelManagementFactory` fictícia. Não constituem homologação dos servidores Evolution/Meta nem autorização para mensagens a clientes.

## Histórico do WhatsApp

A migração aditiva `20261103150000_whatsapp_history` foi aplicada somente no PostgreSQL local exclusivo. Os 13 casos de `virtual-history.integracao.ts` verificam importação em conta inativa; isolamento e permissão; revogação durante HTTP; direções, datas e sigilo; preservação do controle humano e da fila live já existente; deduplicação nos dois sentidos entre histórico e webhook, incluindo saídas do sistema; replay atual/antigo e continuação parcial; páginas repetidas e três tentativas; duas réplicas; recuperação e fencing de lease; mudança de revisão; linhas sem remetente/data confiáveis; e atualização monotônica de `lastMessageAt` sob disputa real pelo lock PostgreSQL.

Mensagens importadas ficam `source=HISTORY` e `processedAt` preenchido. O ensaio verifica ausência de execução do agente, reserva, outbox, janela de atendimento e identidade CRM criada pela importação. Conversas novas ficam abertas com IA desativada; conversas existentes conservam estado, responsável, versão e agendamento. `COMPLETE` descreve as páginas disponibilizadas pelo servidor, sem garantir que ele preserve todo o histórico do aparelho.

Os dois casos de `virtual-message-page.integracao.ts` usam 251 mensagens, inclusive datas iguais. A primeira página contém as 200 mais recentes e o cursor recupera as 51 anteriores em ordem, sem lacunas ou duplicatas. Preview da conversa continua cronológico; cursor inválido e conta de outra organização são recusados.

## Limites da evidência

### Conexão e usabilidade revisadas em 03/11/2026

O menu passou para seis áreas, com entrada explícita **Conectar WhatsApp** e abas
por tarefa. A conferência em 1440×960 e 390×844 verificou o caminho Início →
Conectar WhatsApp, o botão de QR acima da dobra em conta existente, credenciais
recolhidas, configuração sem servidor disponível, API oficial sem QR e as páginas
de informações, tom de voz, limites, monitoramento e equipe. Dados são fictícios
Kairu; as capturas de requisições/QR simulados são apenas evidência privada.

Com HTTP simulado no navegador: carregar a tela não pede QR; o clique executa
`quickSetup` → `connect`; a consulta de estado começa depois da ação e para no
limite de 45 segundos, ao confirmar a conexão ou ao trocar de conta. Trocar de
unidade descarta o QR antigo. Nenhum envio ou ativação real foi executado.

Os 19 novos casos de integração (7 de autorização da configuração privada e 12 de
preparação/conexão) usam PostgreSQL local e provedores fictícios. Cobrem chave só
no servidor, vínculo estrangeiro/ambíguo, permissão por loja/rede e revogação;
conta nova inativa, ordem existência → webhook → QR, falha de destino externo,
consulta sem regeneração e revisão alterada durante a preparação. Testes puros do
adaptador cobrem instância ausente, timeout sem repetir POST, número já conectado,
PNG inválido e erro explícito em HTTP 200. O estado final agregado das verificações
é informado no encerramento da tarefa.

Os cinco casos de concorrência da preparação cobrem duas réplicas com HTTP
pendente e segundo pedido recusado com CONNECTION_BUSY/409; recuperação de lease
expirado; revisão salva sem liberar a execução antiga; dono antigo impedido de
limpar o lease de outra réplica; e QR tardio recusado na finalização transacional,
preservando VERIFIED, horário, erro e lease da execução nova. A migração aditiva
`20261103140000_atendimento_conexao_lease` foi aplicada somente ao banco local;
seu CHECK também recusa preencher apenas uma das duas colunas do lease.

- Na entrega anterior `8076ac0`, a navegação de dez menus foi conferida em desenvolvimento. A revisão automática bloqueou a prévia local de produção com motivo “blocked by policy”; aquela tentativa não foi usada como comprovação de navegação autenticada em produção. A revisão atual acima usa os seis destinos reorganizados.

- Estados de aceitação/entrega acima foram produzidos por adaptadores e eventos fictícios, inclusive nos modos META/EVOLUTION. Não comprovam entrega WhatsApp real ou leitura humana.
- Áudio é uma marcação de entrada com transcrição opcional; não há transcritor externo. Mídia real/upload/download não foi ativado; anexos são encaminhados à equipe.
- O extrator de intenção do modelo fica desativado por padrão. Os cenários usam regras de demonstração e um teste de resposta maliciosa com `fetch` substituído localmente; não medem qualidade, latência nem faturamento de chamada real ao modelo.
- Normalização, HMAC/JWT, roteamento e payloads de envio Meta/Evolution foram exercitados com segredos/eventos fictícios. Credencial, permissões, versão instalada, autenticação do provedor real e retorno real de entrega precisam do teste autorizado no ambiente configurado antes da ativação.
- Falha do alerta interno foi provocada por destino não configurado. Não se interpreta aceitação da notificação como reconhecimento da equipe; somente ack registra ciência.
- Busca, filtros e paginação usam consultas do servidor; inspeção visual, navegação responsiva e screenshots são evidências separadas dos testes de serviço.

O estado final de `npm run check`, `npm run build`, commit, push e deploy é informado no fechamento da tarefa. Esta matriz não substitui essas verificações nem afirma que o domínio foi atualizado.

## Conferência operacional da configuração privada

A configuração administrativa para preparar conexões de clientes foi salva no
ambiente privado do Dokploy, com backup restrito e sem modificar o token individual
dos avisos. O domínio configurado foi conferido com o roteamento do contêiner
Evolution existente. Uma consulta administrativa somente de leitura retornou
HTTP 200; o corpo de instâncias não foi registrado. Nenhuma instância foi criada,
nenhum QR real foi pedido, nenhum número foi pareado e nenhuma mensagem foi
enviada nessa conferência. Credenciais permaneceram no ambiente privado.
