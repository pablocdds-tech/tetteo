-- =============================================================================
-- SERVIDOR MCP — preparação do banco do Tetteo
--
-- Roda UMA vez, pelo administrador do banco (o dono das tabelas do Tetteo).
-- Idempotente: rodar de novo não estraga nada.
--
-- NÃO define senha. A senha do papel tetteo_mcp é gerada e aplicada direto no
-- servidor, fora deste arquivo e fora do repositório.
--
-- O que este papel pode, e só isto:
--   · ler DUAS visões do esquema mcp_leitura (login e lojas visíveis);
--   · criar e usar as próprias tabelas no esquema mcp.
-- Nenhuma tabela do Tetteo fica visível para ele.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tetteo_mcp') THEN
    CREATE ROLE tetteo_mcp LOGIN;
  END IF;
END
$$;

ALTER ROLE tetteo_mcp
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS
  CONNECTION LIMIT 10;
ALTER ROLE tetteo_mcp SET statement_timeout = '5s';
ALTER ROLE tetteo_mcp SET idle_in_transaction_session_timeout = '10s';
ALTER ROLE tetteo_mcp SET search_path = mcp;

CREATE SCHEMA IF NOT EXISTS mcp AUTHORIZATION tetteo_mcp;
CREATE SCHEMA IF NOT EXISTS mcp_leitura;
REVOKE ALL ON SCHEMA mcp_leitura FROM PUBLIC;
GRANT USAGE ON SCHEMA mcp_leitura TO tetteo_mcp;

-- Deixa explícito: nada do esquema public. Se um dia alguém der um GRANT
-- amplo em public, esta linha, rodada de novo, desfaz para este papel.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM tetteo_mcp;

-- Quem pode entrar: ativo, não excluído, com senha. security_barrier impede
-- que uma consulta esperta enxergue as linhas que o filtro esconde.
CREATE OR REPLACE VIEW mcp_leitura.usuario_login
  WITH (security_barrier = true) AS
SELECT
  u.id,
  lower(u.email) AS email,
  u.nome,
  u."senhaHash" AS senha_hash
FROM public.usuario u
WHERE u.status = 'ATIVO'
  AND u."excluidoEm" IS NULL
  AND u."senhaHash" IS NOT NULL;

-- Em que lojas a pessoa pode ver vendas. A mesma regra de contextoDeFundo()
-- + pode() em src/core/sessao/contexto.ts: acesso de rede (unidadeId nulo)
-- vale para toda loja ativa da organização; acesso de loja vale para ela; o
-- papel precisa de '*', 'financeiro.*' ou 'financeiro.ver'.
CREATE OR REPLACE VIEW mcp_leitura.loja_com_vendas_visiveis
  WITH (security_barrier = true) AS
SELECT DISTINCT
  a."usuarioId" AS usuario_id,
  un.id AS unidade_id,
  un.nome AS unidade_nome
FROM public.acesso a
JOIN public.organizacao o
  ON o.id = a."organizacaoId" AND o.ativa AND o."excluidoEm" IS NULL
JOIN public.papel_permissao pp
  ON pp."papelId" = a."papelId"
 AND pp.chave IN ('*', 'financeiro.*', 'financeiro.ver')
JOIN public.unidade un
  ON un."organizacaoId" = a."organizacaoId"
 AND un.ativa
 AND un."excluidoEm" IS NULL
 AND (a."unidadeId" IS NULL OR a."unidadeId" = un.id)
WHERE a.status = 'ATIVO'
  AND a."excluidoEm" IS NULL;

GRANT SELECT ON mcp_leitura.usuario_login TO tetteo_mcp;
GRANT SELECT ON mcp_leitura.loja_com_vendas_visiveis TO tetteo_mcp;
