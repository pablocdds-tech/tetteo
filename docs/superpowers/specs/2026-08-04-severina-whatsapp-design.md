# Severina — agentes de WhatsApp

**Data:** 04/08/2026
**Módulo:** `assistente` (Severina)
**Estado:** desenho aprovado, pronto para virar plano de implementação

---

## 1 · O que é

A Severina passa a conversar por WhatsApp com **a equipe** — não com o cliente.

E o que ela é, na definição do dono:

> **Um auditor.** Confere, cobra, alerta, lembra — para que a loja funcione.

A palavra importa, porque separa duas coisas que se parecem:

|                | Dispara por   | Se ninguém contar a praça por 3 dias   |
| -------------- | ------------- | -------------------------------------- |
| **Mensageira** | relógio       | manda o mesmo bom-dia no quarto dia    |
| **Auditora**   | **diferença** | _"a praça não é contada há três dias"_ |

Quatro coisas, então, e a ordem é a de quanto cada uma custa para construir:

1. **Avisa** — cobra a contagem, lembra do ASO, alerta que o fornecedor passa hoje
2. **Confere** — compara o que devia ter acontecido com o que aconteceu, e fala só quando há diferença
3. **Coleta** — faz perguntas e guarda as respostas
4. **Age nos módulos** — anota a contagem, lança a nota

E o requisito que reorganizou o projeto:

> **Pablo cria e configura agentes sozinho, numa tela, sem programador.**

Isso não é conveniência. É a diferença entre um sistema que ele opera e um sistema que depende de terceiro para mudar um horário.

### A regra que protege tudo isso

**Auditor que grita todo dia é auditor mudo em duas semanas.** A equipe silencia o número — e aí se perdem também os avisos que importavam.

Por isso o desenho é o contrário do instinto:

- **Uma mensagem por assunto por dia, no máximo.** Três problemas na mesma loja viram **uma** mensagem com três linhas, nunca três mensagens.
- **O que já foi avisado e ninguém resolveu não vira lembrete diário** — vira escalonamento para o nível de cima.
- O `MAX_POR_RODADA` e o intervalo entre mensagens nasceram para proteger o número contra ban (§12). Servem também aqui: são o teto natural contra a Severina virar praga.

Uma Severina que fala pouco e certo vale mais do que uma que fala tudo.

---

## 2 · Decisões travadas

Tomadas na conversa de 04/08. Estão aqui para que ninguém — inclusive nós — as reabra por engano daqui a seis meses.

| Decisão                      | Escolha                                                          | Por quê                                                                                                                 |
| ---------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Público**                  | Equipe interna                                                   | Público pequeno e conhecido; erro não vira reclamação de cliente; não depende de Cardápio/Delivery/CRM, que não existem |
| **Poder de escrita**         | Escreve direto, sem teto de valor nem janela de aprovação        | Decisão do dono. Mitigada por: a Severina age **como a pessoa**, com as permissões dela                                 |
| **Números de WhatsApp**      | Um só para a rede                                                | A loja vem do contexto da conversa, não do telefone                                                                     |
| **Modelo de IA**             | Gemini (Google)                                                  | Lê imagem e PDF nativamente. Exceção consciente ao "sem serviço pago externo" do README — ver §12                       |
| **n8n / ferramenta externa** | Descartado                                                       | Não elimina o trabalho difícil (ver §12), e quebra auditoria e identidade                                               |
| **DESFAZER por WhatsApp**    | Descartado                                                       | Segundo caminho de escrita. Substituído por eco com link + confirmação por palavra-chave no que é perigoso              |
| **Áudio**                    | Aceito, com devolutiva escrita obrigatória antes de gravar       | É como a cozinha fala de verdade. A confirmação é o preço de aceitar voz com dinheiro no meio                           |
| **Criar agentes do zero**    | Sim para Aviso e Coleta; não para agentes que escrevem em módulo | Ver §4                                                                                                                  |

---

## 3 · O que a etapa 0 já provou

Executado em 04/08, contra a instalação real.

| Verificação                                             | Resultado                                                                          |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Evolution API `v2.3.7` no Dokploy, HTTPS válido         | ✅                                                                                 |
| Número conectado (`state: open`)                        | ✅                                                                                 |
| **Recebe** mensagem e grava no banco                    | ✅ registros às 21:02:31 e 21:14:09, `fromMe: false`                               |
| **Envia** mensagem pela API                             | ✅ registro às 21:13:02, `fromMe: true`                                            |
| Grupos ignorados, histórico desligado, status desligado | ✅ aplicado em `/settings/set`                                                     |
| Estabilidade da conexão                                 | ✅ nenhuma queda espontânea. A desconexão das 21:00:25 foi manual, feita pelo dono |
| Leitura de nota fiscal por foto                         | ⏸️ **portão aberto** — ver §13                                                     |

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
_"Todo dia 25, lembrar o gerente de pedir o ASO do pessoal novo."_

**Pablo cria quantos quiser.** Não depende de módulo nenhum.

### Tipo COLETA — pergunta e guarda

Uma lista de perguntas que Pablo escreve, cada uma com um formato (`texto`, `numero`, `sim_nao`, `foto`). As respostas caem em tabela própria da Severina, com tela para consultar e exportar.

**Pablo cria quantos quiser.** Não toca em estoque, financeiro ou qualquer número de dinheiro — é exatamente por isso que é seguro deixá-lo criar à vontade.

> **Duplicação consciente com o módulo Checklists.** Este documento nasceu quando `modules/checklists/` era só um ícone no painel. Durante a própria conversa que o gerou, o módulo ficou pronto (commit `e3775e3`): modelos, rotinas, respostas, pontuação e pendências com dono e prazo.
>
> A alternativa seria a Coleta morrer e o checklist por WhatsApp virar agente do tipo MÓDULO, gravando no Checklists de verdade. **Foi apresentada e recusada pelo dono; a Coleta fica.**
>
> O custo, escrito para não ser redescoberto por acidente:
>
> - Resposta coletada pela Severina **não entra na nota da loja** nem na comparação entre unidades — que é a razão de o Checklists ser `comportamentoNaRede: "compara"`
> - "Não conforme" pela Severina **não vira pendência** com responsável e prazo; vira uma linha em `RespostaDeAgente`
> - Duas telas para consultar respostas, e a pergunta "cadastro em qual?" — o mesmo erro que duplicou trinta produtos no sistema antigo
>
> Se um dia a Coleta for descontinuada, o caminho é `modules/checklists/assistente.ts` expondo `listarDoDia`, `obterResposta`, `salvarRespostas` e `fecharResposta` como ferramentas. Os serviços já existem e já recebem `ContextoSessao`.

### Tipo MÓDULO — age no sistema

Usa ferramentas declaradas em código por um módulo. Pablo **configura quais** ferramentas o agente pode usar, mas **não inventa ferramenta nova**.

Módulos com serviços prontos para virar ferramenta, em 04/08: **Estoque** (contagem, notas, CMV), **Checklists** (respostas, pendências), **Cardápio** (insumos, fichas técnicas) e **Compras**. A fase 3 abre só o Estoque; os demais entram quando houver motivo, um de cada vez.

**Por que essa parede existe.** "Fechar a contagem" não é um comando; é um pacote: validar que o insumo pertence àquela contagem, conferir a unidade, checar `estoque.contar`, gravar no fuso certo, auditar de-para, e recalcular o CMV. Isso não cabe num formulário. Se fosse possível digitar numa tela _"a Severina agora pode dar baixa no estoque"_, essa baixa não teria validação, permissão nem auditoria — e todo o cuidado do sistema estaria contornado por um campo de texto.

A parede é o que mantém o CMV confiável.

### A divisão de responsabilidade

|                                                                           | Quem faz                                      | Muda com    |
| ------------------------------------------------------------------------- | --------------------------------------------- | ----------- |
| **O que é possível** — as ferramentas, o que cada uma valida, como audita | programador, em `modules/<app>/assistente.ts` | código novo |
| **O que é permitido, para quem, quando, e falando como**                  | **Pablo**, na tela                            | um clique   |

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

`origem` (ex.: `"agente:clx91…"`) responde a pergunta do primeiro dia em que algo sair errado: _por que a Severina mandou isso?_

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
    { nome: "fechar_contagem", permissao: "estoque.contar" /* … */ },
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

A quantidade nunca vem de texto interpretado solto: vem de chamada de ferramenta com formato tipado. _"Doze quilos e meio"_ só vira `12.5` se passar pelo Zod. **O modelo traduz; o sistema valida.**

A permissão não é decisão do modelo. Ele _pede_; quem decide é o `pode()`.

### Áudio

Áudio é transcrito pelo Gemini e **sempre devolvido por escrito antes de gravar**:

> _"Entendi: 12,5 kg de mussarela. Responde OK ou corrige."_

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

| Trava                                 | Onde             | Contra o quê                                                                                                                                              |
| ------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`idExterno` único**                 | entrada, passo 2 | Webhook repetido. A Evolution reenvia quando não tem certeza que chegou — sem isso, "entrou 12kg" vira 24kg. Mesma lógica da `EntregaEvento` já existente |
| **Vínculo obrigatório**               | entrada, passo 3 | Desconhecido agindo no sistema, e dado pessoal entrando no banco                                                                                          |
| **Duas peneiras**                     | laço             | Modelo usando ferramenta que Pablo não liberou, ou que a pessoa não pode                                                                                  |
| **Zod antes de executar**             | laço             | Valor mal interpretado virando número torto                                                                                                               |
| **Janela de horário**                 | laço             | Ação fora do expediente                                                                                                                                   |
| **Teto de ações por conversa**        | laço             | Laço infinito com dinheiro no meio                                                                                                                        |
| **Palavra-chave congelada**           | laço             | Fechamento acidental                                                                                                                                      |
| **Ritmo na fila**                     | saída            | Ban. Uma mensagem de cada vez, com intervalo e teto por rodada                                                                                            |
| **`InstanciaWhatsapp.ativa = false`** | tudo             | O botão de desligar corta tudo, inclusive a fila                                                                                                          |

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

_"Nunca feche contagem acima de R$ 5.000"_ escrito na caixa de instruções é **pedido**. O mesmo limite como campo é **parede**. O modelo não convence um `if`.

**Nada que não se pode perder mora na caixa de texto.**

---

## 10 · As fases

**Cada fase vira um plano de implementação próprio.** Este documento é o desenho das cinco; o plano detalhado se escreve uma fase por vez, com o aprendizado da anterior dentro. Escrever o plano das cinco agora seria planejar em cima de suposições que o uso real vai desmentir.

A ordem não é por valor, é por **risco crescente**: a 1 e a 1.5 só leem; a 2 escreve em tabela própria; a 3 mexe no CMV; a 4 depende de uma medição que ainda não foi feita.

### Fase 1 — Agentes de Aviso

Tabelas `InstanciaWhatsapp`, `VinculoWhatsapp`, `AgenteSeverina`, `ConversaWhatsapp`, `MensagemWhatsapp` · `connectors/whatsapp` (só envio) · `server/ia/gemini.ts` (só redação, sem ferramentas) · `/api/severina/tick` com relógio, fila e ritmo · `assistenteDoEstoque.avisos` · `registro-de-ferramentas` · telas: lista de agentes, editor de agente, conversas, vínculos, botão de desligar.

**Entrega:** Pablo cria agentes que cobram e lembram, sozinho. A cobrança de contagem — que hoje só acontece quando alguém abre a tela — passa a acontecer no horário.

Sem webhook, sem ferramentas, sem interpretar nada. **Se a fase 1 for tudo que existir por três meses, ela já se paga.**

### Fase 1.5 — O auditor

Gatilho `DISCREPANCIA` · `discrepancias(contexto, agora)` declarado pelos módulos, ao lado de `avisos` · escalonamento como campo de primeira classe · agrupamento por loja · o resumo do gerente.

**É aqui que ela deixa de ser mensageira.** O módulo não responde mais "venceu?", e sim "o que está fora do lugar?":

- _"A praça não é contada há 3 dias."_ — Estoque
- _"O fechamento de ontem não foi respondido na Centro. Na Zona Sul foi."_ — Checklists
- _"A pendência da coifa está aberta há 9 dias, com prazo de 2."_ — Checklists
- _"Você fechou 4 contagens este mês. No mês passado foram 12."_ — Estoque

E o **resumo do gerente**, que junta tudo numa mensagem só por loja:

> _Bom dia. Ontem na Centro: fechamento não respondido, 2 pendências vencidas, praça atrasada há 3 dias. Na Zona Sul, tudo em dia._

**Por que vem antes da Coleta:** ela **só lê**. Não escreve em lugar nenhum, não depende do armazenamento de arquivo (§11), e não toca em número de dinheiro. É a fase de maior valor por unidade de risco do projeto inteiro — e é a que entrega a definição do §1.

O `escalonamento` já existe como campo em `limites`; aqui ele ganha uso: _"avisei o João segunda, terça e quarta; quinta eu falo com o gerente"_.

### Fase 2 — Agentes de Coleta

Webhook · resolução de identidade LID↔telefone · laço de conversa · `RespostaDeAgente` · editor de perguntas · tela de respostas com exportação · escalonamento.

A pergunta de tipo `foto` **fica fora desta fase** — depende do pré-requisito abaixo. Vale a distinção, porque as duas coisas costumam ser confundidas: **guardar** uma foto é download e armazenamento; **entender** o que está nela é modelo de visão com margem de erro, e isso é a fase 4.

**Entrega:** perguntas e respostas por WhatsApp — o pedido original — em tabela própria da Severina. Sobre a relação com o módulo Checklists, ver a nota do §4.

> **Pré-requisito não resolvido: onde guardar arquivo.** A pergunta de tipo `foto` depende de armazenamento persistente, que o Tetteo não tem — o contêiner é recriado a cada deploy. O commit do Checklists (`e3775e3`) esbarrou no mesmo muro e deixou a coluna da URL sem uso, pelo mesmo motivo.
>
> É um bloqueio **compartilhado** entre foto de checklist e foto de nota fiscal, e precisa de decisão própria: volume persistente no Dokploy, MinIO na VPS, ou serviço externo de objetos. Enquanto não houver, a pergunta de tipo `foto` fica fora da fase 2 — metade de um upload é pior do que nenhum.

### Fase 3 — Agentes de Módulo

Ferramentas do Estoque · as duas peneiras · Zod · confirmação por palavra-chave · eco com link · áudio com devolutiva.

**Entrega:** contar estoque pelo WhatsApp, da câmara fria.

Acontece **depois** de semanas de uso real — a primeira coisa que a Severina escreve no CMV chega quando já se sabe como ela erra.

### Fase 4 — Documentos

Download de mídia · ferramentas de nota · conferência.

**Escopo definido pelo portão do §13.**

---

## 11 · Fora de escopo

| Fora                       | Por quê                                                                                   | Quando volta                                       |
| -------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------- |
| **Atendimento a cliente**  | Exige Cardápio, Delivery e CRM, que são ícone sem código                                  | Quando esses módulos existirem                     |
| **Vários números**         | O banco aguarda; a tela de administrar não se paga para um número                         | No dia do segundo número                           |
| **DESFAZER por WhatsApp**  | Segundo caminho de escrita, para um problema que a tela já resolve                        | Se a equipe reclamar de corrigir pela tela         |
| **n8n**                    | Ver §12                                                                                   | Não volta                                          |
| **Barramento de eventos**  | Peça de Kernel; construir de brinde, com um único consumidor para validar, é nascer torto | Quando Financeiro precisar reagir a `nota.lancada` |
| **Integrar ao Checklists** | O módulo ficou pronto em 04/08 (`e3775e3`), mas a Coleta foi mantida separada — ver §4    | Se a duplicação incomodar na prática               |

---

## 12 · Riscos assumidos

### Conta pessoal com 1016 contatos

O número conectado é `558481336549`, conta pessoal, com 1016 contatos e conversas particulares. **Decisão consciente do dono, tomada com o risco apresentado.**

Consequências, e o que o desenho faz sobre cada uma:

| Risco                                          | Mitigação no desenho                                                                |
| ---------------------------------------------- | ----------------------------------------------------------------------------------- |
| Ban derruba a conta e o histórico pessoal      | Fila com ritmo: uma mensagem por vez, com intervalo e teto por rodada. Nunca rajada |
| Mensagens pessoais entrando no banco de gestão | Passo 3 da entrada: sem vínculo, **descarta sem gravar**                            |
| Grupos de família virando conversa da Severina | `groupsIgnore: true` aplicado na instância; e a regra nº 1 do §9                    |
| Histórico pessoal copiado para a VPS           | `syncFullHistory: false` e `DATABASE_SAVE_DATA_HISTORIC=false` aplicados            |

Pendente: os 1016 contatos já sincronizados antes do ajuste continuam no banco da Evolution. Limpá-los é opcional e não bloqueia nada.

### Dependência de serviço pago externo

O README declara _"tudo roda em VPS própria, sem dependência de serviço pago externo"_. O Gemini é serviço externo pago. **Exceção consciente:** modelo de linguagem em VPS própria exige GPU e entrega bem menos. O adaptador vive num arquivo só (`server/ia/`) — trocar de provedor é reescrever esse arquivo.

### Por que o n8n foi descartado

Registrado porque a pergunta vai voltar.

O n8n não sabe fechar contagem — só sabe chamar um endereço. O código que valida, checa permissão, grava e audita **existe nos dois cenários**. O n8n economiza receber webhook, chamar o modelo e agendar — as três coisas mais fáceis num projeto que já é Next.js — e cobra três preços:

1. **A auditoria perde o autor.** Chave de serviço vira "Severina" em tudo, ou o n8n afirma quem é a pessoa e o Tetteo acredita — e quem tiver a chave escreve como qualquer um
2. **A aba Conversas fica vazia.** O estado da conversa moraria fora do banco
3. **Quebra em silêncio.** Renomear um campo no Prisma não alcança caixa de texto de ferramenta externa

E o argumento legítimo a favor dele — autonomia de quem não programa — é resolvido pelo editor de agentes (§4), dentro do sistema, com permissões e auditoria intactas.

### Estabilidade da conexão

O `401 device_removed` de 04/08 às 21:00:25 **foi manual** — o dono removeu o aparelho enquanto testava. Não houve nenhuma queda espontânea.

Isso não elimina o risco, só remove a evidência contra: WhatsApp por QR Code depende de um celular ligado e com internet, e desconexão acontece. `InstanciaWhatsapp.desconectadaEm` existe para que a queda apareça numa tela em vez de ser descoberta por reclamação de quem não recebeu o aviso.

Se as quedas se mostrarem frequentes no uso real, as saídas são celular dedicado sempre ligado ou a API oficial da Meta — paga e com aprovação prévia.

---

## 13 · O portão em aberto

**A fase 4 não tem escopo definido, e não é indefinição: é um portão à espera de uma medição.**

Pablo submete **10 notas fiscais reais** da cozinha — amassadas, tortas, mal iluminadas, de fornecedor pequeno — ao Gemini no Google AI Studio, e conta os acertos de fornecedor, total e itens.

| Placar          | Escopo da fase 4                                                               |
| --------------- | ------------------------------------------------------------------------------ |
| **8–10**        | A Severina lança a nota. Ferramenta de escrita completa                        |
| **5–7**         | Ela preenche o rascunho; um humano confere e confirma na tela                  |
| **abaixo de 5** | Ela só arquiva a foto e avisa _"chegou nota do Frigorífico X, precisa lançar"_ |

Nenhuma das outras fases depende deste número.

---

## 14 · Notas para a implementação

- **Antes de escrever código:** este projeto usa Next.js 16, com mudanças que quebram convenções anteriores. Ler os guias em `node_modules/next/dist/docs/`, conforme [AGENTS.md](../../../AGENTS.md). Vale especialmente para o processamento assíncrono após a resposta do webhook
- `npm run check` (tipos + fronteiras + formatação + testes) antes de todo commit
- O relógio é tarefa agendada do Dokploy batendo em `/api/severina/tick` com segredo no cabeçalho. Se o agendador não servir, um contêiner de cron resolve. O endereço deve ser disparável à mão para depuração
- Variáveis novas: `EVOLUTION_URL=http://evolution_api:8080`, `EVOLUTION_API_KEY`, `SEVERINA_TICK_SEGREDO`, `SEVERINA_WEBHOOK_SEGREDO`, `GEMINI_API_KEY`
- A aba `/assistente/treinamento` já está declarada no manifesto: é o editor de agentes
- `emConstrucao: true` sai do manifesto quando a fase 1 estiver de pé
