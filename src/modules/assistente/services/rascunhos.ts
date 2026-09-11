import { PARTICIPANTES } from "@/registro-de-ferramentas";
import { db } from "@/server/db";

import { gerarReferencia, montarCorpo } from "../schemas/aviso";

/**
 * DE UM FATO A UM RASCUNHO.
 *
 * O relógio pergunta aos módulos: "o que aconteceu nas últimas 24 horas que
 * alguém deveria saber?". Cada fato vira UM rascunho — nunca uma mensagem.
 * Quem decide se sai, e para quem, é uma pessoa, na tela Avisos.
 *
 * A chave do fato é a chave de idempotência do aviso: o mesmo fechamento
 * perguntado sessenta vezes por hora continua sendo um rascunho só.
 */

const JANELA_MS = 24 * 60 * 60_000;

export async function coletarRascunhos(
  agora: Date,
  appUrl: string | null,
): Promise<number> {
  const conexoes = await db.instanciaWhatsapp.findMany({
    where: { excluidoEm: null },
    select: { id: true, organizacaoId: true, unidadeId: true },
    orderBy: { criadoEm: "asc" },
  });
  if (conexoes.length === 0) return 0;

  const desde = new Date(agora.getTime() - JANELA_MS);
  const base = appUrl ? appUrl.replace(/\/+$/, "") : null;
  let criados = 0;

  const porOrganizacao = new Map<string, typeof conexoes>();
  for (const c of conexoes) {
    porOrganizacao.set(c.organizacaoId, [
      ...(porOrganizacao.get(c.organizacaoId) ?? []),
      c,
    ]);
  }

  for (const [organizacaoId, daOrganizacao] of porOrganizacao) {
    // A conexão da loja vence a da rede; loja sem conexão não gera rascunho.
    const conexaoDaLoja = (unidadeId: string) =>
      daOrganizacao.find((c) => c.unidadeId === unidadeId) ??
      daOrganizacao.find((c) => c.unidadeId === null) ??
      null;

    const temDaRede = daOrganizacao.some((c) => c.unidadeId === null);
    const unidadeIds = temDaRede
      ? (
          await db.unidade.findMany({
            where: { organizacaoId, excluidoEm: null },
            select: { id: true },
          })
        ).map((u) => u.id)
      : daOrganizacao.flatMap((c) => (c.unidadeId ? [c.unidadeId] : []));

    for (const participante of PARTICIPANTES) {
      if (!participante.eventos) continue;

      let fatos;
      try {
        fatos = await participante.eventos(
          { organizacaoId, unidadeIds },
          desde,
        );
      } catch {
        // Módulo quebrado não cala os outros.
        continue;
      }
      if (fatos.length === 0) continue;

      const existentes = new Set(
        (
          await db.avisoWhatsapp.findMany({
            where: {
              organizacaoId,
              idPedido: { in: fatos.map((f) => f.chave) },
            },
            select: { idPedido: true },
          })
        ).map((a) => a.idPedido),
      );

      for (const fato of fatos) {
        if (existentes.has(fato.chave)) continue;
        const conexao = conexaoDaLoja(fato.unidadeId);
        if (!conexao) continue;

        const referencia = gerarReferencia();
        const link = base ? `${base}${fato.caminho}` : null;
        // `skipDuplicates`: se outro relógio criou o mesmo rascunho entre a
        // consulta acima e aqui, este simplesmente não entra.
        const { count } = await db.avisoWhatsapp.createMany({
          data: [
            {
              organizacaoId,
              unidadeId: fato.unidadeId,
              instanciaId: conexao.id,
              idPedido: fato.chave,
              referencia,
              origemTipo: fato.tipo,
              origemId: fato.referenciaId,
              permissaoNecessaria: fato.permissaoNecessaria,
              titulo: fato.titulo,
              corpo: montarCorpo({
                titulo: fato.titulo,
                linhas: fato.linhas,
                link,
                referencia,
              }),
              link,
            },
          ],
          skipDuplicates: true,
        });
        criados += count;
      }
    }
  }

  return criados;
}
