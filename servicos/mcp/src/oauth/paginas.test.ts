import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  escaparHtml,
  paginaDeEscolha,
  paginaDeErro,
  paginaDeLogin,
} from "./paginas.js";

const login = {
  pedidoId: "tmcq_x",
  clienteNome: "Claude",
  clienteHost: "claude.ai",
  destino: "claude.ai",
  loopback: false,
};

describe("páginas", () => {
  it("escapa HTML", () => {
    assert.equal(
      escaparHtml(`<a href="x">'&'</a>`),
      "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;",
    );
  });

  it("a tela de login diz quem pede, para onde volta, o que pode e o que não pode", () => {
    const html = paginaDeLogin(login);
    assert.match(html, /claude\.ai/);
    assert.match(html, /Vai poder/);
    assert.match(html, /Não vai poder/);
    assert.match(html, /somente leitura/);
    assert.match(html, /name="pedido" value="tmcq_x"/);
    assert.match(html, /autocomplete="current-password"/);
    assert.ok(!html.includes("Só continue se"));
  });

  it("avisa quando o retorno é o próprio computador", () => {
    assert.match(paginaDeLogin({ ...login, loopback: true }), /Só continue se/);
  });

  it("nunca injeta o que veio de fora", () => {
    const html = paginaDeLogin({
      ...login,
      clienteNome: "<script>alert(1)</script>",
      email: `"><img src=x>`,
      erro: "<b>x</b>",
    });
    assert.ok(!html.includes("<script>alert"));
    assert.ok(!html.includes("<img src=x>"));
    assert.ok(!html.includes("<b>x</b>"));
  });

  it("lista as lojas para escolher e mostra erros", () => {
    const html = paginaDeEscolha({
      pedidoId: "tmcq_x",
      clienteNome: "Claude",
      lojas: [
        { id: "uni_centro", nome: "Vitaliano Centro" },
        { id: "uni_sul", nome: "Vitaliano Zona Sul" },
      ],
    });
    assert.match(html, /value="uni_centro"/);
    assert.match(html, /Vitaliano Zona Sul/);
    assert.match(paginaDeErro({ titulo: "T", mensagem: "M" }), /<h1>T<\/h1>/);
  });
});
