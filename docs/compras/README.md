# Compras — do pedido da loja à conferência do recebimento

O App de Compras do Tetteo leva a compra da semana de ponta a ponta, sem
planilha e sem mensagem perdida:

```
Loja ─► Requisição ─► Rodada (consolida) ─► Cotação (link do fornecedor)
     ─► Comparação ─► Pedido ─► Aprovação ─► Envio (fila) ─► Recebimento
     ─► Estoque (nota de entrada) ─► Conta a pagar (Financeiro)
```

Cada etapa tem dono, cada mudança fica registrada, e nada importante acontece
por omissão: sem resposta não é preço zero, mensagem na fila não é mensagem
entregue, e mensagem entregue não é pedido confirmado.

---

## 1. As telas

| Tela                 | Endereço                                       | Quem usa                 | Para quê                                                            |
| -------------------- | ---------------------------------------------- | ------------------------ | ------------------------------------------------------------------- |
| Rodadas              | `/compras`                                     | todos com Compras        | Lista das rodadas, com filtro de loja e estado                      |
| Nova rodada          | `/compras/rodadas/nova`                        | quem compra              | Lojas, prazos e janela de entrega                                   |
| Rodada               | `/compras/rodadas/[id]`                        | todos                    | Etapas, próximo passo, lojas, itens, fornecedores e links           |
| Lançar resposta      | `/compras/rodadas/[id]/proposta/[solicitação]` | quem compra              | Digitar o que o fornecedor mandou pelo WhatsApp                     |
| Requisição           | `/compras/requisicao`                          | loja                     | A lista da loja, com a sugestão e a conta escrita                   |
| Comparação           | `/compras/comparacao`                          | quem compra, quem aprova | A grade de preços e a sugestão de menor custo total                 |
| Aprovação            | `/compras/aprovacao`                           | Diretor                  | Os pedidos esperando o "sim", linha por linha                       |
| Pedidos e envios     | `/compras/pedidos`                             | todos                    | Pedidos, e as mensagens aos fornecedores (aba Envios)               |
| Pedido               | `/compras/pedidos/[id]`                        | todos                    | Itens congelados, situação do envio, confirmação, adendo, alteração |
| Recebimento          | `/compras/recebimento`                         | loja                     | Pedidos esperando o caminhão e divergências abertas                 |
| Conferência          | `/compras/recebimento/[id]`                    | loja                     | Conferir o que chegou, entregas anteriores, devolução               |
| Fornecedores         | `/compras/fornecedores`                        | todos                    | Cadastro, o que cada um vende e para onde vai o pedido              |
| Configurações        | `/compras/configuracoes`                       | Diretor                  | Alçadas, envio (pausar, número de teste) e rodada automática        |
| Página do fornecedor | `/fornecedor/cotacao#…`                        | fornecedor, sem login    | Responder a cotação pelo link                                       |

Os filtros das listas ficam no endereço: voltar de uma tela de detalhe devolve
a lista como estava, e um link colado no WhatsApp abre o mesmo recorte.

---

## 2. Instalar e ligar

```bash
npx prisma migrate deploy   # cria as tabelas de Compras
npm run seed                # papéis padrão; o Diretor ganha alçada sem limite
```

A migração `…_compras_fluxo` converte as cotações antigas em rodadas, mantendo
os mesmos ids: um link antigo de cotação (`/compras/cotacoes/[id]`) continua
abrindo a rodada certa.

**Demonstração** (só em banco LOCAL de desenvolvimento — o script recusa
qualquer outro):

```bash
npx tsx prisma/compras-demo.ts            # cria a "Rede Exemplo", toda inventada
npx tsx prisma/compras-demo.ts --apagar   # remove tudo o que ela criou
```

A demonstração cria uma organização separada, com lojas, pessoas,
fornecedores e preços fictícios. As senhas das contas de teste são sorteadas e
gravadas em `credenciais-demo-compras.txt`, na raiz do projeto — o arquivo está
fora do git e não deve ser compartilhado.

**Testes**:

```bash
npm test                  # regras puras: conversão, arredondamento, sugestão, alçada, link…
npm run test:integracao   # fluxos com banco — só em banco local com "_test" no nome
```

Os testes com banco usam `DATABASE_URL_TESTE` e recusam rodar fora de
`localhost` ou num banco sem `_test` no nome. Em teste, o envio é SEMPRE o
simulador: nenhuma mensagem real sai.

---

## 3. Configuração

Os valores reais moram no ambiente privado do servidor (painel do Dokploy em
produção, `.env.local` na sua máquina). Nunca em arquivo versionado, nunca em
print, nunca nesta documentação.

| Variável                      | Para quê                                                                                                          | Padrão                                          |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `COMPRAS_CANAL`               | `simulador` (nada sai) ou `whatsapp`                                                                              | `simulador`                                     |
| `COMPRAS_EVOLUTION_INSTANCIA` | Instância da Evolution **só de Compras**. É recusada se for a mesma da Severina                                   | —                                               |
| `COMPRAS_EVOLUTION_API_KEY`   | O token DESSA instância (na Evolution, o token é por instância; o `EVOLUTION_API_KEY` do sistema é o da Severina) | —                                               |
| `EVOLUTION_URL`               | O endereço da Evolution que já existe                                                                             | —                                               |
| `COMPRAS_TICK_SEGREDO`        | Senha do relógio. Sem ela, a batida fica fechada (responde 401)                                                   | —                                               |
| `APP_URL`                     | Base do link que vai para o fornecedor                                                                            | —                                               |
| `AUTH_SECRET`                 | Também gera a chave que cifra a cópia do link. Trocar = links abertos param de copiar; reemita                    | —                                               |
| `ARQUIVOS_DIR`                | Pasta das fotos do recebimento                                                                                    | `/app/arquivos` em produção; `.arquivos/` local |

**O relógio.** Uma tarefa agendada chama `POST /api/compras/tick` a cada minuto,
com o cabeçalho `x-compras-segredo`. Em cada batida ele: abre as rodadas
agendadas da semana, solta travas vencidas, envia um lote de até 8 mensagens
(uma a cada 4 segundos) e confere as mensagens incertas. A resposta é um JSON
com o que fez — dá para chamar à mão no dia em que algo não sair.

**As fotos.** Em produção, `/app/arquivos` precisa ser um volume persistente no
Dokploy; sem isso, as fotos somem a cada nova versão publicada.

---

## 4. Permissões

| Permissão              | O que libera                                                         |
| ---------------------- | -------------------------------------------------------------------- |
| `compras.ver`          | Ver rodadas, pedidos, envios e fornecedores                          |
| `compras.requisitar`   | Preparar e enviar a requisição da própria loja                       |
| `compras.rodadas`      | Abrir, avançar, reabrir e cancelar rodadas; agenda automática        |
| `compras.cotar`        | Convidar fornecedores, lançar propostas, escolher de quem comprar    |
| `compras.pedir`        | Gerar pedidos, adendo, alteração, registrar a resposta do fornecedor |
| `compras.aprovar`      | Aprovar e recusar pedidos — **dentro da alçada**                     |
| `compras.enviar`       | Cuidar do envio: tentar de novo, resolver incerta, pausar, testar    |
| `compras.receber`      | Conferir o recebimento e registrar devolução na própria loja         |
| `compras.fornecedores` | Cadastrar fornecedores, produtos e o destino das mensagens           |
| `compras.configurar`   | Mudar alçadas e o número de teste                                    |

Padrão do seed: o **Diretor** tem tudo; o **Gerente** requisita e recebe na
própria loja. Toda permissão é conferida no SERVIDOR — esconder um botão é
cortesia, não segurança. Uma loja nunca vê nem mexe no pedido, na requisição ou
no recebimento de outra.

---

## 5. De onde vem cada preço

| Origem                  | Quando                                    | O que fica gravado                                 |
| ----------------------- | ----------------------------------------- | -------------------------------------------------- |
| Proposta **pelo link**  | O fornecedor respondeu na página dele     | Versão, "pelo link", data e hora                   |
| Proposta **digitada**   | Veio pelo WhatsApp e o comprador digitou  | Versão, quem digitou                               |
| **Negociação**          | Depois de encerrada a cotação             | Versão, quem, e o motivo (obrigatório)             |
| **Preço de referência** | Item de fornecedor fixo que não confirmou | O valor, a data e de onde veio ("tabela de 02/09") |

- Nada é sobrescrito: resposta nova é versão nova; a comparação usa a mais nova
  e as anteriores ficam na tela da resposta.
- **Ausência não é zero.** Sem resposta, "não tem" e preço zero são três coisas
  diferentes. Preço zero nunca é aceito pelo link; pelo comprador, só com
  autorização explícita e motivo (bonificação combinada).
- No pedido, cada linha guarda a origem do preço ("Proposta v2 · Distribuidora
  Exemplo A"), e o pedido aprovado não muda mais.

---

## 6. Conversão de embalagem

- A embalagem é dita em partes: **peças × conteúdo de cada peça**. A conversão
  segue a dimensão: peso (g ↔ kg), volume (ml ↔ L), contagem (un).
  Caixa de 12 × 900 g = **10,8 kg**.
- Conteúdo sem unidade, dimensão errada (litro para um insumo em quilo) ou peça
  sem peso: o sistema **não chuta**. A célula aparece como "Conferir embalagem"
  e fica fora da disputa automática.
- Ninguém compra 1,85 caixa: a quantidade vira **embalagens inteiras, por
  loja**. O que sobra por arredondar ("+1,6 kg a mais") e quanto isso custa
  aparecem na tela.
- Todas as contas são em números inteiros — centavos, milésimos de quilo, fator
  × 10.000, preço por unidade × 1.000.000 — sem arredondamento escondido. Cada
  linha é arredondada **uma vez**, meio para cima; o total é a soma das linhas
  mais o frete. A regra usada fica gravada no pedido
  (`linha-meio-para-cima-v1`).

---

## 7. Comparação e sugestão

- Cada célula da grade mostra o custo do **item inteiro** naquele fornecedor, já
  em embalagens inteiras por loja. Embaixo, o total de cada fornecedor com
  **frete por entrega** (uma por loja atendida) e **pedido mínimo por entrega**.
- A sugestão de menor custo total **testa as combinações** de fornecedores (até
  12; acima disso, pega o mais barato de cada item e avisa). Fornecedor sem
  frete informado fica de fora — ausência não vira vantagem —, e combinação que
  não atinge o mínimo é descartada.
- Não existe ranking de qualidade: não há histórico que o sustente.
- Quem escolhe é o comprador, item a item. Escolher diferente da sugestão, ou um
  fornecedor que não tem a quantidade toda, **exige uma frase**, que fica
  gravada ao lado da escolha.
- "Gerar pedidos" cria um pedido por loja e fornecedor. Item sem escolha precisa
  ser marcado como "não comprar nesta rodada" — o sistema diz qual falta.

---

## 8. Aprovação e alçada

- Aprovar exige a permissão `compras.aprovar` **e** uma alçada que cubra o total
  do pedido. A conferência acontece no servidor, dentro da mesma transação que
  aprova.
- A alçada é por papel e tem **versão**: mudar cria a versão seguinte, e a
  aprovação grava sob qual alçada e versão foi feita. Decisão de 10/09/2026:
  começa com o Diretor, sem limite.
- O pedido tem versão: se alguém ajustou enquanto outra pessoa olhava, aprovar a
  versão velha é recusado — com quem mudou e quando.
- Aprovado, o pedido fica **congelado**: fornecedor, destino, loja, endereço,
  condição de pagamento e preços. Mudança depois disso só de dois jeitos:
  - **Adendo**: itens NOVOS, num pedido filho com a próxima sequência
    (PC-0104/2), só com o que faltou, com aprovação e mensagem próprias.
  - **Alteração ou cancelamento**: só diminui; vai ao fornecedor como mensagem
    própria, e a resposta dele é registrada.

---

## 9. Envio ao fornecedor

- A mensagem nasce **na mesma transação** que aprova o pedido: não existe pedido
  aprovado sem mensagem, nem mensagem de pedido que não foi aprovado. O destino é
  decidido pelo servidor (telefone de pedidos autorizado) e congelado.
- Cada mensagem tem uma chave única: enfileirar de novo devolve a mesma.
- Situações, e o que cada uma quer dizer:

| Situação             | Quer dizer                                                              |
| -------------------- | ----------------------------------------------------------------------- |
| Bloqueada            | Não dá para mandar (sem telefone, sem autorização). A tela diz o motivo |
| Na fila              | Vai sair na próxima batida do relógio                                   |
| Saindo agora         | Uma cópia do servidor pegou a mensagem                                  |
| Aceita pelo canal    | O WhatsApp recebeu. **Não** é entregue                                  |
| Simulado — nada saiu | O simulador recebeu; nada foi para fora                                 |
| Entregue             | Chegou ao celular do fornecedor                                         |
| Incerta              | Não se sabe se saiu. **Nunca** é reenviada sozinha                      |
| Falhou               | Desistiu depois de 5 tentativas, ou o número é inválido                 |
| Enviada à mão        | Alguém mandou pelo próprio WhatsApp e marcou                            |
| Cancelada            | Substituída, revogada, ou enviada à mão antes de sair                   |

- Tentativas: até 5, com espera de 1, 4, 9 e 16 minutos. Cada mensagem é travada
  por 2 minutos por quem a pegou: duas cópias do servidor nunca mandam a mesma.
- **Simulador + copiar** (decisão de 10/09/2026): enquanto não houver número de
  Compras, a mensagem é copiada e mandada pelo WhatsApp de quem compra;
  "Mandei pelo meu WhatsApp" registra e cancela o que ainda ia sair — o
  fornecedor nunca recebe duas vezes.
- "Pausar todo o envio" (com motivo, visível para todos) e o número de teste
  (mensagem de teste vai SÓ para ele) ficam em Configurações.
- Se o telefone do fornecedor mudou com a mensagem na fila, ela **não** segue
  sozinha: alguém decide "Usar o número novo".
- A confirmação do fornecedor é registrada à parte, com o que ele disse.

---

## 10. O link do fornecedor

- Um código aleatório de 256 bits por fornecedor e rodada. No banco ficam só o
  resumo (hash) e uma cópia cifrada, para quem compra poder copiar de novo. O
  código vai depois do "#" no endereço — não aparece em log nem é repassado a
  outros sites.
- Vence no prazo da cotação; pode ser desativado (vazou, número errado) e
  reemitido — o anterior para de valer na hora.
- Freios: 10 envios inválidos seguidos bloqueiam o link; um envio a cada 10
  segundos; até 30 versões; limite por endereço de rede.
- A página mostra **só o que é do fornecedor**: os itens pedidos a ele, as
  quantidades e as lojas de entrega. Nenhum preço de concorrente, nenhum preço de
  referência, nenhuma outra loja. Não aparece em buscador.

---

## 11. Recebimento

- A loja conta como o caminhão entrega — caixas inteiras, ou quilos a granel — e
  a tela converte na hora pelo fator **do pedido** ("2 caixas = 21,6 kg").
- **Parcial**: entra o que chegou; o saldo de cada item fica pendente para a
  próxima entrega. "Chegou tudo o que falta" preenche o saldo.
- **Chegou a mais**: sem decisão não passa. Aceitar tudo (vira divergência) ou
  recusar o excesso na porta.
- **Avariado**: não entra no estoque e abre divergência com o valor.
- **Veio outro produto**: sem decisão não passa; aceito, entra como o que veio.
- Lote, validade, observação e até 6 fotos por item (JPEG, PNG ou WebP até
  5 MB, conferidos pelo conteúdo do arquivo). As fotos são privadas da
  organização.
- A chave da conferência nasce quando a tela abre: dois cliques, uma entrada.
- **Estoque**: a entrada acontece pela nota de entrada do Estoque, **na mesma
  transação** do recebimento (custo médio ponderado). Se a nota já tinha sido
  lançada à mão, o recebimento se liga a ela, sem segunda entrada.
- **Conta a pagar**: criada pelo Financeiro depois de gravar, uma por nota — dois
  cliques ou duas pessoas não criam duas contas. Sem permissão do Financeiro, fica
  para quem cuida dele (Financeiro › Importar notas).
- **Devolução**: é um registro novo, com movimento próprio no estoque — a entrada
  original não se apaga. Não se devolve mais do que entrou, e o CMV desconta a
  devolução.

---

## 12. Conciliação

As divergências ficam abertas até alguém escrever o que foi feito:

| Tipo                     | Quando aparece                                   |
| ------------------------ | ------------------------------------------------ |
| Faltou                   | O saldo foi encerrado sem chegar                 |
| Chegou a mais            | Excedente aceito ou recusado                     |
| Avaria                   | Mercadoria avariada na conferência               |
| Veio outro produto       | Substituição aceita ou recusada                  |
| Saldo encerrado          | "O resto não vem mais"                           |
| Nota: quantidade / valor | A nota ligada diz um número, a conferência outro |
| Devolução                | Voltou depois de entrar                          |

"Encerrar o saldo pendente" fecha o pedido com o que chegou; o que faltou vira
divergência, para acertar com o fornecedor.

---

## 13. Guia de recuperação

| Aconteceu                                        | O que fazer                                                                                                        |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Mensagem "Incerta"                               | Confira no WhatsApp do fornecedor. "Conferi: chegou" ou "Não chegou: reenviar" — nunca reenvie antes de conferir   |
| Mensagem "Falhou"                                | Leia o erro na linha. Corrija telefone ou autorização no fornecedor e use "Tentar de novo", ou copie e mande à mão |
| WhatsApp fora do ar ou número bloqueado          | "Pausar todo o envio" com o motivo; mande à mão o que for urgente; retome quando voltar                            |
| Nada sai da fila                                 | O relógio parou. Confira a tarefa agendada; chame `POST /api/compras/tick` com o segredo e leia a resposta         |
| Link vazou ou foi para o número errado           | Na rodada: "Desativar link", depois "Mandar link novo"                                                             |
| Pedido aprovado com erro                         | Diminuir ou cancelar: alteração no pedido. Faltou item: adendo                                                     |
| Conferência lançada errado                       | Devolução na tela da conferência — recebimento não se edita                                                        |
| O resto da entrega não vem                       | "Encerrar o saldo pendente", com o motivo                                                                          |
| Conta a pagar não foi criada                     | Financeiro › Importar notas: a nota está lá, e não duplica                                                         |
| Caiu a luz ou a internet no meio de uma gravação | Cada gravação é uma transação: ou gravou tudo, ou nada. Repita — a chave evita duplicar                            |
| `AUTH_SECRET` foi trocado                        | Os links abertos param de copiar: reemita os da rodada em cotação                                                  |
| Foto não sobe                                    | Até 5 MB, JPEG/PNG/WebP. Em produção, confira o volume de `ARQUIVOS_DIR`                                           |

---

## 14. O que depende de integração real

Funciona hoje com o simulador; para sair de verdade falta:

- **Um número de WhatsApp só de Compras**, conectado na Evolution, separado do
  número da Severina, e o ambiente com `COMPRAS_CANAL=whatsapp`,
  `COMPRAS_EVOLUTION_INSTANCIA` e `COMPRAS_EVOLUTION_API_KEY` (o token dessa
  instância).
- **O relógio agendado** no Dokploy chamando a batida a cada minuto, com
  `COMPRAS_TICK_SEGREDO`.
- **O aviso de entrega** do WhatsApp (webhook da Evolution): sem ele, a mensagem
  para em "Aceita pelo canal" e nunca vira "Entregue".
- **A consulta de mensagem por referência** na Evolution: sem ela, toda
  "Incerta" fica para uma pessoa decidir.
- **Um volume persistente** para as fotos (`/app/arquivos`).
- **A leitura do XML da NF-e**: não existe ainda — a nota é digitada no
  recebimento ou ligada a uma já lançada no Estoque.

---

## 15. O contrato de um canal (para quem programa)

Qualquer canal — o simulador, o WhatsApp, e-mail um dia — implementa isto, em
`src/connectors/fornecedores/contrato.ts`:

```ts
type ResultadoDoCanal =
  | { tipo: "aceita"; idProvedor: string } // recebeu; NÃO é "entregue"
  | { tipo: "recusada-antes"; erro: string; tentarDeNovo: boolean }
  | { tipo: "incerta"; erro: string }; // nunca reenviar às cegas

type ConsultaDoCanal = "aceita" | "nao-encontrada" | "desconhecido";

interface CanalDeFornecedor {
  nome: "simulador" | "whatsapp";
  simulado: boolean; // true = nada sai, e a tela diz isso
  enviar(m: {
    destino: string;
    texto: string;
    chave: string;
  }): Promise<ResultadoDoCanal>;
  consultar(m: {
    chave: string;
    idProvedor: string | null;
  }): Promise<ConsultaDoCanal>;
}
```

O relógio (`src/app/api/compras/tick/relogio.ts`) liga a fila ao canal. A fila
(`src/modules/compras/services/fila.ts`) não conhece nenhum canal.

---

## 16. O que os testes garantem

As regras puras (conversão, arredondamento, sugestão com frete e mínimo,
alçada, validade do link, validação da resposta, conferência) têm testes em
`src/modules/compras/schemas/*.test.ts`. Os fluxos com banco, em
`*.integracao.ts`, cobrem entre outros:

- fornecedor fixo vira compra direcionada; tirar da disputa exige motivo;
- link vencido, revogado, reemitido, bloqueado por tentativas; preço zero pelo link;
- 12 × 900 g = 10,8 kg calculado no servidor; resposta nova é versão nova;
- escolher fora da sugestão exige justificativa; gerar pedidos duas vezes não duplica;
- alçada conferida no servidor (inclusive para o Diretor); duas aprovações ao
  mesmo tempo: uma passa, uma mensagem só; aprovar versão velha é recusado;
- outra loja não vê pedido nem confere recebimento;
- duas cópias do servidor nunca pegam a mesma mensagem; resposta perdida depois de
  enviar não reenvia; espera crescente e desistência; telefone mudado não segue
  sozinho; enviada à mão cancela o que ia sair;
- adendo leva só o novo, com a sequência seguinte;
- recebimento parcial, excedente, avaria, duplo clique, duas conferências ao mesmo
  tempo, falha no meio da transação (nada fica gravado), nota já lançada à mão,
  conta a pagar sem duplicar, devolução.

Todos os dados de teste são inventados, e nenhuma mensagem real sai de um teste.
