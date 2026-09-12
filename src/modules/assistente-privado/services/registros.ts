import { Prisma, type RegistroDoAssistente } from "@prisma/client";

import { pode, type ContextoSessao } from "@/core/sessao/nucleo";
import { db } from "@/server/db";

import { PERMISSAO_VER_ASSISTENTE_PRIVADO } from "../permissoes";
import {
  montarCartao,
  type DadosDoCartao,
  type RegistroParaCartao,
} from "../schemas/cartao";
import type { CorpoDoRegistro } from "../schemas/registro";

/**
 * OS RECADOS DO ASSISTENTE PRIVADO.
 *
 * Gravar é por CHAVE: a mesma chave atualiza a mesma linha. Duas regras
 * impedem que um recado atrasado estrague o que já se sabe: um recado mais
 * antigo não passa por cima de um mais novo, e um fechamento concluído ou
 * cancelado não volta a "calculado".
 *
 * A unidade vem da configuração do servidor, nunca do recado — quem escreve é
 * a máquina, e ela não escolhe onde escreve.
 */

export class UnidadeNaoConfigurada extends Error {
  constructor() {
    super(
      "A unidade configurada para o assistente privado não existe ou está inativa.",
    );
    this.name = "UnidadeNaoConfigurada";
  }
}

const ESTADOS_FINAIS = ["concluido", "cancelado"];

function colunas(corpo: CorpoDoRegistro) {
  const comum = {
    tipo:
      corpo.tipo === "execucao"
        ? ("EXECUCAO" as const)
        : ("VERIFICACAO" as const),
    estado: corpo.estado,
    demonstracao: corpo.demonstracao,
    avisos: corpo.avisos,
    pendencias: corpo.pendencias,
    detalhe: corpo.detalhe ?? null,
    versaoOpenclaw: corpo.versaoOpenclaw ?? null,
    modelo: corpo.modelo ?? null,
    ocorridoEm: new Date(corpo.ocorridoEm),
  };
  if (corpo.tipo === "execucao") {
    return {
      ...comum,
      periodoDe: corpo.periodo?.de ?? null,
      periodoAte: corpo.periodo?.ate ?? null,
      fonte: corpo.fonte ?? null,
      indicadores: corpo.indicadores ?? Prisma.DbNull,
      proximaRotina: null,
      rotinaPausada: null,
      limiteAte: null,
    };
  }
  return {
    ...comum,
    periodoDe: null,
    periodoAte: null,
    fonte: null,
    indicadores: Prisma.DbNull,
    proximaRotina: corpo.proximaRotina ? new Date(corpo.proximaRotina) : null,
    rotinaPausada: corpo.rotinaPausada ?? null,
    limiteAte: corpo.limiteAte ? new Date(corpo.limiteAte) : null,
  };
}

async function auditar(
  unidade: { id: string; organizacaoId: string },
  acao: "CRIOU" | "ALTEROU",
  entidadeId: string,
  antes: Prisma.InputJsonObject | null,
  depois: Prisma.InputJsonObject,
) {
  await db.auditoria.create({
    data: {
      organizacaoId: unidade.organizacaoId,
      unidadeId: unidade.id,
      usuarioId: null,
      entidade: "RegistroDoAssistente",
      entidadeId,
      acao,
      valoresAntes: antes ?? undefined,
      valoresDepois: depois,
      navegador: "assistente privado (OpenClaw)",
    },
  });
}

export async function gravarRegistro(
  unidadeId: string,
  corpo: CorpoDoRegistro,
): Promise<{ id: string; gravado: boolean }> {
  const unidade = await db.unidade.findFirst({
    where: { id: unidadeId, ativa: true, excluidoEm: null },
    select: { id: true, organizacaoId: true },
  });
  if (!unidade) throw new UnidadeNaoConfigurada();

  const dados = colunas(corpo);
  const existente = await db.registroDoAssistente.findUnique({
    where: { unidadeId_chave: { unidadeId, chave: corpo.chave } },
  });

  if (existente) {
    const maisAntigo =
      existente.ocorridoEm.getTime() > dados.ocorridoEm.getTime();
    const regrediria =
      ESTADOS_FINAIS.includes(existente.estado) && corpo.estado === "calculado";
    if (maisAntigo || regrediria) return { id: existente.id, gravado: false };
    await db.registroDoAssistente.update({
      where: { id: existente.id },
      data: dados,
    });
    if (existente.estado !== dados.estado) {
      await auditar(
        unidade,
        "ALTEROU",
        existente.id,
        { estado: existente.estado },
        { estado: dados.estado },
      );
    }
    return { id: existente.id, gravado: true };
  }

  try {
    const criado = await db.registroDoAssistente.create({
      data: {
        ...dados,
        organizacaoId: unidade.organizacaoId,
        unidadeId,
        chave: corpo.chave,
      },
    });
    await auditar(unidade, "CRIOU", criado.id, null, {
      tipo: criado.tipo,
      chave: criado.chave,
      estado: criado.estado,
    });
    return { id: criado.id, gravado: true };
  } catch (erro) {
    // Corrida: outro recado com a mesma chave chegou no mesmo instante.
    if (
      erro instanceof Prisma.PrismaClientKnownRequestError &&
      erro.code === "P2002"
    ) {
      return gravarRegistro(unidadeId, corpo);
    }
    throw erro;
  }
}

function textos(valor: Prisma.JsonValue): string[] {
  return Array.isArray(valor)
    ? valor.filter((v): v is string => typeof v === "string")
    : [];
}

function paraCartao(r: RegistroDoAssistente): RegistroParaCartao {
  return {
    chave: r.chave,
    estado: r.estado,
    demonstracao: r.demonstracao,
    periodoDe: r.periodoDe,
    periodoAte: r.periodoAte,
    fonte: r.fonte,
    pendencias: textos(r.pendencias),
    detalhe: r.detalhe,
    proximaRotina: r.proximaRotina,
    rotinaPausada: r.rotinaPausada,
    limiteAte: r.limiteAte,
    ocorridoEm: r.ocorridoEm,
  };
}

/** O cartão da unidade ativa; `null` sem permissão ou sem unidade escolhida. */
export async function cartaoDoAssistente(
  contexto: ContextoSessao,
  agora = new Date(),
): Promise<DadosDoCartao | null> {
  if (
    !pode(contexto, PERMISSAO_VER_ASSISTENTE_PRIVADO) ||
    !contexto.unidadeAtiva
  )
    return null;
  const unidadeId = contexto.unidadeAtiva.id;
  // Duas consultas, de propósito: rascunho é "chave" que começa com
  // "rascunho:" (nunca um pedido), e uma leva de 20+ rascunhos mais novos
  // que o último fechamento de verdade não pode empurrá-lo para fora da
  // janela e fazer o cartão mentir "Nenhuma execução ainda".
  const [verificacao, ultimaExecucao, rascunhos] = await Promise.all([
    db.registroDoAssistente.findFirst({
      where: { unidadeId, tipo: "VERIFICACAO" },
      orderBy: { ocorridoEm: "desc" },
    }),
    db.registroDoAssistente.findFirst({
      where: {
        unidadeId,
        tipo: "EXECUCAO",
        NOT: { chave: { startsWith: "rascunho:" } },
      },
      orderBy: { ocorridoEm: "desc" },
    }),
    db.registroDoAssistente.findMany({
      where: {
        unidadeId,
        tipo: "EXECUCAO",
        chave: { startsWith: "rascunho:" },
      },
      orderBy: { ocorridoEm: "desc" },
      take: 20,
    }),
  ]);
  return montarCartao({
    verificacao: verificacao ? paraCartao(verificacao) : null,
    execucoes: [
      ...(ultimaExecucao ? [paraCartao(ultimaExecucao)] : []),
      ...rascunhos.map(paraCartao),
    ],
    agora,
  });
}
