# Design do Tetteo

Este documento é a fonte da verdade visual do sistema. Ele registra o que foi
decidido, **e principalmente por quê** — para que ninguém, daqui a seis meses,
reabra uma decisão por engano ou desfaça uma trava de acessibilidade achando que
é enfeite.

Escrito em 09/09/2026, junto com a construção do Painel da operação.
Atualizado em 10/09/2026: cores, fonte e escala passaram para a **direção
Aurora**, e a tela de Checklists virou lista à esquerda e atividade à direita
(§8).

---

## 1. As cores

A cor não é escolhida por gosto: cada par frente/fundo tem que passar num
mínimo de contraste, e isso é **conferido por teste automático**
(`src/app/contraste.test.ts`). Trocar um `#` sem rodar `npm run test` é a forma
mais fácil de tornar o sistema ilegível sem ninguém perceber.

A Aurora trouxe seis cores prontas: fundo, superfície, texto, apoio, borda e
acento. As outras foram derivadas rodando o cálculo da WCAG, não a olho.

### Tema claro

| Token            | Cor       | Onde aparece                                  |
| ---------------- | --------- | --------------------------------------------- |
| `--paper`        | `#f2f3f5` | fundo da página                               |
| `--surface`      | `#fdfdfe` | cartão, barra lateral, topo                   |
| `--surface-2`    | `#ebecef` | campo de busca, linha sob o cursor            |
| `--surface-3`    | `#e0e2e7` | item ativo do menu, bloco de carregamento     |
| `--line`         | `#dbdde2` | separador de cartão, linha de tabela          |
| `--line-2`       | `#838790` | **borda de campo e de botão secundário**      |
| `--ink`          | `#202124` | texto principal                               |
| `--ink-2`        | `#45484f` | texto secundário                              |
| `--ink-3`        | `#646870` | apoio, rótulo de coluna — **o piso do texto** |
| `--accent`       | `#0066cc` | ação principal, item ativo, foco, gráfico     |
| `--accent-ink`   | `#ffffff` | texto dentro do botão azul                    |
| `--accent-sub`   | `#e3eefc` | fundo do destino ativo na barra               |
| `--ok` / `-sub`  | `#1a7548` | quitado, resolvido                            |
| `--warn`/`-sub`  | `#8a5b00` | em aberto, sem conexão                        |
| `--bad` / `-sub` | `#c0342a` | vencido, atrasado, erro                       |
| `--info`/`-sub`  | `#0b6e99` | a receber, informação neutra                  |

### Tema escuro

| Token          | Cor       |
| -------------- | --------- |
| `--paper`      | `#0f1114` |
| `--surface`    | `#191b1f` |
| `--surface-2`  | `#22252a` |
| `--surface-3`  | `#2d3036` |
| `--line`       | `#32353c` |
| `--line-2`     | `#6c717b` |
| `--ink`        | `#eceef1` |
| `--ink-2`      | `#b4b8c0` |
| `--ink-3`      | `#8b909a` |
| `--accent`     | `#6cb0ff` |
| `--accent-ink` | `#0a1220` |

Não é o claro invertido. Quatro regras que valem sempre:

1. **Nunca preto puro** — causa halo com texto claro em turno longo.
2. **Nunca branco puro** — contraste máximo vibra e cansa.
3. **Luz é altura** — o que está por cima é mais claro, não sombreado.
4. **Cor se ajusta** — saturado treme no escuro: clareia e dessatura.

Por isso o acento escuro **não é** o `#0066cc`: naquele fundo ele daria 2,4:1 e
sumiria. Ele sobe para `#6cb0ff`, e aí o texto por cima dele precisa ser
**escuro** (`#0a1220`). É o par invertido, e é de propósito.

### Quatro decisões de cor que parecem detalhe e não são

**Existem duas bordas, e elas não se trocam.** `--line` (`#dbdde2`) é o fio de
cabelo da Aurora: separa cartão de cartão e linha de linha, e seus 1,34:1 bastam
para um separador decorativo. `--line-2` (`#838790`) é a borda que diz onde um
**campo** começa e termina, e a WCAG 1.4.11 exige 3:1 dela. Usar `--line` num
campo de formulário é o erro que esse par existe para evitar — foi exatamente
esse erro (1,55:1) que o teste de contraste pegou na primeira execução.

**O `--info` é ciano, não azul.** Com um acento azul, um "info" azul viraria um
falso botão. Duas cores parecidas com significados diferentes é pior do que não
ter a segunda.

**A superfície não é branco puro** (`#fdfdfe`). É a regra 2 do tema escuro
valendo também no claro, em dose pequena.

**Texto sobre cor sólida é `--surface`, não branco.** Os botões Sim/Não/N/A
marcados da folha de checklist e o botão destrutivo usavam `text-white`. No
claro passava (5,7:1 no verde, 5,6:1 no vermelho); no escuro o verde, o
vermelho e o cinza clareiam, e branco em cima deles dava 2,2:1, 2,8:1 e 2,0:1 —
ilegível. `--surface` é quase branco no claro e quase preto no escuro: o par se
inverte sozinho. Os três pares entraram no teste de contraste.

---

## 2. Tipografia, espaço e forma

- **Família:** a do sistema operacional de quem lê — San Francisco no Mac e no
  iPhone, Segoe no Windows, Roboto no Android. **Nenhum arquivo de fonte é
  baixado**: a tela desenha no primeiro quadro, sem texto invisível esperando a
  fonte chegar e sem depender de servidor nenhum além do nosso.
- **Corpo do texto:** 16/24 px no celular, 14/21 px no computador, pelo token
  `--corpo`. O campo de formulário **precisa** de 16 px no celular: abaixo
  disso o iPhone dá zoom sozinho ao focar, e a tela pula.
- **Escala:** 12 / 13 / 14 / 16 / 18 / 20 / 24 / 28 / 34 px, em `rem`, para
  respeitar quem aumenta a fonte no navegador. **Nada fora dela.** 12 px é o
  piso do texto auxiliar.
- **Título de tela:** 24 px no celular, 28 px no computador.
- **Número:** `tabular-nums` no corpo inteiro — qualquer coluna de número alinha
  na vírgula sozinha, dentro ou fora de tabela.
- **Espaço:** múltiplos de 4. O gap padrão do painel é 16 px.
- **Cantos:** 6 px etiqueta · 8 px botão e campo · 10 px linha selecionada ·
  12 px cartão · 16 px painel de detalhe e gaveta.
- **Alvo de toque:** 44 px no celular, 36–40 px no computador.
- **Foco de teclado:** anel de 2 px com 3 px de afastamento. **Nunca removido.**
- **Movimento:** 150–250 ms (180 ms na troca de App), e some inteiro em
  `prefers-reduced-motion`.

---

## 3. A casca

```
┌──────────┬───────────────────────────────────────────┐
│  Tetteo  │  Caminho                    [Buscar  ⌘K]  │  topo 56px
│ [unidade]├───────────────────────────────────────────┤
│          │                                           │
│ Painel   │            área útil, 28px                │
│ ─────    │                                           │
│ [Módulo] │                                           │
│  destino │                                           │
│  destino │                                           │
│          │                                           │
│ ─────    │                                           │
│ [conta]  │                                           │
└──────────┴───────────────────────────────────────────┘
   208px
```

- **≥ 1180 px:** barra lateral fixa, com rolagem própria e a conta ancorada no
  rodapé.
- **< 1180 px:** a barra vira **gaveta** que entra pela esquerda, com o mesmo
  conteúdo. Vale para tablet e celular.

### Por que a gaveta é um `<dialog>`

O navegador entrega de graça, e sem defeito: foco preso dentro dela, `Esc`
fechando, o resto da página inerte para o leitor de tela, e o foco **voltando**
para o botão Menu ao fechar. Cada um desses itens, escrito à mão, é um punhado
de `useEffect` e uma armadilha de foco que quebra no primeiro `<select>`.

O mesmo vale para o painel de detalhe e para a busca.

### O que mudou de lugar

| Elemento           | Antes         | Agora                 | Por quê                                                                  |
| ------------------ | ------------- | --------------------- | ------------------------------------------------------------------------ |
| Seletor de unidade | topo          | barra lateral, alto   | É um seletor de espaço de trabalho; fica junto da marca                  |
| Conta e Sair       | topo          | barra lateral, rodapé | Onde a especificação pede, e onde a gaveta o torna alcançável no celular |
| Lista de módulos   | flutuante     | dentro da barra       | Um painel de 330px seria cortado dentro da gaveta de 280px               |
| Busca              | `<div>` falsa | busca real            | Ver §5                                                                   |

### "Rede Completa" só existe a partir da segunda loja

Com **uma** unidade, olhar "a rede" e olhar "a loja" devolve o mesmo dado — a
única diferença é que caixa, contagem e checklist param de funcionar, porque
exigem uma unidade. Quem abria o sistema pela primeira vez caía num painel vazio
pedindo para escolher uma unidade, com uma opção só na lista.

Por isso a visão de rede é o padrão só com duas lojas ou mais, e a opção some do
seletor enquanto houver uma só. Ela volta sozinha quando a segunda unidade for
cadastrada.

---

## 4. Os tijolos

Todos em `src/design-system/`. Nenhum conhece negócio — essa é a fronteira que
o `npm run lint` verifica.

| Componente                 | O que resolve                                                    |
| -------------------------- | ---------------------------------------------------------------- |
| `Icone`                    | 40 ícones desenhados, grade 24×24, traço 1,6                     |
| `Cartao` / `TituloDeSecao` | superfície e cabeçalho de seção                                  |
| `CabecalhoDePagina`        | o `h1` da tela, com filtros na mesma linha                       |
| `Indicador`                | um número com unidade, período e origem                          |
| `Etiqueta`                 | estado com **ponto + texto**                                     |
| `BarraDeFiltros`           | busca e situação, com limpar                                     |
| `Tabela`                   | tabela no computador, **cartões no celular**                     |
| `PainelLateral`            | detalhe em `<dialog>`, com `LinhaDeDetalhe`                      |
| `Vazio`                    | os três vazios diferentes (primeiro uso, sem resultado, tudo ok) |
| `Esqueleto`                | carregamento do tamanho do conteúdo que vem                      |
| `Botao` / `estiloDeBotao`  | o botão, e o estilo dele para links                              |
| `Campo`                    | campo com rótulo persistente (já existia)                        |
| `ControleSegmentado`       | Hoje/Semana com rádios de verdade: anda e escolhe pelas setas    |

### Três regras que valem mais que os componentes

**Cartão não entra dentro de cartão.** Se pareceu necessário, o de fora era uma
seção — e seção se separa com espaço e título, não com mais uma borda.

**Sombra é altura, não enfeite.** O cartão fica no plano da página e não tem
sombra. Quem tem sombra é o que flutua: menu, gaveta, painel.

**Navega é `<a>`, faz é `<button>`.** Quando um link precisa parecer botão, ele
usa `estiloDeBotao()` e continua sendo link. `<Link><Botao/></Link>` produz
`<a><button></a>`, que é HTML inválido — ver §7.

---

## 5. O Painel da operação

Substitui a antiga Home ("Bom dia, Pablo ☀️" + grade de ícones). A saudação
ocupava o topo sem informar nada, e a grade de módulos hoje vive na barra
lateral, que está em todas as telas.

**A regra que continua valendo:** o painel nunca vira o "App de tudo". Para
entrar aqui, um número tem que passar em dois testes — ser **do dia** e ser
**acionável**. Toda vez que alguém quiser somar mais um, a resposta padrão é
"isso mora no App X".

### O que ele mostra, e de onde vem

| Bloco              | Origem real                                            |
| ------------------ | ------------------------------------------------------ |
| Saldo em caixa     | `visaoDoCaixa()` — saldo inicial + tudo já quitado     |
| Vencido a pagar    | contas `PAGAR` + `ABERTO` + fora do prazo              |
| A pagar no período | contas `PAGAR` + `ABERTO` dentro do período            |
| Pendências abertas | `listarPendencias()` dos Checklists                    |
| Projeção do caixa  | `projetarSaldo()` — dia a dia, com tabela equivalente  |
| Prioridades        | pendências, **na ordem de urgência do próprio módulo** |
| Contas do período  | `listarLancamentos()` com busca, filtros e detalhe     |

### Não há vendas aqui, e a ausência é honesta

O Tetteo **não tem** módulo de pedido de cliente — Delivery e Analytics estão em
construção, e o único `Pedido` do banco é pedido de compra ao fornecedor. Não
existe venda, ticket médio nem tempo de preparo para mostrar. Um painel com
"ticket médio" inventado seria mais bonito e valeria menos que nada.

Quando o Delivery existir, os indicadores de venda entram aqui — e os quatro de
hoje continuam válidos.

### Onde cada filtro mora, e por quê

**Período fica no endereço** (`?periodo=30`). Ele muda o _conjunto_ de dados:
o servidor busca outras contas, e indicadores, gráfico e tabela mudam **juntos**.
Estando na URL, o botão Voltar funciona e o link colado no WhatsApp abre a mesma
tela.

**Busca e situação ficam na memória do navegador.** Elas só escondem parte do
que já está na tela. Mandá-las ao servidor faria uma requisição por tecla
digitada — e uma tela que pisca a cada letra ninguém usa para procurar.

**O detalhe também é local.** Por isso voltar dele devolve a lista exatamente
como estava: mesma busca, mesmo filtro, mesma rolagem. Não houve navegação para
desfazer.

### Três coisas que o painel se recusa a fazer

**Ausente não vira zero.** `valor={null}` mostra "—", nunca "R$ 0,00". Zero é um
fato; ausência é outro. Trocar um pelo outro faz decidir em cima de dado que não
existe.

**Sem comparação é uma resposta.** Não havendo período anterior válido, está
escrito "Sem comparação". Inventar "+12%" contra um mês incompleto é a forma
mais fácil de um painel mentir com números verdadeiros.

**Todo gráfico tem uma tabela.** O `<svg>` é `aria-hidden` porque a tabela ao
lado carrega o mesmo dado. Não é só acessibilidade: quem quer o valor do dia 14
precisa de um número, não de um pixel.

---

## 6. Estados que também foram desenhados

| Estado              | O que acontece                                                        |
| ------------------- | --------------------------------------------------------------------- |
| Carregando          | esqueleto do tamanho do conteúdo; a casca não pisca                   |
| Rede inteira        | explica que caixa é de uma loja e aponta o seletor                    |
| Sem permissão       | o bloco **não existe**; não revela quantos registros há do outro lado |
| Sem nenhum bloco    | mostra os módulos a que a pessoa tem acesso                           |
| Sem contas          | ensina a primeira ação (só para quem pode lançar)                     |
| Busca sem resultado | **preserva a busca** e oferece limpar                                 |
| Sem pendências      | tratado como **boa notícia**, não como lista vazia                    |
| Erro                | fica dentro da casca; "Tentar de novo" refaz só o que quebrou         |
| Sem conexão         | avisa que os números podem estar velhos — e **não promete salvar**    |

---

## 7. O que ficou pendente

Registrado aqui para não se perder.

**1. `<Link><Botao/></Link>` nas telas de módulo.** Produz `<a><button></a>`,
que é HTML inválido: o leitor de tela anuncia dois controles onde há um. A
ferramenta para corrigir já existe (`estiloDeBotao()`).

**2. Emojis em telas de módulo.** Continuam em 17 arquivos de `src/` (contagem
de 10/09/2026): Compras, Cardápio, Estoque, Financeiro, o Painel e um
comentário do registro de Apps. O módulo de Checklists está limpo. Emoji não
acompanha o tema, muda de desenho conforme o computador e não é lido por leitor
de tela. O conjunto `Icone` cobre todos os casos.

**3. Fuso horário no cálculo de "atrasado" — resolvido em 10/09/2026.** As
funções que decidem se algo está vencido usam a data **local do servidor**, e o
contêiner rodava em UTC: a virada do dia acontecia às 21h no horário do Brasil.
A correção é uma linha no `Dockerfile` (`ENV TZ=America/Sao_Paulo`), e não uma
reescrita das funções: elas continuam puras e testáveis, e o "local" delas
passou a ser o da operação. Vale para o Financeiro, o Estoque e os Checklists
de uma vez. Quando existir uma loja em outro fuso, isto volta a ser pendência.

**4. A largura da barra lateral — resolvido em 10/09/2026.** A barra passou a
usar o token `--shell-sidebar` (208 px, o valor da Aurora) em vez de 216 px
fixos no código.

**5. Barra lateral recolhível.** A especificação prevê recolher a barra no
computador, preservando a escolha. Não foi construída.

**6. Aviso de `Decimal` nas contas a pagar e a receber.** Essas telas passam o
objeto do banco direto para um componente de navegador, e o Next avisa que
`Decimal` não atravessa essa fronteira. Anterior a este trabalho; o painel não
tem o problema.

**7. `npm run format:check` falha** em
`docs/superpowers/specs/2026-08-09-jose-crm-marketing-design.md`, que já estava
fora de formato antes deste trabalho. `npm run format` resolve.

**8. Reativar uma rotina removida — resolvido em 10/09/2026.** Agendar de novo
um checklist cuja rotina foi removida **reativa a rotina antiga**, com a agenda
e o responsável novos, em vez de criar outra. Assim o histórico de conclusão
volta junto: uma rotina nova começaria do zero, e o "71% em agosto" sumiria da
tela sem ter sumido do banco. O checklist removido volta a aparecer em
"Agendar", e remover e reativar entram na auditoria.

**9. O fuso do "Hoje" — resolvido em 10/09/2026**, junto com o item 3.

**10. O tema escuro ainda não é alcançável.** A raiz força `data-theme="light"`.
Os pares de cor do escuro estão desenhados e provados pelo teste, mas nenhuma
tela foi conferida de olho no escuro.

---

## 8. Checklists: lista à esquerda, atividade à direita

O fluxo prioritário da Aurora. Antes, `/checklists` era uma lista de largura
inteira, e responder uma rotina **navegava para outra página**: a fila sumia, e
voltar custava um clique e a perda do lugar.

```
┌──────────┬───────────────────────────────────────────────────────┐
│          │ Checklists                      [Avulso] [Agendar]    │
│  barra   │ [Buscar rotina ou responsável        ] [Hoje|Semana]  │ 56px
│  lateral ├──────────────┬────────────────────────────────────────┤
│          │ Hoje         │ Abertura da Cozinha       ● Aguardando │
│          │ ● Coifa      │ Todo dia às 07:00 · 11 itens           │
│          │ ▌Abertura    │ Responsável: Alisson   Alterar         │
│          │ ● Fechamento │ 3 de 11 itens gravados                 │
│          │ ● Câmaras    │ a folha, item a item                   │
│          │    310px     │ Histórico de conclusão                 │
└──────────┴──────────────┴────────────────────────────────────────┘
```

### O que fica no endereço, e o que fica na memória

| O quê                   | Onde                 | Por quê                                                   |
| ----------------------- | -------------------- | --------------------------------------------------------- |
| Período (Hoje/Semana)   | `?periodo=semana`    | troca o **conjunto** de rotinas que o servidor busca      |
| Rotina aberta à direita | `?rotina=<id>`       | Voltar desfaz a seleção; o link colado abre a mesma tela  |
| Busca                   | memória do navegador | só esconde o que já veio; no servidor, 1 pedido por letra |

A lista é um componente de cliente e o detalhe é de servidor, entregue a ela
como `children`. Por isso a busca **sobrevive** à troca de rotina: a navegação é
suave e a lista não é remontada.

### Celular e tablet (abaixo de 1180 px)

Lista e detalhe **se revezam**: o detalhe vira uma página, com "‹ Rotinas de
hoje" no topo. A lista não é desmontada, só escondida — busca, período e a
posição da rolagem estão lá quando a pessoa volta. Com o detalhe aberto, somem
também a faixa de pendências e os botões secundários, que empurrariam a folha
para baixo.

### A folha salva item a item — decisão do Pablo, 10/09/2026

A regra anterior era um botão "Salvar" no fim da página, de propósito: a
internet da cozinha cai. A Aurora pede que marcar um item grave na hora, com
confirmação do servidor. O Pablo escolheu a Aurora, e o preço foi pago na tela:

- **Toque grava; digitação grava ao sair do campo.** Uma requisição por tecla
  seria uma tempestade.
- **Falhou, desfaz.** O item volta ao que o servidor tinha confirmado, com o
  motivo ao lado e **"Tentar de novo"** — que reenvia o que a pessoa _quis_
  marcar, e não o valor para o qual a tela voltou.
- **Uma fila por item.** Marcar "não" e corrigir para "sim" em meio segundo não
  pode deixar o "não" chegar por último.
- **O progresso conta o que o servidor tem**, não o que está na tela.
- **Quem e quando.** Cada item mostra "Gravado às 07:12 por Alisson Ferreira" —
  o horário é o do servidor, formatado no fuso da operação.
- **A lista acompanha, sem ir ao servidor.** Quando a contagem de gravados
  muda, a folha avisa a lista pelo próprio navegador. A primeira versão pedia
  ao servidor para redesenhar a página — e, no teste com a conexão cortada, a
  consulta falhou, a tela inteira recarregou e levou junto o aviso de "não
  gravado". Na cozinha, internet oscilando é o caso comum.
- **Concluir diz o que falta.** O botão fica travado enquanto houver pendência,
  com "7 itens faltam · ver quais" ao lado. A lista sai da **mesma função** que
  o servidor usa para recusar o fechamento (`impedimentosParaFechar`), aplicada
  ao que o servidor confirmou.

### Responsável em painel lateral

Não existia troca de responsável depois de criada a rotina. Agora existe, num
painel lateral (`<dialog>`): lista só quem tem acesso à loja, "quem estiver de
plantão" é uma escolha na mesma lista, sair com a escolha mexida pergunta antes,
o erro do servidor aparece dentro do painel sem perder a escolha, e a
confirmação diz **de quem** a rotina passou a ser. A troca vai para a auditoria.

### Remover rotina e cancelar checklist

Os dois perguntam antes (`confirm` do navegador) e travam o botão enquanto o
pedido está no ar. Cancelar um checklist não tem volta. Remover uma rotina tem:
agendar o mesmo checklist de novo reativa a rotina, com o histórico — e a
pergunta de confirmação diz isso (pendência 8 do §7).

### Estados desta tela

| Estado                     | O que acontece                                                 |
| -------------------------- | -------------------------------------------------------------- |
| Carregando                 | esqueleto com as medidas da lista de 310 px e da folha         |
| Nenhuma rotina selecionada | "Escolha uma rotina à esquerda"                                |
| Nenhuma rotina agendada    | ensina a criar o primeiro checklist (só para quem pode editar) |
| Nada pendente hoje         | boa notícia, com o caminho para "Ver a semana"                 |
| Busca sem resultado        | a busca continua escrita; "Limpar a busca"                     |
| Rotina fora do período     | diz que ela existe mas não em "Hoje", e leva à semana          |
| Item não gravado           | volta ao que estava, diz o motivo, oferece "Tentar de novo"    |
| Rede inteira               | pede uma unidade e diz onde fica o seletor                     |
| Perfil só acompanha        | mostra a rotina e diz que o perfil não permite responder       |

---

## 9. Como conferir

```bash
npm run check     # tipos + fronteiras + formato + testes
npm run build     # compila as rotas
npm run dev       # precisa de um Postgres no DATABASE_URL do .env.local
npm run demo      # dados de demonstração (só em banco local _dev/_test/_local)
npm run demo -- --apagar   # tira tudo que o demo criou
```

O teste de contraste (`src/app/contraste.test.ts`) confere **66 pares de cor**
nos dois temas e garante que os dois caminhos para o tema escuro
(`prefers-color-scheme` e `data-theme`) não divergem. Ele pegou sete pares
reprovados na primeira execução — nenhum deles parecia errado a olho nu.

---

## 10. A Despensa (Estoque)

Escrito em 10/09/2026. A primeira tela do Estoque deixou de ser "Posição" —
uma linha por prateleira — e virou a **Despensa**: uma linha por insumo, com o
total da loja, e a lista de compras ao lado. Rota, permissões e regras do
Estoque continuam as mesmas; as cores e a tipografia são as da Aurora, acima.

### O que ela responde, e para quem

Quem conta pergunta "quanto tem na câmara fria?". Quem compra pergunta "quanto
tem na loja?". A Posição respondia a primeira, e com o mesmo insumo em três
linhas ninguém somava de cabeça na hora de pedir. A Despensa responde a segunda
— e a divisão por prateleira mora no painel de detalhe, onde ela é resposta e
não ruído.

```
┌ Despensa ─────────────────────────────────── [Nova contagem] ┐
│ Para repor · Nunca contados · Sem mínimo · Valor em estoque   │
├───────────────────────────────────────┬──────────────────────┤
│ O que existe              [Categoria] │ Lista de compras     │
│ [Buscar…] (Todos)(Repor)(…)           │ Rascunho — ainda não │
│ Item · Categoria · Disponível ·       │ salvo                │
│ Mínimo · Situação · Lista             │ …                    │
│                 70%                   │         30%          │
└───────────────────────────────────────┴──────────────────────┘
```

Abaixo de 1180 px a lista desce para baixo da tabela; no celular a tabela vira
cartões com o rótulo de cada campo.

### As três unidades, que não são a mesma coisa

| Unidade    | De onde vem                                           | Exemplo             |
| ---------- | ----------------------------------------------------- | ------------------- |
| Contagem   | `Insumo.unidadeMedida` (e o `unidadeRotulo`)          | 12,5 kg · 46 pct    |
| Compra     | `EmbalagemCompra`, com o `fator`                      | Caixa 10 kg = 10 kg |
| Disponível | soma das `PosicaoEstoque` da loja, na de **contagem** | 7,6 kg              |

**Caixa só vira quilo quando o cadastro diz quantos quilos ela tem.** Sem
embalagem cadastrada, o detalhe escreve isso — não inventa uma caixa.

### As quatro situações

| Situação      | Quando                                                  | Tom     |
| ------------- | ------------------------------------------------------- | ------- |
| Repor         | tem mínimo, e o disponível está abaixo dele             | `aviso` |
| Suficiente    | tem mínimo, e o disponível chega nele                   | `ok`    |
| Sem mínimo    | tem saldo, mas não tem mínimo — **nunca vira saudável** | neutro  |
| Nunca contado | nenhuma posição nesta loja — **em branco não é zero**   | `info`  |

"Nunca contado" mostra "—" e fica de fora do valor em estoque — e o indicador
diz quantos ficaram de fora, senão o total parece completo e não é.

### A lista de compras

- **É rascunho.** Mora no `sessionStorage`, por unidade: sobrevive a filtro,
  detalhe e recarregar; morre quando a aba fecha. É lida com
  `useSyncExternalStore`, não com `useEffect` — sem pulo na primeira pintura e
  sem divergência de hidratação.
- **A sugestão tem dono.** "Mínimo 15 kg − disponível 3,5 kg" aparece embaixo
  do número; mexeu no campo, a origem some. Sem mínimo ou sem saldo conhecido,
  o campo entra **vazio**.
- **Vira Cotação em Compras.** A ação mora em
  `src/app/(shell)/estoque/acoes-da-despensa.ts`, e não no App de Estoque: um
  App nunca importa de outro. Ela usa o `criarCotacao` e o `adicionarItem` do
  próprio Compras, e grava a origem na cotação e em cada item.
- **Um envio por vez.** A trava é um `ref`, que vale já no segundo clique de um
  duplo clique. Se a ação falhar no meio dos itens, a cotação parcial é
  **cancelada** (`cancelarCotacao`), e a lista continua na tela.
- **Depois de virar cotação, o rascunho some**, para a mesma lista não ser
  mandada de novo amanhã.

### A contagem

| Proteção       | O que evita                                                                                                                         |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Rascunho       | "Salvar" não mexe em saldo; só "Fechar" corrige a posição e congela o custo                                                         |
| Confirmação    | Fechar não tem volta: a janela diz quantos foram contados, quantos ficam em branco e se o saldo do lugar será corrigido             |
| Conflito       | Campo não mexido não é gravado; o que outra pessoa mudou enquanto a folha estava aberta vira aviso com nome e hora, e não é apagado |
| Não salvo      | Sair pelo menu ou fechar a aba com campo alterado pergunta antes                                                                    |
| Erro não apaga | O envio sai pelo `onSubmit`; com `action`, o React 19 limpa os campos não controlados até quando a ação volta com erro              |

A regra do conflito é uma função pura (`schemas/edicao-de-contagem.ts`) com dez
testes, e a escrita repete a checagem no próprio banco (`updateMany` com a base
no filtro) — entre ler e gravar, uma terceira pessoa pode salvar.

### Dados de demonstração da Despensa

```bash
npm run demo:despensa          # 12 insumos, cobrindo as quatro situações
npm run demo:despensa:limpar   # tira os insumos e o rastro dos testes
```

Recusa rodar fora de um banco local. Apague **antes** de importar o catálogo
real, ou haverá dois cadastros de mussarela. Se um insumo de demonstração tiver
ido parar numa nota, num pedido ou numa ficha técnica, o `limpar` para e
explica, em vez de apagar dinheiro em silêncio.

### O que ficou pendente na Despensa

**1. Altura da linha.** A especificação pede 56 px; a tabela compartilhada dá
isso nas linhas com o botão "Adicionar". Não foi criada uma tabela só para
acertar a medida.

**2. O Estoque ainda está `emConstrucao`.** Só o Diretor vê o módulo. Liberar
para a equipe é decisão de quem manda na operação, não da tela.

**3. Cancelar ou descartar contagem não pede confirmação.** Descartar uma
contagem fechada tira uma base do CMV — merece a mesma janela do "Fechar".

**4. O filtro por prateleira da antiga Posição** virou a seção "Onde está" do
detalhe. O link antigo `?faltando=1` continua abrindo a Despensa em "Repor".

**5. Lista longa.** Segue o padrão das outras telas: tudo filtrado na memória,
com o total à vista ("12 de 12 insumos"). Para catálogos de milhares de itens,
paginar.
