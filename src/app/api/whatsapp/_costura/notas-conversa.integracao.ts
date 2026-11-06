import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Prisma } from "@prisma/client";
import { gravarArquivoFiscal } from "@/server/notas/arquivos";
import { encryptVirtualCredential } from "@/server/ia/credencial-atendimento";
import { lerXmlFiscal } from "@/server/notas/xml";
import { after, test } from "node:test";
import {
  hashPropostaNota,
  propostaDaConferencia,
  type RascunhoNota,
} from "@/modules/assistente/schemas/conferencia-nota";
import { contextoParaNota } from "@/modules/assistente/services/contexto-nota";
import { db } from "@/server/db";
import {
  notaAssistidaPronta,
  notaFinanceiraPronta,
} from "@/server/nota-assistida-contrato";
import { lancarNotaAssistida } from "./lancar-nota";
import { tratarMensagemNota } from "./notas-conversa";
import { receberWebhook } from "./receber";
import { processarNotasWhatsapp } from "./notas-worker";
import { assinarPasse } from "@/connectors/whatsapp/passe";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://invalid");
assert.ok(
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
    url.pathname.includes("_test"),
  "Somente PostgreSQL local exclusivo de testes.",
);
after(() => db.$disconnect());
const json = (v: unknown) => JSON.parse(JSON.stringify(v));

async function fixtureFinanceira(paga = false) {
  const f = await fixture(paga);
  const categoria = await db.categoriaFinanceira.create({
    data: {
      organizacaoId: f.org.id,
      nome: "Despesa operacional fictícia",
      tipo: "DESPESA",
      grupoDre: "OPERACIONAL",
    },
  });
  const r = structuredClone(f.rascunho);
  r.modo = "FINANCEIRO";
  r.categoriaId = categoria.id;
  delete r.localId;
  r.itens.forEach((i) => {
    delete i.insumoId;
    delete i.novoInsumo;
    delete i.fatorConversao;
  });
  const dados = notaFinanceiraPronta.parse(propostaDaConferencia(r));
  await db.notaFiscalWhatsapp.update({
    where: { id: f.nota.id },
    data: { rascunho: json(r), resumoHash: hashPropostaNota(dados) },
  });
  return { ...f, categoria, rascunho: r, dados };
}

test("resumo oferece LANCAR com código, confirma a despesa e não cria compra, estoque ou vínculo", async () => {
  const f = await fixtureFinanceira();
  await tratarMensagemNota((await f.entrada("RESUMO")).id);
  let n = await f.atual();
  const resumo = await db.mensagemNotaWhatsapp.findFirstOrThrow({
    where: { notaId: n.id, idExterno: `resumo:${n.id}:${n.revisao}` },
  });
  assert.match(resumo.texto!, new RegExp(`LANCAR ${n.codigo}`));
  assert.match(resumo.texto!, /somente Financeiro/);
  assert.doesNotMatch(
    resumo.texto!,
    /dar entrada no estoque|Qual produto corresponde|Onde os produtos/,
  );
  await tratarMensagemNota((await f.entrada("LANCAR ERRADO")).id);
  await f.semEfeito();
  n = await f.atual();
  await f.marcarResumoEnviado();
  const confirmacao = await f.entrada(`LANCAR ${n.codigo}`);
  await tratarMensagemNota(confirmacao.id);
  const lancadas = await db.lancamento.findMany({
    where: { unidadeId: f.unidade.id },
  });
  assert.equal(lancadas.length, 2);
  assert.ok(
    lancadas.every(
      (l) =>
        l.notaEntradaId === null &&
        l.fornecedorId === null &&
        l.categoriaId === f.categoria.id &&
        l.composeDre,
    ),
  );
  assert.equal((await f.atual()).estado, "LANCADA");
  assert.equal(await f.saldo(), "0");
  assert.equal(
    await db.notaEntrada.count({ where: { unidadeId: f.unidade.id } }),
    0,
  );
  assert.equal(
    await db.fornecedor.count({ where: { organizacaoId: f.org.id } }),
    0,
  );
  assert.equal(
    await db.vinculoItemNotaWhatsapp.count({
      where: { unidadeId: f.unidade.id },
    }),
    0,
  );
  await tratarMensagemNota(confirmacao.id);
  await tratarMensagemNota((await f.entrada(`LANCAR ${n.codigo}`)).id);
  assert.equal(
    await db.lancamento.count({ where: { unidadeId: f.unidade.id } }),
    2,
  );
});

test("financeiro recusa categoria inativa, outra organização, conta incompatível, acesso revogado e código não entregue ou vencido", async (t) => {
  for (const caso of [
    "inativa",
    "organizacao",
    "conta",
    "acesso",
    "codigo-nao-entregue",
    "codigo-vencido",
    "hash",
    "baixa",
  ] as const)
    await t.test(caso, async () => {
      const f = await fixtureFinanceira(caso === "conta" || caso === "baixa");
      if (caso === "inativa")
        await db.categoriaFinanceira.update({
          where: { id: f.categoria.id },
          data: { ativa: false },
        });
      if (caso === "organizacao") {
        const outra = await db.organizacao.create({
          data: { nome: "Outra fictícia", slug: randomUUID() },
        });
        await db.categoriaFinanceira.update({
          where: { id: f.categoria.id },
          data: { organizacaoId: outra.id },
        });
      }
      if (caso === "conta")
        await db.contaFinanceira.update({
          where: { id: f.conta.id },
          data: { empresaId: null },
        });
      if (caso === "acesso" || caso === "baixa")
        await db.papelPermissao.deleteMany({
          where: {
            papelId: f.papel.id,
            chave: caso === "baixa" ? "financeiro.quitar" : "financeiro.lancar",
          },
        });
      if (caso === "codigo-nao-entregue")
        await db.notaFiscalWhatsapp.update({
          where: { id: f.nota.id },
          data: { resumoEm: null, expiraEm: null },
        });
      if (caso === "codigo-vencido")
        await db.notaFiscalWhatsapp.update({
          where: { id: f.nota.id },
          data: { expiraEm: new Date(Date.now() - 1000) },
        });
      if (caso === "hash")
        await db.notaFiscalWhatsapp.update({
          where: { id: f.nota.id },
          data: { resumoHash: "hash-alterado" },
        });
      await tratarMensagemNota((await f.entrada("LANCAR ABC123")).id);
      await f.semEfeito();
      assert.notEqual((await f.atual()).estado, "LANCADA");
    });
});

test("financeiro pago é idempotente entre execuções concorrentes e recupera commit sem estoque, mesmo com baixa revogada depois", async () => {
  const f = await fixtureFinanceira(true);
  const m = await f.entrada("LANCAR ABC123");
  await db.notaFiscalWhatsapp.update({
    where: { id: f.nota.id },
    data: { estado: "EXECUTANDO", confirmacaoId: m.id },
  });
  const autorizado = await contextoParaNota(f.instancia.id, f.vinculo.id);
  assert.ok(autorizado);
  const executar = () =>
    lancarNotaAssistida(autorizado.contexto, f.dados, {
      instanciaId: f.instancia.id,
      vinculoId: f.vinculo.id,
    });
  const [a, b] = await Promise.all([executar(), executar()]);
  assert.deepEqual(a, b);
  assert.equal(a.modo, "FINANCEIRO");
  assert.equal((await f.atual()).estado, "EXECUTANDO");
  assert.deepEqual((await f.atual()).resultado, a);
  await db.papelPermissao.deleteMany({
    where: { papelId: f.papel.id, chave: "financeiro.quitar" },
  });
  await tratarMensagemNota(m.id);
  assert.equal((await f.atual()).estado, "LANCADA");
  assert.equal(
    await db.lancamento.count({ where: { unidadeId: f.unidade.id } }),
    1,
  );
  assert.equal(
    await db.baixaFinanceira.count({ where: { unidadeId: f.unidade.id } }),
    1,
  );
  assert.equal(
    await db.notaEntrada.count({ where: { unidadeId: f.unidade.id } }),
    0,
  );
  assert.equal(await f.saldo(), "0");
});

test("outra foto da mesma nota não duplica o financeiro, inclusive se o recibo anterior ainda está EXECUTANDO", async () => {
  const f = await fixtureFinanceira();
  const m = await f.entrada("LANCAR ABC123");
  await db.notaFiscalWhatsapp.update({
    where: { id: f.nota.id },
    data: { estado: "EXECUTANDO", confirmacaoId: m.id },
  });
  const autorizado = await contextoParaNota(f.instancia.id, f.vinculo.id);
  assert.ok(autorizado);
  await lancarNotaAssistida(autorizado.contexto, f.dados, {
    instanciaId: f.instancia.id,
    vinculoId: f.vinculo.id,
  });
  const nova = await db.notaFiscalWhatsapp.create({
    data: {
      organizacaoId: f.org.id,
      unidadeId: f.unidade.id,
      instanciaId: f.instancia.id,
      vinculoId: f.vinculo.id,
      usuarioId: f.usuario.id,
      mensagemId: randomUUID(),
      estado: "PRONTA",
      codigo: "ABC123",
      resumoEm: new Date(Date.now() - 1000),
      expiraEm: new Date(Date.now() + 60000),
    },
  });
  const r = {
    ...f.rascunho,
    operacaoId: nova.id,
    numero: `000${f.rascunho.numero}`,
  };
  await db.notaFiscalWhatsapp.update({
    where: { id: nova.id },
    data: {
      rascunho: json(r),
      resumoHash: hashPropostaNota(
        notaFinanceiraPronta.parse(propostaDaConferencia(r)),
      ),
    },
  });
  await db.conversaNotaWhatsapp.update({
    where: { id: f.conversa.id },
    data: { notaAtivaId: nova.id },
  });
  await tratarMensagemNota((await f.entrada("LANCAR ABC123")).id);
  assert.equal(
    await db.lancamento.count({ where: { unidadeId: f.unidade.id } }),
    2,
  );
  assert.equal(
    (await db.notaFiscalWhatsapp.findUniqueOrThrow({ where: { id: nova.id } }))
      .estado,
    "REVISAO",
  );
  assert.equal(
    await db.notaEntrada.count({ where: { unidadeId: f.unidade.id } }),
    0,
  );
  assert.equal(await f.saldo(), "0");
});

test("nota já lançada manualmente no financeiro ou registrada no fluxo antigo impede outra despesa", async (t) => {
  for (const origem of ["manual", "estoque"] as const)
    await t.test(origem, async () => {
      const f = await fixtureFinanceira();
      const autorizado = await contextoParaNota(f.instancia.id, f.vinculo.id);
      assert.ok(autorizado);
      if (origem === "manual") {
        const pessoa = await db.pessoaFinanceira.create({
          data: {
            organizacaoId: f.org.id,
            unidadeId: f.unidade.id,
            nome: f.dados.fornecedor.nome,
            documento: f.dados.fornecedor.documento,
          },
        });
        await db.lancamento.create({
          data: {
            unidadeId: f.unidade.id,
            empresaId: f.empresa.id,
            pessoaId: pessoa.id,
            categoriaId: f.categoria.id,
            direcao: "PAGAR",
            descricao: "Documento sintético já registrado",
            numeroNotaFiscal: f.dados.numero,
            valor: f.dados.valorTotal,
            vencimento: new Date("2026-12-04T00:00:00Z"),
          },
        });
      } else {
        const categoria = await db.categoriaFinanceira.findFirstOrThrow({
          where: { organizacaoId: f.org.id, grupoDre: "MERCADORIA" },
        });
        const { modo: _modo, ...r } = f.rascunho;
        void _modo;
        r.operacaoId = randomUUID();
        r.localId = f.local.id;
        r.categoriaId = categoria.id;
        r.itens.forEach((i) => {
          i.insumoId = f.insumo.id;
          i.fatorConversao = 3;
        });
        await lancarNotaAssistida(
          autorizado.contexto,
          propostaDaConferencia(r),
        );
      }
      const antes = await db.lancamento.count({
        where: { unidadeId: f.unidade.id },
      });
      await tratarMensagemNota((await f.entrada("LANCAR ABC123")).id);
      assert.equal(
        await db.lancamento.count({ where: { unidadeId: f.unidade.id } }),
        antes,
      );
      assert.equal((await f.atual()).estado, "REVISAO");
      assert.equal(
        await db.notaEntrada.count({ where: { unidadeId: f.unidade.id } }),
        origem === "estoque" ? 1 : 0,
      );
    });
});

test("fluxo antigo não repete financeiro de um documento já confirmado somente no Financeiro", async () => {
  const f = await fixtureFinanceira();
  await tratarMensagemNota((await f.entrada("LANCAR ABC123")).id);
  const autorizado = await contextoParaNota(f.instancia.id, f.vinculo.id);
  assert.ok(autorizado);
  const categoria = await db.categoriaFinanceira.findFirstOrThrow({
    where: { organizacaoId: f.org.id, grupoDre: "MERCADORIA" },
  });
  const { modo: _modo, ...r } = f.rascunho;
  void _modo;
  r.operacaoId = randomUUID();
  r.localId = f.local.id;
  r.categoriaId = categoria.id;
  r.itens.forEach((i) => {
    i.insumoId = f.insumo.id;
    i.fatorConversao = 3;
  });
  await assert.rejects(
    lancarNotaAssistida(autorizado.contexto, propostaDaConferencia(r)),
    /já foi lançado/,
  );
  assert.equal(
    await db.lancamento.count({ where: { unidadeId: f.unidade.id } }),
    2,
  );
  assert.equal(
    await db.notaEntrada.count({ where: { unidadeId: f.unidade.id } }),
    0,
  );
  assert.equal(await f.saldo(), "0");
});

test("foto no webhook Evolution entrega rascunho parcial completo em partes no mesmo WhatsApp, sem web ou lançamento", async (t) => {
  const f = await fixture();
  await db.notaFiscalWhatsapp.update({
    where: { id: f.nota.id },
    data: { estado: "CANCELADA" },
  });
  await db.conversaNotaWhatsapp.update({
    where: { id: f.conversa.id },
    data: { notaAtivaId: null },
  });
  await db.instanciaWhatsapp.update({
    where: { id: f.instancia.id },
    data: { provedor: "EVOLUTION_BAILEYS" },
  });
  const env = {
    NODE_ENV: "test",
    EVOLUTION_URL: "http://evolution.example.test",
    EVOLUTION_INSTANCIA: f.instancia.nome,
    EVOLUTION_API_KEY: "chave-sintetica-evolution",
    WHATSAPP_WEBHOOK_CHAVE: "senha-sintetica-webhook-de-teste",
  };
  for (const k of [
    "EVOLUTION_URL",
    "EVOLUTION_INSTANCIA",
    "EVOLUTION_API_KEY",
  ] as const) {
    const anterior = process.env[k];
    process.env[k] = env[k];
    t.after(() => {
      if (anterior === undefined) delete process.env[k];
      else process.env[k] = anterior;
    });
  }
  const scope = { organizationId: f.org.id, storeId: f.unidade.id };
  await db.avModelConfiguration.create({
    data: {
      ...scope,
      model: "gemini-ficticio",
      encryptedKey: encryptVirtualCredential(scope, "chave-ficticia"),
      enabled: true,
      ratesConfirmed: true,
      testState: "PASSED",
      testedRevision: 1,
      testedAt: new Date(),
      updatedById: f.usuario.id,
      inputMicrosPerMillion: 0,
      outputMicrosPerMillion: 0,
    },
  });
  const d = lerXmlFiscal(
    await readFile("tests/fixtures/notas/nfe-sintetica.xml"),
  );
  await db.categoriaFinanceira.create({
    data: {
      organizacaoId: f.org.id,
      nome: "Limpeza fictícia",
      tipo: "DESPESA",
      grupoDre: "OPERACIONAL",
    },
  });
  d.itens = Array.from({ length: 45 }, (_, n) => ({
    ...structuredClone(d.itens[0]),
    descricao: `PRODUTO FICTICIO ${String(n + 1).padStart(2, "0")} ${"descrição ".repeat(15)}`,
    quantidade: n === 3 ? null : 1,
    valor_unitario: 1,
    valor_total: 1,
  }));
  d.descontos = 0;
  d.acrescimos = null;
  d.total_nota = 45;
  const foto = await readFile("tests/fixtures/notas/cupom-nitido.png");
  const idFoto = randomUUID();
  const enviadas: string[] = [];
  let downloads = 0,
    geracoes = 0;
  t.mock.method(
    globalThis,
    "fetch",
    async (url: string, opcoes: RequestInit) => {
      const body = JSON.parse(String(opcoes.body));
      if (url.includes("/chat/getBase64FromMediaMessage/")) {
        downloads++;
        assert.equal(body.message.key.id, idFoto);
        return Response.json({
          base64: foto.toString("base64"),
          mimetype: "image/png",
        });
      }
      if (url.startsWith("https://generativelanguage.googleapis.com/")) {
        if (url.endsWith(":countTokens"))
          return Response.json({ totalTokens: 1000 });
        geracoes++;
        return Response.json({
          candidates: [
            {
              finishReason: "STOP",
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      ...d,
                      categoria_financeira_indice: 1,
                    }),
                  },
                ],
              },
            },
          ],
          usageMetadata: {
            promptTokenCount: 1000,
            candidatesTokenCount: 100,
            totalTokenCount: 1100,
          },
        });
      }
      if (
        url.startsWith(env.EVOLUTION_URL) &&
        url.includes("/message/sendText/")
      ) {
        assert.equal(body.number, f.vinculo.telefone);
        assert.equal(body.linkPreview, false);
        enviadas.push(body.text);
        return Response.json({
          key: { id: `saida-sintetica-${enviadas.length}` },
        });
      }
      throw Error("Chamada externa inesperada recusada no teste");
    },
  );
  const tarefas: (() => Promise<void>)[] = [];
  const evento = JSON.stringify({
    event: "messages.upsert",
    instance: f.instancia.nome,
    data: {
      key: { id: idFoto, remoteJid: f.vinculo.remoteJid, fromMe: false },
      messageTimestamp: Math.floor(Date.now() / 1000),
      message: { imageMessage: { mimetype: "image/png" } },
    },
  });
  const pedido = () =>
    new Request("http://localhost/api/whatsapp/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        authorization: `Bearer ${assinarPasse(env.WHATSAPP_WEBHOOK_CHAVE, new Date())}`,
      },
      body: evento,
    });
  const resposta = await receberWebhook(pedido(), {
    env,
    agendar: (fn) => tarefas.push(fn),
  });
  assert.equal(resposta.status, 200);
  assert.ok(tarefas.length > 0);
  assert.equal(enviadas.length, 0); // O webhook responde antes da IA e dos envios.
  const rodar = () =>
    processarNotasWhatsapp({
      instanciaId: f.instancia.id,
      env,
      esperar: async () => {
        await db.instanciaWhatsapp.update({
          where: { id: f.instancia.id },
          data: { ultimoEnvioEm: new Date(Date.now() - 5000) },
        });
      },
    });
  await rodar();
  assert.equal(downloads, 1);
  assert.equal(geracoes, 2);
  assert.ok(enviadas.length > 1);
  const texto = enviadas.join("\n");
  for (let n = 1; n <= 45; n++)
    assert.ok(texto.includes(`PRODUTO FICTICIO ${String(n).padStart(2, "0")}`));
  assert.match(texto, /Data: 04\/11\/2026/);
  assert.match(texto, /Quantidade: \*pendente\*/);
  assert.match(texto, /Acréscimo: \*pendente\*/);
  assert.match(texto, /Total: R\$\s45,00/);
  assert.match(texto, new RegExp(`Pagamento na nota: ${d.forma_pagamento}`));
  assert.match(
    texto,
    /Categoria financeira: Limpeza fictícia \(sugerida pelo Gemini; conferir\)/,
  );
  enviadas.forEach((p, n) => {
    assert.ok(p.length <= 3500);
    assert.ok(p.startsWith(`*Parte ${n + 1}/${enviadas.length}*`));
  });
  const notaId = (
    await db.conversaNotaWhatsapp.findUniqueOrThrow({
      where: { id: f.conversa.id },
    })
  ).notaAtivaId!;
  const nota = await db.notaFiscalWhatsapp.findUniqueOrThrow({
    where: { id: notaId },
  });
  assert.equal(nota.rascunho, null);
  assert.equal(nota.codigo, null);
  assert.equal(nota.confirmacaoId, null);
  assert.equal(nota.metodoLeitura, "GEMINI");
  await f.semEfeito();
  const quantidade = enviadas.length;
  await receberWebhook(pedido(), { env, agendar: (fn) => tarefas.push(fn) });
  await rodar();
  assert.equal(downloads, 1);
  assert.equal(geracoes, 2);
  assert.equal(enviadas.length, quantidade);
  await tratarMensagemNota((await f.entrada("OK")).id);
  await f.semEfeito();
  await tratarMensagemNota((await f.entrada("LANÇAR")).id);
  await f.semEfeito();
  assert.equal(geracoes, 2);
  const parcial = await db.notaFiscalWhatsapp.findUniqueOrThrow({
    where: { id: notaId },
  });
  assert.equal(parcial.codigo, null);
  assert.equal(parcial.rascunho, null);
});

test("categoria financeira é escolhida no rascunho parcial, isolada por organização, sem vínculo de estoque ou nova IA", async (t) => {
  const f = await fixture();
  const rede = t.mock.method(globalThis, "fetch", async () => {
    throw Error("Editar rascunho salvo não deve usar IA nem rede");
  });
  const outra = await db.categoriaFinanceira.create({
    data: {
      organizacaoId: f.org.id,
      nome: "Outra mercadoria fictícia",
      tipo: "DESPESA",
      grupoDre: "MERCADORIA",
    },
  });
  await db.categoriaFinanceira.createMany({
    data: [
      {
        organizacaoId: f.org.id,
        nome: "Inativa",
        tipo: "DESPESA",
        grupoDre: "MERCADORIA",
        ativa: false,
      },
      {
        organizacaoId: f.org.id,
        nome: "Receita",
        tipo: "RECEITA",
        grupoDre: "MERCADORIA",
      },
      {
        organizacaoId: f.org.id,
        nome: "Fora do fluxo fiscal",
        tipo: "DESPESA",
        grupoDre: "OPERACIONAL",
      },
    ],
  });
  const estrangeira = await db.organizacao.create({
    data: { nome: "Outra organização fictícia", slug: randomUUID() },
  });
  await db.categoriaFinanceira.create({
    data: {
      organizacaoId: estrangeira.id,
      nome: "Categoria privada de outra organização",
      tipo: "DESPESA",
      grupoDre: "MERCADORIA",
    },
  });
  const d = lerXmlFiscal(
    await readFile("tests/fixtures/notas/nfe-sintetica.xml"),
  );
  d.acrescimos = null;
  d.forma_pagamento = null;
  await db.notaFiscalWhatsapp.update({
    where: { id: f.nota.id },
    data: {
      estado: "REVISAO",
      rascunho: Prisma.DbNull,
      codigo: null,
      resumoHash: null,
      resumoEm: null,
      expiraEm: null,
      leitura: json({
        versao: "fiscal-2.0",
        metodo: "GEMINI",
        original: structuredClone(d),
        conferida: structuredClone(d),
        extras: [],
        alertasConferidos: false,
      }),
    },
  });
  const responder = async (texto: string) => {
    const m = await f.entrada(texto);
    await tratarMensagemNota(m.id);
    await f.semEfeito();
    return f.atual();
  };
  const metadados = (n: Awaited<ReturnType<typeof f.atual>>) =>
    n.leitura as {
      categoriaFinanceira: {
        selecionada: string | null;
        confirmada: boolean;
        opcoes: { nome: string; valor: string }[];
      };
      conferida: typeof d;
      original: typeof d;
    };
  const inicial = await responder("RESUMO");
  const opcoes = metadados(inicial).categoriaFinanceira.opcoes;
  assert.equal(opcoes.length, 3);
  assert.ok(
    opcoes.every(
      (o) =>
        [f.categoria.id, outra.id].includes(o.valor) ||
        o.nome === "Fora do fluxo fiscal",
    ),
  );
  assert.equal(metadados(inicial).categoriaFinanceira.selecionada, null);
  // Inserir antes da opção não pode mudar o significado do número já enviado.
  await db.categoriaFinanceira.create({
    data: {
      organizacaoId: f.org.id,
      nome: "AAA mercadoria",
      tipo: "DESPESA",
      grupoDre: "MERCADORIA",
    },
  });
  const escolhida = opcoes.findIndex((o) => o.valor === outra.id);
  const selecionada = await responder(`CATEGORIA ${escolhida + 1}`);
  assert.equal(
    metadados(selecionada).categoriaFinanceira.selecionada,
    opcoes[escolhida].valor,
  );
  assert.equal(metadados(selecionada).categoriaFinanceira.confirmada, true);
  assert.equal(selecionada.rascunho, null);
  assert.equal(selecionada.codigo, null);
  const invalida = await responder("CATEGORIA 999");
  assert.equal(invalida.revisao, selecionada.revisao);
  assert.equal(
    metadados(invalida).categoriaFinanceira.selecionada,
    opcoes[escolhida].valor,
  );
  const indiceAnterior =
    metadados(selecionada).categoriaFinanceira.opcoes.findIndex(
      (o) => o.valor === outra.id,
    ) + 1;
  await db.categoriaFinanceira.update({
    where: { id: outra.id },
    data: { ativa: false },
  });
  const revogada = await responder(`CATEGORIA ${indiceAnterior}`);
  assert.equal(revogada.revisao, selecionada.revisao);
  const atualizada = await responder("RESUMO");
  assert.equal(metadados(atualizada).categoriaFinanceira.selecionada, null);
  assert.ok(
    !metadados(atualizada).categoriaFinanceira.opcoes.some(
      (o) => o.valor === outra.id,
    ),
  );
  const indice =
    metadados(atualizada).categoriaFinanceira.opcoes.findIndex(
      (o) => o.valor === f.categoria.id,
    ) + 1;
  await responder(`CATEGORIA ${indice}`);
  const pagamento = await responder("CORRIGIR PAGAMENTO PIX");
  assert.equal(metadados(pagamento).conferida.forma_pagamento, "PIX");
  assert.equal(metadados(pagamento).original.forma_pagamento, null);
  assert.equal(pagamento.rascunho, null);
  await responder("CORRIGIR ACRESCIMOS 0");
  const conferida = await responder("CONFERI");
  const r = conferida.rascunho as unknown as RascunhoNota;
  assert.equal(r.categoriaId, f.categoria.id);
  assert.equal(r.pagamento.forma, "PIX");
  assert.equal(r.pagamento.situacao, undefined);
  assert.equal(conferida.confirmacaoId, null);
  // Uma correção explícita também substitui uma forma escolhida depois da leitura.
  await db.notaFiscalWhatsapp.update({
    where: { id: f.nota.id },
    data: {
      rascunho: json({ ...r, pagamento: { ...r.pagamento, forma: "BOLETO" } }),
    },
  });
  const corrigida = await responder("CORRIGIR PAGAMENTO PIX");
  assert.equal(
    (corrigida.rascunho as unknown as RascunhoNota).pagamento.forma,
    "PIX",
  );
  assert.equal(corrigida.codigo, null);
  assert.equal(rede.mock.callCount(), 0);
});

async function fixture(paga = false) {
  const tag = randomUUID();
  const org = await db.organizacao.create({
    data: { nome: "Conferência fictícia", slug: tag },
  });
  const unidade = await db.unidade.create({
    data: { organizacaoId: org.id, nome: "Loja fictícia", codigo: "QA" },
  });
  const usuario = await db.usuario.create({
    data: {
      nome: "Responsável fictício",
      email: `${tag}@example.test`,
      status: "ATIVO",
    },
  });
  const papel = await db.papel.create({
    data: {
      organizacaoId: org.id,
      nome: "Operador de notas",
      permissoes: {
        create: [
          "assistente.ver",
          "estoque.lancar",
          "financeiro.ver",
          "financeiro.lancar",
          "financeiro.quitar",
          "cardapio.editar",
        ].map((chave) => ({ chave })),
      },
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
      nome: `notas-${tag}`,
      provedor: "SIMULADO",
      ativa: true,
    },
  });
  const vinculo = await db.vinculoWhatsapp.create({
    data: {
      organizacaoId: org.id,
      usuarioId: usuario.id,
      remoteJid: `${tag}@lid`,
      telefone: "5511900000021",
      autorizadoEm: new Date(),
    },
  });
  await db.autorizacaoNotaWhatsapp.create({
    data: {
      organizacaoId: org.id,
      unidadeId: unidade.id,
      vinculoId: vinculo.id,
      usuarioId: usuario.id,
      telefone: vinculo.telefone,
      autorizadoEm: new Date(),
      autorizadoPorId: usuario.id,
    },
  });
  const local = await db.localEstoque.create({
    data: { unidadeId: unidade.id, nome: "Depósito fictício" },
  });
  const insumo = await db.insumo.create({
    data: {
      organizacaoId: org.id,
      nome: "Mussarela fictícia",
      unidadeMedida: "KG",
    },
  });
  const empresa = await db.empresaFinanceira.create({
    data: {
      organizacaoId: org.id,
      unidadeId: unidade.id,
      nome: "Empresa fictícia",
      razaoSocial: "Empresa fictícia",
      cnpj: "11222333000181",
      regime: "SIMPLES",
    },
  });
  const conta = await db.contaFinanceira.create({
    data: {
      unidadeId: unidade.id,
      empresaId: empresa.id,
      nome: "Conta fictícia",
    },
  });
  const categoria = await db.categoriaFinanceira.create({
    data: {
      organizacaoId: org.id,
      nome: "Mercadoria fictícia",
      tipo: "DESPESA",
      grupoDre: "MERCADORIA",
    },
  });
  const conversa = await db.conversaNotaWhatsapp.create({
    data: {
      organizacaoId: org.id,
      unidadeId: unidade.id,
      instanciaId: instancia.id,
      vinculoId: vinculo.id,
      usuarioId: usuario.id,
    },
  });
  const foto = await db.mensagemNotaWhatsapp.create({
    data: {
      conversaId: conversa.id,
      instanciaId: instancia.id,
      idExterno: `entrada:foto-${tag}`,
      direcao: "ENTRADA",
      tipo: "FOTO",
      estado: "PROCESSADA",
      recebidoEm: new Date(Date.now() - 120_000),
    },
  });
  const notaId = randomUUID();
  const rascunho: RascunhoNota = {
    operacaoId: notaId,
    fornecedor: { nome: "Fornecedor fictício", documento: "11444777000161" },
    numero: "123",
    serie: "1",
    emitidaEm: "2026-11-04",
    recebidaEm: "2026-11-04",
    localId: local.id,
    empresaId: empresa.id,
    categoriaId: categoria.id,
    valorTotal: 30,
    itens: [
      {
        descricao: "Caixa de queijo",
        quantidade: 2,
        unidade: "CX",
        valorTotal: 30,
        insumoId: insumo.id,
        fatorConversao: 3,
      },
    ],
    pagamento: paga
      ? {
          situacao: "PAGA",
          forma: "PIX",
          contaId: conta.id,
          dataPagamento: "2026-11-04",
          parcelas: [{ vencimento: "2026-11-04", valor: 30 }],
        }
      : {
          situacao: "A_PAGAR",
          forma: "BOLETO",
          parcelas: [
            { vencimento: "2026-11-20", valor: 15 },
            { vencimento: "2026-12-20", valor: 15 },
          ],
        },
  };
  const resumoEm = new Date(Date.now() - 60_000);
  const nota = await db.notaFiscalWhatsapp.create({
    data: {
      id: notaId,
      organizacaoId: org.id,
      unidadeId: unidade.id,
      instanciaId: instancia.id,
      vinculoId: vinculo.id,
      usuarioId: usuario.id,
      mensagemId: foto.id,
      estado: "PRONTA",
      rascunho: json(rascunho),
      revisao: 1,
      codigo: "ABC123",
      resumoHash: hashPropostaNota(
        notaAssistidaPronta.parse(propostaDaConferencia(rascunho)),
      ),
      resumoEm,
      expiraEm: new Date(Date.now() + 600_000),
    },
  });
  await db.conversaNotaWhatsapp.update({
    where: { id: conversa.id },
    data: { notaAtivaId: nota.id },
  });
  await db.mensagemNotaWhatsapp.create({
    data: {
      conversaId: conversa.id,
      instanciaId: instancia.id,
      idExterno: `resumo:${nota.id}:1`,
      direcao: "SAIDA",
      tipo: "RESUMO",
      notaId: nota.id,
      estado: "ENVIADA",
      texto: "Resumo fictício já conferido",
      recebidoEm: resumoEm,
      enviadaEm: resumoEm,
    },
  });
  const entrada = (texto: string, recebidoEm = new Date(Date.now() - 20)) =>
    db.mensagemNotaWhatsapp.create({
      data: {
        conversaId: conversa.id,
        instanciaId: instancia.id,
        idExterno: `entrada:${randomUUID()}`,
        direcao: "ENTRADA",
        texto,
        recebidoEm,
      },
    });
  const atual = () =>
    db.notaFiscalWhatsapp.findUniqueOrThrow({ where: { id: nota.id } });
  const saldo = async () =>
    String(
      (
        await db.posicaoEstoque.findUnique({
          where: {
            localId_insumoId: { localId: local.id, insumoId: insumo.id },
          },
        })
      )?.quantidade ?? 0,
    );
  const semEfeito = async () => {
    assert.equal(
      await db.notaEntrada.count({ where: { unidadeId: unidade.id } }),
      0,
    );
    assert.equal(
      await db.lancamento.count({ where: { unidadeId: unidade.id } }),
      0,
    );
    assert.equal(
      await db.baixaFinanceira.count({ where: { unidadeId: unidade.id } }),
      0,
    );
    assert.equal(await saldo(), "0");
  };
  const marcarResumoEnviado = async () => {
    const n = await atual();
    const enviadaEm = new Date(Date.now() - 1000);
    await db.mensagemNotaWhatsapp.updateMany({
      where: {
        conversaId: conversa.id,
        idExterno: `resumo:${nota.id}:${n.revisao}`,
      },
      data: { estado: "ENVIADA", enviadaEm },
    });
    return db.notaFiscalWhatsapp.update({
      where: { id: nota.id },
      data: { resumoEm: enviadaEm, expiraEm: new Date(Date.now() + 600_000) },
    });
  };
  return {
    org,
    unidade,
    usuario,
    papel,
    instancia,
    vinculo,
    local,
    insumo,
    empresa,
    conta,
    categoria,
    conversa,
    nota,
    rascunho,
    entrada,
    atual,
    saldo,
    semEfeito,
    marcarResumoEnviado,
  };
}

test("confirmação da conversa lança estoque e parcelas, aprende o vínculo e conserva uma resposta de sucesso", async () => {
  const f = await fixture();
  const m = await f.entrada("CONFIRMAR ABC123");
  await tratarMensagemNota(m.id);
  const n = await f.atual();
  assert.equal(n.estado, "LANCADA");
  assert.equal(await f.saldo(), "6");
  const resultado = n.resultado as { notaId: string; lancamentoIds: string[] };
  assert.equal(resultado.lancamentoIds.length, 2);
  const vinculo = await db.vinculoItemNotaWhatsapp.findFirstOrThrow({
    where: { organizacaoId: f.org.id, unidadeId: f.unidade.id },
  });
  assert.equal(vinculo.insumoId, f.insumo.id);
  assert.equal(String(vinculo.fator), "3");
  assert.equal(vinculo.fornecedor, "11444777000161");
  assert.equal(vinculo.confirmadoPorId, f.usuario.id);
  assert.equal(
    (
      await db.conversaNotaWhatsapp.findUniqueOrThrow({
        where: { id: f.conversa.id },
      })
    ).notaAtivaId,
    null,
  );
  await tratarMensagemNota(m.id);
  const repetida = await f.entrada("CONFIRMAR ABC123");
  await tratarMensagemNota(repetida.id);
  assert.equal(await f.saldo(), "6");
  assert.equal(
    await db.notaEntrada.count({ where: { unidadeId: f.unidade.id } }),
    1,
  );
  const resposta = await db.mensagemNotaWhatsapp.findUniqueOrThrow({
    where: {
      instanciaId_idExterno: {
        instanciaId: f.instancia.id,
        idExterno: `resposta:${m.id}`,
      },
    },
  });
  assert.match(resposta.texto!, /cadastrada com sucesso/);
  assert.match(resposta.texto!, new RegExp(resultado.notaId));
});
test("XML passa pelo leitor, oferece LANÇAR e só o código vigente registra financeiro sem estoque", async (t) => {
  const f = await fixture();
  const rede = t.mock.method(globalThis, "fetch", async () => {
    throw Error("XML não deve usar rede ou Gemini");
  });
  const arquivo = await gravarArquivoFiscal({
    organizacaoId: f.org.id,
    unidadeId: f.unidade.id,
    usuarioId: f.usuario.id,
    bytes: await readFile("tests/fixtures/notas/nfe-sintetica.xml"),
    tipo: "application/xml",
    variante: "sintetico",
  });
  await db.notaFiscalWhatsapp.update({
    where: { id: f.nota.id },
    data: {
      arquivoId: arquivo.id,
      rascunho: Prisma.DbNull,
      codigo: null,
      resumoHash: null,
      resumoEm: null,
      expiraEm: null,
      estado: "RECEBIDA",
    },
  });
  await tratarMensagemNota(f.nota.mensagemId);
  let n = await f.atual();
  assert.equal(n.metodoLeitura, "XML");
  assert.equal(n.estado, "REVISAO");
  assert.equal(n.tentativasLeitura, 0);
  await f.semEfeito();
  await tratarMensagemNota((await f.entrada("OK")).id);
  await f.semEfeito();
  assert.equal(
    await db.fornecedor.count({ where: { organizacaoId: f.org.id } }),
    0,
  );
  await tratarMensagemNota((await f.entrada("LANÇAR")).id);
  n = await f.atual();
  const r = n.rascunho as unknown as RascunhoNota;
  assert.equal(r.fiscal?.descontos, 1);
  assert.deepEqual(
    r.itens.map((i) => i.valorTotal),
    [9.33, 4.67],
  );
  assert.equal(r.modo, "FINANCEIRO");
  r.pagamento = {
    situacao: "A_PAGAR",
    forma: "BOLETO",
    parcelas: [{ valor: 14, vencimento: "2026-11-10" }],
  };
  await db.notaFiscalWhatsapp.update({
    where: { id: n.id },
    data: { rascunho: json(r) },
  });
  await tratarMensagemNota((await f.entrada("RESUMO")).id);
  n = await f.atual();
  assert.equal(n.estado, "PRONTA");
  await f.semEfeito();
  await f.marcarResumoEnviado();
  await tratarMensagemNota((await f.entrada(`OK ${n.codigo}`)).id);
  n = await f.atual();
  assert.equal(n.estado, "LANCADA");
  assert.equal(await f.saldo(), "0");
  assert.equal(
    await db.notaEntrada.count({ where: { unidadeId: f.unidade.id } }),
    0,
  );
  const lancamentos = await db.lancamento.findMany({
    where: { unidadeId: f.unidade.id },
  });
  assert.equal(lancamentos.length, 1);
  assert.equal(String(lancamentos[0].valor), "14");
  assert.equal(
    (await db.arquivo.findUniqueOrThrow({ where: { id: arquivo.id } }))
      .entidade,
    "Lancamento",
  );
  assert.equal(rede.mock.callCount(), 0);
});

test("retomar foto guardada usa Gemini antes do QR, conserva resposta antiga e não lança nem repete geração", async (t) => {
  const f = await fixture();
  const scope = { organizationId: f.org.id, storeId: f.unidade.id };
  await db.avModelConfiguration.create({
    data: {
      ...scope,
      model: "gemini-ficticio",
      encryptedKey: encryptVirtualCredential(scope, "chave-ficticia"),
      enabled: true,
      ratesConfirmed: true,
      testState: "PASSED",
      testedRevision: 1,
      testedAt: new Date(),
      updatedById: f.usuario.id,
      inputMicrosPerMillion: 0,
      outputMicrosPerMillion: 0,
    },
  });
  const arquivo = await gravarArquivoFiscal({
    organizacaoId: f.org.id,
    unidadeId: f.unidade.id,
    usuarioId: f.usuario.id,
    bytes: await readFile("tests/fixtures/notas/cupom-qr.png"),
    tipo: "image/png",
    variante: "sintetico",
  });
  const dados = lerXmlFiscal(
    await readFile("tests/fixtures/notas/nfe-sintetica.xml"),
  );
  // Mantém uma pendência real: não pode completar quantidade por conta própria.
  dados.itens[0].quantidade = null;
  dados.itens[0].confianca.quantidade = 0;
  let geracoes = 0;
  t.mock.method(
    globalThis,
    "fetch",
    async (url: string, opcoes: RequestInit) => {
      assert.ok(url.startsWith("https://generativelanguage.googleapis.com/"));
      if (url.endsWith(":countTokens"))
        return Response.json({ totalTokens: 800 });
      geracoes++;
      const pedido = JSON.parse(String(opcoes.body));
      assert.equal(
        pedido.contents[0].parts[0].text,
        geracoes === 1 ? "Região: original." : "Região: pagina-1-cabecalho.",
      );
      return Response.json({
        candidates: [
          {
            finishReason: "STOP",
            content: { parts: [{ text: JSON.stringify(dados) }] },
          },
        ],
        usageMetadata: {
          promptTokenCount: 800,
          candidatesTokenCount: 200,
          totalTokenCount: 1000,
        },
      });
    },
  );
  const antiga = await db.mensagemNotaWhatsapp.create({
    data: {
      conversaId: f.conversa.id,
      instanciaId: f.instancia.id,
      idExterno: `resposta:${f.nota.mensagemId}`,
      direcao: "SAIDA",
      estado: "ENVIADA",
      texto: "Antigo pedido de XML",
      recebidoEm: new Date(),
    },
  });
  // Simula a retomada operacional da mesma foto, ainda sem nenhuma tentativa de IA.
  await db.notaFiscalWhatsapp.update({
    where: { id: f.nota.id },
    data: {
      arquivoId: arquivo.id,
      leitura: Prisma.DbNull,
      rascunho: Prisma.DbNull,
      pergunta: Prisma.DbNull,
      estado: "RECEBIDA",
      codigo: null,
      resumoHash: null,
      resumoEm: null,
      expiraEm: null,
    },
  });
  await tratarMensagemNota(f.nota.mensagemId);
  const n = await f.atual();
  assert.equal(n.metodoLeitura, "GEMINI");
  assert.equal(n.estado, "REVISAO");
  assert.equal(n.tentativasLeitura, 2);
  assert.equal(n.confirmacaoId, null);
  assert.equal(n.resultado, null);
  assert.equal(geracoes, 2);
  assert.equal(
    (n.leitura as { conferida: typeof dados }).conferida.itens[0].quantidade,
    null,
  );
  const nova = await db.mensagemNotaWhatsapp.findUniqueOrThrow({
    where: {
      instanciaId_idExterno: {
        instanciaId: f.instancia.id,
        idExterno: `leitura:${f.nota.id}:${n.revisao}`,
      },
    },
  });
  assert.match(nova.texto!, /FORNECEDOR FICTICIO/);
  assert.doesNotMatch(nova.texto!, /GEMINI|LEITURAS_DIVERGENTES|A conferir:/);
  assert.equal(
    (
      await db.mensagemNotaWhatsapp.findUniqueOrThrow({
        where: { id: antiga.id },
      })
    ).texto,
    "Antigo pedido de XML",
  );
  await tratarMensagemNota(f.nota.mensagemId);
  assert.equal(geracoes, 2);
  await tratarMensagemNota((await f.entrada("OK")).id);
  await f.semEfeito();
  assert.equal(
    await db.fornecedor.count({ where: { organizacaoId: f.org.id } }),
    0,
  );
  assert.ok(
    await db.auditoria.count({
      where: {
        entidadeId: n.id,
        valoresDepois: { path: ["etapa"], equals: "QR_ULTIMO_RECURSO" },
      },
    }),
  );
});

test("conferência pelo WhatsApp pede um dado por vez, aceita respostas simples e não lança", async (t) => {
  const f = await fixture();
  const rede = t.mock.method(globalThis, "fetch", async () => {
    throw Error("Conferência salva não deve usar IA nem rede");
  });
  const d = lerXmlFiscal(
    await readFile("tests/fixtures/notas/nfe-sintetica.xml"),
  );
  d.cnpj_emitente = "00000000000000";
  const chave = d.chave_acesso!;
  d.chave_acesso = "0".repeat(44);
  d.itens[1].codigo_ean = "12345678";
  d.acrescimos = null;
  const arquivo = await gravarArquivoFiscal({
    organizacaoId: f.org.id,
    unidadeId: f.unidade.id,
    usuarioId: f.usuario.id,
    bytes: await readFile("tests/fixtures/notas/nfe-sintetica.xml"),
    tipo: "application/xml",
    variante: "sintetico",
  });
  await db.notaFiscalWhatsapp.update({
    where: { id: f.nota.id },
    data: {
      estado: "REVISAO",
      arquivoId: arquivo.id,
      rascunho: Prisma.DbNull,
      codigo: null,
      resumoHash: null,
      resumoEm: null,
      expiraEm: null,
      leitura: json({
        versao: "fiscal-2.0",
        metodo: "GEMINI",
        original: structuredClone(d),
        conferida: structuredClone(d),
        extras: [
          {
            campo: "itens",
            codigo: "LEITURAS_DIVERGENTES",
            mensagem: "Leituras diferentes: 16.99 / 18.99",
          },
        ],
        alertasConferidos: false,
      }),
    },
  });
  const responder = async (texto: string) => {
    const m = await f.entrada(texto);
    await tratarMensagemNota(m.id);
    await f.semEfeito();
    const n = await f.atual();
    return db.mensagemNotaWhatsapp.findFirstOrThrow({
      where: {
        instanciaId: f.instancia.id,
        OR: [
          { idExterno: `resposta:${m.id}` },
          { idExterno: `leitura:${n.id}:${n.revisao}` },
        ],
      },
    });
  };
  const resumo = await responder("RESUMO");
  assert.match(resumo.texto!, /ARROZ TIPO 1/);
  assert.match(resumo.texto!, /FEIJAO PRETO/);
  assert.match(resumo.texto!, /CPF\/CNPJ/);
  assert.doesNotMatch(resumo.texto!, /44 números|GEMINI|Leituras diferentes/);
  const detalhes = await responder("ITENS");
  assert.match(detalhes.texto!, /ARROZ TIPO 1/);
  assert.match(detalhes.texto!, /FEIJAO PRETO/);
  assert.equal((await f.atual()).confirmacaoId, null);
  const documento = await responder("11.222.333/0001-81");
  assert.match(documento.texto!, /44 números/);
  const codigo = await responder(chave);
  assert.match(codigo.texto!, /código de barras/);
  const ean = await responder("SEM CÓDIGO");
  assert.match(ean.texto!, /valor do acréscimo/);
  const acrescimo = await responder("0");
  assert.match(acrescimo.texto!, /\*CONFERI\*/);
  const n = await f.atual();
  const leitura = n.leitura as {
    original: typeof d;
    conferida: typeof d;
    extras: unknown[];
  };
  assert.equal(leitura.conferida.descontos, 1);
  assert.equal(leitura.conferida.acrescimos, 0);
  assert.equal(leitura.original.cnpj_emitente, "00000000000000");
  assert.equal(leitura.extras.length, 1);
  await responder("OK");
  const confirmar = await f.entrada("CONFERI");
  await tratarMensagemNota(confirmar.id);
  await f.semEfeito();
  const pronta = await f.atual();
  assert.ok(pronta.rascunho);
  assert.equal(pronta.confirmacaoId, null);
  assert.equal(pronta.resultado, null);
  await tratarMensagemNota(confirmar.id);
  assert.equal((await f.atual()).revisao, pronta.revisao);
  assert.equal(
    await db.fornecedor.count({ where: { organizacaoId: f.org.id } }),
    0,
  );
  assert.equal(rede.mock.callCount(), 0);
});

test("código errado, confirmação anterior ao envio e hash alterado não lançam", async (t) => {
  for (const caso of ["codigo", "antes-do-resumo", "hash"] as const)
    await t.test(caso, async () => {
      const f = await fixture();
      if (caso === "hash")
        await db.notaFiscalWhatsapp.update({
          where: { id: f.nota.id },
          data: {
            rascunho: json({
              ...f.rascunho,
              itens: [{ ...f.rascunho.itens[0], quantidade: 3 }],
            }),
          },
        });
      const m = await f.entrada(
        caso === "codigo" ? "CONFIRMAR FFFFFF" : "CONFIRMAR ABC123",
        caso === "antes-do-resumo"
          ? new Date(f.nota.resumoEm!.getTime() - 1)
          : undefined,
      );
      await tratarMensagemNota(m.id);
      await f.semEfeito();
      const n = await f.atual();
      assert.equal(n.revisao, 2);
      assert.notEqual(n.codigo, "ABC123");
      assert.equal(n.resumoEm, null);
    });
});

test("corrigir troca a revisão e só o resumo novo efetivamente enviado pode ser aprovado", async () => {
  const f = await fixture();
  const correcao = await f.entrada("CORRIGIR ITEM 1 QUANTIDADE 1");
  await tratarMensagemNota(correcao.id);
  const corrigida = await f.atual();
  assert.equal(corrigida.revisao, 2);
  assert.notEqual(corrigida.codigo, "ABC123");
  const antiga = await f.entrada("CONFIRMAR ABC123");
  await tratarMensagemNota(antiga.id);
  await f.semEfeito();
  const pronta = await f.marcarResumoEnviado();
  const confirmacao = await f.entrada(`CONFIRMAR ${pronta.codigo}`);
  await tratarMensagemNota(confirmacao.id);
  assert.equal((await f.atual()).estado, "LANCADA");
  assert.equal(await f.saldo(), "3");
});

test("reprocessar a mesma resposta numérica não responde à pergunta seguinte", async () => {
  const f = await fixture();
  await db.notaFiscalWhatsapp.update({
    where: { id: f.nota.id },
    data: {
      estado: "REVISAO",
      rascunho: json({ ...f.rascunho, pagamento: {} }),
      pergunta: {
        campo: "situacao",
        texto: "Já foi paga?",
        opcoes: [
          { nome: "Paga", valor: "PAGA" },
          { nome: "A pagar", valor: "A_PAGAR" },
        ],
      },
      codigo: null,
      resumoHash: null,
      resumoEm: null,
      expiraEm: null,
    },
  });
  const m = await f.entrada("2");
  await tratarMensagemNota(m.id);
  const primeira = await f.atual();
  assert.equal((primeira.pergunta as { campo: string }).campo, "forma");
  await tratarMensagemNota(m.id);
  const segunda = await f.atual();
  assert.equal(segunda.revisao, primeira.revisao);
  assert.equal(
    (segunda.rascunho as unknown as RascunhoNota).pagamento.forma,
    undefined,
  );
  assert.equal((segunda.pergunta as { campo: string }).campo, "forma");
  await f.semEfeito();
});

test("revogar a permissão de baixa após o resumo impede uma compra paga", async () => {
  const f = await fixture(true);
  await db.papelPermissao.deleteMany({
    where: { papelId: f.papel.id, chave: "financeiro.quitar" },
  });
  const m = await f.entrada("CONFIRMAR ABC123");
  await tratarMensagemNota(m.id);
  await f.semEfeito();
  assert.notEqual((await f.atual()).estado, "LANCADA");
});

test("cancelamento descarta o rascunho e impede aproveitar seu código depois", async () => {
  const f = await fixture();
  const pendente = await db.mensagemNotaWhatsapp.create({
    data: {
      conversaId: f.conversa.id,
      instanciaId: f.instancia.id,
      idExterno: randomUUID(),
      direcao: "SAIDA",
      tipo: "RESUMO",
      notaId: f.nota.id,
      texto: "Resumo pendente",
      recebidoEm: new Date(),
    },
  });
  const m = await f.entrada("CANCELAR");
  await tratarMensagemNota(m.id);
  assert.equal((await f.atual()).estado, "CANCELADA");
  assert.equal(
    (
      await db.mensagemNotaWhatsapp.findUniqueOrThrow({
        where: { id: pendente.id },
      })
    ).estado,
    "CANCELADA",
  );
  const confirmacao = await f.entrada("CONFIRMAR ABC123");
  await tratarMensagemNota(confirmacao.id);
  await f.semEfeito();
});

test("retoma após commit do domínio perdido antes de finalizar a conversa sem repetir entrada", async () => {
  const f = await fixture();
  const m = await f.entrada("CONFIRMAR ABC123");
  await db.notaFiscalWhatsapp.update({
    where: { id: f.nota.id },
    data: { estado: "EXECUTANDO", confirmacaoId: m.id },
  });
  const autorizado = await contextoParaNota(f.instancia.id, f.vinculo.id);
  assert.ok(autorizado);
  const efeito = await lancarNotaAssistida(
    autorizado.contexto,
    propostaDaConferencia(f.rascunho),
  );
  assert.equal(await f.saldo(), "6");
  await tratarMensagemNota(m.id);
  const n = await f.atual();
  assert.equal(n.estado, "LANCADA");
  assert.deepEqual(n.resultado, efeito);
  assert.equal(await f.saldo(), "6");
  assert.equal(
    await db.notaEntrada.count({ where: { unidadeId: f.unidade.id } }),
    1,
  );
  assert.equal(
    await db.vinculoItemNotaWhatsapp.count({
      where: { unidadeId: f.unidade.id },
    }),
    1,
  );
});

test("RESUMO retoma a operação já aprovada que ficou EXECUTANDO", async () => {
  const f = await fixture();
  const confirmacao = await f.entrada("CONFIRMAR ABC123");
  await db.notaFiscalWhatsapp.update({
    where: { id: f.nota.id },
    data: { estado: "EXECUTANDO", confirmacaoId: confirmacao.id },
  });
  const resumo = await f.entrada("RESUMO");
  await tratarMensagemNota(resumo.id);
  assert.equal((await f.atual()).estado, "LANCADA");
  assert.equal(await f.saldo(), "6");
  const resposta = await db.mensagemNotaWhatsapp.findUniqueOrThrow({
    where: {
      instanciaId_idExterno: {
        instanciaId: f.instancia.id,
        idExterno: `resposta:${confirmacao.id}`,
      },
    },
  });
  assert.match(resposta.texto!, /cadastrada com sucesso/);
});

test("pagamento já efetivado é recuperado mesmo após revogar apenas a permissão de novas baixas", async () => {
  const f = await fixture(true);
  const m = await f.entrada("CONFIRMAR ABC123");
  await db.notaFiscalWhatsapp.update({
    where: { id: f.nota.id },
    data: { estado: "EXECUTANDO", confirmacaoId: m.id },
  });
  const autorizado = await contextoParaNota(f.instancia.id, f.vinculo.id);
  assert.ok(autorizado);
  const resultado = await lancarNotaAssistida(
    autorizado.contexto,
    propostaDaConferencia(f.rascunho),
  );
  await db.papelPermissao.deleteMany({
    where: { papelId: f.papel.id, chave: "financeiro.quitar" },
  });
  await tratarMensagemNota(m.id);
  const n = await f.atual();
  assert.equal(n.estado, "LANCADA");
  assert.deepEqual(n.resultado, resultado);
  assert.equal(await f.saldo(), "6");
  assert.equal(
    await db.baixaFinanceira.count({ where: { unidadeId: f.unidade.id } }),
    1,
  );
});

test("novo produto confirmado é criado e seu vínculo é aprendido pela conversa", async () => {
  const f = await fixture();
  const r: RascunhoNota = {
    ...f.rascunho,
    itens: [
      {
        descricao: "Novo item fictício",
        quantidade: 2,
        unidade: "UN",
        valorTotal: 30,
        novoInsumo: { nome: "Novo item fictício", unidadeMedida: "UN" },
        fatorConversao: 1,
      },
    ],
  };
  await db.notaFiscalWhatsapp.update({
    where: { id: f.nota.id },
    data: {
      rascunho: json(r),
      resumoHash: hashPropostaNota(
        notaAssistidaPronta.parse(propostaDaConferencia(r)),
      ),
    },
  });
  const m = await f.entrada("CONFIRMAR ABC123");
  await tratarMensagemNota(m.id);
  const criado = await db.insumo.findUniqueOrThrow({
    where: {
      organizacaoId_nome: {
        organizacaoId: f.org.id,
        nome: "Novo item fictício",
      },
    },
  });
  const vinculo = await db.vinculoItemNotaWhatsapp.findFirstOrThrow({
    where: { unidadeId: f.unidade.id },
  });
  assert.equal(vinculo.insumoId, criado.id);
  assert.equal(String(vinculo.fator), "1");
  assert.equal(
    String(
      (
        await db.posicaoEstoque.findUniqueOrThrow({
          where: {
            localId_insumoId: { localId: f.local.id, insumoId: criado.id },
          },
        })
      ).quantidade,
    ),
    "2",
  );
});
