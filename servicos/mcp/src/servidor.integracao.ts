import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";

import { chavesPara, subirAmbiente, type Ambiente } from "./ensaio/ambiente.js";
import { urlDeEnsaio } from "./ensaio/banco-de-ensaio.js";
import { PESSOAS } from "./ensaio/semente.js";
import { criarFonteFicticia, pedidosFicticios } from "./fontes/ficticia.js";
import type { FonteDeVendas } from "./fontes/tipos.js";

const pular = urlDeEnsaio()
  ? false
  : "defina MCP_ENSAIO_PG_URL (Postgres local) para rodar";

describe("servidor completo, de ponta a ponta", { skip: pular }, () => {
  let ambiente: Ambiente;
  let fonteQuebrada = false;
  const chavesEmitidas: string[] = [];

  // Uma fonte que o teste consegue quebrar no meio do caminho.
  const ficticia = criarFonteFicticia();
  const fonte: FonteDeVendas = {
    nome: "ficticia",
    ehFicticia: true,
    vendasDoDia: (consulta, sinal) =>
      fonteQuebrada
        ? Promise.reject(new Error("conexão recusada em 10.0.0.5:5432"))
        : ficticia.vendasDoDia(consulta, sinal),
  };

  before(async () => {
    ambiente = await subirAmbiente({ fonte });
  });

  after(async () => {
    await ambiente?.encerrar();
  });

  async function chaves(email?: string, unidade?: string) {
    const par = await chavesPara(ambiente, email, unidade);
    chavesEmitidas.push(par.accessToken, par.refreshToken);
    return par;
  }

  async function conectar(token: string, modo: "legacy" | "auto") {
    const cliente = new Client(
      { name: "ensaio", version: "1.0.0" },
      { versionNegotiation: { mode: modo } },
    );
    await cliente.connect(
      new StreamableHTTPClientTransport(new URL("/mcp", ambiente.base), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    return cliente;
  }

  const mcp = (
    cabecalhos: Record<string, string>,
    corpo: unknown,
    metodo = "POST",
  ) =>
    fetch(new URL("/mcp", ambiente.base), {
      method: metodo,
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...cabecalhos,
      },
      body: metodo === "POST" ? JSON.stringify(corpo) : undefined,
    });

  const inicializar = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "curl", version: "1" },
    },
  };

  for (const [modo, versao] of [
    ["legacy", "2025-11-25"],
    ["auto", "2026-07-28"],
  ] as const) {
    it(`inicializa, lista e chama vendas_do_dia (protocolo ${versao})`, async () => {
      const { accessToken } = await chaves();
      const cliente = await conectar(accessToken, modo);
      assert.equal(cliente.getNegotiatedProtocolVersion(), versao);

      const { tools } = await cliente.listTools();
      assert.deepEqual(
        tools.map((t) => t.name),
        ["vendas_do_dia"],
      );

      const resultado = await cliente.callTool({
        name: "vendas_do_dia",
        arguments: { data: "2026-09-10" },
      });
      await cliente.close();

      // A "fonte original": os mesmos pedidos fictícios, somados por fora.
      const pedidos = pedidosFicticios({
        unidadeId: "uni_centro",
        data: "2026-09-10",
      });
      const dados = resultado.structuredContent as Record<string, unknown>;
      assert.equal(dados.quantidade_vendas, pedidos.length);
      assert.equal(
        dados.total_centavos,
        pedidos.reduce((soma, pedido) => soma + pedido.valorCentavos, 0),
      );
      assert.equal(dados.fonte, "ficticia");
    });
  }

  it("data inválida e data futura voltam como erro de ferramenta", async () => {
    const { accessToken } = await chaves();
    const cliente = await conectar(accessToken, "legacy");
    for (const data of ["10/09/2026", "2026-09-12"]) {
      const resultado = await cliente.callTool({
        name: "vendas_do_dia",
        arguments: { data },
      });
      assert.equal(resultado.isError, true, data);
    }
    await cliente.close();
  });

  it("fonte quebrada vira isError sem vazar detalhe, e o processo segue de pé", async () => {
    const { accessToken } = await chaves();
    const cliente = await conectar(accessToken, "legacy");
    fonteQuebrada = true;
    const resultado = await cliente.callTool({
      name: "vendas_do_dia",
      arguments: { data: "2026-09-10" },
    });
    fonteQuebrada = false;
    await cliente.close();

    assert.equal(resultado.isError, true);
    assert.ok(!JSON.stringify(resultado).includes("10.0.0.5"));
    assert.equal((await fetch(new URL("/health", ambiente.base))).status, 200);
  });

  it("sem chave: 401 que leva o cliente à descoberta do login", async () => {
    const resposta = await mcp({}, inicializar);
    assert.equal(resposta.status, 401);
    const desafio = resposta.headers.get("www-authenticate") ?? "";
    assert.ok(
      desafio.includes(
        `resource_metadata="${ambiente.base}/.well-known/oauth-protected-resource/mcp"`,
      ),
    );
    assert.match(desafio, /scope="vendas:ler"/);
  });

  it("publica os dois documentos de descoberta", async () => {
    for (const caminho of [
      "/.well-known/oauth-protected-resource/mcp",
      "/.well-known/oauth-protected-resource",
    ]) {
      const recurso = (await (
        await fetch(new URL(caminho, ambiente.base))
      ).json()) as { resource?: string; authorization_servers?: string[] };
      assert.equal(recurso.resource, `${ambiente.base}/mcp`);
      assert.deepEqual(recurso.authorization_servers, [ambiente.base]);
    }
    const emissor = (await (
      await fetch(
        new URL("/.well-known/oauth-authorization-server", ambiente.base),
      )
    ).json()) as Record<string, unknown>;
    assert.equal(emissor.issuer, ambiente.base);
    assert.equal(emissor.client_id_metadata_document_supported, true);
    assert.deepEqual(emissor.code_challenge_methods_supported, ["S256"]);
  });

  it("GET /mcp responde 405: não há sessão para abrir", async () => {
    const { accessToken } = await chaves();
    const resposta = await mcp(
      { Authorization: `Bearer ${accessToken}` },
      null,
      "GET",
    );
    assert.equal(resposta.status, 405);
  });

  it("corpo acima de 64 KB: 413 com chave, 401 sem chave (a chave vem antes do corpo)", async () => {
    const { accessToken } = await chaves();
    const grande = { ...inicializar, lixo: "x".repeat(70 * 1024) };
    assert.equal(
      (await mcp({ Authorization: `Bearer ${accessToken}` }, grande)).status,
      413,
    );
    assert.equal((await mcp({}, grande)).status, 401);
  });

  it("Host ou Origin estranhos: 403", async () => {
    const saude = new URL("/health", ambiente.base);
    // fetch não deixa trocar o Host; o teste usa http.request.
    const { request } = await import("node:http");
    const status = await new Promise<number>((pronto, falha) => {
      request(saude, { headers: { host: "evil.example" } }, (resposta) => {
        resposta.resume();
        pronto(resposta.statusCode ?? 0);
      })
        .on("error", falha)
        .end();
    });
    assert.equal(status, 403);
    assert.equal(
      (await fetch(saude, { headers: { origin: "https://evil.example" } }))
        .status,
      403,
    );
  });

  it("/health responde sem nada sensível", async () => {
    const resposta = await fetch(new URL("/health", ambiente.base));
    const corpo = (await resposta.json()) as Record<string, unknown>;
    assert.deepEqual(Object.keys(corpo).sort(), [
      "banco",
      "servico",
      "status",
      "versao",
    ]);
    assert.equal(corpo.banco, "ok");
    assert.ok(!JSON.stringify(corpo).includes("postgres"));
  });

  it("registra as chamadas no banco", async () => {
    const { rows } = await ambiente.ensaio.admin.query(
      "SELECT resultado, count(*)::int AS n FROM mcp.chamada GROUP BY resultado",
    );
    const contagem = Object.fromEntries(
      (rows as { resultado: string; n: number }[]).map((l) => [
        l.resultado,
        l.n,
      ]),
    );
    assert.ok((contagem.ok ?? 0) >= 2);
    assert.ok((contagem.erro ?? 0) >= 1);
  });

  it("pessoa suspensa no Tetteo perde o acesso na chamada seguinte", async () => {
    const { accessToken } = await chaves(PESSOAS.dono, "uni_sul");
    const cabecalho = { Authorization: `Bearer ${accessToken}` };
    assert.equal((await mcp(cabecalho, inicializar)).status, 200);
    await ambiente.ensaio.admin.query(
      `UPDATE usuario SET status = 'SUSPENSO' WHERE id = 'usr_dono'`,
    );
    assert.equal((await mcp(cabecalho, inicializar)).status, 401);
  });

  it("nenhuma chave, código ou senha aparece nos logs", () => {
    const logs = ambiente.linhasDeLog.join("\n");
    assert.ok(ambiente.linhasDeLog.length > 10);
    for (const chave of chavesEmitidas) assert.ok(!logs.includes(chave));
    assert.ok(!/tmc[pcrq]_[A-Za-z0-9_-]{20}/.test(logs));
    assert.ok(!logs.includes("senha-de-ensaio"));

    const caminhos = ambiente.linhasDeLog
      .map((linha) => JSON.parse(linha) as { caminho?: string })
      .flatMap((linha) => (linha.caminho ? [linha.caminho] : []));
    assert.ok(caminhos.includes("/oauth/authorize"));
    assert.ok(
      caminhos.every((caminho) => !caminho.includes("?")),
      "nenhuma query string registrada",
    );
  });
});
