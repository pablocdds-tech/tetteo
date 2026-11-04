import {
  contextoDeFundo,
  pode,
  type ContextoSessao,
} from "@/core/sessao/nucleo";
import { ehGrupo, normalizarTelefone } from "@/lib/telefone";
import { db } from "@/server/db";

/**
 * Reconstrói a autorização da pessoa na loja do número a cada etapa da nota.
 * Autorizar avisos é uma adesão do responsável, nunca uma permissão financeira.
 */
export async function contextoParaNota(
  instanciaId: string,
  vinculoId: string,
): Promise<{ contexto: ContextoSessao; destinatario: string } | null> {
  const instancia = await db.instanciaWhatsapp.findFirst({
    where: { id: instanciaId, ativa: true, excluidoEm: null },
    select: { organizacaoId: true, unidadeId: true },
  });
  if (!instancia) return null;

  const [unidades, vinculo] = await Promise.all([
    db.unidade.findMany({
      where: {
        ...(instancia.unidadeId ? { id: instancia.unidadeId } : {}),
        organizacaoId: instancia.organizacaoId,
        ativa: true,
        excluidoEm: null,
      },
      select: { id: true },
      take: 2,
    }),
    db.vinculoWhatsapp.findFirst({
      where: {
        id: vinculoId,
        organizacaoId: instancia.organizacaoId,
        autorizadoEm: { not: null },
        excluidoEm: null,
      },
      select: { usuarioId: true, telefone: true, remoteJid: true },
    }),
  ]);
  // Sem loja escolhida, só há uma resolução segura quando a organização
  // inteira tem uma única unidade ativa, independente do acesso da pessoa.
  const unidade = unidades.length === 1 ? unidades[0] : null;
  if (!unidade || !vinculo || ehGrupo(vinculo.remoteJid)) return null;
  const destinatario = normalizarTelefone(vinculo.telefone);
  if (!destinatario || !/^\d{10,15}$/.test(destinatario)) return null;

  const [usuario, contexto] = await Promise.all([
    db.usuario.findFirst({
      where: { id: vinculo.usuarioId, status: "ATIVO", excluidoEm: null },
      select: { id: true },
    }),
    contextoDeFundo(vinculo.usuarioId, unidade.id),
  ]);
  if (
    !usuario ||
    !contexto ||
    contexto.organizacao.id !== instancia.organizacaoId ||
    contexto.unidadeAtiva?.id !== unidade.id ||
    ![
      "assistente.ver",
      "estoque.lancar",
      "financeiro.ver",
      "financeiro.lancar",
    ].every((permissao) => pode(contexto, permissao))
  )
    return null;

  return { contexto, destinatario };
}
