import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { reiniciarSimulador, simulador } from "@/connectors/whatsapp/simulado";
import { enfileirarNotaWhatsapp } from "@/modules/assistente/services/notas-fila";
import { db } from "@/server/db";
import { processarNotasWhatsapp } from "./notas-worker";

const target = new URL(process.env.DATABASE_URL ?? "postgresql://invalid");
if (
  !["localhost", "127.0.0.1"].includes(target.hostname) ||
  !target.pathname.includes("_test")
)
  throw new Error("Exige PostgreSQL local exclusivo _test.");
after(async () => db.$disconnect());

async function fixture() {
  const org = await db.organizacao.create({
    data: { nome: "Fila de notas fictícias", slug: randomUUID() },
  });
  const unidade = await db.unidade.create({
    data: { organizacaoId: org.id, nome: "Cozinha de teste", codigo: "QA" },
  });
  const usuario = await db.usuario.create({
    data: {
      nome: "Responsável de teste",
      email: `${randomUUID()}@example.invalid`,
      status: "ATIVO",
    },
  });
  const papel = await db.papel.create({
    data: {
      organizacaoId: org.id,
      nome: "Direção fictícia",
      permissoes: { create: { chave: "*" } },
    },
  });
  await db.acesso.create({
    data: {
      usuarioId: usuario.id,
      organizacaoId: org.id,
      unidadeId: unidade.id,
      papelId: papel.id,
    },
  });
  const instancia = await db.instanciaWhatsapp.create({
    data: {
      organizacaoId: org.id,
      unidadeId: unidade.id,
      nome: `ensaio-${randomUUID()}`,
      provedor: "SIMULADO",
      ativa: true,
    },
  });
  const vinculo = await db.vinculoWhatsapp.create({
    data: {
      organizacaoId: org.id,
      usuarioId: usuario.id,
      remoteJid: `${randomUUID()}@lid`,
      telefone: "5511900000021",
      autorizadoEm: new Date(),
    },
  });
  const conversa = await db.conversaNotaWhatsapp.create({
    data: {
      organizacaoId: org.id,
      unidadeId: unidade.id,
      usuarioId: usuario.id,
      instanciaId: instancia.id,
      vinculoId: vinculo.id,
    },
  });
  const entrada = (
    id = randomUUID(),
    foto = true,
    texto?: string,
    recebidaEm = new Date(),
  ) =>
    enfileirarNotaWhatsapp(instancia.id, vinculo.id, {
      idMensagem: id,
      foto,
      texto,
      recebidaEm,
    });
  const saida = (
    texto: string,
    data: {
      tipo?: string;
      notaId?: string;
      idExterno?: string;
      estado?: string;
      tentativas?: number;
      enviadaEm?: Date;
      atualizadoEm?: Date;
    } = {},
  ) =>
    db.mensagemNotaWhatsapp.create({
      data: {
        conversaId: conversa.id,
        instanciaId: instancia.id,
        idExterno: randomUUID(),
        direcao: "SAIDA",
        texto,
        recebidoEm: new Date(),
        ...data,
      },
    });
  const rodar = (
    tratar: (id: string, leaseDono?: string) => Promise<void> = async () => {},
  ) =>
    processarNotasWhatsapp({
      instanciaId: instancia.id,
      env: { NODE_ENV: "test" },
      tratar,
    });
  return {
    org,
    unidade,
    usuario,
    instancia,
    vinculo,
    conversa,
    entrada,
    saida,
    rodar,
  };
}

test("entrada deduplica corridas e recusa histórico, data futura e conversa pessoal", async () => {
  const f = await fixture();
  assert.equal(
    await f.entrada(
      randomUUID(),
      true,
      undefined,
      new Date(Date.now() - 25 * 60 * 60_000),
    ),
    false,
  );
  assert.equal(
    await f.entrada(
      randomUUID(),
      true,
      undefined,
      new Date(Date.now() + 60_000),
    ),
    false,
  );
  assert.equal(await f.entrada(randomUUID(), false, "boa noite"), false);
  const id = randomUUID();
  assert.deepEqual(await Promise.all([f.entrada(id), f.entrada(id)]), [
    true,
    true,
  ]);
  assert.equal(
    await db.mensagemNotaWhatsapp.count({
      where: { conversaId: f.conversa.id, direcao: "ENTRADA" },
    }),
    1,
  );
});

test("teto de fotos considera a pessoa em todos os canais e não cobra repetição", async () => {
  const f = await fixture();
  const ids = Array.from({ length: 20 }, () => randomUUID());
  for (const id of ids) assert.equal(await f.entrada(id), true);
  assert.equal(await f.entrada(ids[0]), true);
  const outroCanal = await db.instanciaWhatsapp.create({
    data: {
      organizacaoId: f.org.id,
      unidadeId: f.unidade.id,
      nome: `ensaio-extra-${randomUUID()}`,
      provedor: "SIMULADO",
    },
  });
  assert.equal(
    await enfileirarNotaWhatsapp(outroCanal.id, f.vinculo.id, {
      idMensagem: randomUUID(),
      foto: true,
      recebidaEm: new Date(),
    }),
    false,
  );
  assert.equal(
    await db.mensagemNotaWhatsapp.count({
      where: { conversaId: f.conversa.id },
    }),
    20,
  );
});

test("duas réplicas não processam a mesma entrada e lease vencido é recuperável", async () => {
  const f = await fixture();
  await f.entrada();
  await db.conversaNotaWhatsapp.update({
    where: { id: f.conversa.id },
    data: {
      leaseDono: "processo-antigo",
      leaseAte: new Date(Date.now() - 1000),
    },
  });
  let chamadas = 0;
  const tratar = async (_id: string, leaseDono?: string) => {
    assert.ok(leaseDono);
    chamadas++;
    await new Promise((resolver) => setTimeout(resolver, 40));
  };
  await Promise.all([f.rodar(tratar), f.rodar(tratar)]);
  assert.equal(chamadas, 1);
  const m = await db.mensagemNotaWhatsapp.findFirstOrThrow({
    where: { conversaId: f.conversa.id, direcao: "ENTRADA" },
  });
  assert.equal(m.estado, "PROCESSADA");
  assert.equal(m.tentativas, 1);
});

test("falhas transitórias têm três tentativas e mensagem final sem afirmar estorno", async () => {
  reiniciarSimulador();
  const f = await fixture();
  await f.entrada();
  let chamadas = 0;
  const tratar = async () => {
    chamadas++;
    throw new Error("falha sintética privada");
  };
  for (let i = 0; i < 4; i++) await f.rodar(tratar);
  assert.equal(chamadas, 3);
  const m = await db.mensagemNotaWhatsapp.findFirstOrThrow({
    where: { conversaId: f.conversa.id, direcao: "ENTRADA" },
  });
  assert.equal(m.estado, "FALHA");
  const resposta = await db.mensagemNotaWhatsapp.findFirstOrThrow({
    where: { conversaId: f.conversa.id, direcao: "SAIDA" },
  });
  assert.match(resposta.texto!, /Confira a situação da nota no sistema/);
  assert.doesNotMatch(
    resposta.texto!,
    /sintética privada|Nenhum lançamento|estorno/,
  );
});

test("envio incerto encontrado é confirmado sem nova tentativa de envio", async () => {
  reiniciarSimulador({ comportamento: "tempo-esgotado-saiu" });
  const f = await fixture();
  const m = await f.saida(`Mensagem fictícia única ${randomUUID()}`);
  await f.rodar();
  assert.equal(
    (await db.mensagemNotaWhatsapp.findUniqueOrThrow({ where: { id: m.id } }))
      .estado,
    "INCERTA",
  );
  assert.equal(simulador().tentativasDeEnvio, 1);
  await f.rodar();
  assert.equal(
    (await db.mensagemNotaWhatsapp.findUniqueOrThrow({ where: { id: m.id } }))
      .estado,
    "ENVIADA",
  );
  assert.equal(simulador().tentativasDeEnvio, 1);
});

test("envio incerto não encontrado e ENVIANDO abandonado nunca são reenviados", async () => {
  reiniciarSimulador({ comportamento: "tempo-esgotado-nao-saiu" });
  const f = await fixture();
  const m = await f.saida(`Mensagem fictícia não entregue ${randomUUID()}`);
  await f.rodar();
  simulador().comportamento = "aceita";
  await f.rodar();
  assert.equal(simulador().tentativasDeEnvio, 1);
  assert.equal(
    (await db.mensagemNotaWhatsapp.findUniqueOrThrow({ where: { id: m.id } }))
      .estado,
    "INCERTA",
  );
  const abandonada = await f.saida(`Envio interrompido ${randomUUID()}`, {
    estado: "ENVIANDO",
    tentativas: 1,
    enviadaEm: new Date(Date.now() - 300_000),
    atualizadoEm: new Date(Date.now() - 300_000),
  });
  await f.rodar();
  assert.equal(
    (
      await db.mensagemNotaWhatsapp.findUniqueOrThrow({
        where: { id: abandonada.id },
      })
    ).estado,
    "INCERTA",
  );
  assert.equal(simulador().tentativasDeEnvio, 1);
});

test("resumo antigo é cancelado e apenas resumo vigente aceito abre confirmação", async () => {
  reiniciarSimulador();
  const f = await fixture();
  const nota = await db.notaFiscalWhatsapp.create({
    data: {
      organizacaoId: f.org.id,
      unidadeId: f.unidade.id,
      instanciaId: f.instancia.id,
      vinculoId: f.vinculo.id,
      usuarioId: f.usuario.id,
      mensagemId: randomUUID(),
      estado: "PRONTA",
      revisao: 2,
      codigo: "TESTE",
      resumoHash: "hash-sintetico",
    },
  });
  await db.conversaNotaWhatsapp.update({
    where: { id: f.conversa.id },
    data: { notaAtivaId: nota.id },
  });
  const antiga = await f.saida("Resumo antigo confidencial", {
    tipo: "RESUMO",
    notaId: nota.id,
    idExterno: `resumo:${nota.id}:1`,
  });
  const atual = await f.saida("Resumo atual TESTE", {
    tipo: "RESUMO",
    notaId: nota.id,
    idExterno: `resumo:${nota.id}:2`,
  });
  await f.rodar();
  assert.equal(
    (
      await db.mensagemNotaWhatsapp.findUniqueOrThrow({
        where: { id: antiga.id },
      })
    ).estado,
    "CANCELADA",
  );
  assert.equal(
    (
      await db.mensagemNotaWhatsapp.findUniqueOrThrow({
        where: { id: atual.id },
      })
    ).estado,
    "ENVIADA",
  );
  assert.equal(simulador().enviadas.length, 1);
  assert.equal(simulador().enviadas[0].texto, atual.texto);
  const pronta = await db.notaFiscalWhatsapp.findUniqueOrThrow({
    where: { id: nota.id },
  });
  assert.ok(pronta.resumoEm);
  assert.equal(
    pronta.expiraEm!.getTime() - pronta.resumoEm.getTime(),
    30 * 60_000,
  );
});

test("revogar o vínculo impede processar entrada e entregar dados pendentes", async () => {
  reiniciarSimulador();
  const f = await fixture();
  await f.entrada();
  const m = await f.saida("Resumo confidencial fictício");
  await db.vinculoWhatsapp.update({
    where: { id: f.vinculo.id },
    data: { autorizadoEm: null },
  });
  let chamadas = 0;
  await f.rodar(async () => {
    chamadas++;
  });
  assert.equal(chamadas, 0);
  assert.equal(simulador().tentativasDeEnvio, 0);
  assert.equal(
    (await db.mensagemNotaWhatsapp.findUniqueOrThrow({ where: { id: m.id } }))
      .estado,
    "CANCELADA",
  );
});

test("outbox aceita canal de rede somente com uma unidade ativa inequívoca", async () => {
  reiniciarSimulador();
  const f = await fixture();
  await db.instanciaWhatsapp.update({
    where: { id: f.instancia.id },
    data: { unidadeId: null },
  });
  const primeira = await f.saida("Resposta da única unidade ativa");
  await f.rodar();
  assert.equal(
    (
      await db.mensagemNotaWhatsapp.findUniqueOrThrow({
        where: { id: primeira.id },
      })
    ).estado,
    "ENVIADA",
  );
  assert.equal(simulador().tentativasDeEnvio, 1);
  await db.unidade.create({
    data: {
      organizacaoId: f.org.id,
      nome: "Segunda unidade ativa",
      codigo: "QB",
    },
  });
  const ambigua = await f.saida(
    "Resposta que não pode escolher a unidade pelo usuário",
  );
  await f.rodar();
  assert.equal(
    (
      await db.mensagemNotaWhatsapp.findUniqueOrThrow({
        where: { id: ambigua.id },
      })
    ).estado,
    "CANCELADA",
  );
  assert.equal(simulador().tentativasDeEnvio, 1);
});
