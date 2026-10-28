import assert from "node:assert/strict";
import test from "node:test";
import type { QuadroPedidos } from "../pedido-types";
import { quadroCozinha } from "./cozinha";
test("cozinha conserva itens e observações, ordena por preparo e omite dados de cliente e financeiros", () => {
  const base = {
    id: "p1",
    numero: 1,
    versao: 2,
    status: "COZINHA",
    criadoEm: "2026-10-28T00:00:00Z",
    preparoIniciadoEm: null,
    prontoEm: null,
    entrega: { telefone: "PII-TELEFONE" },
    venda: {
      modalidade: "RETIRADA",
      cliente: "PII-NOME",
      totalCentavos: 1000,
      observacao: "Sem cebola",
      itens: [
        {
          nome: "Pizza",
          quantidade: 1,
          observacao: "Bem assada",
          complementos: [
            { grupo: "Borda", nome: "Tradicional", precoCentavos: 100 },
          ],
        },
      ],
    },
  };
  const quadro = {
    pedidos: [
      base,
      {
        ...base,
        id: "p2",
        numero: 2,
        criadoEm: "2026-10-27T23:00:00Z",
        status: "AGUARDANDO_COLETA",
      },
      { ...base, id: "p3", status: "ENTREGUE" },
    ],
    totais: { COZINHA: 1, AGUARDANDO_COLETA: 1 },
  } as unknown as QuadroPedidos;
  const r = quadroCozinha(quadro, new Date("2026-10-28T01:00:00Z"));
  assert.deepEqual(
    r.pedidos.map((p) => p.id),
    ["p2", "p1"],
  );
  assert.equal(r.pedidos[1].observacao, "Sem cebola");
  assert.deepEqual(r.pedidos[1].itens[0].complementos, ["Borda: Tradicional"]);
  assert.equal(r.truncado, false);
  assert.equal(JSON.stringify(r).includes("PII-"), false);
  assert.equal(JSON.stringify(r).includes("Centavos"), false);
  assert.equal(
    quadroCozinha({ ...quadro, totais: { ...quadro.totais, COZINHA: 3 } })
      .truncado,
    true,
  );
});
