import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { dadosDaChave } from "@/lib/documento-fiscal";
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
  notaFinanceiraPronta,
  type PropostaNotaPronta,
  NotaAssistidaRecusada,
} from "@/server/nota-assistida-contrato";

function identidadeFiscal(d: PropostaNotaPronta) {
  const chave = d.chaveAcesso ?? "";
  const derivada = chave ? dadosDaChave(chave) : null;
  const documento = d.fornecedor.documento ?? derivada?.cnpj ?? "";
  const numeroBase = d.numero ?? derivada?.numero ?? "";
  const numero = numeroBase.replace(/^0+/, "");
  const serie = (d.serie ?? derivada?.serie ?? "").replace(/^0+/, "");
  return { chave, documento, numeroBase, numero, serie };
}

/** A identidade fiscal é comum aos dois destinos; duas fotos não são duas despesas. */
async function impedirDocumentoRepetido(
  tx: Prisma.TransactionClient,
  ctx: ContextoSessao,
  d: PropostaNotaPronta,
) {
  const unidadeId = ctx.unidadeAtiva!.id;
  const { chave, documento, numeroBase, numero, serie } = identidadeFiscal(d);
  const identidade =
    numeroBase && documento ? `${documento}:${numero}:${serie}` : chave;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`nota-fiscal:${unidadeId}:${identidade}`}, 0))`;
  const anteriores = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM nota_fiscal_whatsapp
    WHERE "organizacaoId"=${ctx.organizacao.id} AND "unidadeId"=${unidadeId}
      AND id<>${d.operacaoId} AND resultado IS NOT NULL AND resultado <> 'null'::jsonb
      AND ((${chave}<>'' AND rascunho->>'chaveAcesso'=${chave}) OR
        (${numeroBase}<>'' AND regexp_replace(COALESCE(rascunho->'fornecedor'->>'documento',''),'[^0-9]','','g')=${documento}
          AND ltrim(COALESCE(NULLIF(rascunho->>'numero',''), substring(rascunho->>'chaveAcesso' from 26 for 9), ''),'0')=${numero}
          AND ltrim(COALESCE(NULLIF(rascunho->>'serie',''), substring(rascunho->>'chaveAcesso' from 23 for 3), ''),'0')=${serie})) LIMIT 1`;
  if (anteriores.length)
    throw new NotaAssistidaRecusada(
      "Este documento já foi lançado. Confira o financeiro antes de reenviar a nota.",
    );
}

async function lancarSomenteFinanceiro(
  ctx: ContextoSessao,
  entrada: unknown,
  origem: { instanciaId: string; vinculoId: string } | undefined,
) {
  const dados = notaFinanceiraPronta.parse(entrada);
  if (!origem)
    throw new NotaAssistidaRecusada(
      "Este lançamento exige a conferência autorizada pelo WhatsApp.",
    );
  const assinatura = createHash("sha256")
    .update(JSON.stringify(dados))
    .digest("hex");
  return transacaoFinanceira(
    ctx,
    "financeiro.lancar",
    async (tx, unidadeId) => {
      await exigirAutorizacaoNotaNaTransacao(tx, ctx, origem);
      const nota = await tx.notaFiscalWhatsapp.findFirst({
        where: {
          id: dados.operacaoId,
          organizacaoId: ctx.organizacao.id,
          unidadeId,
          instanciaId: origem.instanciaId,
          vinculoId: origem.vinculoId,
          usuarioId: ctx.usuario.id,
          estado: "EXECUTANDO",
          resumoHash: assinatura,
          confirmacaoId: { not: null },
        },
      });
      if (!nota)
        throw new NotaAssistidaRecusada(
          "A confirmação desta versão não está disponível para esta pessoa e unidade.",
        );
      const acessos = await tx.acesso.findMany({
        where: {
          usuarioId: ctx.usuario.id,
          organizacaoId: ctx.organizacao.id,
          status: "ATIVO",
          excluidoEm: null,
          usuario: { status: "ATIVO", excluidoEm: null },
          papel: { organizacaoId: ctx.organizacao.id },
          OR: [{ unidadeId: null }, { unidadeId }],
        },
        select: {
          papel: { select: { permissoes: { select: { chave: true } } } },
        },
      });
      const atuais = {
        permissoes: new Set(
          acessos.flatMap((a) => a.papel.permissoes.map((p) => p.chave)),
        ),
      };
      if (
        ![
          "assistente.ver",
          "estoque.lancar",
          "financeiro.ver",
          "financeiro.lancar",
        ].every((p) => pode(atuais, p))
      )
        throw new SemPermissao("lançar esta nota com o acesso atual");
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`nota-whatsapp:${unidadeId}:${dados.operacaoId}`}, 0))`;
      const chaves = dados.pagamento.parcelas.map((_, i) =>
        chaveFinanceiraDaNota(dados.operacaoId, i + 1),
      );
      const existentes = await tx.lancamento.findMany({
        where: { unidadeId, chaveCriacao: { in: chaves } },
        select: { id: true, assinaturaCriacao: true, chaveCriacao: true },
      });
      if (existentes.length) {
        if (
          existentes.length !== chaves.length ||
          existentes.some((l) => l.assinaturaCriacao !== assinatura)
        )
          throw new Error(
            "A operação anterior possui dados diferentes. Confira no Financeiro.",
          );
        return {
          notaId: nota.id,
          lancamentoIds: chaves.map(
            (c) => existentes.find((l) => l.chaveCriacao === c)!.id,
          ),
          modo: "FINANCEIRO" as const,
        };
      }
      if (
        dados.pagamento.situacao === "PAGA" &&
        !pode(atuais, "financeiro.quitar")
      )
        throw new SemPermissao("registrar o pagamento com o acesso atual");
      await validarFinanceiroDaNota(tx, ctx, dados);
      await impedirDocumentoRepetido(tx, ctx, dados);
      const { chave, documento, numeroBase, numero, serie } =
        identidadeFiscal(dados);
      const compras = await tx.$queryRaw<
        { id: string }[]
      >`SELECT n.id FROM nota_entrada n JOIN fornecedor f ON f.id=n."fornecedorId"
        WHERE n."unidadeId"=${unidadeId} AND ((${chave}<>'' AND n."chaveAcesso"=${chave}) OR
          (${numeroBase}<>'' AND regexp_replace(COALESCE(f.documento,''),'[^0-9]','','g')=${documento}
            AND ltrim(COALESCE(n.numero,''),'0')=${numero} AND ltrim(COALESCE(n.serie,''),'0')=${serie})) LIMIT 1`;
      if (compras.length)
        throw new NotaAssistidaRecusada(
          "Esta nota já possui entrada registrada. Confira o financeiro existente.",
        );
      const manuais = await tx.$queryRaw<{ id: string }[]>`
        SELECT l.id FROM lancamento l
        LEFT JOIN pessoa_financeira p ON p.id=l."pessoaId"
        LEFT JOIN fornecedor f ON f.id=l."fornecedorId"
        WHERE l."unidadeId"=${unidadeId} AND l.direcao='PAGAR' AND l."canceladoEm" IS NULL
          AND ${numeroBase}<>'' AND ltrim(COALESCE(l."numeroNotaFiscal",''),'0')=${numero}
          AND regexp_replace(COALESCE(NULLIF(p.documento,''),f.documento,''),'[^0-9]','','g')=${documento}
        LIMIT 1`;
      if (manuais.length)
        throw new NotaAssistidaRecusada(
          "Este documento já tem lançamento financeiro. Confira o registro existente.",
        );
      if (
        dados.arquivoId &&
        !(await tx.arquivo.count({
          where: {
            id: dados.arquivoId,
            organizacaoId: ctx.organizacao.id,
            unidadeId,
            enviadoPorId: ctx.usuario.id,
            excluidoEm: null,
            entidade: null,
          },
        }))
      )
        throw new NotaAssistidaRecusada(
          "O documento não está disponível para esta pessoa e unidade.",
        );
      const lancamentoIds = await lancarFinanceiroDaNotaNaTransacao(
        tx,
        ctx,
        dados,
        null,
        undefined,
        assinatura,
      );
      if (dados.arquivoId)
        await vincularArquivos(tx, [dados.arquivoId], {
          organizacaoId: ctx.organizacao.id,
          enviadoPorId: ctx.usuario.id,
          entidade: "Lancamento",
          entidadeId: lancamentoIds[0],
        });
      const resultado = {
        notaId: nota.id,
        lancamentoIds,
        modo: "FINANCEIRO" as const,
      };
      // O recibo confirma junto com as parcelas, inclusive se o processo cair
      // antes de concluir a conversa ou entregar a mensagem de sucesso.
      await tx.notaFiscalWhatsapp.update({
        where: { id: nota.id },
        data: { resultado },
      });
      return resultado;
    },
  );
}

/**
 * Executa somente a proposta já conferida pela pessoa. A camada de conversa
 * verifica remetente, token, versão e confirmação; esta operação volta a
 * conferir permissões, referências e idempotência na mesma transação dos fatos.
 */
export async function lancarNotaAssistida(
  contexto: ContextoSessao,
  entrada: unknown,
  origemWhatsapp?: { instanciaId: string; vinculoId: string },
): Promise<{ notaId: string; lancamentoIds: string[]; modo?: "FINANCEIRO" }> {
  if (
    entrada &&
    typeof entrada === "object" &&
    "modo" in entrada &&
    entrada.modo === "FINANCEIRO"
  )
    return lancarSomenteFinanceiro(contexto, entrada, origemWhatsapp);
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
      await impedirDocumentoRepetido(tx, contexto, dados);
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
