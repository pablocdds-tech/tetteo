# Severina — agentes de WhatsApp

**Data:** 04/08/2026
**Módulo:** `assistente` (Severina)
**Estado:** desenho aprovado, pronto para virar plano de implementação

---

## 1 · O que é

A Severina passa a conversar por WhatsApp com **a equipe** — não com o cliente.

Ela faz três coisas, e a diferença entre elas é o que organiza este documento inteiro:

1. **Avisa** — cobra a contagem, lembra do ASO, alerta que o fornecedor passa hoje
2. **Coleta** — faz perguntas e guarda as respostas (o checklist de fechamento, a ronda, a pesquisa)
3. **Age nos módulos** — anota a contagem, lança a nota

E o requisito que reorganizou o projeto:

> **Pablo cria e configura agentes sozinho, numa tela, sem programador.**

Isso não é conveniência. É a diferença entre um sistema que ele opera e um sistema que depende de terceiro para mudar um horário.

---

## 2 · Decisões travadas

Tomadas na conversa de 04/08. Estão aqui para que ninguém — inclusive nós — as reabra por engano daqui a seis meses.

| Decisão | Escolha | Por quê |
|---|---|---|
| **Público** | Equipe interna | Público pequeno e conhecido; erro não vira reclamação de cliente; não depende de Cardápio/Delivery/CRM, que não existem |
| **Poder de escrita** | Escreve direto, sem teto de valor nem janela de aprovação | Decisão do dono. Mitigada por: a Severina age **como a pessoa**, com as permissões dela |
| **Números de WhatsApp** | Um só para a rede | A loja vem do contexto da conversa, não do telefone |
| **Modelo de IA** | Gemini (Google) | Lê imagem e PDF nativamente. Exceção consciente ao "sem serviço pago externo" do README — ver §12 |
| **n8n / ferramenta externa** | Descartado | Não elimina o trabalho difícil (ver §12), e quebra auditoria e identidade |
| **DESFAZER por WhatsApp** | Descartado | Segundo caminho de escrita. Substituído por eco com link + confirmação por palavra-chave no que é perigoso |
| **Áudio** | Aceito, com devolutiva escrita obrigatória antes de gravar | É como a cozinha fala de verdade. A confirmação é o preço de aceitar voz com dinheiro no meio |
| **Criar agentes do zero** | Sim para Aviso e Coleta; não para agentes que escrevem em módulo | Ver §4 |

---

## 3 · O que a etapa 0 já provou

Executado em 04/08, contra a instalação real.

| Verificação | Resultado |
|---|---|
| Evolution API `v2.3.7` no Dokploy, HTTPS válido | ✅ |
| Número conectado (`state: open`) | ✅ |
| **Recebe** mensagem e grava no banco | ✅ registros às 21:02:31 e 21:14:09, `fromMe: false` |
| **Envia** mensagem pela API | ✅ registro às 21:13:02, `fromMe: true` |
| Grupos ignorados, histórico desligado, status desligado | ✅ aplicado em `/settings/set` |
| Estabilidade da conexão | ⚠️ **uma queda em 04/08 às 21:00:25**, motivo `401 device_removed`. Observar 7 dias |
| Leitura de nota fiscal por foto | ⏸️ **portão aberto** — ver §13 |

### Achado que mudou o desenho: endereçamento LID

As mensagens chegam de `223170845999336@lid`, não de `5584xxxxxxxx@s.whatsapp.net`. O WhatsApp migrou para o **LID**, que esconde o telefone de quem escreve.

Consequências, ambas incorporadas ao desenho:

- Não existe comparação direta entre o remetente e `Usuario.telefone` — é preciso uma tabela de vínculo (§6)
- O nome de quem escreve não está no registro do chat (`pushName` vazio nos três chats observados); está na tabela de contatos da Evolution, sob um identificador que ora é LID, ora é telefone

### Notas de instalação

- Imagem oficial: `evoapicloud/evolution-api`. **Fixar `v2.3.7`** — a tag `latest` aponta para versão de teste (2.4.0-rc)
- O `docker-compose.yaml` oficial já declara `dokploy-network` como externa
- Publicar portas no host é desnecessário e inseguro: o domínio via Traefik já expõe o que precisa
- O Tetteo fala com a Evolution **por dentro** (`http://evolution_api:8080`), sem sair da máquina. A URL pública serve só ao navegador
- A Evolution responde `manager` com `http://` mesmo com `SERVER_URL` em `https://` — é o Traefik terminando TLS. Cosmético. **A confirmar quando chegar a primeira mídia:** se a URL da imagem vier em `http://`, o download interno resolve sem tocar em `SERVER_URL`

---

## 4 · Os três tipos de agente

Um **agente** é uma linha no banco que Pablo cria e edita numa tela. O tipo define o que ele consegue fazer.

### Tipo AVISO — só fala

Gatilho + destinatários + instruções. Não espera resposta.
*"Todo dia 25, lembrar o gerente de pedir o ASO do pessoal novo."*

**Pablo cria quantos quiser.** Não depende de módulo nenhum.

### Tipo COLETA — pergunta e guarda

Uma lista de perguntas que Pablo escreve, cada uma com um formato (`texto`, `numero`, `sim_nao`, `foto`). As respostas caem em tabela própria da Severina, com tela para consultar e exportar.

**Pablo cria quantos quiser.** Não toca em estoque, financeiro ou qualquer número de dinheiro — é exatamente por isso que é seguro deixá-lo criar à vontade.

> **Fronteira com o futuro módulo Checklists:** a Coleta da Severina é a versão leve, por WhatsApp. O módulo Checklists, quando existir, é a versão pesada — auditoria formal, evidência, assinatura, plano de ação. Registrado aqui para não virar duplicação por acidente.

### Tipo MÓDULO — age no sistema

Usa ferramentas declaradas em código por um módulo (hoje, só o Estoque). Pablo **configura quais** ferramentas o agente pode usar, mas **não inventa ferramenta nova**.

**Por que essa parede existe.** "Fechar a contagem" não é um comando; é um pacote: validar que o insumo pertence àquela contagem, conferir a unidade, checar `estoque.contar`, gravar no fuso certo, auditar de-para, e recalcular o CMV. Isso não cabe num formulário. Se fosse possível digitar numa tela *"a Severina agora pode dar baixa no estoque"*, essa baixa não teria validação, permissão nem auditoria — e todo o cuidado do sistema estaria contornado por um campo de texto.

A parede é o que mantém o CMV confiável.

### A divisão de responsabilidade

| | Quem faz | Muda com |
|---|---|---|
| **O que é possível** — as ferramentas, o que cada uma valida, como audita | programador, em `modules/<app>/assistente.ts` | código novo |
| **O que é permitido, para quem, quando, e falando como** | **Pablo**, na tela | um clique |

---

## 5 · Arquitetura

### As travas que ditaram o desenho

Duas regras do linter ([eslint.config.mjs](../../../eslint.config.mjs)) definiram a forma da solução. Nenhuma delas foi afrouxada.

1. `modules/assistente/` **não pode** importar `modules/estoque/` — um App nunca importa outro App
2. `modules/*` **não pode** importar `connectors/*` — módulo só alcança `core`, `design-system`, `lib`, `server`

### O mapa

```
   CELULAR DO COLABORADOR
            │ WhatsApp
            ▼
   ┌──────────────────┐   contêiner vizinho no Dokploy
   │  EVOLUTION API   │
   └────┬──────▲──────┘
        │      │
 webhook│      │ "envia esta mensagem"
        ▼      │
 ┌─────────────┴──────────────────────────────────────┐
 │  TETTEO                                            │
 │                                                    │
 │  app/api/whatsapp/webhook  ← porta de entrada      │
 │  app/api/severina/tick     ← o relógio, 1×/min     │
 │        │                                           │
 │        ├──► connectors/whatsapp/  fala "Evolution" │
 │        │                                           │
 │        └──► modules/assistente/   a SEVERINA       │
 │                    │                               │
 │                    ├──► server/ia/     → Gemini    │
 │                    └──► registro-de-ferramentas    │
 │                              └──► modules/estoque/ │
 │                                    assistente.ts   │
 └────────────────────────────────────────────────────┘
```

### Onde cada peça mora, e por quê

- **`connectors/whatsapp/`** — o tradutor. Só ele sabe o que é "Evolution API". Trocar de provedor um dia é reescrever esta pasta. Segue [connectors/README.md](../../../src/connectors/README.md)
- **`server/ia/gemini.ts`** — o Gemini fica aqui, não em `connectors/`, porque não é ponte que traz fatos de fora (como o PDV traz vendas): é serviço que o sistema consulta, como o banco. E é o único lugar de onde a Severina o alcança sem furar a trava 2
- **`modules/assistente/`** — a Severina é um App: manifesto, permissões, telas
- **`modules/<app>/assistente.ts`** — cada módulo declara as ferramentas e os avisos que oferece. Quem é dono da regra continua dono
- **`src/registro-de-ferramentas.ts`** — raiz de composição, server-only. Mesmo desenho do `registro-de-apps.ts`. A Severina importa **este** arquivo, nunca um módulo
- **`app/api/…`** — as duas únicas portas. `app/` é a única camada que alcança módulo **e** conector, então a costura acontece ali

### A fila como consequência, não como contorno

A trava 2 impede a Severina de chamar a Evolution. A saída é a **fila de saída**: ela grava "mande esta mensagem"; o `tick`, na camada `app/`, esvazia.

Isso não é gambiarra — é o padrão certo, e rende três coisas de graça:

- WhatsApp fora do ar não perde mensagem
- Reenvio não duplica
- **Existe um lugar para segurar o ritmo** — indispensável, dado o risco de ban (§12)

---

## 6 · O banco

Arquivo novo: `prisma/schema/assistente.prisma`. Todas as tabelas seguem as três regras do Core — organização em toda linha, nada apagado de verdade, id aleatório.

### `InstanciaWhatsapp` — o número

```
id, organizacaoId, nome, numeroProprio,
ativa, conectadaEm, desconectadaEm, ultimoErro
```

Uma linha hoje. Existe por dois motivos concretos: o **botão de desligar** precisa de lugar para morar, e a **queda de conexão** (já observada) precisa ser visível numa tela em vez de descoberta por reclamação.

O banco já suporta várias instâncias; a tela de administrar várias fica fora de escopo (§11).

### `VinculoWhatsapp` — quem existe para a Severina

```
id, organizacaoId, usuarioId, remoteJid @unique, telefone, confirmadoEm
```

Obrigatória por causa do LID. É, ao mesmo tempo, a **lista de quem pode falar com a Severina**: sem linha aqui, a pessoa não existe. A trava de identidade vira dado gerenciável numa tela, em vez de regra escondida no código.

### `AgenteSeverina` — o que Pablo cria

```
id, organizacaoId, unidadeId?, nome, tipo (AVISO | COLETA | MODULO), ativo,

gatilho (HORARIO | ROTINA_VENCIDA | MENSAGEM_RECEBIDA),
gatilhoConfig Json,

destinatariosPapeis String[], destinatariosUsuarios String[],

instrucoes String,              ← MOLE: orienta o modelo
perguntas Json,                 ← tipo COLETA
ferramentasLiberadas String[],  ← DURO: tipo MODULO
limites Json,                   ← DURO

criadoEm, atualizadoEm, excluidoEm
```

Forma de `limites`:

```json
{
  "janelaInicio": "06:00",
  "janelaFim": "22:00",
  "maxAcoesPorConversa": 8,
  "aceitaAudio": true,
  "confirmacoes": { "fechar_contagem": "FECHAR" },
  "escalonamento": { "aposMinutos": 60, "avisarPapeis": ["Gerente"] }
}
```

### `ConversaWhatsapp` — o assunto em aberto

```
id, instanciaId, agenteId, organizacaoId, unidadeId, remoteJid, usuarioId,
referenciaTipo, referenciaId,
estado (ABERTA | AGUARDANDO_CONFIRMACAO | ENCERRADA),
acaoPendente Json,
ultimaMensagemEm
```

`unidadeId` resolve o problema do número único: a resposta "12 kg" sabe de qual estoque é porque **a conversa** sabe — não porque o telefone sabe.

`acaoPendente` congela nome da ferramenta, argumentos e prazo enquanto se espera a palavra de confirmação.

### `MensagemWhatsapp` — tudo que entra e tudo que sai

```
id, conversaId, direcao (ENTRADA | SAIDA),
idExterno @unique,
tipo (TEXTO | IMAGEM | DOCUMENTO | AUDIO), texto, midiaUrl,
status (PENDENTE | ENVIADA | ENTREGUE | FALHOU), tentativas, erro,
origem,
agendadaPara, enviadaEm, recebidaEm
```

Uma tabela para as duas direções, de propósito: é ela que vira a linha do tempo da aba **Conversas**, e a fila de saída é só `direcao=SAIDA AND status=PENDENTE`.

`origem` (ex.: `"agente:clx91…"`) responde a pergunta do primeiro dia em que algo sair errado: *por que a Severina mandou isso?*

### `RespostaDeAgente` — o resultado da Coleta

```
id, agenteId, conversaId, organizacaoId, unidadeId, usuarioId,
respostas Json, completaEm, criadoEm
```

---

## 7 · O caminho de uma mensagem

### Saída

```
[relógio, 1×/min]
      │
      ▼
POST /api/severina/tick   (senha no cabeçalho)
      │
      ├─ 1. agentes ativos cujo gatilho venceu
      │      HORARIO      → o relógio bateu
      │      ROTINA_VENCIDA → pergunta ao módulo: "tem aviso?"
      │      → grava MensagemWhatsapp SAIDA/PENDENTE, origem="agente:…"
      │
      ├─ 2. esvazia a fila, UMA DE CADA VEZ, com intervalo
      │      → connectors/whatsapp → Evolution → WhatsApp
      │      → status = ENVIADA (ou FALHOU + tentativas++)
      │
      └─ 3. escalonamentos vencidos (Coleta sem resposta)
```

No passo 1, a Severina **não sabe o que é uma rotina de contagem**. Ela pergunta; o Estoque responde. Mesmo desenho do registro de ferramentas.

Gravar e enviar são passos separados: se a Evolution estiver fora do ar às 7h, a mensagem já está gravada e sai às 7h01.

### Entrada

```
WhatsApp → Evolution → POST /api/whatsapp/webhook?chave=<segredo>
      │
      ├─ 1. confere o segredo. Errado → 401, fim.
      │
      ├─ 2. já vi esse idExterno? Sim → 200 e para.
      │
      ├─ 3. QUEM É? remoteJid → VinculoWhatsapp → Usuario
      │      não achou → DESCARTA. Não grava nada. 200.
      │
      ├─ 4. grava MensagemWhatsapp ENTRADA, devolve 200 na hora
      │
      └─ 5. processa em seguida, sem segurar a resposta:
             monta ContextoSessao daquele Usuario
             → Gemini, com as ferramentas do agente ∩ permissões da pessoa
             → executa → grava a resposta como SAIDA/PENDENTE
```

**O passo 3 é consequência direta de manter o número pessoal:** se alguém de fora da equipe escrever, o Tetteo não guarda nada — nem texto, nem número, nem que a mensagem existiu. Os 1016 contatos pessoais da conta não entram no banco de gestão.

**O passo 5 é o que faz a autorização não ser código novo.** A Severina monta um `ContextoSessao` de verdade, do usuário de verdade. Daí em diante, `pode(contexto, "estoque.contar")` — [contexto.ts](../../../src/core/sessao/contexto.ts) — funciona exatamente como quando a pessoa está logada. Zero permissão nova, zero caminho paralelo.

---

## 8 · Como a Severina age

### O módulo declara

`modules/estoque/assistente.ts`:

```ts
export const assistenteDoEstoque = {
  ferramentas: [
    {
      nome: "listar_itens_da_contagem",
      descricao: "Os insumos que faltam contar na contagem aberta",
      permissao: "estoque.ver",
      parametros: z.object({ contagemId: z.string() }),
      executar: (contexto, args) => itensPendentes(contexto, args.contagemId),
    },
    {
      nome: "registrar_quantidade",
      descricao: "Anota a quantidade contada de um insumo",
      permissao: "estoque.contar",
      parametros: z.object({
        contagemId: z.string(),
        insumoId: z.string(),
        quantidade: z.number().positive(),
      }),
      executar: (contexto, args) => anotarItem(contexto, args),
    },
    { nome: "fechar_contagem", permissao: "estoque.contar", /* … */ },
  ],

  avisos: (contexto, agora) => rotinasVencidas(contexto, agora),
};
```

`src/registro-de-ferramentas.ts` — server-only:

```ts
import { assistenteDoEstoque } from "@/modules/estoque/assistente";

export const PARTICIPANTES = [assistenteDoEstoque];
```

### As duas peneiras

O conjunto de ferramentas que chega ao Gemini é:

```
agente.ferramentasLiberadas  ∩  o que aquela pessoa pode
```

O que Pablo liberou **e** o que a permissão do usuário permite. A mais restritiva vence. O modelo nunca vê o que está fora dessa interseção — ele não pode escolher errado entre trinta opções porque nunca enxerga trinta.

### O laço

```
chegou "a mussarela deu 12 quilos e meio"
   │
   ├─ contexto: quem é, qual loja, qual agente, o que já foi dito
   ├─ Gemini, com as ferramentas das duas peneiras
   │
   ├─ Gemini pede: registrar_quantidade(insumo=mussarela, qtd=12.5)
   │     ├─ Zod valida o formato       → não bateu? não executa
   │     ├─ pode(contexto, permissao)? → não? não executa
   │     ├─ dentro da janela de horário? → não? não executa
   │     ├─ exige confirmação? → congela em acaoPendente e pergunta
   │     └─ executa COMO AQUELA PESSOA, auditado
   │
   ├─ devolve o resultado ao Gemini
   └─ ele escreve a resposta → SAIDA/PENDENTE
```

A quantidade nunca vem de texto interpretado solto: vem de chamada de ferramenta com formato tipado. *"Doze quilos e meio"* só vira `12.5` se passar pelo Zod. **O modelo traduz; o sistema valida.**

A permissão não é decisão do modelo. Ele *pede*; quem decide é o `pode()`.

### Áudio

Áudio é transcrito pelo Gemini e **sempre devolvido por escrito antes de gravar**:

> *"Entendi: 12,5 kg de mussarela. Responde OK ou corrige."*

Na prática vira uma confirmação por item. É o preço de aceitar voz com dinheiro no meio, e foi aceito conscientemente.

### Confirmação por palavra-chave

Para ferramentas marcadas em `limites.confirmacoes`, o Gemini **não participa da confirmação**:

```
Severina:  "Contagem da Praça: 14 itens, R$ 3.847,20.
            Responda  FECHAR  para confirmar."

"fechar"       → texto.trim().toUpperCase() === "FECHAR" → executa
"pode fechar"  → não é a palavra → pergunta de novo
[10 minutos]   → acaoPendente expira, ela avisa
```

Os argumentos ficam **congelados** em `acaoPendente`: nem uma confirmação mal lida muda o valor do que será feito.

---

## 9 · As travas

| Trava | Onde | Contra o quê |
|---|---|---|
| **`idExterno` único** | entrada, passo 2 | Webhook repetido. A Evolution reenvia quando não tem certeza que chegou — sem isso, "entrou 12kg" vira 24kg. Mesma lógica da `EntregaEvento` já existente |
| **Vínculo obrigatório** | entrada, passo 3 | Desconhecido agindo no sistema, e dado pessoal entrando no banco |
| **Duas peneiras** | laço | Modelo usando ferramenta que Pablo não liberou, ou que a pessoa não pode |
| **Zod antes de executar** | laço | Valor mal interpretado virando número torto |
| **Janela de horário** | laço | Ação fora do expediente |
| **Teto de ações por conversa** | laço | Laço infinito com dinheiro no meio |
| **Palavra-chave congelada** | laço | Fechamento acidental |
| **Ritmo na fila** | saída | Ban. Uma mensagem de cada vez, com intervalo e teto por rodada |
| **`InstanciaWhatsapp.ativa = false`** | tudo | O botão de desligar corta tudo, inclusive a fila |

### O que a Severina nunca faz

1. Nunca age em conversa de **grupo**
2. Nunca age por identidade **não vinculada**
3. Nunca **chuta** valor — na dúvida, pergunta
4. Nunca usa ferramenta **fora das duas peneiras**
5. Nunca escreve sem a **permissão do usuário real**
6. Nunca funciona com a instância desligada

### Mole × duro

A regra que sustenta a autonomia do Pablo:

```
INSTRUÇÃO  (texto livre)          →  MOLE. Influencia o modelo.
LIMITE     (campo estruturado)    →  DURO. Conferido pelo código.
```

*"Nunca feche contagem acima de R$ 5.000"* escrito na caixa de instruções é **pedido**. O mesmo limite como campo é **parede**. O modelo não convence um `if`.

**Nada que não se pode perder mora na caixa de texto.**

---

## 10 · As fases

**Cada fase vira um plano de implementação próprio.** Este documento é o desenho das quatro; o plano detalhado se escreve uma fase por vez, com o aprendizado da anterior dentro. Escrever o plano das quatro agora seria planejar em cima de suposições que o uso real vai desmentir.

### Fase 1 — Agentes de Aviso

Tabelas `InstanciaWhatsapp`, `VinculoWhatsapp`, `AgenteSeverina`, `ConversaWhatsapp`, `MensagemWhatsapp` · `connectors/whatsapp` (só envio) · `server/ia/gemini.ts` (só redação, sem ferramentas) · `/api/severina/tick` com relógio, fila e ritmo · `assistenteDoEstoque.avisos` · `registro-de-ferramentas` · telas: lista de agentes, editor de agente, conversas, vínculos, botão de desligar.

**Entrega:** Pablo cria agentes que cobram e lembram, sozinho. A cobrança de contagem — que hoje só acontece quando alguém abre a tela — passa a acontecer no horário.

Sem webhook, sem ferramentas, sem interpretar nada. **Se a fase 1 for tudo que existir por três meses, ela já se paga.**

### Fase 2 — Agentes de Coleta

Webhook · resolução de identidade LID↔telefone · laço de conversa · `RespostaDeAgente` · editor de perguntas · tela de respostas com exportação · escalonamento.

Inclui **guardar foto**, porque a pergunta de tipo `foto` é da Coleta: baixar a mídia da Evolution, armazenar e exibir na tela de respostas. É só arquivar — **entender** o que está na imagem é a fase 4. A distinção importa: guardar uma foto é download; ler uma nota fiscal é modelo de visão com margem de erro.

**Entrega:** os checklists por WhatsApp — o pedido original — sem depender do módulo Checklists.

### Fase 3 — Agentes de Módulo

Ferramentas do Estoque · as duas peneiras · Zod · confirmação por palavra-chave · eco com link · áudio com devolutiva.

**Entrega:** contar estoque pelo WhatsApp, da câmara fria.

Acontece **depois** de semanas de uso real — a primeira coisa que a Severina escreve no CMV chega quando já se sabe como ela erra.

### Fase 4 — Documentos

Download de mídia · ferramentas de nota · conferência.

**Escopo definido pelo portão do §13.**

---

## 11 · Fora de escopo

| Fora | Por quê | Quando volta |
|---|---|---|
| **Atendimento a cliente** | Exige Cardápio, Delivery e CRM, que são ícone sem código | Quando esses módulos existirem |
| **Vários números** | O banco aguarda; a tela de administrar não se paga para um número | No dia do segundo número |
| **DESFAZER por WhatsApp** | Segundo caminho de escrita, para um problema que a tela já resolve | Se a equipe reclamar de corrigir pela tela |
| **n8n** | Ver §12 | Não volta |
| **Barramento de eventos** | Peça de Kernel; construir de brinde, com um único consumidor para validar, é nascer torto | Quando Financeiro precisar reagir a `nota.lancada` |
| **Módulo Checklists** | A Coleta entrega o essencial por WhatsApp | Quando exigirem auditoria formal, evidência e plano de ação |

---

## 12 · Riscos assumidos

### Conta pessoal com 1016 contatos

O número conectado é `558481336549`, conta pessoal, com 1016 contatos e conversas particulares. **Decisão consciente do dono, tomada com o risco apresentado.**

Consequências, e o que o desenho faz sobre cada uma:

| Risco | Mitigação no desenho |
|---|---|
| Ban derruba a conta e o histórico pessoal | Fila com ritmo: uma mensagem por vez, com intervalo e teto por rodada. Nunca rajada |
| Mensagens pessoais entrando no banco de gestão | Passo 3 da entrada: sem vínculo, **descarta sem gravar** |
| Grupos de família virando conversa da Severina | `groupsIgnore: true` aplicado na instância; e a regra nº 1 do §9 |
| Histórico pessoal copiado para a VPS | `syncFullHistory: false` e `DATABASE_SAVE_DATA_HISTORIC=false` aplicados |

Pendente: os 1016 contatos já sincronizados antes do ajuste continuam no banco da Evolution. Limpá-los é opcional e não bloqueia nada.

### Dependência de serviço pago externo

O README declara *"tudo roda em VPS própria, sem dependência de serviço pago externo"*. O Gemini é serviço externo pago. **Exceção consciente:** modelo de linguagem em VPS própria exige GPU e entrega bem menos. O adaptador vive num arquivo só (`server/ia/`) — trocar de provedor é reescrever esse arquivo.

### Por que o n8n foi descartado

Registrado porque a pergunta vai voltar.

O n8n não sabe fechar contagem — só sabe chamar um endereço. O código que valida, checa permissão, grava e audita **existe nos dois cenários**. O n8n economiza receber webhook, chamar o modelo e agendar — as três coisas mais fáceis num projeto que já é Next.js — e cobra três preços:

1. **A auditoria perde o autor.** Chave de serviço vira "Severina" em tudo, ou o n8n afirma quem é a pessoa e o Tetteo acredita — e quem tiver a chave escreve como qualquer um
2. **A aba Conversas fica vazia.** O estado da conversa moraria fora do banco
3. **Quebra em silêncio.** Renomear um campo no Prisma não alcança caixa de texto de ferramenta externa

E o argumento legítimo a favor dele — autonomia de quem não programa — é resolvido pelo editor de agentes (§4), dentro do sistema, com permissões e auditoria intactas.

### Estabilidade da conexão

Uma queda em 04/08 (`401 device_removed`). Sob observação por 7 dias. Se as quedas forem frequentes, as opções são celular dedicado sempre ligado ou a API oficial da Meta — que é paga e exige aprovação prévia. `InstanciaWhatsapp.desconectadaEm` existe para tornar isso visível.

---

## 13 · O portão em aberto

**A fase 4 não tem escopo definido, e não é indefinição: é um portão à espera de uma medição.**

Pablo submete **10 notas fiscais reais** da cozinha — amassadas, tortas, mal iluminadas, de fornecedor pequeno — ao Gemini no Google AI Studio, e conta os acertos de fornecedor, total e itens.

| Placar | Escopo da fase 4 |
|---|---|
| **8–10** | A Severina lança a nota. Ferramenta de escrita completa |
| **5–7** | Ela preenche o rascunho; um humano confere e confirma na tela |
| **abaixo de 5** | Ela só arquiva a foto e avisa *"chegou nota do Frigorífico X, precisa lançar"* |

Nenhuma das outras fases depende deste número.

---

## 14 · Notas para a implementação

- **Antes de escrever código:** este projeto usa Next.js 16, com mudanças que quebram convenções anteriores. Ler os guias em `node_modules/next/dist/docs/`, conforme [AGENTS.md](../../../AGENTS.md). Vale especialmente para o processamento assíncrono após a resposta do webhook
- `npm run check` (tipos + fronteiras + formatação + testes) antes de todo commit
- O relógio é tarefa agendada do Dokploy batendo em `/api/severina/tick` com segredo no cabeçalho. Se o agendador não servir, um contêiner de cron resolve. O endereço deve ser disparável à mão para depuração
- Variáveis novas: `EVOLUTION_URL=http://evolution_api:8080`, `EVOLUTION_API_KEY`, `SEVERINA_TICK_SEGREDO`, `SEVERINA_WEBHOOK_SEGREDO`, `GEMINI_API_KEY`
- A aba `/assistente/treinamento` já está declarada no manifesto: é o editor de agentes
- `emConstrucao: true` sai do manifesto quando a fase 1 estiver de pé
