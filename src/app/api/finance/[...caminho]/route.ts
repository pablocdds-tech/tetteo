import { Prisma } from "@prisma/client";
import { z } from "zod";

import { obterContexto } from "@/core/sessao/contexto";
import {
  configuracaoSchema,
  csvSeguro,
  diaSchema,
  fontes,
  LIMITE_ARQUIVO,
} from "@/modules/financeiro/schemas/conferencia";
import {
  anexarEvidencia,
  confirmarImportacao,
  consultarConferencia,
  criarContrato,
  descartarImportacao,
  detalharCorrespondencia,
  detalheImportacao,
  ErroConferencia,
  escopoConferencia,
  executarConferencia,
  exportarConferencia,
  lerEvidencia,
  limitarConferencia,
  listarImportacoes,
  originalImportacao,
  previaImportacao,
  registrarDecisao,
} from "@/modules/financeiro/services/conferencia";

export const runtime = "nodejs";
const idSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[\w-]+$/);
const filtroSchema = z
  .object({
    de: diaSchema,
    ate: diaSchema,
    estado: z.string().max(60).optional(),
    categoria: z.enum(["EXATA", "PROVAVEL", "AMBIGUA", "AUSENTE"]).optional(),
    pagina: z.coerce.number().int().min(1).max(10000).optional(),
    execucaoId: idSchema.optional(),
  })
  .strict();
const headersPrivados = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};
const resposta = (dados: unknown, status = 200) =>
  Response.json(dados, { status, headers: headersPrivados });

async function lerJsonLimitado(request: Request) {
  const limite = 3 * 1024 * 1024;
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new ErroConferencia("Envie dados JSON.", 415);
  if (Number(request.headers.get("content-length")) > limite)
    throw new ErroConferencia("O envio excede o tamanho permitido.", 413);
  const leitor = request.body?.getReader();
  if (!leitor) throw new ErroConferencia("Envio vazio.");
  const partes: Uint8Array[] = [];
  let tamanho = 0;
  while (true) {
    const { value, done } = await leitor.read();
    if (done) break;
    tamanho += value.byteLength;
    if (tamanho > limite) {
      await leitor.cancel();
      throw new ErroConferencia("O envio excede o tamanho permitido.", 413);
    }
    partes.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(partes).toString("utf8"));
  } catch {
    throw new ErroConferencia("JSON inválido.");
  }
}
function decodificar(valor: string) {
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      valor,
    )
  )
    throw new ErroConferencia("Arquivo inválido.");
  const bytes = Buffer.from(valor, "base64");
  if (!bytes.length || bytes.length > LIMITE_ARQUIVO)
    throw new ErroConferencia("Envie um arquivo de até 2 MB.", 413);
  return bytes;
}
function baixar(bytes: Uint8Array | string, nome: string, tipo: string) {
  const corpo = typeof bytes === "string" ? bytes : new Uint8Array(bytes);
  return new Response(corpo, {
    headers: {
      ...headersPrivados,
      "Content-Type": tipo,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(nome)}`,
      "Content-Security-Policy": "sandbox; default-src 'none'",
    },
  });
}

async function atender(
  request: Request,
  parametros: { params: Promise<{ caminho: string[] }> },
) {
  try {
    const ctx = await obterContexto();
    if (!ctx)
      return resposta({ erro: "Entre no sistema para continuar." }, 401);
    escopoConferencia(ctx);
    const { caminho } = await parametros.params;
    const rota = caminho.join("/");
    if (request.method === "POST") {
      const origem = request.headers.get("origin");
      const permitida = new URL(
        process.env.AUTH_URL ??
          process.env.NEXTAUTH_URL ??
          process.env.APP_URL ??
          request.url,
      ).origin;
      if (
        origem !== permitida ||
        request.headers.get("sec-fetch-site") === "cross-site"
      )
        throw new ErroConferencia("Origem do envio não autorizada.", 403);
      await limitarConferencia(
        ctx,
        rota === "imports/preview" ? "preview" : "escrita",
      );
      const body = await lerJsonLimitado(request);
      if (rota === "imports/preview") {
        const dados = z
          .object({
            nome: z.string().min(1).max(120),
            arquivo: z.string().max(2800000),
            configuracao: configuracaoSchema,
          })
          .strict()
          .parse(body);
        return resposta(
          await previaImportacao(
            ctx,
            decodificar(dados.arquivo),
            dados.nome,
            dados.configuracao,
          ),
        );
      }
      if (rota === "imports/confirm") {
        const dados = z
          .object({
            previewId: idSchema,
            expectedHash: z.string().regex(/^[a-f0-9]{64}$/),
            requestKey: idSchema,
            revisado: z.boolean().default(false),
            motivo: z.string().trim().max(2000).default(""),
            substituirConflitos: z.boolean().default(false),
          })
          .strict()
          .parse(body);
        return resposta(await confirmarImportacao(ctx, dados));
      }
      if (rota === "reconciliation/runs") {
        const dados = z
          .object({
            de: diaSchema,
            ate: diaSchema,
            requestKey: idSchema,
            sourceVersions: z.array(idSchema).max(500).optional(),
          })
          .strict()
          .parse(body);
        return resposta(await executarConferencia(ctx, dados), 201);
      }
      if (rota === "contracts")
        return resposta(await criarContrato(ctx, body), 201);
      if (
        caminho[0] === "imports" &&
        caminho.length === 3 &&
        caminho[2] === "discard"
      ) {
        const dados = z
          .object({ motivo: z.string().trim().min(10).max(2000) })
          .strict()
          .parse(body);
        return resposta(
          await descartarImportacao(
            ctx,
            idSchema.parse(caminho[1]),
            dados.motivo,
          ),
        );
      }
      if (
        caminho[0] === "reconciliation" &&
        caminho.length === 3 &&
        caminho[2] === "reviews"
      ) {
        const dados = z
          .object({
            expectedVersion: z.number().int().min(0),
            decisao: z.enum([
              "COMENTARIO",
              "CONFERIDO_MANUALMENTE",
              "CONTESTAR_TAXA",
              "AGUARDAR",
              "DESCARTAR_SUGESTAO",
            ]),
            motivo: z.string().trim().min(10).max(2000),
            evidenciaIds: z.array(idSchema).max(20).default([]),
          })
          .strict()
          .parse(body);
        return resposta(
          await registrarDecisao(ctx, idSchema.parse(caminho[1]), dados),
          201,
        );
      }
      if (
        caminho[0] === "reconciliation" &&
        caminho.length === 3 &&
        caminho[2] === "evidence"
      ) {
        const dados = z
          .object({
            nome: z.string().min(1).max(120),
            arquivo: z.string().max(2800000),
          })
          .strict()
          .parse(body);
        const bytes = decodificar(dados.arquivo);
        // Evidências são entregues como download; não executamos HTML, PDF ou macros.
        const tipo =
          bytes.subarray(0, 5).toString() === "%PDF-"
            ? "application/pdf"
            : bytes[0] === 0x89 && bytes.subarray(1, 4).toString() === "PNG"
              ? "image/png"
              : bytes[0] === 0xff && bytes[1] === 0xd8
                ? "image/jpeg"
                : null;
        if (!tipo)
          throw new ErroConferencia("Anexe PDF, PNG ou JPG de até 2 MB.");
        return resposta(
          await anexarEvidencia(
            ctx,
            idSchema.parse(caminho[1]),
            dados.nome,
            bytes,
            tipo,
          ),
          201,
        );
      }
    } else {
      const query = Object.fromEntries(new URL(request.url).searchParams);
      if (caminho[0] === "models" && caminho.length === 2) {
        const fonte = z.enum(fontes).parse(caminho[1]);
        const comum = [
          "externalId",
          "provider",
          "merchantRef",
          "accountRef",
          "businessDay",
        ];
        const amostra = [
          "exemplo-1",
          "DEMO",
          "loja-demo",
          "conta-demo",
          fonte === "BANCO" ? "2026-10-20" : "2026-10-19",
        ];
        const colunas =
          fonte === "VENDA"
            ? [
                ...comum,
                "saleExternalId",
                "nsu",
                "grossCents",
                "method",
                "brand",
                "installments",
                "status",
              ]
            : fonte === "ADQUIRENTE"
              ? [
                  ...comum,
                  "nsu",
                  "grossCents",
                  "feeCents",
                  "netCents",
                  "method",
                  "brand",
                  "status",
                  "payoutRef",
                  "expectedSettlementDay",
                ]
              : [
                  ...comum,
                  "amountCents",
                  "direction",
                  "payoutRef",
                  "description",
                ];
        const linha =
          fonte === "VENDA"
            ? [
                ...amostra,
                "pedido-demo",
                "DEMO-1001",
                125000,
                "CREDIT",
                "VISA",
                1,
                "COMPLETED",
              ]
            : fonte === "ADQUIRENTE"
              ? [
                  ...amostra,
                  "DEMO-1001",
                  125000,
                  4375,
                  120625,
                  "CREDIT",
                  "VISA",
                  "SETTLED",
                  "lote-demo",
                  "2026-10-20",
                ]
              : [...amostra, 120625, "CREDIT", "lote-demo", "Crédito fictício"];
        return baixar(
          "\uFEFF" +
            [colunas, linha]
              .map((l) => l.map(csvSeguro).join(";"))
              .join("\r\n"),
          `modelo-${fonte.toLowerCase()}.csv`,
          "text/csv; charset=utf-8",
        );
      }
      if (rota === "reconciliation")
        return resposta(
          await consultarConferencia(ctx, filtroSchema.parse(query)),
        );
      if (rota === "reconciliation/export") {
        await limitarConferencia(ctx, "exportacao");
        const filtro = filtroSchema.parse(query);
        return baixar(
          await exportarConferencia(ctx, filtro),
          `conferencia-${filtro.de}-${filtro.ate}.csv`,
          "text/csv; charset=utf-8",
        );
      }
      if (rota === "imports") {
        const filtro = z
          .object({ de: diaSchema, ate: diaSchema })
          .strict()
          .parse(query);
        return resposta(await listarImportacoes(ctx, filtro.de, filtro.ate));
      }
      if (caminho[0] === "imports" && caminho.length === 2) {
        const filtro = z
          .object({
            pagina: z.coerce.number().int().min(1).max(1000).default(1),
            linha: z.coerce.number().int().min(1).max(100000).optional(),
          })
          .strict()
          .parse(query);
        return resposta(
          await detalheImportacao(
            ctx,
            idSchema.parse(caminho[1]),
            filtro.pagina,
            filtro.linha,
          ),
        );
      }
      if (
        caminho[0] === "imports" &&
        caminho.length === 3 &&
        caminho[2] === "original"
      ) {
        const imp = await originalImportacao(ctx, idSchema.parse(caminho[1]));
        return baixar(
          imp.original,
          imp.nomeArquivo,
          "application/octet-stream",
        );
      }
      if (caminho[0] === "reconciliation" && caminho.length === 2)
        return resposta(
          await detalharCorrespondencia(ctx, idSchema.parse(caminho[1])),
        );
      if (caminho[0] === "evidence" && caminho.length === 2) {
        const evidencia = await lerEvidencia(ctx, idSchema.parse(caminho[1]));
        return baixar(evidencia.bytes, evidencia.nome, evidencia.tipo);
      }
    }
    return resposta({ erro: "Rota não encontrada." }, 404);
  } catch (erro) {
    if (erro instanceof ErroConferencia)
      return resposta({ erro: erro.message }, erro.status);
    if (erro instanceof z.ZodError)
      return resposta(
        {
          erro: "Confira os dados enviados.",
          detalhes: erro.issues.map((i) => ({
            campo: i.path.join("."),
            mensagem: i.message,
          })),
        },
        400,
      );
    if (
      erro instanceof Prisma.PrismaClientKnownRequestError &&
      ["P2002", "P2034"].includes(erro.code)
    )
      return resposta(
        {
          erro: "As informações mudaram durante a operação. Atualize a página e tente novamente.",
        },
        409,
      );
    console.error(
      "[financeiro/conferencia]",
      erro instanceof Error ? erro.name : "Erro desconhecido",
    );
    return resposta(
      { erro: "Não foi possível concluir a operação. Tente novamente." },
      500,
    );
  }
}
export const GET = atender;
export const POST = atender;
