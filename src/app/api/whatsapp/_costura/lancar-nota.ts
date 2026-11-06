import { createHash } from "node:crypto";
import type { ContextoSessao } from "@/core/sessao/nucleo";
import { pode } from "@/core/sessao/nucleo";
import { SemPermissao } from "@/lib/erros";
import { criarEntradaAssistidaNaTransacao } from "@/modules/estoque/services/notas-assistidas";
import { transacaoFinanceira } from "@/modules/financeiro/services/integrado";
import {
  chaveFinanceiraDaNota,
  lancarFinanceiroDaNotaNaTransacao,
  validarFinanceiroDaNota,
} from "@/modules/financeiro/services/notas-assistidas";
import { vincularArquivos } from "@/server/arquivos";
import { exigirAutorizacaoNotaNaTransacao } from "@/modules/assistente/services/notas-autorizacao";
import {
  notaAssistidaPronta,
  NotaAssistidaRecusada,
} from "@/server/nota-assistida-contrato";

/**
 * Executa somente a proposta já conferida pela pessoa. A camada de conversa
 * verifica remetente, token, versão e confirmação; esta operação volta a
 * conferir permissões, referências e idempotência na mesma transação dos fatos.
 */
export async function lancarNotaAssistida(
  contexto: ContextoSessao,
  entrada: unknown,
  origemWhatsapp?: { instanciaId: string; vinculoId: string },
): Promise<{ notaId: string; lancamentoIds: string[] }> {
  const dados = notaAssistidaPronta.parse(entrada);
  if (!pode(contexto, "estoque.lancar"))
    throw new SemPermissao("lançar notas de entrada");
  const assinatura = createHash("sha256")
    .update(JSON.stringify(dados))
    .digest("hex");
  return transacaoFinanceira(
    contexto,
    "financeiro.lancar",
    async (tx, unidadeId) => {
      if (origemWhatsapp)
        await exigirAutorizacaoNotaNaTransacao(tx, contexto, origemWhatsapp);
      // Reconstrói o acesso dentro da mesma transação dos lançamentos.
      const acessos = await tx.acesso.findMany({
        where: {
          usuarioId: contexto.usuario.id,
          organizacaoId: contexto.organizacao.id,
          status: "ATIVO",
          excluidoEm: null,
          usuario: { status: "ATIVO", excluidoEm: null },
          papel: { organizacaoId: contexto.organizacao.id },
          OR: [{ unidadeId: null }, { unidadeId }],
        },
        select: {
          papel: { select: { permissoes: { select: { chave: true } } } },
        },
      });
      const atuais = new Set(
        acessos.flatMap((a) => a.papel.permissoes.map((p) => p.chave)),
      );
      const exigidas = [
        "estoque.lancar",
        "financeiro.ver",
        "financeiro.lancar",
      ];
      if (!exigidas.every((p) => pode({ permissoes: atuais }, p)))
        throw new SemPermissao("lançar esta nota com o acesso atual");
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`nota-whatsapp:${unidadeId}:${dados.operacaoId}`}, 0))`;
      const chaves = dados.pagamento.parcelas.map((_, i) =>
        chaveFinanceiraDaNota(dados.operacaoId, i + 1),
      );
      const existentes = await tx.lancamento.findMany({
        where: { unidadeId, chaveCriacao: { in: chaves } },
        select: {
          id: true,
          notaEntradaId: true,
          assinaturaCriacao: true,
          chaveCriacao: true,
        },
      });
      if (existentes.length) {
        if (
          existentes.length !== chaves.length ||
          existentes.some((l) => l.assinaturaCriacao !== assinatura)
        )
          throw new Error(
            "Esta confirmação já foi utilizada com dados diferentes. Confira o lançamento no sistema.",
          );
        const primeira = existentes.find((l) => l.chaveCriacao === chaves[0]);
        if (!primeira?.notaEntradaId)
          throw new Error(
            "A operação anterior precisa de conferência no sistema.",
          );
        return {
          notaId: primeira.notaEntradaId,
          lancamentoIds: chaves.map(
            (chave) => existentes.find((l) => l.chaveCriacao === chave)!.id,
          ),
        };
      }
      const adicionais = [
        ...(dados.pagamento.situacao === "PAGA" ? ["financeiro.quitar"] : []),
        ...(dados.itens.some((i) => i.novoInsumo) ? ["cardapio.editar"] : []),
      ];
      if (!adicionais.every((p) => pode({ permissoes: atuais }, p)))
        throw new SemPermissao("lançar esta nota com o acesso atual");
      await validarFinanceiroDaNota(tx, contexto, dados);
      if (
        dados.arquivoId &&
        !(await tx.arquivo.count({
          where: {
            id: dados.arquivoId,
            organizacaoId: contexto.organizacao.id,
            unidadeId,
            enviadoPorId: contexto.usuario.id,
            excluidoEm: null,
            entidade: null,
          },
        }))
      )
        throw new NotaAssistidaRecusada(
          "A foto não está disponível para esta nota, pessoa e unidade.",
        );
      const nota = await criarEntradaAssistidaNaTransacao(tx, contexto, dados);
      const lancamentoIds = await lancarFinanceiroDaNotaNaTransacao(
        tx,
        contexto,
        dados,
        nota.notaId,
        nota.fornecedorId,
        assinatura,
      );
      if (dados.arquivoId)
        await vincularArquivos(tx, [dados.arquivoId], {
          organizacaoId: contexto.organizacao.id,
          enviadoPorId: contexto.usuario.id,
          entidade: "NotaEntrada",
          entidadeId: nota.notaId,
        });
      return { notaId: nota.notaId, lancamentoIds };
    },
  );
}
