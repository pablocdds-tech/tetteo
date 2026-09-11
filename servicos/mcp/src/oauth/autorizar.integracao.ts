import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

import express from "express";

import { criarBanco, type Banco } from "../banco/conexao.js";
import { prepararTabelas } from "../banco/tabelas.js";
import { lerConfig } from "../config.js";
import {
  criarBancoDeEnsaio,
  urlDeEnsaio,
  type BancoDeEnsaio,
} from "../ensaio/banco-de-ensaio.js";
import { PESSOAS, SENHA_DE_ENSAIO, semear } from "../ensaio/semente.js";
import { registroSilencioso } from "../registro.js";
import { ErroDeCliente, type ResolverCliente } from "./cliente.js";
import { rotasDeAutorizacao } from "./rotas-autorizar.js";
import { desafioDe } from "./segredos.js";

const pular = urlDeEnsaio()
  ? false
  : "defina MCP_ENSAIO_PG_URL (Postgres local) para rodar";

const CLIENTE = "https://claude.ai/oauth/ensaio";
const RETORNO = "http://127.0.0.1:4555/callback";
const DESAFIO = desafioDe("v".repeat(50));

describe("/oauth/authorize", { skip: pular }, () => {
  let ensaio: BancoDeEnsaio;
  let banco: Banco;
  let base: string;
  let fecharServidor: () => void;
  let nomeDoCliente = "Claude de ensaio";

  const resolverCliente: ResolverCliente = async (clientId) => {
    if (clientId !== CLIENTE) throw new ErroDeCliente("Cliente desconhecido.");
    return {
      clientId,
      nome: nomeDoCliente,
      redirectUris: ["http://127.0.0.1/callback"],
    };
  };

  before(async () => {
    ensaio = await criarBancoDeEnsaio();
    await semear(ensaio.admin);
    banco = criarBanco(ensaio.urlDoServico, registroSilencioso);
    await prepararTabelas(banco);
    const config = lerConfig({
      DATABASE_URL: ensaio.urlDoServico,
      MCP_URL_PUBLICA: "http://127.0.0.1:9",
    });
    const app = express();
    app.use("/oauth", express.urlencoded({ extended: false, limit: "16kb" }));
    app.use(
      "/oauth",
      rotasDeAutorizacao({
        banco,
        config,
        resolverCliente,
        registro: registroSilencioso,
      }),
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

  function urlDeAutorizacao(extra: Record<string, string> = {}) {
    const url = new URL("/oauth/authorize", base);
    const parametros = {
      response_type: "code",
      client_id: CLIENTE,
      redirect_uri: RETORNO,
      code_challenge: DESAFIO,
      code_challenge_method: "S256",
      state: "estado-123",
      scope: "vendas:ler",
      resource: "http://127.0.0.1:9/mcp",
      ...extra,
    };
    for (const [chave, valor] of Object.entries(parametros)) {
      if (valor !== "") url.searchParams.set(chave, valor);
    }
    return url;
  }

  async function abrirPedido(extra: Record<string, string> = {}) {
    const resposta = await fetch(urlDeAutorizacao(extra), {
      redirect: "manual",
    });
    const html = await resposta.text();
    const pedido = /name="pedido" value="([^"]+)"/.exec(html)?.[1];
    return { resposta, html, pedido };
  }

  const enviar = (campos: Record<string, string>) =>
    fetch(new URL("/oauth/authorize", base), {
      method: "POST",
      body: new URLSearchParams(campos),
      redirect: "manual",
    });

  it("mostra a tela com as travas de página", async () => {
    const { resposta, html, pedido } = await abrirPedido();
    assert.equal(resposta.status, 200);
    assert.match(pedido ?? "", /^tmcq_/);
    assert.match(html, /Claude de ensaio/);
    assert.match(html, /este computador/);
    const csp = resposta.headers.get("content-security-policy") ?? "";
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /form-action 'self' http:\/\/127\.0\.0\.1:4555/);
    assert.equal(resposta.headers.get("x-frame-options"), "DENY");
    assert.equal(resposta.headers.get("cache-control"), "no-store");
  });

  it("cliente desconhecido ou retorno estranho: página de erro, sem redirecionar", async () => {
    for (const extra of [
      { client_id: "https://evil.example/c" },
      { redirect_uri: "https://evil.example/cb" },
      { client_id: "" },
    ] as Record<string, string>[]) {
      const { resposta } = await abrirPedido(extra);
      assert.equal(resposta.status, 400);
      assert.equal(resposta.headers.get("location"), null);
    }
  });

  it("sem PKCE, com escopo inexistente ou outro recurso: devolve o erro ao cliente", async () => {
    for (const [extra, erro] of [
      [{ code_challenge: "" }, "invalid_request"],
      [{ code_challenge_method: "plain" }, "invalid_request"],
      [{ scope: "pedidos:escrever" }, "invalid_scope"],
      [{ resource: "https://outro.example/mcp" }, "invalid_target"],
      [{ response_type: "token" }, "unsupported_response_type"],
    ] as const) {
      const { resposta } = await abrirPedido(extra);
      assert.equal(resposta.status, 303);
      const destino = new URL(resposta.headers.get("location") ?? "");
      assert.equal(destino.origin, "http://127.0.0.1:4555");
      assert.equal(destino.searchParams.get("error"), erro);
      assert.equal(destino.searchParams.get("state"), "estado-123");
    }
  });

  it("gerente com a senha certa recebe o código direto (uma loja só)", async () => {
    const { pedido } = await abrirPedido();
    const resposta = await enviar({
      pedido: pedido!,
      acao: "autorizar",
      email: PESSOAS.gerente,
      senha: SENHA_DE_ENSAIO,
    });
    assert.equal(resposta.status, 303);
    const destino = new URL(resposta.headers.get("location") ?? "");
    assert.match(destino.searchParams.get("code") ?? "", /^tmcc_/);
    assert.equal(destino.searchParams.get("state"), "estado-123");
    assert.equal(destino.searchParams.get("iss"), "http://127.0.0.1:9");

    // O pedido foi consumido: não serve de novo.
    const deNovo = await enviar({
      pedido: pedido!,
      acao: "autorizar",
      email: PESSOAS.gerente,
      senha: SENHA_DE_ENSAIO,
    });
    assert.equal(deNovo.status, 400);
  });

  it("senha errada, pessoa suspensa e caixa sem permissão não recebem código", async () => {
    for (const [email, senha, status] of [
      [PESSOAS.gerente, "errada", 401],
      [PESSOAS.suspenso, SENHA_DE_ENSAIO, 401],
      [PESSOAS.caixa, SENHA_DE_ENSAIO, 403],
    ] as const) {
      const { pedido } = await abrirPedido();
      const resposta = await enviar({
        pedido: pedido!,
        acao: "autorizar",
        email,
        senha,
      });
      assert.equal(resposta.status, status, email);
      assert.equal(resposta.headers.get("location"), null);
    }
  });

  it("dono com duas lojas escolhe uma, e loja fora da lista é recusada", async () => {
    const { pedido } = await abrirPedido();
    const escolha = await enviar({
      pedido: pedido!,
      acao: "autorizar",
      email: PESSOAS.dono,
      senha: SENHA_DE_ENSAIO,
    });
    assert.equal(escolha.status, 200);
    const html = await escolha.text();
    assert.match(html, /Vitaliano Centro/);
    assert.match(html, /Vitaliano Zona Sul/);
    assert.ok(!html.includes("Loja Fechada"));

    const fechada = await enviar({
      pedido: pedido!,
      acao: "autorizar",
      unidade: "uni_fechada",
    });
    assert.equal(fechada.status, 400);

    const certa = await enviar({
      pedido: pedido!,
      acao: "autorizar",
      unidade: "uni_sul",
    });
    assert.equal(certa.status, 303);
    assert.match(certa.headers.get("location") ?? "", /code=tmcc_/);
  });

  it("cancelar devolve access_denied", async () => {
    const { pedido } = await abrirPedido();
    const resposta = await enviar({ pedido: pedido!, acao: "cancelar" });
    const destino = new URL(resposta.headers.get("location") ?? "");
    assert.equal(destino.searchParams.get("error"), "access_denied");
  });

  it("pedido inventado é recusado", async () => {
    const resposta = await enviar({
      pedido: "tmcq_inventado",
      acao: "autorizar",
      email: PESSOAS.gerente,
      senha: SENHA_DE_ENSAIO,
    });
    assert.equal(resposta.status, 400);
  });

  it("depois de 10 falhas o e-mail fica bloqueado por 15 minutos", async () => {
    for (let i = 0; i < 10; i++) {
      const { pedido } = await abrirPedido();
      await enviar({
        pedido: pedido!,
        acao: "autorizar",
        email: PESSOAS.dono,
        senha: `errada-${i}`,
      });
    }
    const { pedido } = await abrirPedido();
    const resposta = await enviar({
      pedido: pedido!,
      acao: "autorizar",
      email: PESSOAS.dono,
      senha: SENHA_DE_ENSAIO,
    });
    assert.equal(resposta.status, 429);
  });

  it("escapa o nome do cliente", async () => {
    nomeDoCliente = "<script>alert(1)</script>";
    const { html } = await abrirPedido();
    nomeDoCliente = "Claude de ensaio";
    assert.ok(!html.includes("<script>alert"));
  });
});
