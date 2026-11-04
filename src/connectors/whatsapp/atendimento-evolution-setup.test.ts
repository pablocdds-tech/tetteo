import assert from "node:assert/strict";
import test from "node:test";
import { evolutionAttendance } from "./atendimento-evolution";
import type { LiveChannelConfig } from "@/server/atendimento-provedor";

const config: Extract<LiveChannelConfig, { provider: "EVOLUTION" }> = {
  organizationId: "org-ficticia",
  storeId: "unidade-ficticia",
  accountId: "conta-ficticia",
  revision: 1,
  active: false,
  name: "WhatsApp fictício Kairu",
  provider: "EVOLUTION",
  settings: { url: "https://provider.invalid", instance: "sv-ficticia" },
  secrets: {
    apiKey: "private-fake-key",
    webhookSecret: "private-fake-webhook",
  },
};

test("preparar conexão reutiliza instância existente sem solicitar outra criação", async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  try {
    globalThis.fetch = async (url, init) => {
      calls.push(`${init?.method} ${String(url)}`);
      return Response.json({ instance: { state: "close" } });
    };
    await evolutionAttendance(config).ensureInstance!();
    assert.deepEqual(calls, [
      "GET https://provider.invalid/instance/connectionState/sv-ficticia",
    ]);
  } finally {
    globalThis.fetch = original;
  }
});

test("somente ausência confirmada cria instância e repetição consulta antes de criar", async () => {
  const original = globalThis.fetch;
  let created = false,
    posts = 0,
    gets = 0;
  try {
    globalThis.fetch = async (url, init) => {
      if (String(url).includes("/instance/connectionState/")) {
        gets++;
        return created
          ? Response.json({ instance: { state: "close" } })
          : new Response("absent", { status: 404 });
      }
      assert.equal(String(url), "https://provider.invalid/instance/create");
      assert.equal(init?.method, "POST");
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(body, {
        instanceName: "sv-ficticia",
        integration: "WHATSAPP-BAILEYS",
        qrcode: false,
      });
      created = true;
      posts++;
      return Response.json(
        { instance: { instanceName: "sv-ficticia" } },
        { status: 201 },
      );
    };
    const adapter = evolutionAttendance(config);
    await adapter.ensureInstance!();
    await adapter.ensureInstance!();
    assert.equal(posts, 1);
    assert.equal(gets, 2);
  } finally {
    globalThis.fetch = original;
  }
});

test("timeout, erro ou credencial recusada ao consultar nunca disparam criação", async () => {
  const original = globalThis.fetch;
  try {
    for (const response of [null, 403, 500, 200]) {
      let posts = 0;
      globalThis.fetch = async (_url, init) => {
        if (init?.method === "POST") posts++;
        if (response === null)
          throw new Error("timeout private-key-must-not-escape");
        return response === 200
          ? Response.json({ error: true, message: "private provider detail" })
          : new Response("private body", { status: response });
      };
      await assert.rejects(evolutionAttendance(config).ensureInstance!());
      assert.equal(posts, 0);
    }
  } finally {
    globalThis.fetch = original;
  }
});

test("timeout depois de criar não repete POST e próxima ação reconcilia por GET", async () => {
  const original = globalThis.fetch;
  let created = false,
    posts = 0;
  try {
    globalThis.fetch = async (_url, init) => {
      if (init?.method === "POST") {
        created = true;
        posts++;
        throw new Error("response lost");
      }
      return created
        ? Response.json({ instance: { state: "close" } })
        : new Response("absent", { status: 404 });
    };
    const adapter = evolutionAttendance(config);
    await assert.rejects(adapter.ensureInstance!());
    assert.equal(posts, 1);
    await adapter.ensureInstance!();
    assert.equal(posts, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test("QR distingue número já conectado, código pronto, espera e ausência sem inventar sucesso", async () => {
  const original = globalThis.fetch;
  const png =
    "data:image/png;base64," +
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64");
  try {
    const adapter = evolutionAttendance(config);
    for (const [body, state] of [
      [{ instance: { state: "open" } }, "CONNECTED"],
      [{ base64: png }, "QR"],
      [{ instance: { state: "connecting" } }, "CONNECTING"],
      [{}, "UNAVAILABLE"],
      [{ base64: "data:image/png;base64,c2VjcmV0" }, "UNAVAILABLE"],
    ] as const) {
      globalThis.fetch = async () => Response.json(body);
      const qr = await adapter.qr();
      assert.equal(qr.state, state);
      assert.equal(Boolean(qr.qrDataUrl), state === "QR");
      assert.equal(Boolean(qr.expiresAt), state === "QR");
    }
  } finally {
    globalThis.fetch = original;
  }
});

test("erro do QR em HTTP200 é falha e detalhes privados não escapam", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      Response.json({ error: true, message: "private provider token" });
    await assert.rejects(
      evolutionAttendance(config).qr(),
      /^Error: EVOLUTION_QR_REJECTED$/,
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("preparação não substitui destino de outro sistema mesmo se estiver pausado", async () => {
  const original = globalThis.fetch;
  let posts = 0;
  try {
    globalThis.fetch = async (_url, init) => {
      if (init?.method === "POST") posts++;
      return Response.json({
        enabled: false,
        url: "https://other.invalid/callback",
      });
    };
    await assert.rejects(
      evolutionAttendance(config).webhook(
        "https://app.invalid/callback",
        false,
      ),
      /EXISTING_WEBHOOK_CONFIRMATION_REQUIRED/,
    );
    assert.equal(posts, 0);
  } finally {
    globalThis.fetch = original;
  }
});

test("erros HTTP200 na verificação ou webhook não viram conexão pronta", async () => {
  const original = globalThis.fetch;
  try {
    const adapter = evolutionAttendance(config);
    globalThis.fetch = async () =>
      Response.json({
        error: true,
        instance: { state: "open" },
        message: "private token",
      });
    await assert.rejects(
      adapter.verify(),
      /^Error: EVOLUTION_CONNECTION_REJECTED$/,
    );
    await assert.rejects(
      adapter.webhook("https://app.invalid/callback", false),
      /^Error: EVOLUTION_WEBHOOK_LOOKUP_REJECTED$/,
    );
    let posts = 0;
    globalThis.fetch = async (_url, init) => {
      if (init?.method === "POST") {
        posts++;
        return Response.json({ error: true, message: "private token" });
      }
      return Response.json({ enabled: false });
    };
    await assert.rejects(
      adapter.webhook("https://app.invalid/callback", false),
      /^Error: EVOLUTION_WEBHOOK_SET_REJECTED$/,
    );
    assert.equal(posts, 1);
  } finally {
    globalThis.fetch = original;
  }
});
