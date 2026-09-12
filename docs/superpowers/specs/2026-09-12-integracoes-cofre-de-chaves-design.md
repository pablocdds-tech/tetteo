# Integrações — o cofre de chaves, e a casa do MCP

**Data:** 12/09/2026
**Módulo novo:** `integracoes`
**Estado:** desenho aprovado, pronto para virar plano de implementação

---

## 1 · O que é

Um lugar único para as chaves de API e segredos dos serviços que o Tetteo usa — separadas por integração, por loja quando for o caso, e guardadas cifradas.

Hoje toda chave vive em variável de ambiente: `EVOLUTION_API_KEY`, `GEMINI_API_KEYS`, `SEVERINA_TICK_SEGREDO`, `DATABASE_URL`. Isso é seguro e tem um defeito prático: **ligar uma integração nova depende de deploy**. Quem quer conectar o Cardápio Web numa terça à noite não consegue sozinho.

O pedido do dono, em 12/09: _"crie dentro do Tetteo o módulo de integrações, onde eu possa inserir todas chaves de API e secret key quando necessário, separando por integração. Dentro desse módulo deixe a parte do MCP também."_

E o esclarecimento que definiu metade do desenho, dado na mesma conversa: o módulo guarda **as chaves dos MCPs que ele usa**, e o **MCP do próprio Tetteo — que está sendo construído em outra conversa — mora aqui dentro**. Este documento reserva a casa desse MCP e define o contrato que ele vai encontrar pronto; não constrói o servidor MCP.

### A regra que governa o módulo inteiro

> **O valor entra e não volta.**

Nenhuma tela e nenhuma ação devolve o valor de uma chave guardada. Não é permissão faltando — é caminho que não existe. O servidor decifra no instante de chamar o serviço, usa, e descarta. Perdeu a chave, gera outra no painel do serviço.

Existe **uma** exceção, e ela está no §7: a chave que o próprio Tetteo emite para o MCP aparece uma vez, na criação. Uma chave que nunca é mostrada não serve para ser colada em lugar nenhum.

---

## 2 · Decisões travadas

| Decisão                        | Escolha                                             | Por quê                                                                                                        |
| ------------------------------ | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Onde mora**                  | Módulo próprio, não aba de Configurações            | Permissão própria. Em Configurações, quem cadastra um garçom passaria a poder ler e trocar todas as chaves     |
| **Onde o segredo fica**        | Cifrado no banco; chave-mestra no ambiente          | É o que permite ligar integração sem deploy, que é o pedido. Texto puro no banco foi descartado                |
| **Cifra**                      | AES-256-GCM, do Node                                | Autentica: valor adulterado no banco faz a decifra falhar em vez de devolver lixo                              |
| **Lista de integrações**       | Declarada em código, não cadastro livre             | Mesmo motivo das permissões: cadastro viraria cópia desatualizada do código, sem saber testar nem cobrar campo |
| **Escape para o não previsto** | Tipo "Outra integração", guardado mas não consumido | Serve para o serviço que aparecer amanhã sem fingir integração que não existe                                  |
| **MCP**                        | Só a casa: emitir, listar, revogar, validar         | O servidor MCP é trabalho de outra conversa. Aqui fica o contrato que ele encontra pronto                      |
| **Chave emitida pelo Tetteo**  | Guardada como hash, não cifrada                     | Só precisa ser conferida, nunca reusada. Banco vazado não entrega chave de MCP                                 |
| **OAuth**                      | Fora desta versão                                   | Ida-e-volta com renovação e endereço de retorno é outro desenho. Metade de um OAuth é pior que nenhum          |
| **Migração das chaves atuais** | Segunda etapa, com o ambiente como reserva          | No dia em que entrar, nada para de funcionar, e dá para voltar atrás                                           |

---

## 3 · Onde mora, e a porta que se fecha

`modules/integracoes/`, App como qualquer outro: manifesto, permissões próprias, telas, serviços.

**Por que não é uma aba de Configurações**, que seria o palpite natural: `configuracoes.editar` é, nas palavras do próprio Core, _"a permissão mais perigosa do sistema"_ — quem a tem pode dar a si mesmo qualquer outra. Cadastrar um garçom exige essa permissão. Se as integrações morassem lá, cadastrar um garçom e trocar a chave de API da rede seriam a mesma permissão.

É o mesmo raciocínio que já separou `assistente.vincular` de `assistente.configurar` na Severina.

**E uma correção que vem junto:** o subtítulo de Configurações hoje é _"Integrações & usuários"_. Ele passa a prometer o que não está mais lá. Vira **"Usuários & permissões"**. Duas portas para a mesma coisa é o erro que este projeto documenta ter duplicado trinta produtos no sistema antigo.

O módulo nasce com `emConstrucao: true`, como os outros, e sai quando a primeira chave real estiver guardada e sendo usada.

---

## 4 · A tela

Rota `/integracoes`, duas abas: **Integrações** e **MCP do Tetteo**. Histórico não ganha aba — já existe em Configurações › Histórico, com um link daqui.

### A lista

Um cartão por integração, agrupado por categoria: Pedidos & cardápio, WhatsApp, IA, Fiscal, Bancos, Armazenamento.

```
WHATSAPP
┌──────────────────────────────────────────────┐
│ Evolution API          ● Configurada          │
│ chave trocada há 3 dias, por você      Abrir →│
└──────────────────────────────────────────────┘

IA
┌──────────────────────────────────────────────┐
│ Gemini                 ○ Falta a chave        │
│ a Severina escreve seco sem ela        Abrir →│
└──────────────────────────────────────────────┘

PEDIDOS & CARDÁPIO
┌──────────────────────────────────────────────┐
│ Cardápio Web           ● Vitaliano            │
│                        ○ Texanos: falta chave │
└──────────────────────────────────────────────┘
```

Quatro estados, e cada um diz o que fazer: **Configurada**, **Falta a chave**, **Erro na última checagem**, **Desligada**.

"Configurada" significa **tem chave**, não "está no ar". A data do último teste fica visível ao lado, para a tela não prometer o que não sabe.

### Por loja, quando for o caso

Cada integração declara se vale para a rede ou é por loja. O Gemini é um para tudo; cada merchant do Cardápio Web é uma loja diferente. Integração por loja mostra um cartão por unidade.

Sem isso, duas pizzarias dividiriam uma credencial só — errado na raiz, e caro de corrigir depois que houver dado dentro.

### Dentro de uma integração

Os campos que ela pede, uma chave geral Ligada/Desligada, "Testar conexão" quando o serviço permite uma consulta inofensiva, e os últimos toques.

Campo de segredo já preenchido aparece assim:

```
API Key        ••••••4f2a        [ Trocar ]
```

Ao clicar em Trocar, **o campo abre vazio**. Nunca pré-preenchido: pré-preencher significaria mandar o segredo para o navegador, e bastaria abrir o inspetor para lê-lo. Este detalhe é o cofre inteiro em uma interação.

No celular, uma coluna.

---

## 5 · O catálogo — como cada integração se declara

Cada integração é uma declaração em código:

```ts
{
  chave: "evolution",              // estável e vitalícia
  nome: "Evolution API",
  categoria: "WhatsApp",
  escopo: "rede",                  // "rede" | "loja"
  campos: [
    { chave: "url",      rotulo: "Endereço",  tipo: "url",     obrigatorio: true },
    { chave: "apiKey",   rotulo: "API Key",   tipo: "segredo", obrigatorio: true,
      ajuda: "Está no painel da Evolution, em Configurações" },
    { chave: "instancia", rotulo: "Instância", tipo: "texto",  obrigatorio: true },
  ],
  testar: async (valores) => { /* consulta inofensiva */ },
}
```

**Por que em código e não cadastro livre.** É o mesmo motivo escrito em `core/configuracoes/permissoes.ts` sobre a tabela de permissões que não existe: _"ela viraria uma cópia desatualizada disto aqui, com alguém sincronizando na mão"_. Se a lista de campos fosse cadastro, o sistema não saberia dizer "falta a chave da Evolution", não saberia testar nada, e um nome digitado torto quebraria a integração em silêncio.

### "Outra integração"

Um tipo curinga onde o dono dá o nome e acrescenta os pares que quiser. Guardado cifrado, com quem trocou e quando — e com um aviso em letra clara na própria tela:

> guardado em cofre; nenhuma parte do sistema consome esta chave automaticamente

É o que faz o módulo servir para o serviço que aparecer amanhã, sem fingir uma integração que não existe.

---

## 6 · O cofre

### As tabelas

Arquivo novo: `prisma/schema/integracoes.prisma`. Seguem as três regras do Core — organização em toda linha, nada apagado de verdade, id aleatório.

```
Integracao          id, organizacaoId, unidadeId, chave,
                    ligada, ultimoTesteEm, ultimoTesteOk, ultimoErro,
                    criadoEm, atualizadoEm, excluidoEm
                    @@unique([organizacaoId, unidadeId, chave])

CampoDeIntegracao   id, integracaoId, campo, ehSegredo,
                    valor?          ← texto puro, só quando NÃO é segredo
                    valorCifrado?   ← quando é segredo
                    versaoDaChave   ← qual chave-mestra cifrou este valor
                    ultimos4        ← o que a tela mostra
                    atualizadoPorId, criadoEm, atualizadoEm
                    @@unique([integracaoId, campo])
```

`unidadeId` guarda `""` para "vale para a rede", **não nulo**. O Postgres considera dois nulos como diferentes, então a trava de "uma linha por integração" não valeria justamente no caso mais comum.

`versaoDaChave` é sempre `1` hoje e não serve para nada. Existe porque é o que torna possível trocar a chave-mestra um dia sem adivinhar o que foi cifrado com qual — a mesma decisão que a Severina tomou ao declarar campos de fases futuras com a tabela ainda vazia: agora custa uma linha; depois custa migração.

### A cifra

AES-256-GCM do `node:crypto`. Chave-mestra de 32 bytes em `TETTEO_CHAVE_MESTRA` (base64), **no ambiente do servidor, nunca no banco**. Cada valor guarda iv + etiqueta de autenticação + texto cifrado.

GCM porque autentica: valor adulterado direto no banco faz a decifra **falhar**, em vez de devolver lixo silencioso.

**Sem chave-mestra configurada, o cofre abre trancado**: a tela lista e mostra estados, e recusa salvar segredo, dizendo o motivo. Não existe plano B de guardar em texto puro — é a mesma postura de `/api/severina/tick`, que fica fechada quando o segredo dela não está configurado, em vez de aberta.

O preço, dito com clareza: **chave-mestra perdida torna ilegível tudo que foi guardado**. Ela não vai para o Git, e precisa estar no backup do dono — **separada** do backup do banco, senão os dois juntos anulam a cifra.

### Quem pode

| Permissão            | O que dá                                               |
| -------------------- | ------------------------------------------------------ |
| `integracoes.ver`    | Ver a lista, os estados e os `••••4f2a`. Nunca o valor |
| `integracoes.editar` | Colar e trocar chave, ligar e desligar, testar conexão |

Nenhuma das duas — e nenhuma permissão do sistema, inclusive o coringa do Diretor — devolve o valor de uma chave. Ver §1.

### O que a auditoria grava

```
Integracao · ALTEROU · por Pablo · 12/09 09:14
{ integracao: "evolution", campo: "apiKey",
  acao: "chave trocada", ultimos4: "4f2a" }
```

Nunca o valor. Nunca o tamanho. O precedente já existe em `redefinirSenha`, que audita _"senha redefinida"_ e mais nada.

### Onde o código mora

| Peça                       | Lugar                  | Por quê                                                             |
| -------------------------- | ---------------------- | ------------------------------------------------------------------- |
| Telas, serviços, regras    | `modules/integracoes/` | É um App                                                            |
| A cifra e a leitura crua   | `server/cofre.ts`      | `server/` é alcançável por módulo **e** por conector; `core/` não é |
| A verificação de permissão | serviços do módulo     | `server/` não enxerga o Core. Mesma divisão que o `db.ts` já tem    |

---

## 7 · A casa do MCP do Tetteo

Aba própria, e ela é o **contrário** do resto do módulo: aqui o Tetteo **emite** a chave, e o dono a cola no ChatGPT ou no Claude.

Duas consequências concretas:

**A chave aparece uma vez, na criação.** Única exceção à regra do §1, e inevitável: chave que nunca é mostrada não serve para ser colada. Fechou a tela, acabou — depois é `••••4f2a` e o botão Revogar.

**É guardada como hash, não cifrada.** Chave que vem de fora precisa ser _usada_, então é cifrada e volta a ser legível na hora de chamar o serviço. Chave que o Tetteo emite só precisa ser _conferida_, e o jeito seguro de conferir sem guardar é o hash — igual à senha. Banco vazado não entrega chave de MCP.

A lista mostra nome ("ChatGPT do Pablo"), escopo (rede ou loja), criada quando, **último uso**, e Revogar. Revogar vale na hora.

### O contrato

A única coisa que o servidor MCP precisa encontrar pronta:

```
validarChaveDeMcp(chave)  →  ContextoSessao | null
```

A chave guarda quem a criou e qual loja. Validar monta o contexto **daquela pessoa**, com o mesmo `contextoDeFundo` que a Severina já usa desde a fase 1.

Consequência, e é a razão de ser deste desenho: **o MCP enxerga exatamente o que aquela pessoa enxergaria na tela.** Nenhuma permissão nova, nenhum caminho paralelo. Uma chave criada a partir de um usuário só de leitura produz um MCP só de leitura, sem ninguém programar nada.

Fora daqui: o servidor MCP e as ferramentas que ele expõe.

---

## 8 · Como o resto do sistema pede uma chave

Uma função, em `server/cofre.ts`:

```
segredo(organizacaoId, "evolution", "apiKey", unidadeId?)
   1. procura no cofre  →  achou? decifra e devolve
   2. não achou?        →  usa a variável de ambiente de sempre
   3. nem isso?         →  devolve vazio; quem chamou decide o que fazer
```

O passo 2 é a rede de segurança da migração: no dia em que isto entrar, **nada para de funcionar** — Evolution, Gemini e o segredo do relógio continuam vindo do ambiente até cada um ser colado na tela. E dá para voltar atrás a qualquer momento.

Duas mudanças que isto obriga, e que são melhorias por si só:

- **O conector da Evolution deixa de ler o ambiente sozinho.** Hoje lê numa constante no topo do arquivo, o que também significa que ele só fala com _um_ número para a rede inteira. Passa a **receber** a credencial de quem o chama — o relógio, na camada `app/`, que é onde este projeto já colocou a única costura entre módulo e conector. Abre caminho para um WhatsApp por loja no dia em que a segunda marca entrar.
- **`auditar()` sai de dentro de Configurações.** Hoje é função privada de `core/configuracoes/servicos.ts`. Para o módulo novo registrar "chave trocada" sem copiar a função — e código copiado é onde a regra se perde —, ela vira `core/auditoria.ts`, usada pelos dois. Configurações passa a usar a versão extraída, sem mudança de comportamento.

**Desempenho:** a Severina pede a chave a cada mensagem. O cofre guarda o valor decifrado em memória por um minuto e esquece assim que alguém salva uma chave nova na tela.

---

## 9 · Quando dá errado

A regra é falhar alto, nunca em silêncio.

| Situação                        | O que acontece                                                                                             |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Falta a chave-mestra            | Cofre trancado: lista e estados funcionam, salvar segredo é recusado com o motivo na tela                  |
| Chave-mestra trocada por engano | A decifra falha e a integração aparece como "cofre não abre". Nunca manda credencial corrompida ao serviço |
| Teste de conexão falhou         | Grava estado e mensagem **recortada**; o cartão fica "Erro na última checagem"                             |
| Serviço caiu depois do teste    | O módulo não adivinha: mostra o último estado conhecido, com a data                                        |
| Chave revogada no serviço       | Aparece no próximo teste                                                                                   |

E o que nunca pode acontecer, como regra e não como intenção: chave em log, em mensagem de erro, na auditoria, no navegador ou num print de tela.

---

## 10 · Testes e aceite

Além do `npm run check` que o projeto exige antes de todo commit:

- **A cifra, em teste puro:** cifrar e decifrar devolve o mesmo; valor adulterado faz a decifra falhar; versão de chave desconhecida falha com mensagem clara.
- **O teste que mais importa:** salvar uma chave e conferir que o texto dela **não aparece em lugar nenhum da linha de auditoria**. É a regra mais fácil de quebrar sem ninguém notar, seis meses depois.
- Sem `integracoes.editar`, salvar é recusado.
- A ordem de leitura: com valor no cofre, usa o cofre; sem valor, cai para o ambiente.
- A tela nunca recebe valor de segredo — asserção sobre o que a ação devolve ao navegador.

**Aceite de ponta a ponta:** colar a chave do Gemini na tela e ver a Severina passar a escrever com voz em vez do fato cru. Prova tela, cifra, leitura e uso de uma vez.

---

## 11 · Fora de escopo

| Fora                                   | Por quê                                                                                                                                      | Quando volta                            |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| **O servidor MCP e suas ferramentas**  | É outra conversa, já em andamento. Aqui fica a casa e o contrato                                                                             | Quando aquele trabalho chegar           |
| **OAuth ("entrar com o Google")**      | Ida-e-volta com renovação e endereço de retorno. Metade de um OAuth é pior que nenhum                                                        | Quando um serviço exigir e valer a pena |
| **Integração que exige arquivo**       | Certificado digital da NF-e depende de armazenamento persistente, que o Tetteo não tem — o mesmo muro da foto do Checklists e da nota fiscal | Quando houver decisão de armazenamento  |
| **Rotação automática da chave-mestra** | A versão fica guardada em cada valor para tornar possível; o procedimento espera motivo                                                      | Quando houver motivo                    |

---

## 12 · Notas para a implementação

- **Antes de escrever código:** este projeto usa uma versão do Next.js com mudanças que quebram convenções anteriores. Ler os guias em `node_modules/next/dist/docs/`, conforme o `AGENTS.md`.
- Variável nova: `TETTEO_CHAVE_MESTRA` (32 bytes em base64). Entra no `.env.example` **vazia**.
- `npm run check` (tipos + fronteiras + formatação + testes) antes de todo commit.
- O módulo entra em `registro-de-apps.ts` com `emConstrucao: true`, e sai quando a primeira chave real estiver guardada e em uso.
- A extração de `auditar()` para `core/auditoria.ts` é pré-requisito do §6 e deve vir antes, em passo próprio, com Configurações seguindo verde.
