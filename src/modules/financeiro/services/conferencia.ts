import { Prisma } from "@prisma/client";

import { pode, type ContextoSessao } from "@/core/sessao/nucleo";
import { db } from "@/server/db";

import {
  conciliar,
  contratoSchema,
  csvSeguro,
  fontes,
  PARSER_VERSAO,
  periodoBancoSchema,
  periodoSchema,
  REGRAS_VERSAO,
  type Cobertura,
  type Configuracao,
  type Fonte,
  type Linha,
  type LinhaMotor,
  type Resultado,
} from "../schemas/conferencia";
import { canonico, hash, interpretar } from "../schemas/importacao-conferencia";

export class ErroConferencia extends Error {
  constructor(
    mensagem: string,
    public status = 400,
  ) {
    super(mensagem);
  }
}
type Escopo = { organizacaoId: string; unidadeId: string };
type Tx = Prisma.TransactionClient;
const json = (v: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(v));
const arquivoSelect = {
  id: true,
  fonte: true,
  contaRef: true,
  arquivoHash: true,
  nomeArquivo: true,
  parserVersao: true,
  configuracao: true,
  de: true,
  ate: true,
  lidas: true,
  aceitas: true,
  rejeitadas: true,
  ignoradas: true,
  estado: true,
  motivoRevisao: true,
  criadoEm: true,
  confirmadoEm: true,
} as const;

export function escopoConferencia(
  ctx: ContextoSessao,
  permissao = "financeiro.ver",
): Escopo {
  if (!pode(ctx, permissao))
    throw new ErroConferencia(
      "Seu perfil não permite esta operação no Financeiro.",
      403,
    );
  if (
    !ctx.unidadeAtiva ||
    !ctx.unidadesVisiveis.some((u) => u.id === ctx.unidadeAtiva!.id)
  )
    throw new ErroConferencia(
      "Escolha uma loja autorizada para conferir os recebimentos.",
    );
  return { organizacaoId: ctx.organizacao.id, unidadeId: ctx.unidadeAtiva.id };
}
async function trava(tx: Tx, e: Escopo) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${e.organizacaoId}), hashtext(${e.unidadeId}))`;
}
async function evento(
  tx: Tx,
  ctx: ContextoSessao,
  entidadeId: string,
  tipo: string,
  payload: unknown,
) {
  const e = escopoConferencia(ctx);
  await tx.conferenciaEvento.create({
    data: {
      ...e,
      entidadeId,
      tipo,
      payloadHash: hash(canonico(payload)),
      autorId: ctx.usuario.id,
    },
  });
  await tx.auditoria.create({
    data: {
      ...e,
      usuarioId: ctx.usuario.id,
      entidade: "ConferenciaRecebimentos",
      entidadeId,
      acao: "CRIOU",
      valoresDepois: { tipo, payloadHash: hash(canonico(payload)) },
    },
  });
}
export async function limitarConferencia(
  ctx: ContextoSessao,
  operacao: string,
) {
  const chave =
    "conf:" +
    hash(
      canonico([
        ctx.organizacao.id,
        ctx.usuario.id,
        operacao,
        Math.floor(Date.now() / 60000),
      ]),
    );
  const registro = await db.limiteAutenticacao.upsert({
    where: { chave },
    create: { chave, expiraEm: new Date(Date.now() + 120000) },
    update: { tentativas: { increment: 1 } },
  });
  if (registro.tentativas > (operacao === "preview" ? 10 : 40))
    throw new ErroConferencia(
      "Muitas solicitações. Aguarde um minuto e tente novamente.",
      429,
    );
  // Remove somente contadores expirados desta finalidade, sem tocar no login.
  await db.limiteAutenticacao.deleteMany({
    where: { chave: { startsWith: "conf:" }, expiraEm: { lt: new Date() } },
  });
}

export async function previaImportacao(
  ctx: ContextoSessao,
  bytes: Uint8Array,
  nome: string,
  config: Configuracao,
) {
  const e = escopoConferencia(ctx, "financeiro.lancar");
  const unidade = await db.unidade.findFirst({
    where: {
      organizacaoId: e.organizacaoId,
      id: e.unidadeId,
      ativa: true,
      excluidoEm: null,
    },
    select: { fusoHorario: true },
  });
  if (!unidade) throw new ErroConferencia("Loja não encontrada.", 404);
  let leitura: ReturnType<typeof interpretar>;
  try {
    leitura = interpretar(bytes, nome, config, unidade.fusoHorario);
  } catch (err) {
    throw new ErroConferencia(
      err instanceof Error ? err.message : "Não foi possível ler o arquivo.",
    );
  }
  const arquivoHash = hash(bytes);
  const salvo = await db.$transaction(
    async (tx) => {
      await trava(tx, e);
      const anterior = await tx.conferenciaImportacao.findFirst({
        where: {
          ...e,
          fonte: config.fonte,
          contaRef: config.contaRef,
          arquivoHash,
        },
        select: arquivoSelect,
      });
      if (anterior) {
        if (canonico(anterior.configuracao) !== canonico(config))
          throw new ErroConferencia(
            "Este original já tem uma leitura com outra configuração. Consulte a importação existente.",
            409,
          );
        return anterior;
      }
      const registro = await tx.conferenciaImportacao.create({
        data: {
          ...e,
          fonte: config.fonte,
          contaRef: config.contaRef,
          arquivoHash,
          nomeArquivo:
            nome.replace(/[^\p{L}\p{N} ._-]/gu, "").slice(0, 120) || "arquivo",
          original: new Uint8Array(bytes),
          parserVersao: PARSER_VERSAO,
          configuracao: json(config),
          de: config.de,
          ate: config.ate,
          lidas: leitura.lidas,
          aceitas: leitura.aceitas,
          rejeitadas: leitura.rejeitadas,
          ignoradas: leitura.ignoradas,
          enviadoPorId: ctx.usuario.id,
          motivoRevisao: leitura.avisos.join(" ") || null,
        },
        select: arquivoSelect,
      });
      await tx.conferenciaLinha.createMany({
        data: leitura.linhas.map((l) => ({
          ...e,
          importacaoId: registro.id,
          numero: l.numero,
          fonte: config.fonte,
          contaRef: config.contaRef,
          identidade: l.identidade,
          dia: l.normalizado?.businessDay ?? null,
          bruto: json(l.bruto),
          normalizado: l.normalizado ? json(l.normalizado) : Prisma.DbNull,
          erros: json(l.erros),
          hash: l.hash,
        })),
      });
      await evento(tx, ctx, registro.id, "PREVIA_IMPORTACAO", {
        arquivoHash,
        parser: PARSER_VERSAO,
        lidas: leitura.lidas,
        rejeitadas: leitura.rejeitadas,
      });
      return registro;
    },
    { timeout: 30000 },
  );
  return {
    ...salvo,
    colunas: leitura.colunas,
    avisos: leitura.avisos,
    amostra: leitura.linhas.slice(0, 8),
    erros: leitura.linhas.filter((l) => l.erros.length).slice(0, 50),
  };
}

export async function confirmarImportacao(
  ctx: ContextoSessao,
  dados: {
    previewId: string;
    expectedHash: string;
    requestKey: string;
    revisado: boolean;
    motivo: string;
    substituirConflitos: boolean;
  },
) {
  const e = escopoConferencia(ctx, "financeiro.lancar");
  if (dados.revisado && !pode(ctx, "financeiro.quitar"))
    throw new ErroConferencia(
      "Resolver conflitos de importação exige permissão de decisão financeira.",
      403,
    );
  return db.$transaction(
    async (tx) => {
      await trava(tx, e);
      const imp = await tx.conferenciaImportacao.findFirst({
        where: { ...e, id: dados.previewId },
        include: { linhas: { orderBy: { numero: "asc" } } },
      });
      if (!imp) throw new ErroConferencia("Importação não encontrada.", 404);
      if (imp.arquivoHash !== dados.expectedHash)
        throw new ErroConferencia(
          "O hash diverge da prévia. Envie o original novamente.",
          409,
        );
      if (imp.estado === "CONFIRMADA")
        return { id: imp.id, estado: imp.estado, ignoradas: imp.ignoradas };
      if (imp.rejeitadas || !imp.aceitas) {
        await tx.conferenciaImportacao.update({
          where: { id: imp.id },
          data: {
            estado: "REVISAO",
            motivoRevisao:
              "Há linhas rejeitadas. Corrija a origem e importe um novo arquivo; o original e a quarentena foram preservados.",
          },
        });
        await evento(tx, ctx, imp.id, "IMPORTACAO_EM_REVISAO", {
          rejeitadas: imp.rejeitadas,
        });
        return {
          id: imp.id,
          estado: "REVISAO",
          aviso:
            "Arquivo parcial preservado em revisão. Nenhuma linha entrou no cálculo.",
        };
      }
      const existentes = await tx.conferenciaLinha.findMany({
        where: { ...e, fonte: imp.fonte, contaRef: imp.contaRef, ativa: true },
      });
      const porIdentidade = new Map(
        existentes.filter((l) => l.identidade).map((l) => [l.identidade!, l]),
      );
      const vistos = new Map<string, string>();
      const ativar: string[] = [];
      const desativar: string[] = [];
      let ignoradas = imp.lidas - imp.aceitas;
      const motivos: string[] = [];
      for (const l of imp.linhas) {
        if (l.identidade) {
          const conteudo = canonico(l.normalizado);
          if (vistos.has(l.identidade)) {
            if (vistos.get(l.identidade) !== conteudo)
              throw new ErroConferencia(
                "O mesmo identificador possui valores diferentes dentro deste arquivo. Corrija a origem antes de confirmar.",
                409,
              );
            ignoradas++;
            continue;
          }
          vistos.set(l.identidade, conteudo);
          const antiga = porIdentidade.get(l.identidade);
          if (antiga) {
            if (canonico(antiga.normalizado) === conteudo) {
              ignoradas++;
              continue;
            }
            motivos.push(`Identificador alterado na linha ${l.numero}.`);
            desativar.push(antiga.id);
          }
        } else {
          const linha = l.normalizado as unknown as Linha;
          if (
            existentes.some((a) => {
              const outra = a.normalizado as unknown as Linha;
              return (
                a.dia === l.dia &&
                outra.provider === linha.provider &&
                outra.merchantRef === linha.merchantRef
              );
            })
          )
            motivos.push(
              `Sobreposição sem identificador estável na linha ${l.numero}. Confirme que são ocorrências distintas.`,
            );
        }
        ativar.push(l.id);
      }
      if (imp.motivoRevisao) motivos.push(imp.motivoRevisao);
      if (
        motivos.length &&
        (!dados.revisado ||
          dados.motivo.trim().length < 10 ||
          (desativar.length > 0 && !dados.substituirConflitos))
      ) {
        const aviso = [...new Set(motivos)].slice(0, 20).join(" ");
        await tx.conferenciaImportacao.update({
          where: { id: imp.id },
          data: { estado: "REVISAO", motivoRevisao: aviso },
        });
        await evento(tx, ctx, imp.id, "CONFLITO_IMPORTACAO", {
          motivos: aviso,
          requestKey: dados.requestKey,
        });
        return { id: imp.id, estado: "REVISAO", aviso };
      }
      if (desativar.length)
        await tx.conferenciaLinha.updateMany({
          where: { ...e, id: { in: desativar } },
          data: { ativa: false },
        });
      await tx.conferenciaLinha.updateMany({
        where: { ...e, id: { in: ativar } },
        data: { ativa: true },
      });
      await tx.conferenciaImportacao.update({
        where: { id: imp.id },
        data: {
          estado: "CONFIRMADA",
          ignoradas,
          confirmadoEm: new Date(),
          chaveConfirmacao: dados.requestKey,
          motivoRevisao: motivos.length ? dados.motivo : null,
        },
      });
      await evento(tx, ctx, imp.id, "IMPORTACAO_CONFIRMADA", {
        hash: imp.arquivoHash,
        ativadas: ativar.length,
        ignoradas,
        substituidas: desativar,
        motivo: dados.motivo,
        requestKey: dados.requestKey,
      });
      return { id: imp.id, estado: "CONFIRMADA", ignoradas };
    },
    { timeout: 30000 },
  );
}

export async function listarImportacoes(
  ctx: ContextoSessao,
  de: string,
  ate: string,
) {
  const e = escopoConferencia(ctx);
  periodoSchema.parse({ de, ate });
  return buscarImportacoes(e, de, ate);
}

async function buscarImportacoes(e: Escopo, de: string, ate: string) {
  return db.conferenciaImportacao.findMany({
    where: { ...e, de: { lte: ate }, ate: { gte: de } },
    select: arquivoSelect,
    orderBy: { criadoEm: "desc" },
    take: 200,
  });
}

export async function descartarImportacao(
  ctx: ContextoSessao,
  id: string,
  motivo: string,
) {
  const e = escopoConferencia(ctx, "financeiro.quitar");
  return db.$transaction(async (tx) => {
    await trava(tx, e);
    const imp = await tx.conferenciaImportacao.findFirst({
      where: { ...e, id, estado: { in: ["PREVIA", "REVISAO"] } },
    });
    if (!imp)
      throw new ErroConferencia(
        "Lote não encontrado ou já confirmado. Somente leituras pendentes podem ser descartadas.",
        409,
      );
    await tx.conferenciaImportacao.update({
      where: { id },
      data: { estado: "DESCARTADA", motivoRevisao: motivo },
    });
    await evento(tx, ctx, id, "LEITURA_DESCARTADA", { motivo });
    return { id, estado: "DESCARTADA" };
  });
}
export async function detalheImportacao(
  ctx: ContextoSessao,
  id: string,
  pagina: number,
  linhaSelecionada?: number,
) {
  const e = escopoConferencia(ctx);
  const imp = await db.conferenciaImportacao.findFirst({
    where: { ...e, id },
    select: arquivoSelect,
  });
  if (!imp) throw new ErroConferencia("Importação não encontrada.", 404);
  if (linhaSelecionada)
    pagina =
      Math.floor(
        (await db.conferenciaLinha.count({
          where: { ...e, importacaoId: id, numero: { lt: linhaSelecionada } },
        })) / 50,
      ) + 1;
  const linhas = await db.conferenciaLinha.findMany({
    where: { ...e, importacaoId: id },
    select: {
      id: true,
      numero: true,
      bruto: true,
      normalizado: true,
      erros: true,
      ativa: true,
      hash: true,
    },
    orderBy: { numero: "asc" },
    skip: (pagina - 1) * 50,
    take: 50,
  });
  return { ...imp, linhas, pagina, linhaSelecionada: linhaSelecionada ?? null };
}
export async function originalImportacao(ctx: ContextoSessao, id: string) {
  const e = escopoConferencia(ctx);
  const imp = await db.conferenciaImportacao.findFirst({
    where: { ...e, id },
    select: { original: true, nomeArquivo: true, arquivoHash: true },
  });
  if (!imp) throw new ErroConferencia("Arquivo não encontrado.", 404);
  return imp;
}

function cobrir(
  importacoes: {
    id: string;
    fonte: string;
    contaRef: string;
    de: string;
    ate: string;
    estado: string;
  }[],
  fonte: Fonte,
  de: string,
  ate: string,
) {
  const origens = importacoes.filter(
    (i) => i.fonte === fonte && i.estado !== "DESCARTADA",
  );
  const contas = [...new Set(origens.map((i) => i.contaRef))];
  const completa =
    contas.length > 0 &&
    contas.every((conta) => {
      let proximo = de;
      const daConta = origens
        .filter((i) => i.contaRef === conta && i.estado === "CONFIRMADA")
        .sort((a, b) => a.de.localeCompare(b.de));
      for (const i of daConta) {
        if (i.de > proximo) break;
        if (i.ate >= proximo)
          proximo = new Date(Date.parse(i.ate) + 86400000)
            .toISOString()
            .slice(0, 10);
      }
      return proximo > ate;
    }) &&
    !origens.some((i) => i.estado === "REVISAO");
  return { completa, de, ate, importacoes: origens.map((i) => i.id) };
}

export async function executarConferencia(
  ctx: ContextoSessao,
  dados: {
    de: string;
    ate: string;
    requestKey: string;
    sourceVersions?: string[];
  },
) {
  const e = escopoConferencia(ctx, "financeiro.lancar");
  periodoSchema.parse(dados);
  return db.$transaction(
    async (tx) => {
      await trava(tx, e);
      const anterior = await tx.conferenciaExecucao.findFirst({
        where: { ...e, chavePedido: dados.requestKey },
        select: { id: true },
      });
      if (anterior) return anterior;
      const importacoes = await tx.conferenciaImportacao.findMany({
        where: { ...e, de: { lte: dados.ate }, ate: { gte: dados.de } },
        select: {
          id: true,
          fonte: true,
          contaRef: true,
          de: true,
          ate: true,
          estado: true,
          arquivoHash: true,
          parserVersao: true,
        },
      });
      const fontesVenda = await tx.conferenciaLinha.findMany({
        where: {
          ...e,
          ativa: true,
          fonte: { in: ["VENDA", "ADQUIRENTE"] },
          dia: { gte: dados.de, lte: dados.ate },
        },
        take: 20001,
      });
      if (fontesVenda.length > 20000)
        throw new ErroConferencia(
          "Reduza o período para até 20.000 linhas por conferência.",
        );
      const datasBanco = fontesVenda
        .filter((l) => l.fonte === "ADQUIRENTE")
        .map((l) => (l.normalizado as unknown as Linha).expectedSettlementDay)
        .filter((d): d is string => !!d);
      const deBanco = [dados.de, ...datasBanco].sort()[0];
      const ateBanco = [dados.ate, ...datasBanco].sort().at(-1)!;
      if (!periodoBancoSchema.safeParse({ de: deBanco, ate: ateBanco }).success)
        throw new ErroConferencia(
          "As liquidações ultrapassam dois anos. Revise o arquivo.",
        );
      const importacoesBanco = await tx.conferenciaImportacao.findMany({
        where: {
          ...e,
          fonte: "BANCO",
          de: { lte: ateBanco },
          ate: { gte: deBanco },
        },
        select: {
          id: true,
          fonte: true,
          contaRef: true,
          de: true,
          ate: true,
          estado: true,
          arquivoHash: true,
          parserVersao: true,
        },
      });
      const linhasBanco = await tx.conferenciaLinha.findMany({
        where: {
          ...e,
          ativa: true,
          fonte: "BANCO",
          dia: { gte: deBanco, lte: ateBanco },
        },
        take: 20001,
      });
      if (linhasBanco.length > 20000)
        throw new ErroConferencia(
          "Reduza o período do extrato para até 20.000 linhas.",
        );
      const contratos = await tx.conferenciaContrato.findMany({
        where: {
          ...e,
          ativa: true,
          de: { lte: dados.ate },
          OR: [{ ate: null }, { ate: { gte: dados.de } }],
        },
      });
      const referenciasLote = [
        ...new Set(
          fontesVenda
            .filter((l) => l.fonte === "ADQUIRENTE")
            .map((l) => (l.normalizado as unknown as Linha).payoutRef)
            .filter((r): r is string => !!r),
        ),
      ];
      const componentesLote = referenciasLote.length
        ? await tx.conferenciaLinha.findMany({
            where: {
              ...e,
              ativa: true,
              fonte: "ADQUIRENTE",
              OR: referenciasLote.map((ref) => ({
                normalizado: { path: ["payoutRef"], equals: ref },
              })),
            },
            take: 20001,
          })
        : [];
      if (componentesLote.length > 20000)
        throw new ErroConferencia(
          "Os lotes ultrapassam 20.000 componentes. Reduza o período.",
        );
      const importacoesComponentes = await tx.conferenciaImportacao.findMany({
        where: {
          ...e,
          id: { in: [...new Set(componentesLote.map((l) => l.importacaoId))] },
        },
        select: {
          id: true,
          fonte: true,
          contaRef: true,
          de: true,
          ate: true,
          estado: true,
          arquivoHash: true,
          parserVersao: true,
        },
      });
      const todasImportacoes = [
        ...new Map(
          [...importacoes, ...importacoesBanco, ...importacoesComponentes].map(
            (i) => [i.id, i],
          ),
        ).values(),
      ];
      const idsVersao = todasImportacoes
        .filter((i) => i.estado === "CONFIRMADA")
        .map((i) => i.id)
        .sort();
      if (
        dados.sourceVersions &&
        canonico([...dados.sourceVersions].sort()) !== canonico(idsVersao)
      )
        throw new ErroConferencia(
          "As fontes mudaram. Atualize a página antes de conferir.",
          409,
        );
      const cobertura = Object.fromEntries(
        fontes.map((f) => [
          f,
          cobrir(
            todasImportacoes,
            f,
            f === "BANCO" ? deBanco : dados.de,
            f === "BANCO" ? ateBanco : dados.ate,
          ),
        ]),
      ) as Cobertura;
      // Cada conta citada precisa existir nas três fontes; arquivos de outra conta não fecham a lacuna.
      const contas = new Set(fontesVenda.map((l) => l.contaRef));
      for (const f of fontes)
        if (
          [...contas].some(
            (c) =>
              !todasImportacoes.some(
                (i) =>
                  i.fonte === f &&
                  i.contaRef === c &&
                  i.estado === "CONFIRMADA",
              ),
          )
        )
          cobertura[f].completa = false;
      const linhas: LinhaMotor[] = [...fontesVenda, ...linhasBanco].map(
        (l) => ({
          ...(l.normalizado as unknown as Linha),
          ...e,
          id: l.id,
          fonte: l.fonte as Fonte,
        }),
      );
      const resultado = conciliar({
        ...e,
        linhas,
        contratos,
        cobertura,
        componentesLote: componentesLote.map((l) => ({
          ...(l.normalizado as unknown as Linha),
          ...e,
          id: l.id,
          fonte: "ADQUIRENTE" as const,
        })),
      });
      const versoes = todasImportacoes
        .filter((i) => i.estado === "CONFIRMADA")
        .map((i) => ({
          id: i.id,
          hash: i.arquivoHash,
          parser: i.parserVersao,
        }));
      const execucao = await tx.conferenciaExecucao.create({
        data: {
          ...e,
          chavePedido: dados.requestKey,
          de: dados.de,
          ate: dados.ate,
          periodoEfetivo: {
            vendas: { de: dados.de, ate: dados.ate },
            banco: { de: deBanco, ate: ateBanco },
          },
          fontesVersao: json({
            importacoes: versoes,
            contratos: contratos.map((c) => ({ id: c.id, versao: c.versao })),
          }),
          regrasVersao: REGRAS_VERSAO,
          cobertura: json(cobertura),
          totais: json(resultado.totais),
          criadoPorId: ctx.usuario.id,
        },
      });
      for (const r of resultado.resultados) {
        const caso = await tx.conferenciaCaso.upsert({
          where: { organizacaoId_unidadeId_chave: { ...e, chave: r.chave } },
          create: { ...e, chave: r.chave },
          update: {},
        });
        // Hash somente de evidências relevantes: um arquivo sem relação não invalida a decisão.
        const relevantes = [
          r.vendaId,
          ...r.adquirenteIds,
          ...r.bancoIds,
          ...r.candidatos,
        ].filter(Boolean);
        const snapshotHash = hash(
          canonico({
            r,
            linhas: linhas.filter((l) => relevantes.includes(l.id)),
            contratos: contratos.filter((c) => r.contratoIds.includes(c.id)),
            cobertura: Object.fromEntries(
              Object.entries(cobertura).map(([f, c]) => [
                f,
                { completa: c.completa, de: c.de, ate: c.ate },
              ]),
            ),
            regras: REGRAS_VERSAO,
          }),
        );
        const ultimaDecisao = await tx.conferenciaDecisao.findFirst({
          where: { ...e, casoId: caso.id, decisao: { not: "COMENTARIO" } },
          orderBy: { versao: "desc" },
        });
        const novoEstado =
          ultimaDecisao && ultimaDecisao.snapshotHash !== snapshotHash
            ? "REVIEW_REQUIRED"
            : r.estado;
        await tx.conferenciaCorrespondencia.create({
          data: {
            ...e,
            execucaoId: execucao.id,
            casoId: caso.id,
            estado: novoEstado,
            categoria: r.categoria,
            snapshotHash,
            dados: json({
              ...r,
              estado: novoEstado,
              estadoCalculado: r.estado,
            }),
          },
        });
      }
      for (const l of resultado.lotes) {
        const lote = await tx.conferenciaLote.create({
          data: {
            ...e,
            execucaoId: execucao.id,
            chave: l.chave,
            liquidoCentavos: l.liquidoCentavos,
            componentes: json(l.componentes),
          },
        });
        if (l.estado === "RECONCILED" && l.bancoId)
          await tx.conferenciaAlocacao.create({
            data: {
              ...e,
              loteId: lote.id,
              bancoId: l.bancoId,
              centavos: l.liquidoCentavos,
            },
          });
      }
      await evento(tx, ctx, execucao.id, "CONFERENCIA_EXECUTADA", {
        versoes,
        regras: REGRAS_VERSAO,
        quantidade: resultado.resultados.length,
      });
      return { id: execucao.id };
    },
    { timeout: 60000, maxWait: 10000 },
  );
}

export async function consultarConferencia(
  ctx: ContextoSessao,
  dados: {
    de: string;
    ate: string;
    estado?: string;
    categoria?: string;
    pagina?: number;
    execucaoId?: string;
  },
) {
  const e = escopoConferencia(ctx);
  periodoSchema.parse(dados);
  const execucao = await db.conferenciaExecucao.findFirst({
    where: {
      ...e,
      de: dados.de,
      ate: dados.ate,
      ...(dados.execucaoId ? { id: dados.execucaoId } : {}),
    },
    orderBy: { criadoEm: "desc" },
  });
  const efetivo = execucao?.periodoEfetivo as
    { banco: { de: string; ate: string } } | undefined;
  const periodoBanco = periodoBancoSchema.parse(efetivo?.banco ?? dados);
  const [importacoes, contratos, historico] = await Promise.all([
    buscarImportacoes(e, periodoBanco.de, periodoBanco.ate),
    db.conferenciaContrato.findMany({
      where: e,
      orderBy: { criadoEm: "desc" },
      take: 200,
    }),
    db.conferenciaExecucao.findMany({
      where: { ...e, de: dados.de, ate: dados.ate },
      select: { id: true, criadoEm: true, regrasVersao: true },
      orderBy: { criadoEm: "desc" },
      take: 20,
    }),
  ]);
  if (!execucao)
    return {
      execucao: null,
      importacoes,
      contratos,
      historico,
      resultados: [],
      total: 0,
      pagina: dados.pagina ?? 1,
      resumo: [],
    };
  const where = {
    ...e,
    execucaoId: execucao.id,
    ...(dados.estado ? { estado: dados.estado } : {}),
    ...(dados.categoria ? { categoria: dados.categoria } : {}),
  };
  const [total, correspondencias, resumo] = await db.$transaction([
    db.conferenciaCorrespondencia.count({ where }),
    db.conferenciaCorrespondencia.findMany({
      where,
      include: {
        caso: {
          include: {
            decisoes: {
              where: { decisao: { not: "COMENTARIO" } },
              orderBy: { versao: "desc" },
              take: 1,
            },
          },
        },
      },
      orderBy: { id: "asc" },
      skip: ((dados.pagina ?? 1) - 1) * 50,
      take: 50,
    }),
    db.conferenciaCorrespondencia.groupBy({
      by: ["estado", "categoria"],
      orderBy: [{ estado: "asc" }, { categoria: "asc" }],
      where: { ...e, execucaoId: execucao.id },
      _count: true,
    }),
  ]);
  const fontesAtuais = importacoes
    .filter((i) => i.estado === "CONFIRMADA")
    .map((i) => i.id);
  const fontesUsadas = (
    execucao.fontesVersao as { importacoes: { id: string }[] }
  ).importacoes.map((i) => i.id);
  return {
    execucao,
    importacoes,
    contratos,
    historico,
    total,
    pagina: dados.pagina ?? 1,
    resumo,
    desatualizada:
      fontesAtuais.some((id) => !fontesUsadas.includes(id)) ||
      contratos.some((c) => c.criadoEm > execucao.criadoEm) ||
      importacoes.some(
        (i) => i.estado === "REVISAO" && i.criadoEm > execucao.criadoEm,
      ),
    resultados: correspondencias.map((r) => ({
      id: r.id,
      casoId: r.casoId,
      versao: r.caso.versao,
      ...(r.dados as unknown as Resultado),
      decisao: r.caso.decisoes[0] ?? null,
      revisaoAdicional:
        !!r.caso.decisoes[0] &&
        r.caso.decisoes[0].snapshotHash !== r.snapshotHash,
    })),
  };
}

export async function detalharCorrespondencia(ctx: ContextoSessao, id: string) {
  const e = escopoConferencia(ctx);
  const r = await db.conferenciaCorrespondencia.findFirst({
    where: { ...e, id },
    include: {
      caso: {
        include: {
          decisoes: { orderBy: { versao: "desc" } },
          evidencias: {
            select: {
              id: true,
              nome: true,
              tipo: true,
              hash: true,
              autorId: true,
              criadoEm: true,
            },
          },
        },
      },
      execucao: {
        select: {
          id: true,
          de: true,
          ate: true,
          regrasVersao: true,
          cobertura: true,
          criadoEm: true,
        },
      },
    },
  });
  if (!r) throw new ErroConferencia("Conferência não encontrada.", 404);
  const resultado = r.dados as unknown as Resultado;
  const ids = [
    resultado.vendaId,
    ...resultado.adquirenteIds,
    ...resultado.bancoIds,
    ...resultado.candidatos,
  ].filter((id): id is string => !!id);
  const [linhas, contratos, eventos] = await Promise.all([
    db.conferenciaLinha.findMany({
      where: { ...e, id: { in: ids } },
      select: {
        id: true,
        importacaoId: true,
        numero: true,
        fonte: true,
        bruto: true,
        normalizado: true,
        hash: true,
        importacao: {
          select: {
            id: true,
            nomeArquivo: true,
            arquivoHash: true,
            parserVersao: true,
            estado: true,
          },
        },
      },
    }),
    db.conferenciaContrato.findMany({
      where: { ...e, id: { in: resultado.contratoIds } },
    }),
    db.conferenciaEvento.findMany({
      where: { ...e, entidadeId: r.casoId },
      orderBy: { criadoEm: "asc" },
    }),
  ]);
  const lotes = await db.conferenciaLote.findMany({
    where: { ...e, execucaoId: r.execucaoId },
    include: { alocacoes: true },
  });
  const lotesRelacionados = lotes.filter((l) =>
    (l.componentes as string[]).some((id) =>
      resultado.adquirenteIds.includes(id),
    ),
  );
  const componentesLote = await db.conferenciaLinha.findMany({
    where: {
      ...e,
      id: {
        in: [
          ...new Set(
            lotesRelacionados.flatMap((l) => l.componentes as string[]),
          ),
        ],
      },
    },
    select: {
      id: true,
      importacaoId: true,
      numero: true,
      normalizado: true,
      importacao: { select: { nomeArquivo: true, arquivoHash: true } },
    },
  });
  const decisaoEfetiva = r.caso.decisoes.find(
    (d) => d.decisao !== "COMENTARIO",
  );
  return {
    id: r.id,
    casoId: r.casoId,
    versao: r.caso.versao,
    resultado,
    linhas,
    contratos,
    decisoes: r.caso.decisoes,
    evidencias: r.caso.evidencias,
    eventos,
    execucao: r.execucao,
    lotes: lotesRelacionados,
    componentesLote,
    revisaoAdicional:
      !!decisaoEfetiva && decisaoEfetiva.snapshotHash !== r.snapshotHash,
  };
}

export async function registrarDecisao(
  ctx: ContextoSessao,
  id: string,
  dados: {
    expectedVersion: number;
    decisao: string;
    motivo: string;
    evidenciaIds: string[];
  },
) {
  const e = escopoConferencia(ctx, "financeiro.quitar");
  return db.$transaction(async (tx) => {
    await trava(tx, e);
    const r = await tx.conferenciaCorrespondencia.findFirst({
      where: { ...e, id },
      include: {
        caso: {
          include: { decisoes: { orderBy: { versao: "desc" }, take: 1 } },
        },
      },
    });
    if (!r) throw new ErroConferencia("Conferência não encontrada.", 404);
    const unicos = [...new Set(dados.evidenciaIds)];
    if (
      (await tx.conferenciaEvidencia.count({
        where: { ...e, casoId: r.casoId, id: { in: unicos } },
      })) !== unicos.length
    )
      throw new ErroConferencia("Evidência não encontrada neste caso.", 404);
    const atualizado = await tx.conferenciaCaso.updateMany({
      where: { ...e, id: r.casoId, versao: dados.expectedVersion },
      data: { versao: { increment: 1 } },
    });
    if (atualizado.count !== 1)
      throw new ErroConferencia(
        "Outra pessoa registrou uma decisão. Atualize o detalhe antes de continuar.",
        409,
      );
    const decisao = await tx.conferenciaDecisao.create({
      data: {
        ...e,
        casoId: r.casoId,
        versao: dados.expectedVersion + 1,
        decisao: dados.decisao,
        motivo: dados.motivo,
        evidenciaIds: json(unicos),
        snapshotHash: r.snapshotHash,
        anteriorId: r.caso.decisoes[0]?.id,
        autorId: ctx.usuario.id,
      },
    });
    await evento(tx, ctx, r.casoId, "DECISAO_REGISTRADA", {
      id: decisao.id,
      versao: decisao.versao,
      decisao: dados.decisao,
      motivo: dados.motivo,
      evidencias: unicos,
    });
    return { id: decisao.id, versao: decisao.versao };
  });
}

export async function anexarEvidencia(
  ctx: ContextoSessao,
  id: string,
  nome: string,
  bytes: Uint8Array,
  tipo: string,
) {
  const e = escopoConferencia(ctx, "financeiro.quitar");
  return db.$transaction(async (tx) => {
    const r = await tx.conferenciaCorrespondencia.findFirst({
      where: { ...e, id },
    });
    if (!r) throw new ErroConferencia("Conferência não encontrada.", 404);
    const evidencia = await tx.conferenciaEvidencia.create({
      data: {
        ...e,
        casoId: r.casoId,
        nome:
          nome.replace(/[^\p{L}\p{N} ._-]/gu, "").slice(0, 120) || "evidencia",
        tipo,
        bytes: new Uint8Array(bytes),
        hash: hash(bytes),
        autorId: ctx.usuario.id,
      },
    });
    await evento(tx, ctx, r.casoId, "EVIDENCIA_ANEXADA", {
      id: evidencia.id,
      hash: evidencia.hash,
    });
    return { id: evidencia.id };
  });
}
export async function lerEvidencia(ctx: ContextoSessao, id: string) {
  const e = escopoConferencia(ctx);
  const r = await db.conferenciaEvidencia.findFirst({ where: { ...e, id } });
  if (!r) throw new ErroConferencia("Evidência não encontrada.", 404);
  return r;
}
export async function criarContrato(ctx: ContextoSessao, entrada: unknown) {
  const e = escopoConferencia(ctx, "financeiro.lancar");
  const dados = contratoSchema.parse(entrada);
  return db.$transaction(async (tx) => {
    await trava(tx, e);
    const anterior = dados.substituiId
      ? await tx.conferenciaContrato.findFirst({
          where: { ...e, id: dados.substituiId, ativa: true },
        })
      : null;
    if (dados.substituiId && !anterior)
      throw new ErroConferencia(
        "A versão do contrato mudou. Atualize a lista.",
        409,
      );
    const conflito = await tx.conferenciaContrato.findFirst({
      where: {
        ...e,
        ativa: true,
        ...(anterior ? { id: { not: anterior.id } } : {}),
        provedor: dados.provedor,
        estabelecimento: dados.estabelecimento,
        bandeira: dados.bandeira,
        metodo: dados.metodo,
        parcelasDe: { lte: dados.parcelasAte },
        parcelasAte: { gte: dados.parcelasDe },
        de: { lte: dados.ate ?? "9999-12-31" },
        OR: [{ ate: null }, { ate: { gte: dados.de } }],
      },
    });
    if (conflito)
      throw new ErroConferencia(
        "Já existe contrato com vigência e parcelas sobrepostas. Use uma vigência sem sobreposição.",
        409,
      );
    if (anterior)
      await tx.conferenciaContrato.update({
        where: { id: anterior.id },
        data: { ativa: false },
      });
    const contrato = await tx.conferenciaContrato.create({
      data: {
        ...e,
        ...dados,
        versao: (anterior?.versao ?? 0) + 1,
        criadoPorId: ctx.usuario.id,
      },
    });
    await evento(tx, ctx, contrato.id, "CONTRATO_CADASTRADO", dados);
    return contrato;
  });
}

export async function exportarConferencia(
  ctx: ContextoSessao,
  filtro: {
    de: string;
    ate: string;
    estado?: string;
    categoria?: string;
    execucaoId?: string;
  },
) {
  const e = escopoConferencia(ctx);
  periodoSchema.parse(filtro);
  return db.$transaction(
    async (tx) => {
      const execucao = await tx.conferenciaExecucao.findFirst({
        where: {
          ...e,
          de: filtro.de,
          ate: filtro.ate,
          ...(filtro.execucaoId ? { id: filtro.execucaoId } : {}),
        },
        orderBy: { criadoEm: "desc" },
      });
      if (!execucao)
        throw new ErroConferencia(
          "Execute a conferência antes de exportar.",
          404,
        );
      const linhas = await tx.conferenciaCorrespondencia.findMany({
        where: {
          ...e,
          execucaoId: execucao.id,
          ...(filtro.estado ? { estado: filtro.estado } : {}),
          ...(filtro.categoria ? { categoria: filtro.categoria } : {}),
        },
        include: {
          caso: {
            include: {
              decisoes: {
                where: { decisao: { not: "COMENTARIO" } },
                orderBy: { versao: "desc" },
                take: 1,
              },
            },
          },
        },
        orderBy: { id: "asc" },
        take: 40001,
      });
      if (linhas.length > 40000)
        throw new ErroConferencia(
          "Reduza o período para exportar até 40.000 ocorrências.",
        );
      const idsFonte = [
        ...new Set(
          linhas.flatMap((l) => {
            const r = l.dados as unknown as Resultado;
            return [
              r.vendaId,
              ...r.adquirenteIds,
              ...r.bancoIds,
              ...r.candidatos,
            ].filter((id): id is string => !!id);
          }),
        ),
      ];
      const fontesExportadas = await tx.conferenciaLinha.findMany({
        where: { ...e, id: { in: idsFonte } },
        select: {
          id: true,
          numero: true,
          importacaoId: true,
          importacao: { select: { nomeArquivo: true, arquivoHash: true } },
        },
      });
      const referencias = new Map(
        fontesExportadas.map((l) => [
          l.id,
          `${l.importacao.nomeArquivo} | import ${l.importacaoId} | linha ${l.numero} | SHA256 ${l.importacao.arquivoHash}`,
        ]),
      );
      const totais = execucao.totais as Record<string, unknown>;
      const csv: unknown[][] = [
        [
          "Relatório de conferência em observação",
          "Valores em centavos. As quatro etapas não são receitas diferentes.",
        ],
        [
          "Loja",
          ctx.unidadeAtiva!.nome,
          "Execução",
          execucao.id,
          "Regras",
          execucao.regrasVersao,
        ],
        [
          "Período solicitado",
          filtro.de,
          filtro.ate,
          "Período efetivo",
          JSON.stringify(execucao.periodoEfetivo),
        ],
        ["Cobertura", JSON.stringify(execucao.cobertura)],
        [
          "Vendido bruto",
          totais.vendidoCentavos,
          "Líquido previsto",
          totais.previstoCentavos ?? "DESCONHECIDO",
          "Liquidado adquirente",
          totais.liquidadoCentavos,
          "Creditado banco",
          totais.creditadoCentavos,
        ],
        [
          "Correspondência",
          "Categoria",
          "Estado calculado",
          "Venda",
          "Bruto centavos",
          "Previsto centavos",
          "Liquidado centavos",
          "Crédito alocado centavos",
          "Diferença taxa centavos",
          "Decisão humana",
          "Motivo",
          "Versão",
          "Revisão adicional",
          "Arquivos e linhas",
          "Observação",
        ],
      ];
      for (const l of linhas) {
        const r = l.dados as unknown as Resultado;
        const d = l.caso.decisoes.find((d) => d.decisao !== "COMENTARIO");
        csv.push([
          l.id,
          r.categoria,
          r.estadoCalculado ?? r.estado,
          r.vendaId,
          r.brutoCentavos,
          r.previstoCentavos ?? "DESCONHECIDO",
          r.liquidadoCentavos,
          r.creditoAlocadoCentavos,
          r.diferencaTaxaCentavos ?? "DESCONHECIDO",
          d?.decisao,
          d?.motivo,
          d?.versao,
          d && d.snapshotHash !== l.snapshotHash ? "SIM" : "NAO",
          [r.vendaId, ...r.adquirenteIds, ...r.bancoIds]
            .filter(Boolean)
            .map((id) => referencias.get(id!))
            .join(" / "),
          r.notas.join(" "),
        ]);
      }
      await evento(tx, ctx, execucao.id, "EXPORTACAO", {
        filtro,
        quantidade: linhas.length,
      });
      return "\uFEFF" + csv.map((l) => l.map(csvSeguro).join(";")).join("\r\n");
    },
    { timeout: 30000, isolationLevel: "RepeatableRead" },
  );
}
