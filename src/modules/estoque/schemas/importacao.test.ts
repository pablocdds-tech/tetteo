import assert from "node:assert/strict";
import { test } from "node:test";

import { analisarPlanilha, separarLocal } from "./importacao";

/**
 * Importar duzentos e sessenta produtos é a operação com maior chance de
 * estragar tudo de uma vez. Cada caso abaixo é um jeito de o cadastro nascer
 * torto — e cadastro torto contamina contagem, CMV e lista de compras.
 */

const CABECALHO =
  "ID\tProduto\tQuantidade\tUnidade\tÚltimo preço\tPreço médio\tEstoque mínimo\tCategorias";

const planilha = (...linhas: string[]) => [CABECALHO, ...linhas].join("\n");

test("separa o lugar escrito dentro do nome", () => {
  assert.deepEqual(separarLocal("coca-cola lata (estoque diário)"), {
    nome: "coca-cola lata",
    local: "Estoque diário",
  });
  assert.deepEqual(separarLocal("mussarela g (praça)"), {
    nome: "mussarela g",
    local: "Praça",
  });
});

test("parêntese que não é lugar continua fazendo parte do nome", () => {
  // Tratar todo parêntese como lugar criaria um local chamado "lata".
  assert.deepEqual(separarLocal("coca-cola (lata)"), {
    nome: "coca-cola (lata)",
    local: "Estoque",
  });
});

test("o mesmo produto em dois lugares vira UM insumo com duas posições", () => {
  const plano = analisarPlanilha(
    planilha(
      "1\tcoca-cola lata (estoque diário)\t25\tund\t2,88\t\t\tESTOQUE DIÁRIO",
      "2\tcoca-cola lata\t24\tund\t2,88\t2,90\t\tBEBIDAS",
    ),
  );

  assert.equal(plano.insumos.length, 1);
  const coca = plano.insumos[0];
  assert.equal(coca.nome, "coca-cola lata");
  assert.equal(coca.posicoes.length, 2);
  assert.equal(
    coca.posicoes.reduce((s, p) => s + p.quantidade, 0),
    49,
  );
  assert.deepEqual(plano.locais.sort(), ["Estoque", "Estoque diário"]);
});

test("mesmo nome com medidas diferentes NÃO é somado", () => {
  // Quilo de mussarela a granel e saquinho porcionado não são a mesma coisa.
  const plano = analisarPlanilha(
    planilha(
      "1\tmussarela (praça)\t16\tund\t20\t\t\tPRODUÇÃO",
      "2\tmussarela\t8\tkg\t38,90\t38,90\t\tLATICÍNIOS",
    ),
  );

  assert.equal(plano.insumos.length, 2);
  assert.ok(
    plano.insumos.some((i) => i.avisos.some((a) => /medida diferente/.test(a))),
  );
});

test("pacote, rolo e bisnaga viram UN com o rótulo preservado", () => {
  const plano = analisarPlanilha(
    planilha(
      "1\tguardanapo\t20\tpct\t1,30\t1,30\t10\tDESCARTÁVEIS",
      "2\tpano multiuso\t0\trl\t99\t\t\tLIMPEZA E HIGIENE",
      "3\tfarinha\t8\tkg\t4,20\t4,20\t\tMERCEARIA",
    ),
  );

  const guardanapo = plano.insumos.find((i) => i.nome === "guardanapo")!;
  assert.equal(guardanapo.unidadeMedida, "UN");
  assert.equal(guardanapo.unidadeRotulo, "pct");
  assert.equal(guardanapo.estoqueMinimo, 10);

  const farinha = plano.insumos.find((i) => i.nome === "farinha")!;
  assert.equal(farinha.unidadeMedida, "KG");
  assert.equal(farinha.unidadeRotulo, null);
});

test("produto sem preço entra, mas avisado", () => {
  const plano = analisarPlanilha(planilha("1\tnoz moscada\t0\tpct\t\t\t\t"));
  assert.equal(plano.insumos.length, 1);
  assert.ok(plano.insumos[0].avisos.some((a) => /Sem preço/.test(a)));
});

test("célula ilegível não derruba as outras linhas", () => {
  const plano = analisarPlanilha(
    planilha(
      "1\tfarinha\tmuito\tkg\t4,20\t\t\tMERCEARIA",
      "2\tcalabresa\t3,5\tkg\t27,50\t\t\tPROTEÍNAS",
    ),
  );

  assert.equal(plano.insumos.length, 2);
  const farinha = plano.insumos.find((i) => i.nome === "farinha")!;
  assert.equal(farinha.posicoes[0].quantidade, 0);
  assert.ok(farinha.avisos.some((a) => /não foi entendido/.test(a)));

  const calabresa = plano.insumos.find((i) => i.nome === "calabresa")!;
  assert.equal(calabresa.posicoes[0].quantidade, 3.5);
});

test("aceita ponto e vírgula além de TAB", () => {
  const texto = [
    "Produto;Quantidade;Unidade;Último preço;Categorias",
    "farinha;8;kg;4,20;MERCEARIA",
  ].join("\n");

  const plano = analisarPlanilha(texto);
  assert.equal(plano.erroGeral, null);
  assert.equal(plano.insumos[0].custoUltimo, 4.2);
});

test("cabeçalho sem a coluna do nome para tudo, com instrução", () => {
  const plano = analisarPlanilha("Quantidade\tUnidade\n8\tkg");
  assert.match(plano.erroGeral ?? "", /Produto|Nome/);
  assert.equal(plano.insumos.length, 0);
});

test("preço zero perde para preço preenchido ao juntar posições", () => {
  // Zero quase sempre é "ninguém preencheu", não "é de graça".
  const plano = analisarPlanilha(
    planilha(
      "1\tcajuína lata (estoque diário)\t18\tund\t0\t\t\tESTOQUE DIÁRIO",
      "2\tcajuína lata\t12\tund\t3,50\t3,40\t\tBEBIDAS",
    ),
  );

  assert.equal(plano.insumos[0].custoUltimo, 3.5);
  assert.equal(plano.insumos[0].custoMedio, 3.4);
});
