# Atendimento virtual da Vitaliano

## O que foi integrado

O CRM agora possui inbox, conversa com contexto mínimo, reservas, controle humano, escalações reconhecíveis e saúde da operação. Usa o login, as unidades e as permissões existentes. O primeiro canal é uma demonstração persistida no banco: conversa, fila, ferramentas, reservas fictícias, tarefas e auditoria são reais no sistema; nenhum número real recebe mensagem e nenhuma mesa da operação é bloqueada.

A composição se inspira nas prévias ilustrativas Kairu de atendimento. Os nomes, endereço, horários, item de cardápio e grade de demonstração são fictícios e identificados como tal. Não foram copiados horários, promoções, contatos ou personalidade de outra rede. As imagens de referência não comprovam atendimento real.

## Telas e permissões

| Tela                   | Caminho                       | Uso                                                                       |
| ---------------------- | ----------------------------- | ------------------------------------------------------------------------- |
| Inbox/conversa         | `/crm/atendimento`            | Busca, filtros, paginação, contexto, mensagens e controles humanos        |
| Escalações             | `/crm/atendimento/escalacoes` | Motivo, trecho útil, falha do alerta, reconhecimento e responsável        |
| Saúde                  | `/crm/atendimento/saude`      | Última entrada, atraso, erros, respostas vazias, loops, tarefas e consumo |
| Informações da unidade | `/crm/atendimento/base`       | Rascunhos, aprovação, validade, cardápio, links e grade de reservas       |

`crm.ver` permite consultar; `crm.editar` permite operar; `crm.gerenciar` controla a base aprovada e a grade. O servidor exige a unidade ativa e não amplia acesso com IDs do navegador ou da mensagem. Cliente externo não obtém acesso ao painel por possuir o identificador do canal.

O contexto mostra nome conhecido, origem/atualização, preferências deste canal e reservas permitidas. CPF, finanças, notas internas, consentimentos de marketing e dados de terceiros não entram no contexto. A correção de nome cria um alias no canal e atualiza o rascunho da conversa; não sobrescreve silenciosamente o cadastro CRM.

## Iniciar a demonstração

1. Publique a migração aditiva pelo fluxo normal do projeto e entre no sistema com uma unidade ativa.
2. Abra CRM → Atendimento virtual e inicie a demonstração. A ação cria uma conta `DEMO` da unidade, contatos/identidades fictícios, conversas de exemplo e fatos versionados para o ensaio. Repetir não duplica o conjunto inicial.
3. Use o simulador da conversa para enviar mensagens fictícias, por exemplo “Quero reservar amanhã” e depois “às 19h, quatro pessoas”. O worker agrupa e processa o conjunto.
4. Confira o resumo antes de responder “confirmo”. A consulta não bloqueia vaga; a confirmação revalida a capacidade na transação.
5. Experimente assumir, responder, pausar, retomar com resumo e reconhecer a escalação. Os exemplos Kairu permanecem marcados como demonstração.

Não cole telefone, credencial nem dados reais no simulador. O adaptador aceita somente identificadores sintéticos `demo:...`; telefone internacional também é recusado como destinatário de demonstração.

## Fila, ferramentas e garantias

Os eventos são duráveis e deduplicados por conta + ID externo. Conta, organização e unidade são resolvidas no servidor. Mensagem do próprio bot, grupo e callback de entrega não viram fala de cliente. O webhook responde após a gravação e deixa modelo/ferramentas para o worker.

O worker roda no processo Next.js com leases persistidos, advisory locks transacionais e versão de conversa. O booleano local evita apenas agendamento repetido no mesmo processo; não é a trava entre réplicas. Mensagem nova ou takeover invalida a geração antiga. Morte de worker permite recuperação do lease e mantém tentativa/erro final rastreáveis. A fila tenta no máximo três vezes antes de pedir equipe.

As ferramentas liberadas são `buscar_cliente`, `consultar_unidades`, `consultar_cardapio`, `consultar_disponibilidade_reserva`, `criar_reserva`, `atualizar_reserva`, `cancelar_reserva`, `registrar_preferencia` e `escalar_para_humano`. Não há SQL livre, configuração administrativa, pagamento ou disparo em massa no agente.

Reservas usam grade própria, diferente de horário de funcionamento. Datas relativas usam o fuso da conta/unidade. Criação/alteração/cancelamento exigem resumo vigente e confirmação explícita; um token temporário e uma chave de idempotência vinculam a execução ao objeto. A capacidade é relida com lock transacional; duas conversas não confirmam a mesma última capacidade. Cancelar exige vínculo com o mesmo remetente e conta.

O modelo opcional extrai somente intenção e campos. Não escreve texto livre para o cliente, não escolhe permissões e não decide que um efeito aconteceu. O servidor renderiza a mensagem de resultado com a execução/ação/objeto reais; a outbox valida essas referências antes do envio. Consultar reserva existente não cria outra reserva.

## Fatos da unidade e conteúdo não confiável

Informações da unidade aceita rascunho separado de aprovação, autor, versão, aprovador, início e fim de validade. Conversa, anexo e página externa não aprovam ou editam essa base. Cadastro administrativo exige gestor autenticado.

Preço e disponibilidade vêm dos dados publicados. A base vencida gera encaminhamento; link ausente/indisponível é informado sem inventar destino. Os links devem ser HTTPS públicos e configurados; a resposta usa URL simples, adequada a canais que não interpretam Markdown de link.

Não há upload/download de mídia real nesta ativação. Fotos só podem vir do catálogo autorizado; nenhuma foto de prato é gerada para preencher ausência. Áudio sem transcrição confiável pede o trecho importante por texto antes de qualquer efeito. Imagem/anexo que precise de leitura vai à equipe. Ativar mídia futura exige limite de bytes, verificação do tipo real, armazenamento restrito e retenção aprovada.

## Humano assumindo e escalações

**Assumir atendimento** desabilita a IA e invalida geração/saída antiga antes da resposta manual. **Pausar IA** registra autor e prazo, ou pausa indefinida. O fim do prazo não libera automaticamente uma conversa com escalação pendente. **Retomar IA** pede o resumo do que foi resolvido quando há pendência; a retomada resolve a tarefa selecionada e entrega esse resumo ao próximo turno. Outras pendências abertas continuam segurando o agente.

**Resolver** encerra o atendimento; **Reabrir** reinicia o fluxo conforme o controle registrado. Mensagem manual e suas retentativas usam ID de requisição para evitar duplicação por recarga/dobro de clique.

Escalar cria primeiro a tarefa durável, com motivo, trecho útil, cliente/conversa e unidade. O cliente só recebe a informação de que uma pendência foi criada depois desse retorno. O alerta usa notificações internas do sistema para um usuário autorizado da unidade; o criador da demonstração é o destino inicial. Destino ausente ou sem permissão deixa erro visível. Reenviar alerta reutiliza a tarefa. Aceitação da notificação não significa ciência: **Reconhecer** registra autor, horário e responsável.

## Configuração privada e custos

### Gemini pelo painel

Abra **Atendimento virtual → Conexões** com permissão `crm.gerenciar`. A chave é inserida somente no campo privado da página HTTPS; não deve ser enviada pelo chat. Use [Google AI Studio](https://aistudio.google.com/api-keys) para criar/gerenciar a chave da sua conta.

1. Salve a chave e consulte os modelos disponíveis na API. O servidor devolve somente nomes/metadados; não devolve a chave.
2. Escolha um modelo da conta, confira as tarifas/cota aplicáveis na tabela oficial e salve a configuração. Tarifas zero exigem a mesma confirmação explícita das demais; o sistema não promete que sua conta terá cota gratuita.
3. Clique em **Testar Gemini**. É uma chamada com texto fictício, sem cliente, reserva ou WhatsApp. O custo máximo é reservado antes da rede. Há limite de três testes por hora/unidade e orçamento compartilhado com as execuções.
4. Após o resultado aprovado, ative a revisão testada. Salvar qualquer mudança desativa o modelo e invalida o teste anterior. Um teste antigo em andamento não aprova a revisão nova. O teste vale por 30 dias.

A chave fica cifrada com AES-256-GCM, vinculada à organização e unidade. GETs e auditoria não contêm chave nem ciphertext. O campo é limpo após salvar/falhar, não usa armazenamento do navegador e não acompanha uma troca de unidade. Pausar/desativar ou alterar a configuração invalida turnos pendentes; mensagens já transmitidas a um provedor não podem ser recolhidas.

`AV_CREDENTIAL_KEY` permite uma chave estável própria no ambiente privado. Sem ela, a cifra deriva de `AUTH_SECRET`. Antes de trocar o segredo de autenticação, preserve a chave efetiva ou planeje cadastrar as credenciais novamente; a falha de leitura bloqueia o modelo. Nunca imprima a chave para fazer essa manutenção.

O modo do **canal** e o **processamento** são independentes. Gemini pode interpretar mensagens fictícias no canal local; isso não significa que o WhatsApp esteja conectado. A tela Saúde informa o estado real do modelo e inclui o custo dos testes. Enquanto nenhuma chave válida tiver sido cadastrada/testada, o sistema não deve ser anunciado como atendimento com IA real.

A configuração avançada via ambiente continua disponível somente quando `AV_MODEL_ORGANIZATION_ID` e `AV_MODEL_STORE_ID` correspondem à unidade da execução. Uma chave global não é copiada silenciosamente para outra organização. A configuração salva pelo painel prevalece para sua unidade.

Stack desta entrega: Next.js **16.3.0**, React **19.2.8**, Prisma **7.9.1**, Auth.js **5 beta** conforme `package-lock.json`; ensaio com PostgreSQL **17**. Não há dependência de fila externa. A implementação usa o PostgreSQL existente.

| Variável                              | Padrão/efeito                                                               |
| ------------------------------------- | --------------------------------------------------------------------------- |
| `AV_WORKER_ENABLED`                   | Ativo salvo valor `false`; processa exclusivamente contas DEMO nesta versão |
| `AV_DEMO_WEBHOOK_SECRET`              | Opcional, mínimo 32 caracteres; ausente mantém entrada de máquina fechada   |
| `AV_MODEL_ENABLED`                    | `false`; usa `DEMO_RULES`, sem chamada paga                                 |
| `AV_GEMINI_API_KEY`                   | Chave própria do atendimento, diferente da redação de avisos internos       |
| `AV_GEMINI_MODEL`                     | Nome explícito do modelo contratado; sem valor não ativa chamada            |
| `AV_GEMINI_INPUT_MICROS_PER_MILLION`  | Tarifa de entrada em milionésimos de dólar por milhão de tokens             |
| `AV_GEMINI_OUTPUT_MICROS_PER_MILLION` | Tarifa de saída na mesma unidade                                            |

Valores reais ficam no cadastro cifrado do painel ou no ambiente privado do projeto/Dokploy. Nunca `NEXT_PUBLIC_*`, código, documentação compartilhada, screenshot ou chat. O repositório contém apenas nomes e campos vazios em `.env.example`.

Sem modelo habilitado e sem executar testes da API, a demonstração usa apenas a infraestrutura existente, sem chamada externa de modelo/canal. O teste do Gemini pode consumir a cota ou gerar custo antes da ativação; esse consumo entra no painel. Para ativar o extrator, escolha modelo e confira as tarifas do contrato na [tabela oficial Gemini](https://ai.google.dev/gemini-api/docs/pricing). Não há preço de modelo presumido. O servidor recusa configuração incompleta ou tarifa inválida.

Por conta, os limites iniciais são 4.000 tokens por turno, 30 segundos de turno, 8 execuções de ferramenta, **100.000 µUSD por turno (US$ 0,10)** e **5.000.000 µUSD de orçamento em janela móvel de 24 horas (US$ 5)**. A chamada do extrator tem timeout menor, até 15 segundos, e saída limitada. São tetos, não previsão de gasto. Uma reserva conservadora de custo precede a rede; falha com resultado incerto conserva esse débito e exige revisão, sem repetir chamada cegamente. O painel mostra consumo, erro e circuito.

WhatsApp real tem custo/contrato próprios. A [página oficial de preços WhatsApp](https://whatsappbusiness.com/products/platform-pricing/) distingue categoria e mercado; não se promete gratuidade de toda mensagem nem se mistura custo do canal com tokens do modelo.

### Configurar pelo painel

Em **Informações da unidade → Canal local e limites de operação**, um gestor com `crm.gerenciar` pode pausar/reativar a conta local, escolher destinatário dos alertas internos, ajustar intervalo de agrupamento e espera máxima, teto de tokens/custo por turno, orçamento diário e duração do circuito. A tela usa valores em segundos e dólares; o servidor mantém milissegundos e µUSD. `GET/POST /api/crm/virtual/settings` repete permissão e unidade ativa.

O destinatário precisa estar ativo e possuir acesso atual de consulta e edição do CRM nesta unidade; outro tenant/unidade ou acesso suspenso são recusados. É possível deixar o destino vazio, com falha de alerta visível quando houver escalação. Salvar é auditado e invalida turnos em andamento. Pausar a conta preserva eventos e mensagens pendentes; reativar permite continuar a fila. Isso não reativa conversas individualmente pausadas nem remove suas pendências humanas. Alterar esses controles não conecta WhatsApp nem muda a configuração dos agentes internos.

## Entrada assinada de demonstração

`POST /api/atendimento/webhook` aceita JSON de até 64 KiB, inclusive contagem dos bytes lidos. Cabeçalho `x-av-signature-256` contém `sha256=<HMAC-SHA256 do corpo original>`, usando o segredo privado de demonstração. Corpo: `{accountId, event}`. O evento exige ID externo, remetente fictício e tipo; campos extras não concedem escopo. A resposta `202` comprova gravação aceita/duplicada, não processamento, reserva ou entrega.

Callbacks fictícios usam `type: "DELIVERY"`, `providerId` e `deliveryState: "DELIVERED" | "FAILED"`, com ID externo próprio. São deduplicados e podem chegar antes da aceitação sem perder o estado final. O adaptador distingue intenção de envio, aceitação e entrega. Timeout torna a saída `UNCERTAIN`; reconciliação consulta a mesma correlação, sem novo envio. Falha definitiva fica visível; incerteza repetida vira pendência.

A outbox persiste `SENDING`, lease e correlação antes de acessar a rede. O envio ocorre fora da transação. Se o processo morrer depois da aceitação e antes de salvar o recibo, o lease vencido vira incerteza e consulta a mesma correlação; não volta a enviar. Takeover interrompe o que ainda não foi autorizado para transmissão. Uma requisição já transmitida pode terminar depois do takeover, e seu resultado permanece no histórico. Nenhuma UI deve apresentar esse caso como cancelamento garantido.

Esse contrato é de ensaio do Tetteo. Não é o contrato de webhook Meta/Evolution e não deve ser cadastrado em uma conta real como se fosse compatível.

## Ativar um canal real futuramente

Nenhuma variável desta entrega converte a conta DEMO em WhatsApp: código e CHECK do banco impedem modo real. Para ativar, é necessário implementar/selecionar o adaptador oficial, configurar a conta e realizar teste autorizado com observação do resultado.

Antes dessa ativação, conferir a [documentação oficial WhatsApp Business Platform](https://developers.facebook.com/docs/whatsapp/), fixar versão suportada, mapear a conta/número à unidade, validar autenticidade do corpo e callbacks, permissões do aplicativo, opt-in/janela de atendimento, templates quando exigidos, mídia, política de retenção e custo. A documentação técnica da Meta respondeu HTTP 429 durante a revisão; deve ser relida na configuração real. Não se trata um build verde como homologação do fornecedor.

Evolution/Baileys **2.3.7** já existe para avisos internos da Severina e continua isolada. Seu JWT autentica a chamada, mas não equivale a assinatura integral do corpo; não oferece idempotência nativa de envio. Não é API oficial nem aprovação da Meta. Não substitua seu webhook, número, agendamento ou configuração para encaixar o atendimento. Detalhes: `src/connectors/whatsapp/README.md` e `docs/operacao/whatsapp/README.md`.

## Pausar, monitorar e recuperar

- **Pausar uma conversa:** assumir ou pausar pelo inbox; verificar autor/prazo e enviar resposta humana. Isso não desliga outros agentes ou integrações.
- **Pausar o processamento do módulo:** definir `AV_WORKER_ENABLED=false` no ambiente privado e publicar pelo fluxo habitual. Eventos e histórico permanecem; essa opção não encerra processos de outros módulos.
- **Fila atrasada:** conferir worker ativo, banco disponível, `processAfter`, lease vencido, tentativas e erro no painel. O lease expirado é recuperado; não editar booleanos em memória.
- **Modelo indisponível/custo excedido:** reconhecer a tarefa, atender manualmente e revisar configuração/consumo/circuito antes da retomada. Não anunciar sucesso de ferramenta que não retornou sucesso.
- **Saída incerta:** consultar pela correlação original. Não copiar a reserva, gerar outra chave ou reenviar por reflexo. Aceitação posterior deve atualizar o mesmo registro.
- **Alerta falhou:** corrigir usuário autorizado da unidade e reenviar a mesma tarefa; reconhecer para assumir responsabilidade.
- **Base vencida:** criar/revisar rascunho e aprovar uma versão vigente. Não alterar os fatos a partir da mensagem de cliente.
- **Retomada após falha:** registrar resumo do atendimento humano, resolver a pendência correta e retomar explicitamente. O worker continua apenas o que permaneceu pendente e vigente.

Saúde reúne última entrada, atraso da fila, erros do canal, saídas vazias, loops bloqueados, escalações pendentes, alertas falhos, tokens e custo por execução/agregados. Auditoria registra referências e ação; credenciais reconhecidas são mascaradas e não viram fatos da unidade.

## Retenção e backup

Aplica-se a política atual do projeto: histórico persistido e auditável, sem apagar fisicamente registros operacionais. Não há coletor automático que remova conversas ou trilhas desta entrega. O conteúdo inicial é fictício; mídias reais não são armazenadas. Fatos de demonstração vencem em 30 dias e exigem versão nova aprovada.

Antes de receber conteúdo real, o responsável deve definir prazos de retenção/anonimização de texto, áudio/mídia e trilha, compatíveis com o histórico e a política do restaurante. Essa ativação permanece pendente; não se assume consentimento nem se inventa prazo legal. Backups do PostgreSQL preservam filas, tarefas e idempotência; segredos precisam de backup privado próprio. Restaurar o banco não deve trocar `AUTH_SECRET`/chave de identidades sem o procedimento existente do CRM.

## Verificação e publicação

`npm run check` e `npm run build` são obrigatórios antes de commit/push. Integrações usam somente PostgreSQL local `_test` e `DATABASE_URL_TESTE`; nunca o banco da VPS. Evidências: [matriz de aceite](atendimento-virtual-aceite.md), [modelo de ameaças](atendimento-virtual-threat-model.md).

A publicação segue `main` e `prisma migrate deploy` na inicialização do contêiner. Não usar `db push`, `migrate reset`, force-push ou merge forçado. Confirme o deploy no Dokploy antes de afirmar que o domínio atualizou. Publicação de uma solução na biblioteca Kairu é separada da publicação do sistema: depende de prévia e autorização próprias, usando a identidade autenticada do MCP, sem pedir dados privados no texto.
