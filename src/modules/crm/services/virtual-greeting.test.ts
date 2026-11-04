import assert from "node:assert/strict";
import test from "node:test";
import { virtualGreetingPrefix } from "./virtual-greeting";

test("saudação mantém o prefixo existente e saneia espaços e controles no nome", () => {
  assert.equal(virtualGreetingPrefix("Ana"), "Olá, Ana. ");
  assert.equal(
    virtualGreetingPrefix("  Ana\u200b Silva\n"),
    "Olá, Ana Silva. ",
  );
});

test("nome ausente ou ambíguo preserva a saudação genérica sem expor sugestão", () => {
  assert.equal(virtualGreetingPrefix(), "");
  assert.equal(virtualGreetingPrefix("Nome sugerido", false), "");
  assert.equal(
    `${virtualGreetingPrefix(undefined)}Olá! Como posso ajudar?`,
    "Olá! Como posso ajudar?",
  );
});

test("apelido inválido, placeholder, URL e credencial não entram na saudação", () => {
  for (const name of [
    "Cliente do WhatsApp",
    "+12025550123",
    "https://example.invalid",
    "token=credencial-ficticia",
    "<script>",
  ])
    assert.equal(virtualGreetingPrefix(name), "");
});
