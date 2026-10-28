import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  ambienteDaRequisicao,
  configurarDominios,
  destinoEntreAmbientes,
  redirecionamentoAutenticacao,
} from "./dominios-publicos";

const config = configurarDominios(
  "https://app.example.com",
  "https://pdv.example.com",
  "/pdv",
)!;
const host = (valor: string, encaminhado?: string) =>
  new Headers({
    host: valor,
    ...(encaminhado ? { "x-forwarded-host": encaminhado } : {}),
  });

describe("domínios integrados", () => {
  test("a instalação sem domínio operacional conserva as rotas e os hosts atuais", () => {
    assert.equal(configurarDominios("http://localhost:3000"), null);
    assert.equal(
      ambienteDaRequisicao(host("localhost:3000"), null),
      "principal",
    );
    assert.equal(
      destinoEntreAmbientes(null, "principal", "/pdv", "", "GET"),
      null,
    );
  });

  test("configuração exige duas origens distintas HTTPS e uma rota raiz", () => {
    for (const url of [
      "http://pdv.example.com",
      "https://u:p@pdv.example.com",
      "https://pdv.example.com/caminho",
      "https://pdv.example.com?x=1",
      "https://pdv.example.com#x",
      config.principal,
    ])
      assert.throws(() => configurarDominios(config.principal, url, "/pdv"));
    for (const rota of [
      undefined,
      "/",
      "//evil.example",
      "/pdv/novo",
      "/pdv?x=1",
    ])
      assert.throws(() =>
        configurarDominios(config.principal, config.operacional, rota),
      );
    assert.throws(() =>
      configurarDominios(undefined, config.operacional, "/pdv"),
    );
    assert.ok(
      configurarDominios(
        "http://localhost:3010",
        "http://pdv.localhost:3010",
        "/pdv",
      ),
    );
  });

  test("só hosts exatos, incluindo porta, são reconhecidos", () => {
    assert.equal(
      ambienteDaRequisicao(host("APP.EXAMPLE.COM", "app.example.com"), config),
      "principal",
    );
    assert.equal(
      ambienteDaRequisicao(host("pdv.example.com"), config),
      "operacional",
    );
    for (const valor of [
      "evil.example",
      "pdv.example.com.evil.example",
      "pdv.example.com:3000",
      "pdv.example.com,evil.example",
      "pdv.example.com.",
    ])
      assert.equal(ambienteDaRequisicao(host(valor), config), null);
    assert.equal(ambienteDaRequisicao(new Headers(), config), null);
    assert.equal(
      ambienteDaRequisicao(host("pdv.example.com", "evil.example"), config),
      null,
    );
    assert.equal(
      ambienteDaRequisicao(host("evil.example", "pdv.example.com"), config),
      null,
    );
  });

  test("endereços antigos e impressão abrem no novo ambiente com filtros intactos", () => {
    for (const caminho of ["/pdv", "/pdv/vendas", "/pdv/imprimir/venda"])
      for (const metodo of ["GET", "HEAD"])
        assert.deepEqual(
          destinoEntreAmbientes(
            config,
            "principal",
            caminho,
            "?visao=AGENDADOS",
            metodo,
          ),
          { url: `https://pdv.example.com${caminho}?visao=AGENDADOS` },
        );
    assert.equal(
      destinoEntreAmbientes(config, "principal", "/pdv-vizinho", "", "GET"),
      null,
    );
  });

  test("um atendimento antigo aberto nunca tem seu POST redirecionado entre origens", () => {
    assert.equal(
      destinoEntreAmbientes(
        config,
        "principal",
        "/pdv/novo-pedido",
        "",
        "POST",
      ),
      null,
    );
  });

  test("a raiz operacional leva diretamente à gestão e as rotas compartilhadas continuam disponíveis", () => {
    assert.deepEqual(
      destinoEntreAmbientes(config, "operacional", "/", "", "GET"),
      { url: "https://pdv.example.com/pdv" },
    );
    for (const caminho of [
      "/pdv",
      "/pdv/caixa",
      "/conta",
      "/login",
      "/api/crm/atendimento/clientes",
      "/api/arquivos/id",
    ])
      for (const metodo of ["GET", "POST"])
        assert.equal(
          destinoEntreAmbientes(config, "operacional", caminho, "", metodo),
          null,
        );
  });

  test("administração volta ao Tetteo sem transportar escritas ou liberar APIs vizinhas", () => {
    assert.deepEqual(
      destinoEntreAmbientes(
        config,
        "operacional",
        "/cardapio/fichas",
        "?busca=pizza",
        "GET",
      ),
      { url: "https://app.example.com/cardapio/fichas?busca=pizza" },
    );
    assert.deepEqual(
      destinoEntreAmbientes(config, "operacional", "/estoque", "", "POST"),
      { status: 403 },
    );
    assert.deepEqual(
      destinoEntreAmbientes(config, "operacional", "/", "", "POST"),
      { status: 403 },
    );
    for (const caminho of [
      "/api/financeiro",
      "/api/crm/campaigns",
      "/api/crm-vizinho",
      "/api/arquivos-vizinho",
      "/api",
    ])
      assert.deepEqual(
        destinoEntreAmbientes(config, "operacional", caminho, "", "GET"),
        { status: 404 },
      );
  });

  test("retorno do login aceita apenas as origens configuradas e recusa redirecionamento aberto", () => {
    assert.equal(
      redirecionamentoAutenticacao(
        "/pdv?visao=AGENDADOS",
        config.operacional,
        config,
      ),
      "https://pdv.example.com/pdv?visao=AGENDADOS",
    );
    assert.equal(
      redirecionamentoAutenticacao(
        `${config.principal}/conta`,
        config.operacional,
        config,
      ),
      `${config.principal}/conta`,
    );
    for (const url of [
      "//evil.example/pdv",
      "https://pdv.example.com.evil.example",
      "javascript:alert(1)",
      "https://user@pdv.example.com/pdv",
      "https://pdv.example.com:444/pdv",
      "http://pdv.example.com",
    ])
      assert.equal(
        redirecionamentoAutenticacao(url, config.operacional, config),
        config.operacional,
      );
    assert.equal(
      redirecionamentoAutenticacao("/conta", "https://evil.example", config),
      `${config.principal}/conta`,
    );
    assert.equal(
      redirecionamentoAutenticacao(
        "https://evil.example",
        config.principal,
        null,
      ),
      config.principal,
    );
  });
});
