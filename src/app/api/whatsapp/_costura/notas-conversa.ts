import { createHash, randomBytes } from "node:crypto";

import { Prisma, type AcaoAuditoria } from "@prisma/client";
import { vincularArquivos } from "@/server/arquivos";

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
  resumoCurtoConferencia,
  type CatalogoNota,
  type PerguntaNota,
  type RascunhoNota,
} from "@/modules/assistente/schemas/conferencia-nota";
import { contextoParaNota } from "@/modules/assistente/services/contexto-nota";
import { lerArquivo } from "@/server/arquivos";
import { db } from "@/server/db";
import { gravarArquivoFiscal } from "@/server/notas/arquivos";
import {
  lerDocumentoFiscal,
  type EventoPipeline,
} from "@/server/notas/pipeline";
import { lerFiscalComGemini } from "@/server/notas/orcamento";
import {
  LeituraNotaRecusada,
  type TipoDocumentoNota,
} from "@/server/notas/documento";
import {
  conferenciaFiscal,
  pendenciasDaConferenciaFiscal,
  mensagemConferenciaFiscal,
  responderLeituraFiscal,
  rascunhoDaLeituraFiscal,
  type ConferenciaFiscal,
} from "@/modules/assistente/schemas/leitura-fiscal";
import {
  notaAssistidaPronta,
  NotaAssistidaRecusada,
} from "@/server/nota-assistida-contrato";

import { lancarNotaAssistida } from "./lancar-nota";

const json = (v: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(v));
const AJUDA =
  "Envie o XML da NF-e/NFC-e ou um PDF com texto. Para fotos, envie o cupom esticado, com boa luz e inteiro, de preferência como documento sem compressão. Uma nota por vez, até 20 MB. Vou conferir os dados com você antes de qualquer lançamento. Você pode pedir RESUMO, ITENS, corrigir campos ou CANCELAR. A consulta externa por QR está desativada até escolhermos o provedor.";
const enderecoNota = (id: string) =>
  `${process.env.APP_URL?.trim().replace(/\/+$/, "") ?? ""}/estoque/entradas/${encodeURIComponent(id)}`;

async function catalogo(ctx: ContextoSessao): Promise<CatalogoNota> {
  const unidadeId = ctx.unidadeAtiva!.id;
  const organizacaoId = ctx.organizacao.id;
  const [
    empresas,
    categorias,
    locais,
    contas,
    insumos,
    fornecedores,
    vinculos,
  ] = await Promise.all([
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
    db.fornecedor.findMany({
      where: { organizacaoId, excluidoEm: null },
      select: { id: true, nome: true, documento: true, ativo: true },
    }),
    db.vinculoItemNotaWhatsapp.findMany({
      where: { organizacaoId, unidadeId },
      select: {
        insumoId: true,
        fornecedor: true,
        descricao: true,
        unidadeNota: true,
        fator: true,
        codigoFornecedor: true,
        ean: true,
      },
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
    fornecedores,
    vinculos: vinculos.map((v) => ({ ...v, fator: Number(v.fator) })),
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
  const resumo = r.fiscal
    ? resumoCurtoConferencia(r, c)
    : resumoConferencia(r, c);
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
        : `Está tudo correto e os produtos já foram recebidos?\nResponda OK ${codigo} ou CONFIRMAR ${codigo} para cadastrar os itens indicados, dar entrada no estoque e registrar o financeiro acima. Esse código vale por 30 minutos após o envio.\nPara ajustar, responda CORRIGIR ITEM 1 QUANTIDADE 2, ALTERAR PAGAMENTO, ALTERAR LOCAL ou CANCELAR.`,
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
    resultado = await lancarNotaAssistida(atual.contexto, dados, {
      instanciaId: m.instanciaId,
      vinculoId: m.conversa.vinculoId,
    });
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
    const derivados = Array.isArray(nota.arquivosDerivados)
      ? nota.arquivosDerivados.flatMap((v) =>
          v &&
          typeof v === "object" &&
          !Array.isArray(v) &&
          typeof v.id === "string"
            ? [v.id]
            : [],
        )
      : [];
    if (derivados.length) {
      const livres = await tx.arquivo.findMany({
        where: {
          id: { in: derivados },
          organizacaoId: ctx.organizacao.id,
          unidadeId: ctx.unidadeAtiva!.id,
          enviadoPorId: ctx.usuario.id,
          entidade: null,
        },
        select: { id: true },
      });
      await vincularArquivos(
        tx,
        livres.map((v) => v.id),
        {
          organizacaoId: ctx.organizacao.id,
          enviadoPorId: ctx.usuario.id,
          entidade: "NotaEntrada",
          entidadeId: resultado.notaId,
        },
      );
    }
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
          ...(item.codigoFornecedor
            ? { codigoFornecedor: item.codigoFornecedor }
            : {}),
          ...(item.ean ? { ean: item.ean } : {}),
          confirmadoPorId: ctx.usuario.id,
        },
        update: {
          insumoId,
          fator: item.fatorConversao!,
          ...(item.codigoFornecedor
            ? { codigoFornecedor: item.codigoFornecedor }
            : {}),
          ...(item.ean ? { ean: item.ean } : {}),
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

async function avancarLeituraFiscal(
  m: Mensagem,
  notaId: string,
  c: ConferenciaFiscal,
  ctx: ContextoSessao,
  leaseDono?: string,
) {
  const nota = await db.notaFiscalWhatsapp.findUniqueOrThrow({
    where: { id: notaId },
  });
  const pendencias = pendenciasDaConferenciaFiscal(c);
  if (
    c.conferida.chave_acesso &&
    (await db.notaEntrada.count({
      where: {
        unidadeId: ctx.unidadeAtiva!.id,
        chaveAcesso: c.conferida.chave_acesso,
      },
    }))
  ) {
    await responder(
      m,
      "Esta chave fiscal já está cadastrada nesta unidade. Confira a nota existente.",
      leaseDono,
      async (tx) => {
        await tx.notaFiscalWhatsapp.update({
          where: { id: notaId },
          data: {
            estado: "DUPLICADA",
            codigo: null,
            resumoHash: null,
            expiraEm: null,
          },
        });
        await tx.conversaNotaWhatsapp.update({
          where: { id: m.conversaId },
          data: { notaAtivaId: null },
        });
        await auditar(tx, m, notaId, "ALTEROU", { etapa: "NOTA_DUPLICADA" });
      },
    );
    return;
  }
  if (pendencias.length) {
    const aguardandoXml = c.extras.some((e) =>
      ["DESATIVADA", "INDISPONIVEL", "NAO_AUTORIZADA"].includes(e.codigo),
    );
    await responder(m, mensagemConferenciaFiscal(c), leaseDono, async (tx) => {
      await tx.notaFiscalWhatsapp.update({
        where: { id: notaId },
        data: {
          estado: aguardandoXml ? "AGUARDANDO_XML" : "REVISAO",
          leitura: json(c),
          validacoes: json(pendencias),
          pergunta: json({ campo: "leituraFiscal" }),
          codigo: null,
          resumoHash: null,
          resumoEm: null,
          expiraEm: null,
        },
      });
      await tx.mensagemNotaWhatsapp.updateMany({
        where: { notaId, direcao: "SAIDA", tipo: "RESUMO", estado: "PENDENTE" },
        data: { estado: "CANCELADA" },
      });
      await auditar(tx, m, notaId, "ALTEROU", {
        etapa: "LEITURA_PENDENTE",
        codigos: pendencias.map((p) => p.codigo),
        metodo: c.metodo,
      });
    });
    return;
  }
  const unidade = await db.unidade.findUniqueOrThrow({
    where: { id: ctx.unidadeAtiva!.id },
    select: { fusoHorario: true },
  });
  const anterior = nota.rascunho as unknown as RascunhoNota | undefined;
  const origem = await db.mensagemNotaWhatsapp.findUniqueOrThrow({
    where: { id: nota.mensagemId },
    select: { recebidoEm: true },
  });
  const r = rascunhoDaLeituraFiscal(
    c,
    {
      operacaoId: notaId,
      arquivoId: nota.arquivoId!,
      recebidaEm: new Intl.DateTimeFormat("en-CA", {
        timeZone: unidade.fusoHorario,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(origem.recebidoEm),
    },
    anterior ?? undefined,
  );
  const padroes = m.conversa.padroes as {
    empresaId?: string;
    localId?: string;
    categoriaId?: string;
    fornecedor?: string;
  } | null;
  if (!anterior && padroes) {
    r.empresaId = padroes.empresaId;
    r.localId = padroes.localId;
    if (
      padroes.fornecedor ===
      normalizarDescricaoNota(r.fornecedor.documento || r.fornecedor.nome)
    )
      r.categoriaId = padroes.categoriaId;
  }
  await alterar(m.conversaId, leaseDono, (tx) =>
    tx.notaFiscalWhatsapp.update({
      where: { id: notaId },
      data: { leitura: json(c), validacoes: json([]) },
    }),
  );
  await mostrar(
    m,
    notaId,
    r,
    await catalogo(ctx),
    leaseDono,
    `Leitura fiscal conferida (${c.metodo}). Cadastros e lançamentos dependem da confirmação final.`,
  );
}

async function foto(m: Mensagem, ctx: ContextoSessao, leaseDono?: string) {
  const existente = await db.notaFiscalWhatsapp.findUnique({
    where: { mensagemId: m.id },
  });
  if (existente?.rascunho) return; // Repetição depois de salvar a leitura não chama novamente a IA.
  const leituraExistente = existente
    ? conferenciaFiscal(existente.leitura)
    : null;
  if (existente && leituraExistente) {
    await avancarLeituraFiscal(
      m,
      existente.id,
      leituraExistente,
      ctx,
      leaseDono,
    );
    return;
  }
  const ativa =
    m.conversa.notaAtivaId &&
    (await db.notaFiscalWhatsapp.findUnique({
      where: { id: m.conversa.notaAtivaId },
    }));
  if (
    ativa &&
    ativa.id !== existente?.id &&
    !["LANCADA", "CANCELADA", "FALHOU", "AGUARDANDO_XML"].includes(
      ativa.estado,
    ) &&
    !(
      ativa.estado === "REVISAO" &&
      conferenciaFiscal(ativa.leitura) &&
      pendenciasDaConferenciaFiscal(conferenciaFiscal(ativa.leitura)!).length
    )
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
      if (ativa && !["LANCADA", "CANCELADA", "FALHOU"].includes(ativa.estado)) {
        await tx.notaFiscalWhatsapp.update({
          where: { id: ativa.id },
          data: {
            estado: "SUBSTITUIDA",
            codigo: null,
            resumoHash: null,
            expiraEm: null,
          },
        });
        await tx.mensagemNotaWhatsapp.updateMany({
          where: { notaId: ativa.id, direcao: "SAIDA", estado: "PENDENTE" },
          data: { estado: "CANCELADA" },
        });
        await auditar(tx, m, ativa.id, "ALTEROU", {
          estado: "SUBSTITUIDA",
          origem: "novo-documento",
        });
      }
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
        await gravarArquivoFiscal({
          organizacaoId: ctx.organizacao.id,
          unidadeId: ctx.unidadeAtiva!.id,
          usuarioId: ctx.usuario.id,
          bytes: foto.bytes,
          tipo: foto.tipo as TipoDocumentoNota,
          variante: "original",
        })
      ).id;
      await alterar(m.conversaId, leaseDono, (tx) =>
        tx.notaFiscalWhatsapp.update({
          where: { id: nota.id },
          data: { arquivoId, imagemHash: hash, estado: "LENDO" },
        }),
      );
    }
    const derivados: { id: string; variante: string }[] = [];
    const registrar = async (e: EventoPipeline) =>
      alterar(m.conversaId, leaseDono, async (tx) => {
        await tx.notaFiscalWhatsapp.update({
          where: { id: nota.id },
          data: {
            versaoLeitor: "fiscal-2.0",
            ...(e.metodo ? { metodoLeitura: e.metodo } : {}),
            arquivosDerivados: json(derivados),
          },
        });
        await auditar(tx, m, nota.id, "ALTEROU", {
          ...e,
          versao: "fiscal-2.0",
          arquivoOriginalId: arquivoId,
        });
      });
    const resultado = await lerDocumentoFiscal(foto.bytes, {
      organizacaoId: ctx.organizacao.id,
      unidadeId: ctx.unidadeAtiva!.id,
      registrar,
      salvar: async (imagem) => {
        const a = await gravarArquivoFiscal({
          organizacaoId: ctx.organizacao.id,
          unidadeId: ctx.unidadeAtiva!.id,
          usuarioId: ctx.usuario.id,
          bytes: imagem.bytes,
          tipo: imagem.tipo as TipoDocumentoNota,
          variante: imagem.variante,
        });
        derivados.push({ id: a.id, variante: imagem.variante });
        return a.id;
      },
      gemini: (imagens, recortes) =>
        lerFiscalComGemini(
          {
            organizationId: ctx.organizacao.id,
            storeId: ctx.unidadeAtiva!.id,
            solicitacaoId: nota.id,
          },
          imagens,
          recortes,
          registrar,
        ),
    });
    const conferencia: ConferenciaFiscal = {
      versao: "fiscal-2.0",
      metodo: resultado.metodo,
      original: structuredClone(resultado.dados),
      conferida: structuredClone(resultado.dados),
      extras: resultado.extras,
      alertasConferidos: false,
    };
    await alterar(m.conversaId, leaseDono, (tx) =>
      tx.notaFiscalWhatsapp.update({
        where: { id: nota.id },
        data: {
          leitura: json(conferencia),
          metodoLeitura: resultado.metodo,
          versaoLeitor: resultado.versao,
          arquivosDerivados: json(derivados),
          validacoes: json(resultado.pendencias),
        },
      }),
    );
    await avancarLeituraFiscal(m, nota.id, conferencia, ctx, leaseDono);
  } catch (e) {
    // Erros da rede/Prisma nunca são devolvidos com payload ou credenciais.
    const mensagem =
      e instanceof LeituraNotaRecusada
        ? e.message
        : "Não consegui concluir a leitura com segurança. Confira a conexão de IA e o armazenamento na Severina ou envie o XML original.";
    await responder(
      m,
      `${mensagem}\nNenhum lançamento foi realizado no estoque ou financeiro.`,
      leaseDono,
      async (tx) => {
        await tx.notaFiscalWhatsapp.update({
          where: { id: nota.id },
          data: {
            estado: "FALHOU",
            erro: mensagem,
            validacoes: json([
              {
                codigo:
                  e instanceof LeituraNotaRecusada
                    ? e.codigo
                    : "LEITURA_INTERNA",
              },
            ]),
          },
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
    ["LANCADA", "CANCELADA", "FALHOU", "SUBSTITUIDA", "DUPLICADA"].includes(
      nota.estado,
    )
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
  const fiscal = conferenciaFiscal(nota.leitura);
  if (fiscal) {
    const resposta = responderLeituraFiscal(fiscal, texto);
    if (resposta.reconhecido) {
      if (resposta.erro) {
        await responder(m, resposta.erro, leaseDono);
        return;
      }
      await alterar(m.conversaId, leaseDono, async (tx) => {
        await tx.notaFiscalWhatsapp.update({
          where: { id: nota.id },
          data: {
            leitura: json(resposta.conferencia),
            codigo: null,
            resumoHash: null,
            resumoEm: null,
            expiraEm: null,
          },
        });
        await auditar(tx, m, nota.id, "ALTEROU", {
          etapa: "CONFERENCIA_FISCAL_HUMANA",
          camposConfirmados: resposta.conferencia.alertasConferidos,
          origem: "whatsapp",
        });
      });
      await avancarLeituraFiscal(
        m,
        nota.id,
        resposta.conferencia,
        ctx,
        leaseDono,
      );
      return;
    }
    if (pendenciasDaConferenciaFiscal(fiscal).length) {
      await avancarLeituraFiscal(m, nota.id, fiscal, ctx, leaseDono);
      return;
    }
  }
  if (!nota.rascunho) {
    await responder(m, AJUDA, leaseDono);
    return;
  }
  const r = nota.rascunho as unknown as RascunhoNota;
  if (/^(itens|detalhes)$/i.test(texto)) {
    await responder(m, resumoConferencia(r, await catalogo(ctx)), leaseDono);
    return;
  }
  if (/^(?:confirmar|ok)\b/i.test(texto)) {
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
