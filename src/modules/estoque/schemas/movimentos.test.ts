import assert from "node:assert/strict";
import { test } from "node:test";

import {
  compararContagem,
  efeitoNoSaldo,
  ehSaidaReal,
  resumirPerdas,
  type ItemDaContagem,
  type MovimentoParaResumo,
} from "./movimentos";

/**
 * Duas coisas que o Estoque não sabia fazer: diminuir, e admitir que errou.
 */

function item(p: Partial<ItemDaContagem> = {}): ItemDaContagem {
  return {
    insumoId: "i1",
    nome: "Mussarela",
    esperado: 40,
    contado: 40,
    custoUnitario: 32,
    ...p,
  };
}

function mov(p: Partial<MovimentoParaResumo> = {}): MovimentoParaResumo {
  return {
    tipo: "PERDA",
    quantidade: 1,
    custoUnitario: 32,
    motivo: null,
    insumo: "Mussarela",
    categoria: null,
    ...p,
  };
}

test("transferência não some da loja — só muda de prateleira", () => {
  // Tratá-la como saída faria o total encolher toda vez que alguém descesse
  // caixa do depósito para a geladeira.
  assert.equal(ehSaidaReal("TRANSFERENCIA"), false);
  assert.equal(ehSaidaReal("PERDA"), true);
  assert.equal(ehSaidaReal("CONSUMO_INTERNO"), true);
});

test("o ajuste grava um valor — não soma nem subtrai", () => {
  assert.equal(efeitoNoSaldo("ENTRADA"), 1);
  assert.equal(efeitoNoSaldo("PERDA"), -1);
  assert.equal(efeitoNoSaldo("AJUSTE"), 0);
});

test("item NÃO contado fica fora do ajuste", () => {
  // Em branco é "não olhei". Tratar como zero mandaria o estoque inteiro para
  // o ajuste quando alguém contasse só a praça.
  const r = compararContagem([
    item({ contado: null }),
    item({
      insumoId: "i2",
      nome: "Farinha",
      esperado: 10,
      contado: 8,
      custoUnitario: 4,
    }),
  ]);

  assert.equal(r.naoContados, 1);
  assert.equal(r.divergencias.length, 1);
  assert.equal(r.divergencias[0].nome, "Farinha");
});

test("o que bate não vira divergência", () => {
  const r = compararContagem([item(), item({ insumoId: "i2" })]);
  assert.equal(r.divergencias.length, 0);
  assert.equal(r.liquido, 0);
});

test("sumiço e sobra são somados separados, e o líquido mostra a dor", () => {
  const r = compararContagem([
    item({ esperado: 40, contado: 35 }), // −5 kg × 32 = −160
    item({
      insumoId: "i2",
      nome: "Farinha",
      esperado: 10,
      contado: 12,
      custoUnitario: 4,
    }), // +8
  ]);

  assert.equal(r.valorFaltando, 160);
  assert.equal(r.valorSobrando, 8);
  assert.equal(r.liquido, -152);
});

test("a ordem é por DINHEIRO, não por quantidade", () => {
  // Senão "300 guardanapos" apareceria acima de "2 kg de picanha".
  const r = compararContagem([
    item({
      insumoId: "g",
      nome: "Guardanapo",
      esperado: 1000,
      contado: 700,
      custoUnitario: 0.02,
    }),
    item({
      insumoId: "p",
      nome: "Picanha",
      esperado: 10,
      contado: 8,
      custoUnitario: 90,
    }),
  ]);

  assert.equal(r.divergencias[0].nome, "Picanha");
  assert.equal(r.divergencias[0].valor, -180);
  assert.equal(r.divergencias[1].valor, -6);
});

test("perda soma quantidade × custo congelado", () => {
  const r = resumirPerdas([
    mov({ quantidade: 2, custoUnitario: 32 }),
    mov({ quantidade: 1.5, custoUnitario: 32 }),
  ]);

  assert.equal(r.total, 112);
});

test("transferência e ajuste não entram no resumo de perdas", () => {
  // Misturar ajuste com desperdício transformaria erro de contagem em lixo, e
  // ninguém saberia mais qual é qual.
  const r = resumirPerdas([
    mov({ quantidade: 1, custoUnitario: 32 }),
    mov({ tipo: "TRANSFERENCIA", quantidade: 10, custoUnitario: 32 }),
    mov({ tipo: "AJUSTE", quantidade: 5, custoUnitario: 32 }),
    mov({ tipo: "ENTRADA", quantidade: 20, custoUnitario: 32 }),
  ]);

  assert.equal(r.total, 32);
});

test("o resumo quebra por tipo, insumo e motivo com percentual", () => {
  const r = resumirPerdas([
    mov({
      quantidade: 3,
      custoUnitario: 30,
      motivo: "câmara fria com defeito",
    }),
    mov({
      tipo: "CONSUMO_INTERNO",
      quantidade: 1,
      custoUnitario: 10,
      insumo: "Refrigerante",
    }),
  ]);

  assert.equal(r.total, 100);
  assert.equal(r.porTipo[0].chave, "Perda");
  assert.equal(r.porTipo[0].percentual, 90);
  assert.equal(r.porMotivo[0].chave, "câmara fria com defeito");
  assert.equal(r.porInsumo[1].chave, "Refrigerante");
});

test("perda sem motivo vira uma linha visível, não some", () => {
  // Ver o tamanho dessa linha é o que faz alguém passar a escrever o motivo.
  const r = resumirPerdas([
    mov({ quantidade: 1, custoUnitario: 50, motivo: "  " }),
  ]);

  assert.equal(r.porMotivo[0].chave, "sem motivo");
  assert.equal(r.porMotivo[0].valor, 50);
});

test("sem perda nenhuma não existe percentual — e não dá divisão por zero", () => {
  const r = resumirPerdas([mov({ tipo: "TRANSFERENCIA" })]);
  assert.equal(r.total, 0);
  assert.deepEqual(r.porTipo, []);
});
