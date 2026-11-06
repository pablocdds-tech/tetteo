import { Prisma } from "@prisma/client";
import { pode, type ContextoSessao } from "@/core/sessao/nucleo";
import { SemPermissao } from "@/lib/erros";
import type { NotaAssistidaPronta } from "@/server/nota-assistida-contrato";
import { NotaAssistidaRecusada } from "@/server/nota-assistida-contrato";
import { lancarNotaNaTransacao } from "./notas";

type Tx = Prisma.TransactionClient;

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

async function fornecedor(
  tx: Tx,
  ctx: ContextoSessao,
  dados: NotaAssistidaPronta["fornecedor"],
) {
  const organizacaoId = ctx.organizacao.id;
  const documento = dados.documento;
  const documentos = documento
    ? await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM fornecedor WHERE "organizacaoId"=${organizacaoId} AND regexp_replace(COALESCE(documento, ''), '[^0-9]', '', 'g')=${documento} LIMIT 2`
    : [];
  if (documentos.length > 1)
    throw new NotaAssistidaRecusada(
      "Há mais de um fornecedor com este documento. Revise o cadastro antes de lançar.",
    );
  const candidatos = documentos.length
    ? await tx.fornecedor.findMany({
        where: { id: documentos[0].id, organizacaoId },
      })
    : await tx.fornecedor.findMany({
        where: {
          organizacaoId,
          nome: { equals: dados.nome, mode: "insensitive" },
        },
        take: 2,
      });
  if (candidatos.length > 1)
    throw new NotaAssistidaRecusada(
      "Há fornecedores com o mesmo nome. Confira o CPF ou CNPJ.",
    );
  const existente = candidatos[0];
  if (existente) {
    if (!existente.ativo || existente.excluidoEm)
      throw new NotaAssistidaRecusada(
        "O fornecedor está inativo. Revise seu cadastro no sistema.",
      );
    const docExistente = existente.documento?.replace(/\D/g, "");
    if (documento && (!docExistente || documento !== docExistente))
      throw new NotaAssistidaRecusada(
        "O documento da nota é diferente do fornecedor cadastrado com esse nome.",
      );
    return existente.id;
  }
  // Mesmo caminho de cadastro rápido da nota manual: a autorização é estoque.lancar.
  const criado = await tx.fornecedor.create({
    data: {
      organizacaoId,
      nome: dados.nome,
      documento,
      criadoPorId: ctx.usuario.id,
    },
  });
  await auditar(tx, ctx, "Fornecedor", criado.id, {
    nome: criado.nome,
    documento: criado.documento,
    origem: "nota-whatsapp",
  });
  return criado.id;
}

async function insumo(
  tx: Tx,
  ctx: ContextoSessao,
  item: NotaAssistidaPronta["itens"][number],
) {
  if (item.insumoId) {
    const existente = await tx.insumo.findFirst({
      where: {
        id: item.insumoId,
        organizacaoId: ctx.organizacao.id,
        ativo: true,
        excluidoEm: null,
      },
      select: { id: true },
    });
    if (!existente)
      throw new NotaAssistidaRecusada(
        "Um dos insumos não está disponível nesta organização. Confira o vínculo do item.",
      );
    return existente.id;
  }
  if (!pode(ctx, "cardapio.editar"))
    throw new SemPermissao("cadastrar novos insumos");
  const novo = item.novoInsumo!;
  const existentes = await tx.insumo.findMany({
    where: {
      organizacaoId: ctx.organizacao.id,
      nome: { equals: novo.nome, mode: "insensitive" },
    },
    select: { id: true, unidadeMedida: true, ativo: true, excluidoEm: true },
    take: 2,
  });
  if (existentes.length) {
    // Um cadastro confirmado como NOVO não pode virar silenciosamente um vínculo diferente.
    throw new NotaAssistidaRecusada(
      "Já existe um insumo com esse nome. Confira o vínculo e a unidade antes de confirmar novamente.",
    );
  }
  const criado = await tx.insumo.create({
    data: {
      organizacaoId: ctx.organizacao.id,
      nome: novo.nome,
      unidadeMedida: novo.unidadeMedida,
      criadoPorId: ctx.usuario.id,
      atualizadoPorId: ctx.usuario.id,
    },
  });
  await auditar(tx, ctx, "Insumo", criado.id, {
    nome: criado.nome,
    unidadeMedida: criado.unidadeMedida,
    origem: "nota-whatsapp",
  });
  return criado.id;
}

/** Entrada completa, somente depois da confirmação; o chamador mantém a transação. */
export async function criarEntradaAssistidaNaTransacao(
  tx: Tx,
  ctx: ContextoSessao,
  dados: NotaAssistidaPronta,
): Promise<{ notaId: string; fornecedorId: string }> {
  if (!pode(ctx, "estoque.lancar"))
    throw new SemPermissao("lançar notas de entrada");
  if (
    !ctx.unidadeAtiva ||
    !ctx.unidadesVisiveis.some((u) => u.id === ctx.unidadeAtiva!.id)
  )
    throw new SemPermissao("dar entrada nesta unidade");
  const unidadeId = ctx.unidadeAtiva.id;
  const unidade = await tx.unidade.findFirst({
    where: {
      id: unidadeId,
      organizacaoId: ctx.organizacao.id,
      ativa: true,
      excluidoEm: null,
    },
    select: { fusoHorario: true },
  });
  if (!unidade) throw new SemPermissao("dar entrada nesta unidade");
  if (
    !(await tx.localEstoque.count({
      where: { id: dados.localId, unidadeId, ativo: true },
    }))
  )
    throw new NotaAssistidaRecusada(
      "Escolha um local ativo desta unidade para guardar a mercadoria.",
    );
  const fornecedorId = await fornecedor(tx, ctx, dados.fornecedor);

  const pelaChave =
    dados.chaveAcesso &&
    (await tx.notaEntrada.findFirst({
      where: { unidadeId, chaveAcesso: dados.chaveAcesso },
      select: { id: true },
    }));
  const normalizar = (v: string | undefined) =>
    v && /^\d+$/.test(v)
      ? v.replace(/^0+(?=\d)/, "")
      : (v ?? "").trim().toUpperCase();
  const numero = normalizar(dados.numero);
  const serie = normalizar(dados.serie);
  const peloNumero = dados.numero
    ? await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM nota_entrada WHERE "unidadeId"=${unidadeId} AND "fornecedorId"=${fornecedorId}
    AND CASE WHEN trim(numero) ~ '^[0-9]+$' THEN COALESCE(NULLIF(ltrim(trim(numero), '0'), ''), '0') ELSE upper(trim(numero)) END=${numero}
    AND (${serie}='' OR trim(COALESCE(serie, ''))='' OR CASE WHEN trim(COALESCE(serie, '')) ~ '^[0-9]+$' THEN COALESCE(NULLIF(ltrim(trim(serie), '0'), ''), '0') ELSE upper(trim(COALESCE(serie, ''))) END=${serie})
    LIMIT 1`
    : [];
  if (pelaChave || peloNumero.length)
    throw new NotaAssistidaRecusada(
      "Esta nota já está cadastrada. Confira o lançamento existente antes de reenviar.",
    );

  const insumosNovos = new Map<string, string>();
  const itens = [];
  for (const i of dados.itens) {
    const chaveNovo = i.novoInsumo
      ? `${i.novoInsumo.nome.toLocaleLowerCase("pt-BR")}|${i.novoInsumo.unidadeMedida}`
      : null;
    const insumoId =
      (chaveNovo && insumosNovos.get(chaveNovo)) || (await insumo(tx, ctx, i));
    if (chaveNovo) insumosNovos.set(chaveNovo, insumoId);
    const quantidade = new Prisma.Decimal(i.quantidade).mul(i.fatorConversao);
    if (quantidade.decimalPlaces() > 3 || quantidade.gt("99999999999.999"))
      throw new NotaAssistidaRecusada(
        "A conversão de uma embalagem não cabe na precisão do estoque. Confira a unidade e o conteúdo.",
      );
    const valorUnitario = new Prisma.Decimal(i.valorTotal)
      .div(quantidade)
      .toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
    if (valorUnitario.gt("9999999999.9999"))
      throw new NotaAssistidaRecusada(
        "O custo por unidade ficou alto demais. Confira quantidade e embalagem.",
      );
    itens.push({
      insumoId,
      quantidadeNota: new Prisma.Decimal(i.quantidade),
      fatorConversao: new Prisma.Decimal(i.fatorConversao),
      quantidade,
      valorTotal: new Prisma.Decimal(i.valorTotal),
      valorUnitario,
    });
  }
  // O Estoque usa instantes locais; o Financeiro usa datas puras no seu próprio serviço.
  const recebidaEm = inicioNoFuso(dados.recebidaEm, unidade.fusoHorario);
  const emitidaEm = inicioNoFuso(dados.emitidaEm, unidade.fusoHorario);
  const nota = await tx.notaEntrada.create({
    data: {
      unidadeId,
      fornecedorId,
      numero: dados.numero ?? null,
      serie: dados.serie ?? null,
      chaveAcesso: dados.chaveAcesso ?? null,
      emitidaEm,
      recebidaEm,
      localDestinoId: dados.localId,
      valorTotal: new Prisma.Decimal(dados.valorTotal),
      observacao: "Conferida pelo responsável no WhatsApp.",
      registradaPorId: ctx.usuario.id,
      itens: { create: itens },
    },
    select: { id: true },
  });
  await lancarNotaNaTransacao(tx, ctx, nota.id);
  await auditar(tx, ctx, "NotaEntrada", nota.id, {
    origem: "nota-whatsapp",
    operacaoId: dados.operacaoId,
    status: "LANCADA",
    valorTotal: dados.valorTotal,
    itens: itens.length,
  });
  return { notaId: nota.id, fornecedorId };
}

/** Início do dia no fuso da unidade, independente do fuso do servidor. */
function inicioNoFuso(dia: string, fuso: string): Date {
  const esperado = new Date(`${dia}T00:00:00Z`).getTime();
  let instante = esperado;
  for (let i = 0; i < 4; i++) {
    const partes = new Intl.DateTimeFormat("en-CA", {
      timeZone: fuso,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(instante));
    const parte = (tipo: string) =>
      Number(partes.find((p) => p.type === tipo)?.value);
    instante +=
      esperado -
      Date.UTC(
        parte("year"),
        parte("month") - 1,
        parte("day"),
        parte("hour"),
        parte("minute"),
        parte("second"),
      );
  }
  return new Date(instante);
}
