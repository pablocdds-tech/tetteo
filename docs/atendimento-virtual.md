# Atendimento virtual da Vitaliano

## O que foi integrado

O atendimento fica **dentro da Severina** e reaproveita CRM, login, unidades, reservas, notificações e permissões. Existem adaptadores separados para demonstração Kairu, Evolution e API oficial Meta. Cada conta pertence a uma organização/unidade; a mesma unidade pode ter várias contas. A demonstração continua isolada: nenhum destinatário real é aceito e nenhuma mesa real é bloqueada por ela.

A composição se inspira nas prévias ilustrativas Kairu de atendimento. Os nomes, endereço, horários, item de cardápio e grade de demonstração são fictícios e identificados como tal. Não foram copiados horários, promoções, contatos ou personalidade de outra rede. As imagens de referência não comprovam atendimento real.

## Telas e permissões

| Área              | Caminho                     | Conteúdo                                                         |
| ----------------- | --------------------------- | ---------------------------------------------------------------- |
| Início            | `/assistente`               | Conectar WhatsApp e acompanhar conversas recentes                |
| Atendimentos      | `/assistente/inbox`         | Conversas, contexto, controle humano e aba Pendências            |
| Conectar WhatsApp | `/assistente/conectar`      | Conexão por QR/Evolution ou API oficial Meta, teste e ativação   |
| Assistente        | `/assistente/configuracao`  | Abas de IA, informações da unidade, tom de voz e limites         |
| Monitoramento     | `/assistente/monitoramento` | Saúde da operação e qualidade/consumo                            |
| Equipe e avisos   | `/assistente/equipe`        | Avisos, conversas, WhatsApp, agentes, pessoas e eventos internos |

Os endereços anteriores de Evolution, Meta, Escalações, Saúde, Qualidade e Skills
encaminham para a área correspondente. As funções não foram removidas da interface.

A interface na Severina exige `assistente.ver`. `crm.ver` permite consultar; `crm.editar` permite operar; `crm.gerenciar` controla conexões, base aprovada, vínculo verificado e grade. O servidor exige a unidade ativa e não amplia acesso com IDs do navegador ou da mensagem. Cliente externo não obtém acesso ao painel por possuir o telefone. As rotas antigas do CRM redirecionam para a Severina. Avisos, agentes e números internos continuam separados.

O contexto mostra nome conhecido, origem/atualização, preferências deste canal e reservas permitidas. CPF, finanças, notas internas, consentimentos de marketing e dados de terceiros não entram no contexto. A correção de nome cria um alias no canal e atualiza o rascunho da conversa; não sobrescreve silenciosamente o cadastro CRM.

## Iniciar a demonstração

1. Publique a migração aditiva pelo fluxo normal do projeto e entre no sistema com uma unidade ativa.
2. Abra Severina → Atendimentos e inicie a demonstração. A ação cria uma conta `DEMO` da unidade, contatos/identidades fictícios, conversas de exemplo e fatos versionados para o ensaio. Repetir não duplica o conjunto inicial.
3. Use o simulador da conversa para enviar mensagens fictícias, por exemplo “Quero reservar amanhã” e depois “às 19h, quatro pessoas”. O worker agrupa e processa o conjunto.
4. Confira o resumo antes de responder “confirmo”. A consulta não bloqueia vaga; a confirmação revalida a capacidade na transação.
5. Experimente assumir, responder, pausar, retomar com resumo e reconhecer a escalação. Os exemplos Kairu permanecem marcados como demonstração.

Não cole telefone, credencial nem dados reais no simulador. O adaptador aceita somente identificadores sintéticos `demo:...`; telefone internacional também é recusado como destinatário de demonstração.

## Fila, ferramentas e garantias

Os eventos são duráveis e deduplicados por conta + ID externo. Conta, organização e unidade são resolvidas no servidor. Mensagem do próprio bot, grupo e callback de entrega não viram fala de cliente. O webhook responde após a gravação e deixa modelo/ferramentas para o worker.

As mensagens preservam a ordem pelo horário informado pelo provedor. “Hoje” e “amanhã” usam a data da fala que contém a expressão, no fuso da unidade; esperar na fila ou agrupar uma continuação depois da meia-noite não muda o dia pedido. A disponibilidade, os prazos de confirmação e os limites continuam sendo validados pelo relógio atual do servidor.

Mensagem com mais de 24 horas é registrada como `IGNORED / STALE_EVENT`, sem resposta automática, para evitar que um histórico reenviado na reconexão dispare atendimento. No canal real, a ausência do horário de origem é registrada como `IGNORED / MISSING_EVENT_TIME`; a falta desse dado não libera uma reserva. Callbacks de entrega não renovam a janela de atendimento.

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

Abra **Severina → Assistente → Inteligência artificial** com permissão `crm.gerenciar`. A chave é inserida somente no campo privado da página HTTPS; não deve ser enviada pelo chat. Use [Google AI Studio](https://aistudio.google.com/api-keys) para criar/gerenciar a chave da sua conta.

1. Salve a chave e consulte os modelos disponíveis na API. O servidor devolve somente nomes/metadados; não devolve a chave.
2. Escolha um modelo da conta, confira as tarifas/cota aplicáveis na tabela oficial e salve a configuração. Tarifas zero exigem a mesma confirmação explícita das demais; o sistema não promete que sua conta terá cota gratuita.
3. Clique em **Testar Gemini**. É uma chamada com texto fictício, sem cliente, reserva ou WhatsApp. O custo máximo é reservado antes da rede. Há limite de três testes por hora/unidade e orçamento compartilhado com as execuções.
4. Após o resultado aprovado, ative a revisão testada. Salvar qualquer mudança desativa o modelo e invalida o teste anterior. Um teste antigo em andamento não aprova a revisão nova. O teste vale por 30 dias.

A chave fica cifrada com AES-256-GCM, vinculada à organização e unidade. GETs e auditoria não contêm chave nem ciphertext. O campo é limpo após salvar/falhar, não usa armazenamento do navegador e não acompanha uma troca de unidade. Pausar/desativar ou alterar a configuração invalida turnos pendentes; mensagens já transmitidas a um provedor não podem ser recolhidas.

`AV_CREDENTIAL_KEY` permite uma chave estável própria no ambiente privado. Sem ela, a cifra deriva de `AUTH_SECRET`. Antes de trocar o segredo de autenticação, preserve a chave efetiva ou planeje cadastrar as credenciais novamente; a falha de leitura bloqueia o modelo. Nunca imprima a chave para fazer essa manutenção.

O modo do **canal** e o **processamento** são independentes. Gemini pode interpretar mensagens fictícias no canal local; isso não significa que o WhatsApp esteja conectado. A tela Saúde informa o estado real do modelo e inclui o custo dos testes. Enquanto nenhuma chave válida tiver sido cadastrada/testada, o sistema não deve ser anunciado como atendimento com IA real.

A configuração avançada via ambiente continua disponível somente quando `AV_MODEL_ORGANIZATION_ID` e `AV_MODEL_STORE_ID` correspondem à unidade da execução. Uma chave global não é copiada silenciosamente para outra organização. A configuração salva pelo painel prevalece para sua unidade.

Stack desta entrega: Next.js **16.3.0**, React **19.2.8**, Prisma **7.9.1**, Auth.js **5 beta** conforme `package-lock.json`; ensaio com PostgreSQL **17**. Não há dependência de fila externa. A implementação usa o PostgreSQL existente.

| Variável                              | Padrão/efeito                                                             |
| ------------------------------------- | ------------------------------------------------------------------------- |
| `AV_WORKER_ENABLED`                   | Ativo salvo valor `false`; processa contas configuradas e ativas          |
| `AV_DEMO_WEBHOOK_SECRET`              | Opcional, mínimo 32 caracteres; ausente mantém entrada de máquina fechada |
| `AV_MODEL_ENABLED`                    | `false`; usa `DEMO_RULES`, sem chamada paga                               |
| `AV_GEMINI_API_KEY`                   | Chave própria do atendimento, diferente da redação de avisos internos     |
| `AV_GEMINI_MODEL`                     | Nome explícito do modelo contratado; sem valor não ativa chamada          |
| `AV_GEMINI_INPUT_MICROS_PER_MILLION`  | Tarifa de entrada em milionésimos de dólar por milhão de tokens           |
| `AV_GEMINI_OUTPUT_MICROS_PER_MILLION` | Tarifa de saída na mesma unidade                                          |

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

## Conectar Evolution ou API oficial

Os dois adaptadores estão implementados. Credenciais e testes reais permanecem sob controle do gestor no painel HTTPS. Salvar uma conta nunca ativa o atendimento. Os testes automatizados usam mensagens fictícias e HTTP simulado; não comprovam entrega real.

1. Em **Configuração**, cadastre/teste/ative o Gemini e confira tarifas e teto de consumo.
2. Abra **Conectar WhatsApp** e escolha **Ler QR no celular** ou **API oficial (Meta)**. Se a configuração privada do Evolution estiver autorizada para sua organização e seu acesso, preencha somente o nome opcional e clique em **Gerar QR Code**. Caso precise de outro servidor, abra a configuração avançada e informe as credenciais privadas. Eles ficam cifrados e não são devolvidos em GET/auditoria. Campos omitidos na edição preservam o segredo existente; salvar desativa a conta, invalida a revisão/teste e as respostas antigas. Alterar número/instância exige outra conta para manter a reconciliação do histórico.
3. Em **Assistente → Informações da unidade**, selecione o número, publique fatos reais com validade e configure a grade. Escolha o responsável e o orçamento em **Limites e responsáveis**. Evolution e Meta compartilham capacidade por unidade/data/horário; a demonstração fica fora dessa capacidade.
4. Faça a configuração específica abaixo. Verifique a conexão da revisão atual.
5. Envie o teste **somente para um número de teste que você controla**, marcado explicitamente no formulário. A mensagem é fixa, tem ID durável e limite de três testes/hora/conta. Na Meta, envie primeiro “oi” do telefone de teste para o número comercial para abrir a janela de 24 horas.
6. Aguarde callback autenticado de **entrega** e confirme no painel que observou a mensagem. Aceitação HTTP isolada não habilita a ativação. Em timeout, **Consultar teste** reconcilia a mesma tentativa, sem reenviar.
7. Ative a conta. O servidor exige revisão verificada, webhook autenticado, entrega + observação, Gemini ativo e fatos aprovados vigentes. Use **Pausar canal** para suspender sem apagar histórico; uma conversa pode continuar pausada individualmente.

### Evolution

O botão **Gerar QR Code** confirma se a instância existe, cria somente uma instância
ausente, prepara o recebimento de mensagens e pede o QR. Um destino de eventos de
outro sistema é recusado. O código aparece junto das instruções
**WhatsApp → Dispositivos conectados → Conectar dispositivo**. Depois da ação, a
tela consulta a conexão por até 45 segundos e mostra a confirmação retornada pelo
provedor. Trocar de conta/unidade ou sair interrompe essa consulta e remove o QR.
Um número já conectado é reconhecido sem apresentar erro de QR indisponível.

A preparação é protegida no banco por conta, inclusive entre duas abas ou réplicas.
Se outra preparação estiver em andamento, aguarde sua conclusão antes de tentar
novamente. Uma execução interrompida libera nova tentativa após o lease de dois
minutos; a tentativa seguinte consulta a existência antes de criar. As chamadas ao
provedor ocorrem fora da transação do banco.

A opção rápida exige uma chave administrativa explícita `AV_EVOLUTION_API_KEY`
no ambiente privado do aplicativo. O token individual `EVOLUTION_API_KEY` dos
avisos não autoriza criar outra instância e nunca é usado como alternativa para
essa preparação. A chave global da Evolution corresponde a
`AUTHENTICATION_API_KEY`; seu valor não entra em código, GET, documentação ou chat.
A [autenticação da versão 2.3.7](https://github.com/EvolutionAPI/evolution-api/blob/2.3.7/src/api/guards/auth.guard.ts)
confere privilégios diferentes para criação e rotas de uma instância existente.

A opção rápida usa essa configuração privada somente quando a instância
legada possui vínculo único com a organização autenticada e o operador tem
`crm.gerenciar` na unidade do atendimento e `assistente.conectar` no escopo da
conexão original (inclusive acesso de rede se ela for global). O identificador
e o segredo da nova instância de clientes são gerados no servidor. A chave nunca
é devolvida ao navegador e a instância antiga não é reaproveitada. A preparação
cria uma conta inativa; teste e ativação continuam explícitos. Timeout de criação
não repete POST automaticamente: a próxima tentativa começa pela consulta.

Use uma instância **exclusiva para clientes**. As instâncias `EVOLUTION_INSTANCIA` dos avisos internos e `COMPRAS_EVOLUTION_INSTANCIA` de Compras são recusadas no mesmo servidor. Essa proteção também é revalidada antes de acessar o provedor. Se necessário, crie a nova instância com o botão do painel (a chave precisa de permissão de criação), configure o webhook e gere o QR privado. Não desconectamos nem substituímos a instância da equipe. O QR expira na interface e não deve ser compartilhado em prints.

O servidor permite apenas `EVOLUTION_URL` e a lista administrativa `AV_EVOLUTION_ALLOWED_ORIGINS` (origens/base URLs separadas por vírgula). Campos do navegador não abrem URL arbitrária; redirects são recusados. Adicionar servidor exige configurar essa lista no ambiente privado, sem gravar a API key no arquivo. Um webhook diferente já existente exige confirmação explícita de substituição; nunca use essa opção na instância interna.

Contrato consultado: Evolution/Baileys **2.3.7**, [DTO de envio](https://github.com/EvolutionAPI/evolution-api/blob/2.3.7/src/api/dto/sendMessage.dto.ts), [webhook](https://github.com/EvolutionAPI/evolution-api/blob/2.3.7/src/api/integrations/event/webhook/webhook.controller.ts). O JWT HS256 autentica a chamada, mas não assina o corpo; exige TLS e segredo privado forte. Eventos são vinculados à instância. LID sem telefone alternativo autenticado não é convertido em número. Não existe idempotência nativa de envio: a outbox persiste a intenção e usa um protocolo visível único para reconciliar por destinatário, período e mensagem. Se faltar prova, mantém incerteza e pede conferência humana.

Evolution não é API oficial nem aprovação da Meta. Seus requisitos, estabilidade e riscos são diferentes. Os avisos internos continuam usando seu conector/webhook anterior; veja `src/connectors/whatsapp/README.md`.

### Meta WhatsApp Business Platform

Configure **Phone Number ID**, **WABA ID**, token de acesso com permissões adequadas, App Secret e Verify Token no painel privado. A versão inicial é **v26.0**, consultada no [SDK oficial](https://github.com/facebook/facebook-nodejs-business-sdk/blob/main/src/api.js). O host é fixo `graph.facebook.com`; a aplicação não aceita um host escolhido pelo navegador.

Cadastre no aplicativo Meta o callback HTTPS mostrado pelo painel e o mesmo Verify Token privado. Valide o desafio e assine o campo `messages`; use **Configurar webhook** para assinar a WABA no aplicativo. Cada mensagem/status precisa ter WABA + Phone Number ID correspondentes e assinatura `X-Hub-Signature-256` do corpo original. Aplicativos compartilhados entre números usam um callback âncora na mesma organização; cada destino ainda precisa validar sua própria assinatura e metadados. Organizações distintas não são roteadas pelo mesmo endpoint.

Esta entrega envia texto livre somente dentro da janela de 24 horas aberta por mensagem autêntica do cliente. Templates de marketing/utilidade fora da janela e envio de mídia ainda não estão habilitados neste atendimento. Não invente um template aprovado nem confunda o Feed de Disparos dos avisos internos com uma campanha de clientes. A correlação `biz_opaque_callback_data` ajuda a conciliar timeout quando o provedor a devolve; sem callback correlacionado, o sistema não reenvia cegamente. Não existe consulta genérica inventada de status por ID.

Consulte a [documentação oficial WhatsApp](https://developers.facebook.com/docs/whatsapp/) e a [coleção oficial Meta](https://www.postman.com/meta/whatsapp-business-platform/folder/o48mro7/messages) ao configurar permissões, número e aplicativo. Parte da documentação técnica respondeu HTTP 429 nesta revisão; o contrato precisa ser conferido no teste autorizado do ambiente real. Custo/categoria/mercado são os do contrato vigente, não os tokens Gemini. Nenhuma chave, QR ou entrega real foi validada apenas por build.

### Cliente conhecido no canal real

Não se procura cadastro pelo nome digitado nem por um telefone encontrado no texto. O remetente internacional autenticado consulta identidade verificada da conta ou identidade `PHONE` verificada da mesma unidade/organização, criando então o vínculo da conta. Onde o CRM antigo só possui telefone sem prova, a conversa atende dúvidas públicas e coleta apenas o próximo campo necessário. Um gestor pode buscar o contato e registrar um vínculo explícito após a verificação humana no painel; a evidência deve incluir mensagem recebida no webhook autenticado. Outra unidade/organização não herda o cadastro. Preferências e reservas consultadas continuam restritas à conta da conversa.

### Skills e Qualidade

Skills publica versões de estilo, saudação e mensagem de ajuda. Não altera ferramentas, permissões ou fatos automaticamente. Links/contatos ficam na base operacional e confirmações de ação vêm do resultado real da ferramenta. Qualidade usa execuções e falhas reais em 7/30/90 dias; não apresenta uma nota fictícia de satisfação.

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
