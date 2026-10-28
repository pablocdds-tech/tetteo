# Conectar a Cardápio Web ao Tetteo

## Conta que já possui token de API

1. No Tetteo, selecione a unidade e abra **Configurações → Cardápio Web**.
2. Em **Conectar pedidos e webhook**, escolha produção ou Sandbox, informe o
   token de API da loja e gere um token seguro para autenticar o webhook.
3. Copie esse token antes de salvar. Clique em **Conferir a loja pela API** e
   confirme o nome e o identificador retornados. Não associe uma loja diferente
   à unidade selecionada.
4. Copie a URL mostrada pelo Tetteo. Na Cardápio Web, abra **Configurações →
   Integrações → API** e cadastre a URL do webhook com o mesmo token de
   autenticação criado no Tetteo. Salve a configuração.
5. Confira no Tetteo os horários do último evento e da última reconciliação.
   Faça o teste de um pedido no Sandbox antes de considerar a integração
   homologada. O teste automatizado local usa somente fixtures.

A tela consulta os registros do Tetteo a cada 15 segundos enquanto estiver
visível, ao voltar à janela e pelo botão **Atualizar pedidos**. A atualização
automática pausa durante a configuração de credenciais. Isso atualiza a lista
e os indicadores sem fazer uma nova consulta direta ao fornecedor. **Último
webhook recebido** informa somente entregas do webhook; pedidos obtidos pela
consulta automática da API aparecem na mesma lista, mesmo sem esse evento.
Os pedidos recebidos entram também em **PDV → Gestão de pedidos**, com a
sequência numérica da unidade no Tetteo e um selo com a origem e o número
original. Esta tela de configurações mantém somente a conferência da conexão.

Com `APP_URL=https://app.vitalianopizzaria.com.br`, a URL de produção é:

```text
https://app.vitalianopizzaria.com.br/api/cardapioweb/webhook?ambiente=producao
```

Para testes, a tela gera a URL com `ambiente=sandbox`. O parâmetro identifica
o ambiente, não autentica a requisição. O segredo viaja no cabeçalho
`X-Webhook-Token`, nunca na URL. Não envie o token de API ou do webhook pelo chat.

O Tetteo guarda somente o hash do token de webhook e não consegue mostrá-lo
novamente. Para trocá-lo, confira novamente a credencial na tela e atualize os
dois lados. O token de API fica cifrado no servidor e não retorna para a página.

**Desconectar no Tetteo** interrompe as consultas e remove as credenciais locais.
Remova também o webhook no portal da Cardápio Web. Essa ação não revoga o token
compartilhado da loja no fornecedor nem interfere em outras integrações.

## O que é recebido

A rota aceita apenas POST JSON com `ORDER_CREATED` e `ORDER_STATUS_UPDATED`.
Ela confere autenticação, ambiente, loja e unidade ativa antes de gravar. O
HTTP 200 significa que o evento foi persistido, ou que ele já existia com os
mesmos dados. Não significa que o pedido já foi consultado na API.

Uma fila persistente consulta os detalhes com `X-API-KEY`, confere `merchant_id`
e mantém um registro por loja/pedido. Eventos antigos não desfazem uma revisão
mais recente. A cada minuto, uma consulta de reconciliação procura pedidos
modificados que não chegaram por webhook. O cursor só avança depois que o lote
está gravado na fila. Concessões no banco coordenam reinícios e várias instâncias.

O polling inicial cobre a janela padrão de oito horas. Com cursor recente, usa
`updated_since` com sobreposição. Após uma parada longa, a janela disponível
pode não cobrir todo o intervalo perdido: recuperação histórica ampliada ainda
exige implementação própria e validação dos limites do fornecedor.

O worker tenta até três eventos por passagem, executa a cada 15 segundos e
aplica espera entre falhas. HTTP 429 pausa consultas por três minutos; token
inválido ou identidade incompatível interrompem a conexão para nova conferência.
`CARDAPIOWEB_WORKER_ENABLED=false` pausa o processamento; os eventos já gravados
continuam no banco. Nenhum evento é apagado ao desconectar.

Os pedidos entram no kanban pela projeção operacional compartilhada
`PedidoRecebido` e pelo evento durável `pedido_externo.conferido`. Reenvios
atualizam o mesmo cartão. A sequência é reservada sob a mesma trava usada
pelos pedidos locais; o número original não substitui o número do Tetteo.
Os resumos anteriores à implantação são recuperados em lotes para preencher
os detalhes e publicar sua entrada no PDV. Somente produção é publicada;
Sandbox fica na conferência da integração.

O detalhe preserva itens/complementos/combos, cliente, endereço, observações
e pagamentos necessários à operação. A resposta é validada e campos fiscais,
dados de cartão e coordenadas são descartados. Cliente segue `crm.ver` e
entrega segue `pdv.entrega` no PDV; o evento e a auditoria não carregam esses
dados pessoais. A conferência em configurações continua devolvendo só resumos.

Esta entrada não cria venda ou pagamento no caixa local, não soma aos totais
do Saipos, não movimenta estoque e não altera o pedido remoto. A situação é
atualizada pela origem, e o cartão leva ao portal para gerenciar o pedido.
Consulte as regras de operação e agendados em [PDV](pdv.md).

O token legado da loja permite consulta de pedidos. A consulta de catálogo
legado também exige `X-PARTNER-KEY`, que não é solicitado por este fluxo. Para
novos aplicativos e recursos adicionais, a documentação recomenda OAuth.

## Aplicativo OAuth

O fluxo anterior por aplicativo permanece separado: cadastro na CW App Store,
PKCE, retorno em `/api/cardapioweb/callback`, confirmação da loja e consultas
manuais de pedidos/catalogo. Não há fallback automático de Bearer para API Key.
Configure `CARDAPIOWEB_CLIENT_ID`, `CARDAPIOWEB_REDIRECT_URI` e o ambiente.

O webhook desta entrega atende a conexão legada com token cadastrado no portal.
A ativação automática de webhook de um app OAuth precisa integrar o token do
app e o vínculo da instalação; não se presume que o token privado da loja seja
o token global de um app da Store.

## Banco, permissões e segredos

- Migração aditiva `20261027010000_cardapioweb`: cinco tabelas novas; nenhum
  reset ou alteração de dados de outros módulos. Produção usa `prisma migrate deploy`.
- `20261028001000_cardapioweb_pdv` acrescenta a projeção operacional recebida,
  seu vínculo ao pedido do PDV e o marcador de recuperação dos resumos antigos.
  Preserva números e vendas anteriores. Um cartão exige uma venda local ou
  um pedido recebido, nunca ambos; os vínculos de unidade são compostos.
- `configuracoes.cardapioweb` permite gerenciar a conexão. Diretor com `*`
  mantém acesso; outros papéis precisam receber a permissão explicitamente.
- Organização/unidade são obtidas da sessão. A loja é retornada pela API.
  Eventos não escolhem unidade por campos extras do payload.
- API Key é cifrada com AES-256-GCM e contexto por organização/unidade/ambiente/
  loja. `CARDAPIOWEB_ENCRYPTION_KEY` aceita 64 caracteres hexadecimais estáveis.
  Sem essa variável, a chave é derivada de `AUTH_SECRET` com HKDF, salt `tetteo`
  e finalidade `cardapioweb:v1`.
- Antes de rotacionar `AUTH_SECRET` quando a derivação estiver em uso, preserve
  a chave derivada como `CARDAPIOWEB_ENCRYPTION_KEY` no ambiente privado. Não
  substitua por uma chave aleatória sem migrar as cifras existentes.
- O receptor limita o corpo a 16 KiB, limita tempo de leitura e persistência,
  recusa token inválido, não confirma falhas de banco e ignora campos adicionais.
- Credenciais, cabeçalhos de autorização e payloads de erro do fornecedor não
  são gravados em auditoria nem enviados nas mensagens de erro.

## Validação

```bash
npm run check
npm run build
tsx --import ./scripts/ambiente-de-teste.ts --test src/connectors/cardapioweb/recebimento.integracao.ts
```

A integração exige banco PostgreSQL local com nome `_test`, separado de qualquer
base de produção. O ensaio da migração parte do schema anterior, aplica somente
a migração nova e confere a preservação de um registro anterior. A reconstrução
integral das migrações históricas tem um impedimento preexistente documentado em
`docs/unificacao-crm.md`.

Fontes: [material oficial Kairu](https://portal.kairulabs.com.br/v3/aprender/biblioteca/cardapioweb),
[webhooks](https://docs.cardapioweb.com/webhooks/visao-geral),
[eventos](https://docs.cardapioweb.com/webhooks/eventos),
[API Key](https://docs.cardapioweb.com/autenticacao/api-key-legado).
O mapa completo de contratos e divergências está em `docs/cardapioweb-api.md`.
