import assert from "node:assert/strict";
import test from "node:test";
import { esquemaCancelar } from "./venda";
import {
  diaPedidos,
  esquemaMoverPedido,
  periodoPedidos,
  proximaEtapa,
  validarTransicaoPedido,
} from "./pedido";

test("entrega segue cozinha, coleta, saída e entrega sem atalhos", () => {
  assert.equal(proximaEtapa("COZINHA", "ENTREGA"), "AGUARDANDO_COLETA");
  assert.equal(proximaEtapa("AGUARDANDO_COLETA", "ENTREGA"), "SAIU_ENTREGA");
  assert.equal(proximaEtapa("SAIU_ENTREGA", "ENTREGA"), "ENTREGUE");
  assert.throws(
    () => validarTransicaoPedido("COZINHA", "ENTREGUE", "ENTREGA"),
    /não é permitida/,
  );
  assert.throws(
    () => validarTransicaoPedido("AGUARDANDO_COLETA", "ENTREGUE", "ENTREGA"),
    /não é permitida/,
  );
});
test("balcão e retirada entregam depois da coleta sem etapa de motoboy", () => {
  for (const modalidade of ["BALCAO", "RETIRADA"]) {
    assert.equal(proximaEtapa("AGUARDANDO_COLETA", modalidade), "ENTREGUE");
    assert.throws(
      () =>
        validarTransicaoPedido("AGUARDANDO_COLETA", "SAIU_ENTREGA", modalidade),
      /não é permitida/,
    );
    assert.throws(
      () => validarTransicaoPedido("COZINHA", "ENTREGUE", modalidade),
      /não é permitida/,
    );
  }
});
test("estados terminais não retrocedem e cancelamento não passa na ação de mover", () => {
  assert.equal(proximaEtapa("ENTREGUE", "ENTREGA"), null);
  assert.equal(proximaEtapa("CANCELADO", "BALCAO"), null);
  assert.throws(
    () => validarTransicaoPedido("ENTREGUE", "AGUARDANDO_COLETA", "ENTREGA"),
    /não é permitida/,
  );
  assert.equal(
    esquemaMoverPedido.safeParse({
      pedidoId: "p",
      versao: 1,
      destino: "CANCELADO",
    }).success,
    false,
  );
  assert.equal(
    esquemaMoverPedido.safeParse({
      pedidoId: "p",
      versao: 1,
      destino: "COZINHA",
    }).success,
    false,
  );
});
test("cancelamento financeiro pede identificação e versão juntas quando vem do quadro", () => {
  const base = { vendaId: "v", motivo: "Cancelamento fictício" };
  assert.equal(esquemaCancelar.safeParse(base).success, true);
  assert.equal(
    esquemaCancelar.safeParse({ ...base, pedidoId: "p" }).success,
    false,
  );
  assert.equal(
    esquemaCancelar.safeParse({ ...base, versaoPedido: 1 }).success,
    false,
  );
  assert.equal(
    esquemaCancelar.safeParse({ ...base, pedidoId: "p", versaoPedido: 1 })
      .success,
    true,
  );
});
test("dia do quadro é São Paulo e intervalos não dependem do fuso do servidor", () => {
  assert.equal(diaPedidos(new Date("2026-10-27T01:30:00Z")), "2026-10-26");
  const intervalo = periodoPedidos("2026-10-27");
  assert.equal(intervalo.inicio.toISOString(), "2026-10-27T03:00:00.000Z");
  assert.equal(intervalo.fim.toISOString(), "2026-10-28T03:00:00.000Z");
  assert.throws(() => periodoPedidos("2026-02-30"), /data válida/);
  assert.equal(
    periodoPedidos("2100-12-31").fim.toISOString(),
    "2101-01-01T03:00:00.000Z",
  );
});
test("intervalo histórico respeita a mudança de horário de verão em São Paulo", () => {
  const intervalo = periodoPedidos("2018-11-04");
  assert.equal(intervalo.inicio.toISOString(), "2018-11-04T03:00:00.000Z");
  assert.equal(intervalo.fim.toISOString(), "2018-11-05T02:00:00.000Z");
});
