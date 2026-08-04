import assert from "node:assert/strict";
import { test } from "node:test";

import {
  calcularNota,
  conformidadeDoItem,
  impedimentosParaFechar,
  naoConformidades,
  type ItemRespondido,
} from "./pontuacao";

/**
 * A nota é o número que o dono lê para decidir se a loja está sendo cuidada.
 * Cada caso abaixo é uma forma de esse número mentir.
 */

function item(parcial: Partial<ItemRespondido> = {}): ItemRespondido {
  return {
    textoItem: "A câmara fria está limpa?",
    tipo: "SIM_NAO",
    obrigatorio: true,
    conforme: null,
    naoSeAplica: false,
    valorNumero: null,
    valorTexto: null,
    minimo: null,
    maximo: null,
    observacao: null,
    exigeObservacaoSeNao: true,
    ...parcial,
  };
}

test("nota simples: dois de três conformes dá 66,7%", () => {
  const nota = calcularNota([
    item({ conforme: true }),
    item({ conforme: true }),
    item({ conforme: false }),
  ]);

  assert.equal(nota.conformes, 2);
  assert.equal(nota.naoConformes, 1);
  assert.equal(nota.pontuacao, 66.7);
});

test('"não se aplica" sai da conta em vez de valer zero', () => {
  // A loja com um freezer só não perde ponto por não ter o freezer 2.
  const nota = calcularNota([
    item({ conforme: true }),
    item({ naoSeAplica: true }),
  ]);

  assert.equal(nota.naoSeAplica, 1);
  assert.equal(nota.pontuacao, 100);
});

test("item de texto nunca entra na nota", () => {
  // Anotar as observações do turno não pode piorar a nota de quem anotou.
  const nota = calcularNota([
    item({ conforme: true }),
    item({ tipo: "TEXTO", valorTexto: "Faltou gás às 19h" }),
  ]);

  assert.equal(nota.soRegistro, 1);
  assert.equal(nota.pontuacao, 100);
});

test("número SEM faixa é registro; COM faixa vira conformidade", () => {
  const semFaixa = item({ tipo: "NUMERO", valorNumero: -12 });
  assert.equal(conformidadeDoItem(semFaixa), null);

  const dentro = item({ tipo: "NUMERO", valorNumero: -20, maximo: -18 });
  assert.equal(conformidadeDoItem(dentro), true);

  const fora = item({ tipo: "NUMERO", valorNumero: -12, maximo: -18 });
  assert.equal(conformidadeDoItem(fora), false);
});

test("faixa com mínimo e máximo cobra os dois lados", () => {
  const frio = item({ tipo: "NUMERO", valorNumero: 1, minimo: 2, maximo: 8 });
  const quente = item({ tipo: "NUMERO", valorNumero: 9, minimo: 2, maximo: 8 });
  const certo = item({ tipo: "NUMERO", valorNumero: 5, minimo: 2, maximo: 8 });

  assert.equal(conformidadeDoItem(frio), false);
  assert.equal(conformidadeDoItem(quente), false);
  assert.equal(conformidadeDoItem(certo), true);
});

test("checklist só de registro não tem nota — e não inventa uma", () => {
  const nota = calcularNota([
    item({ tipo: "TEXTO", valorTexto: "tudo certo" }),
    item({ tipo: "NUMERO", valorNumero: 4 }),
  ]);

  assert.equal(nota.pontuacao, null);
});

test("item em branco não conta como conforme nem como erro", () => {
  // Fechar sem responder daria 100% para quem não olhou nada.
  const nota = calcularNota([item({ conforme: true }), item()]);

  assert.equal(nota.semResposta, 1);
  assert.equal(nota.pontuacao, 100);
});

test("obrigatório em branco impede fechar", () => {
  const motivos = impedimentosParaFechar([
    item({ textoItem: "Coifa limpa?", obrigatorio: true }),
  ]);

  assert.equal(motivos.length, 1);
  assert.match(motivos[0], /Falta responder: Coifa limpa\?/);
});

test("item opcional em branco não impede nada", () => {
  assert.deepEqual(impedimentosParaFechar([item({ obrigatorio: false })]), []);
});

test('"não" sem explicação impede fechar', () => {
  const motivos = impedimentosParaFechar([
    item({ textoItem: "Coifa limpa?", conforme: false }),
  ]);

  assert.match(motivos[0], /Explique o que houve em: Coifa limpa\?/);
});

test('"não" com explicação fecha normalmente', () => {
  assert.deepEqual(
    impedimentosParaFechar([
      item({ conforme: false, observacao: "Filtro entupido, chamei o Zé" }),
    ]),
    [],
  );
});

test("temperatura fora da faixa também exige explicação", () => {
  const motivos = impedimentosParaFechar([
    item({
      textoItem: "Temperatura do freezer",
      tipo: "NUMERO",
      valorNumero: -8,
      maximo: -18,
    }),
  ]);

  assert.equal(motivos.length, 1);
  assert.match(motivos[0], /Explique o que houve/);
});

test("a pendência nasce com a observação junto — sozinha ela não diz nada", () => {
  const [pendencia] = naoConformidades([
    item({
      textoItem: "Coifa limpa?",
      conforme: false,
      observacao: "Gordura acumulada",
    }),
  ]);

  assert.equal(pendencia.descricao, "Coifa limpa? — Gordura acumulada");
});

test("pendência de temperatura carrega a leitura que a gerou", () => {
  const [pendencia] = naoConformidades([
    item({
      textoItem: "Temperatura do freezer",
      tipo: "NUMERO",
      valorNumero: -8,
      maximo: -18,
      observacao: "Porta ficou aberta",
    }),
  ]);

  assert.equal(
    pendencia.descricao,
    "Temperatura do freezer (leitura: -8) — Porta ficou aberta",
  );
});

test("só o que está não conforme vira pendência", () => {
  const pendencias = naoConformidades([
    item({ conforme: true }),
    item({ naoSeAplica: true }),
    item({ conforme: false, observacao: "quebrado" }),
  ]);

  assert.equal(pendencias.length, 1);
});
