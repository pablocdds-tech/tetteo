import test from "node:test";
import assert from "node:assert/strict";
import { readCrmBody, validCrmOrigin } from "./request";
import { Router } from "./http-router";
import { crmSegment, normalizeBrazilPhone } from "./domain";

test("CRM: corpo JSON limitado mesmo sem Content-Length", async () => {
  const req = (body: string) =>
    new Request("https://crm.example/api/crm/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
  assert.deepEqual(await readCrmBody(req('{"name":"Ana"}')), { name: "Ana" });
  await assert.rejects(readCrmBody(req("{broken")), /JSON inválido/);
  await assert.rejects(readCrmBody(req("a".repeat(1024 * 1024 + 1))), /excede/);
});
test("CRM: proteção de origem e normalização", () => {
  const old = process.env.AUTH_URL;
  process.env.AUTH_URL = "https://crm.example";
  try {
    const req = (origin: string) =>
      new Request("http://localhost/api/crm/contacts", { headers: { origin } });
    assert.equal(validCrmOrigin(req("https://crm.example")), true);
    assert.equal(validCrmOrigin(req("https://attacker.example")), false);
    assert.equal(validCrmOrigin(new Request("https://crm.example")), false);
  } finally {
    if (old === undefined) delete process.env.AUTH_URL;
    else process.env.AUTH_URL = old;
  }
  assert.equal(normalizeBrazilPhone("(11) 99999-1234"), "5511999991234");
  assert.throws(() => normalizeBrazilPhone("123"));
  const now = new Date("2026-10-26T12:00:00Z");
  assert.equal(crmSegment(0, null, now), "LEAD");
  assert.equal(
    crmSegment(2, new Date(now.getTime() - 90 * 86_400_000), now),
    "LOST",
  );
});
test("CRM: roteamento distingue detalhes e ações e preserva status", async () => {
  const router = Router();
  router.get("/contacts/:id", (req, res) =>
    res.status(201).json({ id: req.params.id }),
  );
  const base = {
    user: {
      userId: "u",
      role: "ATTENDANT" as const,
      storeIds: ["s"],
      permissions: ["crm.ver"],
    },
    query: {},
    params: {},
    body: undefined,
    method: "GET",
    path: "/contacts/c",
    header: () => undefined,
  };
  const response = await router.dispatch(base);
  assert.equal(response?.status, 201);
  assert.deepEqual(await response?.json(), { id: "c" });
  assert.equal(
    await router.dispatch({ ...base, path: "/contacts/c/sales" }),
    null,
  );
});
