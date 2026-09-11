import { createHash } from "node:crypto";

import type { Prisma, StatusEventoWhatsapp } from "@prisma/client";

import { pode, type ContextoSessao } from "@/core/sessao/contexto";
import { SemPermissao } from "@/lib/erros";
import { db } from "@/server/db";

import {
  estadoPeloStatusDoProvedor,
  type StatusDoProvedorNoAviso,
} from "../schemas/aviso";
import { consultaDoEventoDeConexao } from "../schemas/conexao";
import {
  MOTIVOS_DE_EVENTO,
  resumoDoEvento,
  ROTULO_DO_TIPO,
  type EventoNormalizado,
  type ResumoDoEvento,
  type TipoDeEvento,
} from "../schemas/evento";

import { listarConexoes, marcarNoticia, registrarConsulta } from "./conexao";

/**
 * OS EVENTOS DO PROVEDOR — gravados uma vez, processados fora da requisição.
 *
 * A Evolution reenvia até dez vezes quando não tem certeza de que chegou. A
 * chave única (conexão + id externo) faz o repetido virar só `repeticoes + 1`:
 * a linha é a mesma, e o trabalho não se refaz.
 *
 * E a regra que impede ciclo de respostas por construção: NENHUM evento
 * dispara envio. O único caminho até a Evolution passa por um aviso
 * CONFIRMADO, e só uma pessoa confirma.
 */

const PARADO_APOS_MS = 30_000;
const MAX_TENTATIVAS = 3;
/** Ignorado é registro técnico, sem dado pessoal: some depois de 30 dias. */
const RETENCAO_DE_IGNORADOS_MS = 30 * 24 * 60 * 60_000;

type Desfecho = { status: StatusEventoWhatsapp; motivo: string | null };
const processado = (motivo: string | null = null): Desfecho => ({
  status: "PROCESSADO",
  motivo,
});
const ignorado = (motivo: string): Desfecho => ({ status: "IGNORADO", motivo });

function sha256(texto: string): string {
  return createHash("sha256").update(texto).digest("hex");
}

export async function registrarEvento(
  conexao: { id: string; organizacaoId: string },
  evento: EventoNormalizado,
  agora: Date,
): Promise<{ id: string; duplicado: boolean }> {
  const chave = {
    instanciaId_idExterno: {
      instanciaId: conexao.id,
      idExterno: evento.idExterno,
    },
  };
  const repeticao = {
    repeticoes: { increment: 1 },
    ultimaRepeticaoEm: agora,
  };

  try {
    const linha = await db.eventoWhatsapp.upsert({
      where: chave,
      create: {
        organizacaoId: conexao.organizacaoId,
        instanciaId: conexao.id,
        idExterno: evento.idExterno,
        tipo: evento.tipo,
        resumo: resumoDoEvento(evento),
        recebidoEm: agora,
      },
      update: repeticao,
      select: { id: true, repeticoes: true },
    });
    return { id: linha.id, duplicado: linha.repeticoes > 0 };
  } catch (erro) {
    // Duas entregas idênticas no mesmo instante: a segunda perde a corrida
    // do INSERT. Ela é, por definição, a repetida.
    if ((erro as { code?: string }).code !== "P2002") throw erro;
    const linha = await db.eventoWhatsapp.update({
      where: chave,
      data: repeticao,
      select: { id: true },
    });
    return { id: linha.id, duplicado: true };
  }
}

/** Remonta o evento a partir do resumo — para o que o relógio reprocessa. */
function eventoDaLinha(
  tipo: string,
  idExterno: string,
  resumo: Prisma.JsonValue,
): EventoNormalizado | null {
  const r = (resumo && typeof resumo === "object" ? resumo : {}) as Record<
    string,
    unknown
  >;
  switch (tipo) {
    case "connection.update": {
      const estado = r.estado;
      if (
        estado !== "open" &&
        estado !== "connecting" &&
        estado !== "close" &&
        estado !== "refused"
      ) {
        return null;
      }
      return {
        tipo,
        idExterno,
        estado,
        codigo: typeof r.codigo === "number" ? r.codigo : null,
        numero: null,
      };
    }
    case "messages.update":
      return {
        tipo,
        idExterno,
        idMensagem: String(r.idMensagem ?? ""),
        status: r.status as StatusDoProvedorNoAviso,
        deMim: r.deMim === true,
      };
    case "send.message":
      return {
        tipo,
        idExterno,
        idMensagem: String(r.idMensagem ?? ""),
        hashTexto: typeof r.hashTexto === "string" ? r.hashTexto : null,
        enviadaEm:
          typeof r.enviadaEm === "string" ? new Date(r.enviadaEm) : null,
      };
    case "messages.upsert":
      return {
        tipo,
        idExterno,
        idMensagem: String(r.idMensagem ?? ""),
        deMim: r.deMim === true,
        grupo: r.grupo === true,
        vinculoId: r.remetente === "vinculado" ? "vinculado" : null,
      };
    default:
      return null;
  }
}

async function aplicar(
  evento: EventoNormalizado,
  instanciaId: string,
  agora: Date,
): Promise<Desfecho> {
  switch (evento.tipo) {
    case "connection.update":
      await registrarConsulta(
        instanciaId,
        consultaDoEventoDeConexao(evento.estado),
        evento.numero,
        agora,
      );
      return processado();

    case "messages.update": {
      const aviso = await db.avisoWhatsapp.findFirst({
        where: { instanciaId, idMensagemProvedor: evento.idMensagem },
        select: { id: true, status: true },
      });
      if (!aviso) return ignorado(MOTIVOS_DE_EVENTO.naoEAviso);

      const novo = estadoPeloStatusDoProvedor(aviso.status, evento.status);
      if (!novo) return ignorado(MOTIVOS_DE_EVENTO.jaAvancado);

      // Cada etapa ganha horário só com a prova dela: "lido" não inventa
      // um "entregue" que não chegou.
      const etapa =
        novo === "ENTREGUE"
          ? { entregueEm: agora }
          : novo === "LIDO"
            ? { lidoEm: agora }
            : {
                falhouEm: agora,
                erro: "O WhatsApp informou erro na entrega desta mensagem.",
              };
      const { count } = await db.avisoWhatsapp.updateMany({
        where: { id: aviso.id, status: aviso.status },
        data: { status: novo, ...etapa },
      });
      return count === 1
        ? processado()
        : ignorado(MOTIVOS_DE_EVENTO.jaAvancado);
    }

    case "send.message": {
      const conhecido = await db.avisoWhatsapp.findFirst({
        where: { instanciaId, idMensagemProvedor: evento.idMensagem },
        select: { id: true },
      });
      if (conhecido) return processado("Confirmação do envio de um aviso.");

      // A mensagem saiu e o Tetteo não sabia: é o aviso cujo envio ficou com
      // resultado desconhecido. O texto — com a referência única — o acha.
      if (evento.hashTexto) {
        const incertos = await db.avisoWhatsapp.findMany({
          where: { instanciaId, status: "INCERTO" },
          select: { id: true, corpo: true },
        });
        const achado = incertos.find(
          (a) => sha256(a.corpo) === evento.hashTexto,
        );
        if (achado) {
          const { count } = await db.avisoWhatsapp.updateMany({
            where: { id: achado.id, status: "INCERTO" },
            data: {
              status: "ACEITO",
              idMensagemProvedor: evento.idMensagem,
              aceitoEm: evento.enviadaEm ?? agora,
              erro: null,
            },
          });
          if (count === 1) {
            return processado(
              "Resolveu um aviso com resultado desconhecido: a mensagem tinha saído.",
            );
          }
        }
      }
      return ignorado(MOTIVOS_DE_EVENTO.foraDoTetteo);
    }

    case "messages.upsert":
      if (evento.deMim) return ignorado(MOTIVOS_DE_EVENTO.proprio);
      if (evento.grupo) return ignorado(MOTIVOS_DE_EVENTO.grupo);
      if (!evento.vinculoId) return ignorado(MOTIVOS_DE_EVENTO.naoAutorizado);
      return ignorado(MOTIVOS_DE_EVENTO.respostas);
  }
}

/**
 * Processa um evento gravado. `evento` vem inteiro quando quem chama é o
 * próprio webhook (dentro do `after()`); o relógio, que reprocessa o que
 * ficou parado, só tem o resumo — e o resumo basta para tudo menos o número
 * do aparelho, que ele não guarda de propósito.
 */
export async function processarEvento(
  id: string,
  agora: Date,
  evento?: EventoNormalizado,
): Promise<StatusEventoWhatsapp | null> {
  const linha = await db.eventoWhatsapp.findUnique({
    where: { id },
    select: {
      id: true,
      tipo: true,
      idExterno: true,
      resumo: true,
      status: true,
      instanciaId: true,
      instancia: { select: { excluidoEm: true } },
    },
  });
  if (!linha) return null;
  // O `after()` e o relógio podem se cruzar: o que já terminou, terminou.
  if (linha.status === "PROCESSADO" || linha.status === "IGNORADO") {
    return linha.status;
  }

  let desfecho: Desfecho;
  try {
    if (linha.instancia.excluidoEm) {
      desfecho = ignorado(MOTIVOS_DE_EVENTO.conexaoDesconhecida);
    } else {
      const lido =
        evento ?? eventoDaLinha(linha.tipo, linha.idExterno, linha.resumo);
      desfecho = lido
        ? await aplicar(lido, linha.instanciaId, agora)
        : { status: "FALHOU", motivo: "Evento que o Tetteo não sabe ler." };
      await marcarNoticia(linha.instanciaId, agora);
    }
  } catch (erro) {
    const texto = erro instanceof Error ? erro.message : String(erro);
    desfecho = {
      status: "FALHOU",
      motivo: `Falha ao processar: ${texto.slice(0, 200)}`,
    };
  }

  await db.eventoWhatsapp.update({
    where: { id },
    data: {
      status: desfecho.status,
      motivo: desfecho.motivo,
      processadoEm: agora,
      tentativas: { increment: 1 },
    },
  });
  return desfecho.status;
}

/** O que ficou para trás: `after()` que morreu com o processo, ou falha. */
export async function eventosParados(agora: Date): Promise<string[]> {
  const linhas = await db.eventoWhatsapp.findMany({
    where: {
      OR: [
        {
          status: "RECEBIDO",
          recebidoEm: { lte: new Date(agora.getTime() - PARADO_APOS_MS) },
        },
        { status: "FALHOU", tentativas: { lt: MAX_TENTATIVAS } },
      ],
    },
    select: { id: true },
    orderBy: { recebidoEm: "asc" },
    take: 50,
  });
  return linhas.map((l) => l.id);
}

export async function limparIgnorados(agora: Date): Promise<number> {
  const { count } = await db.eventoWhatsapp.deleteMany({
    where: {
      status: "IGNORADO",
      recebidoEm: { lt: new Date(agora.getTime() - RETENCAO_DE_IGNORADOS_MS) },
    },
  });
  return count;
}

// ---------------------------------------------------------------------------
// A TELA "EVENTOS" — o painel de saúde, sem conteúdo pessoal
// ---------------------------------------------------------------------------

export type FiltroDeEventos = "todos" | "ignorados" | "duplicados" | "falhas";

export type ContagemDeEventos = {
  recebidos: number;
  processados: number;
  ignorados: number;
  duplicados: number;
  falhas: number;
};

export type EventoNaLista = {
  id: string;
  tipo: string;
  rotuloDoTipo: string;
  status: StatusEventoWhatsapp;
  motivo: string | null;
  repeticoes: number;
  recebidoEm: Date;
  processadoEm: Date | null;
  conexaoNome: string;
};

export type EventoNoDetalhe = EventoNaLista & {
  idExterno: string;
  resumo: ResumoDoEvento;
  tentativas: number;
  ultimaRepeticaoEm: Date | null;
};

async function idsDasConexoesVisiveis(contexto: ContextoSessao) {
  if (!pode(contexto, "assistente.ver")) {
    throw new SemPermissao("ver os eventos do WhatsApp");
  }
  const conexoes = await listarConexoes(contexto);
  return new Map(conexoes.map((c) => [c.id, c.nome]));
}

export async function contarEventos(
  contexto: ContextoSessao,
  desde: Date,
  ate?: Date,
): Promise<ContagemDeEventos> {
  const conexoes = await idsDasConexoesVisiveis(contexto);
  const onde = {
    instanciaId: { in: [...conexoes.keys()] },
    recebidoEm: { gte: desde, ...(ate ? { lt: ate } : {}) },
  };

  const [porStatus, soma] = await Promise.all([
    db.eventoWhatsapp.groupBy({
      by: ["status"],
      where: onde,
      _count: { _all: true },
    }),
    db.eventoWhatsapp.aggregate({ where: onde, _sum: { repeticoes: true } }),
  ]);

  const de = (status: StatusEventoWhatsapp) =>
    porStatus.find((l) => l.status === status)?._count._all ?? 0;
  return {
    recebidos: porStatus.reduce((total, l) => total + l._count._all, 0),
    processados: de("PROCESSADO"),
    ignorados: de("IGNORADO"),
    duplicados: soma._sum.repeticoes ?? 0,
    falhas: de("FALHOU"),
  };
}

/**
 * A lista já vem com o detalhe: o resumo é uma lista fechada de campos
 * pequenos (estado, id, status, hash), e abrir um evento não deve custar uma
 * ida ao servidor.
 */
export async function listarEventos(
  contexto: ContextoSessao,
  filtro: { desde: Date; tipo: FiltroDeEventos },
  limite = 100,
): Promise<EventoNoDetalhe[]> {
  const conexoes = await idsDasConexoesVisiveis(contexto);
  const linhas = await db.eventoWhatsapp.findMany({
    where: {
      instanciaId: { in: [...conexoes.keys()] },
      recebidoEm: { gte: filtro.desde },
      ...(filtro.tipo === "ignorados" ? { status: "IGNORADO" as const } : {}),
      ...(filtro.tipo === "falhas" ? { status: "FALHOU" as const } : {}),
      ...(filtro.tipo === "duplicados" ? { repeticoes: { gt: 0 } } : {}),
    },
    orderBy: { recebidoEm: "desc" },
    take: limite,
  });

  return linhas.map((l) => ({
    id: l.id,
    tipo: l.tipo,
    rotuloDoTipo: ROTULO_DO_TIPO[l.tipo as TipoDeEvento] ?? l.tipo,
    status: l.status,
    motivo: l.motivo,
    repeticoes: l.repeticoes,
    recebidoEm: l.recebidoEm,
    processadoEm: l.processadoEm,
    conexaoNome: conexoes.get(l.instanciaId) ?? "",
    idExterno: l.idExterno,
    resumo: (l.resumo ?? {}) as ResumoDoEvento,
    tentativas: l.tentativas,
    ultimaRepeticaoEm: l.ultimaRepeticaoEm,
  }));
}

export async function obterEvento(
  contexto: ContextoSessao,
  id: string,
): Promise<EventoNoDetalhe | null> {
  const conexoes = await idsDasConexoesVisiveis(contexto);
  const l = await db.eventoWhatsapp.findFirst({
    where: { id, instanciaId: { in: [...conexoes.keys()] } },
  });
  if (!l) return null;
  return {
    id: l.id,
    tipo: l.tipo,
    rotuloDoTipo: ROTULO_DO_TIPO[l.tipo as TipoDeEvento] ?? l.tipo,
    status: l.status,
    motivo: l.motivo,
    repeticoes: l.repeticoes,
    recebidoEm: l.recebidoEm,
    processadoEm: l.processadoEm,
    conexaoNome: conexoes.get(l.instanciaId) ?? "",
    idExterno: l.idExterno,
    resumo: (l.resumo ?? {}) as ResumoDoEvento,
    tentativas: l.tentativas,
    ultimaRepeticaoEm: l.ultimaRepeticaoEm,
  };
}
