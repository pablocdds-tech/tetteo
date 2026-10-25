// Ensaio não destrutivo em banco descartável. Nunca aponta para produção.
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";

import { hash as senhaHash } from "bcryptjs";

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
  if (
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    !url.pathname.includes("_test")
  )
    throw new Error("Ensaio exige banco _test por conexão local.");
  const { db } = await import("../src/server/db");
  const {
    previaImportacao,
    confirmarImportacao,
    criarContrato,
    executarConferencia,
    consultarConferencia,
    registrarDecisao,
    detalharCorrespondencia,
    exportarConferencia,
    originalImportacao,
    anexarEvidencia,
    descartarImportacao,
  } = await import("../src/modules/financeiro/services/conferencia");
  const sufixo = randomUUID();
  try {
    const organizacao = await db.organizacao.create({
      data: {
        nome: "Loja fictícia da conferência",
        slug: "conferencia-test-" + sufixo,
      },
    });
    const unidade = await db.unidade.create({
      data: {
        organizacaoId: organizacao.id,
        nome: "Matriz fictícia",
        codigo: "DEMO",
      },
    });
    const senha = randomBytes(24).toString("base64url");
    const usuario = await db.usuario.create({
      data: {
        nome: "Financeiro fictício",
        email: `conferencia-${sufixo}@example.test`,
        senhaHash: await senhaHash(senha, 12),
        status: "ATIVO",
      },
    });
    const papel = await db.papel.create({
      data: {
        organizacaoId: organizacao.id,
        nome: "Financeiro fictício",
        permissoes: { create: [{ chave: "financeiro.*" }] },
      },
    });
    await db.acesso.create({
      data: {
        organizacaoId: organizacao.id,
        unidadeId: unidade.id,
        usuarioId: usuario.id,
        papelId: papel.id,
      },
    });
    const ctx = {
      usuario: {
        id: usuario.id,
        nome: usuario.nome,
        email: usuario.email,
        avatarUrl: null,
      },
      organizacao: { id: organizacao.id, nome: organizacao.nome },
      unidadesVisiveis: [unidade],
      unidadeAtiva: unidade,
      podeVerRedeInteira: false,
      permissoes: new Set(["financeiro.*"]),
      ehDiretor: false,
    };
    const periodo = { de: "2026-10-19", ate: "2026-10-20" };
    const comum = {
      provider: "DEMO",
      merchantRef: "est-demo",
      accountRef: "conta-demo",
      businessDay: "2026-10-19",
      nsu: "DEMO-1001",
      method: "CREDIT",
      brand: "VISA",
    };
    const venda = {
      ...comum,
      externalId: "venda-demo",
      grossCents: 125000,
      status: "COMPLETED",
    };
    const adquirente = {
      ...comum,
      externalId: "recebivel-demo",
      grossCents: 125000,
      feeCents: 4375,
      netCents: 120625,
      status: "SETTLED",
      payoutRef: "lote-demo",
      expectedSettlementDay: "2026-10-20",
    };
    const banco = {
      ...comum,
      externalId: "credito-demo",
      businessDay: "2026-10-20",
      amountCents: 120625,
      direction: "CREDIT",
      payoutRef: "lote-demo",
      description: "Depósito fictício",
    };
    async function importar(
      fonte: "VENDA" | "ADQUIRENTE" | "BANCO",
      linhas: unknown[],
      contaRef = "conta-demo",
    ) {
      const bytes = Buffer.from(JSON.stringify(linhas));
      const previa = await previaImportacao(ctx, bytes, fonte + ".json", {
        ...periodo,
        fonte,
        contaRef,
        separador: ";",
        moeda: "BRL",
        formatoData: "ISO",
      });
      const confirma = () =>
        confirmarImportacao(ctx, {
          previewId: previa.id,
          expectedHash: previa.arquivoHash,
          requestKey: randomUUID(),
          revisado: false,
          motivo: "",
          substituirConflitos: false,
        });
      return { previa, confirma };
    }
    for (const [fonte, linha] of [
      ["VENDA", venda],
      ["ADQUIRENTE", adquirente],
      ["BANCO", banco],
    ] as const) {
      const { previa, confirma } = await importar(fonte, [linha]);
      const repetida = await previaImportacao(
        ctx,
        Buffer.from(JSON.stringify([linha])),
        fonte + ".json",
        {
          ...periodo,
          fonte,
          contaRef: "conta-demo",
          separador: ";",
          moeda: "BRL",
          formatoData: "ISO",
        },
      );
      assert.equal(repetida.id, previa.id);
      assert.equal((await confirma()).estado, "CONFIRMADA");
      assert.equal((await confirma()).estado, "CONFIRMADA");
    }
    assert.equal(
      await db.conferenciaLinha.count({
        where: { organizacaoId: organizacao.id, ativa: true },
      }),
      3,
    );
    const contratoInicial = await criarContrato(ctx, {
      provedor: "DEMO",
      estabelecimento: "est-demo",
      bandeira: "VISA",
      metodo: "CREDIT",
      parcelasDe: 1,
      parcelasAte: 1,
      de: "2026-01-01",
      ate: null,
      taxaBps: 300,
      fixaCentavos: 0,
      toleranciaCentavos: 0,
    });
    const requestKey = randomUUID();
    const primeira = await executarConferencia(ctx, { ...periodo, requestKey });
    assert.equal(
      (await executarConferencia(ctx, { ...periodo, requestKey })).id,
      primeira.id,
    );
    let painel = await consultarConferencia(ctx, periodo);
    assert.equal(painel.resultados[0].estado, "FEE_DIFFERENCE");
    assert.equal(painel.resultados[0].diferencaTaxaCentavos, 625);
    const r = painel.resultados[0];
    const concorrentes = await Promise.allSettled(
      ["Decisão financeira primeira", "Decisão financeira concorrente"].map(
        (motivo) =>
          registrarDecisao(ctx, r.id, {
            expectedVersion: 0,
            decisao: "CONTESTAR_TAXA",
            motivo,
            evidenciaIds: [],
          }),
      ),
    );
    assert.equal(
      concorrentes.filter((c) => c.status === "fulfilled").length,
      1,
    );
    assert.equal(concorrentes.filter((c) => c.status === "rejected").length, 1);
    await registrarDecisao(ctx, r.id, {
      expectedVersion: 1,
      decisao: "COMENTARIO",
      motivo: "Comentário posterior que preserva a decisão efetiva",
      evidenciaIds: [],
    });
    await executarConferencia(ctx, { ...periodo, requestKey: randomUUID() });
    painel = await consultarConferencia(ctx, periodo);
    assert.equal(painel.resultados[0].decisao?.decisao, "CONTESTAR_TAXA");
    assert.equal(painel.resultados[0].revisaoAdicional, false);
    const atualizada = await importar("ADQUIRENTE", [
      { ...adquirente, feeCents: 5000, netCents: 120000 },
    ]);
    assert.equal((await atualizada.confirma()).estado, "REVISAO");
    await confirmarImportacao(ctx, {
      previewId: atualizada.previa.id,
      expectedHash: atualizada.previa.arquivoHash,
      requestKey: randomUUID(),
      revisado: true,
      motivo: "Correção fictícia revisada no arquivo da adquirente",
      substituirConflitos: true,
    });
    await executarConferencia(ctx, { ...periodo, requestKey: randomUUID() });
    painel = await consultarConferencia(ctx, periodo);
    assert.equal(
      painel.resultados.find((l) => l.vendaId)?.revisaoAdicional,
      true,
    );
    assert.equal(
      painel.resultados.find((l) => l.vendaId)?.decisao?.decisao,
      "CONTESTAR_TAXA",
    );
    const tarifa = {
      provider: "DEMO",
      merchantRef: "est-demo",
      accountRef: "conta-tarifas",
      businessDay: "2026-10-20",
      amountCents: 150,
      direction: "DEBIT",
    };
    const tarifas = await importar("BANCO", [tarifa, tarifa], "conta-tarifas");
    await tarifas.confirma();
    assert.equal(
      await db.conferenciaLinha.count({
        where: {
          organizacaoId: organizacao.id,
          contaRef: "conta-tarifas",
          ativa: true,
        },
      }),
      2,
    );
    const sobreposta = await importar(
      "BANCO",
      [{ ...tarifa, description: "Tarifa fictícia" }],
      "conta-tarifas",
    );
    assert.equal((await sobreposta.confirma()).estado, "REVISAO");
    const parcial = await importar(
      "BANCO",
      [{ ...tarifa, accountRef: "conta-parcial", amountCents: 1.5 }],
      "conta-parcial",
    );
    assert.equal((await parcial.confirma()).estado, "REVISAO");
    await descartarImportacao(
      ctx,
      parcial.previa.id,
      "Arquivo de ensaio inválido; original preservado",
    );
    assert.equal(
      (
        await db.conferenciaImportacao.findUniqueOrThrow({
          where: { id: parcial.previa.id },
        })
      ).estado,
      "DESCARTADA",
    );
    const outroCtx = {
      ...ctx,
      organizacao: { id: "organizacao-inexistente", nome: "Outra" },
    };
    await assert.rejects(
      () => detalharCorrespondencia(outroCtx, r.id),
      /não encontrada/,
    );
    const impVenda = await db.conferenciaImportacao.findFirstOrThrow({
      where: { organizacaoId: organizacao.id, fonte: "VENDA" },
    });
    await assert.rejects(
      () => originalImportacao(outroCtx, impVenda.id),
      /não encontrado/,
    );
    await assert.rejects(
      () =>
        registrarDecisao(
          { ...ctx, permissoes: new Set(["financeiro.ver"]) },
          r.id,
          {
            expectedVersion: 1,
            decisao: "AGUARDAR",
            motivo: "Teste de permissão financeira",
            evidenciaIds: [],
          },
        ),
      /não permite/,
    );
    await assert.rejects(() =>
      db.conferenciaImportacao.update({
        where: { id: impVenda.id },
        data: { original: Buffer.from("alterado") },
      }),
    );
    const decisao = await db.conferenciaDecisao.findFirstOrThrow({
      where: { organizacaoId: organizacao.id },
    });
    await assert.rejects(() =>
      db.conferenciaDecisao.update({
        where: { id: decisao.id },
        data: { motivo: "Reescrever histórico" },
      }),
    );
    await assert.rejects(() =>
      db.conferenciaLinha.create({
        data: {
          organizacaoId: "outra-organizacao",
          unidadeId: unidade.id,
          importacaoId: impVenda.id,
          numero: 100,
          fonte: "VENDA",
          contaRef: "conta-demo",
          bruto: {},
          erros: [],
          hash: "demo",
        },
      }),
    );
    const alocacao = await db.conferenciaAlocacao.findFirstOrThrow({
      where: { organizacaoId: organizacao.id },
      include: { lote: true },
    });
    await assert.rejects(() =>
      db.$transaction(async (tx) => {
        const lote = await tx.conferenciaLote.create({
          data: {
            organizacaoId: organizacao.id,
            unidadeId: unidade.id,
            execucaoId: alocacao.lote.execucaoId,
            chave: "excesso",
            liquidoCentavos: 1,
            componentes: [],
          },
        });
        await tx.conferenciaAlocacao.create({
          data: {
            organizacaoId: organizacao.id,
            unidadeId: unidade.id,
            loteId: lote.id,
            bancoId: alocacao.bancoId,
            centavos: 1,
          },
        });
      }),
    );
    const pdf = Buffer.from("%PDF-1.4\nEvidencia ficticia de conferencia");
    await anexarEvidencia(
      ctx,
      r.id,
      "evidencia-ficticia.pdf",
      pdf,
      "application/pdf",
    );
    const csv = await exportarConferencia(ctx, periodo);
    assert.ok(csv.includes("CONTESTAR_TAXA"));
    assert.ok(csv.includes("Valores em centavos"));
    assert.ok(csv.includes("SHA256"));
    const {
      id: _id,
      organizacaoId: _org,
      unidadeId: _unidade,
      ativa: _ativa,
      criadoEm: _criado,
      criadoPorId: _autor,
      versao: _versao,
      substituiId: _anterior,
      ...camposContrato
    } = contratoInicial;
    void [_id, _org, _unidade, _ativa, _criado, _autor, _versao, _anterior];
    const novaVersao = await criarContrato(ctx, {
      ...camposContrato,
      substituiId: contratoInicial.id,
    });
    assert.equal(novaVersao.versao, 2);
    assert.equal(
      (
        await db.conferenciaContrato.findUniqueOrThrow({
          where: { id: contratoInicial.id },
        })
      ).ativa,
      false,
    );
    assert.equal((await consultarConferencia(outroCtx, periodo)).total, 0);
    // Volta ao exemplo de 6,25 para a inspeção visual, com nova revisão explícita.
    const restaurada = await importar("ADQUIRENTE", [
      {
        ...adquirente,
        description: "Exemplo fictício restaurado para inspeção",
      },
    ]);
    await restaurada.confirma();
    await confirmarImportacao(ctx, {
      previewId: restaurada.previa.id,
      expectedHash: restaurada.previa.arquivoHash,
      requestKey: randomUUID(),
      revisado: true,
      motivo: "Retorno explícito ao exemplo didático de R$ 6,25",
      substituirConflitos: true,
    });
    await executarConferencia(ctx, { ...periodo, requestKey: randomUUID() });
    if (process.env.FINANCEIRO_UI_LOGIN_PATH)
      await writeFile(
        process.env.FINANCEIRO_UI_LOGIN_PATH,
        JSON.stringify({
          email: usuario.email,
          senha,
          organizacaoId: organizacao.id,
          unidadeId: unidade.id,
        }),
        { mode: 0o600 },
      );
    console.log(
      "CONFERENCIA_ENSAIO_OK: idempotência, multiplicidade, revisão, concorrência, imutabilidade, alocação, isolamento, evidência e exportação verificados em banco _test.",
    );
  } finally {
    await db.$disconnect();
  }
}
void main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
