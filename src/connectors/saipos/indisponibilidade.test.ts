import test from "node:test";
import assert from "node:assert/strict";
import { codigoConexao } from "./indisponibilidade";

test("diagnóstico de erro guarda somente códigos de conexão conhecidos e limita o corpo lido", async () => {
  for (const code of ["PGRST000", "PGRST001", "PGRST002", "PGRST003"])
    assert.equal(
      await codigoConexao(
        new Response(JSON.stringify({ code, message: "privado" })),
      ),
      code,
    );
  assert.equal(
    await codigoConexao(new Response(JSON.stringify({ code: "PGRST301" }))),
    null,
  );
  assert.equal(
    await codigoConexao(new Response("<html>indisponível</html>")),
    null,
  );
  assert.equal(
    await codigoConexao(
      new Response(
        JSON.stringify({ code: "PGRST003", message: "x".repeat(5000) }),
      ),
    ),
    null,
  );
});
