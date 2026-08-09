# José — o CRM que decide o que ofertar

**Data:** 09/08/2026
**Módulo:** `crm` (o App) + a persona **José** (um agente da Severina)
**Estado:** desenho aprovado, pronto para virar plano de implementação — uma fase por vez

---

## 1 · O que é

O José é o agente que responde três perguntas que hoje ninguém responde na Vitaliano:

1. **Quem sumiu** — e vale a pena chamar de volta
2. **O que oferecer a essa pessoa** — baseado no que ela já pedia
3. **Até onde dá para baixar o preço** — sem furar o CMV alvo

A terceira é a que justifica o projeto. Ferramenta de disparo existe às dezenas no mercado; nenhuma delas conhece a sua ficha técnica. O José conhece — e por isso é o único que consegue dizer *"nessa calabresa você pode dar R$ 11 de desconto, na margherita só R$ 4"*.

Ele **não conversa com cliente**. Ele fala com o dono, propõe, e — a partir da fase 4 — dispara o que foi aprovado.

---

## 2 · Decisões travadas

Tomadas na conversa de 09/08. Estão aqui para que ninguém — inclusive nós — as reabra por engano daqui a seis meses.

| Decisão | Escolha | Por quê |
| --- | --- | --- |
| **Fonte do cliente** | Cardápio Web, via API aberta | É o único canal onde o telefone é real e é seu |
| **iFood** | Fora | Telefone mascarado. Não há ninguém para chamar |
| **Saipos** | Fora | A API pública dele só *recebe* pedido; não devolve histórico nem cliente |
| **Quem decide a oferta** | Tetteo | Depende de CMV, margem e estoque — só existe aqui |
| **Quem dispara** | Fases 1–3: Food Marketing, à mão · **Fase 4: o Tetteo** | O passo manual semanal não sobrevive à rotina de uma pizzaria |
| **Canal do disparo** | **API oficial da Meta**, nunca QR Code | O dono já foi bloqueado uma vez em disparo não-oficial. Ver §12 |
| **Aprovação humana** | Obrigatória, toda campanha | IA escolhendo desconto e gastando com envio sem ninguém olhar não entra na fase 1 |
| **Modelo de IA** | Gemini, e **só para escrever texto** | Não escolhe quem, nem produto, nem preço. Ver §9 |
| **De-para de produtos** | Manual, feito pelo dono numa tela | Sem ele o José chuta margem. Aceito conscientemente |
| **Barramento de eventos** | Não se constrói agora | Um consumidor só. Mesma decisão da Severina |

---

## 3 · O que a pesquisa provou

Verificado em 09/08 contra a documentação pública. **Nada aqui foi assumido de memória.**

### Cardápio Web — a mina

A [API aberta](https://docs.cardapioweb.com/) tem exatamente as três coisas de que o projeto depende:

| Recurso | O que entrega |
| --- | --- |
| **Listar clientes** / **Buscar cliente** | A base de clientes do estabelecimento |
| **Histórico de pedidos** | Pedidos concluídos e cancelados. **Até 1 ano para trás, em janelas de no máximo 6 meses** |
| **Webhook do módulo Pedidos** | Criação e mudança de status, sem polling |

Autenticação por OAuth, com API Key legada. O lojista libera no painel em `CONFIGURAÇÕES > INTEGRAÇÕES > API DE INTEGRAÇÃO`. Integradores se cadastram na CW App Store; contato: `integracao@cardapioweb.com`.

### Saipos — porta de entrada, não de saída

A [API de pedidos](https://saipos-docs-order-api.readme.io/) serve para parceiros **enviarem** pedidos para dentro do PDV. Não há endpoint documentado de leitura de histórico nem de clientes. O Saipos recebe; ele não devolve.

Consequência: o pedido de iFood, que só existe no Saipos, fica fora do alcance do José. E não faria diferença se estivesse ao alcance — o iFood mascara o telefone.

### Food Marketing — já existe, e faz quase tudo

O Cardápio Web tem a tela [Food Marketing / Campanhas via WhatsApp](https://ajuda.cardapioweb.com/automacao/food-marketing-campanhas-via-whatsapp): segmentação RFV (ticket médio, nº de pedidos, tempo desde a última compra, aniversariantes), campanhas manuais e recorrentes, relatório de "clientes recuperados" com atribuição de 15 dias, e opt-out por "SAIR".

**Isto foi apresentado ao dono como alternativa ao projeto inteiro.** A resposta: a tela funciona, mas **a API não permite que o Tetteo crie campanha lá** — configurar à mão toda semana não acontece na prática. É a razão de o disparo vir para dentro, na fase 4.

Até lá o Food Marketing é o caminho de disparo, manual, e serve de rede de segurança.

### Meta — o preço de disparar por conta própria

| Etapa | Exigência | Prazo |
| --- | --- | --- |
| Verificação da empresa | CNPJ, comprovante de endereço comercial, documento do representante legal | 3–5 dias úteis |
| Número dedicado | Chip que **nunca** teve WhatsApp comum nem Business (se teve, apagar a conta antes) | 1 dia |
| Nome de exibição | Tem que bater com o documento oficial — o cliente verá **"Vitaliano Pizzaria"**, não "José" | junto |
| Modelos de mensagem | Todo texto de marketing é template aprovado pela Meta, um a um, sujeito a recusa | ~1 dia por lote |

Custo por mensagem de marketing no Brasil: **R$ 0,32 a R$ 0,40** ([tabela 2026](https://www.socialhub.pro/blog/preco-whatsapp-api-2026-brasil/)). Mil clientes ≈ R$ 320.

E a regra operacional que virou trava no desenho: **acima de 2% de bloqueios a Meta restringe o número automaticamente** ([regras 2026](https://www.socialhub.pro/blog/regras-politicas-whatsapp-business-api-meta-2026/)). Em 312 pessoas, sete apertando "bloquear" estouram o limite. A API oficial não protege de ser inconveniente — ela só dá um medidor antes do tombo.

---

## 4 · A divisão de trabalho

|  | Fases 1–3 | Fase 4 em diante |
| --- | --- | --- |
| **Quem sumiu, o que ofertar, por quanto** | Tetteo / José | Tetteo / José |
| **Quem manda a mensagem** | Food Marketing, à mão | **Tetteo**, pela Meta |
| **Quem mede o retorno** | Tetteo (margem) + Food Marketing (pedidos) | Tetteo |

### Os dois canais do José

Ele fala por dois caminhos diferentes, e confundi-los é o erro mais fácil deste projeto:

```
JOSÉ → PABLO      pelo número da SEVERINA (Evolution/QR, já existe)
                   "a proposta da semana está pronta"

JOSÉ → CLIENTE    pelo número da META (oficial, dedicado, fase 4)
                   template aprovado, aparecendo como "Vitaliano Pizzaria"
```

**Registro de uma reversão.** No começo da conversa o dono disse que o José teria número próprio; o desenho argumentou que não precisava, já que ele só falaria com o dono. Quando o disparo veio para dentro, o número próprio voltou a ser necessário — a intuição original estava certa, pelo motivo que só apareceu depois.

---

## 5 · Arquitetura

### A conta do José já estava escrita

Antes de projetar qualquer coisa nova, o cálculo central foi encontrado pronto e testado em `src/modules/cardapio/schemas/custo.ts`:

```
calcularCusto(ficha)            → o custo da pizza, descendo nas sub-receitas
calcularMargem(custo, preço)    → quanto sobra
precoParaCmvAlvo(custo, alvo)   → ATÉ ONDE DÁ PARA BAIXAR O PREÇO
```

A última função **é** o José. O que faltava não era a matemática — era ligá-la a um cliente que sumiu.

### As travas que ditaram a forma

1. `modules/crm/` **não pode** importar `modules/cardapio/` — o linter recusa com mensagem escrita à mão em `eslint.config.mjs`
2. `modules/*` **não pode** importar `connectors/*`
3. Arquivos na **raiz de `src/`** ficam fora do grafo de fronteiras — é assim que `core/shell/barra-lateral.tsx` lê `registro-de-apps.ts` sem violar nada. São as raízes de composição, o único lugar autorizado a conhecer todo mundo

### O mapa

```
        CARDÁPIO WEB (nuvem)                       META (Cloud API)
          │              ▲                              ▲
   webhook│              │ histórico                    │ template aprovado
          ▼              │                              │ (fase 4)
 ┌──────────────────────────────────────────────────────┴─────┐
 │  TETTEO                                                    │
 │                                                            │
 │  app/api/cardapioweb/webhook       ← pedido ao vivo        │
 │  app/api/cardapioweb/sincronizar   ← o passado, em janelas │
 │  app/api/crm/tick                  ← o relógio do José     │
 │        │                                                   │
 │        ├──► connectors/cardapioweb/       fala "CW"        │
 │        ├──► connectors/whatsapp-oficial/  fala "Meta"      │
 │        │                                                   │
 │        └──► modules/crm/            O JOSÉ                 │
 │                 ├── Cliente, PedidoExterno                 │
 │                 ├── schemas/segmento.ts   ─┐               │
 │                 ├── schemas/proposta.ts    ├─ PUROS        │
 │                 ├── schemas/aquecimento.ts ─┘  testáveis   │
 │                 └── assistente.ts ────────────┐            │
 │                                               │            │
 │  src/registro-de-catalogo.ts ◄── cardapio     │ custo      │
 │  src/registro-de-ferramentas.ts ◄─────────────┘            │
 │                 │                                          │
 │                 ▼                                          │
 │  modules/assistente/  SEVERINA ──► fila ──────────────────►│──► Zap do dono
 └────────────────────────────────────────────────────────────┘
```

### Onde cada peça mora, e por quê

- **`connectors/cardapioweb/`** — o tradutor. Só ele sabe o que é "Cardápio Web". Trocar de cardápio digital um dia é reescrever esta pasta
- **`connectors/whatsapp-oficial/`** — separado do `connectors/whatsapp/` da Severina **de propósito**: são dois provedores com regras opostas. Ela conversa por QR Code com a equipe; ele fala por template aprovado com clientes. Misturá-los seria a forma mais rápida de mandar marketing pelo canal errado
- **`src/registro-de-catalogo.ts`** — raiz de composição nova, `server-only`. O Cardápio declara o que sabe sobre custo e preço; o CRM consome sem nunca saber que o Cardápio existe
- **`src/registro-de-ferramentas.ts`** — já existe. Ganha **uma linha**: `[assistenteDoEstoque, assistenteDoCrm]`. Nenhum arquivo da Severina muda
- **`app/api/…`** — a costura, como sempre. É a única camada que enxerga módulo **e** conector

### O José não é um App novo

O que se constrói é o **App CRM**, hoje um ícone com `emConstrucao: true` no registro. "José" é a persona — a voz do CRM dentro da Severina.

A aba **Reservas**, declarada na navegação do manifesto, **sai** até existir de verdade. Aba que não faz nada ensina que o sistema mente.

Navegação final: `/crm` (Clientes) · `/crm/produtos` (Casamento) · `/crm/campanhas` (Campanhas).

Permissões:

| Chave | O que libera |
| --- | --- |
| `crm.ver` | Ver clientes e histórico |
| `crm.editar` | Cadastrar/alterar cliente, casar produtos |
| `crm.campanhas` | Ver as propostas do José |
| `crm.disparar` | **Aprovar e disparar** — é a permissão que gasta dinheiro |

---

## 6 · O banco

Arquivo novo: `prisma/schema/crm.prisma`. Todas as tabelas seguem as regras do Core — `organizacaoId` em toda linha, `cuid()`, `excluidoEm` em vez de exclusão.

### Grupo 1 · O espelho

**`Cliente`** — pertence à **organização**, não à unidade, como o manifesto já declara (`comportamentoNaRede: "consolida"`). Quem pede na Ilha de Santa Luzia hoje e numa segunda loja amanhã é uma pessoa, não duas.

```
id, organizacaoId, nome, telefone (E.164), aniversario?,
primeiroPedidoEm, ultimoPedidoEm, qtdPedidos, valorTotal, ticketMedio,
aceitaMarketing, optOutEm?,
criadoEm, atualizadoEm, excluidoEm

@@unique([organizacaoId, telefone])
```

Os cinco campos de resumo são cópia calculada. Existem porque *"sumiu há 45 dias e gastava R$ 90"* precisa ser **uma consulta com índice**, não uma varredura na tabela de pedidos toda vez que o José acorda.

**`ClienteExterno`** — `id, organizacaoId, clienteId, sistema, idExterno, unidadeId` · `@@unique([organizacaoId, sistema, idExterno])`

A mesma pessoa é um cadastro em cada conta do Cardápio Web. Esta tabela é o que permite a segunda loja entrar sem migrar nada — a decisão de multi-unidade desde o primeiro dia.

`sistema` é o enum `SistemaExterno`, hoje com um único valor: `CARDAPIO_WEB`. Enum e não texto livre — o dia em que entrar um segundo sistema, o compilador aponta todos os lugares que precisam decidir o que fazer. Texto livre não aponta nada.

**`PedidoExterno`** e **`ItemDePedidoExterno`** — o pedido carrega `unidadeId`; o cliente é da rede.

```
PedidoExterno:
  id, organizacaoId, unidadeId, clienteId,
  sistema, idExterno,
  canal,                       ← texto, como o Cardápio Web informa a origem
  feitoEm, status (CONCLUIDO | CANCELADO),
  valorTotal, valorDesconto, cupomUsado?,
  criadoEm

  @@unique([organizacaoId, sistema, idExterno])

ItemDePedidoExterno:
  id, pedidoId, produtoExternoId?, nomeNoPedido,
  quantidade, valorUnitario, valorTotal
```

`canal` fica como **texto**, não enum, e é a exceção deliberada à regra do parágrafo anterior: ele guarda o que o Cardápio Web disser sobre a origem do pedido, e essa lista é deles, não nossa. Enum aqui quebraria a sincronização no dia em que eles acrescentassem um canal novo — e perder um pedido é pior do que guardar um texto que ninguém previu.

`produtoExternoId` é opcional porque o item pode chegar antes de o catálogo ter sido sincronizado. O nome fica sempre gravado em `nomeNoPedido`, para que a linha continue legível mesmo sem o vínculo.

Chamam-se *Externo* de propósito: quando o App Delivery nascer, ele vai querer o nome `Pedido` para os pedidos ao vivo dele, e nomes de modelo no Prisma não se repetem.

**Os itens entram, e essa é uma decisão com peso.** Dobram o trabalho de sincronizar. Sem eles o José só sabe dizer *"volte, tem 15% de desconto"*; com eles diz *"você pediu calabresa sete vezes seguidas e sumiu"*. É a diferença entre régua de desconto e marketing.

### Grupo 2 · A ponte

**`ProdutoExterno`** — o catálogo do Cardápio Web espelhado, e o lugar do casamento manual:

```
id, organizacaoId, sistema, idExterno, nome, precoAtual, ativo,
fichaTecnicaId?,        ← O DE-PARA
conferidoEm, conferidoPorId

@@unique([organizacaoId, sistema, idExterno])
```

`fichaTecnicaId` é **texto solto, sem relação do Prisma**, de propósito. Uma chave estrangeira daqui para a tabela do Cardápio costuraria os dois Apps no banco, e a parede defendida no código morreria no schema. O CRM guarda o número; quem responde *"quanto custa esse id?"* é `registro-de-catalogo.ts`.

**Produto com `fichaTecnicaId` nulo não é ofertado.** Silêncio em vez de chute.

**`SincronizacaoExterna`** — `id, organizacaoId, unidadeId, tipo (CLIENTES | PEDIDOS | CATALOGO), janelaInicio, janelaFim, status, registros, erro, executadoEm`

Existe porque o histórico vem em janelas de no máximo 6 meses, até 1 ano para trás: trazer o passado é uma sequência de chamadas, e uma delas vai falhar no meio. Sem esta tabela, "falhou" significa recomeçar do zero sem saber o que já entrou.

### Grupo 3 · O José

**`PropostaDeCampanha`**

```
id, organizacaoId, unidadeId?, criadaEm,
segmento Json,              ← o filtro, em campos e em português
qtdClientes,
produtoExternoId, fichaTecnicaId,
precoNormal, custoUnitario, precoSugerido, margemUnitaria, cmvResultante,
cupomCodigo?, cupomValidoAte?,
modeloId?,                  ← o template da Meta (fase 4)
texto, justificativa,
receitaEsperada, custoDeEnvioEstimado,
estado (RASCUNHO | AGUARDANDO | APROVADA | RECUSADA | DISPARANDO | DISPARADA | INTERROMPIDA),
decididaEm, decididaPorId, motivoRecusa, disparadaEm, concluidaEm
```

`justificativa` não é enfeite. É o campo que responde, no dia em que uma campanha der errado, **por que o José escolheu isso** — o mesmo papel do `origem` na Severina.

**`AlvoDaProposta`** — a tabela que justifica o projeto inteiro:

```
id, propostaId, clienteId, organizacaoId,
statusEnvio (PENDENTE | ENVIADA | ENTREGUE | LIDA | FALHOU | BLOQUEADA),
idExternoMeta?, enviadoEm, entregueEm, erro,
pedidoDepoisId?, valorGerado?, margemGerada?

@@unique([propostaId, clienteId])
```

Ela **congela a lista** de quem foi alvo no momento do disparo. Sem ela, medir retorno é impossível: uma semana depois o segmento mudou e ninguém sabe mais quem recebeu.

E ela é, ao mesmo tempo, **a fila de disparo** — disparar é varrer os alvos `PENDENTE` com ritmo. Nenhuma tabela de fila separada.

Com ela o Tetteo responde o que o Food Marketing não consegue: ele mede quantos pedidos voltaram; o Tetteo mede **quanto lucro voltou**, porque conhece a ficha técnica de cada item pedido depois.

**`ModeloDeMensagem`** (fase 4) — `id, organizacaoId, nome, categoria, idioma, corpo, variaveis Json, idExternoMeta, statusMeta (RASCUNHO | EM_ANALISE | APROVADO | RECUSADO), motivoRecusa, criadoEm`

O José não escreve texto livre para cliente: escolhe um modelo **aprovado** e preenche as variáveis. Isso mata parte da liberdade dele, e é bom que mate.

---

## 7 · O ciclo de uma campanha

### Como o dado entra

**O passado, uma vez.** `/api/cardapioweb/sincronizar` puxa o histórico em janelas de 6 meses, gravando uma linha de `SincronizacaoExterna` por janela. Reexecutável: se a terceira janela falhar, roda de novo e retoma, sem duplicar — tudo é chaveado por `idExterno`.

**O presente, ao vivo.** O webhook bate em `/api/cardapioweb/webhook?chave=<segredo>` a cada pedido criado ou alterado. Mesma disciplina da Severina: confere o segredo, pergunta *"já vi esse `idExterno`?"*, grava, e recalcula os campos de resumo do cliente.

### O ciclo do José

```
[/api/crm/tick, 1×/min]  →  assistenteDoCrm.avisos()  →  "hoje é dia do José?"
       │
       ├─ 1. segmento.ts — quem sumiu, por recência × frequência × valor   [PURO]
       │
       ├─ 2. registro-de-catalogo — o custo de cada produto casado
       │        precoParaCmvAlvo(custo, cmvAlvo) → O PISO DO DESCONTO
       │
       ├─ 3. proposta.ts — cruza o que essa gente pedia × o que dá margem  [PURO]
       │
       ├─ 4. Gemini escreve O TEXTO. Só o texto.
       │
       ├─ 5. grava PropostaDeCampanha + AlvoDaProposta, estado = AGUARDANDO
       │
       └─ 6. devolve o aviso → fila da Severina → Zap do dono
```

> **José:** Proposta da semana pronta. 312 clientes sem pedir há 40+ dias, que gastavam R$ 78 em média. Sugiro Calabresa Grande a R$ 44,90 (de R$ 56) — CMV fica em 31%, dentro do alvo. Retorno esperado R$ 6.200, envio custa R$ 100.
> Ver e aprovar: `app.vitalianopizzaria.com.br/crm/campanhas/…`

O dono abre, confere a lista, ajusta ou aprova.

**Fases 1–3:** a tela entrega os filtros exatos para configurar no Food Marketing, o texto pronto e o código do cupom. Ele cola lá, dispara, e marca *"disparei"*.

**Fase 4 em diante:** aprovar dispara. O tick varre `AlvoDaProposta` pendentes com ritmo e teto de aquecimento, pela Meta.

### A medição

Quinze dias após `disparadaEm`, o tick volta em `AlvoDaProposta` e pergunta: *esses 312 pediram?* Preenche `pedidoDepoisId`, `valorGerado`, `margemGerada` — e o José avisa:

> **José:** A campanha de 12/08 trouxe 41 dos 312 de volta. R$ 4.900 em pedidos, **R$ 1.680 de margem**, R$ 100 de envio. Lucro líquido R$ 1.580. A calabresa puxou 60% — vale repetir com a mesma faixa.

O Food Marketing diz quantos voltaram. **Só o Tetteo diz quanto sobrou.**

---

## 8 · As travas

| Trava | Onde | Contra o quê |
| --- | --- | --- |
| `idExterno` único | entrada | Webhook repetido virando pedido em dobro. Mesma lógica da `EntregaEvento` e da `MensagemWhatsapp` |
| Segredo no webhook | entrada | Qualquer um injetando pedido falso no CRM |
| **Produto sem ficha casada não é ofertado** | proposta | José chutando margem sobre custo que não conhece |
| **`precoParaCmvAlvo` como piso duro** | proposta | Desconto que dá prejuízo. O preço não é escolha do modelo — é conta do código |
| **Gemini só escreve o texto** | proposta | Ele nunca decide quem recebe, qual produto, nem qual desconto |
| Proposta nasce `AGUARDANDO` | proposta | Nada sai sem decisão humana com `crm.disparar` |
| Teto de clientes por proposta | proposta | Campanha de R$ 3.000 de envio saindo por descuido |
| `AlvoDaProposta` congelado | disparo | Medição virar impossível uma semana depois |
| **Teto de aquecimento** | disparo | Número novo levando restrição da Meta na primeira rajada |
| **Parada automática em 1,5% de bloqueio** | disparo | Chegar aos 2% da Meta e perder o número |
| Só template `APROVADO` | disparo | Texto livre saindo para cliente fora da janela de 24h |
| `optOutEm` respeitado sempre | disparo | Mandar para quem pediu para sair |
| **Somente leitura no Cardápio Web** | tudo | O José nunca altera preço, cardápio, cliente ou pedido lá fora |

### Mole × duro

A regra que a Severina estabeleceu vale igual aqui:

```
INSTRUÇÃO  (texto livre)        →  MOLE. Influencia o modelo.
LIMITE     (campo estruturado)  →  DURO. Conferido pelo código.
```

`cmvAlvo`, `maxClientesPorProposta`, `tetoDeGastoPorCampanha`, `maxEnviosPorDia` e `limiteDeBloqueio` moram em `limites` — o mesmo campo Json que o agente da Severina já tem. Escrever *"não dê desconto demais"* na caixa de instruções é pedido; `cmvAlvo: 32` é parede.

### O que o José nunca faz

1. Nunca manda mensagem para cliente sem campanha aprovada por humano
2. Nunca escreve nada no Cardápio Web
3. Nunca oferta produto sem ficha técnica casada
4. Nunca escolhe preço abaixo do piso de CMV
5. Nunca usa texto que não seja template aprovado pela Meta
6. Nunca envia para quem tem `optOutEm` preenchido

---

## 9 · O papel do Gemini, e o que ele não faz

O modelo entra em **um** ponto do fluxo: transformar uma decisão já tomada em português que soe humano.

```
ENTRA:  segmento (312 pessoas, 40+ dias, ticket R$ 78)
        produto  (Calabresa Grande)
        preço    (R$ 44,90 — já calculado, já validado contra o CMV)

SAI:    o texto da mensagem
```

Ele **não** escolhe o segmento, **não** escolhe o produto, **não** escolhe o preço. Todas as três decisões saem de função pura, testada, antes de o modelo ser chamado.

Na fase 4 o papel encolhe mais: ele passa a escrever **propostas de template** para o dono submeter à Meta, não mensagens que saem na hora.

Isso é deliberado. Um modelo de linguagem escrevendo texto errado gera uma frase estranha; um modelo escolhendo desconto errado gera prejuízo em 312 pedidos.

---

## 10 · As fases

Cada fase vira um plano de implementação próprio, escrito uma por vez, com o aprendizado da anterior dentro.

### Fase 0 — do dono, em paralelo, sem código

- Pegar a chave da API no painel do Cardápio Web (`CONFIGURAÇÕES > INTEGRAÇÕES > API DE INTEGRAÇÃO`), ou pedir a `integracao@cardapioweb.com`
- Abrir a conta na Meta e mandar a verificação da empresa
- Comprar o chip novo do José — que **nunca** pode ter tido WhatsApp comum nem Business
- Rodar uma campanha à mão no Food Marketing, para ter referência de retorno

São 3–7 dias de papelada que correm enquanto o código anda. Quando a fase 4 chegar, a conta estará pronta.

### Fase 1 — O espelho

`connectors/cardapioweb/` · sincronização do passado em janelas · webhook · `Cliente`, `ClienteExterno`, `PedidoExterno`, `ItemDePedidoExterno`, `SincronizacaoExterna` · manifesto e permissões do CRM · tela de Clientes com RFV.

**Entrega:** os clientes e todo o histórico dentro do Tetteo. Sem José ainda — mas a base passa a ser **própria e permanente**, e não some se um dia o cardápio digital mudar.

### Fase 2 — O casamento

`ProdutoExterno` · tela de de-para · `modules/cardapio/catalogo.ts` · `src/registro-de-catalogo.ts`.

**Entrega:** cada produto vendido sabe o próprio custo e a própria margem real. Ainda sem José — e mesmo assim esta fase responde sozinha uma pergunta que hoje não tem resposta: *quais dos meus produtos mais vendidos dão menos margem?*

### Fase 3 — O José propõe

`schemas/segmento.ts` + teste · `schemas/proposta.ts` + teste · Gemini redator · `modules/crm/assistente.ts` · a linha nova em `registro-de-ferramentas.ts` · tela de Campanhas · `/api/crm/tick`.

**Entrega:** a proposta semanal, no WhatsApp e na tela. Disparo ainda manual, pelo Food Marketing.

**Esta fase existe separada de propósito:** ela permite julgar se o José é bom **antes de pagar para descobrir**. Se as três primeiras propostas forem ruins, isso aparece sem ter gasto um centavo com a Meta e sem o disparador ter sido construído.

### Fase 4 — O disparo próprio

`connectors/whatsapp-oficial/` · `ModeloDeMensagem` e a tela de templates · opt-in e opt-out · `schemas/aquecimento.ts` + teste · a varredura de `AlvoDaProposta` com ritmo · webhook de status e de qualidade da Meta.

**Entrega:** aprovar dispara. O "control C control V" semanal morre.

### Fase 5 — A medição

O retorno de 15 dias · `valorGerado` e `margemGerada` · o aviso de resultado · a tela de histórico de campanhas.

**Entrega:** o lucro que voltou, não só o pedido que voltou.

### Sobre a ordem

As fases 1 e 2 **não dependem da Severina** — são banco, conector e tela. Só a fase 3 precisa da fila e do Gemini, construídos no [plano da fase 1 dela](../plans/2026-08-04-severina-fase-1-agentes-de-aviso.md).

**Recomendação registrada:** terminar a Severina fase 1 antes de começar. Não por dependência técnica, mas pelo protocolo do dono — um componente por vez, nada de meia-obra em duas frentes.

---

## 11 · Fora de escopo

| Fora | Por quê | Quando volta |
| --- | --- | --- |
| **Cliente do iFood** | Telefone mascarado. Não há ninguém para chamar | Se o iFood mudar de política |
| **Saipos** | A API dele só recebe pedido, não devolve | Se lançarem leitura |
| **José conversando com cliente** | É outro projeto: exige atendimento, contexto de conversa e resposta em tempo real | Depois da fase 5, com dado real na mão |
| **Reservas** | Está na navegação do manifesto, mas é outro assunto. **A aba sai até existir** | Quando o salão pedir |
| **Fidelidade / pontos** | Programa de pontos é um projeto inteiro | Depois que a recuperação estiver rodando |
| **Barramento de eventos** | Um consumidor só — construir de brinde é nascer torto. Mesma decisão da Severina | Quando o Analytics quiser ouvir `pedido.recebido` |
| **Segmentos salvos** | O filtro vive na proposta. Salvar segmento é tela a mais sem uso comprovado | Se o dono repetir o mesmo corte três vezes |
| **Criar campanha no Food Marketing pela API** | A API do Cardápio Web não expõe isso | Se expuserem — aí a fase 4 pode virar opcional |

---

## 12 · Riscos assumidos

### O bloqueio que já aconteceu

O dono **já foi bloqueado** fazendo disparo em massa por caminho não-oficial, e por isso abandonou o marketing por WhatsApp. Isso não é risco teórico neste projeto — é histórico.

A consequência no desenho é absoluta: **o disparo para cliente é pela API oficial da Meta, e por nada mais.** A Evolution API, que a Severina usa, nunca toca a base de clientes. As duas pastas de conector são separadas justamente para que ninguém confunda um dia.

E mesmo pelo caminho oficial o risco não é zero: acima de 2% de bloqueios a Meta restringe. Por isso o aquecimento e a parada automática em 1,5% são campos duros, não recomendações.

### Opt-in, e o buraco honesto

A Meta exige opt-in explícito para mensagem de marketing. O cliente que pediu uma pizza deu o telefone para receber a pizza — não necessariamente para receber promoção.

O desenho faz o que pode: `aceitaMarketing`, `optOutEm` respeitado sempre, e opt-out fácil em toda mensagem. Mas **a origem do opt-in é uma decisão do dono**, não do código. O caminho recomendado é uma caixa de aceite no fechamento do pedido no Cardápio Web, se a plataforma permitir. Enquanto não houver, o que existe é a prática do mercado — e o medidor de bloqueio como juiz.

Registrado aqui para não ser redescoberto como surpresa.

### Dado pessoal em dois lugares

Nome e telefone dos clientes passam a viver também no banco do Tetteo, na VPS própria. O responsável perante a LGPD continua sendo o dono nos dois casos, e o `excluidoEm` dá o caminho para atender pedido de exclusão — mas é dado pessoal que existia em um lugar e passa a existir em dois.

### Dependência do Cardápio Web

Se a Vitaliano trocar de cardápio digital, o espelho para de receber. O histórico já trazido continua — e é justamente por isso que ele é espelhado em vez de consultado ao vivo.

### O de-para manual

O José só é inteligente sobre os produtos que o dono casou à mão. Se o casamento não for feito, ou for feito pela metade, ele fica em silêncio — que é o comportamento certo, mas parece defeito para quem não sabe.

A tela de casamento precisa mostrar, em destaque, **quantos produtos ainda faltam** — senão o silêncio vira mistério.

---

## 13 · Os portões em aberto

**Não são indefinição: são medições esperando acontecer.** Quando a chave da API chegar, três perguntas decidem o escopo.

| Pergunta | Se sim | Se não |
| --- | --- | --- |
| **`Listar clientes` devolve o telefone de verdade?** | Tudo acima vale | **O projeto morre aqui.** Sem telefone não há CRM — e é melhor descobrir antes da fase 1 do que depois da fase 2 |
| **`Histórico de pedidos` traz os itens?** | Fase 2 entrega margem por produto e o José oferta o que a pessoa gosta | O José só oferta desconto genérico. Perde metade da graça, ainda funciona |
| **A API expõe o opt-out ("SAIR") do Food Marketing?** | `aceitaMarketing` nasce sincronizado | O Tetteo passa a ser dono do opt-out a partir da fase 4, e as saídas registradas no Food Marketing antes disso se perdem |

**A primeira pergunta é bloqueante.** Nenhuma linha de código da fase 1 deve ser escrita antes dela.

---

## 14 · Notas para a implementação

- **Antes de escrever código:** este projeto usa Next.js 16, com mudanças que quebram convenções anteriores. Ler os guias em `node_modules/next/dist/docs/`, conforme [AGENTS.md](../../../AGENTS.md). Vale especialmente para Route Handlers e para o processamento após a resposta do webhook
- `npm run check` (tipos + fronteiras + formatação + testes) antes de todo commit
- **Teste é de função pura.** O projeto não tem harness de banco. Toda lógica isolável — o corte do segmento, a escolha de produto e preço, o teto de aquecimento — sai do serviço e vira função pura testada, seguindo o padrão de `estoque` e `cardapio`
- **Toda tabela carrega `organizacaoId`.** Consulta sem escopo é bug
- O relógio é tarefa agendada do Dokploy batendo em `/api/crm/tick` com segredo no cabeçalho. Deve ser disparável à mão para depuração
- Comentários em português, explicando o *porquê*, no registro dos arquivos existentes

### Variáveis de ambiente novas

```bash
# Fase 1
CARDAPIOWEB_URL=https://api.cardapioweb.com
CARDAPIOWEB_TOKEN=<do painel ou do OAuth>
CARDAPIOWEB_WEBHOOK_SEGREDO=<openssl rand -hex 32>
CRM_TICK_SEGREDO=<openssl rand -hex 32>

# Fase 4
META_WABA_ID=<da conta WhatsApp Business>
META_PHONE_NUMBER_ID=<do número dedicado>
META_TOKEN=<token permanente do app>
META_WEBHOOK_SEGREDO=<openssl rand -hex 32>
```

### Estrutura de arquivos

| Arquivo | Responsabilidade |
| --- | --- |
| `prisma/schema/crm.prisma` | As tabelas |
| `src/connectors/cardapioweb/` | Falar "Cardápio Web". Só isso |
| `src/connectors/whatsapp-oficial/` | Falar "Meta". Só isso (fase 4) |
| `src/modules/crm/manifest.ts` · `permissoes.ts` | A declaração ao Core |
| `src/modules/crm/schemas/segmento.ts` + teste | O corte RFV — puro |
| `src/modules/crm/schemas/proposta.ts` + teste | Escolha de produto e preço — puro |
| `src/modules/crm/schemas/aquecimento.ts` + teste | Quantos envios hoje — puro (fase 4) |
| `src/modules/crm/services/*` | Clientes, pedidos, produtos, propostas, disparo, medição |
| `src/modules/crm/assistente.ts` | O aviso que o CRM oferece à Severina |
| `src/modules/crm/components/*` | As telas |
| `src/modules/cardapio/catalogo.ts` | O que o Cardápio sabe sobre custo e preço |
| `src/registro-de-catalogo.ts` | Raiz de composição, `server-only` |
| `src/registro-de-ferramentas.ts` | Ganha uma linha: `assistenteDoCrm` |
| `src/app/api/cardapioweb/**` | Webhook e sincronização |
| `src/app/api/crm/tick/route.ts` | O relógio do José |
| `src/app/(shell)/crm/**` | As rotas |
