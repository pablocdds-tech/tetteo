import { Prisma } from "@prisma/client";

import { pode, type ContextoSessao } from "@/core/sessao/nucleo";
import { SemPermissao } from "@/lib/erros";
import { normalizarTelefone } from "@/lib/telefone";
import { db } from "@/server/db";

import { MARCADOR_DO_LINK } from "../schemas/mensagens";
import {
  LEASE_MS,
  desistiu,
  proximaTentativa,
  type ConsultaDoEnvio,
  type ResultadoDoEnvio,
} from "../schemas/ritmo-envio";

import { registrar } from "./auditoria";
import { decifrar } from "./cripto-do-link";

/**
 * A FILA DURÁVEL DE MENSAGENS AO FORNECEDOR.
 *
 * Aprovar um pedido NÃO envia nada: grava a mensagem aqui, na mesma
 * transação. Quem envia é o relógio, que pega um lote com trava — e as
 * garantias moram no banco:
 *
 *   DUAS RÉPLICAS NUNCA PEGAM A MESMA MENSAGEM
 *     `FOR UPDATE SKIP LOCKED` + dono e prazo da trava (`leaseDono/leaseAte`).
 *
 *   A MESMA COISA NUNCA É ENFILEIRADA DUAS VEZES
 *     `chave` única ("pedido:<id>:1"). Enfileirar de novo devolve a primeira.
 *
 *   RESPOSTA PERDIDA NÃO VIRA REENVIO ÀS CEGAS
 *     Tempo esgotado, ou processo que morreu com a trava na mão, vira
 *     INCERTA. Ela só sai desse estado se o canal confirmar por id, ou se uma
 *     PESSOA com `compras.enviar` decidir — e a decisão fica auditada.
 *
 *   O DESTINO É DO SERVIDOR
 *     O número vem do cadastro do fornecedor (telefone de pedidos + a
 *     autorização dele), é congelado aqui, e a tela nunca manda um número.
 *
 * Este arquivo não conhece nenhum canal. Ele grava e lê; o relógio em
 * `app/api/compras/tick` liga a fila ao conector.
 */

type Tx = Prisma.TransactionClient;

export type EstadoDaMensagem =
  | "BLOQUEADA"
  | "NA_FILA"
  | "ENVIANDO"
  | "ACEITA_PELO_CANAL"
  | "ENTREGUE"
  | "INCERTA"
  | "FALHOU"
  | "CANCELADA";

export type TipoDeMensagem =
  | "CONVITE_COTACAO"
  | "PEDIDO"
  | "ADENDO"
  | "ALTERACAO"
  | "CANCELAMENTO"
  | "TESTE";

function exigir(ctx: ContextoSessao, chave: string, acao: string) {
  if (!pode(ctx, chave)) throw new SemPermissao(acao);
}

/** Por que não dá para mandar para este fornecedor — ou `null` se dá. */
function bloqueio(
  f: {
    ativo: boolean;
    excluidoEm: Date | null;
    telefonePedidos: string | null;
    autorizadoMensagens: boolean;
  } | null,
): string | null {
  if (!f || f.excluidoEm) return "Fornecedor não encontrado.";
  if (!f.ativo) return "Fornecedor desativado.";
  if (!f.telefonePedidos)
    return "Fornecedor sem telefone de pedidos cadastrado.";
  if (!f.autorizadoMensagens)
    return "Fornecedor não autorizou receber mensagens.";
  return null;
}

// ---------------------------------------------------------------- ENFILEIRAR

export async function enfileirar(
  tx: Tx,
  dados: {
    organizacaoId: string;
    unidadeId: string | null;
    fornecedorId: string;
    tipo: Exclude<TipoDeMensagem, "TESTE">;
    referenciaTipo: string;
    referenciaId: string;
    sequencia: number;
    corpo: string;
    chave: string;
    criadoPorId: string | null;
  },
): Promise<{
  id: string;
  estado: EstadoDaMensagem;
  motivoBloqueio: string | null;
}> {
  const existente = await tx.mensagemAoFornecedor.findUnique({
    where: { chave: dados.chave },
    select: { id: true, estado: true, motivoBloqueio: true },
  });
  if (existente) return existente;

  const fornecedor = await tx.fornecedor.findFirst({
    where: { id: dados.fornecedorId, organizacaoId: dados.organizacaoId },
    select: {
      ativo: true,
      excluidoEm: true,
      telefonePedidos: true,
      autorizadoMensagens: true,
    },
  });
  const motivo = bloqueio(fornecedor);

  return tx.mensagemAoFornecedor.create({
    data: {
      organizacaoId: dados.organizacaoId,
      unidadeId: dados.unidadeId,
      fornecedorId: dados.fornecedorId,
      tipo: dados.tipo,
      referenciaTipo: dados.referenciaTipo,
      referenciaId: dados.referenciaId,
      sequencia: dados.sequencia,
      destino: motivo ? null : fornecedor!.telefonePedidos,
      motivoBloqueio: motivo,
      estado: motivo ? "BLOQUEADA" : "NA_FILA",
      corpo: dados.corpo,
      chave: dados.chave,
      criadoPorId: dados.criadoPorId,
    },
    select: { id: true, estado: true, motivoBloqueio: true },
  });
}

// --------------------------------------------------------------- O RELÓGIO

export type Reivindicada = {
  id: string;
  destino: string;
  chave: string;
  tentativas: number;
  tipo: TipoDeMensagem;
  referenciaTipo: string;
  referenciaId: string;
  organizacaoId: string;
  ehTeste: boolean;
};

/**
 * Pega um lote para enviar, com trava. Cada mensagem pega aqui fica "com"
 * `dono` até `LEASE_MS` — nenhuma outra réplica a vê enquanto isso.
 * Organização com o canal PAUSADO não tem nada pego.
 */
export async function reivindicar(
  dono: string,
  limite: number,
  agora: Date,
): Promise<Reivindicada[]> {
  const ate = new Date(agora.getTime() + LEASE_MS);
  return db.$queryRaw<Reivindicada[]>`
    UPDATE "mensagem_ao_fornecedor" AS m
    SET "estado" = 'ENVIANDO',
        "leaseDono" = ${dono},
        "leaseAte" = ${ate},
        "enviandoDesde" = ${agora},
        "tentativas" = m."tentativas" + 1
    WHERE m."id" IN (
      SELECT x."id" FROM "mensagem_ao_fornecedor" AS x
      WHERE x."estado" = 'NA_FILA'
        AND x."destino" IS NOT NULL
        AND (x."proximaTentativaEm" IS NULL OR x."proximaTentativaEm" <= ${agora})
        AND NOT EXISTS (
          SELECT 1 FROM "canal_de_compras" AS c
          WHERE c."organizacaoId" = x."organizacaoId" AND c."pausado"
        )
      ORDER BY x."enfileiradaEm", x."id"
      LIMIT ${limite}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING m."id", m."destino", m."chave", m."tentativas",
              m."tipo"::text AS "tipo", m."referenciaTipo", m."referenciaId",
              m."organizacaoId", m."ehTeste"`;
}

/**
 * O texto que sai, com o link colocado só agora.
 *
 * O convite guarda "{{LINK}}"; o código é decifrado aqui, do link VIGENTE da
 * solicitação — reemitir o link depois de enfileirar não manda um link morto.
 * Link revogado não é enviado: a mensagem falha com o motivo.
 */
export async function corpoParaEnvio(id: string): Promise<string> {
  const m = await db.mensagemAoFornecedor.findUniqueOrThrow({
    where: { id },
    select: { corpo: true, tipo: true, referenciaId: true },
  });
  if (m.tipo !== "CONVITE_COTACAO" || !m.corpo.includes(MARCADOR_DO_LINK)) {
    return m.corpo;
  }
  return m.corpo.replace(
    MARCADOR_DO_LINK,
    await linkDaSolicitacao(m.referenciaId),
  );
}

export function baseDoLink(): string {
  const base = process.env.APP_URL || process.env.AUTH_URL;
  if (!base) {
    throw new Error(
      "APP_URL não está configurado: sem o endereço do sistema não há como montar o link do fornecedor.",
    );
  }
  return base.replace(/\/+$/, "");
}

export async function linkDaSolicitacao(
  solicitacaoId: string,
): Promise<string> {
  const s = await db.solicitacaoDeCotacao.findUniqueOrThrow({
    where: { id: solicitacaoId },
    select: { tokenCifrado: true, tokenRevogadoEm: true },
  });
  if (!s.tokenCifrado || s.tokenRevogadoEm) {
    throw new Error(
      "O link desta solicitação foi revogado e não foi reemitido.",
    );
  }
  // O código vai DEPOIS do "#": o navegador não o envia ao servidor, e ele
  // não aparece em registro de acesso de ninguém.
  return `${baseDoLink()}/fornecedor/cotacao#${decifrar(s.tokenCifrado)}`;
}

/**
 * Grava o que o canal respondeu. Só vale se a mensagem ainda for de `dono` —
 * se a trava venceu e ela virou INCERTA, uma resposta "aceita" que chega
 * atrasada ainda a resolve (é a melhor prova que existe).
 */
export async function marcarResultado(
  id: string,
  dono: string,
  resultado: ResultadoDoEnvio,
  canal: { nome: string; simulado: boolean },
  agora: Date,
): Promise<void> {
  const atual = await db.mensagemAoFornecedor.findUnique({
    where: { id },
    select: { tentativas: true, estado: true, leaseDono: true },
  });
  if (!atual || atual.leaseDono !== dono) return;

  const desta = {
    id,
    leaseDono: dono,
    estado: { in: ["ENVIANDO" as const, "INCERTA" as const] },
  };

  if (resultado.tipo === "aceita") {
    await db.mensagemAoFornecedor.updateMany({
      where: desta,
      data: {
        estado: "ACEITA_PELO_CANAL",
        idProvedor: resultado.idProvedor,
        aceitaEm: agora,
        canal: canal.nome,
        simulada: canal.simulado,
        leaseAte: null,
        ultimoErro: null,
      },
    });
    return;
  }

  if (atual.estado !== "ENVIANDO") return;

  if (resultado.tipo === "incerta") {
    await db.mensagemAoFornecedor.updateMany({
      where: { id, leaseDono: dono, estado: "ENVIANDO" },
      data: {
        estado: "INCERTA",
        incertaEm: agora,
        canal: canal.nome,
        ultimoErro: resultado.erro.slice(0, 500),
        leaseAte: null,
      },
    });
    return;
  }

  const acabou = !resultado.tentarDeNovo || desistiu(atual.tentativas);
  await db.mensagemAoFornecedor.updateMany({
    where: { id, leaseDono: dono, estado: "ENVIANDO" },
    data: {
      canal: canal.nome,
      ultimoErro: resultado.erro.slice(0, 500),
      leaseAte: null,
      leaseDono: null,
      ...(acabou
        ? { estado: "FALHOU", falhouEm: agora }
        : {
            estado: "NA_FILA",
            proximaTentativaEm: proximaTentativa(atual.tentativas, agora),
          }),
    },
  });
}

/** Trava vencida = quem pegou morreu no meio. Não se sabe se saiu. */
export async function vencerTravas(agora: Date): Promise<number> {
  const r = await db.mensagemAoFornecedor.updateMany({
    where: { estado: "ENVIANDO", leaseAte: { lt: agora } },
    data: {
      estado: "INCERTA",
      incertaEm: agora,
      ultimoErro:
        "O envio foi interrompido no meio: não se sabe se a mensagem saiu.",
    },
  });
  return r.count;
}

export async function incertasParaConsultar(limite = 20) {
  return db.mensagemAoFornecedor.findMany({
    where: { estado: "INCERTA", resolvidaPorId: null },
    select: { id: true, chave: true, idProvedor: true, canal: true },
    orderBy: { incertaEm: "asc" },
    take: limite,
  });
}

/**
 * O canal respondeu sobre uma incerta. "aceita" resolve; "nao-encontrada"
 * é a prova de que NÃO saiu — aí sim, volta para a fila; "desconhecido"
 * deixa como está, para uma pessoa decidir.
 */
export async function aplicarConsulta(
  id: string,
  consulta: ConsultaDoEnvio,
  agora: Date,
): Promise<void> {
  if (consulta === "desconhecido") return;
  await db.mensagemAoFornecedor.updateMany({
    where: { id, estado: "INCERTA" },
    data:
      consulta === "aceita"
        ? {
            estado: "ACEITA_PELO_CANAL",
            aceitaEm: agora,
            resolucao: "Confirmada pelo canal na conferência.",
          }
        : {
            estado: "NA_FILA",
            proximaTentativaEm: agora,
            leaseDono: null,
            resolucao: "O canal confirmou que não saiu; voltou para a fila.",
          },
  });
}

// ---------------------------------------------------------- AÇÕES DE PESSOA

async function daOrganizacao(ctx: ContextoSessao, id: string) {
  const m = await db.mensagemAoFornecedor.findFirst({
    where: {
      id,
      organizacaoId: ctx.organizacao.id,
      OR: [
        { unidadeId: null },
        { unidadeId: { in: ctx.unidadesVisiveis.map((u) => u.id) } },
      ],
    },
  });
  if (!m) throw new Error("Mensagem não encontrada.");
  return m;
}

export async function resolverIncerta(
  ctx: ContextoSessao,
  id: string,
  decisao: "saiu" | "reenviar",
): Promise<void> {
  exigir(ctx, "compras.enviar", "resolver mensagens incertas");
  const m = await daOrganizacao(ctx, id);
  if (m.estado !== "INCERTA")
    throw new Error("Esta mensagem não está incerta.");

  const resolucao =
    decisao === "saiu"
      ? `${ctx.usuario.nome} conferiu no WhatsApp: a mensagem saiu.`
      : `${ctx.usuario.nome} conferiu no WhatsApp: não saiu. Reenviada.`;

  const r = await db.mensagemAoFornecedor.updateMany({
    where: { id, estado: "INCERTA" },
    data: {
      resolvidaPorId: ctx.usuario.id,
      resolucao,
      ...(decisao === "saiu"
        ? { estado: "ACEITA_PELO_CANAL", aceitaEm: new Date() }
        : {
            estado: "NA_FILA",
            proximaTentativaEm: new Date(),
            leaseDono: null,
            resolvidaPorId: null,
          }),
    },
  });
  if (r.count !== 1)
    throw new Error("A mensagem mudou enquanto você olhava. Recarregue.");

  await registrar(db, ctx, {
    entidade: "MensagemAoFornecedor",
    entidadeId: id,
    acao: "ALTEROU",
    unidadeId: m.unidadeId,
    antes: { estado: "INCERTA" },
    depois: { decisao, resolucao },
  });
}

export async function reprocessar(
  ctx: ContextoSessao,
  id: string,
): Promise<void> {
  exigir(ctx, "compras.enviar", "reprocessar mensagens");
  const m = await daOrganizacao(ctx, id);
  if (m.estado !== "FALHOU") {
    throw new Error("Só dá para reprocessar mensagem que falhou.");
  }
  await db.mensagemAoFornecedor.updateMany({
    where: { id, estado: "FALHOU" },
    data: {
      estado: "NA_FILA",
      tentativas: 0,
      proximaTentativaEm: new Date(),
      leaseDono: null,
      falhouEm: null,
    },
  });
  await registrar(db, ctx, {
    entidade: "MensagemAoFornecedor",
    entidadeId: id,
    acao: "ALTEROU",
    unidadeId: m.unidadeId,
    antes: { estado: "FALHOU", erro: m.ultimoErro },
    depois: { estado: "NA_FILA", reprocessadaPor: ctx.usuario.nome },
  });
}

/**
 * Refaz o destino a partir do cadastro de HOJE do fornecedor.
 *
 * É o único jeito de uma mensagem mudar de número: a fila nunca redireciona
 * sozinha. Vale para bloqueada, na fila e falhou — o que já saiu não se
 * redireciona.
 */
export async function atualizarDestino(
  ctx: ContextoSessao,
  id: string,
): Promise<void> {
  exigir(ctx, "compras.enviar", "mudar o destino de uma mensagem");
  const m = await daOrganizacao(ctx, id);
  if (
    !["BLOQUEADA", "NA_FILA", "FALHOU"].includes(m.estado) ||
    !m.fornecedorId
  ) {
    throw new Error("O destino desta mensagem não pode mais mudar.");
  }
  const fornecedor = await db.fornecedor.findFirst({
    where: { id: m.fornecedorId, organizacaoId: ctx.organizacao.id },
    select: {
      ativo: true,
      excluidoEm: true,
      telefonePedidos: true,
      autorizadoMensagens: true,
    },
  });
  const motivo = bloqueio(fornecedor);

  await db.mensagemAoFornecedor.updateMany({
    where: { id, estado: { in: ["BLOQUEADA", "NA_FILA", "FALHOU"] } },
    data: motivo
      ? { estado: "BLOQUEADA", motivoBloqueio: motivo, destino: null }
      : {
          estado: "NA_FILA",
          motivoBloqueio: null,
          destino: fornecedor!.telefonePedidos,
          tentativas: 0,
          proximaTentativaEm: new Date(),
        },
  });
  await registrar(db, ctx, {
    entidade: "MensagemAoFornecedor",
    entidadeId: id,
    acao: "ALTEROU",
    unidadeId: m.unidadeId,
    antes: { estado: m.estado, destino: m.destino },
    depois: motivo
      ? { estado: "BLOQUEADA", motivo }
      : { estado: "NA_FILA", destino: fornecedor!.telefonePedidos },
  });
}

/**
 * "Mandei pelo meu WhatsApp." É uma DECLARAÇÃO da pessoa, gravada como tal.
 *
 * Se a mensagem ainda estava para sair, ela é cancelada: com o canal real
 * ligado, o relógio a mandaria de novo — e o fornecedor receberia dois
 * pedidos iguais.
 */
export async function marcarEnviadaAMao(
  ctx: ContextoSessao,
  id: string,
): Promise<void> {
  exigir(ctx, "compras.enviar", "marcar mensagens como enviadas");
  const m = await daOrganizacao(ctx, id);
  if (m.estado === "ENVIANDO") {
    throw new Error(
      "Esta mensagem está saindo agora pelo canal. Espere um minuto.",
    );
  }
  if (m.enviadaAMaoEm) return;

  const agora = new Date();
  const aindaIaSair = ["BLOQUEADA", "NA_FILA", "FALHOU", "INCERTA"].includes(
    m.estado,
  );

  await db.$transaction(async (tx) => {
    await tx.mensagemAoFornecedor.update({
      where: { id },
      data: {
        enviadaAMaoEm: agora,
        enviadaAMaoPorId: ctx.usuario.id,
        ...(aindaIaSair
          ? {
              estado: "CANCELADA",
              canceladaEm: agora,
              resolucao: `Enviada à mão por ${ctx.usuario.nome}.`,
            }
          : {}),
      },
    });
    if (m.referenciaTipo === "Pedido") {
      await tx.pedido.updateMany({
        where: { id: m.referenciaId, enviadoManualmenteEm: null },
        data: {
          enviadoManualmenteEm: agora,
          enviadoManualmentePorId: ctx.usuario.id,
        },
      });
    }
    await registrar(tx, ctx, {
      entidade: "MensagemAoFornecedor",
      entidadeId: id,
      acao: "ALTEROU",
      unidadeId: m.unidadeId,
      antes: { estado: m.estado },
      depois: {
        enviadaAMao: true,
        estado: aindaIaSair ? "CANCELADA" : m.estado,
      },
    });
  });
}

// ------------------------------------------------------------------ O CANAL

export async function canalDaOrganizacao(organizacaoId: string) {
  return (
    (await db.canalDeCompras.findUnique({ where: { organizacaoId } })) ?? {
      pausado: false,
      motivoPausa: null,
      pausadoEm: null,
      destinoTeste: null,
    }
  );
}

export async function pausarCanal(
  ctx: ContextoSessao,
  pausar: boolean,
  motivo: string | null,
): Promise<void> {
  exigir(ctx, "compras.enviar", "pausar o envio");
  if (pausar && !motivo?.trim()) {
    throw new Error(
      "Diga por que o envio está sendo pausado — aparece para todos no painel.",
    );
  }
  await db.canalDeCompras.upsert({
    where: { organizacaoId: ctx.organizacao.id },
    create: {
      organizacaoId: ctx.organizacao.id,
      pausado: pausar,
      motivoPausa: pausar ? motivo!.trim() : null,
      pausadoPorId: pausar ? ctx.usuario.id : null,
      pausadoEm: pausar ? new Date() : null,
    },
    update: {
      pausado: pausar,
      motivoPausa: pausar ? motivo!.trim() : null,
      pausadoPorId: pausar ? ctx.usuario.id : null,
      pausadoEm: pausar ? new Date() : null,
    },
  });
  await registrar(db, ctx, {
    entidade: "CanalDeCompras",
    entidadeId: ctx.organizacao.id,
    acao: "ALTEROU",
    depois: { pausado: pausar, motivo },
  });
}

export async function definirDestinoDeTeste(
  ctx: ContextoSessao,
  telefone: string,
): Promise<void> {
  exigir(ctx, "compras.configurar", "configurar o número de teste");
  const numero = telefone.trim() ? normalizarTelefone(telefone) : null;
  if (telefone.trim() && !numero) {
    throw new Error("Telefone inválido. Use DDD e número.");
  }
  await db.canalDeCompras.upsert({
    where: { organizacaoId: ctx.organizacao.id },
    create: { organizacaoId: ctx.organizacao.id, destinoTeste: numero },
    update: { destinoTeste: numero },
  });
  await registrar(db, ctx, {
    entidade: "CanalDeCompras",
    entidadeId: ctx.organizacao.id,
    acao: "ALTEROU",
    depois: { destinoTeste: numero },
  });
}

/**
 * Envio de teste: vai SÓ para o número de teste. Sem número de teste, não há
 * teste — nunca cai no telefone de um fornecedor por omissão.
 */
export async function enviarTeste(
  ctx: ContextoSessao,
  texto: string,
): Promise<string> {
  exigir(ctx, "compras.enviar", "enviar mensagem de teste");
  const canal = await canalDaOrganizacao(ctx.organizacao.id);
  if (!canal.destinoTeste) {
    throw new Error(
      "Cadastre um número de teste em Configurações antes. O teste nunca vai para um fornecedor.",
    );
  }
  const corpo = `[TESTE do Tetteo — ignore] ${texto.trim().slice(0, 300) || "Mensagem de teste."}`;
  const criada = await db.mensagemAoFornecedor.create({
    data: {
      organizacaoId: ctx.organizacao.id,
      tipo: "TESTE",
      referenciaTipo: "Teste",
      referenciaId: ctx.usuario.id,
      destino: canal.destinoTeste,
      ehTeste: true,
      corpo,
      chave: `teste:${ctx.usuario.id}:${Date.now()}`,
      criadoPorId: ctx.usuario.id,
    },
    select: { id: true },
  });
  await registrar(db, ctx, {
    entidade: "MensagemAoFornecedor",
    entidadeId: criada.id,
    acao: "CRIOU",
    depois: { tipo: "TESTE" },
  });
  return criada.id;
}

// ----------------------------------------------------------------- O PAINEL

export async function painelDeEnvios(
  ctx: ContextoSessao,
  filtro: { estado?: EstadoDaMensagem; unidadeId?: string } = {},
) {
  exigir(ctx, "compras.ver", "ver compras");
  const lojas = ctx.unidadesVisiveis.map((u) => u.id);
  if (filtro.unidadeId && !lojas.includes(filtro.unidadeId)) {
    throw new SemPermissao("ver envios de outra loja");
  }

  const escopo: Prisma.MensagemAoFornecedorWhereInput = {
    organizacaoId: ctx.organizacao.id,
    ...(filtro.unidadeId
      ? { unidadeId: filtro.unidadeId }
      : { OR: [{ unidadeId: null }, { unidadeId: { in: lojas } }] }),
  };

  const [canal, contagens, mensagens] = await Promise.all([
    canalDaOrganizacao(ctx.organizacao.id),
    db.mensagemAoFornecedor.groupBy({
      by: ["estado"],
      where: escopo,
      _count: { _all: true },
    }),
    db.mensagemAoFornecedor.findMany({
      where: { ...escopo, ...(filtro.estado ? { estado: filtro.estado } : {}) },
      include: {
        fornecedor: { select: { nome: true, telefonePedidos: true } },
      },
      orderBy: { enfileiradaEm: "desc" },
      take: 100,
    }),
  ]);

  return {
    canal: {
      pausado: canal.pausado,
      motivoPausa: canal.motivoPausa,
      pausadoEm: canal.pausadoEm,
      destinoTeste: canal.destinoTeste,
      // Lido do ambiente, sem conhecer o conector: o que vale é o que o
      // relógio vai usar.
      simulado: (process.env.COMPRAS_CANAL ?? "simulador") !== "whatsapp",
    },
    porEstado: Object.fromEntries(
      contagens.map((c) => [c.estado, c._count._all]),
    ) as Partial<Record<EstadoDaMensagem, number>>,
    mensagens: mensagens.map((m) => ({
      id: m.id,
      tipo: m.tipo,
      referenciaTipo: m.referenciaTipo,
      referenciaId: m.referenciaId,
      sequencia: m.sequencia,
      fornecedor: m.fornecedor?.nome ?? null,
      destino: m.destino,
      estado: m.estado,
      motivoBloqueio: m.motivoBloqueio,
      simulada: m.simulada,
      ehTeste: m.ehTeste,
      tentativas: m.tentativas,
      ultimoErro: m.ultimoErro,
      enfileiradaEm: m.enfileiradaEm,
      aceitaEm: m.aceitaEm,
      incertaEm: m.incertaEm,
      falhouEm: m.falhouEm,
      enviadaAMaoEm: m.enviadaAMaoEm,
      resolucao: m.resolucao,
      // O número do cadastro mudou depois de enfileirar: a fila NÃO segue
      // sozinha — alguém decide, com `atualizarDestino`.
      destinoMudou:
        ["BLOQUEADA", "NA_FILA", "FALHOU"].includes(m.estado) &&
        !!m.fornecedor &&
        m.destino !== null &&
        m.fornecedor.telefonePedidos !== m.destino,
    })),
  };
}

/** A mensagem de um pedido (a mais recente), para a linha do tempo do envio. */
export async function mensagensDaReferencia(
  referenciaTipo: string,
  referenciaId: string,
) {
  return db.mensagemAoFornecedor.findMany({
    where: { referenciaTipo, referenciaId },
    orderBy: { enfileiradaEm: "asc" },
  });
}
