-- =============================================================================
-- SERVIDOR MCP — as tabelas do próprio serviço (esquema mcp)
--
-- Roda o próprio serviço, ao subir, como tetteo_mcp. IF NOT EXISTS: rodar de
-- novo não muda nada. Nenhuma chave em claro: só a impressão digital (hash).
-- =============================================================================

-- Um pedido de autorização em andamento: do "Conectar" no Claude até a
-- pessoa aprovar (10 minutos).
CREATE TABLE IF NOT EXISTS mcp.pedido_autorizacao (
  hash text PRIMARY KEY,
  client_id text NOT NULL,
  cliente_nome text NOT NULL,
  redirect_uri text NOT NULL,
  state text,
  code_challenge text NOT NULL,
  escopos text[] NOT NULL,
  recurso text NOT NULL,
  usuario_id text,
  versao_senha text,
  autenticado_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now(),
  expira_em timestamptz NOT NULL
);

-- Uma conexão aprovada: quem, qual loja, qual cliente. Revogar é marcar aqui.
-- versao_senha é a impressão digital da senha no momento da aprovação: se a
-- pessoa trocar a senha no Tetteo, a conexão deixa de valer.
CREATE TABLE IF NOT EXISTS mcp.conexao (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  usuario_id text NOT NULL,
  unidade_id text NOT NULL,
  versao_senha text NOT NULL,
  client_id text NOT NULL,
  cliente_nome text NOT NULL,
  escopos text[] NOT NULL,
  recurso text NOT NULL,
  criada_em timestamptz NOT NULL DEFAULT now(),
  ultimo_uso_em timestamptz,
  revogada_em timestamptz,
  motivo_revogacao text
);
CREATE INDEX IF NOT EXISTS conexao_usuario ON mcp.conexao (usuario_id);

CREATE TABLE IF NOT EXISTS mcp.codigo_autorizacao (
  hash text PRIMARY KEY,
  conexao_id text NOT NULL REFERENCES mcp.conexao (id) ON DELETE CASCADE,
  client_id text NOT NULL,
  redirect_uri text NOT NULL,
  code_challenge text NOT NULL,
  expira_em timestamptz NOT NULL,
  usado_em timestamptz
);

CREATE TABLE IF NOT EXISTS mcp.token (
  hash text PRIMARY KEY,
  conexao_id text NOT NULL REFERENCES mcp.conexao (id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('acesso', 'renovacao')),
  criado_em timestamptz NOT NULL DEFAULT now(),
  expira_em timestamptz NOT NULL,
  -- Só renovação: já foi trocada por outra. Reapresentar = roubo provável.
  substituido_em timestamptz
);
CREATE INDEX IF NOT EXISTS token_conexao ON mcp.token (conexao_id);

-- Tentativas de login, para o limite. E-mail e IP só em hash.
CREATE TABLE IF NOT EXISTS mcp.tentativa_login (
  id bigserial PRIMARY KEY,
  email_hash text NOT NULL,
  ip_hash text NOT NULL,
  sucesso boolean NOT NULL,
  criada_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tentativa_email ON mcp.tentativa_login (email_hash, criada_em);
CREATE INDEX IF NOT EXISTS tentativa_ip ON mcp.tentativa_login (ip_hash, criada_em);

-- O que a IA consultou, quando e se deu certo. Sem chave, sem resposta.
CREATE TABLE IF NOT EXISTS mcp.chamada (
  id bigserial PRIMARY KEY,
  conexao_id text NOT NULL,
  ferramenta text NOT NULL,
  argumentos jsonb NOT NULL,
  resultado text NOT NULL CHECK (resultado IN ('ok', 'erro')),
  duracao_ms integer NOT NULL,
  criada_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chamada_conexao ON mcp.chamada (conexao_id, criada_em);
