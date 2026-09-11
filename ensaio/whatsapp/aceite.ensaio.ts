import "./ambiente";

import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";

import {
  lerConexaoParaTela,
  pedirQrCodeDaConexao,
} from "@/app/api/whatsapp/_costura/conexao-tela";
import { entregarAvisos } from "@/app/api/whatsapp/_costura/entrega";
import { receberWebhook } from "@/app/api/whatsapp/_costura/receber";
import { atualizarSaude } from "@/app/api/whatsapp/_costura/saude";
import { verificarIncertos } from "@/app/api/whatsapp/_costura/verificacao";
import { assinarPasse } from "@/connectors/whatsapp/passe";
import {
  criarProvedorSimulado,
  reiniciarSimulador,
  simulador,
} from "@/connectors/whatsapp/simulado";
import { SemPermissao } from "@/lib/erros";
import { gerarReferencia } from "@/modules/assistente/schemas/aviso";
import {
  confirmarAviso,
  criarRascunho,
  reenviarAviso,
} from "@/modules/assistente/services/avisos";
import { dispararAgentes } from "@/modules/assistente/services/disparo";
import { coletarRascunhos } from "@/modules/assistente/services/rascunhos";
import { db } from "@/server/db";

import {
  CHAVE_FICTICIA,
  SENHA_DO_WEBHOOK,
  URL_DO_BANCO,
  URL_DO_BANCO_RESTAURADO,
} from "./ambiente";
import { consultar, exportarBanco, restaurarBanco } from "./backup-logico";
import {
  contextoDe,
  limparBancoDeEnsaio,
  montarCenario,
  type Cenario,
} from "./banco";

/**
 * OS 12 CENÁRIOS DE ACEITE — contra um banco de verdade (descartável) e o
 * provedor simulado. Nenhuma mensagem sai desta máquina.
 *
 *   npx tsx --conditions=react-server --test ensaio/whatsapp/aceite.ensaio.ts
 *
 * Cada cenário chama o que a tela e o relógio chamam: os serviços da Severina
 * e a costura da camada `app/`. O webhook recebe um `Request` de verdade,
 * assinado com o mesmo passe que a Evolution 2.3.7 manda.
 */

const ENV: Record<string, string | undefined> = {
  NODE_ENV: "test",
  APP_URL: "http://localhost:3001",
  WHATSAPP_WEBHOOK_CHAVE: SENHA_DO_WEBHOOK,
};

let cenario: Cenario;

const tarefas: Promise<unknown>[] = [];
/** O `after()` do Next, aqui executado na hora — e esperado. */
const agendar = (tarefa: () => Promise<void>) => {
  tarefas.push(tarefa());
};
const semEspera = async () => {};

function envelope(event: string, data: unknown, instancia = "loja-ensaio") {
  return {
    event,
    instance: instancia,
    data,
    destination: "http://localhost:3001/api/whatsapp/webhook",
    date_time: "2026-09-10T20:00:00.000Z",
    sender: "5511900000001@s.whatsapp.net",
    server_url: "http://simulado",
    apikey: null,
  };
}

async function webhook(
  corpo: unknown,
  opcoes: {
    passe?: string | null;
    cabecalhos?: Record<string, string>;
    tipo?: string;
  } = {},
  env = ENV,
): Promise<Response> {
  const texto = typeof corpo === "string" ? corpo : JSON.stringify(corpo);
  const cabecalhos = new Headers({
    "content-type": opcoes.tipo ?? "application/json",
    ...(opcoes.cabecalhos ?? {}),
  });
  const passe =
    opcoes.passe === undefined
      ? assinarPasse(SENHA_DO_WEBHOOK, new Date())
      : opcoes.passe;
  if (passe) cabecalhos.set("authorization", `Bearer ${passe}`);

  const resposta = await receberWebhook(
    new Request("http://localhost:3001/api/whatsapp/webhook", {
      method: "POST",
      headers: cabecalhos,
      body: texto,
    }),
    { agendar, env },
  );
  await Promise.all(tarefas.splice(0));
  return resposta;
}

const entregar = (id: string) =>
  entregarAvisos({
    agora: new Date(),
    limite: 5,
    apenasId: id,
    env: ENV,
    esperar: semEspera,
  });

const aviso = (id: string) =>
  db.avisoWhatsapp.findUniqueOrThrow({ where: { id } });
const conexao = () =>
  db.instanciaWhatsapp.findUniqueOrThrow({ where: { id: cenario.conexaoId } });

async function avisoConfirmado(titulo: string): Promise<string> {
  const ana = await contextoDe(cenario.ana, cenario.centroId);
  const { id } = await criarRascunho(
    ana,
    { titulo, texto: "Aviso de ensaio.", unidadeId: cenario.centroId },
    new Date(),
  );
  const r = await confirmarAviso(ana, id, cenario.vinculoAna, new Date());
  assert.equal(r.confirmado, true);
  return id;
}

before(async () => {
  await limparBancoDeEnsaio();
  cenario = await montarCenario();
  reiniciarSimulador();
});

after(async () => {
  await db.$disconnect();
});

describe("fluxo principal", () => {
  test("fechamento → rascunho → confirmação → aceito → entregue → lido", async () => {
    reiniciarSimulador();
    const agora = new Date();

    assert.equal(await coletarRascunhos(agora, ENV.APP_URL ?? null), 1);
    assert.equal(
      await coletarRascunhos(agora, ENV.APP_URL ?? null),
      0,
      "o mesmo fechamento virou dois rascunhos",
    );

    const rascunho = await db.avisoWhatsapp.findFirstOrThrow({
      where: {
        idPedido: `checklists:fechamento:${cenario.respostaFechamentoId}`,
      },
    });
    assert.equal(rascunho.status, "RASCUNHO");
    assert.equal(
      rascunho.solicitadoPorId,
      null,
      "nasceu de um evento do sistema",
    );
    assert.ok(rascunho.corpo.startsWith("*Fechamento pronto para revisão*"));
    assert.match(rascunho.corpo, /Loja: Loja Centro \(ensaio\)/);
    assert.match(rascunho.corpo, /por Ana Ensaio/);
    assert.match(rascunho.corpo, /Nota: 85,7% · 2 itens fora do padrão/);
    assert.ok(
      rascunho.corpo.includes(
        `Revise: http://localhost:3001/checklists/${cenario.respostaFechamentoId}`,
      ),
    );
    assert.match(rascunho.corpo, /Ref\. AV-[2-9A-HJ-NP-Z]{6}$/);
    assert.equal(simulador().tentativasDeEnvio, 0, "rascunho saiu sozinho");

    // A operadora prepara, mas não confirma.
    const carla = await contextoDe(cenario.carla, cenario.centroId);
    await assert.rejects(
      confirmarAviso(carla, rascunho.id, cenario.vinculoAna, agora),
      SemPermissao,
    );
    // Destinatário vinculado mas não autorizado não serve.
    const ana = await contextoDe(cenario.ana, cenario.centroId);
    await assert.rejects(
      confirmarAviso(ana, rascunho.id, cenario.vinculoCarla, agora),
      /autorizad/,
    );

    const r = await confirmarAviso(ana, rascunho.id, cenario.vinculoAna, agora);
    assert.equal(r.confirmado, true);
    await entregar(rascunho.id);

    const aceito = await aviso(rascunho.id);
    assert.equal(aceito.status, "ACEITO");
    assert.ok(aceito.aceitoEm);
    assert.equal(
      aceito.entregueEm,
      null,
      "aceito pelo provedor não é entregue",
    );
    assert.equal(simulador().enviadas.length, 1);
    assert.equal(simulador().enviadas[0].para, "5511900000012");
    assert.equal(simulador().enviadas[0].texto, rascunho.corpo);

    await webhook(
      envelope("messages.update", {
        keyId: aceito.idMensagemProvedor,
        fromMe: true,
        status: "DELIVERY_ACK",
      }),
    );
    assert.equal((await aviso(rascunho.id)).status, "ENTREGUE");

    await webhook(
      envelope("messages.update", {
        keyId: aceito.idMensagemProvedor,
        fromMe: true,
        status: "READ",
      }),
    );
    const lido = await aviso(rascunho.id);
    assert.equal(lido.status, "LIDO");
    assert.ok(lido.lidoEm);
    assert.equal(lido.confirmadoPorId, cenario.ana);
  });
});

describe("os 12 cenários de aceite", () => {
  test("1 · conexão sem segredo mostra configuração pendente", async () => {
    const real = await db.instanciaWhatsapp.create({
      data: {
        organizacaoId: cenario.organizacaoId,
        nome: "loja-real",
        provedor: "EVOLUTION_BAILEYS",
        unidadeId: cenario.centroId,
      },
    });
    try {
      const diretor = await contextoDe(cenario.diretor, null);
      const tela = await lerConexaoParaTela(
        diretor,
        real.id,
        { NODE_ENV: "test" },
        new Date(),
      );
      assert.equal(tela.estado, "PENDENTE");
      assert.match(tela.motivo ?? "", /EVOLUTION_INSTANCIA/);
      assert.match(tela.motivo ?? "", /EVOLUTION_API_KEY/);

      // "Pendente" é calculado na leitura: nada virou estado gravado.
      const gravada = await db.instanciaWhatsapp.findUniqueOrThrow({
        where: { id: real.id },
      });
      assert.equal(gravada.estado, "DESCONECTADO");
      assert.equal(gravada.motivoAtencao, null);
    } finally {
      await db.instanciaWhatsapp.update({
        where: { id: real.id },
        data: { excluidoEm: new Date() },
      });
    }
  });

  test("2 · credencial inválida não vaza em erro", async () => {
    // Uma Evolution de mentira que responde 401 e ECOA a chave recebida.
    const servidor: Server = createServer((req, res) => {
      req.resume();
      req.on("end", () => {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: 401,
            error: "Unauthorized",
            response: {
              message: `apikey ${String(req.headers.apikey)} inválida`,
            },
          }),
        );
      });
    });
    await new Promise<void>((pronto) =>
      servidor.listen(0, "127.0.0.1", pronto),
    );
    const env = {
      ...ENV,
      EVOLUTION_URL: `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`,
      EVOLUTION_INSTANCIA: "loja-chave-errada",
      EVOLUTION_API_KEY: CHAVE_FICTICIA,
    };
    const errada = await db.instanciaWhatsapp.create({
      data: {
        organizacaoId: cenario.organizacaoId,
        nome: "loja-chave-errada",
        provedor: "EVOLUTION_BAILEYS",
        unidadeId: cenario.centroId,
        estado: "CONECTADO",
        vistoEm: new Date(),
      },
    });

    const saidas: string[] = [];
    const originais = {
      error: console.error,
      warn: console.warn,
      log: console.log,
    };
    for (const nivel of ["error", "warn", "log"] as const) {
      console[nivel] = (...partes: unknown[]) => {
        saidas.push(partes.map(String).join(" "));
      };
    }

    try {
      await atualizarSaude({ agora: new Date(), env, apenasId: errada.id });
      const depois = await db.instanciaWhatsapp.findUniqueOrThrow({
        where: { id: errada.id },
      });
      assert.equal(depois.estado, "ATENCAO");
      assert.match(depois.motivoAtencao ?? "", /recusou a chave/);

      // O número volta a parecer conectado, e um aviso confirmado tenta sair.
      await db.instanciaWhatsapp.update({
        where: { id: errada.id },
        data: { estado: "CONECTADO", vistoEm: new Date() },
      });
      const confirmado = await db.avisoWhatsapp.create({
        data: {
          organizacaoId: cenario.organizacaoId,
          unidadeId: cenario.centroId,
          instanciaId: errada.id,
          idPedido: "ensaio:cenario-2",
          referencia: gerarReferencia(),
          origemTipo: "manual",
          titulo: "Cenário 2",
          corpo: "*Cenário 2*\nRef. AV-CEN002",
          destinatarioRef: cenario.vinculoAna,
          status: "CONFIRMADO",
          confirmadoEm: new Date(),
          confirmadoPorId: cenario.ana,
        },
      });
      await entregarAvisos({
        agora: new Date(),
        limite: 5,
        apenasId: confirmado.id,
        env,
        esperar: semEspera,
      });

      const falhou = await aviso(confirmado.id);
      assert.equal(falhou.status, "FALHOU");
      assert.match(falhou.erro ?? "", /recusou a chave/);

      // Nada gravado em lugar nenhum, nem nada impresso, carrega a chave.
      assert.ok(!(await exportarBanco(URL_DO_BANCO)).includes(CHAVE_FICTICIA));
      assert.ok(!saidas.join("\n").includes(CHAVE_FICTICIA));
    } finally {
      Object.assign(console, originais);
      servidor.closeAllConnections();
      servidor.close();
      await db.instanciaWhatsapp.update({
        where: { id: errada.id },
        data: { excluidoEm: new Date() },
      });
    }
  });

  test("3 · evento repetido não duplica trabalho", async () => {
    reiniciarSimulador();
    const id = await avisoConfirmado("Cenário 3");
    await entregar(id);
    const aceito = await aviso(id);
    assert.equal(aceito.status, "ACEITO");

    const corpo = envelope("messages.update", {
      keyId: aceito.idMensagemProvedor,
      remoteJid: "5511900000012@s.whatsapp.net",
      fromMe: true,
      status: "DELIVERY_ACK",
    });

    const primeira = await webhook(corpo);
    assert.equal(primeira.status, 200);
    assert.deepEqual(await primeira.json(), { ok: true, duplicado: false });
    const entregue = await aviso(id);
    assert.equal(entregue.status, "ENTREGUE");

    const segunda = await webhook(corpo);
    assert.equal(segunda.status, 200);
    assert.deepEqual(await segunda.json(), { ok: true, duplicado: true });

    const eventos = await db.eventoWhatsapp.findMany({
      where: { idExterno: `status:${aceito.idMensagemProvedor}:DELIVERY_ACK` },
    });
    assert.equal(eventos.length, 1);
    assert.equal(eventos[0].repeticoes, 1);
    assert.deepEqual((await aviso(id)).entregueEm, entregue.entregueEm);
  });

  test("4 · mensagem própria não inicia ciclo", async () => {
    reiniciarSimulador();
    const avisosAntes = await db.avisoWhatsapp.count();

    const r1 = await webhook(
      envelope("send.message", {
        key: {
          id: "3EB0PROPRIA01",
          remoteJid: "5511900000012@s.whatsapp.net",
          fromMe: true,
        },
        message: { conversation: "mensagem digitada fora do Tetteo" },
        messageTimestamp: Math.floor(Date.now() / 1000),
      }),
    );
    const r2 = await webhook(
      envelope("messages.upsert", {
        key: {
          id: "3EB0PROPRIA02",
          remoteJid: "5511900000012@s.whatsapp.net",
          fromMe: true,
        },
        message: { conversation: "oi de mim mesmo" },
      }),
    );
    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);

    const envio = await db.eventoWhatsapp.findFirstOrThrow({
      where: { idExterno: "envio:3EB0PROPRIA01" },
    });
    const entrada = await db.eventoWhatsapp.findFirstOrThrow({
      where: { idExterno: "entrada:3EB0PROPRIA02" },
    });
    assert.equal(envio.status, "IGNORADO");
    assert.equal(entrada.status, "IGNORADO");
    assert.match(entrada.motivo ?? "", /próprio número/);

    assert.equal(await db.avisoWhatsapp.count(), avisosAntes);
    assert.equal(simulador().tentativasDeEnvio, 0);

    const guardado = JSON.stringify([envio.resumo, entrada.resumo]);
    assert.ok(!guardado.includes("5511900000012"), "o contato foi guardado");
    assert.ok(!guardado.includes("oi de mim"), "o texto foi guardado");
  });

  test("5 · usuário de outra loja não vê o QR Code", async () => {
    reiniciarSimulador({ estado: "DESCONECTADO" });

    // Responsável, mas da Loja Sul.
    const bruno = await contextoDe(cenario.bruno, cenario.sulId);
    await assert.rejects(
      pedirQrCodeDaConexao(bruno, cenario.conexaoId, ENV),
      SemPermissao,
    );
    // Da Loja Centro, mas operadora.
    const carla = await contextoDe(cenario.carla, cenario.centroId);
    await assert.rejects(
      pedirQrCodeDaConexao(carla, cenario.conexaoId, ENV),
      SemPermissao,
    );
    assert.equal(
      simulador().qrPedidos,
      0,
      "o QR foi pedido para quem não pode ver",
    );

    const ana = await contextoDe(cenario.ana, cenario.centroId);
    const qr = await pedirQrCodeDaConexao(ana, cenario.conexaoId, ENV);
    assert.equal(qr.tipo, "qr");
    reiniciarSimulador();
  });

  test("6 · uma confirmação envia uma única mensagem", async () => {
    reiniciarSimulador();
    const ana = await contextoDe(cenario.ana, cenario.centroId);
    const { id } = await criarRascunho(
      ana,
      {
        titulo: "Cenário 6",
        texto: "Uma vez só.",
        unidadeId: cenario.centroId,
      },
      new Date(),
    );

    const [a, b] = await Promise.all([
      confirmarAviso(ana, id, cenario.vinculoAna, new Date()),
      confirmarAviso(ana, id, cenario.vinculoAna, new Date()),
    ]);
    assert.equal([a.confirmado, b.confirmado].filter(Boolean).length, 1);

    await Promise.all([entregar(id), entregar(id)]);
    assert.equal(simulador().enviadas.length, 1);
    assert.equal((await aviso(id)).status, "ACEITO");

    // Confirmar de novo um aviso que já saiu não faz nada.
    assert.equal(
      (await confirmarAviso(ana, id, cenario.vinculoAna, new Date()))
        .confirmado,
      false,
    );
    await entregar(id);
    assert.equal(simulador().enviadas.length, 1);
  });

  test("7 · tempo esgotado vira pendência rastreável, sem reenvio automático", async () => {
    reiniciarSimulador({ comportamento: "tempo-esgotado-nao-saiu" });
    const id = await avisoConfirmado("Cenário 7");
    await entregar(id);

    let pendente = await aviso(id);
    assert.equal(pendente.status, "INCERTO");
    assert.match(pendente.erro ?? "", /pode ter saído/);
    assert.equal(simulador().tentativasDeEnvio, 1);

    // O relógio consulta o provedor — e não acha.
    const depois = new Date(Date.now() + 30_000);
    await verificarIncertos({ agora: depois, env: ENV });
    pendente = await aviso(id);
    assert.equal(pendente.status, "INCERTO");
    assert.equal(pendente.verificacoes, 1);
    assert.match(pendente.erro ?? "", /Não encontrada no provedor/);

    // A entrega não pega o incerto de novo.
    await entregarAvisos({
      agora: depois,
      limite: 5,
      env: ENV,
      esperar: semEspera,
    });
    assert.equal(simulador().tentativasDeEnvio, 1, "reenviou sozinho");

    // Quem decide é uma pessoa.
    const ana = await contextoDe(cenario.ana, cenario.centroId);
    assert.equal((await reenviarAviso(ana, id, new Date())).reenviado, true);
    assert.equal((await aviso(id)).status, "CONFIRMADO");
    await db.avisoWhatsapp.update({
      where: { id },
      data: { status: "DESCARTADO" },
    });
  });

  test("7 · …e quando a mensagem SAIU, a consulta acha e não duplica", async () => {
    reiniciarSimulador({ comportamento: "tempo-esgotado-saiu" });
    const id = await avisoConfirmado("Cenário 7 (saiu)");
    await entregar(id);
    assert.equal((await aviso(id)).status, "INCERTO");

    simulador().comportamento = "aceita";
    await verificarIncertos({ agora: new Date(Date.now() + 30_000), env: ENV });
    const achado = await aviso(id);
    assert.equal(achado.status, "ACEITO");
    assert.ok(achado.idMensagemProvedor);
    assert.equal(simulador().enviadas.length, 1);
  });

  test("8 · desconexão muda o estado", async () => {
    const r = await webhook(
      envelope("connection.update", {
        instance: "loja-ensaio",
        state: "close",
        statusReason: 401,
      }),
    );
    assert.equal(r.status, 200);
    const c = await conexao();
    assert.equal(c.estado, "DESCONECTADO");
    assert.ok(c.desconectadaEm);
  });

  test("9 · reconexão não apaga o histórico", async () => {
    const antes = {
      avisos: await db.avisoWhatsapp.count(),
      eventos: await db.eventoWhatsapp.count(),
    };

    reiniciarSimulador({ estado: "DESCONECTADO" });
    const ana = await contextoDe(cenario.ana, cenario.centroId);
    assert.equal(
      (await pedirQrCodeDaConexao(ana, cenario.conexaoId, ENV)).tipo,
      "qr",
    );

    simulador().estado = "CONECTADO";
    await webhook(
      envelope("connection.update", {
        instance: "loja-ensaio",
        wuid: "5511900000001@s.whatsapp.net",
        state: "open",
        statusReason: 200,
      }),
    );
    assert.equal((await conexao()).estado, "CONECTADO");
    assert.equal(await db.avisoWhatsapp.count(), antes.avisos);
    assert.equal(await db.eventoWhatsapp.count(), antes.eventos + 1);

    // O contrato nem tem como desconectar.
    const metodos = Object.keys(criarProvedorSimulado());
    assert.ok(metodos.every((m) => !/logout|delete|desconectar/i.test(m)));
    const fonte = readFileSync("src/connectors/whatsapp/evolution.ts", "utf8");
    assert.ok(!/\/instance\/(logout|delete)/.test(fonte));
  });

  test("10 · webhook malformado é rejeitado — e nada é gravado", async () => {
    const antes = await db.eventoWhatsapp.count();
    const valido = envelope("messages.update", {
      keyId: "3EB0X",
      status: "READ",
    });

    assert.equal((await webhook("{ quebrado")).status, 400);
    assert.equal(
      (
        await webhook(
          envelope("qrcode.updated", {
            qrcode: { base64: "data:image/png;base64,QUJD" },
          }),
        )
      ).status,
      422,
    );
    assert.equal((await webhook(valido, { passe: null })).status, 401);
    assert.equal(
      (
        await webhook(valido, {
          passe: assinarPasse("outra-senha-qualquer-0001", new Date()),
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await webhook(valido, {
          passe: assinarPasse(
            SENHA_DO_WEBHOOK,
            new Date(Date.now() - 20 * 60_000),
          ),
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await webhook({
          ...valido,
          data: { keyId: "3EB0X", status: "READ", lixo: "x".repeat(300_000) },
        })
      ).status,
      413,
    );
    assert.equal(
      (
        await webhook(
          envelope(
            "messages.update",
            { keyId: "3EB0X", status: "READ" },
            "instancia-que-nao-existe",
          ),
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await webhook(valido, {
          cabecalhos: { "x-forwarded-server": "traefik" },
        })
      ).status,
      403,
    );
    assert.equal(
      (await webhook(valido, { cabecalhos: { "x-real-ip": "203.0.113.9" } }))
        .status,
      403,
    );
    assert.equal((await webhook(valido, { tipo: "text/plain" })).status, 415);
    assert.equal((await webhook(valido, {}, { NODE_ENV: "test" })).status, 503);

    assert.equal(await db.eventoWhatsapp.count(), antes);
  });

  test("11 · envio pausado não dispara", async () => {
    reiniciarSimulador();
    await db.instanciaWhatsapp.update({
      where: { id: cenario.conexaoId },
      data: { ativa: false },
    });
    const id = await avisoConfirmado("Cenário 11");
    await entregarAvisos({
      agora: new Date(),
      limite: 5,
      env: ENV,
      esperar: semEspera,
    });
    assert.equal((await aviso(id)).status, "CONFIRMADO");
    assert.equal(simulador().tentativasDeEnvio, 0);
    await db.avisoWhatsapp.update({
      where: { id },
      data: { status: "DESCARTADO" },
    });
    await db.instanciaWhatsapp.update({
      where: { id: cenario.conexaoId },
      data: { ativa: true },
    });

    // Agendamentos da Severina nascem pausados: um agente vencendo AGORA, com
    // a chave geral ligada, não enfileira nada.
    assert.equal((await conexao()).agendamentosPausados, true);
    const agora = new Date();
    const horario = `${String(agora.getHours()).padStart(2, "0")}:${String(agora.getMinutes()).padStart(2, "0")}`;
    await db.agenteSeverina.create({
      data: {
        organizacaoId: cenario.organizacaoId,
        nome: "Cobrança de ensaio",
        tipo: "AVISO",
        gatilho: "HORARIO",
        gatilhoConfig: { horario, diasDaSemana: [] },
        destinatariosUsuarios: [cenario.ana],
        instrucoes: "Lembrar de conferir o forno.",
      },
    });
    assert.equal(await dispararAgentes(agora), 0);
    assert.equal(await db.mensagemWhatsapp.count(), 0);
  });

  test("12 · restauração recupera a configuração sem publicar segredos", async () => {
    const copia = await exportarBanco(URL_DO_BANCO);
    for (const segredo of [SENHA_DO_WEBHOOK, CHAVE_FICTICIA]) {
      assert.ok(!copia.includes(segredo), "segredo dentro do backup");
    }
    assert.ok(!copia.includes("data:image"), "QR Code dentro do backup");

    execSync("npx prisma migrate deploy", {
      env: {
        ...process.env,
        DATABASE_URL: URL_DO_BANCO_RESTAURADO,
        CHECKPOINT_DISABLE: "1",
      },
      stdio: "pipe",
    });
    await restaurarBanco(URL_DO_BANCO_RESTAURADO, copia);

    const [restaurada] = await consultar(
      URL_DO_BANCO_RESTAURADO,
      `select nome, provedor::text, "unidadeId", "agendamentosPausados"
         from instancia_whatsapp where id = $1`,
      [cenario.conexaoId],
    );
    assert.deepEqual(restaurada, {
      nome: "loja-ensaio",
      provedor: "SIMULADO",
      unidadeId: cenario.centroId,
      agendamentosPausados: true,
    });
    const [autorizados] = await consultar<{ n: number }>(
      URL_DO_BANCO_RESTAURADO,
      `select count(*)::int as n from vinculo_whatsapp where "autorizadoEm" is not null`,
    );
    assert.equal(autorizados.n, 1);
    const [avisos] = await consultar<{ n: number }>(
      URL_DO_BANCO_RESTAURADO,
      `select count(*)::int as n from aviso_whatsapp`,
    );
    assert.equal(avisos.n, await db.avisoWhatsapp.count());
  });
});
