# Restaurar o WhatsApp do Tetteo depois de um desastre

Dois conjuntos de dados, dois backups, duas restaurações. A ordem importa.

## 1. O banco do Tetteo (configuração, autorizados, avisos, eventos)

É o backup normal do banco `tetteo` (o `pg_dump` do Postgres do Dokploy).
Restaurado num banco novo, ele traz de volta: a conexão cadastrada, a loja
autorizada, quem pode receber avisos, os avisos com a linha do tempo, os
eventos. **Não traz segredo nenhum** — porque não há segredo nele. O cenário 12
do ensaio prova isso a cada rodada.

Depois de restaurar o banco, o Tetteo ainda mostra **Configuração pendente**
até as variáveis de ambiente serem recriadas no Dokploy (a lista está em
`README.md`, tabela "As variáveis"). Os valores vêm de onde sempre vieram: do
painel da Evolution (chave da instância) e de `openssl rand` no servidor (as
senhas). Nunca de um documento.

## 2. A sessão do número (Evolution)

Gerada por `backup-evolution.sh`. Restaurar, na VPS, como root:

1. Pare a Evolution: `docker stop <contêiner da evolution>` (só ela — não o
   banco dela).
2. Banco:
   `docker exec -i <contêiner do banco> sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' < /root/backups-evolution/evolution-db-<carimbo>.dump`
3. Se houver Redis: `docker stop <redis>`, copie o `.rdb` para o volume de dados
   do Redis como `dump.rdb`, `docker start <redis>`.
4. Se houver volume de instâncias:
   `docker run --rm -v evolution_instances:/dados -v /root/backups-evolution:/origem alpine sh -c "rm -rf /dados/* && tar xzf /origem/evolution-instances-<carimbo>.tgz -C /dados"`
5. `docker start <contêiner da evolution>`.
6. No Tetteo, tela WhatsApp: **Atualizar**. Esperado: Conectado. Se vier
   Desconectado, **Reconectar** mostra o QR Code — e só aí o celular do número
   precisa ler de novo.

## 3. Conferir

- Tela WhatsApp: estado Conectado, "Eventos do provedor" como o Tetteo precisa
  (se não, **Aplicar configuração**).
- Tela Números: o contato de teste continua autorizado.
- Tela Avisos: o histórico está lá, com as linhas do tempo.
- Tela Eventos: depois de alguns minutos, eventos novos de conexão aparecem —
  é a prova de que a Evolution voltou a falar com o Tetteo.

## O que não se restaura

- As variáveis de ambiente. Recriadas à mão no Dokploy, nunca copiadas de
  backup.
- O QR Code. Não é guardado em lugar nenhum; se a sessão se perdeu de vez, o
  caminho é Reconectar e ler um novo.
