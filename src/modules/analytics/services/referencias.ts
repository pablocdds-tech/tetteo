import { pode, type ContextoSessao } from "@/core/sessao/nucleo";
import { SemPermissao } from "@/lib/erros";
import { db } from "@/server/db";
import {
  referenciaSchema,
  centavosInformados,
  ErroReferencia,
} from "../schemas/conferencia";
export async function registrarReferencia(
  contexto: ContextoSessao,
  entrada: unknown,
  repositorio = db,
) {
  const unidade = contexto.unidadeAtiva;
  if (
    !contexto.ehDiretor ||
    !pode(contexto, "analytics.ver") ||
    !unidade ||
    !contexto.unidadesVisiveis.some((u) => u.id === unidade.id)
  )
    throw new SemPermissao("registrar referência de fechamento");
  const dados = referenciaSchema.parse(entrada);
  if (dados.unidadeId !== unidade.id)
    throw new ErroReferencia(
      "A unidade mudou em outra aba. Recarregue a página e confira a unidade antes de salvar.",
    );
  const hoje = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Sao_Paulo",
  }).format(new Date());
  if (dados.ate > hoje)
    throw new ErroReferencia("Não registre referência para um período futuro.");
  const escopo = {
    organizacaoId: contexto.organizacao.id,
    unidadeId: unidade.id,
  };
  return repositorio.$transaction(
    async (tx) => {
      const vinculo = await tx.saiposVinculo.findFirst({
        where: {
          ...escopo,
          excluidoEm: null,
          habilitado: true,
          unidade: {
            ativa: true,
            excluidoEm: null,
            organizacao: { ativa: true, excluidoEm: null },
          },
        },
      });
      if (!vinculo)
        throw new ErroReferencia("Não há vínculo Saipos ativo nesta unidade.");
      const chave = { ...escopo, de: dados.de, ate: dados.ate };
      const anterior = await tx.saiposReferenciaFechamento.findUnique({
        where: { organizacaoId_unidadeId_de_ate: chave },
      });
      if ((anterior?.versao ?? 0) !== dados.versao || anterior?.excluidoEm)
        throw new ErroReferencia(
          "A referência mudou. Carregue a referência atual antes de salvar novamente.",
        );
      const totalCentavos = centavosInformados(dados.total)!;
      let id: string, versao: number;
      if (anterior) {
        const atualizado = await tx.saiposReferenciaFechamento.updateMany({
          where: {
            id: anterior.id,
            ...escopo,
            versao: dados.versao,
            excluidoEm: null,
          },
          data: {
            totalCentavos,
            informadaPorId: contexto.usuario.id,
            versao: { increment: 1 },
          },
        });
        if (!atualizado.count)
          throw new ErroReferencia(
            "A referência mudou. Carregue a referência atual antes de salvar novamente.",
          );
        id = anterior.id;
        versao = anterior.versao + 1;
      } else {
        const criado = await tx.saiposReferenciaFechamento.create({
          data: {
            ...chave,
            totalCentavos,
            informadaPorId: contexto.usuario.id,
          },
        });
        id = criado.id;
        versao = criado.versao;
      }
      await tx.auditoria.create({
        data: {
          ...escopo,
          usuarioId: contexto.usuario.id,
          entidade: "SaiposReferenciaFechamento",
          entidadeId: id,
          acao: anterior ? "ALTEROU" : "CRIOU",
          valoresAntes: anterior
            ? { totalCentavos: anterior.totalCentavos, versao: anterior.versao }
            : undefined,
          valoresDepois: {
            de: dados.de,
            ate: dados.ate,
            totalCentavos,
            versao,
            origem: "relatorio-informado-pelo-diretor",
          },
        },
      });
      return { id, versao };
    },
    { isolationLevel: "Serializable" },
  );
}
