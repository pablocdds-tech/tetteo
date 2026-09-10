# Compras — do pedido da loja à conferência do recebimento

**Data:** 10/09/2026
**Alcance:** App de Compras (evolução), com costuras em Estoque, Financeiro e na infraestrutura de arquivos
**Estado:** aprovado pelo Pablo em 10/09/2026
**Referência:** o fluxo da Nina revisado em 09/09/2026 (rodadas por fornecedor, `supplierLocked`, pedidos por rodada e loja, adendos com `dispatchSeq`/`parentOrderId`, outbox durável). Esta especificação adapta a operação e acrescenta concorrência, conferência parcial e estados explícitos.

## Decisões do Pablo (10/09/2026)

| Pergunta                         | Resposta                                                                                                                         |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Como a mensagem chega ao fornecedor | **Simulador + copiar.** Nada sai sozinho. O comprador copia mensagem e link e envia pelo WhatsApp dele; o conector real fica pronto e desligado. |
| Alçada de aprovação              | **Só Diretor, sem limite.** A tela de alçadas existe e aceita outros papéis e limites depois, com versão.                          |
| Ritmo                            | Construção seguida, conferência no final.                                                                                        |

## O que o sistema promete — e o que ele se recusa a prometer

Promete: que cada número tem origem visível, que nada é enviado sem aprovação, que o mesmo pedido não sai duas vezes e que a mesma mercadoria não entra duas vezes no estoque nem no financeiro.

Recusa: prometer economia (a sugestão mostra a conta, não um "você economizou"), dizer que o fornecedor aceitou sem registro dele, chamar de "entregue" o que o canal só aceitou, e chamar de "enviado" o que está na fila.

---

## 1. O que já existia e para onde foi

Compras não nasce do zero. As tabelas de 04/08 evoluem; nenhuma tabela paralela é criada.

| Entidade da especificação | Onde mora no Tetteo                          | De onde veio                   |
| ------------------------- | -------------------------------------------- | ------------------------------ |
| PurchaseRound             | `RodadaDeCompra`                             | era `Cotacao`                  |
| Requisition               | `Requisicao`                                 | nova                           |
| RequisitionItem           | `ItemDeRequisicao`                           | nova (a Despensa alimenta)     |
| —                         | `ItemDaRodada` (a lista consolidada)         | era `ItemDeCotacao`            |
| Supplier                  | `Fornecedor`                                 | existia; ganha destino e autorização |
| SupplierProduct           | `FornecedorInsumo`                           | nova                           |
| QuotationRequest          | `SolicitacaoDeCotacao` + `ItemDaSolicitacao` | era `PropostaDeCotacao`        |
| QuotationVersion          | `VersaoDeProposta`                           | nova                           |
| QuotationItem             | `ItemDeProposta`                             | era `PrecoProposto`            |
| —                         | `EscolhaDeItem`                              | nova (a decisão por item)      |
| PurchaseApproval          | `AprovacaoDeCompra` + `AlcadaDeCompra`       | novas                          |
| PurchaseOrder             | `Pedido`                                     | existia; ganha snapshot e sequência |
| PurchaseOrderItem         | `ItemDePedido`                               | existia; ganha snapshot        |
| PurchaseAmendment         | `Pedido` filho (adendo) + `AlteracaoDePedido` | novo campo e nova tabela      |
| SupplierOutbox            | `MensagemAoFornecedor` + `CanalDeCompras`    | novas                          |
| GoodsReceipt              | `Recebimento`                                | nova                           |
| ReceiptItem               | `ItemDeRecebimento`                          | nova                           |
| AuditEvent                | `Auditoria` (Core)                           | existia                        |
| —                         | `DivergenciaDeCompra`                        | nova (a conciliação)           |
| —                         | `AgendaDeRodada`                             | nova (o relógio)               |
| —                         | `Arquivo` (Core)                             | novo, conforme `2026-08-04-onde-os-arquivos-moram.md` |

Reaproveitados sem mudança de papel: `Insumo` (catálogo), `EmbalagemCompra` (sugestão de embalagem), `PosicaoEstoque`/`Contagem` (sugestão de compra), `NotaEntrada` (a única porta de entrada de estoque e custo), `Lancamento` (conta a pagar, via "importar notas").

A migração converte o que existir em `cotacao`, `proposta_de_cotacao`, `preco_proposto` e `pedido` para o modelo novo, **mantendo os mesmos ids**. Em 10/09/2026 ninguém usava Compras em produção, mas a migração não depende disso.

### A fronteira entre Apps

Compras não importa Estoque nem Financeiro (trava do `eslint.config.mjs`). As três costuras moram na camada `app/`, que é quem monta o sistema — o mesmo lugar onde a Despensa já cria cotação:

1. **Despensa → requisição** (`app/(shell)/estoque/acoes-da-despensa.ts`)
2. **Recebimento → nota de entrada** (orquestrador com transação única; os serviços dos dois Apps aceitam o cliente da transação)
3. **Nota → conta a pagar** (a função `importarNotas` do Financeiro, que já impede duplicar)

Ler tabela de outro App é permitido (Financeiro já lê `nota_entrada`); escrever, nunca.

---

## 2. Rodada e requisição

### Estados da rodada

```
RASCUNHO → COLETANDO → COTANDO → REVISAO → APROVADA → DESPACHANDO → FECHADA
    └──────────┴──────────┴─────────┴──────────┴─────────── CANCELADA
```

| Estado      | O que acontece                                                                                     |
| ----------- | -------------------------------------------------------------------------------------------------- |
| RASCUNHO    | comprador define lojas participantes, prazos, janela de entrega e responsável                       |
| COLETANDO   | cada loja prepara e envia a requisição; a rodada mostra quem enviou e quem não                      |
| COTANDO     | a lista é consolidada e **congelada**; as solicitações vão aos fornecedores                          |
| REVISAO     | cotação encerrada; comprador compara, escolhe e gera os pedidos para aprovação                      |
| APROVADA    | nenhum pedido da rodada aguarda aprovação                                                          |
| DESPACHANDO | pelo menos um pedido na fila de envio                                                              |
| FECHADA     | nada mais muda sem reabrir. Recebimento continua nos pedidos — pedido tem ciclo próprio            |

- Toda transição é uma escrita condicional: `UPDATE … WHERE id = ? AND estado = ? AND versao = ?`. Zero linhas afetadas = alguém mudou antes; a tela diz quem e quando, e não sobrescreve.
- **Reabrir** (REVISAO → COTANDO, FECHADA → DESPACHANDO) exige motivo, sobe a versão e grava auditoria com o motivo. Não existe mudança invisível.
- Requisição que não foi enviada até a consolidação fica de fora, e a rodada diz isso em voz alta ("Centro não enviou").

### Requisição da loja

- Uma por loja por rodada (`@@unique([rodadaId, unidadeId])`). A loja vê só a sua: o escopo vem do `ContextoSessao`, e um id de outra loja é recusado no servidor.
- Estados: `RASCUNHO` → `ENVIADA`. Enviar congela; corrigir depois de enviada exige que o comprador devolva (`DEVOLVIDA`, com motivo).
- Cada item guarda: insumo, **quantidade necessária na unidade de estoque**, embalagem de compra preferida e fator conhecido (ou nulo = desconhecido), categoria (cópia do cadastro no momento), observação.

### Sugestão de compra

```
sugestão = mínimo − disponível − já em pedido aberto
```

- **disponível**: soma das posições da loja (o mesmo número da Despensa).
- **já em pedido aberto**: pedidos APROVADOS da loja, ainda não concluídos, menos o que já foi recebido.
- A conta vai escrita ao lado do número e é gravada com o item ("mínimo 15 kg − disponível 3,5 kg − em pedido 5 kg = 6,5 kg"). O número sugerido **não preenche** o campo sozinho de forma invisível: a loja confirma ou muda.
- Dado faltando ou velho gera **alerta, nunca zero**: sem mínimo cadastrado, nunca contado nesta loja, saldo com mais de 7 dias sem contagem nem entrada. Conta ≤ 0 mostra "pela conta, não precisa (sobram X)".
- Sugestão não compra nada: vira requisição, que vira cotação, que vira pedido, que só sai com aprovação.

### Matriz consolidando lojas

`ItemDaRodada` soma as requisições enviadas por insumo. A origem de cada quantidade não se perde: ela é a própria lista de `ItemDeRequisicao` daquela rodada e insumo, e os pedidos saem **por loja**, cada um com as quantidades da sua requisição.

### Rodada automática

`AgendaDeRodada`: dia da semana, hora de abertura, prazo da requisição e da cotação (em horas), início e fim da janela de entrega (em dias após a abertura), lojas participantes.

O relógio abre a rodada da ocorrência uma vez só: a chave é `(agendaId, ocorrencia)` com `ocorrencia` = semana ISO no fuso da organização (`2026-W37`). Trocar o dia da agenda no meio da semana **não** cria a segunda rodada daquela semana. A inserção usa a unicidade do banco, não uma consulta antes — duas réplicas batendo no mesmo minuto não duplicam.

---

## 3. Fornecedor fixo, solicitação e link

### Produto do fornecedor (`FornecedorInsumo`)

Por fornecedor e insumo: embalagem **estruturada** (ver §4), fator calculado, origem do fator e versão, preço de referência por embalagem com origem e data, e `fixo` (o `supplierLocked` da Nina). Um insumo tem no máximo um fornecedor fixo ativo (índice único parcial).

- Item de fornecedor fixo entra na rodada como **DIRECIONADO**: não aparece para concorrentes. O fornecedor fixo recebe esses itens como confirmação de preço; sem resposta, vale o preço de referência, identificado como tal ("preço de referência de 02/09").
- **Exceção**: colocar um item fixo em disputa exige `compras.cotar`, motivo, e fica gravado no item e na auditoria.

### Solicitação de cotação

Uma por fornecedor por rodada, com a lista **dele** (`ItemDaSolicitacao`): só os itens para os quais foi convidado, as quantidades por loja de entrega, unidades, prazo, e o nome/endereço **apenas** das lojas que recebem aqueles itens.

Estados: `RASCUNHO`, `CONVIDADO`, `RESPONDIDA`, `RECUSOU`, `ENCERRADA_SEM_RESPOSTA`, `ENCERRADA`.

### O link público

- Código de 32 bytes aleatórios (base64url). O banco guarda o **hash SHA-256** (para achar) e o código **cifrado** com AES-256-GCM (chave derivada do `AUTH_SECRET` por HKDF, rótulo `compras-link`) — só para quem tem permissão poder copiar o link de novo. Nunca em texto puro no banco.
- O código vai depois do `#`: `https://app…/fornecedor/cotacao#<código>`. O navegador **não envia** o que vem depois do `#` ao servidor, então o código não aparece em registro de acesso do Traefik nem do Next. A página lê o fragmento e o manda no corpo da ação. `Referrer-Policy: no-referrer` e `noindex` na página.
- Vence no prazo da cotação. Revogável. Reemitir gera código novo e mata o antigo.
- Limites: 1 envio a cada 10 s, 30 versões no total; 10 envios inválidos seguidos revogam o link (o comprador reemite).
- O servidor valida tudo: item precisa pertencer **àquela** solicitação (id de outra é recusado), preço ≥ 0, fator coerente com a dimensão, textos com limite de tamanho.
- O fornecedor não vê preço de concorrente, custo interno, dado financeiro nem outra loja. A resposta é dado, não instrução: nenhum texto do fornecedor é executado ou interpretado por IA.

### A resposta e as versões

Por fornecedor: frete **por entrega** (nulo = não informado ≠ zero), pedido mínimo por entrega, prazo em dias, validade, observação. Por item: situação (`COTADO` ou `INDISPONIVEL`), embalagem estruturada, preço por embalagem, disponibilidade (quanto consegue entregar), observação.

- **Sem resposta** = não existe linha. **Indisponível** = linha com situação própria. **Preço zero** = só pelo comprador, com `compras.cotar`, marcado como condição explícita (bonificação) e com motivo. O fornecedor não consegue mandar zero: campo vazio é "não cotou".
- Cada envio grava uma `VersaoDeProposta` nova, com número, horário e origem (`FORNECEDOR_LINK`, `COMPRADOR_DIGITOU`, `NEGOCIACAO`). A comparação usa a última. Nada é sobrescrito.
- Depois de encerrada a cotação, proposta nova só por reabertura da rodada ou por **negociação registrada** (versão com origem `NEGOCIACAO`, motivo e quem registrou).

---

## 4. Conversão e comparação

### A embalagem estruturada

Embalagem = `peças × conteúdo unidade`, e o fator é calculado, nunca digitado:

| Insumo medido em | Embalagem              | Fator     | Regra                                                   |
| ---------------- | ---------------------- | --------- | ------------------------------------------------------- |
| KG               | Caixa 12 × 900 g       | 10,8      | mesma dimensão (massa): 12 × 0,9 kg                     |
| KG               | Saco 25 kg             | 25        | 1 × 25 kg                                               |
| UN               | Caixa 100 un           | 100       | contagem: peças                                         |
| UN               | Caixa 12 × 900 g       | 12        | contagem de peças: o conteúdo em gramas é só descrição  |
| KG               | Caixa com 12 (sem peso) | **desconhecido** | massa pedida, contagem informada: não há conversão |
| L                | Fardo 6 × 2 L          | 12        | mesma dimensão (volume)                                 |
| KG               | Fardo 6 × 2 L          | **incompatível** | volume não vira massa sem densidade             |

- Fator desconhecido ou incompatível **bloqueia** a comparação automática daquele item e pede "Conferir fator". Não existe chute.
- A conversão é por insumo e embalagem, com origem ("cadastro do fornecedor", "informado na proposta v3", "nota 1234") e versão. Corrigir o fator cria versão nova; proposta e pedido antigos guardam o fator que usaram.
- **A granel** (`fracionavel`): compra a quantidade exata. Senão, compra embalagem inteira: `embalagens = ⌈necessário ÷ fator⌉`, e a tela mostra o **adicional** (quanto sobra) e o **custo do adicional**.

### A grade

Por produto e fornecedor: preço por unidade de estoque (só para comparar, 6 casas), embalagens necessárias, adicional e seu custo, total do item, disponibilidade, situação. Por fornecedor: subtotal, frete por entrega × entregas, mínimo atendido por loja, prazo contra a janela, total. Dado ausente aparece como ausente ("frete não informado") e nunca conta como vantagem.

### A sugestão de menor custo total

Menor preço unitário não é a melhor compra. A sugestão testa **as combinações de fornecedores** (até 12 fornecedores com frete informado; acima disso, cai para o mais barato por item e avisa) e, em cada combinação:

1. cada item vai para quem tem o menor custo **para a quantidade necessária** (depois do arredondamento de embalagem), entre os que cotaram com fator conhecido e disponibilidade suficiente;
2. cada fornecedor usado soma o frete **de cada loja que recebe dele**;
3. a combinação é descartada se algum fornecedor não atinge o mínimo em alguma loja;
4. vence a de menor total.

É isso que faz um frete trocar o vencedor. Fornecedor sem frete informado fica fora da sugestão, com aviso. Não existe ranking de qualidade: não há histórico para sustentá-lo.

A sugestão **não** escolhe nada. O comprador escolhe por item (`EscolhaDeItem`); escolher diferente da sugestão exige justificativa, gravada.

---

## 5. Aprovação e snapshot

### Os pedidos nascem das escolhas

"Gerar pedidos" cria um `Pedido` por **loja × fornecedor** em `AGUARDANDO_APROVACAO`, com o snapshot completo: nome e documento do fornecedor, telefone de destino autorizado, loja e endereço, janela de entrega, condição de pagamento, e por item: nome do insumo, unidade de estoque, embalagem, fator, embalagens, quantidade, adicional, preço por embalagem, preço por unidade, total, origem do preço (versão da proposta ou preço de referência). Mudar o cadastro depois não mexe no pedido.

### Dinheiro

- Centavos inteiros; quantidades em milésimos; fator em décimos de milésimo. Contas com inteiros (`BigInt`), nunca ponto flutuante.
- **Regra de arredondamento**: o total de cada linha é arredondado **uma vez**, para o centavo, meio para cima (0,005 → 0,01). Em compra por embalagem inteira a conta é exata (embalagens × preço da embalagem) e não arredonda nada. O total do pedido é a **soma das linhas arredondadas + frete**. O preço por unidade de estoque é só para comparar e nunca é multiplicado para formar total.
- O servidor calcula o total e confere contra as linhas antes de gravar; diferença de um centavo que seja é erro, não ajuste.

### Alçada

- `AlcadaDeCompra`: papel, limite em centavos (nulo = sem limite), versão, vigência. Uma vigente por papel. Mudar cria versão nova e encerra a anterior; o histórico fica.
- Aprovar exige `compras.aprovar` **e** uma alçada vigente de um papel da pessoa no escopo, com limite ≥ total do pedido. Acima da alçada o pedido fica pendente e a tela diz de quem depende.
- Semente: Diretor sem limite (decisão de 10/09/2026). Sem nenhuma alçada cadastrada, só quem tem `*` aprova — o sistema nunca fica sem aprovador.
- `AprovacaoDeCompra` grava aprovador, alçada, versão da alçada, valor aprovado, decisão (`APROVADO`/`RECUSADO`) e motivo.
- A tela esconde o botão de quem não pode; o servidor recusa mesmo assim. Editar o HTML não concede nada.

### Duas aprovações ao mesmo tempo

Transação interativa: `UPDATE pedido SET status = 'APROVADO', versao = versao + 1 … WHERE id = ? AND status = 'AGUARDANDO_APROVACAO' AND versao = ?`. Uma passa; a outra afeta zero linhas e recebe "este pedido já foi aprovado por X às HH:MM". Aprovação, mensagem na fila e auditoria gravam na mesma transação.

### Depois de aprovado

Pedido aprovado não aceita edição. Mudança só por:

- **Adendo** — itens novos depois do primeiro envio viram um `Pedido` filho (`pedidoOrigemId`), com a próxima `sequencia` (2, 3…), só com o delta aprovado. Passa por aprovação e sai como mensagem própria ("Adendo 2 do PC-0104").
- **Alteração** — diminuir ou cancelar o que já foi enviado é uma `AlteracaoDePedido` (tipo `ALTERACAO` ou `CANCELAMENTO`), com linhas antes/depois, motivo, sequência própria, mensagem própria e concordância do fornecedor (`PENDENTE`/`ACEITA`/`RECUSADA`) registrada por alguém da equipe. Aumentar quantidade é adendo, não alteração.
- As sequências saem de um contador no pedido original (`ultimaSequencia`, incrementado atomicamente), então a ordem das versões e das mensagens nunca embaralha.

---

## 6. Envio durável

### A fila (`MensagemAoFornecedor`)

Campos: organização, loja, fornecedor, tipo (`CONVITE_COTACAO`, `PEDIDO`, `ADENDO`, `ALTERACAO`, `CANCELAMENTO`, `TESTE`), referência (pedido, solicitação ou alteração) e sequência, destino, canal, corpo (snapshot), **chave de idempotência única** (`pedido:<id>:1`), estado, tentativas, máximo, próxima tentativa, trava (`leaseAte`, `leaseDono`), último erro, id no provedor, horários de cada estado, envio manual (quem e quando).

- A mensagem é gravada **na mesma transação** que aprova o pedido (ou emite a solicitação). Aprovar e enviar são coisas separadas: aprovar só enfileira.
- **O destino é decidido pelo servidor**: o telefone de pedidos do fornecedor, se ele estiver autorizado a receber mensagens. A tela nunca manda número. Sem destino ou sem autorização, a mensagem fica `BLOQUEADA` com o motivo, visível no painel.
- O destino é congelado na mensagem. Se o cadastro do fornecedor mudar com a mensagem ainda na fila, ela **não** é redirecionada sozinha: o painel mostra "o número mudou depois de enfileirar" e reenfileirar para o número novo exige `compras.enviar` e fica auditado.

### Estados

```
BLOQUEADA ─┐
NA_FILA → ENVIANDO → ACEITA_PELO_CANAL → ENTREGUE
              │  └──→ INCERTA ──(conferido)──→ ACEITA_PELO_CANAL
              └──→ NA_FILA (nova tentativa) … → FALHOU
CANCELADA
```

- **Na fila não é enviado. Aceita pelo canal não é entregue. Entregue não é "fornecedor confirmou".** A confirmação comercial mora no pedido (`PENDENTE`, `CONFIRMADO`, `CONFIRMADO_COM_RESSALVA`, `RECUSADO`), registrada por alguém com o texto do que o fornecedor disse.

### O despachante

O relógio (`POST /api/compras/tick`, segredo em `x-compras-segredo`; rota fechada sem segredo) roda a cada minuto:

1. abre as rodadas agendadas;
2. marca como `INCERTA` toda mensagem em `ENVIANDO` com trava vencida — quem a pegou morreu no meio, e não se sabe se saiu;
3. tenta reconciliar as `INCERTA` perguntando ao canal pela chave/id (o simulador responde; o WhatsApp ainda não — fica para uma pessoa decidir);
4. pega um lote com **trava atômica**: `UPDATE … SET estado = 'ENVIANDO', lease_ate = now() + 2 min, lease_dono = ?, tentativas = tentativas + 1 WHERE id IN (SELECT id … FOR UPDATE SKIP LOCKED LIMIT ?) RETURNING …`. Duas réplicas nunca pegam a mesma mensagem;
5. envia uma por vez, com respiro.

Resultado do canal:

| O canal disse                                   | Estado               |
| ----------------------------------------------- | -------------------- |
| aceitou, com id                                 | `ACEITA_PELO_CANAL`  |
| recusou antes de enviar (conexão recusada, 429, 5xx) | `NA_FILA` com espera crescente (1, 4, 9, 16 min); na 5ª, `FALHOU` |
| recusou de vez (4xx, número inválido)           | `FALHOU`             |
| tempo esgotado / conexão caiu depois de mandar  | `INCERTA`            |

`INCERTA` nunca é reenviada às cegas. Uma pessoa com `compras.enviar` confere no WhatsApp (a mensagem leva a referência `PC-0104/1`, fácil de achar) e escolhe "Saiu, marcar como aceita" ou "Não saiu, reenviar" — as duas auditadas. Reprocessar `FALHOU` também exige `compras.enviar`.

### O canal agora (decisão de 10/09/2026)

- `COMPRAS_CANAL` ausente ou `simulador` → **Simulador**. Ele aceita e devolve um id `SIM-…`; a tela diz **"Simulado — nada saiu do sistema"** e oferece **Copiar mensagem**, **Copiar link** (convites) e **Marquei como enviada** (grava quem e quando, como declaração da pessoa).
- `COMPRAS_CANAL=whatsapp` + `COMPRAS_EVOLUTION_INSTANCIA` → conector Evolution, numa **instância separada** da Severina. Sem a instância configurada, recusa. Nunca liga em `NODE_ENV=test`.
- `CanalDeCompras`: pausa (com motivo e quem pausou) e número de teste. **Envio de teste só vai para o número de teste**; sem número de teste, não há envio de teste.
- O painel mostra: canal pausado, simulador ativo, mensagens bloqueadas (sem destino, sem autorização, número mudou), incertas, falhas.

---

## 7. Recebimento e divergências

### A conferência

Por pedido. Por linha: pedido, recebido antes, **recebido agora** (na unidade de compra, com a conversão escrita), acumulado, saldo, condição (quantidade boa e quantidade avariada), lote e validade quando o insumo pede, foto, observação. No celular, cada linha é um cartão grande com a unidade explícita.

- Entrega parcial deixa saldo pendente. "Encerrar saldo" exige motivo e vira divergência.
- Excedente exige decisão: **aceitar** (entra, divergência registrada) ou **recusar na porta** (não entra).
- Substituição ("veio outra marca/produto") exige escolher o insumo que veio e decidir aceitar ou recusar.
- **Avariado não entra no estoque.** Fica no recebimento e vira divergência.

### Uma transação só

`Recebimento` e `ItemDeRecebimento` são imutáveis, com usuário, data, loja e **chave de idempotência** (gerada quando a tela abre). A transação:

1. trava o pedido (`SELECT … FOR UPDATE`) — duas conferências simultâneas passam uma de cada vez, e a segunda vê o acumulado da primeira;
2. se a chave já existe, devolve o recebimento existente — duplo clique vira um recebimento só;
3. grava recebimento, linhas e divergências;
4. dá entrada **pelo Estoque**: cria a `NotaEntrada` já lançada, ligada ao recebimento (`recebimentoId` único), com a quantidade boa convertida pelo fator do pedido e o preço do pedido. Saldo, custo médio e CMV continuam vindo da nota, como sempre. Os insumos são travados (`FOR UPDATE`) para o custo médio não correr;
5. atualiza a situação de recebimento do pedido e, se completo, conclui.

Falhou em qualquer passo: nada fica. O pedido só aparece concluído depois do commit.

### Nota fiscal e a regra da origem única

A **nota de entrada é a única origem** do movimento de estoque.

- Recebimento sem nota prévia: o próprio recebimento cria a nota (número, série e chave de 44 dígitos opcionais). A unicidade `(unidade, fornecedor, número, série)` que já existe impede lançar o mesmo papel de novo.
- Nota **já lançada** à mão no Estoque antes de o caminhão ser conferido: o recebimento se **vincula** a ela e não dá entrada de novo. Diferença entre nota e conferência (quantidade, valor) vira divergência para conciliar.
- A tela de nova nota do Estoque avisa quando o fornecedor tem pedido aguardando recebimento ("confira em Compras › Recebimento para não dar entrada duas vezes").
- Importação de XML de NF-e **não existe** no Tetteo. O vínculo (`chaveAcesso`, `recebimentoId`) está pronto para quando existir.

### Devolução

Devolver o que já entrou é um recebimento do tipo `DEVOLUCAO`: linhas próprias, motivo, e um movimento de estoque `DEVOLUCAO` (tipo novo) que baixa o saldo. Nada é apagado. O CMV passa a descontar as devoluções das compras do período. A conta a pagar não muda sozinha: a devolução abre divergência "ajustar com o fornecedor".

### Conta a pagar

Pelo Financeiro existente: a nota criada pelo recebimento aparece em "importar notas", e o vínculo único `notaEntradaId` impede a mesma nota de virar duas contas. A tela de conferência oferece "gerar a conta a pagar agora" para quem tem `financeiro.lancar`, chamando a mesma função. Nenhum pagamento bancário é feito.

### Divergências

`DivergenciaDeCompra`: tipo (`FALTOU`, `EXCEDENTE`, `AVARIA`, `SUBSTITUICAO`, `SALDO_ENCERRADO`, `NOTA_QUANTIDADE`, `NOTA_VALOR`, `DEVOLUCAO`), pedido, recebimento, nota, detalhe, impacto em centavos, estado (`ABERTA`/`RESOLVIDA`), resolução e quem resolveu.

### Fotos

Conforme `2026-08-04-onde-os-arquivos-moram.md`: pasta persistente (`ARQUIVOS_DIR`, padrão `/app/arquivos`), nome aleatório por ano/mês, tabela `Arquivo` no Core com dono, loja, entidade, tipo, tamanho e permissão de leitura, entrega só por `GET /api/arquivos/<id>` depois de conferir organização, loja e permissão. Tipos aceitos por assinatura do conteúdo (não pela extensão): JPEG, PNG, WebP; até 5 MB. Exclusão lógica. Retenção: fotos de recebimento ficam no mínimo 5 anos (prazo fiscal); não há apagamento automático.

---

## 8. Permissões

| Chave                  | Quem, tipicamente | O que permite                                                        |
| ---------------------- | ----------------- | -------------------------------------------------------------------- |
| `compras.ver`          | todos de compras  | ver rodadas, pedidos, fornecedores                                   |
| `compras.requisitar`   | gerente da loja   | preparar e enviar a requisição **da própria loja**                   |
| `compras.rodadas`      | comprador da rede | criar, avançar, reabrir e cancelar rodadas; agenda                   |
| `compras.cotar`        | comprador         | solicitações, links, lançar propostas, escolher, exceção de fixo, zero |
| `compras.pedir`        | comprador         | gerar pedidos para aprovação, adendos, alterações, confirmação comercial |
| `compras.aprovar`      | Diretor           | aprovar e recusar, dentro da alçada                                  |
| `compras.enviar`       | comprador         | painel de envios, reprocessar, resolver incerta, pausar, teste       |
| `compras.receber`      | gerente da loja   | conferir recebimento e devolução **na própria loja**                 |
| `compras.fornecedores` | comprador         | cadastro de fornecedor e produto do fornecedor                       |
| `compras.configurar`   | Diretor           | alçadas e canal                                                      |

Rodada é da organização; requisição, pedido e recebimento são da loja. Toda consulta filtra pelas lojas visíveis do contexto, e todo id recebido é conferido contra elas antes de qualquer escrita.

---

## 9. Telas

Menu de Compras: **Rodadas · Requisição · Comparação · Aprovação · Pedidos e envios · Recebimento · Fornecedores · Configurações**.

- Filtro por loja, rodada e estado no topo, **no endereço** — volta do detalhe e continua igual (regra do `DESIGN.md` §5).
- Computador: tabelas com colunas e ações alinhadas, resumo lateral de total e alertas. Celular: a conferência vira cartões grandes com unidade explícita.
- Estado por **texto e cor** (a `Etiqueta` do design system), prazo vencido, proposta incompleta, entrega parcial.
- Botões com verbo: **Enviar requisição**, **Revisar propostas**, **Aprovar pedido**, **Conferir recebimento**.
- Vazio orienta a próxima ação; erro preserva o que foi digitado.
- Sem hero. Visual Aurora (`DESIGN.md`).
- Página pública do fornecedor, sem a casca: `/fornecedor/cotacao`.

---

## 10. Adaptadores

`src/connectors/fornecedores/`:

```ts
type ResultadoDoCanal =
  | { tipo: "aceita"; idProvedor: string }
  | { tipo: "recusada-antes"; erro: string; tentarDeNovo: boolean }
  | { tipo: "incerta"; erro: string };

type ConsultaDoCanal = "aceita" | "nao-encontrada" | "desconhecido";

interface CanalDeFornecedor {
  nome: "simulador" | "whatsapp";
  simulado: boolean;
  enviar(m: { destino: string; texto: string; chave: string }): Promise<ResultadoDoCanal>;
  consultar(m: { chave: string; idProvedor: string | null }): Promise<ConsultaDoCanal>;
}
```

- **Simulador**: identificado em toda tela; nunca sai rede afora; programável nos testes (falhar N vezes, esgotar tempo depois de "enviar", recusar de vez).
- **WhatsApp (Evolution)**: instância própria de compras; `consultar` devolve `desconhecido` até existir a busca de mensagem por referência.

---

## 11. Testes

Unitários (funções puras): fator e dimensão (12 × 900 g = 10,8 kg; peças; desconhecido; incompatível), embalagem fracionada e adicional, arredondamento meio para cima, comparação (fixo fora da disputa, preço ausente, indisponível, zero explícito, unidade incompatível, mínimo não atendido, frete que muda o vencedor), sugestão de compra (fórmula, dado velho → alerta), estados da rodada, alçada, código do link (hash, validade, revogação), ritmo de novas tentativas.

Integração (banco de verdade, `npm run test:integracao`): duas aprovações concorrentes, dois despachantes simultâneos, tempo esgotado depois de enviar, tentativa até falha definitiva, adendo só com itens novos, edição depois de aprovado, mudança de destinatário com mensagem na fila, acesso por outra loja, link vencido/revogado/de outra solicitação, recebimento parcial, excedente, avaria, dupla conferência, falha no meio da transação, nota já lançada, conta a pagar não duplicada. Saldos e financeiro conferidos no fim de cada um. Canal sempre simulado; nenhuma mensagem real sai.

Navegador: computador e celular, permissões, e os três prints (comparação; pedido aprovado com situação do envio; recebimento parcial) com dados fictícios.

---

## 12. O que depende de integração real

| Item                                    | O que falta                                                                 |
| --------------------------------------- | --------------------------------------------------------------------------- |
| Envio real ao fornecedor                | um número de WhatsApp só de compras, conectado como instância na Evolution  |
| "Entregue" de verdade                   | webhook de confirmação de entrega da Evolution                              |
| Reconciliação automática de `INCERTA`   | busca de mensagem por referência na Evolution                               |
| Fotos em produção                       | o volume `tetteo_arquivos` montado em `/app/arquivos` no Dokploy             |
| Rodada automática e despacho            | tarefa agendada chamando `/api/compras/tick` a cada minuto, com o segredo   |
| NF-e por XML                            | não existe importação de XML no Tetteo                                      |
