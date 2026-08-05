import { pode, type ContextoSessao } from "@/core/sessao/contexto";
import { SemPermissao } from "@/lib/erros";
import { db } from "@/server/db";

/**
 * AS CONVERSAS — a tela onde se vê o que a Severina andou fazendo.
 *
 * O que ela precisa responder, em ordem de urgência:
 *   1. Alguma mensagem FALHOU?  ← a única falha que importa nesta fase
 *   2. Tem coisa parada na fila?
 *   3. O que foi dito, para quem, e por causa de qual agente?
 *
 * Aviso que não saiu é o defeito mais caro da fase 1, e o mais silencioso.
 * Por isso ele vem primeiro na lista, não em ordem cronológica.
 */

export type ConversaNaLista = {
  id: string;
  pessoa: string;
  unidadeNome: string | null;
  agenteNome: string;
  ultimaMensagemEm: Date;
  ultimoTexto: string | null;
  falhas: number;
  pendentes: number;
};

export async function listarConversas(
  contexto: ContextoSessao,
  limite = 50,
): Promise<ConversaNaLista[]> {
  if (!pode(contexto, "assistente.ver")) {
    throw new SemPermissao("ver as conversas da Severina");
  }

  const conversas = await db.conversaWhatsapp.findMany({
    where: {
      organizacaoId: contexto.organizacao.id,
      // Quem está numa unidade vê só a dela; quem vê a rede, vê tudo.
      ...(contexto.unidadeAtiva
        ? { OR: [{ unidadeId: contexto.unidadeAtiva.id }, { unidadeId: null }] }
        : {}),
    },
    orderBy: { ultimaMensagemEm: "desc" },
    take: limite,
    include: {
      agente: { select: { nome: true } },
      mensagens: {
        orderBy: { criadoEm: "desc" },
        select: { texto: true, status: true, direcao: true },
      },
    },
  });

  const [pessoas, unidades] = await Promise.all([
    db.usuario.findMany({
      where: { id: { in: conversas.map((c) => c.usuarioId) } },
      select: { id: true, nome: true },
    }),
    db.unidade.findMany({
      where: { organizacaoId: contexto.organizacao.id },
      select: { id: true, nome: true },
    }),
  ]);
  const nomeDaPessoa = new Map(pessoas.map((p) => [p.id, p.nome]));
  const nomeDaUnidade = new Map(unidades.map((u) => [u.id, u.nome]));

  const lista = conversas.map((c) => ({
    id: c.id,
    pessoa: nomeDaPessoa.get(c.usuarioId) ?? "(usuário removido)",
    unidadeNome: c.unidadeId ? (nomeDaUnidade.get(c.unidadeId) ?? null) : null,
    agenteNome: c.agente.nome,
    ultimaMensagemEm: c.ultimaMensagemEm,
    ultimoTexto: c.mensagens[0]?.texto ?? null,
    falhas: c.mensagens.filter((m) => m.status === "FALHOU").length,
    pendentes: c.mensagens.filter((m) => m.status === "PENDENTE").length,
  }));

  // Falha primeiro, depois fila parada, depois cronológico. Uma tela de
  // histórico ordenada só por data esconde justamente o que precisa de ação.
  return lista.sort((a, b) => {
    if (a.falhas !== b.falhas) return b.falhas - a.falhas;
    if (a.pendentes !== b.pendentes) return b.pendentes - a.pendentes;
    return b.ultimaMensagemEm.getTime() - a.ultimaMensagemEm.getTime();
  });
}

export type MensagemNaLinha = {
  id: string;
  direcao: "ENTRADA" | "SAIDA";
  texto: string | null;
  status: string;
  erro: string | null;
  tentativas: number;
  criadoEm: Date;
  enviadaEm: Date | null;
};

export async function obterConversa(contexto: ContextoSessao, id: string) {
  if (!pode(contexto, "assistente.ver")) {
    throw new SemPermissao("ver as conversas da Severina");
  }

  const conversa = await db.conversaWhatsapp.findFirst({
    where: { id, organizacaoId: contexto.organizacao.id },
    include: {
      agente: { select: { nome: true, instrucoes: true } },
      mensagens: { orderBy: { criadoEm: "asc" } },
    },
  });
  if (!conversa) return null;

  const pessoa = await db.usuario.findUnique({
    where: { id: conversa.usuarioId },
    select: { nome: true },
  });

  return {
    id: conversa.id,
    pessoa: pessoa?.nome ?? "(usuário removido)",
    agenteNome: conversa.agente.nome,
    mensagens: conversa.mensagens.map((m): MensagemNaLinha => ({
      id: m.id,
      direcao: m.direcao,
      texto: m.texto,
      status: m.status,
      erro: m.erro,
      tentativas: m.tentativas,
      criadoEm: m.criadoEm,
      enviadaEm: m.enviadaEm,
    })),
  };
}
