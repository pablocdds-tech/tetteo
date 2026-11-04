import { randomUUID } from "node:crypto";
import type { MensagemNotaWhatsapp, Prisma } from "@prisma/client";
import { provedorPara } from "@/connectors/whatsapp";
import type { ResultadoEnvio } from "@/connectors/whatsapp/tipos";
import { contextoParaNota } from "@/modules/assistente/services/contexto-nota";
import { db } from "@/server/db";
import { tratarMensagemNota } from "./notas-conversa";

const LEASE_MS = 120_000;
const RITMO_MS = 4_000;
const MAX_TENTATIVAS = 3;
type Ambiente = Record<string, string | undefined>;
type Mensagem = MensagemNotaWhatsapp & {
  conversa: {
    organizacaoId: string;
    unidadeId: string;
    usuarioId: string;
    vinculoId: string;
    notaAtivaId: string | null;
  };
};

export type ResumoNotasWhatsapp = {
  processadas: number;
  enviadas: number;
  incertas: number;
  falhas: number;
};

async function autorizacao(m: Mensagem) {
  const autorizado = await contextoParaNota(
    m.instanciaId,
    m.conversa.vinculoId,
  );
  if (
    !autorizado ||
    autorizado.contexto.organizacao.id !== m.conversa.organizacaoId ||
    autorizado.contexto.unidadeAtiva?.id !== m.conversa.unidadeId ||
    autorizado.contexto.usuario.id !== m.conversa.usuarioId
  )
    return null;
  return autorizado;
}

/** Uma pergunta antiga também perde a validade quando a revisão muda. */
async function resumoAtual(tx: Prisma.TransactionClient, m: Mensagem) {
  if (m.tipo !== "RESUMO") return true;
  if (!m.notaId || m.conversa.notaAtivaId !== m.notaId) return false;
  const nota = await tx.notaFiscalWhatsapp.findFirst({
    where: {
      id: m.notaId,
      organizacaoId: m.conversa.organizacaoId,
      unidadeId: m.conversa.unidadeId,
      instanciaId: m.instanciaId,
      vinculoId: m.conversa.vinculoId,
      usuarioId: m.conversa.usuarioId,
      estado: { in: ["REVISAO", "PRONTA"] },
    },
    select: { id: true, revisao: true, expiraEm: true },
  });
  return (
    !!nota &&
    m.idExterno === `resumo:${nota.id}:${nota.revisao}` &&
    (!nota.expiraEm || nota.expiraEm > new Date())
  );
}

async function registrarAceite(
  m: Mensagem,
  idEnviado: string,
  enviadaEm: Date,
  esperado: "ENVIANDO" | "INCERTA",
) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM conversa_nota_whatsapp WHERE id=${m.conversaId} FOR UPDATE`;
    const conversa = await tx.conversaNotaWhatsapp.findUniqueOrThrow({
      where: { id: m.conversaId },
    });
    const mudou = await tx.mensagemNotaWhatsapp.updateMany({
      where: { id: m.id, estado: esperado, tentativas: m.tentativas },
      data: { estado: "ENVIADA", idEnviado, enviadaEm },
    });
    if (!mudou.count) return false;
    if (
      m.tipo === "RESUMO" &&
      m.notaId &&
      (await resumoAtual(tx, { ...m, conversa }))
    ) {
      const prefixo = `resumo:${m.notaId}:`;
      const revisao = Number(m.idExterno.slice(prefixo.length));
      await tx.notaFiscalWhatsapp.updateMany({
        where: {
          id: m.notaId,
          estado: "PRONTA",
          revisao,
          resumoEm: null,
          OR: [{ expiraEm: null }, { expiraEm: { gt: new Date() } }],
        },
        data: {
          resumoEm: enviadaEm,
          expiraEm: new Date(enviadaEm.getTime() + 30 * 60_000),
        },
      });
    }
    return true;
  });
}

async function falhaDeEntrada(
  m: MensagemNotaWhatsapp,
  dono: string,
): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM conversa_nota_whatsapp WHERE id=${m.conversaId} FOR UPDATE`;
    const conversa = await tx.conversaNotaWhatsapp.findUniqueOrThrow({
      where: { id: m.conversaId },
    });
    if (
      conversa.leaseDono !== dono ||
      !conversa.leaseAte ||
      conversa.leaseAte <= new Date()
    )
      return;
    const esgotou = m.tentativas >= MAX_TENTATIVAS;
    await tx.mensagemNotaWhatsapp.updateMany({
      where: { id: m.id, estado: "PROCESSANDO", tentativas: m.tentativas },
      data: { estado: esgotou ? "FALHA" : "PENDENTE" },
    });
    if (esgotou)
      await tx.mensagemNotaWhatsapp.upsert({
        where: {
          instanciaId_idExterno: {
            instanciaId: m.instanciaId,
            idExterno: `falha:${m.id}`,
          },
        },
        create: {
          conversaId: m.conversaId,
          instanciaId: m.instanciaId,
          idExterno: `falha:${m.id}`,
          direcao: "SAIDA",
          texto:
            "Não consegui concluir esta etapa após três tentativas. Confira a situação da nota no sistema antes de reenviá-la. Se você já confirmou, peça RESUMO para consultar ou retomar a mesma nota.",
          recebidoEm: new Date(),
        },
        update: {},
      });
  });
}

async function processarEntradas(
  limite: number,
  resumo: ResumoNotasWhatsapp,
  tratar: typeof tratarMensagemNota,
  instanciaId?: string,
) {
  const agora = new Date();
  const conversas = await db.conversaNotaWhatsapp.findMany({
    where: {
      ...(instanciaId ? { instanciaId } : {}),
      OR: [{ leaseAte: null }, { leaseAte: { lte: agora } }],
      mensagens: {
        some: {
          direcao: "ENTRADA",
          estado: { in: ["PENDENTE", "PROCESSANDO"] },
        },
      },
    },
    orderBy: { atualizadoEm: "asc" },
    take: limite,
    select: { id: true },
  });
  let tentadas = 0;
  for (const conversa of conversas) {
    if (tentadas >= limite) break;
    const dono = randomUUID();
    const pegou = await db.conversaNotaWhatsapp.updateMany({
      where: {
        id: conversa.id,
        OR: [{ leaseAte: null }, { leaseAte: { lte: new Date() } }],
      },
      data: { leaseDono: dono, leaseAte: new Date(Date.now() + LEASE_MS) },
    });
    if (!pegou.count) continue;
    const renovar = setInterval(() => {
      void db.conversaNotaWhatsapp
        .updateMany({
          where: {
            id: conversa.id,
            leaseDono: dono,
            leaseAte: { gt: new Date() },
          },
          data: { leaseAte: new Date(Date.now() + LEASE_MS) },
        })
        .catch(() => {
          // Sem renovação a posse expira; o serviço confere o lease nas escritas.
        });
    }, 30_000);
    renovar.unref();
    try {
      while (tentadas < limite) {
        const m = await db.mensagemNotaWhatsapp.findFirst({
          where: {
            conversaId: conversa.id,
            direcao: "ENTRADA",
            estado: { in: ["PENDENTE", "PROCESSANDO"] },
          },
          orderBy: [{ recebidoEm: "asc" }, { criadoEm: "asc" }, { id: "asc" }],
          include: { conversa: true },
        });
        if (!m) break;
        tentadas++;
        if (!(await autorizacao(m))) {
          await db.mensagemNotaWhatsapp.updateMany({
            where: { id: m.id, estado: { in: ["PENDENTE", "PROCESSANDO"] } },
            data: { estado: "CANCELADA" },
          });
          continue;
        }
        const reivindicada = await db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM conversa_nota_whatsapp WHERE id=${conversa.id} FOR UPDATE`;
          const atual = await tx.conversaNotaWhatsapp.findUniqueOrThrow({
            where: { id: conversa.id },
          });
          if (
            atual.leaseDono !== dono ||
            !atual.leaseAte ||
            atual.leaseAte <= new Date()
          )
            return null;
          if (m.tentativas >= MAX_TENTATIVAS) return m;
          const alterou = await tx.mensagemNotaWhatsapp.updateMany({
            where: { id: m.id, estado: m.estado, tentativas: m.tentativas },
            data: { estado: "PROCESSANDO", tentativas: { increment: 1 } },
          });
          return alterou.count
            ? { ...m, estado: "PROCESSANDO", tentativas: m.tentativas + 1 }
            : null;
        });
        if (!reivindicada) break;
        if (m.tentativas >= MAX_TENTATIVAS) {
          await falhaDeEntrada(reivindicada, dono);
          resumo.falhas++;
          continue;
        }
        try {
          await tratar(m.id, dono);
          await db.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM conversa_nota_whatsapp WHERE id=${conversa.id} FOR UPDATE`;
            const atual = await tx.conversaNotaWhatsapp.findUniqueOrThrow({
              where: { id: conversa.id },
            });
            if (
              atual.leaseDono === dono &&
              atual.leaseAte &&
              atual.leaseAte > new Date()
            ) {
              await tx.mensagemNotaWhatsapp.updateMany({
                where: { id: m.id, estado: "PROCESSANDO" },
                data: { estado: "PROCESSADA" },
              });
              resumo.processadas++;
            }
          });
        } catch {
          await falhaDeEntrada(reivindicada, dono);
          resumo.falhas++;
          // A recuperação fica para a próxima rodada, sem rede em laço fechado.
          break;
        }
      }
    } finally {
      clearInterval(renovar);
      await db.conversaNotaWhatsapp.updateMany({
        where: { id: conversa.id, leaseDono: dono },
        data: { leaseDono: null, leaseAte: null },
      });
    }
  }
}

async function recuperarEnvios(
  limite: number,
  env: Ambiente,
  resumo: ResumoNotasWhatsapp,
  instanciaId?: string,
) {
  await db.mensagemNotaWhatsapp.updateMany({
    where: {
      ...(instanciaId ? { instanciaId } : {}),
      direcao: "SAIDA",
      estado: "ENVIANDO",
      atualizadoEm: { lt: new Date(Date.now() - LEASE_MS) },
    },
    data: { estado: "INCERTA" },
  });
  const incertas = await db.mensagemNotaWhatsapp.findMany({
    where: {
      direcao: "SAIDA",
      estado: "INCERTA",
      ...(instanciaId ? { instanciaId } : {}),
    },
    orderBy: { atualizadoEm: "asc" },
    take: limite,
    include: { conversa: true },
  });
  for (const m of incertas) {
    if (!m.texto || !(await autorizacao(m))) {
      await db.mensagemNotaWhatsapp.updateMany({
        where: { id: m.id, estado: "INCERTA" },
        data: { estado: "CANCELADA" },
      });
      continue;
    }
    const instancia = await db.instanciaWhatsapp.findUniqueOrThrow({
      where: { id: m.instanciaId },
    });
    try {
      const achada = await provedorPara(instancia, env).consultarMensagem({
        texto: m.texto,
        desde: m.enviadaEm ?? m.atualizadoEm,
      });
      if (achada.ok && achada.valor) {
        if (
          await registrarAceite(
            m,
            achada.valor.idMensagem,
            achada.valor.enviadaEm ?? new Date(),
            "INCERTA",
          )
        )
          resumo.enviadas++;
      } else {
        // Não encontrar não prova que não saiu. Nunca retorna a PENDENTE.
        await db.mensagemNotaWhatsapp.updateMany({
          where: { id: m.id, estado: "INCERTA" },
          data: { atualizadoEm: new Date() },
        });
        resumo.incertas++;
      }
    } catch {
      resumo.incertas++;
    }
  }
}

async function entregarSaidas(
  limite: number,
  env: Ambiente,
  resumo: ResumoNotasWhatsapp,
  instanciaId?: string,
) {
  const candidatas = await db.mensagemNotaWhatsapp.findMany({
    where: {
      direcao: "SAIDA",
      estado: "PENDENTE",
      ...(instanciaId ? { instanciaId } : {}),
    },
    orderBy: [{ recebidoEm: "asc" }, { criadoEm: "asc" }, { id: "asc" }],
    take: limite,
    include: { conversa: true },
  });
  for (const m of candidatas) {
    if (!m.texto || !(await autorizacao(m))) {
      await db.mensagemNotaWhatsapp.updateMany({
        where: { id: m.id, estado: "PENDENTE" },
        data: { estado: "CANCELADA" },
      });
      continue;
    }
    const pegada = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM instancia_whatsapp WHERE id=${m.instanciaId} FOR UPDATE`;
      const instancia = await tx.instanciaWhatsapp.findFirst({
        where: {
          id: m.instanciaId,
          organizacaoId: m.conversa.organizacaoId,
          OR: [{ unidadeId: m.conversa.unidadeId }, { unidadeId: null }],
          ativa: true,
          excluidoEm: null,
        },
      });
      if (!instancia) return null;
      // Relê a conversa dentro da transação: nota ativa pode ter mudado.
      await tx.$queryRaw`SELECT id FROM conversa_nota_whatsapp WHERE id=${m.conversaId} FOR UPDATE`;
      const conversa = await tx.conversaNotaWhatsapp.findUniqueOrThrow({
        where: { id: m.conversaId },
      });
      if (!(await resumoAtual(tx, { ...m, conversa }))) {
        await tx.mensagemNotaWhatsapp.updateMany({
          where: { id: m.id, estado: "PENDENTE" },
          data: { estado: "CANCELADA" },
        });
        return null;
      }
      const agora = new Date();
      if (
        instancia.ultimoEnvioEm &&
        agora.getTime() - instancia.ultimoEnvioEm.getTime() < RITMO_MS
      )
        return null;
      const emEnvio = await tx.mensagemNotaWhatsapp.findFirst({
        where: {
          conversaId: m.conversaId,
          direcao: "SAIDA",
          estado: "ENVIANDO",
        },
        select: { id: true },
      });
      if (emEnvio) return null;
      if (m.tentativas >= MAX_TENTATIVAS) {
        await tx.mensagemNotaWhatsapp.updateMany({
          where: { id: m.id, estado: "PENDENTE" },
          data: { estado: "FALHA" },
        });
        return null;
      }
      const mudou = await tx.mensagemNotaWhatsapp.updateMany({
        where: { id: m.id, estado: "PENDENTE", tentativas: m.tentativas },
        data: {
          estado: "ENVIANDO",
          tentativas: { increment: 1 },
          enviadaEm: agora,
        },
      });
      if (!mudou.count) return null;
      await tx.instanciaWhatsapp.update({
        where: { id: instancia.id },
        data: { ultimoEnvioEm: agora },
      });
      return { instancia, m: { ...m, tentativas: m.tentativas + 1 } };
    });
    if (!pegada) continue;
    const destino = await autorizacao(m);
    if (!destino) {
      await db.mensagemNotaWhatsapp.updateMany({
        where: { id: m.id, estado: "ENVIANDO" },
        data: { estado: "CANCELADA" },
      });
      continue;
    }
    let resultado: ResultadoEnvio;
    try {
      resultado = await provedorPara(pegada.instancia, env).enviarMensagem({
        para: destino.destinatario,
        texto: m.texto,
      });
    } catch {
      resultado = {
        tipo: "incerto",
        motivo: "Resultado de envio desconhecido.",
      };
    }
    try {
      if (resultado.tipo === "aceito") {
        if (
          await registrarAceite(
            pegada.m,
            resultado.idMensagem,
            resultado.aceitoEm,
            "ENVIANDO",
          )
        )
          resumo.enviadas++;
      } else {
        const estado =
          resultado.tipo === "incerto"
            ? "INCERTA"
            : resultado.tipo === "nao-chegou" &&
                pegada.m.tentativas < MAX_TENTATIVAS
              ? "PENDENTE"
              : "FALHA";
        await db.mensagemNotaWhatsapp.updateMany({
          where: {
            id: m.id,
            estado: "ENVIANDO",
            tentativas: pegada.m.tentativas,
          },
          data: { estado },
        });
        if (estado === "INCERTA") resumo.incertas++;
        if (estado === "FALHA") resumo.falhas++;
      }
    } catch {
      // Falha após a rede fica ENVIANDO e a recuperação só consulta, não reenvia.
      resumo.incertas++;
    }
  }
}

/** Banco coordena réplicas; nenhuma espera de ritmo segura esta requisição. */
export async function processarNotasWhatsapp({
  limite = 20,
  env = process.env,
  tratar = tratarMensagemNota,
  instanciaId,
}: {
  limite?: number;
  env?: Ambiente;
  tratar?: typeof tratarMensagemNota;
  instanciaId?: string;
} = {}): Promise<ResumoNotasWhatsapp> {
  const tamanho = Number.isSafeInteger(limite)
    ? Math.min(50, Math.max(1, limite))
    : 20;
  const resumo: ResumoNotasWhatsapp = {
    processadas: 0,
    enviadas: 0,
    incertas: 0,
    falhas: 0,
  };
  await recuperarEnvios(tamanho, env, resumo, instanciaId);
  await processarEntradas(tamanho, resumo, tratar, instanciaId);
  await entregarSaidas(tamanho, env, resumo, instanciaId);
  return resumo;
}
