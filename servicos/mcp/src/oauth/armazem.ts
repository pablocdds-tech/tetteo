import type pg from "pg";

import type { Banco } from "../banco/conexao.js";
import type { ChamadaRegistrada } from "../mcp/vendas-do-dia.js";
import {
  ehDoTipo,
  gerarSegredo,
  impressaoDigital,
  pkceConfere,
} from "./segredos.js";

/**
 * O ARMAZÉM DO OAUTH: todo o estado do login mora aqui, no esquema `mcp`.
 *
 * Nada fica na memória do processo. Um deploy no meio de um login não perde o
 * pedido; um deploy no meio de uma conversa não derruba a chave.
 *
 * Três regras de segurança vivem neste arquivo:
 *
 *   1. Só a impressão digital de cada chave vai para o banco.
 *   2. Código de autorização vale uma vez. Usado de novo = alguém copiou;
 *      a conexão inteira cai.
 *   3. Chave de renovação é trocada a cada uso. A antiga reapresentada, ou
 *      apresentada por outro cliente = roubo provável; a conexão inteira cai.
 *
 * Nas regras 2 e 3 a revogação precisa SOBREVIVER ao erro. Por isso as
 * funções de troca devolvem `{ ok: false }` em vez de lançar: a transação
 * confirma a revogação, e só depois quem chamou responde `invalid_grant`.
 */

export const DURACAO = {
  pedidoS: 10 * 60,
  codigoS: 2 * 60,
  acessoS: 60 * 60,
  renovacaoS: 30 * 24 * 60 * 60,
} as const;

type Executor = Pick<pg.Pool | pg.PoolClient, "query">;

async function emTransacao<T>(
  banco: Banco,
  trabalho: (cliente: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const cliente = await banco.connect();
  try {
    await cliente.query("BEGIN");
    const resultado = await trabalho(cliente);
    await cliente.query("COMMIT");
    return resultado;
  } catch (erro) {
    await cliente.query("ROLLBACK").catch(() => {});
    throw erro;
  } finally {
    cliente.release();
  }
}

// ---------------------------------------------------------------------------
// Pedidos de autorização em andamento

export type NovoPedido = {
  clientId: string;
  clienteNome: string;
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
  escopos: string[];
  recurso: string;
};

export type Pedido = NovoPedido & {
  hash: string;
  usuarioId: string | null;
  autenticadoEm: Date | null;
};

export async function criarPedido(
  banco: Banco,
  pedido: NovoPedido,
): Promise<string> {
  const id = gerarSegredo("pedido");
  await banco.query(
    `INSERT INTO mcp.pedido_autorizacao
       (hash, client_id, cliente_nome, redirect_uri, state, code_challenge, escopos, recurso, expira_em)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now() + make_interval(secs => $9))`,
    [
      impressaoDigital(id),
      pedido.clientId,
      pedido.clienteNome,
      pedido.redirectUri,
      pedido.state,
      pedido.codeChallenge,
      pedido.escopos,
      pedido.recurso,
      DURACAO.pedidoS,
    ],
  );
  return id;
}

export async function lerPedido(
  banco: Banco,
  id: string,
): Promise<Pedido | null> {
  if (!ehDoTipo(id, "pedido")) return null;
  const { rows } = await banco.query(
    `SELECT hash, client_id, cliente_nome, redirect_uri, state, code_challenge,
            escopos, recurso, usuario_id, autenticado_em
       FROM mcp.pedido_autorizacao
      WHERE hash = $1 AND expira_em > now()`,
    [impressaoDigital(id)],
  );
  const linha = rows[0];
  if (!linha) return null;
  return {
    hash: linha.hash,
    clientId: linha.client_id,
    clienteNome: linha.cliente_nome,
    redirectUri: linha.redirect_uri,
    state: linha.state,
    codeChallenge: linha.code_challenge,
    escopos: linha.escopos,
    recurso: linha.recurso,
    usuarioId: linha.usuario_id,
    autenticadoEm: linha.autenticado_em,
  };
}

export async function marcarPedidoAutenticado(
  banco: Banco,
  hash: string,
  usuarioId: string,
): Promise<void> {
  await banco.query(
    `UPDATE mcp.pedido_autorizacao
        SET usuario_id = $2, autenticado_em = now()
      WHERE hash = $1`,
    [hash, usuarioId],
  );
}

export async function apagarPedido(banco: Banco, hash: string): Promise<void> {
  await banco.query("DELETE FROM mcp.pedido_autorizacao WHERE hash = $1", [
    hash,
  ]);
}

// ---------------------------------------------------------------------------
// Tentativas de login

export async function falhasRecentes(
  banco: Banco,
  chaves: { emailHash: string; ipHash: string },
): Promise<{ porEmail: number; porIp: number }> {
  const { rows } = await banco.query(
    `SELECT count(*) FILTER (WHERE email_hash = $1)::int AS por_email,
            count(*) FILTER (WHERE ip_hash = $2)::int AS por_ip
       FROM mcp.tentativa_login
      WHERE NOT sucesso
        AND criada_em > now() - interval '15 minutes'
        AND (email_hash = $1 OR ip_hash = $2)`,
    [chaves.emailHash, chaves.ipHash],
  );
  return { porEmail: rows[0].por_email, porIp: rows[0].por_ip };
}

export async function registrarTentativa(
  banco: Banco,
  tentativa: { emailHash: string; ipHash: string; sucesso: boolean },
): Promise<void> {
  await banco.query(
    "INSERT INTO mcp.tentativa_login (email_hash, ip_hash, sucesso) VALUES ($1, $2, $3)",
    [tentativa.emailHash, tentativa.ipHash, tentativa.sucesso],
  );
}

// ---------------------------------------------------------------------------
// Conexões, códigos e chaves

export type NovaConexao = {
  usuarioId: string;
  unidadeId: string;
  clientId: string;
  clienteNome: string;
  escopos: string[];
  recurso: string;
  redirectUri: string;
  codeChallenge: string;
};

export type ChavesEmitidas = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  escopos: string[];
};

export type ResultadoDaTroca =
  | { ok: true; chaves: ChavesEmitidas }
  | { ok: false; erro: "invalid_grant"; descricao: string };

const falha = (descricao: string): ResultadoDaTroca => ({
  ok: false,
  erro: "invalid_grant",
  descricao,
});

/** A pessoa continua ativa e continua podendo ver as vendas daquela loja? */
async function podeContinuar(
  executor: Executor,
  usuarioId: string,
  unidadeId: string,
): Promise<boolean> {
  const { rows } = await executor.query(
    `SELECT 1
       FROM mcp_leitura.usuario_login u
       JOIN mcp_leitura.loja_com_vendas_visiveis l ON l.usuario_id = u.id
      WHERE u.id = $1 AND l.unidade_id = $2`,
    [usuarioId, unidadeId],
  );
  return rows.length > 0;
}

async function revogarNaTransacao(
  executor: Executor,
  conexaoId: string,
  motivo: string,
): Promise<void> {
  await executor.query(
    `UPDATE mcp.conexao SET revogada_em = now(), motivo_revogacao = $2
      WHERE id = $1 AND revogada_em IS NULL`,
    [conexaoId, motivo],
  );
  await executor.query("DELETE FROM mcp.token WHERE conexao_id = $1", [
    conexaoId,
  ]);
}

async function emitirPar(
  cliente: pg.PoolClient,
  conexaoId: string,
  escopos: string[],
): Promise<ChavesEmitidas> {
  const accessToken = gerarSegredo("acesso");
  const refreshToken = gerarSegredo("renovacao");
  await cliente.query(
    `INSERT INTO mcp.token (hash, conexao_id, tipo, expira_em) VALUES
       ($1, $3, 'acesso', now() + make_interval(secs => $4)),
       ($2, $3, 'renovacao', now() + make_interval(secs => $5))`,
    [
      impressaoDigital(accessToken),
      impressaoDigital(refreshToken),
      conexaoId,
      DURACAO.acessoS,
      DURACAO.renovacaoS,
    ],
  );
  return { accessToken, refreshToken, expiresIn: DURACAO.acessoS, escopos };
}

export async function aprovarConexao(
  banco: Banco,
  conexao: NovaConexao,
): Promise<string> {
  const codigo = gerarSegredo("codigo");
  await emTransacao(banco, async (cliente) => {
    const { rows } = await cliente.query(
      `INSERT INTO mcp.conexao (usuario_id, unidade_id, client_id, cliente_nome, escopos, recurso)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        conexao.usuarioId,
        conexao.unidadeId,
        conexao.clientId,
        conexao.clienteNome,
        conexao.escopos,
        conexao.recurso,
      ],
    );
    await cliente.query(
      `INSERT INTO mcp.codigo_autorizacao (hash, conexao_id, client_id, redirect_uri, code_challenge, expira_em)
       VALUES ($1, $2, $3, $4, $5, now() + make_interval(secs => $6))`,
      [
        impressaoDigital(codigo),
        rows[0].id,
        conexao.clientId,
        conexao.redirectUri,
        conexao.codeChallenge,
        DURACAO.codigoS,
      ],
    );
  });
  return codigo;
}

export async function trocarCodigo(
  banco: Banco,
  pedido: {
    codigo: string;
    clientId: string;
    redirectUri: string;
    verificador: string;
  },
): Promise<ResultadoDaTroca> {
  if (!ehDoTipo(pedido.codigo, "codigo")) {
    return falha("Código inválido ou expirado.");
  }
  return emTransacao(banco, async (cliente) => {
    const { rows } = await cliente.query(
      `SELECT k.hash, k.conexao_id, k.client_id, k.redirect_uri, k.code_challenge,
              k.usado_em, k.expira_em > now() AS vigente,
              x.usuario_id, x.unidade_id, x.escopos, x.revogada_em
         FROM mcp.codigo_autorizacao k
         JOIN mcp.conexao x ON x.id = k.conexao_id
        WHERE k.hash = $1
          FOR UPDATE OF k`,
      [impressaoDigital(pedido.codigo)],
    );
    const linha = rows[0];
    if (!linha) return falha("Código inválido ou expirado.");

    if (linha.usado_em) {
      await revogarNaTransacao(cliente, linha.conexao_id, "código reutilizado");
      return falha("Este código já foi usado.");
    }
    // Qualquer tentativa queima o código: ele não serve para tentar de novo.
    await cliente.query(
      "UPDATE mcp.codigo_autorizacao SET usado_em = now() WHERE hash = $1",
      [linha.hash],
    );
    if (!linha.vigente || linha.revogada_em) {
      return falha("Código inválido ou expirado.");
    }
    if (
      linha.client_id !== pedido.clientId ||
      linha.redirect_uri !== pedido.redirectUri
    ) {
      return falha("O código não pertence a este cliente ou retorno.");
    }
    if (!pkceConfere(pedido.verificador, linha.code_challenge)) {
      return falha("A verificação PKCE não confere.");
    }
    if (!(await podeContinuar(cliente, linha.usuario_id, linha.unidade_id))) {
      await revogarNaTransacao(cliente, linha.conexao_id, "sem permissão");
      return falha("A conta não tem mais permissão para esta loja.");
    }
    return {
      ok: true,
      chaves: await emitirPar(cliente, linha.conexao_id, linha.escopos),
    };
  });
}

export async function renovar(
  banco: Banco,
  pedido: { refreshToken: string; clientId: string },
): Promise<ResultadoDaTroca> {
  if (!ehDoTipo(pedido.refreshToken, "renovacao")) {
    return falha("Chave de renovação inválida.");
  }
  return emTransacao(banco, async (cliente) => {
    const { rows } = await cliente.query(
      `SELECT t.hash, t.conexao_id, t.substituido_em, t.expira_em > now() AS vigente,
              x.client_id, x.usuario_id, x.unidade_id, x.escopos, x.revogada_em
         FROM mcp.token t
         JOIN mcp.conexao x ON x.id = t.conexao_id
        WHERE t.hash = $1 AND t.tipo = 'renovacao'
          FOR UPDATE OF t`,
      [impressaoDigital(pedido.refreshToken)],
    );
    const linha = rows[0];
    if (!linha || linha.revogada_em) {
      return falha("Chave de renovação inválida.");
    }
    if (linha.client_id !== pedido.clientId) {
      await revogarNaTransacao(
        cliente,
        linha.conexao_id,
        "chave de renovação apresentada por outro cliente",
      );
      return falha("Chave de renovação inválida.");
    }
    if (linha.substituido_em) {
      await revogarNaTransacao(
        cliente,
        linha.conexao_id,
        "chave de renovação reutilizada",
      );
      return falha("Chave de renovação já usada.");
    }
    if (!linha.vigente) return falha("Chave de renovação expirada.");
    if (!(await podeContinuar(cliente, linha.usuario_id, linha.unidade_id))) {
      await revogarNaTransacao(cliente, linha.conexao_id, "sem permissão");
      return falha("A conta não tem mais permissão para esta loja.");
    }
    await cliente.query(
      "UPDATE mcp.token SET substituido_em = now() WHERE hash = $1",
      [linha.hash],
    );
    return {
      ok: true,
      chaves: await emitirPar(cliente, linha.conexao_id, linha.escopos),
    };
  });
}

// ---------------------------------------------------------------------------
// Verificação a cada requisição

export type ChaveValida = {
  conexaoId: string;
  clientId: string;
  escopos: string[];
  usuarioId: string;
  unidadeId: string;
  unidadeNome: string;
  expiraEm: Date;
};

/**
 * A chave vale se: existe, é de acesso, não venceu, a conexão não foi
 * revogada, foi emitida para ESTE recurso, a pessoa continua ativa e continua
 * podendo ver as vendas da loja. Tudo numa consulta só.
 */
export async function buscarChaveDeAcesso(
  banco: Banco,
  token: string,
  recurso: string,
): Promise<ChaveValida | null> {
  if (!ehDoTipo(token, "acesso")) return null;
  const { rows } = await banco.query(
    `SELECT x.id AS conexao_id, x.client_id, x.escopos, x.usuario_id,
            x.unidade_id, l.unidade_nome, t.expira_em
       FROM mcp.token t
       JOIN mcp.conexao x ON x.id = t.conexao_id AND x.revogada_em IS NULL
       JOIN mcp_leitura.usuario_login u ON u.id = x.usuario_id
       JOIN mcp_leitura.loja_com_vendas_visiveis l
         ON l.usuario_id = x.usuario_id AND l.unidade_id = x.unidade_id
      WHERE t.hash = $1
        AND t.tipo = 'acesso'
        AND t.expira_em > now()
        AND x.recurso = $2`,
    [impressaoDigital(token), recurso],
  );
  const linha = rows[0];
  if (!linha) return null;
  return {
    conexaoId: linha.conexao_id,
    clientId: linha.client_id,
    escopos: linha.escopos,
    usuarioId: linha.usuario_id,
    unidadeId: linha.unidade_id,
    unidadeNome: linha.unidade_nome,
    expiraEm: linha.expira_em,
  };
}

export async function marcarUso(
  banco: Banco,
  conexaoId: string,
): Promise<void> {
  // No máximo uma escrita por minuto por conexão: é informação, não trava.
  await banco.query(
    `UPDATE mcp.conexao SET ultimo_uso_em = now()
      WHERE id = $1
        AND (ultimo_uso_em IS NULL OR ultimo_uso_em < now() - interval '1 minute')`,
    [conexaoId],
  );
}

// ---------------------------------------------------------------------------
// Revogação

export async function revogarPorChave(
  banco: Banco,
  pedido: { token: string; clientId: string },
): Promise<void> {
  await emTransacao(banco, async (cliente) => {
    const { rows } = await cliente.query(
      `SELECT x.id FROM mcp.token t
         JOIN mcp.conexao x ON x.id = t.conexao_id
        WHERE t.hash = $1 AND x.client_id = $2`,
      [impressaoDigital(pedido.token), pedido.clientId],
    );
    if (rows[0]) {
      await revogarNaTransacao(cliente, rows[0].id, "revogada pelo cliente");
    }
  });
}

export async function revogarConexao(
  banco: Banco,
  conexaoId: string,
  motivo: string,
): Promise<void> {
  await emTransacao(banco, (cliente) =>
    revogarNaTransacao(cliente, conexaoId, motivo),
  );
}

export async function revogarConexoesDoUsuario(
  banco: Banco,
  email: string,
): Promise<number> {
  return emTransacao(banco, async (cliente) => {
    const { rows } = await cliente.query(
      `SELECT x.id FROM mcp.conexao x
         JOIN mcp_leitura.usuario_login u ON u.id = x.usuario_id
        WHERE u.email = $1 AND x.revogada_em IS NULL`,
      [email.trim().toLowerCase()],
    );
    for (const { id } of rows) {
      await revogarNaTransacao(cliente, id, "revogada pelo administrador");
    }
    return rows.length;
  });
}

export type ConexaoListada = {
  id: string;
  email: string | null;
  unidadeNome: string | null;
  clienteNome: string;
  criadaEm: Date;
  ultimoUsoEm: Date | null;
  revogadaEm: Date | null;
  motivo: string | null;
};

export async function listarConexoes(banco: Banco): Promise<ConexaoListada[]> {
  const { rows } = await banco.query(
    `SELECT x.id, u.email, l.unidade_nome, x.cliente_nome, x.criada_em,
            x.ultimo_uso_em, x.revogada_em, x.motivo_revogacao
       FROM mcp.conexao x
       LEFT JOIN mcp_leitura.usuario_login u ON u.id = x.usuario_id
       LEFT JOIN mcp_leitura.loja_com_vendas_visiveis l
         ON l.usuario_id = x.usuario_id AND l.unidade_id = x.unidade_id
      ORDER BY x.criada_em DESC
      LIMIT 100`,
  );
  return rows.map((linha) => ({
    id: linha.id,
    email: linha.email,
    unidadeNome: linha.unidade_nome,
    clienteNome: linha.cliente_nome,
    criadaEm: linha.criada_em,
    ultimoUsoEm: linha.ultimo_uso_em,
    revogadaEm: linha.revogada_em,
    motivo: linha.motivo_revogacao,
  }));
}

// ---------------------------------------------------------------------------
// Registro de uso e faxina

export async function registrarChamada(
  banco: Banco,
  chamada: ChamadaRegistrada,
): Promise<void> {
  await banco.query(
    `INSERT INTO mcp.chamada (conexao_id, ferramenta, argumentos, resultado, duracao_ms)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      chamada.conexaoId,
      chamada.ferramenta,
      JSON.stringify(chamada.argumentos),
      chamada.resultado,
      chamada.duracaoMs,
    ],
  );
}

/** Apaga o que venceu há tempo. Chaves de renovação trocadas ficam até
 * vencer: são elas que denunciam o reuso. */
export async function limparVencidos(banco: Banco): Promise<void> {
  await banco.query(`
    DELETE FROM mcp.pedido_autorizacao WHERE expira_em < now() - interval '1 hour';
    DELETE FROM mcp.codigo_autorizacao WHERE expira_em < now() - interval '1 day';
    DELETE FROM mcp.token WHERE expira_em < now() - interval '1 day';
    DELETE FROM mcp.tentativa_login WHERE criada_em < now() - interval '1 day';
  `);
}
