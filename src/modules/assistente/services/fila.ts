import { db } from "@/server/db";

import { desistiu, proximaTentativa } from "../schemas/ritmo";

/**
 * A FILA DE SAÍDA.
 *
 * A Severina grava "mande esta mensagem"; quem entrega é o relógio, na camada
 * `app/`. A separação nasceu de uma trava do linter — módulo não importa
 * conector — e virou a peça que sustenta três coisas:
 *
 *   WhatsApp fora do ar às 7h  →  a mensagem sai às 7h01, não se perde
 *   Reenvio                    →  não duplica, porque o estado está no banco
 *   Ritmo                      →  existe um lugar onde segurar a mão
 *
 * Este arquivo NÃO envia nada. Ele grava e lê.
 */

export type MensagemDaFila = {
  id: string;
  texto: string;
  telefone: string;
  tentativas: number;
};

export async function enfileirar(dados: {
  conversaId: string;
  texto: string;
  origem: string;
}): Promise<void> {
  await db.mensagemWhatsapp.create({
    data: {
      conversaId: dados.conversaId,
      direcao: "SAIDA",
      tipo: "TEXTO",
      texto: dados.texto,
      origem: dados.origem,
      status: "PENDENTE",
    },
  });

  await db.conversaWhatsapp.update({
    where: { id: dados.conversaId },
    data: { ultimaMensagemEm: new Date() },
  });
}

/**
 * As mensagens prontas para sair, mais antigas primeiro.
 *
 * O telefone vem em duas consultas e não em `include` porque a Severina não
 * declara relação com `Usuario` — é a regra nº 2 do projeto, e o preço dela
 * está escrito em `assistente.prisma`.
 *
 * Mensagem cujo destinatário perdeu o vínculo simplesmente não aparece aqui.
 * Fica PENDENTE até alguém revincular ou o agente ser desligado — melhor uma
 * mensagem parada e visível do que uma tentativa de envio para o vazio.
 */
export async function pendentes(limite: number): Promise<MensagemDaFila[]> {
  const agora = new Date();

  const mensagens = await db.mensagemWhatsapp.findMany({
    where: {
      direcao: "SAIDA",
      status: "PENDENTE",
      texto: { not: null },
      // `agendadaPara` vazio é "pode ir agora"; preenchido é espera de retentativa.
      OR: [{ agendadaPara: null }, { agendadaPara: { lte: agora } }],
      // Toda mensagem desta fila é de agente, ou seja, automática. "Pausar
      // agendamentos" segura também o que já estava na fila, inclusive a
      // retentativa: pausado quer dizer que nada sai sozinho.
      conversa: {
        instancia: {
          ativa: true,
          excluidoEm: null,
          agendamentosPausados: false,
        },
      },
    },
    orderBy: { criadoEm: "asc" },
    take: limite,
    select: {
      id: true,
      texto: true,
      tentativas: true,
      conversa: { select: { usuarioId: true, organizacaoId: true } },
    },
  });

  if (mensagens.length === 0) return [];

  const vinculos = await db.vinculoWhatsapp.findMany({
    where: {
      usuarioId: { in: mensagens.map((m) => m.conversa.usuarioId) },
      excluidoEm: null,
    },
    select: { usuarioId: true, organizacaoId: true, telefone: true },
  });

  const porPessoa = new Map(
    vinculos.map((v) => [`${v.organizacaoId}:${v.usuarioId}`, v.telefone]),
  );

  return mensagens.flatMap((m) => {
    const telefone = porPessoa.get(
      `${m.conversa.organizacaoId}:${m.conversa.usuarioId}`,
    );
    if (!telefone || !m.texto) return [];
    return [{ id: m.id, texto: m.texto, telefone, tentativas: m.tentativas }];
  });
}

export async function marcarEnviada(
  id: string,
  idExterno: string,
): Promise<void> {
  await db.mensagemWhatsapp.update({
    where: { id },
    data: { status: "ENVIADA", idExterno, enviadaEm: new Date(), erro: null },
  });
}

/**
 * Falhou: conta a tentativa e adia a próxima.
 *
 * Depois do teto, vira FALHOU e aparece em destaque na tela — fila que tenta
 * para sempre é fila que esconde o problema.
 */
export async function marcarFalha(
  id: string,
  erro: string,
  tentativas: number,
): Promise<void> {
  const agora = new Date();

  await db.mensagemWhatsapp.update({
    where: { id },
    data: {
      tentativas,
      erro: erro.slice(0, 500),
      ...(desistiu(tentativas)
        ? { status: "FALHOU" as const }
        : { agendadaPara: proximaTentativa(tentativas, agora) }),
    },
  });
}
