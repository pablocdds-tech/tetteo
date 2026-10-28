import assert from "node:assert/strict";
import test from "node:test";
import {
  esquemaLayoutPedidos,
  LAYOUT_PEDIDOS_PADRAO,
  lerLayoutPedidos,
} from "./layout-pedidos";

test("preferências recuperam layout válido e ignoram armazenamento corrompido ou de outra versão", () => {
  const layout = { ...LAYOUT_PEDIDOS_PADRAO, modo: "KANBAN" as const };
  assert.deepEqual(lerLayoutPedidos(JSON.stringify(layout)), layout);
  for (const texto of [
    null,
    "{",
    "{}",
    JSON.stringify({ ...layout, versao: 2 }),
    JSON.stringify({ ...layout, cliente: "dado indevido" }),
  ])
    assert.equal(lerLayoutPedidos(texto), LAYOUT_PEDIDOS_PADRAO);
});
test("layout nunca oculta etapas em andamento nem aceita estados duplicados ou inexistentes", () => {
  assert.equal(
    esquemaLayoutPedidos.safeParse({
      ...LAYOUT_PEDIDOS_PADRAO,
      distribuicao: {
        ...LAYOUT_PEDIDOS_PADRAO.distribuicao,
        COZINHA: "OCULTO",
      },
    }).success,
    false,
  );
  assert.equal(
    esquemaLayoutPedidos.safeParse({
      ...LAYOUT_PEDIDOS_PADRAO,
      visiveis: ["AGENDADO", "ENTREGUE", "CANCELADO"],
    }).success,
    false,
  );
  assert.equal(
    esquemaLayoutPedidos.safeParse({
      ...LAYOUT_PEDIDOS_PADRAO,
      visiveis: [...LAYOUT_PEDIDOS_PADRAO.visiveis, "COZINHA"],
    }).success,
    false,
  );
  assert.equal(
    esquemaLayoutPedidos.safeParse({
      ...LAYOUT_PEDIDOS_PADRAO,
      distribuicao: { ...LAYOUT_PEDIDOS_PADRAO.distribuicao, INVENTADO: "1" },
    }).success,
    false,
  );
});
