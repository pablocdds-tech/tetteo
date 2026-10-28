import { converterAgendamento } from "../schemas/agendamento";
import { createHash } from "node:crypto";
import { ErroPdv } from "../schemas/erro";
import { Prisma } from "@prisma/client";
import { pode, type ContextoSessao } from "@/core/sessao/nucleo";
import { SemPermissao } from "@/lib/erros";
import { db } from "@/server/db";
import type {
  CaixaPdv,
  DadosPdv,
  GrupoComplemento,
  PagamentoPdv,
  ProdutoPdv,
} from "../types";
import { calcularConsumo, type ConsumoPdv } from "../schemas/consumo";
import { exigirEscopo } from "./escopo";
export { exigirEscopo } from "./escopo";
import { listarAreasEntrega, prepararEntrega } from "./entregas";
import { serializarVendaPdv } from "./venda-dto";
import {
  calcularPedido,
  conferirPagamentos,
  esquemaAbrir,
  esquemaCancelar,
  esquemaComplementos,
  esquemaFechar,
  esquemaFinalizar,
  esquemaGrupo,
  esquemaMovimento,
} from "../schemas/venda";

type Transacao = Prisma.TransactionClient;
type Escopo = { organizacaoId: string; unidadeId: string };
const json = (valor: unknown) =>
  JSON.parse(JSON.stringify(valor)) as Prisma.InputJsonValue;

async function travarUnidade(tx: Transacao, escopo: Escopo) {
  // Uma mesma trava serializa abertura, venda, fechamento, sangria e cancelamento.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`pdv:${escopo.organizacaoId}:${escopo.unidadeId}`},0))`;
}
async function auditar(
  tx: Transacao,
  ctx: ContextoSessao,
  escopo: Escopo,
  entidade: string,
  id: string,
  acao: "CRIOU" | "ALTEROU",
  antes: unknown,
  depois: unknown,
) {
  await tx.auditoria.create({
    data: {
      ...escopo,
      usuarioId: ctx.usuario.id,
      entidade,
      entidadeId: id,
      acao,
      valoresAntes: antes === null ? Prisma.JsonNull : json(antes),
      valoresDepois: json(depois),
    },
  });
}
function gruposValidos(valor: Prisma.JsonValue): GrupoComplemento[] {
  if (!Array.isArray(valor))
    throw new ErroPdv("Configuração de complementos inválida.");
  return valor.map((g) => esquemaGrupo.parse(g));
}
export async function catalogo(
  tx: Transacao,
  organizacaoId: string,
): Promise<ProdutoPdv[]> {
  const [fichas, configuracoes] = await Promise.all([
    tx.fichaTecnica.findMany({
      where: {
        organizacaoId,
        tipo: "PRATO",
        ativo: true,
        excluidoEm: null,
        precoVenda: { not: null },
      },
      select: { id: true, nome: true, categoria: true, precoVenda: true },
      orderBy: [{ categoria: "asc" }, { nome: "asc" }],
    }),
    tx.pdvProduto.findMany({ where: { organizacaoId } }),
  ]);
  const configs = new Map(configuracoes.map((c) => [c.fichaId, c]));
  return fichas.map((f) => {
    const config = configs.get(f.id);
    return {
      id: f.id,
      nome: f.nome,
      categoria: f.categoria || "Sem categoria",
      precoCentavos: Number(f.precoVenda!.mul(100).toFixed(0)),
      codigo: config?.codigo ?? "",
      grupos: config ? gruposValidos(config.grupos) : [],
    };
  });
}
const caixaInclude = {
  movimentos: { orderBy: { criadoEm: "desc" as const } },
  vendas: {
    where: { status: "CONCLUIDA", caixaRecebimentoId: null },
    select: { pagamentos: true, trocoCentavos: true },
  },
  vendasRecebidas: {
    where: { status: "CONCLUIDA" },
    select: { pagamentos: true, trocoCentavos: true },
  },
} satisfies Prisma.PdvCaixaInclude;
type CaixaBanco = Prisma.PdvCaixaGetPayload<{ include: typeof caixaInclude }>;
function saldoCaixa(caixa: CaixaBanco) {
  const dinheiro = [...caixa.vendas, ...caixa.vendasRecebidas].reduce(
    (s, v) =>
      s +
      (v.pagamentos as PagamentoPdv[])
        .filter((p) => p.forma === "DINHEIRO")
        .reduce((s, p) => s + p.valorCentavos, 0) -
      v.trocoCentavos,
    0,
  );
  return (
    caixa.saldoInicialCentavos +
    dinheiro +
    caixa.movimentos.reduce(
      (s, m) => s + (m.tipo === "SANGRIA" ? -m.valorCentavos : m.valorCentavos),
      0,
    )
  );
}
function serializarCaixa(c: CaixaBanco): CaixaPdv {
  const saldo = c.saldoFechamentoCentavos ?? saldoCaixa(c);
  return {
    id: c.id,
    abertoEm: c.abertoEm.toISOString(),
    fechadoEm: c.fechadoEm?.toISOString() ?? null,
    operador: c.operador,
    localEstoqueId: c.localEstoqueId,
    saldoInicialCentavos: c.saldoInicialCentavos,
    saldoEsperadoCentavos: saldo,
    valorContadoCentavos: c.valorContadoCentavos,
    diferencaCentavos:
      c.valorContadoCentavos === null ? null : c.valorContadoCentavos - saldo,
    movimentos: c.movimentos.map((m) => ({
      id: m.id,
      tipo: m.tipo,
      valorCentavos: m.valorCentavos,
      motivo: m.motivo,
      criadoEm: m.criadoEm.toISOString(),
    })),
  };
}
export async function carregarPdv(ctx: ContextoSessao): Promise<DadosPdv> {
  const escopo = await exigirEscopo(ctx);
  const [produtos, caixas, vendas, locais, areasEntrega] = await Promise.all([
    catalogo(db, escopo.organizacaoId),
    db.pdvCaixa.findMany({
      where: escopo,
      include: caixaInclude,
      orderBy: { abertoEm: "desc" },
      take: 31,
    }),
    db.pdvVenda.findMany({
      where: escopo,
      orderBy: { criadaEm: "desc" },
      take: 100,
    }),
    db.localEstoque.findMany({
      where: { unidadeId: escopo.unidadeId, ativo: true },
      select: { id: true, nome: true },
      orderBy: { nome: "asc" },
    }),
    pode(ctx, "pdv.vender") ||
    pode(ctx, "pdv.entrega") ||
    pode(ctx, "pdv.configurar")
      ? listarAreasEntrega(ctx)
      : Promise.resolve([]),
  ]);
  return {
    produtos,
    areasEntrega,
    caixa: caixas.find((c) => !c.fechadoEm)
      ? serializarCaixa(caixas.find((c) => !c.fechadoEm)!)
      : null,
    caixasAnteriores: caixas.filter((c) => c.fechadoEm).map(serializarCaixa),
    vendas: vendas.map((v) => serializarVendaPdv(v, pode(ctx, "crm.ver"))),
    clientes: [],
    locais,
  };
}
export async function abrirCaixa(ctx: ContextoSessao, entrada: unknown) {
  const escopo = await exigirEscopo(ctx, "pdv.caixa");
  const dados = esquemaAbrir.parse(entrada);
  return db.$transaction(async (tx) => {
    await travarUnidade(tx, escopo);
    if (await tx.pdvCaixa.findFirst({ where: { ...escopo, fechadoEm: null } }))
      throw new ErroPdv("Já existe um caixa aberto nesta unidade.");
    if (
      !(await tx.localEstoque.findFirst({
        where: {
          id: dados.localEstoqueId,
          unidadeId: escopo.unidadeId,
          ativo: true,
        },
      }))
    )
      throw new ErroPdv("Escolha um local de estoque ativo desta unidade.");
    const caixa = await tx.pdvCaixa.create({
      data: {
        ...escopo,
        ...dados,
        abertoPorId: ctx.usuario.id,
        operador: ctx.usuario.nome,
      },
    });
    await auditar(tx, ctx, escopo, "PdvCaixa", caixa.id, "CRIOU", null, {
      saldoInicialCentavos: dados.saldoInicialCentavos,
      localEstoqueId: dados.localEstoqueId,
    });
    return caixa.id;
  });
}
async function caixaAberto(tx: Transacao, escopo: Escopo, id: string) {
  const caixa = await tx.pdvCaixa.findFirst({
    where: { ...escopo, id },
    include: caixaInclude,
  });
  if (!caixa || caixa.fechadoEm)
    throw new ErroPdv(
      "O caixa não está aberto nesta unidade. Atualize a tela.",
    );
  return caixa;
}
export async function movimentarCaixa(ctx: ContextoSessao, entrada: unknown) {
  const escopo = await exigirEscopo(ctx, "pdv.caixa");
  const dados = esquemaMovimento.parse(entrada);
  await db.$transaction(async (tx) => {
    await travarUnidade(tx, escopo);
    const caixa = await caixaAberto(tx, escopo, dados.caixaId);
    if (dados.tipo === "SANGRIA" && dados.valorCentavos > saldoCaixa(caixa))
      throw new ErroPdv("A sangria supera o saldo esperado em dinheiro.");
    const movimento = await tx.pdvMovimentoCaixa.create({
      data: { ...escopo, ...dados, usuarioId: ctx.usuario.id },
    });
    await auditar(
      tx,
      ctx,
      escopo,
      "PdvMovimentoCaixa",
      movimento.id,
      "CRIOU",
      null,
      dados,
    );
  });
}
export async function fecharCaixa(ctx: ContextoSessao, entrada: unknown) {
  const escopo = await exigirEscopo(ctx, "pdv.caixa");
  const dados = esquemaFechar.parse(entrada);
  await db.$transaction(async (tx) => {
    await travarUnidade(tx, escopo);
    const caixa = await caixaAberto(tx, escopo, dados.caixaId);
    const saldo = saldoCaixa(caixa);
    await tx.pdvCaixa.update({
      where: { id: caixa.id },
      data: {
        fechadoEm: new Date(),
        fechadoPorId: ctx.usuario.id,
        valorContadoCentavos: dados.valorContadoCentavos,
        saldoFechamentoCentavos: saldo,
        observacao: dados.observacao,
      },
    });
    await auditar(
      tx,
      ctx,
      escopo,
      "PdvCaixa",
      caixa.id,
      "ALTEROU",
      { fechadoEm: null },
      {
        saldoEsperadoCentavos: saldo,
        valorContadoCentavos: dados.valorContadoCentavos,
        diferencaCentavos: dados.valorContadoCentavos - saldo,
      },
    );
  });
}
export async function salvarComplementos(
  ctx: ContextoSessao,
  entrada: unknown,
) {
  const escopo = await exigirEscopo(ctx, "pdv.configurar");
  const dados = esquemaComplementos.parse(entrada);
  await db.$transaction(async (tx) => {
    const ficha = await tx.fichaTecnica.findFirst({
      where: {
        id: dados.produtoId,
        organizacaoId: escopo.organizacaoId,
        tipo: "PRATO",
        ativo: true,
        excluidoEm: null,
      },
    });
    if (!ficha) throw new ErroPdv("Produto não encontrado nesta organização.");
    const referencias = [
      ...new Set(
        dados.grupos.flatMap((g) =>
          g.opcoes.flatMap((o) => (o.fichaId ? [o.fichaId] : [])),
        ),
      ),
    ];
    if (
      referencias.length !==
      (await tx.fichaTecnica.count({
        where: {
          id: { in: referencias },
          organizacaoId: escopo.organizacaoId,
          ativo: true,
          excluidoEm: null,
        },
      }))
    )
      throw new ErroPdv("Ficha de complemento indisponível nesta organização.");
    const antes = await tx.pdvProduto.findUnique({
      where: {
        organizacaoId_fichaId: {
          organizacaoId: escopo.organizacaoId,
          fichaId: ficha.id,
        },
      },
    });
    const config = await tx.pdvProduto.upsert({
      where: {
        organizacaoId_fichaId: {
          organizacaoId: escopo.organizacaoId,
          fichaId: ficha.id,
        },
      },
      create: {
        organizacaoId: escopo.organizacaoId,
        fichaId: ficha.id,
        codigo: dados.codigo || null,
        grupos: json(dados.grupos),
      },
      update: { codigo: dados.codigo || null, grupos: json(dados.grupos) },
    });
    await auditar(
      tx,
      ctx,
      escopo,
      "PdvProduto",
      config.id,
      antes ? "ALTEROU" : "CRIOU",
      antes ? { codigo: antes.codigo, grupos: antes.grupos } : null,
      { codigo: config.codigo, grupos: dados.grupos },
    );
  });
}

export async function finalizarVenda(ctx: ContextoSessao, entrada: unknown) {
  const escopo = await exigirEscopo(ctx, "pdv.vender");
  const dados = esquemaFinalizar.parse(entrada);
  if (dados.descontoCentavos > 0 && !pode(ctx, "pdv.desconto"))
    throw new SemPermissao("conceder descontos");
  if (dados.clienteId && !pode(ctx, "crm.ver"))
    throw new SemPermissao("consultar clientes do CRM");
  const payloadHash = createHash("sha256")
    .update(JSON.stringify(dados))
    .digest("hex");
  return db.$transaction(
    async (tx) => {
      await travarUnidade(tx, escopo);
      const anterior = await tx.pdvVenda.findUnique({
        where: {
          organizacaoId_unidadeId_chave: { ...escopo, chave: dados.chave },
        },
      });
      if (anterior) {
        if (dados.carrinhoId && anterior.usuarioId !== ctx.usuario.id)
          throw new ErroPdv(
            "Carrinho indisponível para este operador e unidade.",
          );
        if (anterior.payloadHash !== payloadHash)
          throw new ErroPdv(
            "Esta tentativa pertence a outro carrinho. Atualize a tela.",
          );
        return anterior.id;
      }
      if (dados.modalidade === "ENTREGA" && !dados.entrega)
        throw new ErroPdv(
          "Informe o endereço, o frete e o prazo da entrega antes de concluir.",
        );
      if (dados.modalidade !== "ENTREGA" && dados.entrega)
        throw new ErroPdv(
          "Dados de entrega só podem acompanhar pedidos da modalidade entrega.",
        );
      const agoraAgendamento = new Date();
      const agendamento = dados.agendamento
        ? converterAgendamento(dados.agendamento, agoraAgendamento)
        : null;
      const statusInicial =
        agendamento && agendamento.iniciarPreparoEm > agoraAgendamento
          ? "AGENDADO"
          : "COZINHA";
      const entrega = dados.entrega
        ? await prepararEntrega(tx, ctx, escopo, dados.entrega, new Date())
        : null;
      if (entrega && agendamento)
        entrega.previstoEm = agendamento.agendadoPara.toISOString();
      const freteCentavos = entrega?.freteCentavos ?? 0;
      const carrinho = dados.carrinhoId
        ? await tx.pdvCarrinho.findFirst({
            where: {
              ...escopo,
              id: dados.carrinhoId,
              usuarioId: ctx.usuario.id,
            },
          })
        : null;
      if (dados.carrinhoId) {
        if (!carrinho)
          throw new ErroPdv(
            "Carrinho indisponível para este operador e unidade.",
          );
        if (carrinho.status !== "ATIVO")
          throw new ErroPdv(
            "Este carrinho já foi concluído ou descartado. Atualize a lista.",
          );
        if (carrinho.versao !== dados.versaoCarrinho)
          throw new ErroPdv(
            "Este carrinho mudou em outra aba. Retome a versão atual antes de concluir.",
          );
      }
      const caixa = await caixaAberto(tx, escopo, dados.caixaId);
      const produtos = await catalogo(tx, escopo.organizacaoId);
      const pedidoCalculado = calcularPedido(
        produtos,
        dados.itens,
        dados.descontoCentavos,
        dados.taxaCentavos + freteCentavos,
      );
      const resumo = {
        ...pedidoCalculado,
        ...(dados.pagamentoPendente === true
          ? { trocoCentavos: 0 }
          : conferirPagamentos(
              pedidoCalculado.totalCentavos,
              dados.pagamentos,
            )),
      };
      const cliente = dados.clienteId
        ? await tx.crmContact.findFirst({
            where: {
              id: dados.clienteId,
              storeId: escopo.unidadeId,
              active: true,
              mergedIntoId: null,
            },
            select: { id: true, name: true },
          })
        : null;
      if (dados.clienteId && !cliente)
        throw new ErroPdv("Cliente indisponível nesta unidade.");
      if (
        !(await tx.localEstoque.findFirst({
          where: {
            id: caixa.localEstoqueId,
            unidadeId: escopo.unidadeId,
            ativo: true,
          },
        }))
      )
        throw new ErroPdv("O local de estoque do caixa não está ativo.");
      const [fichas, insumos] = await Promise.all([
        tx.fichaTecnica.findMany({
          where: {
            organizacaoId: escopo.organizacaoId,
            ativo: true,
            excluidoEm: null,
          },
          include: { itens: true },
        }),
        tx.insumo.findMany({
          where: {
            organizacaoId: escopo.organizacaoId,
            ativo: true,
            excluidoEm: null,
          },
        }),
      ]);
      const receitas = fichas.map((f) => ({
        id: f.id,
        nome: f.nome,
        rendimento: Number(f.rendimento),
        unidadeRendimento: f.unidadeRendimento,
        itens: f.itens.map((i) => ({
          insumoId: i.insumoId,
          subFichaId: i.subFichaId,
          quantidade: Number(i.quantidade),
          unidade: i.unidade,
          perdaPercentual: Number(i.perdaPercentual),
        })),
      }));
      const ingredientes = insumos.map((i) => ({
        id: i.id,
        nome: i.nome,
        unidadeMedida: i.unidadeMedida,
        custoUnitario: i.custoMedio.toString(),
      }));
      const entradas = dados.itens.flatMap((item) => {
        const produto = produtos.find((p) => p.id === item.produtoId)!;
        const configuradas = produto.grupos.flatMap((g) => {
          const opcoes = g.opcoes.filter((o) => item.opcoes.includes(o.id));
          return opcoes
            .filter((o) => o.fichaId)
            .map((o) => ({
              fichaId: o.fichaId!,
              quantidade:
                item.quantidade / (g.calculo === "MEDIA" ? opcoes.length : 1),
            }));
        });
        const bases = [
          { fichaId: item.produtoId, quantidade: item.quantidade },
          ...configuradas,
        ];
        if (!calcularConsumo(bases, receitas, ingredientes).length)
          throw new ErroPdv(
            `Cadastre os ingredientes da ficha ${produto.nome} antes de vender.`,
          );
        return bases;
      });
      const consumo = calcularConsumo(entradas, receitas, ingredientes);
      const venda = await tx.pdvVenda.create({
        data: {
          ...escopo,
          caixaId: caixa.id,
          chave: dados.chave,
          payloadHash,
          usuarioId: ctx.usuario.id,
          operador: ctx.usuario.nome,
          status: dados.pagamentoPendente === true ? "PENDENTE" : "CONCLUIDA",
          ...(dados.pagamentoPendente === true
            ? {}
            : {
                caixaRecebimentoId: caixa.id,
                recebidoEm: new Date(),
                recebidoPorId: ctx.usuario.id,
                recebidoPorNome: ctx.usuario.nome,
                recebimentoChave: dados.chave,
                recebimentoHash: payloadHash,
              }),
          clienteId: cliente?.id,
          cliente: cliente?.name,
          modalidade: dados.modalidade,
          observacao: dados.observacao,
          subtotalCentavos: resumo.subtotalCentavos,
          descontoCentavos: dados.descontoCentavos,
          taxaCentavos: dados.taxaCentavos,
          freteCentavos,
          ...(entrega ? { entrega: json(entrega) } : {}),
          totalCentavos: resumo.totalCentavos,
          trocoCentavos: resumo.trocoCentavos,
          itens: json(resumo.itens),
          pagamentos: json(dados.pagamentos),
          consumo: json(consumo),
        },
      });
      // O número é apenas visual; autorização e rotas continuam usando id aleatório.
      // A trava da unidade já adquirida serializa a sequência junto da venda.
      const ultimoPedido = await tx.pdvPedido.aggregate({
        where: escopo,
        _max: { numero: true },
      });
      const pedido = await tx.pdvPedido.create({
        data: {
          ...escopo,
          vendaId: venda.id,
          numero: (ultimoPedido._max.numero ?? 0) + 1,
          criadoEm: venda.criadaEm,
          status: statusInicial,
          ...(agendamento ?? {}),
          preparoIniciadoEm:
            statusInicial === "COZINHA" ? agoraAgendamento : null,
          eventos: {
            create: {
              de: null,
              para: statusInicial,
              versao: 1,
              usuarioId: ctx.usuario.id,
              operador: ctx.usuario.nome,
            },
          },
        },
      });
      await auditar(tx, ctx, escopo, "PdvPedido", pedido.id, "CRIOU", null, {
        vendaId: venda.id,
        numero: pedido.numero,
        status: statusInicial,
        versao: 1,
        ...(agendamento
          ? {
              agendadoPara: agendamento.agendadoPara.toISOString(),
              iniciarPreparoEm: agendamento.iniciarPreparoEm.toISOString(),
              antecedenciaMinutos: agendamento.antecedenciaMinutos,
            }
          : {}),
      });
      if (carrinho) {
        await tx.pdvCarrinho.update({
          where: { id: carrinho.id },
          data: {
            status: "CONCLUIDO",
            concluidoEm: new Date(),
            vendaId: venda.id,
            versao: { increment: 1 },
          },
        });
        await auditar(
          tx,
          ctx,
          escopo,
          "PdvCarrinho",
          carrinho.id,
          "ALTEROU",
          { status: carrinho.status, versao: carrinho.versao },
          {
            status: "CONCLUIDO",
            versao: carrinho.versao + 1,
            vendaId: venda.id,
          },
        );
      }
      // Ordem estável reduz deadlocks com outras rotinas que atualizam as posições.
      for (const c of [...consumo].sort((a, b) =>
        a.insumoId.localeCompare(b.insumoId),
      )) {
        const alteradas = await tx.posicaoEstoque.updateMany({
          where: {
            unidadeId: escopo.unidadeId,
            localId: caixa.localEstoqueId,
            insumoId: c.insumoId,
            quantidade: { gte: new Prisma.Decimal(c.quantidade) },
          },
          data: { quantidade: { decrement: new Prisma.Decimal(c.quantidade) } },
        });
        if (alteradas.count !== 1)
          throw new ErroPdv(
            `Estoque insuficiente de ${c.nome} no local do caixa.`,
          );
        await tx.movimentoEstoque.create({
          data: {
            unidadeId: escopo.unidadeId,
            localId: caixa.localEstoqueId,
            insumoId: c.insumoId,
            tipo: "VENDA",
            quantidade: c.quantidade,
            custoUnitario: c.custoUnitario,
            motivo: `PDV ${venda.id}`,
            registradoPorId: ctx.usuario.id,
          },
        });
      }
      await auditar(tx, ctx, escopo, "PdvVenda", venda.id, "CRIOU", null, {
        totalCentavos: venda.totalCentavos,
        status: venda.status,
        versaoFinanceira: venda.versaoFinanceira,
        caixaRecebimentoId: venda.caixaRecebimentoId,
        caixaId: caixa.id,
        itens: resumo.itens,
      });
      return venda.id;
    },
    { timeout: 20_000 },
  );
}
export async function cancelarVenda(ctx: ContextoSessao, entrada: unknown) {
  const escopo = await exigirEscopo(ctx, "pdv.cancelar");
  const dados = esquemaCancelar.parse(entrada);
  return db.$transaction(
    async (tx) => {
      await travarUnidade(tx, escopo);
      const venda = await tx.pdvVenda.findFirst({
        where: { ...escopo, id: dados.vendaId },
        include: { caixa: true, caixaRecebimento: true },
      });
      if (!venda) throw new ErroPdv("Venda não encontrada nesta unidade.");
      const devolucaoPagamento =
        venda.recebidoEm !== null ||
        venda.recebimentoChave !== null ||
        (Array.isArray(venda.pagamentos) && venda.pagamentos.length > 0);
      const pedido = await tx.pdvPedido.findFirst({
        where: { ...escopo, vendaId: venda.id },
      });
      if (dados.pedidoId && (!pedido || pedido.id !== dados.pedidoId))
        throw new ErroPdv("Pedido indisponível para esta venda e unidade.");
      if (venda.status === "CANCELADA") {
        if (
          dados.versaoFinanceira !== undefined &&
          venda.versaoFinanceira !== dados.versaoFinanceira &&
          venda.versaoFinanceira !== dados.versaoFinanceira + 1
        )
          throw new ErroPdv(
            "A situação financeira desta venda mudou. Atualize a venda antes de continuar.",
          );
        if (
          dados.pedidoId &&
          (pedido!.status !== "CANCELADO" ||
            (pedido!.versao !== dados.versaoPedido &&
              pedido!.versao !== dados.versaoPedido! + 1))
        )
          throw new ErroPdv(
            "Este pedido mudou em outra tela. Atualize o quadro antes de continuar.",
          );
        return { devolucaoPagamento };
      }
      if (
        dados.versaoFinanceira !== undefined &&
        venda.versaoFinanceira !== dados.versaoFinanceira
      )
        throw new ErroPdv(
          "A situação financeira desta venda mudou. Atualize a venda antes de cancelar.",
        );
      if (dados.pedidoId && pedido!.versao !== dados.versaoPedido)
        throw new ErroPdv(
          "Este pedido mudou em outra tela. Atualize o quadro antes de cancelar.",
        );
      if (pedido?.status === "CANCELADO")
        throw new ErroPdv(
          "A situação financeira deste pedido precisa de conferência antes de cancelar.",
        );
      const caixaPagamento = venda.caixaRecebimento ?? venda.caixa;
      if (venda.status === "CONCLUIDA" && caixaPagamento.fechadoEm)
        throw new ErroPdv(
          "O caixa do recebimento desta venda já foi fechado. O cancelamento exige um fluxo de devolução posterior.",
        );
      const consumo = venda.consumo as ConsumoPdv[];
      for (const c of consumo) {
        await tx.posicaoEstoque.upsert({
          where: {
            localId_insumoId: {
              localId: venda.caixa.localEstoqueId,
              insumoId: c.insumoId,
            },
          },
          update: {
            quantidade: { increment: new Prisma.Decimal(c.quantidade) },
          },
          create: {
            unidadeId: escopo.unidadeId,
            localId: venda.caixa.localEstoqueId,
            insumoId: c.insumoId,
            quantidade: c.quantidade,
          },
        });
        await tx.movimentoEstoque.create({
          data: {
            unidadeId: escopo.unidadeId,
            localId: venda.caixa.localEstoqueId,
            insumoId: c.insumoId,
            tipo: "ESTORNO_VENDA",
            quantidade: c.quantidade,
            custoUnitario: c.custoUnitario,
            motivo: `Cancelamento PDV ${venda.id}: ${dados.motivo}`,
            registradoPorId: ctx.usuario.id,
          },
        });
      }
      await tx.pdvVenda.update({
        where: { id: venda.id },
        data: {
          status: "CANCELADA",
          canceladaEm: new Date(),
          canceladaPorId: ctx.usuario.id,
          motivoCancelamento: dados.motivo,
          versaoFinanceira: { increment: 1 },
        },
      });
      if (pedido) {
        await tx.pdvPedido.update({
          where: { id: pedido.id },
          data: {
            status: "CANCELADO",
            versao: { increment: 1 },
            canceladoEm: new Date(),
            eventos: {
              create: {
                de: pedido.status,
                para: "CANCELADO",
                versao: pedido.versao + 1,
                usuarioId: ctx.usuario.id,
                operador: ctx.usuario.nome,
                observacao: dados.motivo,
              },
            },
          },
        });
        await auditar(
          tx,
          ctx,
          escopo,
          "PdvPedido",
          pedido.id,
          "ALTEROU",
          { status: pedido.status, versao: pedido.versao },
          {
            status: "CANCELADO",
            versao: pedido.versao + 1,
            motivo: dados.motivo,
          },
        );
      }
      await auditar(
        tx,
        ctx,
        escopo,
        "PdvVenda",
        venda.id,
        "ALTEROU",
        { status: venda.status, versaoFinanceira: venda.versaoFinanceira },
        {
          status: "CANCELADA",
          motivo: dados.motivo,
          versaoFinanceira: venda.versaoFinanceira + 1,
          devolucaoPagamento,
        },
      );
      return { devolucaoPagamento };
    },
    { timeout: 20_000 },
  );
}
