import { Router, type Response } from "express";
import { z } from "zod";

import type { Banco } from "../banco/conexao.js";
import type { Config } from "../config.js";
import type { Registro } from "../registro.js";
import {
  limparVencidos,
  renovar,
  revogarPorChave,
  trocarCodigo,
  type ResultadoDaTroca,
} from "./armazem.js";
import { escoposConcedidos } from "./escopos.js";
import { mesmoRecurso } from "./rotas-autorizar.js";

/**
 * ONDE O CÓDIGO VIRA CHAVE, E A CHAVE SE RENOVA OU MORRE.
 *
 * Só aceita formulário (`application/x-www-form-urlencoded`), como manda a
 * RFC 6749 e como o Claude envia. Toda resposta leva `Cache-Control:
 * no-store`: chave não pode ficar guardada em proxy nenhum. Os erros usam os
 * códigos da RFC — o Claude decide o que fazer a partir deles (um
 * `invalid_grant` na renovação, por exemplo, faz ele pedir login de novo).
 */

const troca = z.object({
  grant_type: z.literal("authorization_code"),
  code: z.string().min(1).max(200),
  redirect_uri: z.string().min(1).max(2000),
  client_id: z.string().min(1).max(500),
  code_verifier: z.string().min(1).max(200),
  resource: z.string().max(500).optional(),
});

const renovacao = z.object({
  grant_type: z.literal("refresh_token"),
  refresh_token: z.string().min(1).max(200),
  client_id: z.string().min(1).max(500),
  scope: z.string().max(500).optional(),
  resource: z.string().max(500).optional(),
});

const revogacao = z.object({
  token: z.string().min(1).max(200),
  token_type_hint: z.string().max(50).optional(),
  client_id: z.string().min(1).max(500),
});

function semCache(res: Response): Response {
  return res.set({ "Cache-Control": "no-store", Pragma: "no-cache" });
}

function erroOAuth(
  res: Response,
  status: number,
  erro: string,
  descricao: string,
): void {
  semCache(res)
    .status(status)
    .json({ error: erro, error_description: descricao });
}

export function rotasDeToken(deps: {
  banco: Banco;
  config: Config;
  registro: Registro;
}): Router {
  const rotas = Router();

  rotas.post("/token", async (req, res) => {
    if (!req.is("application/x-www-form-urlencoded")) {
      return erroOAuth(
        res,
        400,
        "invalid_request",
        "Envie como application/x-www-form-urlencoded.",
      );
    }
    const corpo: Record<string, unknown> = req.body ?? {};
    const alvoErrado = (recurso: string | undefined) =>
      recurso !== undefined && !mesmoRecurso(recurso, deps.config.urlMcp);

    let resultado: ResultadoDaTroca;
    if (corpo.grant_type === "authorization_code") {
      const analise = troca.safeParse(corpo);
      if (!analise.success) {
        return erroOAuth(
          res,
          400,
          "invalid_request",
          "Faltam campos: code, redirect_uri, client_id e code_verifier.",
        );
      }
      if (alvoErrado(analise.data.resource)) {
        return erroOAuth(res, 400, "invalid_target", "Recurso desconhecido.");
      }
      resultado = await trocarCodigo(deps.banco, {
        codigo: analise.data.code,
        clientId: analise.data.client_id,
        redirectUri: analise.data.redirect_uri,
        verificador: analise.data.code_verifier,
      });
    } else if (corpo.grant_type === "refresh_token") {
      const analise = renovacao.safeParse(corpo);
      if (!analise.success) {
        return erroOAuth(
          res,
          400,
          "invalid_request",
          "Faltam campos: refresh_token e client_id.",
        );
      }
      if (alvoErrado(analise.data.resource)) {
        return erroOAuth(res, 400, "invalid_target", "Recurso desconhecido.");
      }
      if (
        analise.data.scope !== undefined &&
        escoposConcedidos(analise.data.scope) === null
      ) {
        return erroOAuth(res, 400, "invalid_scope", "Escopo desconhecido.");
      }
      resultado = await renovar(deps.banco, {
        refreshToken: analise.data.refresh_token,
        clientId: analise.data.client_id,
      });
    } else {
      return erroOAuth(
        res,
        400,
        "unsupported_grant_type",
        "Use authorization_code ou refresh_token.",
      );
    }

    if (!resultado.ok) {
      deps.registro.aviso("troca de chave recusada", {
        tipo: corpo.grant_type,
        motivo: resultado.descricao,
      });
      return erroOAuth(res, 400, resultado.erro, resultado.descricao);
    }

    limparVencidos(deps.banco).catch((erro) =>
      deps.registro.aviso("a faxina das chaves vencidas falhou", { erro }),
    );
    semCache(res).json({
      access_token: resultado.chaves.accessToken,
      token_type: "Bearer",
      expires_in: resultado.chaves.expiresIn,
      refresh_token: resultado.chaves.refreshToken,
      scope: resultado.chaves.escopos.join(" "),
    });
  });

  rotas.post("/revoke", async (req, res) => {
    const analise = revogacao.safeParse(req.body ?? {});
    if (!analise.success) {
      return erroOAuth(res, 400, "invalid_request", "Envie token e client_id.");
    }
    await revogarPorChave(deps.banco, {
      token: analise.data.token,
      clientId: analise.data.client_id,
    });
    // RFC 7009: responde 200 mesmo quando a chave não existe — não confirma
    // para ninguém quais chaves são válidas.
    semCache(res).status(200).end();
  });

  return rotas;
}
