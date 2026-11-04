import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { pode, type ContextoSessao } from "@/core/sessao/nucleo";
import { SemPermissao } from "@/lib/erros";
import type { NotaAssistidaPronta } from "@/server/nota-assistida-contrato";
import { NotaAssistidaRecusada } from "@/server/nota-assistida-contrato";
import { dataBancaria } from "../schemas/bancos";
import { registrarBaixa } from "./integrado";

type Tx = Prisma.TransactionClient;

export function chaveFinanceiraDaNota(operacaoId: string, parcela = 1) {
  return `nota-whatsapp:${operacaoId}:${parcela}`;
}

function chaveDeBaixa(unidadeId: string, operacaoId: string, parcela: number) {
  const h = createHash("sha256")
    .update(`nota-whatsapp:${unidadeId}:${operacaoId}:baixa:${parcela}`)
    .digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

async function auditar(
  tx: Tx,
  ctx: ContextoSessao,
  entidade: string,
  entidadeId: string,
  dados: unknown,
) {
  await tx.auditoria.create({
    data: {
      organizacaoId: ctx.organizacao.id,
      unidadeId: ctx.unidadeAtiva!.id,
      usuarioId: ctx.usuario.id,
      entidade,
      entidadeId,
      acao: "CRIOU",
      valoresDepois: JSON.parse(JSON.stringify(dados)),
    },
  });
}

/** Confere referências novamente dentro da transação, inclusive para reenvios. */
export async function validarFinanceiroDaNota(
  tx: Tx,
  ctx: ContextoSessao,
  dados: NotaAssistidaPronta,
) {
  if (!pode(ctx, "financeiro.ver") || !pode(ctx, "financeiro.lancar"))
    throw new SemPermissao("cadastrar contas");
  if (dados.pagamento.situacao === "PAGA" && !pode(ctx, "financeiro.quitar"))
    throw new SemPermissao("dar baixa no pagamento da nota");
  const unidadeId = ctx.unidadeAtiva!.id;
  const empresa = await tx.empresaFinanceira.findFirst({
    where: {
      id: dados.empresaId,
      organizacaoId: ctx.organizacao.id,
      unidadeId,
      ativa: true,
    },
    select: { id: true },
  });
  if (!empresa)
    throw new NotaAssistidaRecusada(
      "A empresa escolhida não está ativa nesta unidade.",
    );
  if (
    !(await tx.categoriaFinanceira.count({
      where: {
        id: dados.categoriaId,
        organizacaoId: ctx.organizacao.id,
        ativa: true,
        tipo: "DESPESA",
        grupoDre: "MERCADORIA",
      },
    }))
  )
    throw new NotaAssistidaRecusada(
      "Escolha um plano de mercadoria ativo desta organização para evitar duplicar o CMV.",
    );
  if (
    dados.pagamento.contaId &&
    !(await tx.contaFinanceira.count({
      where: {
        id: dados.pagamento.contaId,
        unidadeId,
        empresaId: empresa.id,
        ativa: true,
      },
    }))
  )
    throw new NotaAssistidaRecusada(
      "A conta escolhida está inativa ou pertence a outra empresa.",
    );
}

async function pessoaDaNota(
  tx: Tx,
  ctx: ContextoSessao,
  dados: NotaAssistidaPronta,
) {
  const organizacaoId = ctx.organizacao.id;
  const unidadeId = ctx.unidadeAtiva!.id;
  const documento = dados.fornecedor.documento;
  const documentos = documento
    ? await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM pessoa_financeira WHERE "organizacaoId"=${organizacaoId} AND "unidadeId"=${unidadeId} AND regexp_replace(COALESCE(documento, ''), '[^0-9]', '', 'g')=${documento} LIMIT 2`
    : [];
  if (documentos.length > 1)
    throw new NotaAssistidaRecusada(
      "O documento corresponde a mais de uma pessoa financeira. Revise o cadastro.",
    );
  const existentes = documentos.length
    ? await tx.pessoaFinanceira.findMany({
        where: { id: documentos[0].id, organizacaoId, unidadeId },
      })
    : await tx.pessoaFinanceira.findMany({
        where: {
          organizacaoId,
          unidadeId,
          nome: { equals: dados.fornecedor.nome, mode: "insensitive" },
        },
        take: 2,
      });
  if (existentes.length > 1)
    throw new NotaAssistidaRecusada(
      "Há pessoas financeiras com o mesmo nome. Confira o documento do fornecedor.",
    );
  const existente = existentes[0];
  if (existente) {
    if (!existente.ativa)
      throw new NotaAssistidaRecusada(
        "A pessoa financeira do fornecedor está inativa.",
      );
    if (
      documento &&
      existente.documento &&
      existente.documento.replace(/\D/g, "") !== documento
    )
      throw new NotaAssistidaRecusada(
        "O documento não confere com a pessoa financeira cadastrada.",
      );
    return existente.id;
  }
  const criada = await tx.pessoaFinanceira.create({
    data: {
      organizacaoId,
      unidadeId,
      nome: dados.fornecedor.nome,
      documento,
      tipoDocumento: documento?.length === 11 ? "cpf" : "cnpj",
      categoriaId: dados.categoriaId,
      operacaoPadrao: "PAGAR",
    },
  });
  await auditar(tx, ctx, "PessoaFinanceira", criada.id, {
    nome: criada.nome,
    documento: criada.documento,
    origem: "nota-whatsapp",
  });
  return criada.id;
}

/** Não abre outra transação: nota, parcelas e baixa precisam confirmar juntas. */
export async function lancarFinanceiroDaNotaNaTransacao(
  tx: Tx,
  ctx: ContextoSessao,
  dados: NotaAssistidaPronta,
  notaId: string,
  fornecedorId: string,
  assinatura: string,
): Promise<string[]> {
  await validarFinanceiroDaNota(tx, ctx, dados);
  const unidadeId = ctx.unidadeAtiva!.id;
  const pessoaId = await pessoaDaNota(tx, ctx, dados);
  const lancamentoIds: string[] = [];
  const parcelas = dados.pagamento.parcelas;
  for (let i = 0; i < parcelas.length; i++) {
    const p = parcelas[i];
    const lancamento = await tx.lancamento.create({
      data: {
        unidadeId,
        empresaId: dados.empresaId,
        pessoaId,
        fornecedorId,
        categoriaId: dados.categoriaId,
        direcao: "PAGAR",
        status: "ABERTO",
        descricao: `${dados.fornecedor.nome}${dados.numero ? ` · NF ${dados.numero}` : " · Cupom fiscal"}${parcelas.length > 1 ? ` · ${i + 1}/${parcelas.length}` : ""}`,
        valor: String(p.valor),
        vencimento: dataBancaria(p.vencimento),
        competencia: dataBancaria(dados.emitidaEm),
        tipoPagamento: dados.pagamento.forma,
        historico: "Pagamento",
        numeroNotaFiscal: dados.numero ?? "",
        // Mercadoria compõe o resultado pelo CMV do Estoque, uma única vez.
        composeDre: false,
        notaEntradaId: i === 0 ? notaId : null,
        grupoParcelas: parcelas.length > 1 ? `nota-whatsapp:${notaId}` : null,
        parcela: parcelas.length > 1 ? i + 1 : null,
        totalParcelas: parcelas.length > 1 ? parcelas.length : null,
        contaId: dados.pagamento.contaId,
        observacao: "Nota conferida pelo responsável via WhatsApp.",
        criadoPorId: ctx.usuario.id,
        chaveCriacao: chaveFinanceiraDaNota(dados.operacaoId, i + 1),
        assinaturaCriacao: assinatura,
      },
      select: { id: true },
    });
    lancamentoIds.push(lancamento.id);
    await auditar(tx, ctx, "Lancamento", lancamento.id, {
      origem: "nota-whatsapp",
      notaId,
      operacaoId: dados.operacaoId,
      parcela: i + 1,
      valor: p.valor,
      vencimento: p.vencimento,
      empresaId: dados.empresaId,
    });
    if (dados.pagamento.situacao === "PAGA") {
      // A chave inclui a operação e a parcela, mas não é controlada pela IA.
      await registrarBaixa(tx, ctx, unidadeId, {
        lancamentoId: lancamento.id,
        contaId: dados.pagamento.contaId!,
        valor: String(p.valor),
        dataPagamento: dados.pagamento.dataPagamento!,
        tipoPagamento: dados.pagamento.forma,
        complemento: "Pagamento confirmado pelo responsável no WhatsApp.",
        chave: chaveDeBaixa(unidadeId, dados.operacaoId, i + 1),
      });
    }
  }
  return lancamentoIds;
}
