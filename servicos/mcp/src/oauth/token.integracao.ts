import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

import {
  getOAuthProtectedResourceMetadataUrl,
  requireBearerAuth,
} from "@modelcontextprotocol/express";
import express from "express";

import { criarBanco, type Banco } from "../banco/conexao.js";
import { prepararTabelas } from "../banco/tabelas.js";
import { lerConfig } from "../config.js";
import {
  criarBancoDeEnsaio,
  urlDeEnsaio,
  type BancoDeEnsaio,
} from "../ensaio/banco-de-ensaio.js";
import { obterCodigo, pedirChaves } from "../ensaio/fluxo.js";
import { PESSOAS, SENHA_DE_ENSAIO, semear } from "../ensaio/semente.js";
import { registroSilencioso } from "../registro.js";
import type { ResolverCliente } from "./cliente.js";
import { rotasDeAutorizacao } from "./rotas-autorizar.js";
import { rotasDeToken } from "./rotas-token.js";
import { criarVerificador } from "./verificador.js";

const pular = urlDeEnsaio()
  ? false
  : "defina MCP_ENSAIO_PG_URL (Postgres local) para rodar";

const CLIENTE = "https://claude.ai/oauth/ensaio";
const RETORNO = "https://claude.ai/api/mcp/auth_callback";
const VERIFICADOR = "a".repeat(64);
const RECURSO = "http://127.0.0.1:9/mcp";

describe("/oauth/token, /oauth/revoke e o verificador", { skip: pular }, () => {
  let ensaio: BancoDeEnsaio;
  let banco: Banco;
  let base: string;
  let fecharServidor: () => void;

  before(async () => {
    ensaio = await criarBancoDeEnsaio();
    await semear(ensaio.admin);
    banco = criarBanco(ensaio.urlDoServico, registroSilencioso);
    await prepararTabelas(banco);
    const config = lerConfig({
      DATABASE_URL: ensaio.urlDoServico,
      MCP_URL_PUBLICA: "http://127.0.0.1:9",
    });
    const resolverCliente: ResolverCliente = async (clientId) => ({
      clientId,
      nome: "Claude",
      redirectUris: [RETORNO],
    });
    const deps = { banco, config, registro: registroSilencioso };

    const app = express();
    app.use("/oauth", express.urlencoded({ extended: false, limit: "16kb" }));
    app.use("/oauth", rotasDeAutorizacao({ ...deps, resolverCliente }));
    app.use("/oauth", rotasDeToken(deps));
    app.get(
      "/protegido",
      requireBearerAuth({
        verifier: criarVerificador(deps),
        requiredScopes: ["vendas:ler"],
        resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(
          config.urlMcp,
        ),
      }),
      (req, res) => {
        res.json(req.auth?.extra);
      },
    );
    const servidor = app.listen(0);
    await new Promise((pronto) => servidor.once("listening", pronto));
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
    fecharServidor = () => servidor.close();
  });

  after(async () => {
    fecharServidor?.();
    await banco?.end();
    await ensaio?.encerrar();
  });

  const codigo = () =>
    obterCodigo(base, {
      email: PESSOAS.gerente,
      senha: SENHA_DE_ENSAIO,
      clientId: CLIENTE,
      redirectUri: RETORNO,
      verificador: VERIFICADOR,
      recurso: RECURSO,
    });

  const trocar = async (extra: Record<string, string> = {}) =>
    pedirChaves(base, {
      grant_type: "authorization_code",
      code: await codigo(),
      redirect_uri: RETORNO,
      client_id: CLIENTE,
      code_verifier: VERIFICADOR,
      resource: RECURSO,
      ...extra,
    });

  const protegido = (cabecalhos: Record<string, string> = {}, sufixo = "") =>
    fetch(new URL(`/protegido${sufixo}`, base), { headers: cabecalhos });

  it("troca o código por chaves no formato da RFC 6749", async () => {
    const { status, corpo, resposta } = await trocar();
    assert.equal(status, 200);
    assert.equal(corpo.token_type, "Bearer");
    assert.equal(corpo.expires_in, 3600);
    assert.equal(corpo.scope, "vendas:ler");
    assert.match(String(corpo.access_token), /^tmcp_/);
    assert.match(String(corpo.refresh_token), /^tmcr_/);
    assert.equal(resposta.headers.get("cache-control"), "no-store");

    const liberado = await protegido({
      Authorization: `Bearer ${corpo.access_token}`,
    });
    assert.equal(liberado.status, 200);
    const extra = (await liberado.json()) as { unidadeId?: string };
    assert.equal(extra.unidadeId, "uni_centro");
  });

  it("sem chave: 401 com resource_metadata e escopo no WWW-Authenticate", async () => {
    const resposta = await protegido();
    assert.equal(resposta.status, 401);
    const desafio = resposta.headers.get("www-authenticate") ?? "";
    assert.match(
      desafio,
      /resource_metadata="http:\/\/127\.0\.0\.1:9\/\.well-known\/oauth-protected-resource\/mcp"/,
    );
    assert.match(desafio, /scope="vendas:ler"/);
  });

  it("chave na URL não vale, e chave de renovação não abre a porta", async () => {
    const { corpo } = await trocar();
    assert.equal(
      (await protegido({}, `?access_token=${corpo.access_token}`)).status,
      401,
    );
    assert.equal(
      (await protegido({ Authorization: `Bearer ${corpo.refresh_token}` }))
        .status,
      401,
    );
  });

  it("recusa verificador errado, JSON, grant desconhecido e outro recurso", async () => {
    assert.equal(
      (await trocar({ code_verifier: "b".repeat(64) })).corpo.error,
      "invalid_grant",
    );
    assert.equal(
      (await trocar({ resource: "https://outro/mcp" })).corpo.error,
      "invalid_target",
    );
    assert.equal(
      (await pedirChaves(base, { grant_type: "password", client_id: CLIENTE }))
        .corpo.error,
      "unsupported_grant_type",
    );
    const json = await fetch(new URL("/oauth/token", base), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant_type: "authorization_code" }),
    });
    assert.equal(json.status, 400);
    const erro = (await json.json()) as { error?: string };
    assert.equal(erro.error, "invalid_request");
  });

  it("renova trocando a chave; reusar a antiga derruba a nova", async () => {
    const primeira = (await trocar()).corpo;
    const renovada = await pedirChaves(base, {
      grant_type: "refresh_token",
      refresh_token: String(primeira.refresh_token),
      client_id: CLIENTE,
    });
    assert.equal(renovada.status, 200);
    const nova = renovada.corpo;
    assert.equal(
      (await protegido({ Authorization: `Bearer ${nova.access_token}` }))
        .status,
      200,
    );

    const reuso = await pedirChaves(base, {
      grant_type: "refresh_token",
      refresh_token: String(primeira.refresh_token),
      client_id: CLIENTE,
    });
    assert.equal(reuso.status, 400);
    assert.equal(reuso.corpo.error, "invalid_grant");
    assert.equal(
      (await protegido({ Authorization: `Bearer ${nova.access_token}` }))
        .status,
      401,
    );
  });

  it("revogar corta o acesso, e revogar chave desconhecida responde 200", async () => {
    const { corpo } = await trocar();
    const revogar = (token: string) =>
      fetch(new URL("/oauth/revoke", base), {
        method: "POST",
        body: new URLSearchParams({ token, client_id: CLIENTE }),
      });
    assert.equal((await revogar(String(corpo.refresh_token))).status, 200);
    assert.equal(
      (await protegido({ Authorization: `Bearer ${corpo.access_token}` }))
        .status,
      401,
    );
    assert.equal((await revogar("tmcr_desconhecida")).status, 200);
  });
});
