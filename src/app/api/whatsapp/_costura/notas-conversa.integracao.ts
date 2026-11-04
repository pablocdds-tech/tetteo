import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import {
  hashPropostaNota,
  propostaDaConferencia,
  type RascunhoNota,
} from "@/modules/assistente/schemas/conferencia-nota";
import { contextoParaNota } from "@/modules/assistente/services/contexto-nota";
import { db } from "@/server/db";
import { notaAssistidaPronta } from "@/server/nota-assistida-contrato";
import { lancarNotaAssistida } from "./lancar-nota";
import { tratarMensagemNota } from "./notas-conversa";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://invalid");
assert.ok(
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
    url.pathname.includes("_test"),
  "Somente PostgreSQL local exclusivo de testes.",
);
after(() => db.$disconnect());
const json = (v: unknown) => JSON.parse(JSON.stringify(v));

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
    fornecedor: { nome: "Fornecedor fictício", documento: "44555666000190" },
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
  assert.equal(vinculo.fornecedor, "44555666000190");
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
