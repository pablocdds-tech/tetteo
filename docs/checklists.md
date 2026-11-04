# Checklists com evidências e conferência

Referência de produto: módulo oficial [Checklists e planos de ação da Kairu](https://portal.kairulabs.com.br/v3/aprender/premium/checklists-e-planos-de-acao), versão 1.2.0, consultado em 04/11/2026. Foi adaptado ao módulo existente; o MCP entrega material de referência, não analisa os dados do Tetteo.

## Preparar e compartilhar

1. Em **Checklists → Modelos**, crie as perguntas e os blocos. Use sim/não para uma checagem objetiva, número com faixa para uma medição, texto para observações subjetivas e seleção única ou múltipla para alternativas.
2. Defina por pergunta se a resposta, a foto ou o vídeo são obrigatórios. A evidência é independente do tipo: uma temperatura pode exigir número e foto.
3. Para a conferência por IA, habilite a análise e escreva o critério de aceitação. Explique o que deve aparecer na foto ou no relato, sem inventar limites operacionais. Faixas numéricas são definidas pela operação.
4. Abra a execução avulsa ou pela rotina. A execução preserva as perguntas, opções e regras da abertura: editar o modelo depois não reescreve o passado.
5. Atribua o funcionário e o prazo. Copie o link da execução ou abra o WhatsApp para compartilhá-lo. O destinatário precisa ter conta ativa, acesso à unidade e as permissões `checklists.ver` e `checklists.responder`.

O link exige login. Cada resposta e anexo usa o usuário da sessão; digitar o nome de outra pessoa não muda a autoria. O funcionário atribuído preenche a execução, e o gestor com `checklists.editar` pode intervir. Para outras unidades, escolha a unidade correta no sistema; conhecer o endereço não concede acesso.

As execuções anteriores à ampliação não guardavam todas as regras da abertura. A migração copia a configuração atualmente associada à pergunta para preservá-la dali em diante; não reconstrói uma regra antiga que nunca foi registrada. Valores, notas e autoria existentes permanecem.

## Preencher e conferir

As respostas são salvas por item. A barra informa o que foi gravado e o que ainda falta; falha de rede precisa ser corrigida antes de concluir. O servidor verifica respostas, alternativas válidas, justificativas e evidências obrigatórias. Um “não” indica que a tarefa não foi cumprida e permanece visível, com a explicação do funcionário. “Não se aplica” em um item obrigatório exige justificativa e não dispensa a evidência configurada. Itens não aplicáveis ficam identificados no histórico e fora da nota e da conferência automática; não representam uma tarefa executada.

Há três informações diferentes:

- **Preenchimento:** perguntas respondidas e evidências exigidas recebidas.
- **Conformidade declarada:** respostas sim/não e medições com faixa configurada. Texto e seleção registram informações e não geram nota objetiva por si sós.
- **Conferência:** parecer da IA ou revisão do gestor sobre o conteúdo enviado.

Concluir o preenchimento congela as respostas e gera pendências para as não conformidades objetivas. Isso não equivale a aprovar as evidências nem a corrigir o problema. A conferência usa os critérios de cada item e mantém o resultado separado da nota original. O gestor deve tratar itens reprovados ou inconclusivos e acompanhar a correção na lista de pendências.

A IA pode retornar aprovado, reprovado, inconclusivo ou indisponível. Confiança insuficiente, evidência ilegível, falha de rede, resposta inválida do provedor ou configuração ausente não viram aprovação. A revisão humana exige permissão de gestão e motivo; o resultado de uma análise antiga não deve substituir uma resposta mais recente ou uma revisão humana.

## Arquivos privados

Os arquivos ficam no armazenamento privado do servidor, em `ARQUIVOS_DIR`; o padrão de produção é `/app/arquivos`. Esse diretório precisa de volume persistente e backup. Não publique a pasta como arquivos estáticos.

Fotos aceitas: JPG, PNG e WebP, até 5 MB. Vídeos aceitos: MP4 e WebM, até 20 MB. O servidor verifica a assinatura do conteúdo e limita a quantidade por item. A leitura exige sessão, permissão e vínculo entre evidência e execução da unidade. Links de evidências não dão acesso público ao arquivo.

Arquivos e histórico não são apagados automaticamente por esta funcionalidade. Defina retenção e capacidade do volume conforme a operação. Evite filmar clientes, documentos, telas com senhas ou outras informações que não sejam necessárias ao checklist.

Os arquivos originais são mantidos privados, inclusive metadados presentes na captura. Esta entrega não remove EXIF nem comprova que a imagem foi capturada no momento do preenchimento.

## IA e configuração

A conferência usa o provedor Gemini no servidor. Configure `GEMINI_API_KEYS` (ou `GEMINI_API_KEY`) e `GEMINI_MODELO`. As chaves ficam no gerenciador de segredos do ambiente; nunca no repositório, navegador, fotos ou chat.

Sem a configuração, o módulo continua permitindo preenchimento e revisão do gestor, mas informa que a análise está indisponível. O estado de configuração não comprova que uma análise real foi concluída. Texto, fotos e vídeos necessários à conferência podem ser enviados ao provedor habilitado; confirme a política de dados aplicável à operação antes de usar informações pessoais.

O envio à IA limita as evidências agregadas de cada item a 12 MB. Acima disso, o resultado fica inconclusivo e pede conferência humana, sem enviar os arquivos ao provedor. Confiança abaixo de 80%, JSON inválido, evidência ausente no parecer ou falha de análise também não aprovam o item. O serviço usa as APIs documentadas de [geração de conteúdo](https://ai.google.dev/api/generate-content), [saída estruturada](https://ai.google.dev/gemini-api/docs/structured-output) e [compreensão de vídeo](https://ai.google.dev/gemini-api/docs/video-understanding); o modelo configurado precisa suportar os formatos usados.

## Avisos no sistema e WhatsApp

O módulo produz avisos de rotinas a cumprir, execuções cujo prazo passou, pendências e conferências que precisam do gestor. Os lembretes respeitam o fuso da unidade e não cobram a rotina antes do horário definido. A agenda recorrente e os prazos de pendência são por dia; um prazo explícito da execução é comparado com seu instante exato.

As chaves carregam a ocorrência e o estado, para que a consulta repetida não gere uma cobrança nova a cada minuto. O envio existente da Severina também limita repetição por dia e usa a fila do número conectado.

Para WhatsApp, é necessário que a conexão, o público do agente, os vínculos de telefone, o relógio e os agentes de rotina estejam configurados e liberados na Severina. A funcionalidade não ativa números, destinatários ou agendamentos por conta própria. Esses agentes também recebem conclusões ocorridas nas últimas 24 horas, até o instante atual, para avisar automaticamente o próprio autor ou o gestor com acesso à unidade. O texto informa o preenchimento concluído e, quando houver, a quantidade de não conformidades registrada no fechamento; não afirma aprovação das evidências. A deduplicação existente dos agentes é por dia: a mesma conclusão pode reaparecer após a virada do dia enquanto permanecer nessa janela.

Conclusões de qualquer checklist também geram rascunho em **Severina → Avisos**; nesse fluxo, uma pessoa escolhe um destinatário autorizado e confirma o envio. Os rascunhos continuam disponíveis em paralelo aos avisos dos agentes configurados. Modelos de fechamento preservam o tipo de evento anterior. Nenhuma mensagem real foi enviada como parte da validação da funcionalidade.

O compartilhamento manual abre o WhatsApp com a mensagem preparada. A pessoa ainda escolhe o contato e confirma no WhatsApp. Isso é diferente de um aviso enviado pela fila da Severina.

## Validação e implantação

- Executar `npm run check` e `npm run build` antes da publicação.
- Usar banco sintético local cujo nome contenha `_test` para ensaios de migração e isolamento; nunca usar produção nos testes.
- Aplicar migrações de produção somente com `prisma migrate deploy`.
- Conferir no celular: login retorna à execução, resposta parcial permanece, evidência obrigatória bloqueia conclusão, upload inválido é recusado e outra unidade não lê a execução ou o arquivo.
- Conferir IA separadamente: configuração ausente, timeout e resultado inconclusivo permanecem visíveis; revisão humana e versão mais recente prevalecem.
- Conferir entrega privada de vídeo: uma faixa válida usa HTTP 206; faixa inválida ou pedido de múltiplas faixas usa 416. A leitura continua autenticada.
- Confirmar o deployment do Dokploy antes de afirmar que o domínio está atualizado. Não testar envio de WhatsApp real com destinatários de clientes.

O modelo de ameaças desta entrega está em [checklists-threat-model.md](checklists-threat-model.md).
