import { createHash, randomBytes } from "node:crypto";

import { Prisma, type AcaoAuditoria } from "@prisma/client";

import { baixarFotoNota } from "@/connectors/whatsapp/nota-midia";
import { configuracaoEvolution } from "@/connectors/whatsapp/configuracao";
import { pode, type ContextoSessao } from "@/core/sessao/nucleo";
import {
  confirmacaoVigente,
  hashPropostaNota,
  normalizarDescricaoNota,
  perguntaComOpcoes,
  prepararConferencia,
  propostaDaConferencia,
  responderConferencia,
  resumoConferencia,
  type CatalogoNota,
  type PerguntaNota,
  type RascunhoNota,
} from "@/modules/assistente/schemas/conferencia-nota";
import { contextoParaNota } from "@/modules/assistente/services/contexto-nota";
import { gravarArquivo, lerArquivo } from "@/server/arquivos";
import { db } from "@/server/db";
import { lerNotaFiscalFoto } from "@/server/ia/nota-fiscal";
import {
  notaAssistidaPronta,
  NotaAssistidaRecusada,
} from "@/server/nota-assistida-contrato";

import { lancarNotaAssistida } from "./lancar-nota";

const json = (v: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(v));
const AJUDA =
  "Envie uma foto nítida da nota fiscal ou cupom, mostrando fornecedor, data, itens e total. Vou conferir com você antes de dar entrada no estoque e no financeiro. Uma nota por vez. Você pode responder por números às opções, pedir RESUMO, CORRIGIR ITEM 1 QUANTIDADE 2, ALTERAR PAGAMENTO ou CANCELAR.";
const enderecoNota = (id: string) =>
  `${process.env.APP_URL?.trim().replace(/\/+$/, "") ?? ""}/estoque/entradas/${encodeURIComponent(id)}`;

async function catalogo(ctx: ContextoSessao): Promise<CatalogoNota> {
  const unidadeId = ctx.unidadeAtiva!.id;
  const organizacaoId = ctx.organizacao.id;
  const [empresas, categorias, locais, contas, insumos] = await Promise.all([
    db.empresaFinanceira.findMany({
      where: { organizacaoId, unidadeId, ativa: true },
      select: { id: true, nome: true, cnpj: true },
      orderBy: { nome: "asc" },
    }),
    db.categoriaFinanceira.findMany({
      where: {
        organizacaoId,
        ativa: true,
        tipo: "DESPESA",
        grupoDre: "MERCADORIA",
      },
      select: { id: true, nome: true },
      orderBy: { nome: "asc" },
    }),
    db.localEstoque.findMany({
      where: { unidadeId, ativo: true },
      select: { id: true, nome: true },
      orderBy: { ordem: "asc" },
    }),
    db.contaFinanceira.findMany({
      where: { unidadeId, ativa: true },
      select: { id: true, nome: true, empresaId: true },
      orderBy: { nome: "asc" },
    }),
    db.insumo.findMany({
      where: { organizacaoId, ativo: true, excluidoEm: null },
      select: { id: true, nome: true, unidadeMedida: true },
      orderBy: { nome: "asc" },
    }),
  ]);
  return {
    unidade: ctx.unidadeAtiva!.nome,
    empresas: empresas.map((e) => ({
      nome: `${e.nome} (${e.cnpj})`,
      valor: e.id,
    })),
    categorias: categorias.map((e) => ({ nome: e.nome, valor: e.id })),
    locais: locais.map((e) => ({ nome: e.nome, valor: e.id })),
    contas: contas.map((e) => ({
      nome: e.nome,
      valor: e.id,
      empresaId: e.empresaId,
    })),
    insumos,
    podeCriarInsumo: pode(ctx, "cardapio.editar"),
  };
}

/** O lease limita todas as escritas, inclusive quando uma rede termina após perder a posse. */
async function alterar<T>(
  conversaId: string,
  leaseDono: string | undefined,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM conversa_nota_whatsapp WHERE id=${conversaId} FOR UPDATE`;
    if (leaseDono) {
      const c = await tx.conversaNotaWhatsapp.findUniqueOrThrow({
        where: { id: conversaId },
      });
      if (c.leaseDono !== leaseDono || !c.leaseAte || c.leaseAte <= new Date())
        throw new Error(
          "A conferência já está sendo retomada por outro processo.",
        );
    }
    return fn(tx);
  });
}
type Mensagem = Prisma.MensagemNotaWhatsappGetPayload<{
  include: { conversa: true };
}>;
async function responder(
  m: Mensagem,
  texto: string,
  leaseDono?: string,
  mutar?: (tx: Prisma.TransactionClient) => Promise<unknown>,
) {
  await alterar(m.conversaId, leaseDono, async (tx) => {
    if (mutar) await mutar(tx);
    await tx.mensagemNotaWhatsapp.upsert({
      where: {
        instanciaId_idExterno: {
          instanciaId: m.instanciaId,
          idExterno: `resposta:${m.id}`,
        },
      },
      create: {
        conversaId: m.conversaId,
        instanciaId: m.instanciaId,
        idExterno: `resposta:${m.id}`,
        direcao: "SAIDA",
        tipo: "TEXTO",
        texto,
        recebidoEm: new Date(),
      },
      update: {},
    });
    await tx.mensagemNotaWhatsapp.update({
      where: { id: m.id },
      data: { aplicadaEm: new Date() },
    });
  });
}
async function auditar(
  tx: Prisma.TransactionClient,
  m: Mensagem,
  notaId: string,
  acao: AcaoAuditoria,
  depois: unknown,
) {
  await tx.auditoria.create({
    data: {
      organizacaoId: m.conversa.organizacaoId,
      unidadeId: m.conversa.unidadeId,
      usuarioId: m.conversa.usuarioId,
      entidade: "NotaFiscalWhatsapp",
      entidadeId: notaId,
      acao,
      valoresDepois: json(depois),
    },
  });
}

async function mostrar(
  m: Mensagem,
  notaId: string,
  r: RascunhoNota,
  c: CatalogoNota,
  leaseDono?: string,
  aviso?: string,
) {
  const pergunta = prepararConferencia(r, c);
  const resumo = resumoConferencia(r, c);
  // Nunca trunca itens: uma confirmação precisa conter todos os dados.
  if (resumo.length > 48_000)
    throw new Error(
      "A nota é extensa demais para conferir pelo WhatsApp. Use o cadastro pelo sistema.",
    );
  await alterar(m.conversaId, leaseDono, async (tx) => {
    const anterior = await tx.notaFiscalWhatsapp.findUniqueOrThrow({
      where: { id: notaId },
    });
    const revisao = anterior.revisao + 1;
    const codigo = pergunta
      ? null
      : randomBytes(3).toString("hex").toUpperCase();
    const pronta = pergunta
      ? null
      : notaAssistidaPronta.parse(propostaDaConferencia(r));
    await tx.notaFiscalWhatsapp.update({
      where: { id: notaId },
      data: {
        estado: pergunta ? "REVISAO" : "PRONTA",
        rascunho: json(r),
        pergunta: pergunta ? json(pergunta) : Prisma.DbNull,
        revisao,
        codigo,
        resumoHash: pronta ? hashPropostaNota(pronta) : null,
        resumoEm: null,
        expiraEm: null,
        erro: null,
      },
    });
    await tx.mensagemNotaWhatsapp.updateMany({
      where: { conversaId: m.conversaId, tipo: "RESUMO", estado: "PENDENTE" },
      data: { estado: "CANCELADA" },
    });
    const texto = [
      aviso,
      resumo,
      pergunta
        ? perguntaComOpcoes(pergunta)
        : `Está tudo correto e os produtos já foram recebidos?\nResponda CONFIRMAR ${codigo} para cadastrar os itens indicados, dar entrada no estoque e registrar o financeiro acima. Esse código vale por 30 minutos após o envio.\nPara ajustar, responda CORRIGIR ITEM 1 QUANTIDADE 2, ALTERAR PAGAMENTO, ALTERAR LOCAL ou CANCELAR.`,
    ]
      .filter(Boolean)
      .join("\n\n");
    await tx.mensagemNotaWhatsapp.upsert({
      where: {
        instanciaId_idExterno: {
          instanciaId: m.instanciaId,
          idExterno: `resumo:${notaId}:${revisao}`,
        },
      },
      create: {
        conversaId: m.conversaId,
        instanciaId: m.instanciaId,
        idExterno: `resumo:${notaId}:${revisao}`,
        direcao: "SAIDA",
        tipo: "RESUMO",
        texto,
        notaId,
        recebidoEm: new Date(),
      },
      update: {},
    });
    await tx.mensagemNotaWhatsapp.update({
      where: { id: m.id },
      data: { aplicadaEm: new Date() },
    });
  });
}

async function executar(
  m: Mensagem,
  notaId: string,
  ctx: ContextoSessao,
  leaseDono?: string,
  retomada?: Mensagem,
) {
  const nota = await db.notaFiscalWhatsapp.findUniqueOrThrow({
    where: { id: notaId },
  });
  if (nota.estado !== "EXECUTANDO" || nota.confirmacaoId !== m.id) return;
  const dados = notaAssistidaPronta.parse(
    propostaDaConferencia(nota.rascunho as unknown as RascunhoNota),
  );
  if (nota.resumoHash !== hashPropostaNota(dados))
    throw new Error("A proposta foi alterada após a confirmação.");
  const atual = await contextoParaNota(m.instanciaId, m.conversa.vinculoId);
  if (!atual || atual.contexto.usuario.id !== ctx.usuario.id)
    throw new Error("A autorização para lançar a nota foi revogada.");
  let resultado;
  try {
    resultado = await lancarNotaAssistida(atual.contexto, dados);
  } catch (e) {
    if (!(e instanceof NotaAssistidaRecusada)) throw e;
    // Recusa de validação sai da transação sem efeitos. Erros de banco/rede
    // conservam a aprovação imutável para recuperar a mesma operação.
    await responder(
      m,
      `${e.message}\nO lançamento não foi realizado. Peça RESUMO para revisar os dados ou CANCELAR para descartar.`,
      leaseDono,
      async (tx) => {
        await tx.notaFiscalWhatsapp.update({
          where: { id: notaId },
          data: {
            estado: "REVISAO",
            codigo: null,
            resumoHash: null,
            resumoEm: null,
            expiraEm: null,
            confirmacaoId: null,
          },
        });
        if (retomada)
          await tx.mensagemNotaWhatsapp.update({
            where: { id: retomada.id },
            data: { aplicadaEm: new Date() },
          });
      },
    );
    return;
  }
  await alterar(m.conversaId, leaseDono, async (tx) => {
    await tx.notaFiscalWhatsapp.update({
      where: { id: notaId },
      data: { estado: "LANCADA", resultado: json(resultado) },
    });
    const fornecedor = normalizarDescricaoNota(
      dados.fornecedor.documento || dados.fornecedor.nome,
    );
    const r = nota.rascunho as unknown as RascunhoNota;
    for (const item of r.itens) {
      const insumoId =
        item.insumoId ??
        (
          await tx.insumo.findFirst({
            where: {
              organizacaoId: ctx.organizacao.id,
              nome: item.novoInsumo!.nome,
              unidadeMedida: item.novoInsumo!.unidadeMedida,
            },
            select: { id: true },
          })
        )?.id;
      if (!insumoId) continue;
      await tx.vinculoItemNotaWhatsapp.upsert({
        where: {
          organizacaoId_unidadeId_fornecedor_descricao_unidadeNota: {
            organizacaoId: ctx.organizacao.id,
            unidadeId: ctx.unidadeAtiva!.id,
            fornecedor,
            descricao: normalizarDescricaoNota(item.descricao),
            unidadeNota: item.unidade.toUpperCase(),
          },
        },
        create: {
          organizacaoId: ctx.organizacao.id,
          unidadeId: ctx.unidadeAtiva!.id,
          fornecedor,
          descricao: normalizarDescricaoNota(item.descricao),
          unidadeNota: item.unidade.toUpperCase(),
          insumoId,
          fator: item.fatorConversao!,
          confirmadoPorId: ctx.usuario.id,
        },
        update: {
          insumoId,
          fator: item.fatorConversao!,
          confirmadoPorId: ctx.usuario.id,
        },
      });
    }
    await tx.conversaNotaWhatsapp.update({
      where: { id: m.conversaId },
      data: {
        notaAtivaId: null,
        padroes: json({
          empresaId: dados.empresaId,
          localId: dados.localId,
          categoriaId: dados.categoriaId,
          contaId: dados.pagamento.contaId,
          fornecedor,
        }),
      },
    });
    await auditar(tx, m, notaId, "ALTEROU", {
      estado: "LANCADA",
      ...resultado,
    });
    // O resultado e a resposta nascem juntos. Reiniciar após o commit não
    // pode trocar a confirmação de sucesso por uma mensagem de ajuda.
    await tx.mensagemNotaWhatsapp.upsert({
      where: {
        instanciaId_idExterno: {
          instanciaId: m.instanciaId,
          idExterno: `resposta:${m.id}`,
        },
      },
      create: {
        conversaId: m.conversaId,
        instanciaId: m.instanciaId,
        idExterno: `resposta:${m.id}`,
        direcao: "SAIDA",
        tipo: "TEXTO",
        recebidoEm: new Date(),
        texto: `Nota cadastrada com sucesso. Estoque atualizado e ${resultado.lancamentoIds.length} lançamento(s) no financeiro${dados.pagamento.situacao === "PAGA" ? ", com pagamento registrado na conta confirmada" : " a pagar"}.\nNota: ${enderecoNota(resultado.notaId)}\nVocê já pode enviar a próxima foto.`,
      },
      update: {},
    });
    await tx.mensagemNotaWhatsapp.update({
      where: { id: m.id },
      data: { aplicadaEm: new Date() },
    });
    if (retomada)
      await tx.mensagemNotaWhatsapp.update({
        where: { id: retomada.id },
        data: { aplicadaEm: new Date() },
      });
  });
}

async function foto(m: Mensagem, ctx: ContextoSessao, leaseDono?: string) {
  const existente = await db.notaFiscalWhatsapp.findUnique({
    where: { mensagemId: m.id },
  });
  if (existente?.rascunho) return; // Repetição depois de salvar a leitura não chama novamente a IA.
  const ativa =
    m.conversa.notaAtivaId &&
    (await db.notaFiscalWhatsapp.findUnique({
      where: { id: m.conversa.notaAtivaId },
    }));
  if (
    ativa &&
    ativa.id !== existente?.id &&
    !["LANCADA", "CANCELADA", "FALHOU"].includes(ativa.estado)
  ) {
    await responder(
      m,
      "Há uma nota aguardando conferência. Termine as respostas ou envie CANCELAR antes de mandar a próxima foto. Depois reenvie esta foto para ela ser lida.",
      leaseDono,
    );
    return;
  }
  const nota =
    existente ??
    (await alterar(m.conversaId, leaseDono, async (tx) => {
      const n = await tx.notaFiscalWhatsapp.create({
        data: {
          organizacaoId: ctx.organizacao.id,
          unidadeId: ctx.unidadeAtiva!.id,
          instanciaId: m.instanciaId,
          vinculoId: m.conversa.vinculoId,
          usuarioId: ctx.usuario.id,
          mensagemId: m.id,
        },
      });
      await tx.conversaNotaWhatsapp.update({
        where: { id: m.conversaId },
        data: { notaAtivaId: n.id },
      });
      await auditar(tx, m, n.id, "CRIOU", {
        estado: "RECEBIDA",
        origem: "foto-whatsapp",
      });
      return n;
    }));
  try {
    let foto;
    let arquivoId = nota.arquivoId;
    if (arquivoId) {
      const a = await lerArquivo(arquivoId);
      if (
        !a ||
        a.registro.organizacaoId !== ctx.organizacao.id ||
        a.registro.unidadeId !== ctx.unidadeAtiva!.id ||
        a.registro.enviadoPorId !== ctx.usuario.id
      )
        throw new Error("Foto não está disponível nesta unidade.");
      foto = { bytes: a.bytes, tipo: a.registro.tipo };
    } else {
      const instancia = await db.instanciaWhatsapp.findUniqueOrThrow({
        where: { id: m.instanciaId },
        select: { nome: true },
      });
      const config = configuracaoEvolution(process.env);
      if (config.tipo !== "ok" || config.instancia !== instancia.nome)
        throw new Error(
          "A conexão da foto foi alterada. Confira o WhatsApp da equipe antes de tentar novamente.",
        );
      foto = await baixarFotoNota(m.idExterno.replace(/^entrada:/, ""));
      const hash = createHash("sha256").update(foto.bytes).digest("hex");
      const repetida = await db.notaFiscalWhatsapp.findFirst({
        where: {
          unidadeId: ctx.unidadeAtiva!.id,
          organizacaoId: ctx.organizacao.id,
          imagemHash: hash,
          estado: "LANCADA",
        },
        select: { id: true },
      });
      if (repetida)
        throw new Error(
          "Esta foto já foi lançada. Confira a nota existente no sistema.",
        );
      arquivoId = (
        await gravarArquivo({
          organizacaoId: ctx.organizacao.id,
          unidadeId: ctx.unidadeAtiva!.id,
          enviadoPorId: ctx.usuario.id,
          bytes: foto.bytes,
          nomeOriginal: "nota-whatsapp",
          permissaoLeitura: "estoque.ver",
        })
      ).id;
      await alterar(m.conversaId, leaseDono, (tx) =>
        tx.notaFiscalWhatsapp.update({
          where: { id: nota.id },
          data: { arquivoId, imagemHash: hash, estado: "LENDO" },
        }),
      );
    }
    const leitura = await lerNotaFiscalFoto(
      {
        organizationId: ctx.organizacao.id,
        storeId: ctx.unidadeAtiva!.id,
        solicitacaoId: nota.id,
      },
      foto,
    );
    const unidade = await db.unidade.findUniqueOrThrow({
      where: { id: ctx.unidadeAtiva!.id },
      select: { fusoHorario: true },
    });
    const recebidaEm = new Intl.DateTimeFormat("en-CA", {
      timeZone: unidade.fusoHorario,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(m.recebidoEm);
    const r: RascunhoNota = {
      operacaoId: nota.id,
      arquivoId: arquivoId!,
      fornecedor: leitura.fornecedor,
      numero: leitura.numero,
      serie: leitura.serie,
      chaveAcesso: leitura.chaveAcesso,
      emitidaEm: leitura.emitidaEm,
      recebidaEm,
      valorTotal: leitura.total,
      itens: leitura.itens,
      pagamento: {},
    };
    // Informações impressas são sugestões visíveis no resumo, nunca baixa
    // automática. Tudo continua sujeito à confirmação humana final.
    const situacao = leitura.pagamento?.paga;
    if (typeof situacao === "boolean")
      r.pagamento.situacao = situacao ? "PAGA" : "A_PAGAR";
    const forma = leitura.pagamento?.forma?.toUpperCase();
    const formas = [
      "PIX",
      "BOLETO",
      "DINHEIRO",
      "CREDITO",
      "DEBITO",
      "TED",
      "DEBITO_CONTA",
      "VA",
      "VR",
      "OUTRO",
    ];
    if (forma && formas.includes(forma))
      r.pagamento.forma = forma as NonNullable<
        RascunhoNota["pagamento"]["forma"]
      >;
    if (leitura.pagamento?.parcelas)
      r.pagamento.parcelas = leitura.pagamento.parcelas;
    const fornecedor = normalizarDescricaoNota(
      leitura.fornecedor.documento || leitura.fornecedor.nome,
    );
    const padroes = m.conversa.padroes as {
      empresaId?: string;
      localId?: string;
      categoriaId?: string;
      fornecedor?: string;
    } | null;
    if (padroes) {
      r.empresaId = padroes.empresaId;
      r.localId = padroes.localId;
      if (padroes.fornecedor === fornecedor)
        r.categoriaId = padroes.categoriaId;
    }
    const vinculos = await db.vinculoItemNotaWhatsapp.findMany({
      where: {
        organizacaoId: ctx.organizacao.id,
        unidadeId: ctx.unidadeAtiva!.id,
        fornecedor,
      },
    });
    for (const item of r.itens) {
      const v = vinculos.find(
        (v) =>
          v.descricao === normalizarDescricaoNota(item.descricao) &&
          v.unidadeNota === item.unidade.toUpperCase(),
      );
      if (v) {
        item.insumoId = v.insumoId;
        item.fatorConversao = Number(v.fator);
      }
    }
    await alterar(m.conversaId, leaseDono, (tx) =>
      tx.notaFiscalWhatsapp.update({
        where: { id: nota.id },
        data: { leitura: json(leitura) },
      }),
    );
    await mostrar(
      m,
      nota.id,
      r,
      await catalogo(ctx),
      leaseDono,
      [
        "Li a foto. Confira os dados abaixo.",
        ...leitura.alertas.map((a) => `Atenção: ${a}`),
      ].join("\n"),
    );
  } catch (e) {
    // Erros da rede/Prisma nunca são devolvidos com payload ou credenciais.
    const mensagem =
      e instanceof Error && !/Prisma|fetch|ECONN|timeout|NOTA_/i.test(e.message)
        ? e.message.slice(0, 300)
        : "Não consegui ler todos os dados com segurança. Confira a conexão de IA na Severina ou envie uma foto mais nítida.";
    await responder(
      m,
      `${mensagem}\nNenhum lançamento foi realizado no estoque ou financeiro.`,
      leaseDono,
      async (tx) => {
        await tx.notaFiscalWhatsapp.update({
          where: { id: nota.id },
          data: { estado: "FALHOU", erro: mensagem },
        });
        await tx.conversaNotaWhatsapp.update({
          where: { id: m.conversaId },
          data: { notaAtivaId: null },
        });
      },
    );
  }
}

export async function tratarMensagemNota(
  mensagemId: string,
  leaseDono?: string,
): Promise<void> {
  const m = await db.mensagemNotaWhatsapp.findUniqueOrThrow({
    where: { id: mensagemId },
    include: { conversa: true },
  });
  if (m.aplicadaEm) return;
  const autorizado = await contextoParaNota(
    m.instanciaId,
    m.conversa.vinculoId,
  );
  if (
    !autorizado ||
    autorizado.contexto.organizacao.id !== m.conversa.organizacaoId ||
    autorizado.contexto.unidadeAtiva?.id !== m.conversa.unidadeId ||
    autorizado.contexto.usuario.id !== m.conversa.usuarioId
  )
    return;
  const ctx = autorizado.contexto;
  if (m.tipo === "FOTO") {
    await foto(m, ctx, leaseDono);
    return;
  }
  const texto = m.texto?.trim() ?? "";
  const nota =
    m.conversa.notaAtivaId &&
    (await db.notaFiscalWhatsapp.findUnique({
      where: { id: m.conversa.notaAtivaId },
    }));
  // A execução aprovada sobrevive ao reinício e conserva a proposta e o autor.
  if (nota && nota.estado === "EXECUTANDO") {
    if (nota.confirmacaoId === m.id) await executar(m, nota.id, ctx, leaseDono);
    else if (/^resumo$/i.test(texto) && nota.confirmacaoId) {
      const confirmacao = await db.mensagemNotaWhatsapp.findFirst({
        where: { id: nota.confirmacaoId, conversaId: m.conversaId },
        include: { conversa: true },
      });
      if (confirmacao) {
        await executar(confirmacao, nota.id, ctx, leaseDono, m);
      }
    } else
      await responder(
        m,
        "A nota já confirmada está sendo concluída. Aguarde o resultado ou envie RESUMO para retomar a mesma operação.",
        leaseDono,
      );
    return;
  }
  if (
    !nota ||
    ["LANCADA", "CANCELADA", "FALHOU"].includes(nota.estado) ||
    !nota.rascunho
  ) {
    await responder(m, AJUDA, leaseDono);
    return;
  }
  if (/^cancelar$/i.test(texto)) {
    await responder(
      m,
      "Conferência cancelada. Nenhum lançamento realizado. Pode enviar outra foto.",
      leaseDono,
      async (tx) => {
        await tx.notaFiscalWhatsapp.update({
          where: { id: nota.id },
          data: {
            estado: "CANCELADA",
            codigo: null,
            resumoHash: null,
            expiraEm: null,
          },
        });
        await tx.conversaNotaWhatsapp.update({
          where: { id: m.conversaId },
          data: { notaAtivaId: null },
        });
        await tx.mensagemNotaWhatsapp.updateMany({
          where: { notaId: nota.id, direcao: "SAIDA", estado: "PENDENTE" },
          data: { estado: "CANCELADA" },
        });
        await auditar(tx, m, nota.id, "ALTEROU", { estado: "CANCELADA" });
      },
    );
    return;
  }
  const r = nota.rascunho as unknown as RascunhoNota;
  if (/^confirmar\b/i.test(texto)) {
    if (r.pagamento.situacao === "PAGA" && !pode(ctx, "financeiro.quitar")) {
      await responder(
        m,
        "Seu usuário não pode registrar pagamentos. Um responsável precisa conceder a permissão de baixa no Financeiro antes desta confirmação. Você pode CANCELAR a conferência.",
        leaseDono,
      );
      return;
    }
    if (r.itens.some((i) => i.novoInsumo) && !pode(ctx, "cardapio.editar")) {
      await mostrar(
        m,
        nota.id,
        r,
        await catalogo(ctx),
        leaseDono,
        "Seu acesso não permite cadastrar novos insumos. Escolha um cadastro existente ou peça acesso a um responsável.",
      );
      return;
    }
    const proposta = notaAssistidaPronta.safeParse(propostaDaConferencia(r));
    if (
      nota.estado !== "PRONTA" ||
      !proposta.success ||
      !confirmacaoVigente({
        texto,
        codigo: nota.codigo,
        resumoEm: nota.resumoEm,
        expiraEm: nota.expiraEm,
        recebidoEm: m.recebidoEm,
        agora: new Date(),
        hash: nota.resumoHash,
        proposta: proposta.data,
      })
    ) {
      await mostrar(
        m,
        nota.id,
        r,
        await catalogo(ctx),
        leaseDono,
        "A confirmação está vencida, chegou antes do resumo ou usa outro código. Confira esta versão atualizada.",
      );
      return;
    }
    await alterar(m.conversaId, leaseDono, async (tx) => {
      const alterada = await tx.notaFiscalWhatsapp.updateMany({
        where: {
          id: nota.id,
          estado: "PRONTA",
          revisao: nota.revisao,
          resumoHash: nota.resumoHash,
          codigo: nota.codigo,
        },
        data: { estado: "EXECUTANDO", confirmacaoId: m.id },
      });
      if (!alterada.count)
        throw new Error("A conferência mudou. Peça um novo resumo.");
      await auditar(tx, m, nota.id, "ALTEROU", {
        estado: "CONFIRMADA",
        revisao: nota.revisao,
        hash: nota.resumoHash,
        mensagemId: m.id,
      });
    });
    await executar(m, nota.id, ctx, leaseDono);
    return;
  }
  const c = await catalogo(ctx);
  const p = nota.pergunta as PerguntaNota | null;
  const aviso = responderConferencia(r, p, texto, c);
  if (aviso) {
    await responder(m, aviso, leaseDono, (tx) =>
      tx.notaFiscalWhatsapp.update({
        where: { id: nota.id },
        data: { rascunho: json(r), pergunta: p ? json(p) : Prisma.DbNull },
      }),
    );
    return;
  }
  await mostrar(m, nota.id, r, c, leaseDono);
}
