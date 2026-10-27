import assert from "node:assert/strict";
import { test } from "node:test";
import { receberWebhookCw } from "./webhook";
import { ClienteCw, urlAutorizacaoCw } from "./client";
import { configApiCw, configCw } from "./config";
import { cifrarCw, decifrarCw, pkce, validarRetornoCw } from "./seguranca";
import { pedidosCw, centavosCw } from "./schemas";

const segredo = "segredo-de-fixture-".repeat(3);
const evento = {
  event_id: "evento-ficticio-1",
  event_type: "ORDER_CREATED",
  merchant_id: 101,
  order_id: 9001,
  order_status: "waiting_confirmation",
  created_at: "2026-10-27T18:00:00-03:00",
};
const request = (body: unknown = evento, token = segredo) =>
  new Request(
    "https://exemplo.test/api/cardapioweb/webhook?ambiente=producao",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Webhook-Token": token },
      body: JSON.stringify(body),
    },
  );
test("webhook rejeita requisições inválidas antes da persistência", async () => {
  let gravacoes = 0;
  const gravar = async () => {
    gravacoes++;
    return "recebido" as const;
  };
  assert.equal(
    (await receberWebhookCw(request(evento, ""), gravar)).status,
    401,
  );
  assert.equal(
    (
      await receberWebhookCw(
        request({ ...evento, event_type: "OUTRO" }),
        gravar,
      )
    ).status,
    400,
  );
  assert.equal(
    (await receberWebhookCw(request({ ...evento, merchant_id: -1 }), gravar))
      .status,
    400,
  );
  const enorme = request({ ...evento, extra: "x".repeat(17000) });
  enorme.headers.set("content-length", "18000");
  assert.equal((await receberWebhookCw(enorme, gravar)).status, 413);
  assert.equal(gravacoes, 0);
});
test("webhook só confirma após gravar; repetição é aceita e falha de banco retorna 503", async () => {
  let liberar!: () => void;
  let concluida = false;
  const processamento = receberWebhookCw(
    request({ ...evento, customer: { phone: "NAO_PERSISTIR" } }),
    async (ambiente, token, recebido) => {
      assert.equal(ambiente, "producao");
      assert.equal(token, segredo);
      assert.ok(!JSON.stringify(recebido).includes("NAO_PERSISTIR"));
      await new Promise<void>((resolve) => {
        liberar = resolve;
      });
      return "recebido";
    },
  ).then((r) => {
    concluida = true;
    return r;
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(concluida, false);
  liberar();
  assert.equal((await processamento).status, 200);
  assert.equal(
    (await receberWebhookCw(request(), async () => "repetido")).status,
    200,
  );
  assert.equal(
    (await receberWebhookCw(request(), async () => "recusado")).status,
    401,
  );
  assert.equal(
    (await receberWebhookCw(request(), async () => "conflito")).status,
    409,
  );
  const falha = await receberWebhookCw(request(), async () => {
    throw new Error("NAO_EXPOR_CREDENCIAL");
  });
  assert.equal(falha.status, 503);
  assert.ok(!(await falha.text()).includes("NAO_EXPOR_CREDENCIAL"));
});
test("API Key é enviada no header correto, sem redirecionamentos ou repetição automática", async () => {
  let chamadas = 0;
  const cliente = new ClienteCw(
    configApiCw("producao"),
    async (input, init) => {
      chamadas++;
      assert.equal(
        new URL(String(input)).hostname,
        "integracao.cardapioweb.com",
      );
      assert.equal(init?.redirect, "error");
      assert.equal(
        new Headers(init?.headers).get("X-API-KEY"),
        "token-ficticio",
      );
      assert.equal(new Headers(init?.headers).get("Authorization"), null);
      return Response.json({ id: 101, name: "Loja de testes" });
    },
    "api-key",
  );
  assert.equal((await cliente.loja("token-ficticio")).id, 101);
  assert.equal(chamadas, 1);
});
test("PKCE, cookie e cifra impedem troca de sessão ou unidade", () => {
  process.env.CARDAPIOWEB_ENCRYPTION_KEY = "ab".repeat(32);
  const config = configCw({
    APP_URL: "https://exemplo.test",
    CARDAPIOWEB_ENVIRONMENT: "sandbox",
    CARDAPIOWEB_CLIENT_ID: "fixture",
    CARDAPIOWEB_REDIRECT_URI: "https://exemplo.test/api/cardapioweb/callback",
    CARDAPIOWEB_ENCRYPTION_KEY: "ab".repeat(32),
  });
  const { state, verifier, challenge } = pkce();
  const params = new URLSearchParams({ state, code: "codigo-ficticio" });
  assert.equal(validarRetornoCw(params, state).code, "codigo-ficticio");
  assert.throws(() => validarRetornoCw(params, "outro-navegador"));
  params.append("code", "repetido");
  assert.throws(() => validarRetornoCw(params, state));
  assert.ok(!urlAutorizacaoCw(config, state, challenge).includes(verifier));
  const cifra = cifrarCw("token-ficticio", "loja-a");
  assert.equal(decifrarCw(cifra, "loja-a"), "token-ficticio");
  assert.throws(() => decifrarCw(cifra, "loja-b"));
});
test("pedido resumido preserva estado novo, deduplica por revisão e descarta dados pessoais", () => {
  const pedido = {
    id: 9001,
    status: "estado_novo",
    order_type: "delivery",
    sales_channel: "catalog",
    created_at: evento.created_at,
    updated_at: evento.created_at,
  };
  const resultado = pedidosCw.parse([
    { ...pedido, customer: { name: "NAO_PERSISTIR" } },
    { ...pedido, status: "confirmed", updated_at: "2026-10-27T17:59:00-03:00" },
  ]);
  assert.equal(resultado.length, 1);
  assert.equal(resultado[0].status, "estado_novo");
  assert.ok(!JSON.stringify(resultado).includes("NAO_PERSISTIR"));
  assert.equal(centavosCw.parse(31.99), 3199);
  assert.equal(centavosCw.safeParse(3.001).success, false);
});
