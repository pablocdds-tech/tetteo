# Roteiro de demonstração — WhatsApp no Tetteo

Prints **reais** das telas, tirados em 11/09/2026 no Edge, contra o Tetteo
rodando nesta máquina (`next dev`, porta 3001) com o banco descartável do
ensaio e o **provedor simulado**. Nenhuma mensagem saiu desta máquina; nenhum
nome, telefone ou e-mail é de gente de verdade; o número aparece mascarado.
Não há QR Code em nenhum print, de propósito.

Resolução: computador 2560 × 2200 (viewport 1280 × 1100, escala 2); celular
900 × 2600 (viewport 450 × 1300, escala 2). Captura do tamanho da janela, sem
redução e sem base64. O selo do `next dev` foi escondido só na captura.

Como reproduzir: `docs/operacao/whatsapp/README.md`, seção "Como testar na
máquina". Os dados vêm de `ensaio/whatsapp/demonstracao.ts`.

## Tela 1 — Configuração (`/assistente/whatsapp`)

`computador-01-configuracao.png` · `celular-01-configuracao.png`

O que se vê:

- **Conexão**: estado (Conectado), o número mascarado `(11) •••••-0001`, a
  hora da última notícia do provedor, **Reconectar** e **Atualizar**.
  Reconectar nunca derruba o número: com ele no ar, só confirma.
- **Envio**: as duas chaves. "Avisos confirmados" liberado ou pausado (pausado,
  nem aviso confirmado sai). "Agendamentos da Severina" **pausados** — nascem
  assim, e liberar pede um segundo toque.
- **Loja autorizada**: quem pode ver o QR Code e conectar é decidido na loja
  deste número.
- **Eventos do provedor**: o webhook atual da instância (endereço sem consulta,
  os três eventos, se há senha do passe, quando o Tetteo aplicou). "Aplicar
  configuração" pede confirmação porque substitui o webhook da instância.

Na demonstração o print foi tirado depois de "Aplicar configuração" → "Sim,
aplicar": a etiqueta virou "Como o Tetteo precisa".

## Tela 2 — Fluxo principal (`/assistente/avisos`)

`computador-02-fluxo-confirmacao.png` · `celular-02-fluxo-confirmacao.png`

No computador, o rascunho **"Fechamento pronto para revisão"**; no celular, o
rascunho "Entrega de queijo atrasada", preparado à mão pela operadora fictícia
(o do fechamento já tinha sido confirmado na passada do computador).

O rascunho do fechamento nasceu sozinho, do checklist de
Fechamento concluído no cenário fictício (loja, checklist, quem concluiu, hora
no fuso da loja, nota, itens fora do padrão, o link para revisar e a referência
`AV-…`). Ninguém o enviou: ele espera em "Para revisar".

No painel: a **prévia** como vai chegar no celular, **quem recebe** (só quem um
responsável autorizou em Números), e o segundo toque — "Enviar 1 mensagem para
Ana Ensaio?" → "Sim, enviar". A linha do tempo mostra só o que tem prova:
Rascunho com horário, o resto em branco.

`computador-03-fluxo-aceito.png` · `celular-03-fluxo-aceito.png`

Logo depois do "Sim, enviar": o aviso saiu pelo provedor simulado e está em
**Aceito pelo provedor** — que não é "entregue". A tela não deixa parecer que é.

## Tela 3 — Resultado (`/assistente/avisos?grupo=concluidos` e `/assistente/eventos`)

`computador-04-resultado-lido.png` · `celular-04-resultado-lido.png`

O aviso "Caixa conferido" percorreu tudo: Rascunho → Confirmado → Na fila →
Aceito pelo provedor → Entregue → **Lido**, cada etapa com o horário em que a
prova chegou. "Entregue" e "Lido" vieram de eventos `messages.update` do
provedor (no ensaio, entregues ao mesmo código que recebe o webhook).

`computador-05-eventos.png` · `celular-05-eventos.png`

O painel de saúde: recebidos, ignorados, duplicados e falhas nas últimas 24 h,
com o período anterior como comparação. Na lista: a conexão, os status de
mensagem, um "entregue" que chegou **duas vezes** (Repetições = 1, trabalho
feito uma vez), uma mensagem do próprio número e uma de grupo **ignoradas**
(é o que impede ciclo de respostas), uma mensagem enviada fora do Tetteo, e um
tipo que o Tetteo não sabe ler (Falhou). Nenhuma linha carrega texto de
mensagem, contato ou telefone inteiro.

`computador-06-pendencia-incerta.png` · `celular-06-pendencia-incerta.png`

A pendência rastreável: um envio cujo resultado ficou **desconhecido** (o
provedor não respondeu). O Tetteo consultou o provedor (1 de 5), não achou, e
**parou** — não reenviou. Quem decide é a pessoa, e o botão "Reenviar mesmo
assim" avisa antes que pode chegar duas vezes.

## O que este roteiro NÃO mostra

- Um número real. O degrau seguinte — um envio ao contato de teste autorizado
  pelo dono — só acontece depois de ele ver os testes e as pendências.
- QR Code. Aparece na tela real, para quem pode conectar na loja do número, por
  45 segundos, e não é guardado em lugar nenhum.
