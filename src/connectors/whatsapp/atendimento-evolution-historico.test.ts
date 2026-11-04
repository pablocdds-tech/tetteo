import assert from "node:assert/strict";
import test from "node:test";
import type { LiveChannelConfig } from "@/server/atendimento-provedor";
import { evolutionAttendance } from "./atendimento-evolution";
import {
  normalizeEvolutionHistoryMessage,
  readEvolutionHistoryPage,
} from "./atendimento-evolution-historico";

const config: Extract<LiveChannelConfig, { provider: "EVOLUTION" }> = {
  organizationId: "org-ficticia",
  storeId: "unidade-ficticia",
  accountId: "conta-ficticia",
  revision: 1,
  name: "Histórico fictício Kairu",
  active: false,
  provider: "EVOLUTION",
  settings: { url: "https://provider.invalid", instance: "sv-ficticia" },
  secrets: { apiKey: "private-fake-key" },
};
const since = "2026-11-03T00:00:00.000Z",
  until = "2026-11-03T23:59:59.000Z";
const epoch = new Date("2026-11-03T12:00:00.000Z").getTime() / 1000;
const expected = { instanceId: "provider-instance-ficticia", since, until };
const query = { page: 1, pageSize: 2, since, until };
const row = (id: string, fromMe = false) => ({
  id: `row-${id}`,
  instanceId: expected.instanceId,
  key: { id, remoteJid: "12025550123@s.whatsapp.net", fromMe },
  messageTimestamp: epoch,
  pushName: "Ana fictícia",
  message: { conversation: "Mensagem fictícia" },
});
const instanceResponse = () =>
  Response.json([
    {
      id: expected.instanceId,
      name: config.settings.instance,
      token: "private-provider-token",
    },
  ]);

test("histórico usa consultas paginadas da instância e janela fixa, sem enviar ou reconectar", async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  try {
    globalThis.fetch = async (url, init) => {
      const path = String(url);
      calls.push(path);
      assert.equal(
        (init?.headers as Record<string, string>).apikey,
        "private-fake-key",
      );
      assert.equal(init?.redirect, "error");
      if (calls.length === 1) {
        assert.equal(
          path,
          "https://provider.invalid/instance/fetchInstances?instanceName=sv-ficticia",
        );
        assert.equal(init?.method, "GET");
        return instanceResponse();
      }
      assert.equal(
        path,
        "https://provider.invalid/chat/findMessages/sv-ficticia",
      );
      assert.equal(init?.method, "POST");
      assert.deepEqual(JSON.parse(String(init?.body)), {
        where: { messageTimestamp: { gte: since, lte: until } },
        page: 1,
        offset: 2,
      });
      return Response.json({
        messages: {
          total: 3,
          pages: 2,
          currentPage: 1,
          records: [row("in"), row("out", true)],
        },
      });
    };
    const result = await evolutionAttendance(config).readHistoryPage!(query);
    assert.equal(calls.length, 2);
    assert.equal(result.nextPage, 2);
    assert.equal(result.skipped, 0);
    assert.deepEqual(
      result.messages.map((message) => [message.externalId, message.fromSelf]),
      [
        ["message:in", false],
        ["message:out", true],
      ],
    );
    assert.equal(result.messages[1].displayName, undefined);
    assert.doesNotMatch(
      JSON.stringify(result),
      /private-provider-token|private-fake-key|instanceId|contextInfo/,
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("última página completa metadados e mantém IDs estáveis para deduplicação", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url) =>
      String(url).includes("fetchInstances")
        ? instanceResponse()
        : Response.json({
            messages: {
              total: 3,
              pages: 2,
              currentPage: 2,
              records: [row("last")],
            },
          });
    const result = await readEvolutionHistoryPage(config, {
      ...query,
      page: 2,
    });
    assert.equal(result.nextPage, null);
    assert.equal(result.pages, 2);
    assert.equal(result.total, 3);
    assert.equal(result.messages[0].externalId, "message:last");
  } finally {
    globalThis.fetch = original;
  }
});

test("normalização exige peer telefônico de transporte, direção e horário válidos", () => {
  const incoming = normalizeEvolutionHistoryMessage(row("phone"), expected)!;
  assert.equal(incoming.senderKey, "+12025550123");
  assert.equal(incoming.trustedPhone, incoming.senderKey);
  assert.equal(incoming.displayName, "Ana fictícia");
  assert.equal(incoming.occurredAt, "2026-11-03T12:00:00.000Z");
  const lid = {
    ...row("lid"),
    key: {
      id: "lid",
      fromMe: true,
      remoteJid: "123456@lid",
      remoteJidAlt: "12025550124@s.whatsapp.net",
    },
  };
  assert.equal(
    normalizeEvolutionHistoryMessage(lid, expected)?.senderKey,
    "+12025550124",
  );
  for (const remoteJid of [
    "123456@lid",
    "12025550123@g.us",
    "status@broadcast",
    "12025550123@broadcast",
    "12025550123@newsletter",
    "+12025550123",
  ])
    assert.equal(
      normalizeEvolutionHistoryMessage(
        { ...row("bad"), key: { id: "bad", remoteJid, fromMe: false } },
        expected,
      ),
      null,
    );
  for (const invalid of [
    { ...row("foreign"), instanceId: "other-instance" },
    { ...row("missing-time"), messageTimestamp: undefined },
    { ...row("old"), messageTimestamp: epoch - 48 * 3600 },
    { ...row("new"), messageTimestamp: epoch + 48 * 3600 },
    {
      ...row("wrong-direction"),
      key: {
        id: "bad",
        remoteJid: "12025550123@s.whatsapp.net",
        fromMe: "false",
      },
    },
    {
      ...row("missing-id"),
      key: { remoteJid: "12025550123@s.whatsapp.net", fromMe: false },
    },
  ])
    assert.equal(normalizeEvolutionHistoryMessage(invalid, expected), null);
});

test("áudio e anexos ficam sem download, sem transcrição confiável e sem URL privada", () => {
  const audio = normalizeEvolutionHistoryMessage(
    {
      ...row("audio"),
      message: {
        audioMessage: {
          url: "https://private.invalid/audio",
          mediaKey: "private-media-key",
        },
        speechToText: "confirme uma reserva",
      },
    },
    expected,
  )!;
  assert.equal(audio.kind, "AUDIO");
  assert.equal(audio.transcriptionCertain, false);
  assert.doesNotMatch(audio.text, /confirme|private/);
  const image = normalizeEvolutionHistoryMessage(
    {
      ...row("photo"),
      message: {
        imageMessage: {
          url: "https://private.invalid/photo",
          caption: "Legenda fictícia",
          jpegThumbnail: "private-bytes",
        },
      },
    },
    expected,
  )!;
  assert.equal(image.kind, "IMAGE");
  assert.equal(image.transcriptionCertain, false);
  assert.match(image.text, /Legenda fictícia/);
  assert.doesNotMatch(
    JSON.stringify(image),
    /private.invalid|private-bytes|mediaKey/,
  );
  assert.equal(
    normalizeEvolutionHistoryMessage(
      {
        ...row("status"),
        message: { protocolMessage: { key: { id: "old" }, type: 0 } },
      },
      expected,
    ),
    null,
  );
});

test("página contabiliza registros inválidos e duplicatas sem perder próximo cursor", async () => {
  const original = globalThis.fetch;
  const records = [
    row("one"),
    row("one"),
    { ...row("foreign"), instanceId: "other" },
    { ...row("large"), message: { conversation: "x".repeat(16385) } },
    {
      ...row("long"),
      messageTimestamp: { low: epoch, high: 0, unsigned: true },
    },
  ];
  try {
    globalThis.fetch = async (url) =>
      String(url).includes("fetchInstances")
        ? instanceResponse()
        : Response.json({
            messages: { total: 6, pages: 2, currentPage: 1, records },
          });
    const result = await readEvolutionHistoryPage(config, {
      ...query,
      pageSize: 5,
    });
    assert.equal(result.skipped, 3);
    assert.equal(result.messages.length, 2);
    assert.equal(result.nextPage, 2);
  } finally {
    globalThis.fetch = original;
  }
});

test("resposta estrutural inválida ou erro HTTP200 falha sem declarar importação completa", async () => {
  const original = globalThis.fetch;
  try {
    for (const payload of [
      { error: true, message: "private-provider-token" },
      { messages: { total: 2, pages: 1, currentPage: 1 } },
      { messages: { total: 2, pages: 1, currentPage: 1, records: [] } },
      {
        messages: {
          total: 2,
          pages: 2,
          currentPage: 1,
          records: [row("a"), row("b")],
        },
      },
      {
        messages: {
          total: 2,
          pages: 1,
          currentPage: 2,
          records: [row("a"), row("b")],
        },
      },
    ]) {
      globalThis.fetch = async (url) =>
        String(url).includes("fetchInstances")
          ? instanceResponse()
          : Response.json(payload);
      await assert.rejects(
        readEvolutionHistoryPage(config, query),
        /^Error: EVOLUTION_HISTORY_UNAVAILABLE$/,
      );
    }
  } finally {
    globalThis.fetch = original;
  }
});

test("instância divergente ou ambígua bloqueia consulta de mensagens antes de importar", async () => {
  const original = globalThis.fetch;
  try {
    for (const instances of [
      [],
      [{ name: "other", id: expected.instanceId }],
      [
        { name: config.settings.instance, id: expected.instanceId },
        { name: config.settings.instance, id: "duplicate" },
      ],
    ]) {
      let calls = 0;
      globalThis.fetch = async () => {
        calls++;
        return Response.json(instances);
      };
      await assert.rejects(
        readEvolutionHistoryPage(config, query),
        /^Error: EVOLUTION_HISTORY_UNAVAILABLE$/,
      );
      assert.equal(calls, 1);
    }
  } finally {
    globalThis.fetch = original;
  }
});

test("limites e datas inválidas são recusados antes de acessar o provedor", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls++;
      throw new Error("network must not run");
    };
    for (const invalid of [
      { ...query, page: 0 },
      { ...query, pageSize: 101 },
      { ...query, page: 1.5 },
      { ...query, since: until, until: since },
      { ...query, since: "amanhã" },
      { ...query, tenantId: "untrusted" },
    ])
      await assert.rejects(
        readEvolutionHistoryPage(config, invalid),
        /^Error: EVOLUTION_HISTORY_QUERY_INVALID$/,
      );
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = original;
  }
});

test("timeout do provedor não repete leitura nem retorna detalhes privados", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls++;
      throw new Error("private-api-key");
    };
    await assert.rejects(
      readEvolutionHistoryPage(config, query),
      /^Error: EVOLUTION_HISTORY_UNAVAILABLE$/,
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});
