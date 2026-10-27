import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { db } from "@/server/db";
import type {
  ClienteAtendimento,
  DetalheClienteAtendimento,
  EnderecoClienteAtendimento,
  ListaClientesAtendimento,
} from "../atendimento-types";
import type { CrmUser } from "./scope";
import router from "./atendimento-routes";

const alvo = new URL(process.env.DATABASE_URL ?? "postgresql://invalid");
if (
  !["localhost", "127.0.0.1"].includes(alvo.hostname) ||
  !alvo.pathname.includes("_test")
)
  throw new Error("Este teste exige banco local exclusivo _test.");
after(async () => db.$disconnect());

test("atendimento via router: pesquisa integral, autorização, duplicatas, versões e replay não expõem nem sobrescrevem cadastros", async () => {
  const org = await db.organizacao.create({
    data: {
      nome: "Rede fictícia atendimento",
      slug: `atendimento-fluxo-${randomUUID()}`,
    },
  });
  const unidade = await db.unidade.create({
    data: {
      organizacaoId: org.id,
      nome: "Atendimento fictício",
      codigo: "TESTE",
    },
  });
  const outra = await db.unidade.create({
    data: { organizacaoId: org.id, nome: "Outra fictícia", codigo: "OUTRA" },
  });
  const ator = await db.usuario.create({
    data: {
      nome: "Atendente fictício",
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
  async function requisitar<T>(
    method: string,
    path: string,
    body: unknown = {},
    query: Record<string, string> = {},
    usuario = user,
    status = 200,
  ): Promise<T> {
    const res = await router.dispatch({
      method,
      path,
      body,
      query,
      user: usuario,
      params: {},
      header: () => undefined,
    });
    assert.ok(res, "rota registrada");
    const dados = await res.json();
    assert.equal(res.status, status, JSON.stringify(dados));
    assert.match(res.headers.get("cache-control") ?? "", /no-store/);
    return dados as T;
  }
  const criar = (
    telefone: string,
    nome = "Pessoa fictícia reservada",
    chaveUUID = randomUUID(),
  ) => ({ storeId: unidade.id, chaveUUID, nome, telefone });
  await db.crmContact.createMany({
    data: Array.from({ length: 505 }, (_, i) => ({
      storeId: unidade.id,
      name: `AAA fictício ${String(i).padStart(3, "0")}`,
      phone: `55849800${String(i).padStart(5, "0")}`,
    })),
  });
  const tentativa = criar("(84) 99999-1234", "ZZZ Pessoa fictícia reservada");
  const criado = await requisitar<{ cliente: ClienteAtendimento }>(
    "POST",
    "/atendimento/clientes",
    tentativa,
    {},
    user,
    201,
  );
  assert.equal(criado.cliente.telefone, "5584999991234");
  assert.deepEqual(
    await requisitar("POST", "/atendimento/clientes", tentativa, {}, user, 201),
    criado,
  );
  const lista = await requisitar<ListaClientesAtendimento>(
    "GET",
    "/atendimento/clientes",
    {},
    { storeId: unidade.id, busca: "(84) 99999-1234" },
  );
  assert.equal(lista.total, 1);
  assert.equal(
    lista.clientes[0].id,
    criado.cliente.id,
    "pesquisa servidor encontra cadastro além dos primeiros 500",
  );
  const pagina = await requisitar<ListaClientesAtendimento>(
    "GET",
    "/atendimento/clientes",
    {},
    { storeId: unidade.id, pagina: "999" },
  );
  assert.equal(pagina.total, 506);
  assert.equal(pagina.pagina, 26);
  assert.equal(pagina.clientes.length, 6);
  assert.equal(
    (
      await requisitar<ListaClientesAtendimento>(
        "GET",
        "/atendimento/clientes",
        {},
        { storeId: unidade.id, busca: "%" },
      )
    ).total,
    0,
  );
  await requisitar(
    "GET",
    "/atendimento/clientes",
    {},
    { storeId: outra.id },
    user,
    403,
  );
  await requisitar(
    "GET",
    "/atendimento/clientes",
    {},
    { storeId: unidade.id },
    { ...user, permissions: ["pdv.ver"] },
    403,
  );
  await requisitar(
    "POST",
    "/atendimento/clientes",
    criar("84999991235"),
    {},
    { ...user, permissions: ["crm.ver"] },
    403,
  );
  await requisitar(
    "POST",
    "/atendimento/clientes",
    { ...tentativa, marketingOptIn: true },
    {},
    user,
    400,
  );
  const duplicado = await requisitar<{ clienteExistente: ClienteAtendimento }>(
    "POST",
    "/atendimento/clientes",
    criar("+55 84 99999-1234", "Tentativa de substituir"),
    {},
    user,
    409,
  );
  assert.equal(duplicado.clienteExistente.id, criado.cliente.id);
  await requisitar(
    "POST",
    "/atendimento/clientes",
    { ...tentativa, nome: "Outro nome" },
    {},
    user,
    409,
  );
  const replayOutroAtor = await requisitar<{ operacaoConfirmada?: boolean }>(
    "POST",
    "/atendimento/clientes",
    tentativa,
    {},
    { ...user, userId: randomUUID() },
    409,
  );
  assert.equal(replayOutroAtor.operacaoConfirmada, undefined);
  const contato = await db.crmContact.findUniqueOrThrow({
    where: { id: criado.cliente.id },
  });
  assert.equal(contato.name, tentativa.nome);
  assert.equal(contato.marketingOptIn, false);
  assert.equal(
    await db.crmIdentity.count({ where: { storeId: unidade.id } }),
    0,
  );
  assert.equal(
    await db.crmConsent.count({ where: { storeId: unidade.id } }),
    0,
  );
  const path = `/atendimento/clientes/${criado.cliente.id}`;
  const endereco = {
    logradouro: "Rua fictícia reservada",
    numero: "123",
    complemento: "",
    bairro: "Centro fictício",
    cidade: "Mossoró",
    uf: "RN",
    cep: "59600-000",
    referencia: "Portão fictício reservado",
  };
  const nova = (rotulo: string, principal = false) => ({
    storeId: unidade.id,
    chaveUUID: randomUUID(),
    rotulo,
    principal,
    endereco,
  });
  const primeiraTentativa = nova("Casa", true);
  const primeira = await requisitar<{ endereco: EnderecoClienteAtendimento }>(
    "POST",
    `${path}/enderecos`,
    primeiraTentativa,
    {},
    user,
    201,
  );
  assert.equal(primeira.endereco.endereco.cep, "59600000");
  assert.deepEqual(
    await requisitar(
      "POST",
      `${path}/enderecos`,
      primeiraTentativa,
      {},
      user,
      201,
    ),
    primeira,
  );
  const enderecoOutroAtor = await requisitar<{ operacaoConfirmada?: boolean }>(
    "POST",
    `${path}/enderecos`,
    primeiraTentativa,
    {},
    { ...user, userId: randomUUID() },
    409,
  );
  assert.equal(enderecoOutroAtor.operacaoConfirmada, undefined);
  const segundaTentativa = nova("Trabalho", true);
  const segunda = await requisitar<{ endereco: EnderecoClienteAtendimento }>(
    "POST",
    `${path}/enderecos`,
    segundaTentativa,
    {},
    user,
    201,
  );
  const detalhe = await requisitar<DetalheClienteAtendimento>(
    "GET",
    path,
    {},
    { storeId: unidade.id },
  );
  assert.equal(detalhe.enderecos.filter((e) => e.principal).length, 1);
  assert.equal(detalhe.enderecos[0].id, segunda.endereco.id);
  const primeiraAtual = detalhe.enderecos.find(
    (e) => e.id === primeira.endereco.id,
  )!;
  assert.equal(primeiraAtual.versao, 2);
  assert.equal(primeiraAtual.principal, false);
  const replayMudou = await requisitar<{ operacaoConfirmada?: boolean }>(
    "POST",
    `${path}/enderecos`,
    primeiraTentativa,
    {},
    user,
    409,
  );
  assert.equal(replayMudou.operacaoConfirmada, true);
  const atualizar = { ...nova("Casa editada"), versao: 1, ativo: true };
  const versaoAntiga = await requisitar<{ operacaoConfirmada?: boolean }>(
    "PUT",
    `${path}/enderecos/${primeira.endereco.id}`,
    atualizar,
    {},
    user,
    409,
  );
  assert.equal(versaoAntiga.operacaoConfirmada, undefined);
  const inativar = {
    ...nova("Trabalho arquivado"),
    versao: segunda.endereco.versao,
    ativo: false,
  };
  const inativo = await requisitar<{ endereco: EnderecoClienteAtendimento }>(
    "PUT",
    `${path}/enderecos/${segunda.endereco.id}`,
    inativar,
  );
  assert.equal(inativo.endereco.ativo, false);
  assert.deepEqual(
    await requisitar(
      "PUT",
      `${path}/enderecos/${segunda.endereco.id}`,
      inativar,
    ),
    inativo,
  );
  assert.equal(
    (
      await requisitar<DetalheClienteAtendimento>(
        "GET",
        path,
        {},
        { storeId: unidade.id },
      )
    ).enderecos.length,
    1,
  );
  await requisitar("GET", path, {}, { storeId: outra.id }, user, 403);
  const estrangeiro = await db.crmContact.create({
    data: {
      storeId: outra.id,
      name: "Cliente outra unidade fictícia",
      phone: "5584999991234",
    },
  });
  await requisitar(
    "GET",
    `/atendimento/clientes/${estrangeiro.id}`,
    {},
    { storeId: unidade.id },
    user,
    404,
  );
  await requisitar(
    "POST",
    `/atendimento/clientes/${estrangeiro.id}/enderecos`,
    nova("Proibido"),
    {},
    user,
    404,
  );
  for (let i = 1; i < 20; i++)
    await requisitar(
      "POST",
      `${path}/enderecos`,
      nova(`Fictício ${i}`),
      {},
      user,
      201,
    );
  await requisitar(
    "POST",
    `${path}/enderecos`,
    nova("Excede limite"),
    {},
    user,
    409,
  );
  await requisitar(
    "PUT",
    `${path}/enderecos/${segunda.endereco.id}`,
    { ...nova("Reativar"), versao: inativo.endereco.versao, ativo: true },
    {},
    user,
    409,
  );
  await db.crmContact.update({
    where: { id: criado.cliente.id },
    data: { active: false },
  });
  await requisitar("GET", path, {}, { storeId: unidade.id }, user, 404);
  const replayArquivado = await requisitar<{ operacaoConfirmada?: boolean }>(
    "POST",
    "/atendimento/clientes",
    tentativa,
    {},
    user,
    404,
  );
  assert.equal(replayArquivado.operacaoConfirmada, true);
  const arquivado = await requisitar<Record<string, unknown>>(
    "POST",
    "/atendimento/clientes",
    criar("84999991234"),
    {},
    user,
    409,
  );
  assert.equal(
    arquivado.clienteExistente,
    undefined,
    "duplicata arquivada não expõe identidade",
  );
  const auditorias = await db.crmAuditEvent.findMany({
    where: { storeId: unidade.id },
    select: { data: true },
  });
  assert.doesNotMatch(
    JSON.stringify(auditorias),
    /Rua fictícia reservada|999991234|Portão fictício reservado|ZZZ Pessoa/,
  );
  const operacoes = await db.crmAtendimentoOperacao.findMany({
    where: { storeId: unidade.id },
  });
  assert.doesNotMatch(
    JSON.stringify(operacoes),
    /Rua fictícia reservada|999991234|Portão fictício reservado|ZZZ Pessoa/,
  );
});
