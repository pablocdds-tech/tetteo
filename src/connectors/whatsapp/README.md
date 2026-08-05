# `connectors/whatsapp/` — a ponte com a Evolution API

Só este arquivo sabe o que é "Evolution API". Nenhum App ouviu falar dela.

## O que precisa no ambiente

```bash
EVOLUTION_URL=http://evolution_api:8080
EVOLUTION_API_KEY=<a chave da instância>
EVOLUTION_INSTANCIA=severina-teste
```

`EVOLUTION_URL` aponta para **dentro** da rede do Docker. A URL pública
(`https://evo.…`) existe só para o navegador ler o QR Code — o Tetteo nunca
passa por ela.

## Quem chama

Ninguém de `modules/`. O linter recusa: módulo não importa conector.

Quem chama é a camada `app/`, no relógio (`/api/severina/tick`). A Severina
grava "mande esta mensagem" na fila; o relógio lê e entrega para cá.

Parece rodeio e não é. Como o envio passa por um lugar só, existe onde
**segurar o ritmo** — e ritmo é o que impede o número de ser banido.

## O que ele NÃO faz

- Não conhece agente, conversa nem mensagem do Tetteo. Recebe telefone e texto.
- Não decide se deve enviar. Isso é da Severina.
- Não recebe mensagem ainda. O webhook de entrada é da fase 2.
