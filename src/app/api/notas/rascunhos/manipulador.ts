import { z } from "zod";
import type { ContextoSessao } from "@/core/sessao/nucleo";
import { SemPermissao } from "@/lib/erros";
import { LIMITE_DOCUMENTO_NOTA } from "@/server/notas/documento";
import { RascunhoFiscalRecusado } from "@/modules/assistente/schemas/rascunho-fiscal";
import type * as servicos from "@/modules/assistente/services/rascunhos-fiscais";

type Dependencias = {
  contexto: () => Promise<ContextoSessao | null>;
  autorizar: typeof servicos.exigirAcessoRascunho;
  receber: typeof servicos.receberRascunhoFiscal;
  salvar: typeof servicos.salvarRascunhoFiscal;
  obter: typeof servicos.obterRascunhoFiscal;
  listar: typeof servicos.listarRascunhosFiscais;
};
const resposta = (dados: unknown, status = 200) =>
  Response.json(dados, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });

async function corpoLimitado(req: Request, limite: number) {
  if (Number(req.headers.get("content-length")) > limite || !req.body)
    throw new RascunhoFiscalRecusado("O envio excede o limite permitido.");
  const reader = req.body.getReader();
  const partes: Uint8Array[] = [];
  let tamanho = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    tamanho += value.length;
    if (tamanho > limite) {
      await reader.cancel();
      throw new RascunhoFiscalRecusado("O envio excede o limite permitido.");
    }
    partes.push(value);
  }
  return Buffer.concat(partes);
}

export function criarManipuladorRascunhos(d: Dependencias) {
  return async (req: Request) => {
    try {
      if (!["GET", "POST", "PATCH"].includes(req.method))
        return resposta({ erro: "Operação indisponível." }, 405);
      if (
        req.method !== "GET" &&
        req.headers.get("origin") !== new URL(req.url).origin
      )
        return resposta({ erro: "Origem do envio inválida." }, 403);
      const ctx = await d.contexto();
      if (!ctx) return resposta({ erro: "Entre no sistema." }, 401);
      const unidadeId = req.headers.get("x-unidade-id") ?? "";
      await d.autorizar(ctx, unidadeId);
      if (req.method === "GET") {
        const id = new URL(req.url).searchParams.get("id");
        return resposta(
          id
            ? await d.obter(ctx, unidadeId, id)
            : await d.listar(ctx, unidadeId),
        );
      }
      if (req.method === "PATCH") {
        const bytes = await corpoLimitado(req, 180_000);
        let entrada;
        try {
          entrada = JSON.parse(bytes.toString("utf8"));
        } catch {
          return resposta(
            { erro: "O rascunho enviado não está em JSON válido." },
            400,
          );
        }
        // O serviço confere também a unidade do corpo contra a sessão.
        if (entrada?.unidadeId !== unidadeId)
          throw new SemPermissao("editar rascunhos nesta unidade");
        return resposta(await d.salvar(ctx, entrada));
      }
      const bytes = await corpoLimitado(req, LIMITE_DOCUMENTO_NOTA + 64 * 1024);
      let form;
      try {
        form = await new Response(new Uint8Array(bytes), {
          headers: { "Content-Type": req.headers.get("content-type") ?? "" },
        }).formData();
      } catch {
        return resposta({ erro: "Envie um documento em arquivo." }, 400);
      }
      const arquivo = form.get("arquivo");
      const operacaoId = z.uuid().parse(form.get("operacaoId"));
      if (
        !(arquivo instanceof File) ||
        !arquivo.size ||
        arquivo.size > LIMITE_DOCUMENTO_NOTA
      )
        return resposta(
          { erro: "Envie XML, PDF, JPG, PNG ou WebP de até 20 MB." },
          400,
        );
      return resposta(
        await d.receber(ctx, {
          unidadeId,
          operacaoId,
          bytes: new Uint8Array(await arquivo.arrayBuffer()),
        }),
      );
    } catch (e) {
      if (e instanceof SemPermissao)
        return resposta(
          { erro: "Seu perfil não pode editar rascunhos nesta unidade." },
          403,
        );
      if (e instanceof z.ZodError)
        return resposta(
          { erro: "Confira os formatos e limites dos campos do rascunho." },
          400,
        );
      if (e instanceof RascunhoFiscalRecusado)
        return resposta({ erro: e.message }, 409);
      // Sem corpos, nomes originais, dados fiscais, URLs ou segredos em logs.
      return resposta(
        {
          erro: "Não foi possível salvar ou consultar o rascunho. Tente novamente.",
        },
        500,
      );
    }
  };
}
