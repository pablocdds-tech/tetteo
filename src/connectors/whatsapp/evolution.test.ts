import assert from "node:assert/strict";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";

import { criarProvedorEvolution } from "./evolution";

/**
 * O PROVEDOR EVOLUTION CONTRA UMA EVOLUTION DE MENTIRA.
 *
 * Um servidor HTTP local responde como a 2.3.7 responde (formatos lidos do
 * código da etiqueta 2.3.7). O que se prova aqui é o que o Tetteo MANDA — o
 * caminho, o método, o cabeçalho, o corpo aninhado ou plano — e como ele LÊ o
 * que volta, inclusive quando volta mal.
 *
 * A chave é fictícia, e o teste existe para provar que ela não escapa.
 */

const CHAVE = "chave-da-instancia-ficticia-7788";
const INSTANCIA = "loja-ensaio";

type Pedido = {
  metodo: string;
  caminho: string;
  apikey: string;
  corpo: unknown;
};
type Resposta = { status: number; corpo?: unknown; pendurar?: boolean };

let pedidos: Pedido[] = [];
let responder: (p: Pedido) => Resposta = () => ({ status: 404 });
let url = "";
const servidor = createServer((req: IncomingMessage, res: ServerResponse) => {
  let bruto = "";
  req.on("data", (parte) => (bruto += parte));
  req.on("end", () => {
    const pedido: Pedido = {
      metodo: req.method ?? "",
      caminho: req.url ?? "",
      apikey: String(req.headers.apikey ?? ""),
      corpo: bruto ? JSON.parse(bruto) : null,
    };
    pedidos.push(pedido);
    const r = responder(pedido);
    if (r.pendurar) return; // nunca responde: é o tempo esgotado
    res.writeHead(r.status, { "Content-Type": "application/json" });
    res.end(r.corpo === undefined ? "" : JSON.stringify(r.corpo));
  });
});

before(async () => {
  await new Promise<void>((pronto) => servidor.listen(0, "127.0.0.1", pronto));
  url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});
after(() => {
  servidor.closeAllConnections();
  servidor.close();
});

function provedor(limites = { consulta: 2000, envio: 2000 }) {
  pedidos = [];
  return criarProvedorEvolution(
    { url, instancia: INSTANCIA, chave: CHAVE },
    { limiteConsultaMs: limites.consulta, limiteEnvioMs: limites.envio },
  );
}

test("consulta o estado com a chave da instância, no caminho da 2.3.7", async () => {
  const p = provedor();
  responder = () => ({
    status: 200,
    corpo: { instance: { instanceName: INSTANCIA, state: "open" } },
  });
  const r = await p.consultarConexao();
  assert.deepEqual(r, { tipo: "ok", estado: "CONECTADO", numero: null });
  assert.equal(pedidos[0].metodo, "GET");
  assert.equal(pedidos[0].caminho, `/instance/connectionState/${INSTANCIA}`);
  assert.equal(pedidos[0].apikey, CHAVE);
});

test("com o número pedido, lê o ownerJid do fetchInstances", async () => {
  const p = provedor();
  responder = (pedido) =>
    pedido.caminho.startsWith("/instance/connectionState")
      ? { status: 200, corpo: { instance: { state: "open" } } }
      : {
          status: 200,
          corpo: [
            {
              name: INSTANCIA,
              ownerJid: "5511900000001@s.whatsapp.net",
              token: CHAVE,
            },
          ],
        };
  const r = await p.consultarConexao({ comNumero: true });
  assert.deepEqual(r, {
    tipo: "ok",
    estado: "CONECTADO",
    numero: "5511900000001",
  });
  assert.equal(
    pedidos[1].caminho,
    `/instance/fetchInstances?instanceName=${INSTANCIA}`,
  );
});

test('"connecting" e "close" viram Conectando e Desconectado', async () => {
  const p = provedor();
  responder = () => ({
    status: 200,
    corpo: { instance: { state: "connecting" } },
  });
  assert.deepEqual(await p.consultarConexao(), {
    tipo: "ok",
    estado: "CONECTANDO",
    numero: null,
  });
  responder = () => ({ status: 200, corpo: { instance: { state: "close" } } });
  assert.deepEqual(await p.consultarConexao(), {
    tipo: "ok",
    estado: "DESCONECTADO",
    numero: null,
  });
});

/** CENÁRIO 2 do aceite, no nível do HTTP: credencial inválida não vaza. */
test("credencial recusada vira erro legível, sem a chave dentro", async () => {
  const p = provedor();
  responder = (pedido) => ({
    status: 401,
    corpo: {
      status: 401,
      error: "Unauthorized",
      response: { message: `apikey ${pedido.apikey} inválida` },
    },
  });
  const r = await p.consultarConexao();
  assert.equal(r.tipo, "erro");
  assert.ok(!JSON.stringify(r).includes(CHAVE), "a chave vazou no motivo");
  const envio = await p.enviarMensagem({ para: "5511900000012", texto: "oi" });
  assert.equal(envio.tipo, "recusado");
  assert.ok(!JSON.stringify(envio).includes(CHAVE), "a chave vazou no envio");
});

test("envia com o corpo PLANO da 2.3.7 e lê o id do 201", async () => {
  const p = provedor();
  responder = () => ({
    status: 201,
    corpo: {
      key: {
        remoteJid: "5511900000012@s.whatsapp.net",
        fromMe: true,
        id: "3EB0SIMULADO01",
      },
      status: "PENDING",
      message: { conversation: "oi" },
      messageTimestamp: 1789081200,
    },
  });
  const r = await p.enviarMensagem({ para: "5511900000012", texto: "oi" });
  assert.equal(r.tipo, "aceito");
  assert.equal(r.tipo === "aceito" && r.idMensagem, "3EB0SIMULADO01");
  assert.equal(pedidos[0].metodo, "POST");
  assert.equal(pedidos[0].caminho, `/message/sendText/${INSTANCIA}`);
  assert.deepEqual(pedidos[0].corpo, {
    number: "5511900000012",
    text: "oi",
    linkPreview: false,
  });
});

/** Mensagem marcada como saída sem prova é pior do que uma falha. */
test("201 sem id de mensagem é incerto", async () => {
  const p = provedor();
  responder = () => ({ status: 201, corpo: { status: "PENDING" } });
  assert.equal(
    (await p.enviarMensagem({ para: "5511900000012", texto: "oi" })).tipo,
    "incerto",
  );
});

test("Evolution que não responde é incerta — e o limite é respeitado", async () => {
  const p = provedor({ consulta: 300, envio: 300 });
  responder = () => ({ status: 0, pendurar: true });
  const inicio = Date.now();
  const r = await p.enviarMensagem({ para: "5511900000012", texto: "oi" });
  assert.equal(r.tipo, "incerto");
  assert.ok(Date.now() - inicio < 2000, "esperou além do limite");
});

test("porta fechada: o pedido não chegou", async () => {
  const fechado = createServer();
  await new Promise<void>((pronto) => fechado.listen(0, "127.0.0.1", pronto));
  const porta = (fechado.address() as AddressInfo).port;
  await new Promise<void>((pronto) => fechado.close(() => pronto()));
  const p = criarProvedorEvolution(
    { url: `http://127.0.0.1:${porta}`, instancia: INSTANCIA, chave: CHAVE },
    { limiteConsultaMs: 1000, limiteEnvioMs: 1000 },
  );
  assert.equal(
    (await p.enviarMensagem({ para: "5511900000012", texto: "oi" })).tipo,
    "nao-chegou",
  );
});

test("número sem WhatsApp é recusado com frase clara e sem o número", async () => {
  const p = provedor();
  responder = () => ({
    status: 400,
    corpo: {
      status: 400,
      error: "Bad Request",
      response: {
        message: [
          {
            exists: false,
            jid: "5511900000012@s.whatsapp.net",
            number: "5511900000012",
          },
        ],
      },
    },
  });
  const r = await p.enviarMensagem({ para: "5511900000012", texto: "oi" });
  assert.equal(r.tipo, "recusado");
  assert.equal(
    r.tipo === "recusado" && r.motivo,
    "Este número não tem WhatsApp.",
  );
});

test("5xx é incerto", async () => {
  const p = provedor();
  responder = () => ({
    status: 500,
    corpo: { status: 500, error: "Internal Server Error" },
  });
  assert.equal(
    (await p.enviarMensagem({ para: "5511900000012", texto: "oi" })).tipo,
    "incerto",
  );
});

/** Reconectar com o número no ar não pode derrubá-lo. */
test("pedir QR com o número conectado devolve 'já conectado'", async () => {
  const p = provedor();
  responder = () => ({
    status: 200,
    corpo: { instance: { instanceName: INSTANCIA, state: "open" } },
  });
  const r = await p.pedirQrCode();
  assert.deepEqual(r, { ok: true, valor: { tipo: "ja-conectado" } });
  assert.equal(pedidos[0].caminho, `/instance/connect/${INSTANCIA}`);
  assert.ok(
    pedidos.every(
      (x) => !x.caminho.includes("logout") && !x.caminho.includes("delete"),
    ),
  );
});

test("pedir QR desconectado devolve a imagem e o prazo de 45 s", async () => {
  const p = provedor();
  responder = () => ({
    status: 200,
    corpo: {
      pairingCode: null,
      code: "2@codigo-ficticio",
      base64: "data:image/png;base64,QUJD",
      count: 1,
    },
  });
  const r = await p.pedirQrCode();
  assert.deepEqual(r, {
    ok: true,
    valor: {
      tipo: "qr",
      imagem: "data:image/png;base64,QUJD",
      expiraEmMs: 45_000,
    },
  });
});

test("configura eventos com o corpo ANINHADO e a senha em jwt_key", async () => {
  const p = provedor();
  responder = (pedido) => ({
    status: 201,
    corpo: { ...(pedido.corpo as { webhook: object }).webhook, id: "x" },
  });
  const r = await p.configurarEventos({
    url: "http://tetteo:3000/api/whatsapp/webhook",
    senha: "senha-do-webhook-ficticia-01",
    eventos: ["CONNECTION_UPDATE", "MESSAGES_UPDATE", "SEND_MESSAGE"],
  });
  assert.ok(r.ok);
  assert.equal(pedidos[0].metodo, "POST");
  assert.equal(pedidos[0].caminho, `/webhook/set/${INSTANCIA}`);
  assert.deepEqual(pedidos[0].corpo, {
    webhook: {
      enabled: true,
      url: "http://tetteo:3000/api/whatsapp/webhook",
      headers: { jwt_key: "senha-do-webhook-ficticia-01" },
      byEvents: false,
      base64: false,
      events: ["CONNECTION_UPDATE", "MESSAGES_UPDATE", "SEND_MESSAGE"],
    },
  });
  assert.ok(!JSON.stringify(r).includes("senha-do-webhook-ficticia-01"));
});

test("lê a configuração atual sem devolver a senha nem a consulta da URL", async () => {
  const p = provedor();
  responder = () => ({
    status: 200,
    corpo: {
      id: "x",
      url: "https://n8n.exemplo/webhook/abc?token=segredo-na-url",
      headers: { jwt_key: "senha-antiga-ficticia-99" },
      enabled: true,
      events: ["MESSAGES_UPSERT"],
    },
  });
  const r = await p.lerEventos();
  assert.deepEqual(r, {
    ok: true,
    valor: {
      ativo: true,
      url: "https://n8n.exemplo/webhook/abc",
      eventos: ["MESSAGES_UPSERT"],
      comSenha: true,
    },
  });
  responder = () => ({ status: 200, corpo: null });
  assert.deepEqual(await p.lerEventos(), {
    ok: true,
    valor: { ativo: false, url: null, eventos: [], comSenha: false },
  });
});

test("consulta a mensagem pelo texto exato, desde o início da tentativa", async () => {
  const p = provedor();
  const texto = "*Fechamento pronto para revisão*\nRef. AV-ENSAIO";
  responder = () => ({
    status: 200,
    corpo: {
      messages: {
        total: 2,
        pages: 1,
        currentPage: 1,
        records: [
          {
            id: "a",
            key: { id: "3EB0OUTRA", fromMe: true },
            message: { conversation: "outra" },
            messageTimestamp: 1789081210,
          },
          {
            id: "b",
            key: { id: "3EB0ESTA", fromMe: true },
            message: { conversation: texto },
            messageTimestamp: 1789081205,
          },
        ],
      },
    },
  });
  const desde = new Date(1789081200 * 1000);
  const r = await p.consultarMensagem({ texto, desde });
  assert.deepEqual(r, {
    ok: true,
    valor: { idMensagem: "3EB0ESTA", enviadaEm: new Date(1789081205 * 1000) },
  });
  assert.equal(pedidos[0].caminho, `/chat/findMessages/${INSTANCIA}`);
  assert.deepEqual(pedidos[0].corpo, {
    where: { key: { fromMe: true }, messageTimestamp: { gte: 1789081200 } },
    page: 1,
    offset: 50,
  });
});
