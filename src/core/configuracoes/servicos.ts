import bcrypt from "bcryptjs";

import { pode, type ContextoSessao } from "@/core/sessao/contexto";
import { SemPermissao } from "@/lib/erros";
import { db } from "@/server/db";

import { CORINGA } from "./permissoes";
import type {
  DadosNovoUsuario,
  DadosOrganizacao,
  DadosPapel,
  DadosUnidade,
} from "./schemas";
import {
  verificarDesativacaoDeUnidade,
  verificarEdicaoDePapel,
  verificarExclusaoDePapel,
  verificarRemocaoDeAcesso,
  verificarTrocaDePapel,
  type AcessoParaTrava,
} from "./travas";

/**
 * AS REGRAS DAS CONFIGURAÇÕES.
 *
 * Tudo aqui é escopado pela organização do contexto. Nenhuma função recebe um
 * `organizacaoId` de fora — se recebesse, bastaria trocar um id na requisição
 * para editar a rede do vizinho.
 *
 * As decisões que podem trancar alguém fora do sistema não moram aqui: moram
 * em `travas.ts`, puras e testadas. Este arquivo só busca o estado, pergunta à
 * trava, e grava.
 */

/** O custo de hash. 12 é o padrão atual: caro o bastante, rápido o bastante. */
const CUSTO_BCRYPT = 12;

function exigirVer(contexto: ContextoSessao) {
  if (!pode(contexto, "configuracoes.ver")) {
    throw new SemPermissao("ver as configurações");
  }
}

function exigirEditar(contexto: ContextoSessao) {
  if (!pode(contexto, "configuracoes.editar")) {
    throw new SemPermissao("alterar as configurações");
  }
}

// ---------------------------------------------------------------------------
// ORGANIZAÇÃO
// ---------------------------------------------------------------------------

export async function obterOrganizacao(contexto: ContextoSessao) {
  exigirVer(contexto);

  return db.organizacao.findUnique({
    where: { id: contexto.organizacao.id },
    select: {
      id: true,
      nome: true,
      documento: true,
      fusoHorario: true,
      moeda: true,
      criadoEm: true,
    },
  });
}

export async function salvarOrganizacao(
  contexto: ContextoSessao,
  dados: DadosOrganizacao,
) {
  exigirEditar(contexto);

  const anterior = await obterOrganizacao(contexto);

  await db.organizacao.update({
    where: { id: contexto.organizacao.id },
    data: { nome: dados.nome, documento: dados.documento || null },
  });

  await auditar(
    contexto,
    "ALTEROU",
    "Organizacao",
    contexto.organizacao.id,
    {
      nome: anterior?.nome,
      documento: anterior?.documento,
    },
    dados,
  );
}

// ---------------------------------------------------------------------------
// UNIDADES
// ---------------------------------------------------------------------------

export async function listarUnidades(contexto: ContextoSessao) {
  exigirVer(contexto);

  return db.unidade.findMany({
    where: { organizacaoId: contexto.organizacao.id, excluidoEm: null },
    orderBy: [{ ativa: "desc" }, { nome: "asc" }],
    select: {
      id: true,
      nome: true,
      codigo: true,
      documento: true,
      cidade: true,
      estado: true,
      telefone: true,
      ativa: true,
      _count: { select: { acessos: true } },
    },
  });
}

export async function criarUnidade(
  contexto: ContextoSessao,
  dados: DadosUnidade,
) {
  exigirEditar(contexto);

  const unidade = await db.unidade.create({
    data: {
      organizacaoId: contexto.organizacao.id,
      nome: dados.nome,
      codigo: dados.codigo,
      documento: dados.documento || null,
      cidade: dados.cidade || null,
      estado: dados.estado || null,
      telefone: dados.telefone || null,
    },
  });

  await auditar(contexto, "CRIOU", "Unidade", unidade.id, null, dados);
  return unidade;
}

export async function atualizarUnidade(
  contexto: ContextoSessao,
  id: string,
  dados: DadosUnidade,
) {
  exigirEditar(contexto);

  const anterior = await db.unidade.findFirst({
    where: { id, organizacaoId: contexto.organizacao.id, excluidoEm: null },
  });
  if (!anterior) throw new Error("Unidade não encontrada.");

  await db.unidade.update({
    where: { id },
    data: {
      nome: dados.nome,
      codigo: dados.codigo,
      documento: dados.documento || null,
      cidade: dados.cidade || null,
      estado: dados.estado || null,
      telefone: dados.telefone || null,
    },
  });

  await auditar(
    contexto,
    "ALTEROU",
    "Unidade",
    id,
    { nome: anterior.nome, codigo: anterior.codigo },
    dados,
  );
}

/**
 * Liga e desliga a loja.
 *
 * Não exclui: o histórico de contagens, notas e CMV daquela loja continua
 * inteiro e consultável. Ela só some do seletor e das listas.
 */
export async function alternarUnidade(contexto: ContextoSessao, id: string) {
  exigirEditar(contexto);

  const unidade = await db.unidade.findFirst({
    where: { id, organizacaoId: contexto.organizacao.id, excluidoEm: null },
    select: { id: true, ativa: true, nome: true },
  });
  if (!unidade) throw new Error("Unidade não encontrada.");

  if (unidade.ativa) {
    const ativas = await db.unidade.count({
      where: {
        organizacaoId: contexto.organizacao.id,
        excluidoEm: null,
        ativa: true,
      },
    });
    const impedimento = verificarDesativacaoDeUnidade(ativas);
    if (impedimento) throw new Error(impedimento);
  }

  await db.unidade.update({
    where: { id },
    data: { ativa: !unidade.ativa },
  });

  await auditar(
    contexto,
    "ALTEROU",
    "Unidade",
    id,
    { ativa: unidade.ativa },
    { ativa: !unidade.ativa },
  );
}

// ---------------------------------------------------------------------------
// PAPÉIS
// ---------------------------------------------------------------------------

export async function listarPapeis(contexto: ContextoSessao) {
  exigirVer(contexto);

  const papeis = await db.papel.findMany({
    where: { organizacaoId: contexto.organizacao.id },
    orderBy: [{ ehSistema: "desc" }, { nome: "asc" }],
    include: {
      permissoes: { select: { chave: true } },
      _count: { select: { acessos: true } },
    },
  });

  return papeis.map((p) => ({
    id: p.id,
    nome: p.nome,
    descricao: p.descricao,
    /** Veio com o sistema — não se exclui. Vale para os cinco papéis do seed. */
    ehSistema: p.ehSistema,
    /** É o DONO — não pode perder o acesso total. Só o Diretor. */
    temCoringa: p.permissoes.some((x) => x.chave === CORINGA),
    permissoes: p.permissoes.map((x) => x.chave),
    pessoas: p._count.acessos,
  }));
}

export async function obterPapel(contexto: ContextoSessao, id: string) {
  exigirVer(contexto);

  const papel = await db.papel.findFirst({
    where: { id, organizacaoId: contexto.organizacao.id },
    include: { permissoes: { select: { chave: true } } },
  });
  if (!papel) return null;

  return {
    id: papel.id,
    nome: papel.nome,
    descricao: papel.descricao,
    ehSistema: papel.ehSistema,
    temCoringa: papel.permissoes.some((p) => p.chave === CORINGA),
    permissoes: papel.permissoes.map((p) => p.chave),
  };
}

export async function criarPapel(contexto: ContextoSessao, dados: DadosPapel) {
  exigirEditar(contexto);

  const papel = await db.papel.create({
    data: {
      organizacaoId: contexto.organizacao.id,
      nome: dados.nome,
      descricao: dados.descricao || null,
      permissoes: {
        createMany: {
          data: dados.permissoes.map((chave) => ({ chave })),
          skipDuplicates: true,
        },
      },
    },
  });

  await auditar(contexto, "CRIOU", "Papel", papel.id, null, dados);
  return papel;
}

/**
 * Salva as permissões de um papel.
 *
 * Apaga e regrava em vez de comparar: a lista é pequena (dezenas), a operação
 * é rara, e o código que calcula diferença é onde mora o bug que dá acesso a
 * quem não devia.
 */
export async function salvarPapel(
  contexto: ContextoSessao,
  id: string,
  dados: DadosPapel,
) {
  exigirEditar(contexto);

  const papel = await db.papel.findFirst({
    where: { id, organizacaoId: contexto.organizacao.id },
    include: { permissoes: { select: { chave: true } } },
  });
  if (!papel) throw new Error("Papel não encontrado.");

  const temCoringa = papel.permissoes.some((p) => p.chave === CORINGA);

  const impedimento = verificarEdicaoDePapel(
    { nome: papel.nome, temCoringa },
    dados.permissoes,
  );
  if (impedimento) throw new Error(impedimento);

  await db.$transaction([
    db.papelPermissao.deleteMany({ where: { papelId: id } }),
    db.papelPermissao.createMany({
      data: dados.permissoes.map((chave) => ({ papelId: id, chave })),
      skipDuplicates: true,
    }),
    db.papel.update({
      where: { id },
      data: {
        // O nome do papel DONO é fixo: gente que aprendeu "peça ao Diretor"
        // continuaria pedindo ao Diretor. Os outros podem ser renomeados —
        // "Cozinha" vira "Pizzaiolo" se for assim que a casa fala.
        ...(temCoringa ? {} : { nome: dados.nome }),
        descricao: dados.descricao || null,
      },
    }),
  ]);

  await auditar(
    contexto,
    "ALTEROU",
    "Papel",
    id,
    { nome: papel.nome, permissoes: papel.permissoes.map((p) => p.chave) },
    dados,
  );
}

export async function excluirPapel(contexto: ContextoSessao, id: string) {
  exigirEditar(contexto);

  const papel = await db.papel.findFirst({
    where: { id, organizacaoId: contexto.organizacao.id },
    include: { _count: { select: { acessos: true } } },
  });
  if (!papel) throw new Error("Papel não encontrado.");

  const impedimento = verificarExclusaoDePapel(papel, papel._count.acessos);
  if (impedimento) throw new Error(impedimento);

  await db.papel.delete({ where: { id } });
  await auditar(contexto, "EXCLUIU", "Papel", id, { nome: papel.nome }, null);
}

// ---------------------------------------------------------------------------
// PESSOAS E ACESSOS
// ---------------------------------------------------------------------------

export async function listarPessoas(contexto: ContextoSessao) {
  exigirVer(contexto);

  const acessos = await db.acesso.findMany({
    where: { organizacaoId: contexto.organizacao.id, excluidoEm: null },
    include: {
      usuario: {
        select: {
          id: true,
          nome: true,
          email: true,
          status: true,
          ultimoAcessoEm: true,
        },
      },
      unidade: { select: { id: true, nome: true } },
      papel: {
        select: {
          id: true,
          nome: true,
          ehSistema: true,
          permissoes: { select: { chave: true } },
        },
      },
    },
    orderBy: { criadoEm: "asc" },
  });

  return acessos.map((a) => ({
    acessoId: a.id,
    usuarioId: a.usuario.id,
    nome: a.usuario.nome,
    email: a.usuario.email,
    statusUsuario: a.usuario.status,
    ultimoAcessoEm: a.usuario.ultimoAcessoEm,
    status: a.status,
    papel: { id: a.papel.id, nome: a.papel.nome },
    /** Nulo = a rede inteira. */
    unidade: a.unidade,
    ehDono: a.papel.permissoes.some((p) => p.chave === CORINGA),
    ehVoce: a.usuario.id === contexto.usuario.id,
  }));
}

/** O retrato que as travas precisam para decidir. */
async function acessosParaTrava(
  contexto: ContextoSessao,
): Promise<AcessoParaTrava[]> {
  const acessos = await db.acesso.findMany({
    where: { organizacaoId: contexto.organizacao.id, excluidoEm: null },
    select: {
      id: true,
      usuarioId: true,
      status: true,
      papel: { select: { permissoes: { select: { chave: true } } } },
    },
  });

  return acessos.map((a) => ({
    id: a.id,
    usuarioId: a.usuarioId,
    status: a.status,
    papelTemCoringa: a.papel.permissoes.some((p) => p.chave === CORINGA),
  }));
}

/**
 * Cria a conta de alguém da equipe.
 *
 * Não manda e-mail: não existe serviço de envio ainda, e prometer um convite
 * que nunca chega é pior do que não prometer. A senha é definida aqui e
 * entregue pelo dono — que é como funciona numa pizzaria de verdade.
 *
 * Se a pessoa JÁ tem conta (trabalhou em outra loja da rede), reaproveita o
 * usuário e cria só o acesso novo. Duas contas para a mesma pessoa é o começo
 * de "não sei mais quem é quem".
 */
export async function criarPessoa(
  contexto: ContextoSessao,
  dados: DadosNovoUsuario,
) {
  exigirEditar(contexto);

  const papel = await db.papel.findFirst({
    where: { id: dados.papelId, organizacaoId: contexto.organizacao.id },
    select: { id: true },
  });
  if (!papel) throw new Error("Papel não encontrado nesta rede.");

  if (dados.unidadeId) {
    const unidade = await db.unidade.findFirst({
      where: {
        id: dados.unidadeId,
        organizacaoId: contexto.organizacao.id,
        excluidoEm: null,
      },
      select: { id: true },
    });
    if (!unidade) throw new Error("Unidade não encontrada nesta rede.");
  }

  const senhaHash = await bcrypt.hash(dados.senha, CUSTO_BCRYPT);

  const usuario = await db.usuario.upsert({
    where: { email: dados.email },
    create: {
      nome: dados.nome,
      email: dados.email,
      senhaHash,
      status: "ATIVO",
    },
    // Quem já existia mantém a própria senha: o dono de uma loja não pode
    // trocar a senha de alguém sem querer, só cadastrando de novo.
    update: { status: "ATIVO", excluidoEm: null },
    select: { id: true, nome: true },
  });

  const jaTem = await db.acesso.findFirst({
    where: {
      usuarioId: usuario.id,
      organizacaoId: contexto.organizacao.id,
      unidadeId: dados.unidadeId,
    },
    select: { id: true },
  });
  if (jaTem) {
    throw new Error(
      "Essa pessoa já tem acesso a essa unidade. Use o botão de trocar o papel na lista.",
    );
  }

  const acesso = await db.acesso.create({
    data: {
      usuarioId: usuario.id,
      organizacaoId: contexto.organizacao.id,
      unidadeId: dados.unidadeId,
      papelId: dados.papelId,
      concedidoPorId: contexto.usuario.id,
    },
  });

  await auditar(contexto, "CRIOU", "Acesso", acesso.id, null, {
    usuario: dados.email,
    papelId: dados.papelId,
    unidadeId: dados.unidadeId,
  });

  return { usuarioId: usuario.id, acessoId: acesso.id };
}

export async function trocarPapelDoAcesso(
  contexto: ContextoSessao,
  acessoId: string,
  papelId: string,
) {
  exigirEditar(contexto);

  const [alvo, todos, novoPapel] = await Promise.all([
    db.acesso.findFirst({
      where: {
        id: acessoId,
        organizacaoId: contexto.organizacao.id,
        excluidoEm: null,
      },
      select: {
        id: true,
        usuarioId: true,
        status: true,
        papel: {
          select: {
            id: true,
            nome: true,
            permissoes: { select: { chave: true } },
          },
        },
      },
    }),
    acessosParaTrava(contexto),
    db.papel.findFirst({
      where: { id: papelId, organizacaoId: contexto.organizacao.id },
      select: { id: true, nome: true, permissoes: { select: { chave: true } } },
    }),
  ]);

  if (!alvo) throw new Error("Acesso não encontrado.");
  if (!novoPapel) throw new Error("Papel não encontrado nesta rede.");

  const impedimento = verificarTrocaDePapel(
    {
      id: alvo.id,
      usuarioId: alvo.usuarioId,
      status: alvo.status,
      papelTemCoringa: alvo.papel.permissoes.some((p) => p.chave === CORINGA),
    },
    novoPapel.permissoes.some((p) => p.chave === CORINGA),
    contexto.usuario.id,
    todos,
  );
  if (impedimento) throw new Error(impedimento);

  await db.acesso.update({ where: { id: acessoId }, data: { papelId } });

  await auditar(
    contexto,
    "ALTEROU",
    "Acesso",
    acessoId,
    { papel: alvo.papel.nome },
    { papel: novoPapel.nome },
  );
}

/** Suspende ou reativa o acesso — a forma reversível de tirar alguém. */
export async function alternarAcesso(
  contexto: ContextoSessao,
  acessoId: string,
) {
  exigirEditar(contexto);

  const [alvo, todos] = await Promise.all([
    db.acesso.findFirst({
      where: {
        id: acessoId,
        organizacaoId: contexto.organizacao.id,
        excluidoEm: null,
      },
      select: {
        id: true,
        usuarioId: true,
        status: true,
        papel: { select: { permissoes: { select: { chave: true } } } },
      },
    }),
    acessosParaTrava(contexto),
  ]);
  if (!alvo) throw new Error("Acesso não encontrado.");

  const retrato: AcessoParaTrava = {
    id: alvo.id,
    usuarioId: alvo.usuarioId,
    status: alvo.status,
    papelTemCoringa: alvo.papel.permissoes.some((p) => p.chave === CORINGA),
  };

  // Reativar nunca tranca ninguém; só suspender precisa passar pela trava.
  if (alvo.status === "ATIVO") {
    const impedimento = verificarRemocaoDeAcesso(
      retrato,
      contexto.usuario.id,
      todos,
    );
    if (impedimento) throw new Error(impedimento);
  }

  const novo = alvo.status === "ATIVO" ? "SUSPENSO" : "ATIVO";
  await db.acesso.update({ where: { id: acessoId }, data: { status: novo } });

  await auditar(
    contexto,
    "ALTEROU",
    "Acesso",
    acessoId,
    { status: alvo.status },
    { status: novo },
  );
}

/**
 * Define uma senha nova para alguém.
 *
 * Quem esquece a senha numa pizzaria não abre chamado: fala com o dono. Esta é
 * a saída — e ela fica registrada na auditoria, com quem fez e quando, porque
 * poder trocar a senha dos outros é poder entrar como eles.
 */
export async function redefinirSenha(
  contexto: ContextoSessao,
  usuarioId: string,
  senha: string,
) {
  exigirEditar(contexto);

  const alvo = await db.acesso.findFirst({
    where: {
      usuarioId,
      organizacaoId: contexto.organizacao.id,
      excluidoEm: null,
    },
    select: { usuario: { select: { id: true, email: true } } },
  });
  if (!alvo) throw new Error("Essa pessoa não tem acesso a esta rede.");

  await db.usuario.update({
    where: { id: usuarioId },
    data: { senhaHash: await bcrypt.hash(senha, CUSTO_BCRYPT) },
  });

  // A senha NUNCA entra na auditoria — nem o valor, nem o tamanho.
  await auditar(contexto, "ALTEROU", "Usuario", usuarioId, null, {
    acao: "senha redefinida",
    email: alvo.usuario.email,
  });
}

// ---------------------------------------------------------------------------
// AUDITORIA
// ---------------------------------------------------------------------------

export async function listarAuditoria(
  contexto: ContextoSessao,
  filtro: { entidade?: string; pagina?: number } = {},
) {
  if (!pode(contexto, "configuracoes.auditoria")) {
    throw new SemPermissao("ver o histórico de alterações");
  }

  const porPagina = 50;
  const pagina = Math.max(1, filtro.pagina ?? 1);

  const [linhas, total] = await Promise.all([
    db.auditoria.findMany({
      where: {
        organizacaoId: contexto.organizacao.id,
        ...(filtro.entidade ? { entidade: filtro.entidade } : {}),
      },
      include: { usuario: { select: { nome: true, email: true } } },
      orderBy: { quando: "desc" },
      skip: (pagina - 1) * porPagina,
      take: porPagina,
    }),
    db.auditoria.count({
      where: {
        organizacaoId: contexto.organizacao.id,
        ...(filtro.entidade ? { entidade: filtro.entidade } : {}),
      },
    }),
  ]);

  return { linhas, total, pagina, porPagina };
}

/** As entidades que já apareceram — para o filtro não listar o que não existe. */
export async function entidadesAuditadas(contexto: ContextoSessao) {
  if (!pode(contexto, "configuracoes.auditoria")) return [];

  const linhas = await db.auditoria.findMany({
    where: { organizacaoId: contexto.organizacao.id },
    select: { entidade: true },
    distinct: ["entidade"],
    orderBy: { entidade: "asc" },
  });
  return linhas.map((l) => l.entidade);
}

async function auditar(
  contexto: ContextoSessao,
  acao: "CRIOU" | "ALTEROU" | "EXCLUIU",
  entidade: string,
  entidadeId: string,
  antes: unknown,
  depois: unknown,
) {
  await db.auditoria.create({
    data: {
      organizacaoId: contexto.organizacao.id,
      unidadeId: contexto.unidadeAtiva?.id ?? null,
      usuarioId: contexto.usuario.id,
      entidade,
      entidadeId,
      acao,
      valoresAntes:
        antes === null ? undefined : JSON.parse(JSON.stringify(antes)),
      valoresDepois:
        depois === null ? undefined : JSON.parse(JSON.stringify(depois)),
    },
  });
}
