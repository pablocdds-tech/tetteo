import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  calcularPedido,
  calcularVenda,
  conferirPagamentos,
  esquemaFinalizar,
} from "./venda";
import { esquemaReceber } from "./recebimento";

const produto = {
  id: "p",
  nome: "Produto",
  categoria: "Bebidas",
  codigo: "1",
  precoCentavos: 2500,
  grupos: [],
};
const itens = [{ produtoId: "p", quantidade: 2, opcoes: [], observacao: "" }];
const base = {
  chave: randomUUID(),
  caixaId: "c",
  modalidade: "BALCAO",
  observacao: "",
  itens,
  descontoCentavos: 0,
  taxaCentavos: 0,
};
test("pagamento pendente é explícito, vazio e não acrescenta default ao payload legado", () => {
  const legado = esquemaFinalizar.parse({
    ...base,
    pagamentos: [{ forma: "PIX", valorCentavos: 5000 }],
  });
  assert.equal(Object.hasOwn(legado, "pagamentoPendente"), false);
  assert.equal(
    esquemaFinalizar.safeParse({ ...base, pagamentos: [] }).success,
    false,
  );
  assert.equal(
    esquemaFinalizar.safeParse({
      ...base,
      pagamentoPendente: false,
      pagamentos: [],
    }).success,
    false,
  );
  assert.equal(
    esquemaFinalizar.safeParse({
      ...base,
      pagamentoPendente: true,
      pagamentos: [],
    }).success,
    true,
  );
  assert.equal(
    esquemaFinalizar.safeParse({
      ...base,
      pagamentoPendente: true,
      pagamentos: [{ forma: "DINHEIRO", valorCentavos: 5000 }],
    }).success,
    false,
  );
});
test("preço do pedido é calculado sem pagamento e a função antiga continua compatível", () => {
  const pedido = calcularPedido([produto], itens, 200, 100);
  assert.equal(pedido.totalCentavos, 4900);
  assert.equal(pedido.subtotalCentavos, 5000);
  assert.equal("trocoCentavos" in pedido, false);
  const paga = calcularVenda([produto], itens, 200, 100, [
    { forma: "DINHEIRO", valorCentavos: 5000 },
  ]);
  assert.deepEqual(paga, { ...pedido, trocoCentavos: 100 });
});
test("recebimento integral usa total congelado, aceita divisão e só dá troco em dinheiro", () => {
  assert.deepEqual(
    conferirPagamentos(5000, [
      { forma: "PIX", valorCentavos: 2000 },
      { forma: "DINHEIRO", valorCentavos: 4000 },
    ]),
    { trocoCentavos: 1000 },
  );
  assert.throws(
    () => conferirPagamentos(5000, [{ forma: "CREDITO", valorCentavos: 6000 }]),
    /Troco/,
  );
  assert.throws(
    () => conferirPagamentos(5000, [{ forma: "PIX", valorCentavos: 4000 }]),
    /falta/,
  );
  assert.throws(
    () => conferirPagamentos(5000, [{ forma: "DINHEIRO", valorCentavos: -1 }]),
    /valores/,
  );
  assert.throws(
    () => conferirPagamentos(5000, [{ forma: "DINHEIRO", valorCentavos: 1.5 }]),
    /valores/,
  );
});
test("entrada do recebimento exige versão e pagamentos positivos, não aceita preço ou endereço do navegador", () => {
  const entrada = {
    vendaId: "v",
    versaoFinanceira: 1,
    chave: randomUUID(),
    caixaId: "c",
    pagamentos: [{ forma: "PIX", valorCentavos: 5000 }],
  };
  assert.equal(esquemaReceber.safeParse(entrada).success, true);
  assert.equal(
    esquemaReceber.safeParse({ ...entrada, pagamentos: [] }).success,
    false,
  );
  assert.equal(
    esquemaReceber.safeParse({ ...entrada, versaoFinanceira: 0 }).success,
    false,
  );
  assert.equal(
    esquemaReceber.safeParse({ ...entrada, totalCentavos: 100 }).success,
    false,
  );
  assert.equal(
    esquemaReceber.safeParse({
      ...entrada,
      entrega: { logradouro: "não permitido" },
    }).success,
    false,
  );
});
