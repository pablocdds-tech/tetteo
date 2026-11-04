import assert from "node:assert/strict";
import test from "node:test";
import { destinoAposLogin } from "./destino-login";

test("login retorna ao checklist e aceita somente a origem oficial", () => {
  assert.equal(
    destinoAposLogin("/checklists/acessar/abc"),
    "/checklists/acessar/abc",
  );
  assert.equal(
    destinoAposLogin("https://app.exemplo.com/checklists/abc", "/", [
      "https://app.exemplo.com",
    ]),
    "/checklists/abc",
  );
  for (const url of [
    "https://malicioso.com/",
    "//malicioso.com",
    "/\\malicioso.com",
    "/%2fmalicioso.com",
    "/%5cmalicioso.com",
    "/login",
    "/api/auth/signin",
    "/\nmalicioso",
  ]) {
    assert.equal(destinoAposLogin(url), "/");
  }
});
