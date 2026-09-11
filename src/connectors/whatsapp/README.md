# `connectors/whatsapp/` — a ponte com o WhatsApp

Só esta pasta sabe o que é "Evolution API". Nenhum App ouviu falar dela: o
linter recusa `modules/` importando `connectors/`. Trocar de provedor um dia
(a Cloud API da Meta, por exemplo) é escrever outro arquivo que cumpra o
contrato de `tipos.ts`, e nada mais.

## O contrato (`tipos.ts`)

| Operação            | O que faz                                                                 |
| ------------------- | ------------------------------------------------------------------------- |
| `consultarConexao`  | Conectado, Conectando ou Desconectado; ou "pendente" com o que falta      |
| `lerEventos`        | O webhook configurado hoje na instância (endereço mascarado, sem a senha) |
| `configurarEventos` | Aplica o webhook do Tetteo: endereço, senha do passe e os 3 eventos       |
| `pedirQrCode`       | O QR para reconectar. Com o número no ar, devolve "já conectado"          |
| `enviarMensagem`    | Envia texto. Responde aceito, não chegou, incerto ou recusado             |
| `consultarMensagem` | Depois de um "incerto": a mensagem com este texto saiu?                   |

O que **não** existe no contrato, de propósito: desconectar. A 2.3.7 só tira o
número do ar por `logout` ou `delete` da instância, e o Tetteo não chama
nenhuma das duas.

## Os dois provedores

- `evolution.ts` — a Evolution API **2.3.7**, modalidade Baileys. Cada caminho,
  método e corpo foi lido do código-fonte da etiqueta `2.3.7`, não da
  documentação (as duas divergem — ver o desenho em
  `docs/superpowers/specs/2026-09-10-whatsapp-avisos-design.md`, §3). Usa a
  chave **da instância**, nunca a global.
- `simulado.ts` — o mesmo contrato sem rede, para o ensaio. Provoca o que não
  se provoca num número real (tempo esgotado em que a mensagem saiu, credencial
  recusada, rede fora). **Recusado em produção** por `provedorPara`.

## O que precisa no ambiente

```bash
EVOLUTION_URL=http://evolution_api:8080   # rede interna do Docker
EVOLUTION_INSTANCIA=                      # o nome da instância que já existe
EVOLUTION_API_KEY=                        # a chave DA INSTÂNCIA
WHATSAPP_WEBHOOK_URL=                     # http://<tetteo>:3000/api/whatsapp/webhook
WHATSAPP_WEBHOOK_CHAVE=                   # openssl rand -hex 32, gerada no servidor
WHATSAPP_WEBHOOK_CHAVE_ANTERIOR=          # só durante a troca
```

Valores só no ambiente privado. Faltando qualquer um, `configuracao.ts` devolve
o **nome** do que falta, nunca um valor.

## As peças puras (testadas sem rede)

| Arquivo                | Responde                                                                |
| ---------------------- | ----------------------------------------------------------------------- |
| `sanitizar.ts`         | Limpa chave, token, JWT, base64 e telefone de qualquer texto de erro    |
| `configuracao.ts`      | O que está configurado, e o que falta — pelo nome                       |
| `passe.ts`             | O JWT HS256 que a 2.3.7 manda com `jwt_key`: assina (ensaio) e verifica |
| `webhook-evolution.ts` | O corpo do webhook da 2.3.7 traduzido, com validação estrita            |
| `falhas.ts`            | "O pedido chegou?" — não chegou / incerto / recusado                    |

## Quem chama

Ninguém de `modules/`. Quem chama é a camada `app/`:

- `app/api/whatsapp/webhook` — a Evolution entrega eventos aqui
- `app/api/whatsapp/_costura/*` — entrega de avisos, verificação, saúde, tela
- `app/api/severina/tick` — o relógio, que chama a rodada do WhatsApp e a fila
  dos agentes
- `app/(shell)/assistente/acoes-whatsapp.ts` — as ações da tela que precisam
  do provedor (QR, reconectar, aplicar eventos, confirmar, reenviar)

## O que a 2.3.7 não tem — e como o Tetteo lida

- **Assinatura do corpo do webhook.** O que existe é o passe JWT (prova quem
  chamou, não que o conteúdo não mudou). O Tetteo soma: rede interna, esquema
  estrito, e a trava de duplicata por id externo.
- **Chave de idempotência no envio.** Um tempo esgotado vira "resultado
  desconhecido": o Tetteo consulta o provedor pelo texto (único, graças à
  referência `AV-…`) e **nunca reenvia sozinho**.
- **Troca da chave da instância pela API.** Limite conhecido; a senha do
  webhook, essa roda sem parar nada.
