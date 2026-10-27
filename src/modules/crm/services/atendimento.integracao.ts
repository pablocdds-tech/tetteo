import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { db } from "@/server/db";
import {
  criarClienteAtendimento,
  criarEnderecoAtendimento,
  ErroAtendimento,
} from "./atendimento";
import type { CrmUser } from "./scope";

const alvo = new URL(process.env.DATABASE_URL ?? "postgresql://invalid");
if (
  !["localhost", "127.0.0.1"].includes(alvo.hostname) ||
  !alvo.pathname.includes("_test")
)
  throw Error("Exige banco local _test.");
after(async () => db.$disconnect());
test("concorrência serializa criação e principal; replay confirmado não desfaz alteração posterior", async () => {
  const org = await db.organizacao.create({
    data: { nome: "CRM concorrência fictício", slug: randomUUID() },
  });
  const unidade = await db.unidade.create({
    data: { organizacaoId: org.id, nome: "Teste", codigo: "T" },
  });
  const ator = await db.usuario.create({
    data: {
      nome: "Teste",
      email: `${randomUUID()}@example.invalid`,
      status: "ATIVO",
    },
  });
  const user: CrmUser = {
    userId: ator.id,
    role: "ATTENDANT",
    storeIds: [unidade.id],
    permissions: ["crm.ver", "crm.editar"],
  };
  const entrada = {
    storeId: unidade.id,
    chaveUUID: randomUUID(),
    nome: "Pessoa fictícia",
    telefone: "11912345678",
  };
  const [a, b] = await Promise.all([
    criarClienteAtendimento(user, entrada),
    criarClienteAtendimento(user, entrada),
  ]);
  assert.equal(a.cliente.id, b.cliente.id);
  assert.equal(
    await db.crmContact.count({ where: { storeId: unidade.id } }),
    1,
  );
  const endereco = {
    logradouro: "Rua Teste",
    numero: "1",
    complemento: "",
    bairro: "Centro",
    cidade: "São Paulo",
    uf: "SP",
    cep: "",
    referencia: "",
  };
  const criar = (rotulo: string) =>
    criarEnderecoAtendimento(user, a.cliente.id, {
      storeId: unidade.id,
      chaveUUID: randomUUID(),
      rotulo,
      principal: true,
      endereco,
    });
  await Promise.all([criar("Casa"), criar("Trabalho")]);
  const registros = await db.crmEnderecoAtendimento.findMany({
    where: { storeId: unidade.id },
  });
  assert.equal(registros.filter((e) => e.principal).length, 1);
  assert.deepEqual(registros.map((e) => e.versao).sort(), [1, 2]);
  await db.crmContact.update({
    where: { id: a.cliente.id },
    data: { name: "Nome atualizado" },
  });
  await assert.rejects(
    criarClienteAtendimento(user, entrada),
    (e: unknown) =>
      e instanceof ErroAtendimento &&
      e.code === "CONTACT_CHANGED" &&
      e.operacaoConfirmada === true,
  );
  await assert.rejects(
    criarClienteAtendimento({ ...user, userId: randomUUID() }, entrada),
    (e: unknown) =>
      e instanceof ErroAtendimento &&
      e.code === "IDEMPOTENCY_CONFLICT" &&
      !e.operacaoConfirmada,
  );
  assert.equal(
    (await db.crmContact.findUniqueOrThrow({ where: { id: a.cliente.id } }))
      .name,
    "Nome atualizado",
  );
});
