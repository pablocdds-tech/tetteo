import assert from "node:assert/strict";
import { test } from "node:test";

import { podeVer, situacaoDoLink } from "./link";

const agora = new Date("2026-09-10T15:00:00Z");
const valido = {
  expiraEm: new Date("2026-09-12T15:00:00Z"),
  revogadoEm: null,
  tentativasInvalidas: 0,
  versoes: 1,
  ultimoEnvioEm: new Date("2026-09-10T14:00:00Z"),
  rodadaEmCotacao: true,
};

test("link em dia é válido", () => {
  assert.equal(situacaoDoLink(valido, agora), "valido");
});

test("vencido", () => {
  assert.equal(
    situacaoDoLink({ ...valido, expiraEm: new Date("2026-09-10T14:59:59Z") }, agora),
    "vencido",
  );
  assert.equal(situacaoDoLink({ ...valido, expiraEm: null }, agora), "vencido");
});

test("revogado vence qualquer outra situação", () => {
  assert.equal(
    situacaoDoLink({ ...valido, revogadoEm: agora, tentativasInvalidas: 50 }, agora),
    "revogado",
  );
});

test("dez envios inválidos bloqueiam", () => {
  assert.equal(situacaoDoLink({ ...valido, tentativasInvalidas: 10 }, agora), "bloqueado");
  assert.equal(situacaoDoLink({ ...valido, tentativasInvalidas: 9 }, agora), "valido");
});

test("rodada fora de cotação não aceita proposta", () => {
  assert.equal(situacaoDoLink({ ...valido, rodadaEmCotacao: false }, agora), "encerrado");
});

test("limite de versões e o intervalo entre envios", () => {
  const limite = situacaoDoLink({ ...valido, versoes: 30 }, agora);
  assert.equal(limite, "limite");
  assert.ok(podeVer(limite));

  const aguarde = situacaoDoLink(
    { ...valido, ultimoEnvioEm: new Date("2026-09-10T14:59:55Z") },
    agora,
  );
  assert.equal(aguarde, "aguarde");
  assert.ok(podeVer(aguarde));
  assert.equal(podeVer("vencido"), false);
});
