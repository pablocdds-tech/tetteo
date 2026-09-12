import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  criarResolvedorDeClientes,
  ErroDeCliente,
  type BuscarDocumento,
} from "./cliente.js";

const CLAUDE_CODE = "https://claude.ai/oauth/claude-code-client-metadata";

const documento = {
  client_id: CLAUDE_CODE,
  client_name: "Claude Code",
  redirect_uris: ["http://localhost/callback", "http://127.0.0.1/callback"],
  token_endpoint_auth_method: "none",
};

function buscarQueDevolve(corpo: unknown, status = 200) {
  const chamadas: string[] = [];
  const buscar: BuscarDocumento = async (url) => {
    chamadas.push(url.href);
    const texto = typeof corpo === "string" ? corpo : JSON.stringify(corpo);
    return new Response(texto, { status });
  };
  return { buscar, chamadas };
}

const hostsConfiaveis = ["claude.ai", "claude.com"];

describe("resolvedor de clientes (CIMD)", () => {
  it("aceita a identificação publicada pelo Claude", async () => {
    const { buscar } = buscarQueDevolve(documento);
    const cliente = await criarResolvedorDeClientes({
      hostsConfiaveis,
      buscar,
    })(CLAUDE_CODE);

    assert.equal(cliente.clientId, CLAUDE_CODE);
    assert.equal(cliente.nome, "Claude Code");
    assert.deepEqual(cliente.redirectUris, documento.redirect_uris);
  });

  it("recusa host fora da lista SEM buscar nada na rede", async () => {
    const { buscar, chamadas } = buscarQueDevolve(documento);
    const resolver = criarResolvedorDeClientes({ hostsConfiaveis, buscar });

    await assert.rejects(
      resolver("https://evil.example/cliente.json"),
      ErroDeCliente,
    );
    await assert.rejects(resolver("http://claude.ai/x"), ErroDeCliente);
    await assert.rejects(resolver("https://claude.ai/"), ErroDeCliente);
    await assert.rejects(resolver("não é url"), ErroDeCliente);
    assert.equal(chamadas.length, 0);
  });

  it("recusa documento que não é dele mesmo", async () => {
    const { buscar } = buscarQueDevolve({
      ...documento,
      client_id: "https://claude.ai/outro",
    });
    await assert.rejects(
      criarResolvedorDeClientes({ hostsConfiaveis, buscar })(CLAUDE_CODE),
      /não corresponde/,
    );
  });

  it("recusa cliente com segredo, documento incompleto, não-JSON e erro HTTP", async () => {
    const casos: [unknown, number][] = [
      [
        { ...documento, token_endpoint_auth_method: "client_secret_basic" },
        200,
      ],
      [{ ...documento, token_endpoint_auth_method: undefined }, 200],
      [{ client_id: CLAUDE_CODE }, 200],
      ["<html>", 200],
      [documento, 404],
    ];
    for (const [corpo, status] of casos) {
      const { buscar } = buscarQueDevolve(corpo, status);
      await assert.rejects(
        criarResolvedorDeClientes({ hostsConfiaveis, buscar })(CLAUDE_CODE),
        ErroDeCliente,
      );
    }
  });

  it("recusa documento maior que 64 KB", async () => {
    const { buscar } = buscarQueDevolve({
      ...documento,
      client_name: "x".repeat(70 * 1024),
    });
    await assert.rejects(
      criarResolvedorDeClientes({ hostsConfiaveis, buscar })(CLAUDE_CODE),
      /grande demais/,
    );
  });

  it("transforma falha de rede em ErroDeCliente", async () => {
    const buscar: BuscarDocumento = async () => {
      throw new TypeError("redirect");
    };
    await assert.rejects(
      criarResolvedorDeClientes({ hostsConfiaveis, buscar })(CLAUDE_CODE),
      ErroDeCliente,
    );
  });

  it("guarda o documento por um tempo e busca de novo depois", async () => {
    const { buscar, chamadas } = buscarQueDevolve(documento);
    let relogio = 0;
    const resolver = criarResolvedorDeClientes({
      hostsConfiaveis,
      buscar,
      validadeMs: 1000,
      agora: () => relogio,
    });

    await resolver(CLAUDE_CODE);
    await resolver(CLAUDE_CODE);
    assert.equal(chamadas.length, 1);

    relogio = 1001;
    await resolver(CLAUDE_CODE);
    assert.equal(chamadas.length, 2);
  });
});
