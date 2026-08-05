# Onde os arquivos moram

**Data:** 04/08/2026
**Alcance:** infraestrutura — não pertence a nenhum App
**Estado:** decidido

---

## O problema

O Tetteo não tem onde guardar arquivo. O contêiner é recriado a cada publicação, e tudo que foi escrito dentro dele desaparece — não por falta de espaço, mas porque aquele sistema de arquivos deixa de existir.

Duas coisas já esbarraram nisso:

- **Checklists** (`e3775e3`) — o item já marca "pede foto" e a resposta já tem a coluna da URL, mas o envio não entrou. Metade de um upload é pior do que nenhum
- **Severina** — a pergunta de tipo `foto` na Coleta, e a foto de nota fiscal na fase 4

Não é problema de um App. É infraestrutura faltando, e por isso mora fora dos dois documentos.

## A decisão

**Volume persistente montado no contêiner**, declarado no Dokploy.

```
Dokploy → serviço Tetteo → Volumes / Mounts
   Volume:         tetteo_arquivos
   Container Path: /app/arquivos
```

A partir daí `/app/arquivos` é uma pasta comum que sobrevive a publicação.

### Por que não as alternativas

**MinIO na VPS** — armazenamento de objetos completo, com URLs assinadas e caminho fácil para S3 depois. É a escolha certa para quem tem vários servidores ou volume grande. Para um restaurante numa VPS, é um serviço a mais para manter, com banco e cache próprios, sem ganho que se note.

**S3 / Cloudflare R2** — contraria o _"tudo roda em VPS própria, sem dependência de serviço pago externo"_ do README, e cobra. Fica como caminho de saída se um dia o volume não bastar.

**Baserow, ou qualquer app no-code como depósito** — seria subir uma aplicação inteira para fazer o que uma pasta faz, e as fotos ficariam num endereço que não passa pelas permissões do Tetteo.

### O tamanho não é o problema

Foto de WhatsApp pesa cerca de 200 KB — o próprio WhatsApp comprime antes de enviar. A 30 checklists e 20 notas por dia, dá algo perto de **6 GB por ano**. A VPS tem 100 GB.

O que faltava era a montagem, nunca o espaço.

## As regras

### 1 · Arquivo é servido por rota, nunca por caminho público

Um arquivo em endereço adivinhável contorna todo o sistema de permissões. A entrega passa por uma rota que confere `pode()` antes de devolver o conteúdo — exatamente como qualquer tela.

```
GET /api/arquivos/<id>
  → carrega o registro
  → confere organização, unidade e permissão do contexto
  → só então lê do disco e devolve
```

Nunca servir `/app/arquivos` como pasta estática.

### 2 · O nome no disco não diz nada

Nome de arquivo é aleatório, como todo identificador do sistema — nunca `nota-frigorifico-x.jpg`, nunca sequencial. O nome original vira coluna no banco, não caminho no disco.

Organização em pastas por ano e mês, para nenhum diretório crescer sem limite:

```
/app/arquivos/2026/08/clx82n4k9a0001.jpg
```

### 3 · Todo arquivo tem dono no banco

Nada existe solto no disco. Uma tabela registra organização, unidade, quem enviou, tipo, tamanho, nome original e a que entidade pertence. Sem linha no banco, o arquivo é órfão e não é servido.

### 4 · Exclusão é lógica, como todo o resto

`excluidoEm` marca a exclusão; o byte permanece. Vale especialmente para foto de nota fiscal, que tem peso fiscal — apagar de verdade é criar problema que aparece anos depois.

## A pendência declarada

**Volume não é backup.** Se a VPS morrer, os arquivos morrem junto — inclusive as fotos de nota fiscal.

Não bloqueia nada agora e não entra em nenhuma fase da Severina, mas fica escrito para não virar descoberta ruim: uma cópia fora da máquina é decisão que ainda precisa ser tomada, junto com a do backup do banco.

## Quem depende disto

| Quem             | Para quê                             | Quando                             |
| ---------------- | ------------------------------------ | ---------------------------------- |
| **Checklists**   | O item que pede foto, hoje sem envio | Assim que o volume existir         |
| **Severina**     | Pergunta de tipo `foto` na Coleta    | Fase 2                             |
| **Severina**     | Foto de nota fiscal                  | Fase 4, se o portão do teste abrir |
| **Pessoas (DP)** | Documentos de admissão               | Quando o módulo existir            |
