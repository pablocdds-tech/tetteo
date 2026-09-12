import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ESCOPO_VENDAS, escoposConcedidos } from "./escopos.js";
import { metadadosDoEmissor } from "./metadados.js";
import {
  descreverDestino,
  redirecionamentoPermitido,
} from "./redirecionamento.js";
import {
  desafioDe,
  desafioValido,
  ehDoTipo,
  gerarSegredo,
  impressaoDigital,
  pkceConfere,
} from "./segredos.js";

describe("segredos", () => {
  it("gera chaves com prefixo, 256 bits e sem repetir", () => {
    const a = gerarSegredo("acesso");
    const b = gerarSegredo("acesso");
    assert.match(a, /^tmcp_[A-Za-z0-9_-]{43}$/);
    assert.notEqual(a, b);
    assert.ok(ehDoTipo(a, "acesso"));
    assert.ok(!ehDoTipo(a, "renovacao"));
    assert.match(gerarSegredo("renovacao"), /^tmcr_/);
    assert.match(gerarSegredo("codigo"), /^tmcc_/);
    assert.match(gerarSegredo("pedido"), /^tmcq_/);
  });

  it("guarda só a impressão digital, sempre igual para o mesmo segredo", () => {
    const segredo = gerarSegredo("codigo");
    assert.match(impressaoDigital(segredo), /^[0-9a-f]{64}$/);
    assert.equal(impressaoDigital(segredo), impressaoDigital(segredo));
    assert.ok(!impressaoDigital(segredo).includes(segredo));
  });

  it("confere o PKCE S256 com o exemplo da RFC 7636", () => {
    const verificador = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const desafio = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
    assert.equal(desafioDe(verificador), desafio);
    assert.ok(desafioValido(desafio));
    assert.ok(pkceConfere(verificador, desafio));
    assert.ok(!pkceConfere(`${verificador}x`, desafio));
    assert.ok(!pkceConfere("curto", desafio));
    assert.ok(!desafioValido("plain-nao-serve"));
  });
});

describe("escopos", () => {
  it("concede vendas:ler quando nada é pedido", () => {
    assert.deepEqual(escoposConcedidos(undefined), [ESCOPO_VENDAS]);
    assert.deepEqual(escoposConcedidos(""), [ESCOPO_VENDAS]);
  });

  it("descarta o que não existe aqui e recusa quando nada sobra", () => {
    assert.deepEqual(escoposConcedidos("vendas:ler offline_access"), [
      ESCOPO_VENDAS,
    ]);
    assert.equal(escoposConcedidos("pedidos:escrever"), null);
  });
});

describe("redirecionamento", () => {
  const claude = "https://claude.ai/api/mcp/auth_callback";
  const codigo = ["http://localhost/callback", "http://127.0.0.1/callback"];

  it("exige igualdade exata fora do loopback", () => {
    assert.ok(redirecionamentoPermitido(claude, [claude]));
    assert.ok(!redirecionamentoPermitido(`${claude}x`, [claude]));
    assert.ok(!redirecionamentoPermitido("https://evil.example/cb", [claude]));
  });

  it("ignora a porta no loopback, como pede a RFC 8252", () => {
    assert.ok(
      redirecionamentoPermitido("http://127.0.0.1:3118/callback", codigo),
    );
    assert.ok(
      redirecionamentoPermitido("http://localhost:51000/callback", codigo),
    );
    assert.ok(
      !redirecionamentoPermitido("http://127.0.0.1:3118/outro", codigo),
    );
  });

  it("recusa http fora do loopback, fragmento e lixo", () => {
    assert.ok(
      !redirecionamentoPermitido("http://claude.ai/cb", [
        "http://claude.ai/cb",
      ]),
    );
    assert.ok(!redirecionamentoPermitido(`${claude}#x`, [`${claude}#x`]));
    assert.ok(!redirecionamentoPermitido("não é url", [claude]));
  });

  it("descreve o destino para a tela de consentimento", () => {
    assert.equal(descreverDestino(claude), "claude.ai");
    assert.match(
      descreverDestino("http://127.0.0.1:3118/callback"),
      /este computador/,
    );
  });
});

describe("metadados", () => {
  it("anuncia CIMD, cliente público e PKCE S256", () => {
    const m = metadadosDoEmissor({ emissor: "https://mcp.exemplo.com.br" });
    assert.equal(m.issuer, "https://mcp.exemplo.com.br");
    assert.equal(m.token_endpoint, "https://mcp.exemplo.com.br/oauth/token");
    assert.equal(m.client_id_metadata_document_supported, true);
    assert.deepEqual(m.token_endpoint_auth_methods_supported, ["none"]);
    assert.deepEqual(m.code_challenge_methods_supported, ["S256"]);
    assert.deepEqual(m.scopes_supported, ["vendas:ler"]);
    assert.equal("registration_endpoint" in m, false);
  });
});
