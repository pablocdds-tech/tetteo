import assert from "node:assert/strict";
import { test } from "node:test";
import {
  dividirMensagemNota,
  idDaParte,
  baseDaParte,
  LIMITE_MENSAGEM_NOTA,
} from "./partes-mensagem-nota";
import { mensagemLeituraFiscal } from "./mensagens-leitura-fiscal";
import { extracaoVazia, confiancasDoItem } from "@/server/notas/extracao";

test("mensagens curtas conservam conteúdo e identidade", () => {
  assert.deepEqual(dividirMensagemNota("Dados de uma nota"), [
    "Dados de uma nota",
  ]);
  assert.equal(idDaParte("resposta:teste", 0, 1), "resposta:teste");
});

test("cem itens parciais aparecem em partes numeradas, ordenadas e sem perda de texto", () => {
  const d = extracaoVazia();
  d.razao_social = "Fornecedor fictício";
  d.total_nota = 1000;
  d.itens = Array.from({ length: 100 }, (_, n) => ({
    descricao: `Produto fictício ${n + 1} ${"descrição ".repeat(15)}`,
    quantidade: n === 8 ? null : 1,
    unidade: "UN",
    valor_unitario: 10,
    valor_total: 10,
    codigo_ean: null,
    codigo_fornecedor: null,
    confianca: confiancasDoItem(1),
  }));
  const texto = mensagemLeituraFiscal(d, []);
  const partes = dividirMensagemNota(texto);
  assert.ok(partes.length > 4);
  assert.ok(partes.every((p) => p.length <= LIMITE_MENSAGEM_NOTA));
  assert.equal(
    partes.map((p) => p.replace(/^\*Parte \d+\/\d+\*\n/, "")).join(""),
    texto,
  );
  for (let n = 1; n <= 100; n++)
    assert.ok(texto.includes(`${n}. Produto fictício ${n} `));
  assert.match(texto, /Quantidade: \*pendente\*/);
  assert.match(texto, /Total: R\$\s1\.000,00/);
  assert.match(texto, /Desconto: \*pendente\*/);
  partes.forEach((p, n) =>
    assert.ok(p.startsWith(`*Parte ${n + 1}/${partes.length}*`)),
  );
  assert.equal(
    baseDaParte(idDaParte("leitura:nota:2", 0, partes.length)),
    "leitura:nota:2",
  );
});

test("linhas muito longas e caracteres Unicode não são truncados", () => {
  const original = "Cupom 🧾 ".repeat(4000);
  const partes = dividirMensagemNota(original);
  assert.ok(
    partes.every(
      (p) => p.length <= LIMITE_MENSAGEM_NOTA && !/[\uD800-\uDBFF]$/.test(p),
    ),
  );
  assert.equal(
    partes.map((p) => p.replace(/^\*Parte \d+\/\d+\*\n/, "")).join(""),
    original,
  );
});

test("quantidades e preços unitários conservam as casas decimais extraídas", () => {
  const d = extracaoVazia();
  d.itens = [
    {
      descricao: "Produto fracionado",
      quantidade: 0.123456,
      unidade: "KG",
      valor_unitario: 1.234567,
      valor_total: 0.15,
      codigo_ean: null,
      codigo_fornecedor: null,
      confianca: confiancasDoItem(1),
    },
  ];
  const texto = mensagemLeituraFiscal(d, []);
  assert.match(texto, /Quantidade: 0,123456/);
  assert.match(texto, /Preço unitário: R\$\s1,234567/);
});
