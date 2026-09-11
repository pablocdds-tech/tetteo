import { randomUUID } from "node:crypto";

import {
  getOAuthProtectedResourceMetadataUrl,
  hostHeaderValidation,
  mcpAuthMetadataRouter,
  originValidation,
  requireBearerAuth,
} from "@modelcontextprotocol/express";
import { toNodeHandler } from "@modelcontextprotocol/node";
import {
  createMcpHandler,
  type McpHttpHandler,
} from "@modelcontextprotocol/server";
import express, {
  type ErrorRequestHandler,
  type Express,
  type RequestHandler,
} from "express";

import type { Banco } from "./banco/conexao.js";
import type { Config } from "./config.js";
import type { FonteDeVendas } from "./fontes/tipos.js";
import { criarServidorMcp, VERSAO } from "./mcp/servidor-mcp.js";
import { registrarChamada } from "./oauth/armazem.js";
import {
  criarResolvedorDeClientes,
  type ResolverCliente,
} from "./oauth/cliente.js";
import { ESCOPO_VENDAS, ESCOPOS_SUPORTADOS } from "./oauth/escopos.js";
import { metadadosDoEmissor } from "./oauth/metadados.js";
import { rotasDeAutorizacao } from "./oauth/rotas-autorizar.js";
import { rotasDeToken } from "./oauth/rotas-token.js";
import { criarVerificador } from "./oauth/verificador.js";
import type { Registro } from "./registro.js";

/**
 * A MONTAGEM DO SERVIDOR.
 *
 * A ordem das camadas é a segurança:
 *
 *   1. registro     toda requisição vira uma linha (sem query, sem corpo)
 *   2. Host         só o nosso nome — barra DNS rebinding
 *   3. Origin       navegador de outro site não entra
 *   4. rotas        /health, descoberta, /oauth/*, /mcp
 *   5. em /mcp:     a CHAVE antes do corpo. Quem não tem chave não consegue
 *                   nem fazer o servidor ler 64 KB de JSON.
 *
 * `/mcp` é servido por `createMcpHandler` no modo sem sessão: cada requisição
 * monta um McpServer novo (2026-07-28) ou cai no modo sem sessão de 2025
 * (`legacy: "stateless"`). Nada fica em memória entre chamadas.
 */

export type DependenciasDoServidor = {
  config: Config;
  banco: Banco;
  fonte: FonteDeVendas;
  registro: Registro;
  resolverCliente?: ResolverCliente;
  agora?: () => Date;
  tempoMaximoMs?: number;
};

const NOME_DO_RECURSO = "Tetteo — consultas";

async function comLimite<T>(promessa: Promise<T>, ms: number): Promise<T> {
  let relogio: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promessa,
      new Promise<never>((_, rejeitar) => {
        relogio = setTimeout(() => rejeitar(new Error("tempo esgotado")), ms);
      }),
    ]);
  } finally {
    clearTimeout(relogio);
  }
}

function registrarRequisicoes(registro: Registro): RequestHandler {
  return (req, res, next) => {
    const inicio = performance.now();
    const id = randomUUID();
    res.setHeader("X-Request-Id", id);
    res.on("finish", () => {
      registro.info("requisicao", {
        id,
        metodo: req.method,
        // Só o caminho: a query de /oauth/authorize carrega state e desafio.
        caminho: req.originalUrl.split("?")[0],
        status: res.statusCode,
        ms: Math.round(performance.now() - inicio),
      });
    });
    next();
  };
}

function tratarErros(registro: Registro): ErrorRequestHandler {
  return (erro, req, res, _proximo) => {
    const informado = (erro as { status?: unknown })?.status;
    const status =
      typeof informado === "number" && informado >= 400 && informado < 600
        ? informado
        : 500;
    if (status >= 500) {
      registro.erro("erro inesperado", { erro, caminho: req.path });
    } else {
      // O erro de JSON malformado traz um pedaço do corpo na mensagem: fica
      // de fora do registro.
      registro.aviso("requisição recusada", {
        status,
        caminho: req.path,
        tipo: (erro as { type?: string })?.type,
      });
    }
    if (res.headersSent) return;

    if (req.path === "/mcp") {
      res.status(status).json({
        jsonrpc: "2.0",
        error: {
          code: status === 400 ? -32700 : status === 413 ? -32600 : -32603,
          message:
            status === 413
              ? "Requisição grande demais."
              : status === 400
                ? "JSON inválido."
                : "Erro interno.",
        },
        id: null,
      });
      return;
    }
    res.status(status).json({
      error:
        status === 413
          ? "request_too_large"
          : status < 500
            ? "invalid_request"
            : "server_error",
    });
  };
}

export function criarAplicacao(deps: DependenciasDoServidor): {
  app: Express;
  handler: McpHttpHandler;
} {
  const { config, banco, registro } = deps;
  const app = express();
  app.disable("x-powered-by");
  // Atrás do Traefik: o IP de quem chama vem no X-Forwarded-For (um salto).
  app.set("trust proxy", 1);

  app.use(registrarRequisicoes(registro));
  app.use(hostHeaderValidation(config.hostsPermitidos));
  app.use(originValidation([config.urlPublica.hostname]));

  app.get("/health", async (_req, res) => {
    let situacaoDoBanco: "ok" | "indisponivel" = "ok";
    try {
      await comLimite(banco.query("SELECT 1"), 1500);
    } catch {
      situacaoDoBanco = "indisponivel";
    }
    res.set("Cache-Control", "no-store").json({
      status: "ok",
      servico: "tetteo-mcp",
      versao: VERSAO,
      banco: situacaoDoBanco,
    });
  });

  // Descoberta: RFC 9728 (recurso) e RFC 8414 (servidor de autorização).
  app.use(
    mcpAuthMetadataRouter({
      oauthMetadata: metadadosDoEmissor(config),
      resourceServerUrl: config.urlMcp,
      scopesSupported: [...ESCOPOS_SUPORTADOS],
      resourceName: NOME_DO_RECURSO,
    }),
  );
  // O mesmo documento na raiz: clientes que não acham o caminho com /mcp
  // tentam aqui.
  app.get("/.well-known/oauth-protected-resource", (_req, res) => {
    res.set("Access-Control-Allow-Origin", "*").json({
      resource: config.urlMcp.href,
      authorization_servers: [config.emissor],
      scopes_supported: [...ESCOPOS_SUPORTADOS],
      resource_name: NOME_DO_RECURSO,
    });
  });

  app.use(
    "/oauth",
    express.urlencoded({ extended: false, limit: "16kb", parameterLimit: 50 }),
  );
  app.use(
    "/oauth",
    rotasDeAutorizacao({
      banco,
      config,
      registro,
      resolverCliente:
        deps.resolverCliente ??
        criarResolvedorDeClientes({
          hostsConfiaveis: config.clientesConfiaveis,
        }),
    }),
  );
  app.use("/oauth", rotasDeToken({ banco, config, registro }));

  const handler = createMcpHandler(
    ({ authInfo }) =>
      criarServidorMcp(authInfo, {
        fonte: deps.fonte,
        registro,
        registrarChamada: (chamada) => registrarChamada(banco, chamada),
        agora: deps.agora,
        tempoMaximoMs: deps.tempoMaximoMs,
      }),
    {
      legacy: "stateless",
      onerror: (erro) =>
        registro.aviso("o MCP recusou uma requisição", { erro }),
    },
  );
  const atenderMcp = toNodeHandler(handler, {
    onerror: (erro) => registro.erro("falha no adaptador MCP", { erro }),
  });

  app.all(
    "/mcp",
    requireBearerAuth({
      verifier: criarVerificador({ banco, config, registro }),
      requiredScopes: [ESCOPO_VENDAS],
      resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(config.urlMcp),
    }),
    express.json({ limit: "64kb" }),
    async (req, res) => {
      await atenderMcp(req, res, req.body);
    },
  );

  app.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });
  app.use(tratarErros(registro));

  return { app, handler };
}
