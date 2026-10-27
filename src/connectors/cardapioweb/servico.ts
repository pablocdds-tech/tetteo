import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { ClienteCw, urlAutorizacaoCw } from "./client";
import { configCw, ErroCw, type ConfigCw } from "./config";
import {
  cifrarCw,
  contextoCw,
  decifrarCw,
  hashCw,
  pkce,
  type EscopoCw,
} from "./seguranca";

const vigencia = () => new Date(Date.now() + 10 * 60_000);
const filtro = (scope: EscopoCw, config: ConfigCw) => ({
  organizacaoId: scope.organizacaoId,
  unidadeId: scope.unidadeId,
  ambiente: config.ambiente,
  clientId: config.clientId,
});
const contexto = (scope: EscopoCw, config: ConfigCw) =>
  contextoCw(scope, config.ambiente, config.clientId);
async function validarUnidade(scope: EscopoCw) {
  if (
    !(await db.unidade.findFirst({
      where: {
        id: scope.unidadeId,
        organizacaoId: scope.organizacaoId,
        ativa: true,
        excluidoEm: null,
        organizacao: { ativa: true, excluidoEm: null },
      },
      select: { id: true },
    }))
  )
    throw new ErroCw("unidade", "A unidade selecionada não está disponível.");
}
async function auditar(
  tx: Prisma.TransactionClient,
  scope: EscopoCw,
  id: string,
  estado: string,
) {
  await tx.auditoria.create({
    data: {
      ...scope,
      entidade: "CardapioWebConexao",
      entidadeId: id,
      acao: "ALTEROU",
      valoresDepois: { estado },
    },
  });
}
async function travar(tx: Prisma.TransactionClient, id: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`cardapioweb:${id}`}, 0))`;
}
async function limparExpiradas(scope: EscopoCw) {
  await db.cardapioWebAutorizacao.updateMany({
    where: {
      organizacaoId: scope.organizacaoId,
      unidadeId: scope.unidadeId,
      expiraEm: { lt: new Date() },
      OR: [
        { verifierCifrado: { not: null } },
        { accessCifrado: { not: null } },
      ],
    },
    data: { verifierCifrado: null, accessCifrado: null, refreshCifrado: null },
  });
}

export async function painelCw(scope: EscopoCw) {
  await validarUnidade(scope);
  const config = configCw();
  await limparExpiradas(scope);
  const [conexao, pendente] = await Promise.all([
    db.cardapioWebConexao.findFirst({
      where: filtro(scope, config),
      select: {
        id: true,
        ambiente: true,
        merchantId: true,
        merchantNome: true,
        estado: true,
        pedidos: true,
        catalogo: true,
        consultadaEm: true,
        ultimoErro: true,
      },
    }),
    db.cardapioWebAutorizacao.findFirst({
      where: {
        ...filtro(scope, config),
        usuarioId: scope.usuarioId,
        expiraEm: { gt: new Date() },
        confirmadaEm: null,
        accessCifrado: { not: null },
      },
      select: {
        id: true,
        merchantId: true,
        merchantNome: true,
        cancelando: true,
      },
      orderBy: { criadoEm: "desc" },
    }),
  ]);
  return { conexao, pendente };
}

export async function iniciarCw(scope: EscopoCw) {
  await validarUnidade(scope);
  const config = configCw();
  await limparExpiradas(scope);
  const tentativa = pkce();
  await db.$transaction(async (tx) => {
    await travar(tx, contexto(scope, config));
    const existente = await tx.cardapioWebConexao.findFirst({
      where: filtro(scope, config),
    });
    if (existente && ["ATIVA", "REVOGANDO"].includes(existente.estado))
      throw new ErroCw(
        "conexao",
        "Desconecte a conexão atual antes de autorizar outra loja.",
      );
    if (
      await tx.cardapioWebAutorizacao.findFirst({
        where: {
          ...filtro(scope, config),
          usuarioId: scope.usuarioId,
          expiraEm: { gt: new Date() },
          accessCifrado: { not: null },
        },
      })
    )
      throw new ErroCw(
        "pendente",
        "Confira ou cancele a autorização pendente antes de recomeçar.",
      );
    const recentes = await tx.cardapioWebAutorizacao.count({
      where: {
        ...filtro(scope, config),
        usuarioId: scope.usuarioId,
        criadoEm: { gt: new Date(Date.now() - 60_000) },
      },
    });
    if (recentes >= 3)
      throw new ErroCw(
        "limite",
        "Aguarde um minuto antes de iniciar outra autorização.",
      );
    const criada = await tx.cardapioWebAutorizacao.create({
      data: {
        ...filtro(scope, config),
        usuarioId: scope.usuarioId,
        redirectUri: config.redirectUri,
        stateHash: hashCw(tentativa.state),
        verifierCifrado: cifrarCw(tentativa.verifier, contexto(scope, config)),
        expiraEm: vigencia(),
      },
    });
    await auditar(tx, scope, criada.id, "AUTORIZACAO_INICIADA");
  });
  return {
    state: tentativa.state,
    url: urlAutorizacaoCw(config, tentativa.state, tentativa.challenge),
  };
}

export async function receberCw(scope: EscopoCw, state: string, code: string) {
  await validarUnidade(scope);
  const config = configCw();
  const tentativa = await db.cardapioWebAutorizacao.findFirst({
    where: {
      ...filtro(scope, config),
      usuarioId: scope.usuarioId,
      stateHash: hashCw(state),
      redirectUri: config.redirectUri,
      expiraEm: { gt: new Date() },
      consumidaEm: null,
    },
  });
  if (!tentativa?.verifierCifrado)
    throw new ErroCw(
      "state",
      "A autorização expirou ou já foi usada. Reinicie a conexão.",
    );
  const verifier = decifrarCw(
    tentativa.verifierCifrado,
    contexto(scope, config),
  );
  const consumo = await db.cardapioWebAutorizacao.updateMany({
    where: {
      id: tentativa.id,
      consumidaEm: null,
      expiraEm: { gt: new Date() },
    },
    data: { consumidaEm: new Date(), verifierCifrado: null },
  });
  if (consumo.count !== 1)
    throw new ErroCw(
      "state",
      "Esta autorização já foi usada. Reinicie a conexão.",
    );
  const client = new ClienteCw(config);
  const token = await client.token({
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
    redirect_uri: config.redirectUri,
  });
  const escopos = new Set(token.scope.split(/\s+/));
  if (
    !token.refresh_token ||
    !["store", "orders", "catalog"].every((e) => escopos.has(e))
  )
    throw new ErroCw(
      "escopo",
      "Solicite os escopos store, orders e catalog no cadastro do aplicativo e autorize novamente.",
    );
  const loja = await client.loja(token.access_token);
  const salva = await db.cardapioWebAutorizacao.updateMany({
    where: {
      id: tentativa.id,
      expiraEm: { gt: new Date() },
      confirmadaEm: null,
    },
    data: {
      merchantId: loja.id,
      merchantNome: loja.name,
      accessCifrado: cifrarCw(token.access_token, contexto(scope, config)),
      refreshCifrado: cifrarCw(token.refresh_token, contexto(scope, config)),
      tokenExpiraEm: new Date(Date.now() + token.expires_in * 1000),
      escopos: token.scope,
    },
  });
  if (salva.count !== 1)
    throw new ErroCw("state", "A autorização expirou. Reinicie a conexão.");
}

export async function confirmarCw(scope: EscopoCw, id: string) {
  await validarUnidade(scope);
  const config = configCw();
  await db.$transaction(async (tx) => {
    await travar(tx, contexto(scope, config));
    const tentativa = await tx.cardapioWebAutorizacao.findFirst({
      where: {
        ...filtro(scope, config),
        id,
        usuarioId: scope.usuarioId,
        expiraEm: { gt: new Date() },
        tokenExpiraEm: { gt: new Date() },
        confirmadaEm: null,
        cancelando: false,
      },
    });
    if (
      !tentativa?.accessCifrado ||
      !tentativa.refreshCifrado ||
      !tentativa.merchantId ||
      !tentativa.merchantNome ||
      !tentativa.tokenExpiraEm ||
      !tentativa.escopos
    )
      throw new ErroCw(
        "state",
        "A autorização não está pronta ou expirou. Reinicie a conexão.",
      );
    await travar(
      tx,
      `${config.ambiente}:${config.clientId}:${tentativa.merchantId}`,
    );
    const ocupada = await tx.cardapioWebConexao.findFirst({
      where: {
        ambiente: config.ambiente,
        clientId: config.clientId,
        merchantId: tentativa.merchantId,
      },
    });
    if (
      ocupada &&
      (ocupada.unidadeId !== scope.unidadeId ||
        ocupada.organizacaoId !== scope.organizacaoId)
    )
      throw new ErroCw(
        "vinculo",
        "Essa loja Cardápio Web já está vinculada. Revise o vínculo com o administrador.",
      );
    const anterior = await tx.cardapioWebConexao.findFirst({
      where: filtro(scope, config),
    });
    if (anterior && ["ATIVA", "REVOGANDO"].includes(anterior.estado))
      throw new ErroCw(
        "conexao",
        "A unidade já possui uma conexão. Desconecte antes de substituí-la.",
      );
    const dados = {
      merchantId: tentativa.merchantId,
      merchantNome: tentativa.merchantNome,
      estado: "ATIVA",
      accessCifrado: tentativa.accessCifrado,
      refreshCifrado: tentativa.refreshCifrado,
      expiraEm: tentativa.tokenExpiraEm,
      escopos: tentativa.escopos,
      conectadaEm: new Date(),
      desconectadaEm: null,
      ultimoErro: null,
      consultadaEm: null,
      tentativaEm: null,
      ocupadaAte: null,
      pedidos: Prisma.DbNull,
      catalogo: Prisma.DbNull,
    };
    const conexao = anterior
      ? await tx.cardapioWebConexao.update({
          where: { id: anterior.id },
          data: { ...dados, revisao: { increment: 1 } },
        })
      : await tx.cardapioWebConexao.create({
          data: { ...filtro(scope, config), ...dados },
        });
    await tx.cardapioWebAutorizacao.update({
      where: { id },
      data: {
        confirmadaEm: new Date(),
        accessCifrado: null,
        refreshCifrado: null,
      },
    });
    await auditar(tx, scope, conexao.id, "CONECTADA");
  });
}

async function accessToken(
  scope: EscopoCw,
  config: ConfigCw,
  id: string,
  revisao: number,
) {
  const resultado = await db.$transaction(
    async (tx) => {
      await travar(tx, id);
      const row = await tx.cardapioWebConexao.findFirst({
        where: { ...filtro(scope, config), id, revisao, estado: "ATIVA" },
      });
      if (!row?.accessCifrado)
        throw new ErroCw(
          "reconectar",
          "Conecte a loja Cardápio Web novamente.",
        );
      if (row.expiraEm.getTime() > Date.now() + 90_000)
        return {
          token: decifrarCw(row.accessCifrado, contexto(scope, config)),
        };
      try {
        if (!row.refreshCifrado)
          throw new ErroCw(
            "reconectar",
            "Conecte a loja Cardápio Web novamente.",
          );
        const renovado = await new ClienteCw(config).token({
          grant_type: "refresh_token",
          refresh_token: decifrarCw(
            row.refreshCifrado,
            contexto(scope, config),
          ),
        });
        await tx.cardapioWebConexao.update({
          where: { id },
          data: {
            accessCifrado: cifrarCw(
              renovado.access_token,
              contexto(scope, config),
            ),
            refreshCifrado: renovado.refresh_token
              ? cifrarCw(renovado.refresh_token, contexto(scope, config))
              : row.refreshCifrado,
            expiraEm: new Date(Date.now() + renovado.expires_in * 1000),
            escopos: renovado.scope,
          },
        });
        return { token: renovado.access_token };
      } catch (erro) {
        if (!(erro instanceof ErroCw) || erro.codigo !== "reconectar")
          throw erro;
        await tx.cardapioWebConexao.update({
          where: { id },
          data: {
            estado: "RECONECTAR",
            accessCifrado: null,
            refreshCifrado: null,
          },
        });
        await auditar(tx, scope, id, "RECONECTAR");
        return { erro };
      }
    },
    { timeout: 15_000, maxWait: 5000 },
  );
  // A renovação é confirmada no banco ANTES das consultas, mesmo se uma delas falhar.
  if (resultado.erro) throw resultado.erro;
  return resultado.token!;
}

export async function consultarCw(scope: EscopoCw) {
  await validarUnidade(scope);
  const config = configCw();
  const row = await db.cardapioWebConexao.findFirst({
    where: { ...filtro(scope, config), estado: "ATIVA" },
  });
  if (!row)
    throw new ErroCw(
      "reconectar",
      "Autorize e confirme a loja antes de consultar.",
    );
  const agora = new Date();
  const reserva = await db.cardapioWebConexao.updateMany({
    where: {
      id: row.id,
      estado: "ATIVA",
      revisao: row.revisao,
      AND: [
        { OR: [{ ocupadaAte: null }, { ocupadaAte: { lt: agora } }] },
        {
          OR: [
            { tentativaEm: null },
            { tentativaEm: { lt: new Date(Date.now() - 60_000) } },
          ],
        },
      ],
    },
    data: { tentativaEm: agora, ocupadaAte: new Date(Date.now() + 45_000) },
  });
  if (reserva.count !== 1)
    throw new ErroCw(
      "limite",
      "Aguarde um minuto entre as consultas desta unidade.",
    );
  try {
    const token = await accessToken(scope, config, row.id, row.revisao);
    const client = new ClienteCw(config);
    const loja = await client.loja(token);
    if (loja.id !== row.merchantId)
      throw new ErroCw(
        "reconectar",
        "A identidade da loja mudou. Conecte e confira a unidade novamente.",
      );
    const [pedidos, catalogo] = await Promise.all([
      client.pedidos(token),
      client.catalogo(token),
    ]);
    await db.$transaction(async (tx) => {
      const salvo = await tx.cardapioWebConexao.updateMany({
        where: { id: row.id, revisao: row.revisao, estado: "ATIVA" },
        data: {
          pedidos,
          catalogo,
          consultadaEm: new Date(),
          ocupadaAte: null,
          ultimoErro: null,
        },
      });
      if (salvo.count !== 1)
        throw new ErroCw(
          "conexao",
          "A conexão mudou durante a consulta. Atualize a página.",
        );
      await auditar(tx, scope, row.id, "CONSULTADA");
    });
  } catch (erro) {
    const codigo = erro instanceof ErroCw ? erro.codigo : "interno";
    await db.$transaction(async (tx) => {
      const salva = await tx.cardapioWebConexao.updateMany({
        where: { id: row.id, revisao: row.revisao, estado: "ATIVA" },
        data: {
          ocupadaAte: null,
          ultimoErro: codigo,
          ...(codigo === "reconectar"
            ? {
                estado: "RECONECTAR",
                accessCifrado: null,
                refreshCifrado: null,
              }
            : {}),
        },
      });
      if (salva.count)
        await auditar(tx, scope, row.id, `CONSULTA_FALHOU:${codigo}`);
    });
    throw erro;
  }
}

export async function desconectarCw(scope: EscopoCw) {
  await validarUnidade(scope);
  const config = configCw();
  const row = await db.$transaction(async (tx) => {
    const atual = await tx.cardapioWebConexao.findFirst({
      where: filtro(scope, config),
    });
    if (!atual || atual.estado === "DESCONECTADA")
      throw new ErroCw("conexao", "Esta unidade já está desconectada.");
    await travar(tx, atual.id);
    const travada = await tx.cardapioWebConexao.findUniqueOrThrow({
      where: { id: atual.id },
    });
    if (travada.estado === "DESCONECTADA")
      throw new ErroCw("conexao", "Esta unidade já está desconectada.");
    if (
      travada.estado === "REVOGANDO" &&
      travada.ocupadaAte &&
      travada.ocupadaAte > new Date()
    )
      throw new ErroCw("limite", "A revogação já está em andamento.");
    await tx.cardapioWebConexao.update({
      where: { id: atual.id },
      data: {
        estado: "REVOGANDO",
        revisao: { increment: 1 },
        ocupadaAte: new Date(Date.now() + 45_000),
      },
    });
    await auditar(tx, scope, atual.id, "REVOGACAO_SOLICITADA");
    return travada;
  });
  const client = new ClienteCw(config);
  if (row.accessCifrado)
    await client.revogar(
      decifrarCw(row.accessCifrado, contexto(scope, config)),
    );
  if (row.refreshCifrado)
    await client.revogar(
      decifrarCw(row.refreshCifrado, contexto(scope, config)),
    );
  await db.$transaction(async (tx) => {
    const salva = await tx.cardapioWebConexao.updateMany({
      where: { id: row.id, estado: "REVOGANDO", revisao: row.revisao + 1 },
      data: {
        estado: "DESCONECTADA",
        accessCifrado: null,
        refreshCifrado: null,
        desconectadaEm: new Date(),
        ultimoErro: null,
        ocupadaAte: null,
      },
    });
    if (salva.count) await auditar(tx, scope, row.id, "DESCONECTADA");
  });
}

export async function cancelarCw(scope: EscopoCw, id: string) {
  await validarUnidade(scope);
  const config = configCw();
  const row = await db.$transaction(async (tx) => {
    await travar(tx, contexto(scope, config));
    const tentativa = await tx.cardapioWebAutorizacao.findFirst({
      where: {
        ...filtro(scope, config),
        id,
        usuarioId: scope.usuarioId,
        confirmadaEm: null,
        expiraEm: { gt: new Date() },
      },
    });
    if (!tentativa)
      throw new ErroCw("state", "A autorização pendente expirou.");
    await tx.cardapioWebAutorizacao.update({
      where: { id },
      data: { cancelando: true },
    });
    await auditar(tx, scope, id, "AUTORIZACAO_CANCELADA");
    return tentativa;
  });
  const client = new ClienteCw(config);
  if (row.accessCifrado)
    await client.revogar(
      decifrarCw(row.accessCifrado, contexto(scope, config)),
    );
  if (row.refreshCifrado)
    await client.revogar(
      decifrarCw(row.refreshCifrado, contexto(scope, config)),
    );
  await db.cardapioWebAutorizacao.update({
    where: { id },
    data: {
      confirmadaEm: new Date(),
      accessCifrado: null,
      refreshCifrado: null,
      verifierCifrado: null,
    },
  });
}
