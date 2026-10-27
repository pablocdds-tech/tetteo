import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { db } from "@/server/db";
import {
  confirmarLegadoCw,
  desativarRecebimentoCw,
  gravarEventoCw,
  painelRecebimentoCw,
  prepararLegadoCw,
} from "./recebimento";
import { receberWebhookCw } from "./webhook";
import { processarRecebimentoCw } from "./worker";
import { confirmarCw, iniciarCw, receberCw } from "./servico";
import type { EscopoCw } from "./seguranca";

const fetchOriginal = globalThis.fetch;
const segredoA = "webhook-ficticio-a-".repeat(3);
const segredoB = "webhook-ficticio-b-".repeat(3);
let a: EscopoCw, b: EscopoCw;
let estado = "confirmed";
let revisao = "2026-10-27T18:05:00-03:00";
let falharLista = false;
let segurarDetalhe: (() => Promise<void>) | null = null;
let trocas = 0;
const base = {
  order_type: "delivery",
  sales_channel: "catalog",
  created_at: "2026-10-27T18:00:00-03:00",
};
const evento = (event_id: string, merchant_id = 101, order_id = 9001) => ({
  event_id,
  event_type: "ORDER_CREATED" as const,
  merchant_id,
  order_id,
  order_status: "waiting_confirmation",
  created_at: base.created_at,
});
const req = (payload: unknown, token = segredoA) =>
  new Request(
    "https://tetteo.example.test/api/cardapioweb/webhook?ambiente=producao",
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-webhook-token": token },
      body: JSON.stringify(payload),
    },
  );

before(() => {
  const url = new URL(process.env.DATABASE_URL || "");
  if (
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    !url.pathname.includes("_test")
  )
    throw new Error("Use exclusivamente um banco local _test.");
  Object.assign(process.env, {
    CARDAPIOWEB_ENCRYPTION_KEY: "ab".repeat(32),
    APP_URL: "https://tetteo.example.test",
    CARDAPIOWEB_ENVIRONMENT: "sandbox",
    CARDAPIOWEB_CLIENT_ID: "app-ficticio",
    CARDAPIOWEB_REDIRECT_URI:
      "https://tetteo.example.test/api/cardapioweb/callback",
  });
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.ok(
      [
        "integracao.cardapioweb.com",
        "integracao.sandbox.cardapioweb.com",
      ].includes(url.hostname),
    );
    assert.equal(init?.redirect, "error");
    if (url.pathname.endsWith("/oauth/token")) {
      trocas++;
      return Response.json({
        access_token: "access-ficticio",
        refresh_token: "refresh-ficticio",
        token_type: "Bearer",
        expires_in: 7200,
        scope: "store orders catalog",
      });
    }
    const merchant =
      new Headers(init?.headers).get("x-api-key") === "api-ficticia-b"
        ? 202
        : 101;
    if (url.pathname.endsWith("/merchant"))
      return Response.json({ id: merchant, name: `Loja fictícia ${merchant}` });
    if (url.pathname.endsWith("/orders")) {
      if (falharLista)
        return Response.json({ error: "falha-ficticia" }, { status: 500 });
      return Response.json(
        [9001, 9002].map((id) => ({
          ...base,
          id,
          status: estado,
          updated_at: revisao,
        })),
      );
    }
    const id = Number(url.pathname.split("/").pop());
    if (segurarDetalhe) await segurarDetalhe();
    return Response.json({
      ...base,
      id,
      merchant_id: merchant,
      display_id: "1",
      status: estado,
      updated_at: revisao,
      total: 52.35,
      customer: { phone: "NAO_PERSISTIR" },
    });
  };
});
beforeEach(async () => {
  await db.$executeRawUnsafe('TRUNCATE "organizacao", "usuario" CASCADE');
  const org = await db.organizacao.create({
    data: { nome: "Rede fictícia", slug: "cw-rede-test" },
  });
  const user = await db.usuario.create({
    data: {
      nome: "Operador fictício",
      email: "cw@exemplo.test",
      status: "ATIVO",
    },
  });
  const ua = await db.unidade.create({
    data: { organizacaoId: org.id, nome: "Matriz fictícia", codigo: "A" },
  });
  const ub = await db.unidade.create({
    data: { organizacaoId: org.id, nome: "Filial fictícia", codigo: "B" },
  });
  a = { organizacaoId: org.id, unidadeId: ua.id, usuarioId: user.id };
  b = { ...a, unidadeId: ub.id };
  estado = "confirmed";
  revisao = "2026-10-27T18:05:00-03:00";
  falharLista = false;
  segurarDetalhe = null;
  trocas = 0;
});
after(async () => {
  globalThis.fetch = fetchOriginal;
  await db.$disconnect();
});
async function conectar(scope = a, api = "api-ficticia-a", segredo = segredoA) {
  await prepararLegadoCw(scope, "producao", api, segredo);
  const row = (await painelRecebimentoCw(scope)).vinculos[0];
  await confirmarLegadoCw(scope, row.id);
  return row.id;
}

test("vínculo exige confirmação da unidade e não expõe tokens", async () => {
  await prepararLegadoCw(a, "producao", "api-ficticia-a", segredoA);
  const painel = await painelRecebimentoCw(a);
  assert.equal(painel.vinculos[0].ativo, false);
  assert.ok(!JSON.stringify(painel).includes("api-ficticia-a"));
  assert.ok(!JSON.stringify(painel).includes("Cifrada"));
  const id = painel.vinculos[0].id;
  await assert.rejects(confirmarLegadoCw(b, id));
  await confirmarLegadoCw(a, id);
  await assert.rejects(
    prepararLegadoCw(b, "producao", "api-ficticia-a", segredoB),
  );
  assert.equal((await painelRecebimentoCw(b)).vinculos.length, 0);
});
test("entregas concorrentes persistem um evento; token, loja e replay conflitante são recusados", async () => {
  await conectar();
  const respostas = await Promise.all(
    Array.from({ length: 4 }, () =>
      receberWebhookCw(req(evento("unico")), gravarEventoCw),
    ),
  );
  assert.ok(
    respostas.every((r) => r.status === 200),
    `Status concorrentes: ${respostas.map((r) => r.status).join(",")}`,
  );
  assert.equal(await db.cardapioWebEvento.count(), 1);
  assert.equal(
    (await receberWebhookCw(req(evento("errado"), segredoB), gravarEventoCw))
      .status,
    401,
  );
  assert.equal(
    (await receberWebhookCw(req(evento("outra-loja", 202)), gravarEventoCw))
      .status,
    401,
  );
  assert.equal(
    (await receberWebhookCw(req(evento("unico", 101, 9999)), gravarEventoCw))
      .status,
    409,
  );
  assert.equal(await db.cardapioWebEvento.count(), 1);
});
test("fila retoma eventos e polling recupera pedido sem webhook, sem duplicar ou regredir estado", async () => {
  const id = await conectar();
  assert.equal(
    await gravarEventoCw("producao", segredoA, evento("primeiro")),
    "recebido",
  );
  await processarRecebimentoCw(id);
  assert.equal(await db.cardapioWebPedido.count(), 1);
  await processarRecebimentoCw(id); // outra concessão, como após reiniciar o worker
  assert.equal(await db.cardapioWebPedido.count(), 2);
  const pedido = await db.cardapioWebPedido.findFirstOrThrow({
    where: { orderId: 9001 },
  });
  assert.equal(pedido.totalCentavos, 5235n);
  estado = "waiting_confirmation";
  revisao = "2026-10-27T18:01:00-03:00";
  await gravarEventoCw("producao", segredoA, evento("antigo"));
  await processarRecebimentoCw(id);
  assert.equal(
    (await db.cardapioWebPedido.findUniqueOrThrow({ where: { id: pedido.id } }))
      .estado,
    "confirmed",
  );
  const audit = await db.auditoria.findMany();
  assert.ok(!JSON.stringify(audit).includes("api-ficticia"));
});
test("mesmo número de pedido em duas lojas mantém o isolamento", async () => {
  const idA = await conectar();
  const idB = await conectar(b, "api-ficticia-b", segredoB);
  await gravarEventoCw("producao", segredoA, evento("a"));
  await gravarEventoCw("producao", segredoB, evento("b", 202));
  await processarRecebimentoCw(idA);
  await processarRecebimentoCw(idB);
  assert.equal(
    await db.cardapioWebPedido.count({ where: { orderId: 9001 } }),
    2,
  );
  assert.equal((await painelRecebimentoCw(a)).pedidos[0].orderId, 9001);
  assert.equal((await painelRecebimentoCw(b)).pedidos[0].orderId, 9001);
});
test("desconexão durante consulta impede persistência tardia e preserva o evento pendente", async () => {
  const id = await conectar();
  await gravarEventoCw("producao", segredoA, evento("em-voo"));
  let liberar!: () => void;
  let iniciou!: () => void;
  const entrada = new Promise<void>((resolve) => {
    iniciou = resolve;
  });
  segurarDetalhe = async () => {
    iniciou();
    await new Promise<void>((resolve) => {
      liberar = resolve;
    });
  };
  const trabalho = processarRecebimentoCw(id);
  await entrada;
  await desativarRecebimentoCw(a, id);
  liberar();
  await trabalho;
  assert.equal(await db.cardapioWebPedido.count(), 0);
  assert.equal(
    (await db.cardapioWebEvento.findFirstOrThrow()).estado,
    "PENDENTE",
  );
  assert.equal(
    await gravarEventoCw("producao", segredoA, evento("depois")),
    "recusado",
  );
});
test("falha do polling não avança cursor e OAuth recusa retorno repetido ou de outra unidade", async () => {
  const id = await conectar();
  falharLista = true;
  await processarRecebimentoCw(id);
  assert.equal(
    (await db.cardapioWebRecebimento.findUniqueOrThrow({ where: { id } }))
      .cursor,
    null,
  );
  const inicio = await iniciarCw(a);
  await assert.rejects(receberCw(b, inicio.state, "codigo-ficticio"));
  await receberCw(a, inicio.state, "codigo-ficticio");
  await assert.rejects(receberCw(a, inicio.state, "codigo-ficticio"));
  assert.equal(trocas, 1);
  const tentativa = await db.cardapioWebAutorizacao.findFirstOrThrow();
  await assert.rejects(confirmarCw(b, tentativa.id));
  await confirmarCw(a, tentativa.id);
  assert.equal(
    (await db.cardapioWebConexao.findFirstOrThrow()).estado,
    "ATIVA",
  );
});
