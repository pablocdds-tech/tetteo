import { contextoDeFundo } from "@/core/sessao/contexto";
import { PARTICIPANTES } from "@/registro-de-ferramentas";
import { redigirAviso } from "@/server/ia/gemini";
import { db } from "@/server/db";

import { dentroDaJanela, deveDispararAgora } from "../schemas/gatilho";
import type { ConfigHorario, Limites } from "../schemas/gatilho";

import { enfileirar } from "./fila";

/**
 * O DISPARO — quem vence agora, para quem falar, e com que texto.
 *
 * Roda no relógio, sem ninguém logado. Por isso monta um `ContextoSessao` a
 * partir do banco para cada destinatário: daí em diante todo serviço do
 * sistema é chamado exatamente como seria por uma tela, com as permissões
 * daquela pessoa.
 *
 * Uma consequência que não é acidente: cada um só ouve o que teria direito de
 * ver na tela. Quem não tem `estoque.ver` não recebe cobrança de contagem —
 * não por regra escrita aqui, mas porque a consulta recusa.
 */

/** Marca de origem que identifica o aviso e impede a repetição. */
function origemDe(agenteId: string, chaveDoAviso?: string): string {
  return chaveDoAviso
    ? `agente:${agenteId}:${chaveDoAviso}`
    : `agente:${agenteId}`;
}

function inicioDoDia(agora: Date): Date {
  return new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
}

/**
 * Quem recebe as mensagens deste agente.
 *
 * Só entra quem tem VÍNCULO: sem número ligado à pessoa não há para onde
 * mandar, e a alternativa — tentar e falhar — encheria a fila de erro.
 */
async function destinatarios(agente: {
  organizacaoId: string;
  unidadeId: string | null;
  destinatariosUsuarios: string[];
  destinatariosPapeis: string[];
}): Promise<string[]> {
  const ids = new Set(agente.destinatariosUsuarios);

  if (agente.destinatariosPapeis.length > 0) {
    const acessos = await db.acesso.findMany({
      where: {
        organizacaoId: agente.organizacaoId,
        status: "ATIVO",
        excluidoEm: null,
        papel: { nome: { in: agente.destinatariosPapeis } },
        // Agente de uma loja fala com quem é daquela loja e com quem é da rede.
        ...(agente.unidadeId
          ? { OR: [{ unidadeId: agente.unidadeId }, { unidadeId: null }] }
          : {}),
      },
      select: { usuarioId: true },
    });
    for (const a of acessos) ids.add(a.usuarioId);
  }

  if (ids.size === 0) return [];

  const vinculados = await db.vinculoWhatsapp.findMany({
    where: {
      organizacaoId: agente.organizacaoId,
      usuarioId: { in: [...ids] },
      excluidoEm: null,
    },
    select: { usuarioId: true },
  });

  return [...new Set(vinculados.map((v) => v.usuarioId))];
}

/** A conversa daquele agente com aquela pessoa. Reaproveita a que está aberta. */
async function conversaDe(
  agente: { id: string; organizacaoId: string; unidadeId: string | null },
  instanciaId: string,
  usuarioId: string,
  remoteJid: string,
): Promise<string> {
  const aberta = await db.conversaWhatsapp.findFirst({
    where: {
      agenteId: agente.id,
      usuarioId,
      estado: "ABERTA",
      instanciaId,
    },
    select: { id: true },
  });
  if (aberta) return aberta.id;

  const nova = await db.conversaWhatsapp.create({
    data: {
      instanciaId,
      agenteId: agente.id,
      organizacaoId: agente.organizacaoId,
      unidadeId: agente.unidadeId,
      remoteJid,
      usuarioId,
    },
    select: { id: true },
  });
  return nova.id;
}

/** Este aviso já saiu hoje, nesta conversa? */
async function jaFalouHoje(
  conversaId: string,
  origem: string,
  agora: Date,
): Promise<boolean> {
  const anterior = await db.mensagemWhatsapp.findFirst({
    where: { conversaId, origem, criadoEm: { gte: inicioDoDia(agora) } },
    select: { id: true },
  });
  return anterior !== null;
}

/**
 * Percorre os agentes ativos e enfileira o que tiver de ser dito.
 *
 * Devolve quantas mensagens entraram na fila. Não envia nenhuma — quem entrega
 * é o relógio, que é a única camada que alcança módulo e conector.
 */
export async function dispararAgentes(agora: Date): Promise<number> {
  const agentes = await db.agenteSeverina.findMany({
    where: { ativo: true, excluidoEm: null, tipo: "AVISO" },
  });

  let enfileiradas = 0;

  for (const agente of agentes) {
    const limites = (agente.limites ?? {}) as Limites;
    // A janela é LIMITE, não instrução: um agente com defeito não acorda a
    // equipe às 3h da manhã.
    if (!dentroDaJanela(limites, agora)) continue;

    const instancia = await db.instanciaWhatsapp.findFirst({
      where: {
        organizacaoId: agente.organizacaoId,
        ativa: true,
        excluidoEm: null,
      },
      select: { id: true },
    });
    // Sem número ligado, ou com a chave geral desligada, a Severina cala.
    if (!instancia) continue;

    const pessoas = await destinatarios(agente);
    if (pessoas.length === 0) continue;

    for (const usuarioId of pessoas) {
      const vinculo = await db.vinculoWhatsapp.findFirst({
        where: {
          organizacaoId: agente.organizacaoId,
          usuarioId,
          excluidoEm: null,
        },
        select: { remoteJid: true },
      });
      if (!vinculo) continue;

      const contexto = await contextoDeFundo(usuarioId, agente.unidadeId);
      // Acesso revogado, unidade que a pessoa não enxerga mais: não é erro,
      // é alguém que saiu. Segue para o próximo.
      if (!contexto) continue;

      // Os fatos a comunicar. HORARIO fala sozinho; ROTINA_VENCIDA pergunta
      // aos módulos.
      const fatos: { chave?: string; assunto: string }[] = [];

      if (agente.gatilho === "HORARIO") {
        const config = (agente.gatilhoConfig ?? {}) as unknown as ConfigHorario;

        const ultima = await db.mensagemWhatsapp.findFirst({
          where: {
            origem: origemDe(agente.id),
            conversa: { agenteId: agente.id, usuarioId },
          },
          orderBy: { criadoEm: "desc" },
          select: { criadoEm: true },
        });

        if (deveDispararAgora(config, ultima?.criadoEm ?? null, agora)) {
          // Sem módulo envolvido: o próprio nome do agente é o assunto, e as
          // instruções do dono dizem o resto ao redator.
          fatos.push({ assunto: agente.nome });
        }
      }

      if (agente.gatilho === "ROTINA_VENCIDA") {
        for (const participante of PARTICIPANTES) {
          try {
            const avisos = await participante.avisos(contexto, agora);
            for (const aviso of avisos) {
              fatos.push({ chave: aviso.chave, assunto: aviso.assunto });
            }
          } catch {
            // Módulo quebrado, ou pessoa sem permissão de ver aquele App, não
            // pode calar a Severina inteira. Passa para o próximo módulo.
            continue;
          }
        }
      }

      if (fatos.length === 0) continue;

      const conversaId = await conversaDe(
        agente,
        instancia.id,
        usuarioId,
        vinculo.remoteJid,
      );

      for (const fato of fatos) {
        const origem = origemDe(agente.id, fato.chave);
        if (await jaFalouHoje(conversaId, origem, agora)) continue;

        const texto = await redigirAviso({
          instrucoes: agente.instrucoes,
          contexto: fato.assunto,
        });

        await enfileirar({ conversaId, texto, origem });
        enfileiradas++;
      }
    }
  }

  return enfileiradas;
}
