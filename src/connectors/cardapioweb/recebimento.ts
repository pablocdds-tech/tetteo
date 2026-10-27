import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { ClienteCw } from "./client";
import { configApiCw, ErroCw, type AmbienteCw } from "./config";
import { cifrarCw, hashCw, igualCw, type EscopoCw } from "./seguranca";
import type { GravarEventoCw } from "./webhook";

export function contextoLegadoCw(
  scope: Pick<EscopoCw, "organizacaoId" | "unidadeId">,
  ambiente: string,
  merchantId: number,
) {
  return JSON.stringify([
    "cardapioweb:legado:v1",
    scope.organizacaoId,
    scope.unidadeId,
    ambiente,
    merchantId,
  ]);
}
const escopo = (scope: EscopoCw) => ({
  organizacaoId: scope.organizacaoId,
  unidadeId: scope.unidadeId,
});
async function validar(scope: EscopoCw) {
  if (
    !(await db.unidade.findFirst({
      where: {
        id: scope.unidadeId,
        organizacaoId: scope.organizacaoId,
        ativa: true,
        excluidoEm: null,
        organizacao: { ativa: true, excluidoEm: null },
      },
      select: { id: true },
    }))
  )
    throw new ErroCw("unidade", "Unidade indisponível.");
}
export async function auditarRecebimentoCw(
  tx: Prisma.TransactionClient,
  scope: Pick<EscopoCw, "organizacaoId" | "unidadeId"> & { usuarioId?: string },
  id: string,
  estado: string,
) {
  await tx.auditoria.create({
    data: {
      organizacaoId: scope.organizacaoId,
      unidadeId: scope.unidadeId,
      usuarioId: scope.usuarioId,
      entidade: "CardapioWebRecebimento",
      entidadeId: id,
      acao: "ALTEROU",
      valoresDepois: { estado },
    },
  });
}
export async function prepararLegadoCw(
  scope: EscopoCw,
  ambiente: AmbienteCw,
  apiKey: string,
  webhookToken: string,
) {
  await validar(scope);
  if (
    !apiKey ||
    apiKey.length > 4096 ||
    /[\r\n]/.test(apiKey) ||
    webhookToken.length < 32 ||
    webhookToken.length > 512 ||
    /\s/.test(webhookToken)
  )
    throw new ErroCw(
      "credencial",
      "Informe o token de API e um token de webhook com pelo menos 32 caracteres, sem espaços.",
    );
  // Testa a cifra antes da chamada externa e jamais inclui a credencial no erro.
  cifrarCw("validar-chave", "cardapioweb:configuracao");
  const loja = await new ClienteCw(
    configApiCw(ambiente),
    fetch,
    "api-key",
  ).loja(apiKey);
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`cw-unidade:${scope.organizacaoId}:${scope.unidadeId}`}, 0))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`cw-loja:${ambiente}:${loja.id}`}, 0))`;
    const anterior = await tx.cardapioWebRecebimento.findUnique({
      where: { ambiente_merchantId: { ambiente, merchantId: loja.id } },
    });
    if (
      anterior &&
      (anterior.organizacaoId !== scope.organizacaoId ||
        anterior.unidadeId !== scope.unidadeId)
    )
      throw new ErroCw(
        "vinculo",
        "Essa loja já está vinculada a outra unidade. Revise com o administrador.",
      );
    const dados = {
      merchantNome: loja.name,
      apiPendenteCifrada: cifrarCw(
        apiKey,
        contextoLegadoCw(scope, ambiente, loja.id),
      ),
      webhookPendenteHash: hashCw(webhookToken),
      pendentePorId: scope.usuarioId,
      pendenteAte: new Date(Date.now() + 10 * 60_000),
    };
    const registro = anterior
      ? await tx.cardapioWebRecebimento.update({
          where: { id: anterior.id },
          data: dados,
        })
      : await tx.cardapioWebRecebimento.create({
          data: { ...escopo(scope), ambiente, merchantId: loja.id, ...dados },
        });
    await auditarRecebimentoCw(
      tx,
      scope,
      registro.id,
      "CREDENCIAL_CONFERIDA_AGUARDANDO_CONFIRMACAO",
    );
  });
}

export async function confirmarLegadoCw(scope: EscopoCw, id: string) {
  await validar(scope);
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`cw-unidade:${scope.organizacaoId}:${scope.unidadeId}`}, 0))`;
    const row = await tx.cardapioWebRecebimento.findFirst({
      where: {
        ...escopo(scope),
        id,
        pendentePorId: scope.usuarioId,
        pendenteAte: { gt: new Date() },
      },
    });
    if (!row?.apiPendenteCifrada || !row.webhookPendenteHash)
      throw new ErroCw(
        "state",
        "A confirmação expirou. Confira a credencial novamente.",
      );
    await tx.cardapioWebRecebimento.updateMany({
      where: {
        ...escopo(scope),
        ambiente: row.ambiente,
        id: { not: id },
        ativo: true,
      },
      data: {
        ativo: false,
        revisao: { increment: 1 },
        apiKeyCifrada: null,
        webhookTokenHash: null,
      },
    });
    await tx.cardapioWebRecebimento.update({
      where: { id },
      data: {
        ativo: true,
        apiKeyCifrada: row.apiPendenteCifrada,
        webhookTokenHash: row.webhookPendenteHash,
        apiPendenteCifrada: null,
        webhookPendenteHash: null,
        pendentePorId: null,
        pendenteAte: null,
        revisao: { increment: 1 },
        ultimoErro: null,
        tentativaReconciliacaoEm: null,
        concessaoAte: null,
        concessaoDono: null,
      },
    });
    await auditarRecebimentoCw(tx, scope, id, "RECEBIMENTO_ATIVADO");
  });
}
export async function desativarRecebimentoCw(scope: EscopoCw, id: string) {
  await validar(scope);
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`cw-unidade:${scope.organizacaoId}:${scope.unidadeId}`}, 0))`;
    const salvo = await tx.cardapioWebRecebimento.updateMany({
      where: { ...escopo(scope), id },
      data: {
        ativo: false,
        apiKeyCifrada: null,
        webhookTokenHash: null,
        apiPendenteCifrada: null,
        webhookPendenteHash: null,
        pendentePorId: null,
        pendenteAte: null,
        revisao: { increment: 1 },
        concessaoAte: null,
        concessaoDono: null,
      },
    });
    if (salvo.count !== 1)
      throw new ErroCw("vinculo", "Conexão não encontrada nesta unidade.");
    await auditarRecebimentoCw(tx, scope, id, "RECEBIMENTO_DESATIVADO");
  });
}
export async function painelRecebimentoCw(scope: EscopoCw) {
  await validar(scope);
  await db.cardapioWebRecebimento.updateMany({
    where: { ...escopo(scope), pendenteAte: { lt: new Date() } },
    data: {
      apiPendenteCifrada: null,
      webhookPendenteHash: null,
      pendentePorId: null,
      pendenteAte: null,
    },
  });
  const vinculos = await db.cardapioWebRecebimento.findMany({
    where: {
      ...escopo(scope),
      OR: [
        { ativo: true },
        { ultimoErro: { not: null } },
        { pendentePorId: scope.usuarioId, pendenteAte: { gt: new Date() } },
      ],
    },
    orderBy: { criadoEm: "desc" },
    select: {
      id: true,
      ambiente: true,
      merchantId: true,
      merchantNome: true,
      ativo: true,
      pendentePorId: true,
      ultimoEventoEm: true,
      ultimaReconciliacaoEm: true,
      ultimoErro: true,
      _count: { select: { eventos: { where: { estado: "PENDENTE" } } } },
    },
  });
  const pedidos = await db.cardapioWebPedido.findMany({
    where: { ...escopo(scope), recebimento: { ativo: true } },
    orderBy: { atualizadoNoProvedorEm: "desc" },
    take: 100,
    select: {
      id: true,
      orderId: true,
      displayId: true,
      estado: true,
      modalidade: true,
      canal: true,
      totalCentavos: true,
      atualizadoNoProvedorEm: true,
    },
  });
  return { vinculos, pedidos };
}

export const gravarEventoCw: GravarEventoCw = async (ambiente, token, evento) =>
  persistirEventoCw(ambiente, token, evento);
async function persistirEventoCw(
  ambiente: Parameters<GravarEventoCw>[0],
  token: string,
  evento: Parameters<GravarEventoCw>[2],
): ReturnType<GravarEventoCw> {
  return await db.$transaction(
    async (tx) => {
      const row = await tx.cardapioWebRecebimento.findUnique({
        where: {
          ambiente_merchantId: { ambiente, merchantId: evento.merchant_id },
        },
        include: {
          unidade: {
            select: {
              ativa: true,
              excluidoEm: true,
              organizacao: { select: { ativa: true, excluidoEm: true } },
            },
          },
        },
      });
      if (
        !row?.ativo ||
        !row.webhookTokenHash ||
        !igualCw(row.webhookTokenHash, hashCw(token)) ||
        !row.unidade.ativa ||
        row.unidade.excluidoEm ||
        !row.unidade.organizacao.ativa ||
        row.unidade.organizacao.excluidoEm
      )
        return "recusado";
      const insercao = await tx.cardapioWebEvento.createMany({
        skipDuplicates: true,
        data: [
          {
            organizacaoId: row.organizacaoId,
            unidadeId: row.unidadeId,
            recebimentoId: row.id,
            eventId: evento.event_id,
            tipo: evento.event_type,
            orderId: evento.order_id,
            statusInformado: evento.order_status,
            ocorridoEm: new Date(evento.created_at),
          },
        ],
      });
      if (!insercao.count) {
        const repetido = await tx.cardapioWebEvento.findUnique({
          where: {
            recebimentoId_eventId: {
              recebimentoId: row.id,
              eventId: evento.event_id,
            },
          },
        });
        return repetido && mesmoEvento(repetido, evento)
          ? "repetido"
          : "conflito";
      }
      await tx.cardapioWebRecebimento.update({
        where: { id: row.id },
        data: { ultimoEventoEm: new Date() },
      });
      return "recebido";
    },
    { timeout: 2000, maxWait: 500 },
  );
}
function mesmoEvento(
  row: {
    origem: string;
    tipo: string;
    orderId: number;
    statusInformado: string;
    ocorridoEm: Date;
  },
  evento: Parameters<GravarEventoCw>[2],
) {
  return (
    row.origem === "WEBHOOK" &&
    row.tipo === evento.event_type &&
    row.orderId === evento.order_id &&
    row.statusInformado === evento.order_status &&
    row.ocorridoEm.getTime() === Date.parse(evento.created_at)
  );
}
