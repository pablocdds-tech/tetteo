import { db } from "@/server/db";
import {
  privateVirtualModelConfiguration,
  MODEL_TEST_VALID_MS,
} from "@/server/ia/modelo-atendimento-config";
import type { VirtualModelCredentials } from "@/server/ia/atendimento";
import {
  gerarExtracaoGemini,
  prepararExtracaoGemini,
  MAX_SAIDA_FISCAL,
} from "./gemini";
import {
  validarExtracaoFiscal,
  type ExtracaoFiscal,
  type PendenciaFiscal,
} from "./extracao";
import { LeituraNotaRecusada } from "./documento";
import type { ImagemNota } from "./imagem";
export type EscopoLeitura = {
  organizationId: string;
  storeId: string;
  solicitacaoId: string;
};
export type RegistroLeitura = (evento: {
  etapa: string;
  codigos?: string[];
  tentativa?: number;
  modelo?: string;
  tokens?: number;
}) => Promise<void>;
async function reservar(
  s: EscopoLeitura,
  c: VirtualModelCredentials,
  entradaTokens: number,
  tentativa: number,
) {
  const limite = Math.ceil(
    (entradaTokens * c.inputRate + MAX_SAIDA_FISCAL * c.outputRate) / 1_000_000,
  );
  if (!Number.isSafeInteger(limite) || limite < 0 || limite > 2_147_483_647)
    throw new Error("Limite de custo inválido.");
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`av:model:${s.organizationId}:${s.storeId}`},0))`;
    const atual = await tx.avModelConfiguration.findUnique({
      where: {
        organizationId_storeId: {
          organizationId: s.organizationId,
          storeId: s.storeId,
        },
      },
    });
    if (
      c.source === "DATABASE"
        ? !atual ||
          !atual.enabled ||
          atual.revision !== c.revision ||
          !atual.ratesConfirmed ||
          atual.testState !== "PASSED" ||
          atual.testedRevision !== atual.revision ||
          !atual.testedAt ||
          atual.testedAt.getTime() <= Date.now() - MODEL_TEST_VALID_MS
        : !!atual
    )
      throw new LeituraNotaRecusada(
        "IA_CONFIGURACAO",
        "A configuração da IA mudou. Confira a Severina antes de continuar.",
      );
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`virtual-budget:${s.organizationId}:${s.storeId}`},0))`;
    const nota = await tx.notaFiscalWhatsapp.findFirst({
      where: {
        id: s.solicitacaoId,
        organizacaoId: s.organizationId,
        unidadeId: s.storeId,
      },
      select: {
        id: true,
        tentativasLeitura: true,
        leituraTentadaEm: true,
        custoMicros: true,
        criadoEm: true,
      },
    });
    if (
      !nota ||
      nota.tentativasLeitura !== tentativa - 1 ||
      (tentativa === 1 && nota.leituraTentadaEm) ||
      tentativa > 2 ||
      nota.criadoEm.getTime() < Date.now() - 86_400_000
    )
      throw new LeituraNotaRecusada(
        "LEITURA_JA_TENTADA",
        "Esta leitura já foi tentada ou expirou. Confira a nota antes de reenviar.",
      );
    const escopo = { organizationId: s.organizationId, storeId: s.storeId },
      desde = new Date(Date.now() - 86_400_000);
    const [contas, runs, provas, notas] = await Promise.all([
      tx.avChannelAccount.findMany({
        where: escopo,
        select: {
          maxTurnCostMicros: true,
          dailyBudgetMicros: true,
          circuitUntil: true,
        },
      }),
      tx.avAgentRun.aggregate({
        where: { ...escopo, createdAt: { gte: desde } },
        _sum: { costMicros: true },
      }),
      tx.avModelProbe.aggregate({
        where: { ...escopo, createdAt: { gte: desde } },
        _sum: { costMicros: true },
      }),
      tx.notaFiscalWhatsapp.aggregate({
        where: {
          organizacaoId: s.organizationId,
          unidadeId: s.storeId,
          criadoEm: { gte: desde },
        },
        _sum: { custoMicros: true },
      }),
    ]);
    const porNota = contas.length
        ? Math.min(...contas.map((c) => c.maxTurnCostMicros))
        : 100_000,
      porDia = contas.length
        ? Math.min(...contas.map((c) => c.dailyBudgetMicros))
        : 5_000_000;
    if (
      nota.custoMicros + limite > porNota ||
      (runs._sum.costMicros ?? 0) +
        (provas._sum.costMicros ?? 0) +
        (notas._sum.custoMicros ?? 0) +
        limite >
        porDia ||
      contas.some((c) => c.circuitUntil && c.circuitUntil > new Date())
    )
      throw new LeituraNotaRecusada(
        "IA_ORCAMENTO",
        "O limite de leitura da unidade foi atingido. Aguarde ou envie o XML.",
      );
    const r = await tx.notaFiscalWhatsapp.updateMany({
      where: {
        id: nota.id,
        tentativasLeitura: tentativa - 1,
        ...(tentativa === 1 ? { leituraTentadaEm: null } : {}),
      },
      data: {
        tentativasLeitura: tentativa,
        custoMicros: nota.custoMicros + limite,
        leituraTentadaEm: nota.leituraTentadaEm ?? new Date(),
      },
    });
    if (!r.count)
      throw new LeituraNotaRecusada(
        "LEITURA_JA_TENTADA",
        "A leitura já está sendo processada.",
      );
    return { limite, anterior: nota.custoMicros };
  });
}
export function divergenciasDeLeitura(
  a: ExtracaoFiscal,
  b: ExtracaoFiscal,
): PendenciaFiscal[] {
  const p: PendenciaFiscal[] = [];
  const comparar = (campo: string, x: unknown, y: unknown) => {
    if (x !== null && y !== null && x !== y)
      p.push({
        campo,
        codigo: "LEITURAS_DIVERGENTES",
        mensagem: `Leituras diferentes em ${campo}: ${String(x)
          .replace(/[\r\n]/g, " ")
          .slice(0, 100)} / ${String(y)
          .replace(/[\r\n]/g, " ")
          .slice(0, 100)}. Confira no original.`,
      });
  };
  for (const k of [
    "cnpj_emitente",
    "cpf_emitente",
    "data_emissao",
    "numero",
    "serie",
    "chave_acesso",
    "total_nota",
    "descontos",
    "acrescimos",
  ] as const)
    comparar(k, a[k], b[k]);
  if (a.itens.length !== b.itens.length && a.itens.length && b.itens.length)
    p.push({
      campo: "itens",
      codigo: "LEITURAS_DIVERGENTES",
      mensagem: `A primeira leitura encontrou ${a.itens.length} itens e a segunda ${b.itens.length}. Confira a quantidade de linhas do documento.`,
    });
  a.itens.forEach((i, n) => {
    if (b.itens[n])
      for (const k of [
        "descricao",
        "quantidade",
        "unidade",
        "valor_unitario",
        "valor_total",
      ] as const)
        comparar(`item ${n + 1} ${k}`, i[k], b.itens[n][k]);
  });
  return p;
}
export async function lerFiscalComGemini(
  s: EscopoLeitura,
  imagens: ImagemNota[],
  fallback: () => Promise<ImagemNota[]>,
  registrar: RegistroLeitura,
  categorias: { nome: string; valor: string }[] = [],
): Promise<{
  dados: ExtracaoFiscal;
  extras: PendenciaFiscal[];
  categoriaFinanceira?: string;
}> {
  const config = await privateVirtualModelConfiguration({
    organizationId: s.organizationId,
    storeId: s.storeId,
  });
  if (
    !config.enabled ||
    !config.configured ||
    ![config.inputRate, config.outputRate].every(
      (v) => Number.isSafeInteger(v) && v >= 0,
    )
  )
    throw new LeituraNotaRecusada(
      "IA_CONFIGURACAO",
      "Configure, teste e ative a IA desta unidade antes de enviar fotos.",
    );
  let primeira: ExtracaoFiscal | null = null,
    ultima: ExtracaoFiscal | null = null;
  const sugestoes = new Map<ExtracaoFiscal, string | undefined>();
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    try {
      const fotos = tentativa === 1 ? imagens : await fallback();
      const p = await prepararExtracaoGemini(fotos, config, categorias),
        reserva = await reservar(s, config, p.entradaTokens, tentativa);
      await registrar({
        etapa: "GEMINI_RESERVADO",
        tentativa,
        modelo: config.model,
      });
      const r = await gerarExtracaoGemini(p, config);
      if (r.custoMicros > reserva.limite)
        throw new LeituraNotaRecusada(
          "IA_ORCAMENTO",
          "O uso da IA excedeu a reserva. Confira as tarifas configuradas.",
        );
      await db.notaFiscalWhatsapp.updateMany({
        where: {
          id: s.solicitacaoId,
          organizacaoId: s.organizationId,
          unidadeId: s.storeId,
          tentativasLeitura: tentativa,
        },
        data: {
          custoMicros: reserva.anterior + r.custoMicros,
          tokens: { increment: r.tokens },
        },
      });
      const pendencias = validarExtracaoFiscal(r.dados);
      sugestoes.set(r.dados, r.categoriaFinanceira);
      ultima = r.dados;
      await registrar({
        etapa: "GEMINI_VALIDADO",
        tentativa,
        modelo: config.model,
        tokens: r.tokens,
        codigos: pendencias.map((p) => p.codigo),
      });
      if (tentativa === 1) {
        primeira = r.dados;
        if (!pendencias.length)
          return {
            dados: r.dados,
            extras: [],
            categoriaFinanceira: r.categoriaFinanceira,
          };
      } else {
        const peso = (d: ExtracaoFiscal) =>
          validarExtracaoFiscal(d).reduce(
            (s, p) => s + (p.codigo === "BAIXA_CONFIANCA" ? 1 : 10),
            0,
          );
        const escolhida =
          primeira && peso(primeira) < peso(r.dados) ? primeira : r.dados;
        return {
          dados: escolhida,
          categoriaFinanceira: sugestoes.get(escolhida),
          extras: primeira ? divergenciasDeLeitura(primeira, r.dados) : [],
        };
      }
    } catch (e) {
      await registrar({
        etapa: "GEMINI_REJEITADO",
        tentativa,
        modelo: config.model,
        codigos: [e instanceof LeituraNotaRecusada ? e.codigo : "IA_FALHA"],
      });
      // Rede/cota/credencial e resultado incerto nunca provocam outra geração.
      if (tentativa === 2 && primeira)
        return {
          dados: primeira,
          categoriaFinanceira: sugestoes.get(primeira),
          extras: [
            {
              campo: "leitura",
              codigo: "SEGUNDA_LEITURA_INDISPONIVEL",
              mensagem:
                "A segunda leitura ficou indisponível. Confira os campos da primeira leitura no documento original.",
            },
          ],
        };
      if (
        !(e instanceof LeituraNotaRecusada) ||
        !["IA_CONTRATO", "IA_JSON"].includes(e.codigo) ||
        tentativa === 2
      )
        throw e;
    }
  }
  if (ultima)
    return {
      dados: ultima,
      extras: [],
      categoriaFinanceira: sugestoes.get(ultima),
    };
  throw new LeituraNotaRecusada(
    "IA_CONTRATO",
    "Não foi possível conferir a leitura. Envie uma foto mais nítida ou o XML.",
  );
}
