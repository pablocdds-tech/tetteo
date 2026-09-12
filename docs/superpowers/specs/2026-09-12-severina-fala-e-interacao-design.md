# Severina — a fala e a interação

**Data:** 12/09/2026
**Módulo:** `assistente` (Severina)
**Estado:** desenho aprovado, pronto para virar plano de implementação
**Continua:** [2026-08-04-severina-whatsapp-design.md](2026-08-04-severina-whatsapp-design.md)

---

## 1 · O que é

A fase 1 está no ar desde 11/09/2026: a Severina fala sozinha, no horário. Só que a conversa morre no aviso — se a pessoa responde, a mensagem cai no vazio e o sistema nem a grava.

O pedido do dono, em 11/09: _"por mim ela pode agir como uma pessoa normal, falar e interagir"_.

Este documento desenha isso. Ele **não** trata do que ela puxa por conta própria (o gatilho de discrepância, fase 1.5): trata do que ela **responde**.

### A origem do desenho

A biblioteca da Kairu foi consultada antes de qualquer decisão. Não há material sobre tom de voz; há um sobre arquitetura de assistente que conversa — _"Atenda com IA que conhece a operação"_, revisado em 09/09/2026, extraído do próprio atendimento Severina/Cida da Nina.

A frase dele que governa este desenho:

> "Não entregue apenas um system prompt: o pedido é construir o sistema que dá contexto, ferramentas e controle ao agente."

Três itens vieram de lá e não estavam no desenho de agosto: **juntar mensagens seguidas**, **conferir a afirmação antes de enviar**, e **assumir a conversa pausando a IA**. Os três estão aqui.

### A tensão que precisa ficar registrada

O desenho de agosto tem uma regra forte: _"auditor que grita todo dia é auditor mudo em duas semanas"_ — no máximo uma mensagem por assunto por dia.

Falar **melhor** e **responder quando falam com ela** não brigam com isso. Falar **mais** briga. Nada neste documento aumenta o volume de mensagens que ela inicia.

---

## 2 · Decisões travadas

| Decisão               | Escolha                                                   | Por quê                                                                                                                |
| --------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Alcance**           | Consultar, responder **e** escrever                       | Escolha do dono. Mitigada pela ordem em duas etapas abaixo                                                             |
| **Ordem**             | Etapa 1 só lê; etapa 2 escreve                            | O encanamento é onde moram os erros chatos. Melhor descobri-los com ela dizendo "faltam 6 itens" do que mexendo no CMV |
| **Identidade**        | Uma Severina só — a conversa é da pessoa, não do agente   | É o que faz ela lembrar do que já disse. Conversa por agente responde sem saber o que ela mesma falou às 8h            |
| **Voz**               | Gente de casa, curta, sem emoji, variando as frases       | Uma voz para a Severina inteira; o agente muda o assunto, não a personalidade                                          |
| **Quem responde**     | Um "agente de conversa", criado na tela                   | Sem ele criado, ela **não responde nada** — a interação liga quando o dono decidir                                     |
| **Processamento**     | `after()` do Next.js, com varredura do relógio como rede  | Verificado nos guias da 16.3: estável e suportado em contêiner Docker                                                  |
| **Juntar mensagens**  | Espera de ~8 s antes de pensar                            | "mussarela" + "12 e meio" é uma informação em duas linhas                                                              |
| **Fechar contagem**   | Palavra-chave conferida por código, argumentos congelados | Vem de agosto, e continua valendo                                                                                      |
| **Anotar quantidade** | Sem palavra-chave; eco do que entendeu                    | Confirmar item a item numa contagem de 40 linhas seria insuportável, e ninguém usaria                                  |
| **Áudio**             | Aceito, transcrito, **não guardado**                      | É como a cozinha fala. Descartar o arquivo evita o muro do armazenamento                                               |

---

## 3 · O que ela passa a fazer

### Etapa 1 — ela consulta e responde

> **Severina:** Bom dia, João. A contagem "contagem freezer" é para hoje.
> **João:** quanto falta?
> **Severina:** Faltam 6 itens dos 14. Os que faltam são mussarela, calabresa e mais 4.
> **João:** já contei isso ontem
> **Severina:** A de ontem foi fechada às 19h. Esta é a de hoje, ainda aberta.

### Etapa 2 — ela escreve

> **João:** mussarela 12 e meio
> **Severina:** Anotei 12,5 kg de mussarela.
> **João:** calabresa 8
> **Severina:** O Pedro já anotou 9 kg de calabresa às 8h10. Troco pelo seu 8 ou mantenho o dele?

O último caso não é um erro tratado: é a trava de concorrência que o Estoque **já tem** aparecendo na conversa. `salvarQuantidades` exige o valor-base e recusa a escrita quando ele mudou, em vez de sobrescrever o trabalho de outra pessoa.

---

## 4 · A voz

Uma voz só para a Severina inteira. A caixa de instruções de cada agente continua mandando no **assunto**; a personalidade não vem mais de lá.

- **Chama pelo primeiro nome** e cumprimenta conforme a hora. Hoje ela não sabe com quem fala; passa a saber, porque o vínculo diz quem é.
- **Frase curta, no máximo 3 linhas.** Fica como está.
- **Sem emoji, sem formalidade de escritório.** Fica como está.
- **Varia as frases.** Hoje o mesmo aviso sai idêntico três dias seguidos. Repetição literal é o que mais denuncia robô.
- **Na primeira conversa com alguém, se apresenta.**
- **Nunca inventa** número, nome ou prazo — só usa o que a ferramenta devolveu.
- **Nunca afirma o que não fez** (§7).
- **Quando não sabe, diz que não sabe** e oferece o que alcança.

> **Pré-requisito operacional:** em produção o redator está desligado — sem `GEMINI_API_KEYS` configurada, ela manda o fato cru. Toda esta seção depende de ligar a chave. Sem ela, a etapa 1 não funciona: não existe "fato cru" para responder a uma pergunta.

---

## 5 · O caminho da mensagem chegando

Rota nova: `/api/whatsapp/webhook`, com segredo próprio — fechada quando o segredo não está configurado, como `/api/severina/tick`.

```
1. confere o segredo               → errado: 401, fim
2. já vi este idExterno?           → sim: 200 e para
3. quem é? remoteJid → vínculo     → não achou: DESCARTA sem gravar, 200
4. é grupo?                        → ignora
5. grava ENTRADA, responde 200     → a Evolution não espera ela pensar
6. after(): processa depois da resposta
```

O passo 3 é o que mantém os 1016 contatos pessoais do número fora do banco de gestão. Nem o texto, nem o número, nem o registro de que existiu.

### O passo 6, em detalhe

**Espera ~8 segundos antes de pensar.** É o "juntar mensagens" da Kairu. Se chegar mensagem nova durante a espera, a rodada anterior desiste em favor da mais recente: uma resposta só, com tudo junto.

**Pega uma tranca da conversa no banco** antes de pensar. Duas mensagens simultâneas, dois contêineres ou um reenvio da Evolution não produzem duas respostas. A tranca expira sozinha em 2 minutos, para uma queda no meio não deixar a conversa muda para sempre.

**A rede de segurança:** `after()` roda no mesmo processo. Se o contêiner reiniciar naquele instante — um deploy, por exemplo —, o pensamento se perde. Por isso o relógio, que já bate a cada minuto, ganha uma varredura: _mensagem que entrou há mais de 2 minutos e ninguém processou, processa agora_. Atrasada é melhor que nunca.

É o mesmo princípio que já sustenta a fila de saída: gravar primeiro, entregar depois, e ter quem varra o que ficou para trás.

**A saída reaproveita tudo:** a resposta entra na fila de sempre, com o ritmo de uma mensagem por vez. Nenhum risco novo de bloqueio do número.

**Consequência honesta:** a resposta leva entre 10 e 40 segundos. É conversa com alguém que está trabalhando, não chat de site.

---

## 6 · Uma Severina só, e o assunto que carrega a loja

Hoje três agentes falando com o João são **três conversas** no banco e **uma** no celular dele. Passa a ser uma conversa por pessoa e número, permanente. Os agentes continuam levantando assunto; cada mensagem guarda qual agente a gerou, no campo `origem` que já existe.

### O problema que isso cria, e a solução

O desenho de agosto garantia: _"a resposta '12 kg' sabe de qual estoque é porque a CONVERSA sabe"_. Com a conversa passando a ser da pessoa, quem trabalha em duas lojas perde o endereço.

**A conversa passa a guardar o assunto atual:** qual agente levantou, **qual loja**, e a que referência se liga. O aviso das 7h sobre o freezer da Centro define o assunto; a resposta das 7h05 herda a loja dali.

**E o assunto vence.** Passado o prazo — limite configurável, não número escondido no código —, ela não assume mais nada: pergunta. "12 quilos" caindo na contagem de três dias atrás é o erro que estraga o CMV em silêncio.

Quem trabalha numa loja só nunca vê essa pergunta: a loja vem do acesso da pessoa.

### O que ela lembra ao pensar

A conversa guarda tudo; o modelo recebe as últimas mensagens — da ordem de 20, ou das últimas 24 horas — mais o assunto atual. Memória demais custa caro, fica lenta, e traz de volta coisa que ninguém pediu.

### A tela

A aba Conversas passa a mostrar **uma linha por pessoa**, com a última mensagem, como um WhatsApp. As falhas de envio continuam subindo para o topo — a ordenação atual está certa e fica.

### A migração

Em produção isso é meia dúzia de mensagens: a fase 1 começou a falar em 11/09. Juntar as conversas existentes numa linha do tempo por pessoa é um script curto **hoje**; daqui a três meses, com a equipe conversando, é outra história.

---

## 7 · O que ela pode fazer quando alguém pede

### O registro de ferramentas cresce

Cada módulo declara hoje só `avisos`. Passa a declarar `ferramentas`: nome, descrição, **permissão exigida**, formato dos parâmetros e o que executar. Quem é dono da regra continua dono.

| Etapa | Ferramenta do Estoque     | Permissão        | Serviço que já existe |
| ----- | ------------------------- | ---------------- | --------------------- |
| 1     | contagens abertas da loja | `estoque.ver`    | `listarContagens`     |
| 1     | o que falta contar        | `estoque.ver`    | `obterContagem`       |
| 1     | rotinas atrasadas         | `estoque.ver`    | `listarRotinas`       |
| 2     | anotar quantidade         | `estoque.contar` | `salvarQuantidades`   |
| 2     | fechar contagem           | `estoque.contar` | `fecharContagem`      |

### As duas peneiras

```
o que o dono liberou   ∩   o que aquela pessoa pode
```

A mais restritiva vence, e o modelo **nunca enxerga** o que está fora — não escolhe errado entre trinta opções porque nunca vê trinta.

### De quem são as ferramentas, agora que a conversa não é de um agente

De um **agente de conversa**: um agente marcado como _"é este que responde quando falam com ela"_. Ele concentra instruções, ferramentas liberadas e limites das respostas. Os agentes de aviso seguem levantando assunto.

Isso dá o padrão seguro de graça: **sem esse agente criado, ela não responde nada** — segue como hoje, falando e não escutando. A interação liga numa tela e desliga do mesmo jeito.

### As travas antes de executar

| Trava                            | Contra o quê                              |
| -------------------------------- | ----------------------------------------- |
| Formato conferido antes de rodar | "doze quilos e meio" virando número torto |
| `pode(contexto, permissão)`      | ela agir além do que aquela pessoa pode   |
| Janela de horário                | ação fora do expediente                   |
| Teto de ações por conversa       | laço infinito com dinheiro no meio        |

A permissão nunca é decisão do modelo: ele pede, o código decide, com o contexto da pessoa real.

### Nunca afirmar o que não fez

O laço registra quais ferramentas rodaram e com que resultado. Antes de enviar, a resposta é conferida contra esse registro: se ela diz "anotei" e nenhuma escrita voltou com sucesso naquela rodada, **a mensagem não sai** — ela refaz.

É rede, não prova: nenhuma checagem entende português perfeitamente. Mas é a diferença entre um erro que aparece e um que a equipe só descobre no fechamento do mês.

### Assumir a conversa

- **Assumir** — a IA para na hora, inclusive uma resposta que já estava sendo escrita. Se alguém assumiu enquanto ela pensava, o que estava na fila é descartado em vez de sair por cima da fala da pessoa.
- **Pausar por um tempo** — ela cala nas respostas, e **os avisos programados continuam**. Pausar conversa não pode desligar a cobrança da contagem. Para desligar tudo continua existindo a chave geral do número.

---

## 8 · A etapa 2 — escrever

**Anotar quantidade.** Lê o valor atual como base e grava. Conflito vira pergunta, não sobrescrita. Sem palavra-chave: confirmar item a item numa contagem de 40 linhas seria insuportável, e ninguém usaria. A proteção é o eco — ela repete o que entendeu, e corrigir é dizer o número certo de novo.

**Fechar contagem.** Exige palavra-chave, e **o modelo não participa da confirmação**:

```
Severina:  Contagem do freezer: 14 itens, R$ 3.847,20.
           Responda FECHAR para confirmar.

"fechar"       → texto.trim().toUpperCase() === "FECHAR" → executa
"pode fechar"  → não é a palavra → pergunta de novo
[10 minutos]   → o pedido expira, e ela avisa
```

Os argumentos ficam **congelados** enquanto ela espera: nem uma confirmação mal lida muda o que será feito.

**Áudio.** Transcrito, com devolutiva escrita obrigatória antes de gravar qualquer coisa: _"Entendi: 12,5 kg de mussarela. Responde OK ou corrige."_ Na prática, uma confirmação por item — preço aceito conscientemente em agosto.

**O arquivo do áudio não é guardado.** Transcreve e descarta; fica o texto. Por isso o áudio não esbarra no muro do armazenamento, que ainda barra a foto do Checklists e a da nota fiscal.

---

## 9 · Quando dá errado

| Situação                     | O que ela faz                                                                                               |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------- |
| IA fora do ar ou sem chave   | Tenta de novo na varredura do relógio. Persistindo, manda uma linha honesta: "não consegui responder agora" |
| A ferramenta recusou         | Conta o motivo sem enfeitar: "essa contagem já foi fechada às 19h"                                          |
| Outra pessoa salvou no meio  | Pergunta qual valor vale                                                                                    |
| Ferramenta fora das peneiras | Não executa, e ela diz que não pode fazer isso                                                              |
| Pessoa sem vínculo escreveu  | Descarta sem gravar                                                                                         |
| Tranca da conversa presa     | Expira em 2 minutos e a varredura assume                                                                    |

A diferença que importa: no **aviso**, o fato cru já é mensagem útil quando a IA cai — foi assim que a fase 1 foi desenhada. Na **conversa** não existe fato cru para mandar. Aqui o certo é tentar de novo e, no fim, admitir.

---

## 10 · Testes e aceite

Ensaio com banco local, como o projeto já faz:

- Mensagem repetida pela Evolution não vira duas respostas
- Duas mensagens seguidas viram **uma** resposta, com as duas informações
- Alguém assume a conversa enquanto ela pensa → a resposta pronta é descartada
- Assunto de ontem → ela pergunta a loja em vez de adivinhar
- Pessoa sem vínculo → nada é gravado, nem o texto
- Afirmação de ação sem ferramenta bem-sucedida → a mensagem é bloqueada
- "pode fechar" não fecha; `FECHAR` fora do prazo também não
- Contêiner reiniciado no meio do `after()` → a varredura responde atrasado

**Aceite de verdade:** contar o freezer inteiro pelo WhatsApp, de dentro da câmara fria, e conferir na tela que os números bateram — inclusive um item contado por duas pessoas ao mesmo tempo, de propósito.

---

## 11 · Fora de escopo

| Fora                                   | Por quê                                                                       | Quando volta                           |
| -------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------- |
| **Gatilho de discrepância (fase 1.5)** | É sobre o que ela _puxa_, não o que _responde_. Outro eixo                    | Desenho próprio                        |
| **Agentes de Coleta**                  | Questionário configurável com respostas guardadas é outra coisa que conversar | Quando houver motivo                   |
| **Foto**                               | Depende do armazenamento persistente que o Tetteo não tem                     | Quando houver decisão de armazenamento |
| **Atendimento a cliente**              | Depende de Cardápio, Delivery e CRM                                           | Quando esses módulos existirem         |

---

## 12 · Resumo das mudanças no banco

- `ConversaWhatsapp`: deixa de pertencer a um agente; ganha os campos do assunto atual (agente, unidade, referência, quando), a tranca de processamento, e a trava de uma conversa por pessoa e número
- `MensagemWhatsapp`: ganha "processada em", que é o que a varredura do relógio consulta
- `AgenteSeverina`: ganha a marca de "é este que responde às conversas"
- Migração: juntar as conversas existentes numa linha do tempo por pessoa

---

## 13 · Notas para a implementação

- **Antes de escrever código:** ler os guias em `node_modules/next/dist/docs/`, conforme o `AGENTS.md`. O `after()` está em `03-api-reference/04-functions/after.md`; vale conferir também `maxDuration` no route segment config, porque é ele que limita quanto tempo o processamento pode durar
- `npm run check` antes de todo commit
- Variável nova: `SEVERINA_WEBHOOK_SEGREDO`, já prevista no desenho de agosto
- A Evolution precisa ser configurada para entregar o evento de mensagem recebida no endereço do webhook — hoje ela só é usada para enviar
- `GEMINI_API_KEYS` precisa estar configurada em produção. Sem ela, a etapa 1 não funciona
- Duas etapas, dois planos: a etapa 1 (só leitura) vira plano próprio; a etapa 2 (escrita) se escreve depois, com o aprendizado do uso real dentro
