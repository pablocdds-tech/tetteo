# Notas, cupons, XML e PDF no WhatsApp

## Como funciona

Envie XML, PDF ou uma foto da nota fiscal ou cupom para o WhatsApp interno da equipe. A
Severina lê fornecedor, data, itens, quantidades e valores, pergunta o que faltar
e apresenta um resumo. Sua resposta `CONFIRMAR` com o código daquele resumo
autoriza os cadastros indicados, a entrada no estoque e o lançamento financeiro.
`OK` com o código vigente também confirma; `OK` sozinho não lança. O fluxo de
leitura e avaliação está em [Leitura fiscal v2](notas-fiscais-leitura.md).

Até a confirmação há apenas a foto e a conferência. A confirmação declara também
que os produtos foram recebidos. Estoque e Financeiro são gravados na mesma
transação; a mensagem final informa os registros que foram concluídos.

## Preparar o número interno

Este recurso usa **Severina → Equipe e avisos → WhatsApp da equipe**
(`/assistente/equipe/whatsapp`) e o webhook interno
`/api/whatsapp/webhook`, pela Evolution configurada no servidor. O canal de
clientes de **Conectar WhatsApp**, que usa
`/api/atendimento/evolution/[accountId]` ou Meta, tem outro fluxo. Receber uma foto
no atendimento público não inicia lançamento financeiro.

1. Na conexão de equipe, confira a unidade à qual esse número pertence e a
   conexão com a Evolution. Com apenas uma unidade ativa na organização, o
   servidor a resolve automaticamente mesmo se a conexão estiver como rede.
   Com duas ou mais, a conexão precisa indicar a unidade específica. O envio
   precisa estar ligado.
2. No bloco **Eventos do provedor**, use **Aplicar configuração** para reaplicar
   os quatro eventos desta versão: `CONNECTION_UPDATE`, `MESSAGES_UPDATE`,
   `SEND_MESSAGE` e `MESSAGES_UPSERT`. Uma configuração antiga com três eventos
   ainda não recebe as fotos e respostas necessárias.
3. Confira o destino antes de aplicar: essa ação substitui o webhook daquela
   instância. Use uma instância interna dedicada quando o atendimento de clientes
   estiver conectado a outro webhook da mesma Evolution.
4. Em **Pessoas e números** (`/assistente/equipe/vinculos`), vincule o telefone ao
   usuário correto. Isso não libera o cadastro de notas.
5. Abra **Notas pelo WhatsApp** (`/assistente/equipe/notas`) na unidade correta.
   Confira o número receptor, o agente de notas e a lista de pessoas. Use
   **Autorizar notas** para cada número que poderá enviar e confirmar documentos.
   A permissão administrativa é `assistente.autorizar_notas`; o destinatário
   continua precisando das permissões financeiras e de estoque. Receber avisos
   é uma autorização independente. Nenhum usuário é migrado automaticamente da
   autorização de avisos para notas, nem mesmo diretor.
6. Confirme que o relógio `/api/severina/tick` está sendo chamado a cada minuto,
   com sua autenticação privada. Ele recupera mensagens pendentes quando o
   processamento inicial é interrompido. Consulte o procedimento em
   [WhatsApp — operação](operacao/whatsapp/README.md).

Envie de um telefone autorizado da equipe para o número interno conectado.
Mensagens de grupo, de contatos sem vínculo e da própria conta conectada do bot
são ignoradas. Pausar o envio interrompe também o processamento das notas. Os
agendamentos de avisos podem continuar pausados: responder a uma nota enviada
pela pessoa não depende de liberar disparos agendados.

## Usuários e cadastros necessários

O usuário deve estar ativo e ter acesso à unidade do número. O servidor verifica
esse acesso novamente no processamento e na confirmação.

| Uso                                    | Permissões                                                                |
| -------------------------------------- | ------------------------------------------------------------------------- |
| Conferir e lançar a nota               | `assistente.ver`, `estoque.lancar`, `financeiro.ver`, `financeiro.lancar` |
| Registrar compra já paga               | Também `financeiro.quitar`                                                |
| Confirmar um insumo novo               | Também `cardapio.editar`                                                  |
| Vincular números e autorizar avisos    | `assistente.vincular` e `assistente.autorizar`                            |
| Autorizar ou revogar notas por unidade | `assistente.autorizar_notas`                                              |
| Configurar a conexão interna           | `assistente.conectar` no escopo da conexão                                |
| Configurar a IA                        | `crm.gerenciar` na unidade                                                |

Antes do primeiro lançamento, mantenha ativos:

- Uma empresa/CNPJ do Financeiro pertencente à unidade compradora.
- Um local de estoque da unidade onde os produtos serão guardados.
- Uma categoria de despesa do Financeiro no grupo DRE `MERCADORIA`. Essa
  classificação preserva a apuração de CMV pelo estoque.
- Para notas pagas, a conta financeira da empresa que efetuou o pagamento.
- Os insumos existentes ou a permissão necessária para propor um novo cadastro.

Quando houver uma única opção válida de empresa, local ou categoria, ela pode
vir preenchida no resumo. Com mais de uma, a Severina pergunta. Cadastro ausente
ou inativo exige ajuste no sistema; depois responda `RESUMO` no WhatsApp.

## Preparar a leitura por IA

Na unidade correta, abra **Severina → Assistente → Inteligência artificial**
(`/assistente/configuracao`). Cadastre a chave no campo privado do painel,
escolha um modelo Gemini com leitura de imagem e configure e confirme suas
tarifas de entrada e saída, inclusive quando forem zero. Salve, use
**Testar Gemini** e ative a revisão testada. Confirme os valores aplicáveis à sua
conta; tarifa zero cadastrada não garante cota gratuita disponível no provedor.

Salvar uma mudança invalida o teste anterior. O teste da revisão vale por
30 dias. A chave fica cifrada no servidor; não deve ser enviada pelo WhatsApp,
chat ou arquivo versionado. A configuração é da organização e unidade que
usarão a leitura.

A foto inteira é enviada primeiro ao Gemini para extração; o QR é o último recurso
se a leitura visual não passar nas validações. XML e PDF
com texto são lidos diretamente. O custo máximo é reservado antes
da geração e compartilha o orçamento da unidade com o atendimento e seus
testes. Sem configuração ativa, com teste vencido ou limite de custo atingido,
a nota fica sem lançamento e a conversa orienta a revisão. A configuração por
ambiente também exige o escopo explícito da organização e unidade.

As fotos ficam no armazenamento privado do Tetteo, com autorização de leitura.
O volume persistente foi confirmado na inspeção de produção de 04/11/2026. Ele
é configurado por `ARQUIVOS_DIR`, com padrão `/app/arquivos` em produção. O
procedimento está em
[Onde os arquivos moram](superpowers/specs/2026-08-04-onde-os-arquivos-moram.md).

O volume também precisa permitir escrita pelo usuário da aplicação (UID/GID
`1001:1001`). Em 04/11/2026, o primeiro teste real identificou o volume existente
com dono `root` e modo `0755`; o dono da raiz de `tetteo_arquivos` foi corrigido
para `1001:1001`, sem alteração recursiva dos documentos ou liberação global de
escrita. A verificação foi feita no contêiner como usuário da aplicação. A imagem
prepara `/app/arquivos` com esse dono para montagens novas; volumes já existentes
precisam ter sua propriedade conferida separadamente.

O esquema enviado ao Gemini conserva tipos, estrutura, campos obrigatórios e
objetos fechados, mas omite limites e expressões que, combinados, excediam a
complexidade aceita pelo provedor. O contrato Zod completo continua validando a
resposta, inclusive limites, datas, documentos e campos desconhecidos, antes da
conferência e de qualquer lançamento.

O modelo escolhido nesta etapa permanece o Gemini atual, com tarifas confirmadas
do Free Tier. Uma segunda leitura usa recortes e o mesmo modelo, no máximo uma
vez. Falhas de rede, credencial e cota não repetem a geração. Não há modelo pago
alternativo ativado. A consulta fiscal externa permanece desativada. Encontrar QR
Code não bloqueia a leitura visual nem substitui seus dados por um pedido de XML.
Campos ausentes ou inconsistentes continuam pendentes de conferência.

## Lançar uma nota

1. Envie XML, PDF de até cinco páginas ou foto nítida em JPG, PNG ou WebP, de até
   **20 MB**, mostrando o documento inteiro. Prefira foto como documento, sem
   compressão. Envie uma nota por arquivo e conclua uma conferência antes da próxima.
2. Confira a leitura e responda às perguntas usando os números das opções. Para
   encontrar um produto durante o vínculo de item, use `BUSCAR` seguido do nome.
3. Confirme qual cadastro corresponde a cada descrição da nota. Para embalagens,
   informe quantas unidades de estoque há em cada caixa, fardo ou pacote. Vínculos
   e conversões são aprendidos após um lançamento concluído e aparecem nas
   conferências seguintes.
4. Confira se a compra está **já paga** ou **a pagar**. Para as pagas, informe
   conta, forma e data; para as que serão pagas, informe vencimentos e valores de
   cada parcela. A baixa registra o pagamento já realizado que você confirmou.
5. Confira os dados e alertas da leitura; se solicitado, responda `CONFERI LEITURA`.
   Valores ausentes ou inconsistentes continuam bloqueados. Leia o resumo final:
   fornecedor, quantidade de itens, total, cadastros propostos, unidade, local,
   empresa e pagamento. `ITENS` exibe descrições, valores e conversões. Responda
   `OK A1B2C3` ou `CONFIRMAR A1B2C3` usando o código recebido na sua conversa.
6. Aguarde **Nota cadastrada com sucesso**, com a referência da nota de entrada
   e o resultado financeiro. Depois envie a próxima foto.

Na leitura inicial, o WhatsApp mostra fornecedor, quantidade de produtos, total
e somente a próxima pergunta. Responda diretamente com o dado solicitado, sem
precisar decorar comandos: CPF/CNPJ, chave, quantidade ou valor. Ao perguntar por
acréscimo ou desconto ausente, `0` confirma somente esse campo; não apaga outro
ajuste já lido. Para código de barras ilegível, `SEM CÓDIGO` conserva a ausência.
`ITENS` mostra a lista organizada mesmo enquanto há pendências. `RESUMO` volta à
pergunta atual. Os detalhes técnicos das divergências permanecem na leitura
salva e na auditoria, sem ocupar a conversa.

Depois de corrigir os campos inválidos, `CONFERI` é a forma curta de
`CONFERI LEITURA`: confirma a leitura e abre a preparação da compra. Esse aceite
nunca lança a nota. O lançamento continua exigindo o `OK` com código do resumo
final, com todas as permissões e validações anteriores.

O código vale por 30 minutos após o envio aceito do resumo. Uma correção ou um
novo resumo muda o código e invalida o anterior. `Sim`, uma mensagem anterior ao
resumo ou um código antigo não autorizam o lançamento.

## Autorizações de notas e avisos

Em **Severina → Equipe e avisos → Notas pelo WhatsApp**, o número receptor vem da
conexão interna configurada e aparece junto à unidade. O **Agente de notas da
Severina** é o fluxo fixo de conferência, separado dos agentes de aviso. A página
mostra os telefones vinculados, a liberação para notas e, separadamente, se a
pessoa recebe avisos. Quem só envia notas vê apenas seu próprio vínculo.

Use **Autorizar notas** ou **Revogar notas** por usuário e unidade. A autorização
de avisos não é copiada: a migração começa sem nenhuma liberação de notas. Nem
diretor contorna essa exigência para enviar documentos por WhatsApp. A permissão
administrativa para alterar liberações é `assistente.autorizar_notas`; ela não
substitui as permissões de Estoque e Financeiro de quem enviará os documentos.

Revogar notas bloqueia novas entradas, processamento de rascunhos e entrega de
respostas pendentes. A transação do lançamento relê a liberação com trava de
linha. Remover ou restaurar um vínculo exige nova autorização; trocar usuário ou
telefone invalida a identidade aprovada. Formulários antigos não podem autorizar
outra unidade ou telefone, e alterações concorrentes são recusadas por versão.
Cada liberação ou revogação tem autoria e auditoria. Nenhuma revogação desfaz uma
nota já lançada. Autorizar avisos continua sendo uma decisão independente.

## Correções e retomada

| Mensagem                                                                 | Resultado                                                                                                           |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `RESUMO`                                                                 | Reapresenta a conferência e suas pendências. Se uma execução já aprovada foi interrompida, retoma a mesma operação. |
| `CORRIGIR ITEM 1 QUANTIDADE 2`                                           | Altera a quantidade impressa do item indicado.                                                                      |
| `CORRIGIR ITEM 1 VALOR 25,90`                                            | Altera o valor total da linha indicada.                                                                             |
| `CORRIGIR ITEM 1 NOME Muçarela`                                          | Corrige a descrição e pede novamente o vínculo do produto.                                                          |
| `CORRIGIR ITEM 1 UNIDADE CX`                                             | Corrige a unidade impressa e revisa sua conversão.                                                                  |
| `ALTERAR ITEM 1`                                                         | Permite escolher outro produto de estoque para o item.                                                              |
| `CORRIGIR TOTAL 123,45`                                                  | Corrige o total e pede nova conferência das parcelas.                                                               |
| `CORRIGIR FORNECEDOR Nome completo`                                      | Corrige o fornecedor; confira o documento correspondente.                                                           |
| `CORRIGIR NUMERO 12345`                                                  | Corrige o número fiscal.                                                                                            |
| `CORRIGIR DATA 04/11/2026`                                               | Corrige a data de emissão.                                                                                          |
| `ALTERAR PAGAMENTO`                                                      | Reabre a escolha de situação, forma, conta e datas.                                                                 |
| `ALTERAR LOCAL`, `ALTERAR EMPRESA`, `ALTERAR CATEGORIA`, `ALTERAR CONTA` | Reabre a escolha indicada.                                                                                          |
| `CANCELAR`                                                               | Descarta uma conferência ainda não aprovada.                                                                        |
| `CONFERI LEITURA`                                                        | Confirma campos já lidos e alertas; não completa campos ausentes nem autoriza o lançamento.                         |
| `CORRIGIR CNPJ 11222333000181`, `CORRIGIR CHAVE 44digitos`               | Corrige a identidade fiscal e revalida os dígitos.                                                                  |
| `CORRIGIR ITEM 1 PRECO 5,00`, `CORRIGIR ITEM 1 EAN SEM`                  | Corrige o preço impresso ou remove um EAN não legível.                                                              |
| `SEM AJUSTES`, `CORRIGIR DESCONTOS 1,00`, `CORRIGIR ACRESCIMOS 2,00`     | Confirma ausência ou valores dos ajustes antes do rateio.                                                           |
| `ITENS`                                                                  | Mostra os itens e as conversões da conferência atual.                                                               |

Para várias parcelas, responda à pergunta com data e valor separados por ponto
e vírgula: `10/11/2026 100,00; 10/12/2026 100,00`. Para uma parcela, basta a data
solicitada. Os valores precisam somar o total da nota.

Se uma confirmação já entrou em execução e houve interrupção, use `RESUMO` para
retomar a mesma aprovação. Essa recuperação conserva a proposta, o autor e a
chave de operação. Uma recusa de validação anterior ao lançamento permite revisar
os dados e emitir outro resumo. O cancelamento da conferência não desfaz uma
nota que já foi lançada; alterações posteriores seguem os procedimentos de
Estoque e Financeiro.

Se o resultado do envio pelo WhatsApp ficar incerto, o sistema consulta a
mensagem antes de considerar outro envio. Enquanto isso, confira a referência
no sistema em vez de cadastrar manualmente a mesma compra. As tentativas de
processamento são limitadas; a mensagem de falha orienta a conferência e a
retomada da mesma nota.

## Limites desta entrega

- A leitura aceita XML, PDF ou foto, com até 100 itens. Mensagens separadas não
  são juntadas. Layouts de PDF desconhecidos ficam pendentes e pedem XML.
- Descontos e acréscimos explícitos são rateados em centavos para preservar o
  custo líquido. Valores brutos permanecem na leitura original. Composição não
  explicada pelos valores impressos bloqueia o lançamento. Tolerância padrão:
  um centavo, configurável de zero a cinco por `NOTAS_TOLERANCIA_CENTAVOS`.
- Os produtos entram juntos no local escolhido. Pagamentos parciais, devoluções
  e alterações de uma nota já lançada usam os fluxos próprios do sistema.
- A fila limita cada pessoa a 20 fotos e 200 textos em 24 horas, somando seus
  canais na organização. Histórico com mais de 24 horas e eventos sem horário
  válido não iniciam conferência.
- Imagem idêntica já lançada, chave fiscal e número/fornecedor ajudam a impedir
  repetição; a conferência do documento e de seus identificadores continua
  necessária.
- Testes com adaptadores e dados fictícios verificam as regras do fluxo. A
  precisão da leitura precisa ser avaliada com notas reais representativas da
  operação, conferidas pelo responsável. Build aprovado não comprova acerto de
  OCR, entrega real de WhatsApp ou ativação da infraestrutura de produção.

## Referências técnicas

- [Modelo de ameaças](notas-whatsapp-threat-model.md).
- [Atendimento virtual e configuração privada do Gemini](atendimento-virtual.md).
- Entrada e fila: `src/modules/assistente/services/notas-fila.ts`.
- Conferência e confirmação: `src/app/api/whatsapp/_costura/notas-conversa.ts`.
- Recuperação e entrega: `src/app/api/whatsapp/_costura/notas-worker.ts`.
- Lançamento atômico: `src/app/api/whatsapp/_costura/lancar-nota.ts`.
