import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import type { ContextoSessao } from "@/core/sessao/nucleo";
import { db } from "@/server/db";
import { obterPreparacaoPdv } from "./preparacao";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://invalid");
if (
  !["localhost", "127.0.0.1"].includes(url.hostname) ||
  !url.pathname.includes("_test")
)
  throw new Error("Este teste exige banco local exclusivo _test.");
after(async () => db.$disconnect());

test("preparação isola unidade, tolera produto inválido e apenas consulta os cadastros", async () => {
  const slug = `pdv-preparacao-test-${randomUUID()}`;
  const org = await db.organizacao.create({
    data: { nome: "Preparação fictícia", slug },
  });
  const outraOrg = await db.organizacao.create({
    data: { nome: "Outra fictícia", slug: `${slug}-outra` },
  });
  const unidade = await db.unidade.create({
    data: { organizacaoId: org.id, nome: "Matriz fictícia", codigo: "TESTE" },
  });
  const outraUnidade = await db.unidade.create({
    data: {
      organizacaoId: outraOrg.id,
      nome: "Outra fictícia",
      codigo: "OUTRA",
    },
  });
  const local = await db.localEstoque.create({
    data: { unidadeId: unidade.id, nome: "Local fictício" },
  });
  const localInativo = await db.localEstoque.create({
    data: { unidadeId: unidade.id, nome: "Inativo fictício", ativo: false },
  });
  const outroLocal = await db.localEstoque.create({
    data: { unidadeId: outraUnidade.id, nome: "Outro fictício" },
  });
  const ctx: ContextoSessao = {
    usuario: {
      id: "somente-leitura-ficticio",
      nome: "Operador fictício",
      email: `${slug}@example.invalid`,
      avatarUrl: null,
    },
    organizacao: org,
    unidadeAtiva: unidade,
    unidadesVisiveis: [unidade],
    podeVerRedeInteira: false,
    permissoes: new Set(["pdv.ver", "pdv.configurar"]),
    ehDiretor: false,
  };
  const insumo = await db.insumo.create({
    data: {
      organizacaoId: org.id,
      nome: "Insumo fictício",
      unidadeMedida: "UN",
    },
  });
  const prato = await db.fichaTecnica.create({
    data: {
      organizacaoId: org.id,
      nome: "Produto pronto fictício",
      precoVenda: 3,
      itens: { create: { insumoId: insumo.id, quantidade: 1, unidade: "UN" } },
    },
  });
  await db.posicaoEstoque.create({
    data: {
      unidadeId: unidade.id,
      localId: local.id,
      insumoId: insumo.id,
      quantidade: 0,
    },
  });
  const invalido = await db.fichaTecnica.create({
    data: {
      organizacaoId: org.id,
      nome: "Complementos inválidos fictício",
      precoVenda: 3,
      itens: { create: { insumoId: insumo.id, quantidade: 1, unidade: "UN" } },
    },
  });
  await db.pdvProduto.create({
    data: {
      organizacaoId: org.id,
      fichaId: invalido.id,
      grupos: { incorreto: true },
    },
  });
  const inativo = await db.fichaTecnica.create({
    data: { organizacaoId: org.id, nome: "Inativo fictício", ativo: false },
  });
  const ciclo = await db.fichaTecnica.create({
    data: { organizacaoId: org.id, nome: "Ciclo fictício", precoVenda: 1 },
  });
  await db.itemDeFicha.create({
    data: {
      fichaId: ciclo.id,
      subFichaId: ciclo.id,
      quantidade: 1,
      unidade: "UN",
    },
  });
  await db.fichaTecnica.create({
    data: {
      organizacaoId: outraOrg.id,
      nome: "Produto secreto de outra organização",
      precoVenda: 1,
    },
  });
  const antes = {
    fichas: await db.fichaTecnica.count({ where: { organizacaoId: org.id } }),
    configs: await db.pdvProduto.count({ where: { organizacaoId: org.id } }),
    auditorias: await db.auditoria.count({ where: { organizacaoId: org.id } }),
  };
  const resultado = await obterPreparacaoPdv(ctx);
  assert.equal(resultado.localId, local.id);
  assert.equal(resultado.contadores.produtos, 4);
  assert.equal(resultado.contadores.prontos, 1);
  assert.equal(resultado.produtos.find((p) => p.id === prato.id)?.pronto, true);
  assert.equal(
    resultado.produtos.find((p) => p.id === prato.id)?.estoque[0].disponivel,
    0,
  );
  assert.ok(
    resultado.produtos
      .find((p) => p.id === prato.id)
      ?.pendencias.some((p) => p.nivel === "ESTOQUE"),
  );
  assert.ok(
    resultado.produtos
      .find((p) => p.id === invalido.id)
      ?.pendencias.some((p) => p.codigo === "complementos_invalidos"),
  );
  assert.ok(
    resultado.produtos
      .find((p) => p.id === inativo.id)
      ?.pendencias.some((p) => p.codigo === "produto_inativo"),
  );
  assert.ok(
    resultado.produtos
      .find((p) => p.id === ciclo.id)
      ?.pendencias.some((p) => p.mensagem.includes("ciclo")),
  );
  await assert.rejects(
    () => obterPreparacaoPdv(ctx, outroLocal.id),
    /desta unidade/,
  );
  await assert.rejects(
    () => obterPreparacaoPdv(ctx, localInativo.id),
    /desta unidade/,
  );
  await assert.rejects(
    () => obterPreparacaoPdv({ ...ctx, permissoes: new Set(["pdv.ver"]) }),
    /permissão/,
  );
  await assert.rejects(
    () =>
      obterPreparacaoPdv({
        ...ctx,
        unidadeAtiva: outraUnidade,
        unidadesVisiveis: [outraUnidade],
      }),
    /permissão/,
  );
  await db.localEstoque.update({
    where: { id: local.id },
    data: { ativo: false },
  });
  const semLocal = await obterPreparacaoPdv(ctx);
  assert.equal(semLocal.localId, null);
  assert.equal(
    semLocal.produtos.find((p) => p.id === prato.id)?.estoque[0].disponivel,
    null,
  );
  assert.ok(
    semLocal.etapas.some((e) => e.id === "estoque" && e.status === "PENDENTE"),
  );
  assert.equal(
    await db.fichaTecnica.count({ where: { organizacaoId: org.id } }),
    antes.fichas,
  );
  assert.equal(
    await db.pdvProduto.count({ where: { organizacaoId: org.id } }),
    antes.configs,
  );
  assert.equal(
    await db.auditoria.count({ where: { organizacaoId: org.id } }),
    antes.auditorias,
  );
});
