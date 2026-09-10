# Design do Tetteo

Este documento é a fonte da verdade visual do sistema. Ele registra o que foi
decidido, **e principalmente por quê** — para que ninguém, daqui a seis meses,
reabra uma decisão por engano ou desfaça uma trava de acessibilidade achando que
é enfeite.

Escrito em 09/09/2026, junto com a construção do Painel da operação.
Atualizado em 10/09/2026: cores, fonte e escala passaram para a **direção
Aurora**.

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

### Três decisões de cor que parecem detalhe e não são

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
   216px
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

**2. Emojis em telas de módulo.** 📋 🧾 📦 🎉 ✅ e outros continuam dentro de
`src/modules/` e `src/app/(shell)/<módulo>/`. Emoji não acompanha o tema, muda
de desenho conforme o computador e não é lido por leitor de tela. O conjunto
`Icone` cobre todos os casos.

**3. Fuso horário no cálculo de "atrasado".** As funções que decidem se algo
está vencido usam a data **local do servidor**. Se o servidor rodar em UTC, a
virada do dia acontece às 21h no horário do Brasil, e uma conta pode aparecer
como vencida três horas antes. Vale para o Financeiro e os Checklists inteiros.

**4. A largura da barra lateral.** O token `--shell-sidebar` da Aurora diz
208 px; o código da barra usa 216 px. Os dois estão dentro da faixa da
especificação (208–240), mas um dos dois precisa ceder.

**5. Barra lateral recolhível.** A especificação prevê recolher a barra no
computador, preservando a escolha. Não foi construída.

**6. Aviso de `Decimal` nas contas a pagar e a receber.** Essas telas passam o
objeto do banco direto para um componente de navegador, e o Next avisa que
`Decimal` não atravessa essa fronteira. Anterior a este trabalho; o painel não
tem o problema.

**7. `npm run format:check` falha** em
`docs/superpowers/specs/2026-08-09-jose-crm-marketing-design.md`, que já estava
fora de formato antes deste trabalho. `npm run format` resolve.

---

## 8. Como conferir

```bash
npm run check     # tipos + fronteiras + formato + testes
npm run build     # compila as rotas
npm run dev       # precisa de um Postgres no DATABASE_URL do .env.local
npm run demo      # dados de demonstração (só em banco local _dev/_test/_local)
npm run demo -- --apagar   # tira tudo que o demo criou
```

O teste de contraste (`src/app/contraste.test.ts`) confere **60 pares de cor**
nos dois temas e garante que os dois caminhos para o tema escuro
(`prefers-color-scheme` e `data-theme`) não divergem. Ele pegou sete pares
reprovados na primeira execução — nenhum deles parecia errado a olho nu.
