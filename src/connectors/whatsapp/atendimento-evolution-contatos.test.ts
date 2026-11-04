import assert from "node:assert/strict";
import test from "node:test";
import type { LiveChannelConfig } from "@/server/atendimento-provedor";
import { evolutionAttendance } from "./atendimento-evolution";
import {
  lookupEvolutionContactNames,
  normalizeEvolutionContactNames,
} from "./atendimento-evolution-contatos";

const config: Extract<LiveChannelConfig, { provider: "EVOLUTION" }> = {
  organizationId: "org-ficticia",
  storeId: "unidade-ficticia",
  accountId: "conta-ficticia",
  revision: 1,
  name: "Contatos fictícios Kairu",
  active: false,
  provider: "EVOLUTION",
  settings: { url: "https://provider.invalid", instance: "sv-ficticia" },
  secrets: { apiKey: "private-fake-key" },
};
const expected = {
  instanceId: "provider-instance-ficticia",
  trustedPhone: "+12025550123",
};
const contact = {
  instanceId: expected.instanceId,
  remoteJid: "12025550123@s.whatsapp.net",
  fullName: "Ana do contato",
  pushName: "Aninha",
  updatedAt: "2026-11-04T01:00:00.000Z",
};
const metadata = () =>
  Response.json([
    {
      id: expected.instanceId,
      name: config.settings.instance,
      token: "private-provider-token",
    },
  ]);

test("consulta nome apenas no telefone e UUID da instância exatos e retorna metadados mínimos", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async (url, init) => {
      calls++;
      assert.equal(
        (init?.headers as Record<string, string>).apikey,
        "private-fake-key",
      );
      assert.equal(init?.redirect, "error");
      if (calls === 1) {
        assert.equal(
          String(url),
          "https://provider.invalid/instance/fetchInstances?instanceName=sv-ficticia",
        );
        return metadata();
      }
      assert.equal(
        String(url),
        "https://provider.invalid/chat/findContacts/sv-ficticia",
      );
      assert.equal(init?.method, "POST");
      assert.deepEqual(JSON.parse(String(init?.body)), {
        where: { remoteJid: "12025550123@s.whatsapp.net" },
        page: 1,
        offset: 2,
      });
      return Response.json([
        {
          ...contact,
          profilePicUrl: "https://private.invalid/photo",
          token: "private-contact-token",
          notes: "private-internal-note",
        },
      ]);
    };
    const result = await evolutionAttendance(config).lookupContactNames!({
      trustedPhone: expected.trustedPhone,
    });
    assert.deepEqual(result, {
      trustedPhone: expected.trustedPhone,
      names: [
        {
          name: "Ana do contato",
          source: "DEVICE_CONTACT",
          updatedAt: contact.updatedAt,
        },
        {
          name: "Aninha",
          source: "PROVIDER_CONTACT",
          updatedAt: contact.updatedAt,
        },
      ],
    });
    assert.equal(calls, 2);
    assert.doesNotMatch(
      JSON.stringify(result),
      /private|instanceId|profilePicUrl|notes|token/,
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("pushName da API 2.3.7 não prova agenda nem nickname e data inválida permanece desconhecida", () => {
  const value = normalizeEvolutionContactNames(
    [{ ...contact, fullName: undefined, isSaved: true, updatedAt: "invalid" }],
    expected,
  );
  assert.deepEqual(value.names, [
    { name: "Aninha", source: "PROVIDER_CONTACT", updatedAt: null },
  ]);
  assert.deepEqual(normalizeEvolutionContactNames([], expected).names, []);
});

test("nomes de outra instância, pessoa, grupo, broadcast ou LID não são associados", () => {
  for (const invalid of [
    { ...contact, instanceId: "foreign-instance" },
    { ...contact, remoteJid: "12025550124@s.whatsapp.net" },
    { ...contact, remoteJid: "12025550123@g.us" },
    { ...contact, remoteJid: "12025550123@lid" },
    { ...contact, remoteJid: "status@broadcast" },
    { ...contact, isGroup: true },
  ])
    assert.deepEqual(
      normalizeEvolutionContactNames([invalid], expected).names,
      [],
    );
  assert.throws(
    () => normalizeEvolutionContactNames([contact, contact], expected),
    /EVOLUTION_CONTACT_RESPONSE_INVALID/,
  );
});

test("campos vazios, extensos ou com controles não viram nome e duplicatas são ambíguas", () => {
  for (const invalid of [
    " ",
    "x".repeat(161),
    "Ana\ncontrole",
    "Ana\0controle",
  ])
    assert.deepEqual(
      normalizeEvolutionContactNames(
        [{ ...contact, fullName: invalid, pushName: invalid }],
        expected,
      ).names,
      [],
    );
  assert.equal(
    normalizeEvolutionContactNames(
      [{ ...contact, fullName: " Ana 🌻 ", pushName: null }],
      expected,
    ).names[0].name,
    "Ana 🌻",
  );
  assert.throws(
    () =>
      normalizeEvolutionContactNames(
        { error: true, message: "private-token" },
        expected,
      ),
    /^Error: EVOLUTION_CONTACT_RESPONSE_INVALID$/,
  );
});

test("consulta rejeita telefone digitado sem identidade canônica e campos extras antes de acessar rede", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls++;
      throw new Error("must not run");
    };
    for (const query of [
      { trustedPhone: "2025550123" },
      { trustedPhone: "Ana" },
      { trustedPhone: "+12025550123", tenantId: "foreign" },
      { trustedPhone: "+12025550123\n" },
    ])
      await assert.rejects(
        lookupEvolutionContactNames(config, query),
        /^Error: EVOLUTION_CONTACT_QUERY_INVALID$/,
      );
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = original;
  }
});

test("metadados de instância divergentes bloqueiam findContacts e erros não expõem segredos", async () => {
  const original = globalThis.fetch;
  try {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return Response.json([
        { id: "foreign", name: "other-instance", token: "private-token" },
      ]);
    };
    await assert.rejects(
      lookupEvolutionContactNames(config, {
        trustedPhone: expected.trustedPhone,
      }),
      /^Error: EVOLUTION_CONTACT_LOOKUP_UNAVAILABLE$/,
    );
    assert.equal(calls, 1);
    globalThis.fetch = async (url) =>
      String(url).includes("fetchInstances")
        ? metadata()
        : Response.json({ error: true, message: "private-provider-detail" });
    await assert.rejects(
      lookupEvolutionContactNames(config, {
        trustedPhone: expected.trustedPhone,
      }),
      /^Error: EVOLUTION_CONTACT_LOOKUP_UNAVAILABLE$/,
    );
    calls = 0;
    globalThis.fetch = async () => {
      calls++;
      throw new Error("private-api-key");
    };
    await assert.rejects(
      lookupEvolutionContactNames(config, {
        trustedPhone: expected.trustedPhone,
      }),
      /^Error: EVOLUTION_CONTACT_LOOKUP_UNAVAILABLE$/,
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});
