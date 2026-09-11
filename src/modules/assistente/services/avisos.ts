import type { Prisma } from "@prisma/client";

import {
  contextoDeFundo,
  pode,
  type ContextoSessao,
} from "@/core/sessao/contexto";
import { SemPermissao } from "@/lib/erros";
import { mascararTelefone } from "@/lib/telefone";
import { db } from "@/server/db";

import {
  esperaAntesDaTentativa,
  esquemaRascunho,
  gerarReferencia,
  GRUPOS_DE_AVISO,
  INTERROMPIDO_APOS_MS,
  INTERVALO_ENTRE_VERIFICACOES_MS,
  MAX_TENTATIVAS_SEM_CHEGAR,
  MAX_VERIFICACOES,
  montarCorpo,
  VERIFICAR_APOS_MS,
  type GrupoDeAviso,
  type StatusAviso,
} from "../schemas/aviso";
import { INTERVALO_MS } from "../schemas/ritmo";

import { registrarAuditoria } from "./auditoria";
import { podeNaLoja } from "./conexao";
import { aplicarStatusJaRecebidos } from "./eventos";

/**
 * OS AVISOS — o OutgoingMessage do Tetteo.
 *
 * Três regras que valem para todo o arquivo:
 *
 *   1. Toda mudança de estado é CONDICIONAL: `UPDATE … WHERE status = <o que
 *      eu li>`. Duas confirmações, dois relógios, um `after()` e um relógio ao
 *      mesmo tempo — só um consegue. É isto que faz "uma confirmação, uma
 *      mensagem" valer sem trava nenhuma além do próprio banco.
 *   2. A permissão vale na LOJA DO AVISO, montada para a pessoa naquela loja.
 *   3. O destinatário é conferido duas vezes: quando alguém confirma, e de
 *      novo na hora de sair. Quem perdeu a autorização no meio-tempo não
 *      recebe.
 *
 * Este arquivo não envia nada. Quem fala com o provedor é a camada `app/`,
 * que pega o aviso aqui (`pegarParaEnvio`) e devolve o resultado.
 */

// ---------------------------------------------------------------------------
// O DESTINATÁRIO
// ---------------------------------------------------------------------------

async function validarDestinatario(
  organizacaoId: string,
  vinculoId: string,
  unidadeId: string | null,
  permissao: string | null,
): Promise<{ usuarioId: string; telefone: string }> {
  const vinculo = await db.vinculoWhatsapp.findFirst({
    where: { id: vinculoId, organizacaoId, excluidoEm: null },
    select: { usuarioId: true, telefone: true, autorizadoEm: true },
  });
  if (!vinculo) throw new Error("Destinatário não encontrado.");
  if (!vinculo.autorizadoEm) {
    throw new Error(
      "Este destinatário não está autorizado para avisos. Um responsável autoriza em Números.",
    );
  }

  // Cada um só recebe o que teria direito de ver na tela.
  const naLoja = await contextoDeFundo(vinculo.usuarioId, unidadeId);
  if (!naLoja) throw new Error("Este destinatário não tem acesso a esta loja.");
  if (permissao && !pode(naLoja, permissao)) {
    throw new Error("Este destinatário não pode ver o que o aviso mostra.");
  }
  return { usuarioId: vinculo.usuarioId, telefone: vinculo.telefone };
}

/** Na hora de sair: o telefone, ou o motivo de não sair. */
export async function destinoDoAviso(aviso: {
  organizacaoId: string;
  destinatarioRef: string | null;
  unidadeId: string | null;
  permissaoNecessaria: string | null;
}): Promise<{ telefone: string } | { recusa: string }> {
  if (!aviso.destinatarioRef) return { recusa: "Aviso sem destinatário." };
  try {
    const destino = await validarDestinatario(
      aviso.organizacaoId,
      aviso.destinatarioRef,
      aviso.unidadeId,
      aviso.permissaoNecessaria,
    );
    return { telefone: destino.telefone };
  } catch (erro) {
    return {
      recusa: erro instanceof Error ? erro.message : "Destinatário recusado.",
    };
  }
}

/** Os vínculos autorizados que podem receber um aviso daquela loja. */
export async function destinatariosPossiveis(
  organizacaoId: string,
  unidadeId: string | null,
  permissao: string | null,
): Promise<{ id: string; nome: string; telefone: string }[]> {
  const vinculos = await db.vinculoWhatsapp.findMany({
    where: { organizacaoId, excluidoEm: null, autorizadoEm: { not: null } },
    select: { id: true, usuarioId: true, telefone: true },
    orderBy: { criadoEm: "asc" },
  });
  const pessoas = await db.usuario.findMany({
    where: { id: { in: vinculos.map((v) => v.usuarioId) }, excluidoEm: null },
    select: { id: true, nome: true },
  });
  const nomes = new Map(pessoas.map((p) => [p.id, p.nome]));

  const aptos: { id: string; nome: string; telefone: string }[] = [];
  for (const v of vinculos) {
    const naLoja = await contextoDeFundo(v.usuarioId, unidadeId);
    if (!naLoja || (permissao && !pode(naLoja, permissao))) continue;
    aptos.push({
      id: v.id,
      nome: nomes.get(v.usuarioId) ?? "(pessoa removida)",
      telefone: mascararTelefone(v.telefone),
    });
  }
  return aptos;
}

// ---------------------------------------------------------------------------
// O QUE AS PESSOAS FAZEM
// ---------------------------------------------------------------------------

async function conexaoParaLoja(
  organizacaoId: string,
  unidadeId: string | null,
) {
  const candidatas = await db.instanciaWhatsapp.findMany({
    where: {
      organizacaoId,
      excluidoEm: null,
      OR: [{ unidadeId }, { unidadeId: null }],
    },
    select: { id: true, unidadeId: true },
    orderBy: { criadoEm: "asc" },
  });
  // A conexão da loja vence a da rede.
  return (
    candidatas.find((c) => c.unidadeId === unidadeId) ??
    candidatas.find((c) => c.unidadeId === null) ??
    null
  );
}

export async function criarRascunho(
  contexto: ContextoSessao,
  dados: {
    titulo: string;
    texto: string;
    unidadeId: string | null;
    destinatarioRef?: string | null;
  },
  agora: Date,
): Promise<{ id: string }> {
  if (
    !(await podeNaLoja(
      contexto.usuario.id,
      dados.unidadeId,
      "assistente.preparar",
    ))
  ) {
    throw new SemPermissao("preparar avisos nesta loja");
  }
  const { titulo, texto } = esquemaRascunho.parse(dados);

  const conexao = await conexaoParaLoja(
    contexto.organizacao.id,
    dados.unidadeId,
  );
  if (!conexao) {
    throw new Error(
      "Nenhum número de WhatsApp está cadastrado para esta loja.",
    );
  }

  if (dados.destinatarioRef) {
    const existe = await db.vinculoWhatsapp.findFirst({
      where: {
        id: dados.destinatarioRef,
        organizacaoId: contexto.organizacao.id,
        excluidoEm: null,
      },
      select: { id: true },
    });
    if (!existe) throw new Error("Destinatário não encontrado.");
  }

  // A referência é única no banco; colisão de 6 letras é rara, mas o custo de
  // tentar de novo é uma linha.
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const referencia = gerarReferencia();
    try {
      const aviso = await db.avisoWhatsapp.create({
        data: {
          organizacaoId: contexto.organizacao.id,
          unidadeId: dados.unidadeId,
          instanciaId: conexao.id,
          idPedido: `manual:${referencia}`,
          referencia,
          origemTipo: "manual",
          titulo,
          corpo: montarCorpo({
            titulo,
            linhas: texto.split("\n"),
            link: null,
            referencia,
          }),
          destinatarioRef: dados.destinatarioRef ?? null,
          solicitadoPorId: contexto.usuario.id,
          criadoEm: agora,
        },
        select: { id: true },
      });
      await registrarAuditoria(contexto, {
        entidade: "AvisoWhatsapp",
        entidadeId: aviso.id,
        acao: "CRIOU",
        unidadeId: dados.unidadeId,
        depois: { titulo, referencia },
      });
      return aviso;
    } catch (erro) {
      if ((erro as { code?: string }).code !== "P2002") throw erro;
    }
  }
  throw new Error("Não consegui gerar uma referência única. Tente de novo.");
}

async function avisoDaOrganizacao(contexto: ContextoSessao, id: string) {
  const aviso = await db.avisoWhatsapp.findFirst({
    where: { id, organizacaoId: contexto.organizacao.id },
    select: {
      id: true,
      status: true,
      unidadeId: true,
      permissaoNecessaria: true,
    },
  });
  if (!aviso) throw new Error("Aviso não encontrado.");
  return aviso;
}

/**
 * CONFIRMAR — a única porta para um aviso sair.
 *
 * Só responsável (`assistente.autorizar`) na loja do aviso. O destinatário
 * precisa estar autorizado e poder ver o que o aviso mostra. Devolve
 * `confirmado: false` quando o aviso já não era rascunho: a segunda
 * confirmação não faz nada — nem erro, nem mensagem.
 */
export async function confirmarAviso(
  contexto: ContextoSessao,
  id: string,
  destinatarioRef: string,
  agora: Date,
): Promise<{ confirmado: boolean }> {
  const aviso = await avisoDaOrganizacao(contexto, id);
  if (
    !(await podeNaLoja(
      contexto.usuario.id,
      aviso.unidadeId,
      "assistente.autorizar",
    ))
  ) {
    throw new SemPermissao("confirmar o envio de avisos");
  }
  if (aviso.status !== "RASCUNHO") return { confirmado: false };

  await validarDestinatario(
    contexto.organizacao.id,
    destinatarioRef,
    aviso.unidadeId,
    aviso.permissaoNecessaria,
  );

  const { count } = await db.avisoWhatsapp.updateMany({
    where: { id, status: "RASCUNHO" },
    data: {
      status: "CONFIRMADO",
      destinatarioRef,
      confirmadoEm: agora,
      confirmadoPorId: contexto.usuario.id,
      erro: null,
    },
  });
  if (count === 1) {
    await registrarAuditoria(contexto, {
      entidade: "AvisoWhatsapp",
      entidadeId: id,
      acao: "ALTEROU",
      unidadeId: aviso.unidadeId,
      antes: { status: "RASCUNHO" },
      depois: { status: "CONFIRMADO", destinatarioRef },
    });
  }
  return { confirmado: count === 1 };
}

/**
 * REENVIAR — a decisão humana depois de um resultado desconhecido ou de uma
 * falha. Volta para CONFIRMADO; a entrega confere o destinatário de novo.
 */
export async function reenviarAviso(
  contexto: ContextoSessao,
  id: string,
  agora: Date,
): Promise<{ reenviado: boolean }> {
  const aviso = await avisoDaOrganizacao(contexto, id);
  if (
    !(await podeNaLoja(
      contexto.usuario.id,
      aviso.unidadeId,
      "assistente.autorizar",
    ))
  ) {
    throw new SemPermissao("reenviar avisos");
  }
  if (aviso.status !== "INCERTO" && aviso.status !== "FALHOU") {
    return { reenviado: false };
  }

  const { count } = await db.avisoWhatsapp.updateMany({
    where: { id, status: aviso.status },
    data: {
      status: "CONFIRMADO",
      tentativas: 0,
      proximaTentativaEm: null,
      verificacoes: 0,
      verificadoEm: null,
      erro: null,
      confirmadoEm: agora,
      confirmadoPorId: contexto.usuario.id,
    },
  });
  if (count === 1) {
    await registrarAuditoria(contexto, {
      entidade: "AvisoWhatsapp",
      entidadeId: id,
      acao: "ALTEROU",
      unidadeId: aviso.unidadeId,
      antes: { status: aviso.status },
      depois: { status: "CONFIRMADO", reenvio: "decidido por uma pessoa" },
    });
  }
  return { reenviado: count === 1 };
}

const DESCARTAVEIS: StatusAviso[] = [
  "RASCUNHO",
  "CONFIRMADO",
  "INCERTO",
  "FALHOU",
];

export async function descartarAviso(
  contexto: ContextoSessao,
  id: string,
  agora: Date,
): Promise<{ descartado: boolean }> {
  const aviso = await avisoDaOrganizacao(contexto, id);
  // Rascunho, quem prepara descarta. O que já foi confirmado, só quem confirma.
  const chave =
    aviso.status === "RASCUNHO"
      ? "assistente.preparar"
      : "assistente.autorizar";
  if (!(await podeNaLoja(contexto.usuario.id, aviso.unidadeId, chave))) {
    throw new SemPermissao("descartar este aviso");
  }
  if (!DESCARTAVEIS.includes(aviso.status)) return { descartado: false };

  const { count } = await db.avisoWhatsapp.updateMany({
    where: { id, status: aviso.status },
    data: {
      status: "DESCARTADO",
      descartadoEm: agora,
      descartadoPorId: contexto.usuario.id,
    },
  });
  if (count === 1) {
    await registrarAuditoria(contexto, {
      entidade: "AvisoWhatsapp",
      entidadeId: id,
      acao: "ALTEROU",
      unidadeId: aviso.unidadeId,
      antes: { status: aviso.status },
      depois: { status: "DESCARTADO" },
    });
  }
  return { descartado: count === 1 };
}

// ---------------------------------------------------------------------------
// A TELA "AVISOS"
// ---------------------------------------------------------------------------

export type AvisoNaLista = {
  id: string;
  titulo: string;
  status: StatusAviso;
  referencia: string;
  origemTipo: string;
  unidadeNome: string | null;
  destinatario: { nome: string; telefone: string } | null;
  erro: string | null;
  criadoEm: Date;
  atualizadoEm: Date;
};

export type AvisoNoDetalhe = AvisoNaLista & {
  corpo: string;
  link: string | null;
  tentativas: number;
  verificacoes: number;
  solicitadoPor: string;
  confirmadoPor: string | null;
  destinatarioRef: string | null;
  etapas: {
    criadoEm: Date;
    confirmadoEm: Date | null;
    enfileiradoEm: Date | null;
    aceitoEm: Date | null;
    entregueEm: Date | null;
    lidoEm: Date | null;
    falhouEm: Date | null;
    descartadoEm: Date | null;
  };
  pode: { confirmar: boolean; descartar: boolean; reenviar: boolean };
  destinatariosPossiveis: { id: string; nome: string; telefone: string }[];
  espera: string | null;
};

function noEscopo(contexto: ContextoSessao): Prisma.AvisoWhatsappWhereInput {
  const lojas = contexto.unidadesVisiveis.map((u) => u.id);
  return {
    organizacaoId: contexto.organizacao.id,
    OR: [
      { unidadeId: { in: lojas } },
      ...(contexto.podeVerRedeInteira ? [{ unidadeId: null }] : []),
    ],
  };
}

async function destinatariosDe(refs: (string | null)[]) {
  const ids = refs.filter((r): r is string => Boolean(r));
  if (ids.length === 0)
    return new Map<string, { nome: string; telefone: string }>();
  const vinculos = await db.vinculoWhatsapp.findMany({
    where: { id: { in: ids } },
    select: { id: true, usuarioId: true, telefone: true },
  });
  const pessoas = await db.usuario.findMany({
    where: { id: { in: vinculos.map((v) => v.usuarioId) } },
    select: { id: true, nome: true },
  });
  const nomes = new Map(pessoas.map((p) => [p.id, p.nome]));
  return new Map(
    vinculos.map((v) => [
      v.id,
      {
        nome: nomes.get(v.usuarioId) ?? "(pessoa removida)",
        telefone: mascararTelefone(v.telefone),
      },
    ]),
  );
}

export async function listarAvisos(
  contexto: ContextoSessao,
  grupo: GrupoDeAviso | "todos",
  limite = 100,
): Promise<AvisoNaLista[]> {
  if (!pode(contexto, "assistente.ver")) {
    throw new SemPermissao("ver os avisos do WhatsApp");
  }
  const avisos = await db.avisoWhatsapp.findMany({
    where: {
      ...noEscopo(contexto),
      ...(grupo === "todos"
        ? {}
        : { status: { in: [...GRUPOS_DE_AVISO[grupo]] } }),
    },
    orderBy: { atualizadoEm: "desc" },
    take: limite,
  });

  const destinos = await destinatariosDe(avisos.map((a) => a.destinatarioRef));
  const lojas = new Map(contexto.unidadesVisiveis.map((u) => [u.id, u.nome]));
  return avisos.map((a) => ({
    id: a.id,
    titulo: a.titulo,
    status: a.status,
    referencia: a.referencia,
    origemTipo: a.origemTipo,
    unidadeNome: a.unidadeId ? (lojas.get(a.unidadeId) ?? null) : null,
    destinatario: a.destinatarioRef
      ? (destinos.get(a.destinatarioRef) ?? null)
      : null,
    erro: a.erro,
    criadoEm: a.criadoEm,
    atualizadoEm: a.atualizadoEm,
  }));
}

export async function contarPorGrupo(
  contexto: ContextoSessao,
): Promise<Record<GrupoDeAviso, number>> {
  if (!pode(contexto, "assistente.ver")) {
    throw new SemPermissao("ver os avisos do WhatsApp");
  }
  const linhas = await db.avisoWhatsapp.groupBy({
    by: ["status"],
    where: noEscopo(contexto),
    _count: { _all: true },
  });
  const total = (lista: readonly StatusAviso[]) =>
    linhas
      .filter((l) => lista.includes(l.status))
      .reduce((soma, l) => soma + l._count._all, 0);
  return {
    revisar: total(GRUPOS_DE_AVISO.revisar),
    andamento: total(GRUPOS_DE_AVISO.andamento),
    pendencias: total(GRUPOS_DE_AVISO.pendencias),
    concluidos: total(GRUPOS_DE_AVISO.concluidos),
  };
}

export async function obterAviso(
  contexto: ContextoSessao,
  id: string,
): Promise<AvisoNoDetalhe | null> {
  if (!pode(contexto, "assistente.ver")) {
    throw new SemPermissao("ver os avisos do WhatsApp");
  }
  const a = await db.avisoWhatsapp.findFirst({
    where: { id, ...noEscopo(contexto) },
    include: { instancia: { select: { ativa: true, estado: true } } },
  });
  if (!a) return null;

  const [destinos, pessoas, podeAutorizar, podePreparar] = await Promise.all([
    destinatariosDe([a.destinatarioRef]),
    db.usuario.findMany({
      where: {
        id: {
          in: [a.solicitadoPorId, a.confirmadoPorId].filter((x): x is string =>
            Boolean(x),
          ),
        },
      },
      select: { id: true, nome: true },
    }),
    podeNaLoja(contexto.usuario.id, a.unidadeId, "assistente.autorizar"),
    podeNaLoja(contexto.usuario.id, a.unidadeId, "assistente.preparar"),
  ]);
  const nome = (usuarioId: string | null) =>
    usuarioId ? (pessoas.find((p) => p.id === usuarioId)?.nome ?? null) : null;

  const lojas = new Map(contexto.unidadesVisiveis.map((u) => [u.id, u.nome]));
  const podeConfirmar = podeAutorizar && a.status === "RASCUNHO";

  let espera: string | null = null;
  if (a.status === "CONFIRMADO") {
    if (!a.instancia.ativa) espera = "O envio está pausado na chave geral.";
    else if (a.instancia.estado !== "CONECTADO") {
      espera = "Aguardando o número conectar.";
    } else if (a.proximaTentativaEm) {
      // A hora da OPERAÇÃO: o contêiner pensa em UTC.
      espera = `Próxima tentativa às ${new Intl.DateTimeFormat("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "America/Sao_Paulo",
      }).format(a.proximaTentativaEm)}.`;
    } else espera = "Na vez de sair.";
  }

  return {
    id: a.id,
    titulo: a.titulo,
    status: a.status,
    referencia: a.referencia,
    origemTipo: a.origemTipo,
    unidadeNome: a.unidadeId ? (lojas.get(a.unidadeId) ?? null) : null,
    destinatario: a.destinatarioRef
      ? (destinos.get(a.destinatarioRef) ?? null)
      : null,
    destinatarioRef: a.destinatarioRef,
    erro: a.erro,
    criadoEm: a.criadoEm,
    atualizadoEm: a.atualizadoEm,
    corpo: a.corpo,
    link: a.link,
    tentativas: a.tentativas,
    verificacoes: a.verificacoes,
    solicitadoPor:
      nome(a.solicitadoPorId) ??
      (a.origemTipo === "manual"
        ? "(pessoa removida)"
        : "O sistema, por um evento"),
    confirmadoPor: nome(a.confirmadoPorId),
    etapas: {
      criadoEm: a.criadoEm,
      confirmadoEm: a.confirmadoEm,
      enfileiradoEm: a.enfileiradoEm,
      aceitoEm: a.aceitoEm,
      entregueEm: a.entregueEm,
      lidoEm: a.lidoEm,
      falhouEm: a.falhouEm,
      descartadoEm: a.descartadoEm,
    },
    pode: {
      confirmar: podeConfirmar,
      descartar:
        DESCARTAVEIS.includes(a.status) &&
        (a.status === "RASCUNHO"
          ? podePreparar || podeAutorizar
          : podeAutorizar),
      reenviar:
        podeAutorizar && (a.status === "INCERTO" || a.status === "FALHOU"),
    },
    destinatariosPossiveis: podeConfirmar
      ? await destinatariosPossiveis(
          contexto.organizacao.id,
          a.unidadeId,
          a.permissaoNecessaria,
        )
      : [],
    espera,
  };
}

// ---------------------------------------------------------------------------
// O QUE A ENTREGA USA — sem contexto: o sistema, no relógio ou no after()
// ---------------------------------------------------------------------------

export type AvisoParaEntrega = Prisma.AvisoWhatsappGetPayload<{
  select: {
    id: true;
    organizacaoId: true;
    unidadeId: true;
    instanciaId: true;
    corpo: true;
    destinatarioRef: true;
    permissaoNecessaria: true;
    instancia: {
      select: { id: true; nome: true; provedor: true; ultimoEnvioEm: true };
    };
  };
}>;

/**
 * Os confirmados prontos para sair. Só de número LIGADO e CONECTADO: com a
 * chave geral desligada o aviso fica esperando, e com o número caído não há
 * por que tentar.
 */
export async function candidatosParaEntrega(
  agora: Date,
  limite: number,
  apenasId?: string,
): Promise<AvisoParaEntrega[]> {
  return db.avisoWhatsapp.findMany({
    where: {
      status: "CONFIRMADO",
      ...(apenasId ? { id: apenasId } : {}),
      OR: [
        { proximaTentativaEm: null },
        { proximaTentativaEm: { lte: agora } },
      ],
      instancia: { excluidoEm: null, ativa: true, estado: "CONECTADO" },
    },
    orderBy: { confirmadoEm: "asc" },
    take: limite,
    select: {
      id: true,
      organizacaoId: true,
      unidadeId: true,
      instanciaId: true,
      corpo: true,
      destinatarioRef: true,
      permissaoNecessaria: true,
      instancia: {
        select: { id: true, nome: true, provedor: true, ultimoEnvioEm: true },
      },
    },
  });
}

export type ResultadoDaPegada =
  | { pego: true }
  | { pego: false; motivo: "outro-pegou" }
  | { pego: false; motivo: "ritmo"; esperarMs: number };

/**
 * Pega o aviso para enviar — e o RITMO vai junto, atômico.
 *
 * O `after()` da confirmação e o relógio podem tentar ao mesmo tempo, e
 * duas rodadas do relógio também se cruzam. Por isso o respiro de 4 s entre
 * mensagens do mesmo número não mora em quem chama: mora aqui. A linha do
 * NÚMERO é trancada (`FOR NO KEY UPDATE`, que não briga com quem só insere
 * evento ou aviso apontando para ela), o último envio é lido debaixo da
 * tranca, e só então o aviso vira NA_FILA e o número ganha "enviando agora".
 * Quem chega cedo demais ouve quanto falta e espera — nunca dispara junto.
 *
 * O carimbo vale para todo envio que PODE ter saído — aceito ou incerto —
 * porque é a Meta quem conta as mensagens, não a resposta HTTP.
 */
export async function pegarParaEnvio(
  id: string,
  agora: Date,
): Promise<ResultadoDaPegada> {
  return db.$transaction(async (tx) => {
    const aviso = await tx.avisoWhatsapp.findUnique({
      where: { id },
      select: { instanciaId: true, status: true },
    });
    if (!aviso || aviso.status !== "CONFIRMADO") {
      return { pego: false, motivo: "outro-pegou" };
    }

    const [instancia] = await tx.$queryRaw<{ ultimoEnvioEm: Date | null }[]>`
      SELECT "ultimoEnvioEm" FROM "instancia_whatsapp"
       WHERE "id" = ${aviso.instanciaId}
       FOR NO KEY UPDATE`;
    const ultimo = instancia?.ultimoEnvioEm?.getTime() ?? 0;
    const falta = ultimo + INTERVALO_MS - agora.getTime();
    if (falta > 0) return { pego: false, motivo: "ritmo", esperarMs: falta };

    const { count } = await tx.avisoWhatsapp.updateMany({
      where: { id, status: "CONFIRMADO" },
      data: {
        status: "NA_FILA",
        tentativas: { increment: 1 },
        tentativaIniciadaEm: agora,
        enfileiradoEm: agora,
      },
    });
    if (count === 0) return { pego: false, motivo: "outro-pegou" };

    await tx.instanciaWhatsapp.update({
      where: { id: aviso.instanciaId },
      data: { ultimoEnvioEm: agora },
    });
    return { pego: true };
  });
}

export async function recusarDestino(
  id: string,
  motivo: string,
  agora: Date,
): Promise<void> {
  await db.avisoWhatsapp.updateMany({
    where: { id, status: "CONFIRMADO" },
    data: { status: "FALHOU", falhouEm: agora, erro: motivo },
  });
}

export type ResultadoDoEnvio =
  | { tipo: "aceito"; idMensagem: string; aceitoEm: Date }
  | { tipo: "nao-chegou" | "incerto" | "recusado"; motivo: string };

/**
 * Grava o que o provedor respondeu — depois de conferir o que ele já CONTOU.
 *
 * O evento `send.message` chega antes da resposta HTTP e deixa o id da
 * mensagem no aviso. Se a resposta se perdeu (tempo esgotado, 5xx) mas o id
 * está lá, a mensagem saiu: é ACEITO, não INCERTO. Evidência vence resposta.
 *
 * E o "entregue" que chegou antes de o id existir é reaplicado assim que o
 * aviso ganha o id.
 */
export async function registrarResultado(
  id: string,
  resultado: ResultadoDoEnvio,
  agora: Date,
): Promise<StatusAviso | null> {
  const atual = await db.avisoWhatsapp.findUnique({
    where: { id },
    select: { tentativas: true, instanciaId: true },
  });
  if (!atual) return null;

  if (resultado.tipo === "aceito") {
    const { count } = await db.avisoWhatsapp.updateMany({
      where: { id, status: "NA_FILA" },
      data: {
        status: "ACEITO",
        idMensagemProvedor: resultado.idMensagem,
        aceitoEm: resultado.aceitoEm,
        erro: null,
        proximaTentativaEm: null,
      },
    });
    if (count === 0) return null;
    await aplicarStatusJaRecebidos(atual.instanciaId, resultado.idMensagem);
    return "ACEITO";
  }

  const aceitarPelaProva = async (): Promise<StatusAviso | null> => {
    const { count } = await db.avisoWhatsapp.updateMany({
      where: { id, status: "NA_FILA", idMensagemProvedor: { not: null } },
      data: { status: "ACEITO", erro: null, proximaTentativaEm: null },
    });
    if (count === 0) return null;
    const aceito = await db.avisoWhatsapp.findUnique({
      where: { id },
      select: { idMensagemProvedor: true },
    });
    await aplicarStatusJaRecebidos(
      atual.instanciaId,
      aceito?.idMensagemProvedor ?? "",
    );
    return "ACEITO";
  };
  const pelaProva = await aceitarPelaProva();
  if (pelaProva) return pelaProva;

  let data: Prisma.AvisoWhatsappUpdateManyMutationInput;
  switch (resultado.tipo) {
    case "nao-chegou":
      // Tentativas automáticas só quando o pedido NÃO chegou: 1, 4 e 9
      // minutos depois. Na quarta falha, FALHOU.
      data =
        atual.tentativas > MAX_TENTATIVAS_SEM_CHEGAR
          ? {
              status: "FALHOU",
              falhouEm: agora,
              erro: `${resultado.motivo} Desisti depois de ${atual.tentativas} tentativas.`,
            }
          : {
              status: "CONFIRMADO",
              proximaTentativaEm: new Date(
                agora.getTime() + esperaAntesDaTentativa(atual.tentativas),
              ),
              erro: resultado.motivo,
            };
      break;
    case "incerto":
      data = {
        status: "INCERTO",
        erro: resultado.motivo,
        verificacoes: 0,
        verificadoEm: null,
      };
      break;
    case "recusado":
      data = { status: "FALHOU", falhouEm: agora, erro: resultado.motivo };
      break;
  }

  const { count } = await db.avisoWhatsapp.updateMany({
    // Só sem prova: se o `send.message` deixou o id entre a conferência
    // acima e este ponto, a prova vence de novo.
    where: { id, status: "NA_FILA", idMensagemProvedor: null },
    data,
  });
  if (count === 1) return data.status as StatusAviso;
  return aceitarPelaProva();
}

/** NA_FILA há tempo demais: o processo morreu no meio. Resultado desconhecido. */
export async function marcarInterrompidos(agora: Date): Promise<number> {
  const { count } = await db.avisoWhatsapp.updateMany({
    where: {
      status: "NA_FILA",
      tentativaIniciadaEm: {
        lt: new Date(agora.getTime() - INTERROMPIDO_APOS_MS),
      },
    },
    data: {
      status: "INCERTO",
      erro: "O envio foi interrompido antes da resposta do provedor. A mensagem pode ter saído.",
      verificacoes: 0,
      verificadoEm: null,
    },
  });
  return count;
}

export async function incertosParaVerificar(agora: Date) {
  return db.avisoWhatsapp.findMany({
    where: {
      status: "INCERTO",
      verificacoes: { lt: MAX_VERIFICACOES },
      tentativaIniciadaEm: {
        lte: new Date(agora.getTime() - VERIFICAR_APOS_MS),
      },
      OR: [
        { verificadoEm: null },
        {
          verificadoEm: {
            lte: new Date(agora.getTime() - INTERVALO_ENTRE_VERIFICACOES_MS),
          },
        },
      ],
    },
    select: {
      id: true,
      corpo: true,
      tentativaIniciadaEm: true,
      verificacoes: true,
      instancia: { select: { id: true, nome: true, provedor: true } },
    },
    take: 20,
  });
}

export async function registrarVerificacao(
  id: string,
  resultado:
    | { tipo: "achou"; idMensagem: string; enviadaEm: Date | null }
    | { tipo: "nao-achou" }
    | { tipo: "falhou"; motivo: string },
  agora: Date,
): Promise<void> {
  if (resultado.tipo === "achou") {
    await db.avisoWhatsapp.updateMany({
      where: { id, status: "INCERTO" },
      data: {
        status: "ACEITO",
        idMensagemProvedor: resultado.idMensagem,
        aceitoEm: resultado.enviadaEm ?? agora,
        erro: null,
        verificadoEm: agora,
        verificacoes: { increment: 1 },
      },
    });
    return;
  }

  const atual = await db.avisoWhatsapp.findUnique({
    where: { id },
    select: { verificacoes: true },
  });
  const n = (atual?.verificacoes ?? 0) + 1;
  const base =
    resultado.tipo === "nao-achou"
      ? "Não encontrada no provedor"
      : `Não foi possível consultar o provedor (${resultado.motivo})`;
  const erro =
    n >= MAX_VERIFICACOES
      ? `${base}. Parei de procurar depois de ${MAX_VERIFICACOES} consultas: decida entre reenviar e descartar.`
      : `${base} (consulta ${n} de ${MAX_VERIFICACOES}). Pode não ter saído — ou a Evolution não guarda mensagens enviadas.`;

  await db.avisoWhatsapp.updateMany({
    where: { id, status: "INCERTO" },
    data: { verificacoes: n, verificadoEm: agora, erro },
  });
}
