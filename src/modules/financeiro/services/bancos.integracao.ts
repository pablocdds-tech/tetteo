import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import type { ContextoSessao } from "@/core/sessao/nucleo";
import { contextoDeFundo } from "@/core/sessao/nucleo";
import {
  criarEmpresaBancaria,
  editarEmpresaBancaria,
  assinaturaEmpresa,
  salvarContaBancaria,
  listarSaldosBancarios,
  transferirEntreContas,
  estornarTransferencia,
  extratoBancario,
} from "./bancos";
import {
  movimentosParaDre,
  quitarLancamento,
  visaoDoCaixa,
} from "./lancamentos";

test("bancos integrados: centavos, corte, baixas, escopo, concorrência, estorno e preservação", async (t) => {
  assert.match(
    new URL(process.env.DATABASE_URL!).hostname,
    /^(127\.0\.0\.1|localhost)$/,
  );
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /_test/);
  const org = await db.organizacao.create({
    data: { nome: "Financeiro fictício", slug: randomUUID() },
  });
  const usuario = await db.usuario.create({
    data: { nome: "Pessoa de teste", email: randomUUID() + "@example.invalid" },
  });
  const unidade = await db.unidade.create({
    data: { nome: "Loja fictícia", codigo: "A", organizacaoId: org.id },
  });
  const outraOrg = await db.organizacao.create({
    data: { nome: "Outra organização fictícia", slug: randomUUID() },
  });
  const outraUnidade = await db.unidade.create({
    data: {
      nome: "Outra loja fictícia",
      codigo: "B",
      organizacaoId: outraOrg.id,
    },
  });
  const ctx: ContextoSessao = {
    usuario: {
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      avatarUrl: null,
    },
    organizacao: org,
    unidadeAtiva: unidade,
    unidadesVisiveis: [unidade],
    podeVerRedeInteira: false,
    ehDiretor: false,
    permissoes: new Set([
      "financeiro.ver",
      "financeiro.lancar",
      "financeiro.quitar",
      "financeiro.resultado",
    ]),
  };
  try {
    await t.test(
      "sessão não herda permissões de administrador de outra organização",
      async () => {
        const papel = await db.papel.create({
          data: {
            organizacaoId: org.id,
            nome: "Leitor",
            permissoes: { create: { chave: "financeiro.ver" } },
          },
        });
        const outroPapel = await db.papel.create({
          data: {
            organizacaoId: outraOrg.id,
            nome: "Diretor",
            permissoes: { create: { chave: "*" } },
          },
        });
        await db.acesso.create({
          data: {
            organizacaoId: org.id,
            usuarioId: usuario.id,
            unidadeId: unidade.id,
            papelId: papel.id,
            criadoEm: new Date("2026-01-01"),
          },
        });
        await db.acesso.create({
          data: {
            organizacaoId: outraOrg.id,
            usuarioId: usuario.id,
            papelId: outroPapel.id,
            criadoEm: new Date("2026-01-02"),
          },
        });
        const sessao = await contextoDeFundo(usuario.id, unidade.id);
        assert.deepEqual([...sessao!.permissoes], ["financeiro.ver"]);
        assert.equal(sessao!.ehDiretor, false);
        assert.equal(sessao!.podeVerRedeInteira, false);
        assert.equal(await contextoDeFundo(usuario.id, outraUnidade.id), null);
      },
    );
    const empresa = await criarEmpresaBancaria(ctx, {
      nome: "Empresa A",
      razaoSocial: "Empresa de teste A",
      cnpj: "11222333000181",
      regime: "LUCRO_PRESUMIDO",
      emiteNota: true,
    });
    const empresa2 = await criarEmpresaBancaria(ctx, {
      nome: "Empresa B",
      razaoSocial: "Empresa de teste B",
      cnpj: "11444777000161",
      regime: "DESCONHECIDO",
      emiteNota: false,
    });
    const entrada = {
      nome: "Santander",
      empresaId: empresa.id,
      modalidade: "CORRENTE",
      banco: "Santander",
      agencia: "0001",
      numero: "100001-0",
      titularidade: "PJ",
      nomeTitular: "Empresa fictícia",
      saldoInicial: "1.000,00",
      dataInicial: "2026-09-01",
      cor: "#0066cc",
      ativa: true,
      compensacao: false,
    };
    const origem = await salvarContaBancaria(ctx, null, entrada);
    const destino = await salvarContaBancaria(ctx, null, {
      ...entrada,
      nome: "PagBank",
      banco: "PagBank",
      numero: "200001-0",
      titularidade: "PF",
      nomeTitular: "Titular fictício",
      saldoInicial: "250,00",
    });
    const cruzada = await salvarContaBancaria(ctx, null, {
      ...entrada,
      empresaId: empresa2.id,
      numero: "300001-0",
    });
    await t.test(
      "empresa mantém CNPJ, registra tentativa de retorno ao Simples e protege edição concorrente",
      async () => {
        const entradaEmpresa = {
          nome: empresa2.nome,
          razaoSocial: empresa2.razaoSocial,
          cnpj: empresa2.cnpj,
          regime: "LUCRO_PRESUMIDO_RETORNO_SIMPLES",
          emiteNota: false,
          ativa: true,
        };
        const editada = await editarEmpresaBancaria(
          ctx,
          empresa2.id,
          entradaEmpresa,
          assinaturaEmpresa(empresa2),
        );
        assert.equal(editada.regime, "LUCRO_PRESUMIDO_RETORNO_SIMPLES");
        await assert.rejects(
          () =>
            editarEmpresaBancaria(
              ctx,
              empresa2.id,
              { ...entradaEmpresa, nome: "Sobrescrita" },
              assinaturaEmpresa(empresa2),
            ),
          /mudou/,
        );
        await assert.rejects(
          () =>
            editarEmpresaBancaria(
              ctx,
              empresa2.id,
              { ...entradaEmpresa, cnpj: empresa.cnpj },
              assinaturaEmpresa(editada),
            ),
          /CNPJ/,
        );
      },
    );
    const movimento = {
      origemId: origem.id,
      destinoId: destino.id,
      valor: "12,34",
      data: "2026-10-01",
      descricao: "Transferência fictícia",
      chave: randomUUID(),
    };
    const pagar = (
      valor: string,
      data: string,
      contaId = origem.id,
      direcao: "PAGAR" | "RECEBER" = "PAGAR",
    ) =>
      db.lancamento.create({
        data: {
          unidadeId: unidade.id,
          direcao,
          status: "QUITADO",
          descricao: "Baixa fictícia",
          valor,
          valorQuitado: valor,
          vencimento: new Date(data),
          quitadoEm: new Date(data),
          contaId,
        },
      });
    await pagar("999", "2026-08-31T12:00:00Z");
    await pagar("100", "2026-09-01T03:00:00Z", origem.id, "RECEBER");
    await pagar("20", "2026-09-02T12:00:00Z");
    await pagar("77", "2099-01-01T12:00:00Z", origem.id, "RECEBER");
    const dreAntes = await movimentosParaDre(
      ctx,
      new Date("2026-09-01"),
      new Date("2026-10-26T23:59:59Z"),
      "caixa",
    );
    await t.test(
      "preparação cria compensação e categorias fora do DRE em cada CNPJ",
      async () => {
        assert.equal(
          await db.contaFinanceira.count({
            where: { unidadeId: unidade.id, compensacao: true },
          }),
          2,
        );
        assert.equal(
          await db.categoriaFinanceira.count({
            where: {
              organizacaoId: org.id,
              grupo: "Repasses",
              entraDre: false,
            },
          }),
          4,
        );
        await assert.rejects(() =>
          criarEmpresaBancaria(ctx, {
            nome: "Outro emissor",
            razaoSocial: "Outro emissor",
            cnpj: "19131243000197",
            regime: "DESCONHECIDO",
            emiteNota: true,
          }),
        );
        await assert.rejects(() =>
          salvarContaBancaria(ctx, null, {
            ...entrada,
            nome: "Duplicação",
            empresaId: empresa2.id,
            numero: "100.001-0",
          }),
        );
      },
    );
    await t.test(
      "corte inclui o próprio dia, exclui baixas anteriores e futuras",
      async () => {
        const saldos = await listarSaldosBancarios(
          ctx,
          new Date("2026-10-26T12:00:00Z"),
        );
        assert.equal(saldos.find((c) => c.id === origem.id)!.saldo, "1080.00");
        assert.equal(
          saldos.find((c) => c.id === destino.id)!.titularidade,
          "PF",
        );
      },
    );
    let transferenciaId = "";
    await t.test(
      "repetições concorrentes geram uma transferência e uma auditoria",
      async () => {
        const respostas = await Promise.all(
          Array.from({ length: 4 }, () =>
            transferirEntreContas(ctx, movimento),
          ),
        );
        transferenciaId = respostas[0].id;
        assert.equal(new Set(respostas.map((r) => r.id)).size, 1);
        assert.equal(
          await db.auditoria.count({
            where: {
              entidadeId: transferenciaId,
              entidade: "TransferenciaFinanceira",
            },
          }),
          1,
        );
        const saldos = await listarSaldosBancarios(ctx);
        assert.equal(saldos.find((c) => c.id === origem.id)!.saldo, "1067.66");
        assert.equal(saldos.find((c) => c.id === destino.id)!.saldo, "262.34");
        assert.deepEqual(
          await movimentosParaDre(
            ctx,
            new Date("2026-09-01"),
            new Date("2026-10-26T23:59:59Z"),
            "caixa",
          ),
          dreAntes,
        );
        await assert.rejects(
          () => transferirEntreContas(ctx, { ...movimento, valor: "13,00" }),
          /outros dados/,
        );
      },
    );
    await t.test(
      "bloqueio por CNPJ, unidade, organização e permissão no servidor",
      async () => {
        await assert.rejects(
          () =>
            transferirEntreContas(ctx, {
              ...movimento,
              destinoId: cruzada.id,
              chave: randomUUID(),
            }),
          /CNPJs/,
        );
        await assert.rejects(
          () => listarSaldosBancarios({ ...ctx, organizacao: outraOrg }),
          /permissão|acessar/i,
        );
        await assert.rejects(
          () => listarSaldosBancarios({ ...ctx, unidadeAtiva: outraUnidade }),
          /permissão|acessar/i,
        );
        const leitor = { ...ctx, permissoes: new Set(["financeiro.ver"]) };
        assert.equal(
          (await listarSaldosBancarios(leitor)).find(
            (c) => c.id === destino.id,
          )!.titularidade,
          "PF",
        );
        await assert.rejects(
          () =>
            transferirEntreContas(leitor, {
              ...movimento,
              chave: randomUUID(),
            }),
          /permissão/i,
        );
        await assert.rejects(
          () =>
            transferirEntreContas(
              {
                ...ctx,
                permissoes: new Set(["financeiro.ver", "financeiro.lancar"]),
              },
              { ...movimento, chave: randomUUID() },
            ),
          /permissão/i,
        );
        await assert.rejects(() =>
          db.transferenciaFinanceira.create({
            data: {
              unidadeId: unidade.id,
              empresaId: empresa.id,
              origemId: origem.id,
              destinoId: cruzada.id,
              valorCentavos: 100n,
              data: new Date("2026-10-01"),
              descricao: "Tentativa cruzada",
              criadoPorId: usuario.id,
              chave: randomUUID(),
              assinatura: "teste",
            },
          }),
        );
        const lancamento = await db.lancamento.create({
          data: {
            unidadeId: unidade.id,
            descricao: "Aberta",
            valor: 1,
            vencimento: new Date(),
            direcao: "PAGAR",
          },
        });
        const contaExterna = await db.contaFinanceira.create({
          data: {
            unidadeId: outraUnidade.id,
            nome: "Externa",
            saldoInicial: 0,
            saldoInicialCentavos: 0n,
          },
        });
        await assert.rejects(
          () =>
            quitarLancamento(ctx, lancamento.id, {
              contaId: contaExterna.id,
              valorQuitado: 1,
              quitadoEm: new Date(),
            }),
          /bancária/,
        );
      },
    );
    await t.test(
      "extratos mostram as duas pernas, abertura e fechamento diário exatos",
      async () => {
        const a = await extratoBancario(
          ctx,
          origem.id,
          "2026-09-01",
          "2026-10-26",
        );
        const b = await extratoBancario(
          ctx,
          destino.id,
          "2026-10-01",
          "2026-10-26",
        );
        assert.equal(a.saldoAnterior, "0.00");
        assert.equal(a.saldoFinal, "1067.66");
        assert.equal(
          a.movimentos.find((m) => m.id === "saldo-inicial")!.valor,
          "1000.00",
        );
        assert.equal(
          a.dias.find((d) => d.dia === "2026-09-01")!.saldo,
          "1100.00",
        );
        assert.equal(b.saldoAnterior, "250.00");
        assert.equal(
          b.movimentos.find((m) => m.id === transferenciaId)!.valor,
          "12.34",
        );
      },
    );
    await t.test(
      "saldo inicial e dados com histórico ficam protegidos; versão impede sobrescrita",
      async () => {
        await assert.rejects(
          () =>
            salvarContaBancaria(
              ctx,
              origem.id,
              { ...entrada, saldoInicial: "1.001,00" },
              0,
            ),
          /movimentos/,
        );
        await assert.rejects(() =>
          db.contaFinanceira.update({
            where: { id: origem.id },
            data: { iniciadaEm: new Date("2026-08-01") },
          }),
        );
        const editada = await salvarContaBancaria(
          ctx,
          origem.id,
          { ...entrada, cor: "#123456" },
          0,
        );
        assert.equal(editada.versao, 1);
        await assert.rejects(
          () => salvarContaBancaria(ctx, origem.id, entrada, 0),
          /mudou/,
        );
        await assert.rejects(() =>
          db.transferenciaFinanceira.update({
            where: { id: transferenciaId },
            data: { valorCentavos: 1n },
          }),
        );
        await assert.rejects(() =>
          db.transferenciaFinanceira.delete({ where: { id: transferenciaId } }),
        );
      },
    );
    await t.test(
      "estorno único conserva original, inclusive com conta inativa",
      async () => {
        await db.contaFinanceira.update({
          where: { id: destino.id },
          data: { ativa: false },
        });
        await assert.rejects(
          () =>
            transferirEntreContas(ctx, { ...movimento, chave: randomUUID() }),
          /ativas/,
        );
        const chave = randomUUID();
        const estornos = await Promise.all(
          Array.from({ length: 3 }, () =>
            estornarTransferencia(
              ctx,
              transferenciaId,
              "2026-10-02",
              "Correção fictícia",
              chave,
            ),
          ),
        );
        assert.equal(new Set(estornos.map((e) => e.id)).size, 1);
        await assert.rejects(
          () =>
            estornarTransferencia(
              ctx,
              transferenciaId,
              "2026-10-02",
              "Segunda tentativa",
              randomUUID(),
            ),
          /já foi estornada/,
        );
        assert.equal(
          await db.transferenciaFinanceira.count({
            where: { unidadeId: unidade.id },
          }),
          2,
        );
        const extrato = await extratoBancario(
          ctx,
          origem.id,
          "2026-10-01",
          "2026-10-26",
        );
        assert.equal(extrato.saldoAnterior, "1080.00");
        assert.equal(extrato.saldoFinal, "1080.00");
        assert.equal(extrato.movimentos.length, 2);
        assert.equal(
          extrato.movimentos.every((m) => !m.estornavel),
          true,
        );
      },
    );
    await t.test(
      "histórico legado continua igual após vínculo ao CNPJ",
      async () => {
        const antiga = await db.contaFinanceira.create({
          data: {
            unidadeId: unidade.id,
            nome: "Legado fictício",
            saldoInicial: "500",
            saldoInicialCentavos: 50000n,
            iniciadaEm: new Date("2026-10-10T15:22:00Z"),
          },
        });
        await pagar("10", "2026-08-01T12:00:00Z", antiga.id);
        const dados = {
          ...entrada,
          nome: antiga.nome,
          banco: "Banco legado",
          numero: "legado",
          saldoInicial: "500,00",
          dataInicial: "2026-10-10",
        };
        await salvarContaBancaria(ctx, antiga.id, dados, 0);
        const saldo = (await listarSaldosBancarios(ctx)).find(
          (c) => c.id === antiga.id,
        )!;
        assert.equal(saldo.saldo, "490.00");
        assert.equal(saldo.corteAplicado, false);
        const caixa = await visaoDoCaixa(ctx);
        assert.equal(caixa.saldoAtual, 2820);
      },
    );
    await t.test(
      "repasse classificado fora do DRE move caixa sem inflar resultado",
      async () => {
        const compensacao = await db.contaFinanceira.findFirstOrThrow({
          where: { empresaId: empresa.id, compensacao: true },
        });
        const categoria = await db.categoriaFinanceira.findFirstOrThrow({
          where: { organizacaoId: org.id, entraDre: false, tipo: "DESPESA" },
        });
        await db.lancamento.create({
          data: {
            unidadeId: unidade.id,
            direcao: "PAGAR",
            descricao: "Repasse fictício",
            valor: 50,
            status: "QUITADO",
            valorQuitado: 50,
            quitadoEm: new Date("2026-10-26T12:00:00Z"),
            vencimento: new Date("2026-10-26"),
            contaId: compensacao.id,
            categoriaId: categoria.id,
          },
        });
        assert.deepEqual(
          await movimentosParaDre(
            ctx,
            new Date("2026-09-01"),
            new Date("2026-10-26T23:59:59Z"),
            "caixa",
          ),
          dreAntes,
        );
      },
    );
    await t.test("repetição não atravessa unidade desativada", async () => {
      await db.unidade.update({
        where: { id: unidade.id },
        data: { ativa: false },
      });
      await assert.rejects(
        () => transferirEntreContas(ctx, movimento),
        /permissão|acessar/i,
      );
      await db.unidade.update({
        where: { id: unidade.id },
        data: { ativa: true },
      });
    });
    await t.test(
      "extrato extenso pede período menor sem truncar dinheiro",
      async () => {
        const conta = await salvarContaBancaria(ctx, null, {
          ...entrada,
          nome: "Volume fictício",
          banco: "Teste",
          numero: "volume",
        });
        await db.lancamento.createMany({
          data: Array.from({ length: 1001 }, () => ({
            unidadeId: unidade.id,
            contaId: conta.id,
            direcao: "PAGAR",
            status: "QUITADO",
            valor: 1,
            valorQuitado: 1,
            descricao: "Volume fictício",
            vencimento: new Date("2026-10-05"),
            quitadoEm: new Date("2026-10-05T12:00:00Z"),
          })),
        });
        await assert.rejects(
          () => extratoBancario(ctx, conta.id, "2026-10-01", "2026-10-26"),
          /1.000/,
        );
      },
    );
  } finally {
    await db.$disconnect();
  }
});
