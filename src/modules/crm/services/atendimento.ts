import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import type {
  ClienteAtendimento,
  DetalheClienteAtendimento,
  EnderecoClienteAtendimento,
  ListaClientesAtendimento,
} from "../atendimento-types";
import {
  esquemaAlterarEnderecoAtendimento,
  esquemaConsultarClienteAtendimento,
  esquemaCriarClienteAtendimento,
  esquemaCriarEnderecoAtendimento,
  esquemaEnderecoAtendimento,
  esquemaListaClientesAtendimento,
} from "../schemas/atendimento";
import { prisma } from "./database";
import { assertStoreAccess, can, type CrmUser } from "./scope";
import { lockStore } from "./campaign-service";
import { CrmError } from "./campaign-domain";

type Tx = Prisma.TransactionClient;
export const LIMITE_ENDERECOS_ATIVOS = 20;
export class ErroAtendimento extends CrmError {
  constructor(
    code: string,
    message: string,
    status = 409,
    public clienteExistente?: ClienteAtendimento,
    public operacaoConfirmada?: boolean,
  ) {
    super(code, message, status);
  }
}
async function autorizar(user: CrmUser, storeId: string, escrita = false) {
  if (!can(user, "CRM", "VIEW") || (escrita && !can(user, "CRM", "EDIT")))
    throw new ErroAtendimento(
      "FORBIDDEN",
      "Sem permissão para esta operação de clientes.",
      403,
    );
  assertStoreAccess(user, storeId);
  if (
    !(await prisma.unidade.findFirst({
      where: {
        id: storeId,
        ativa: true,
        excluidoEm: null,
        organizacao: { ativa: true, excluidoEm: null },
      },
      select: { id: true },
    }))
  )
    throw new ErroAtendimento("NOT_FOUND", "Unidade indisponível.", 404);
}
const cliente = (c: {
  id: string;
  name: string;
  phone: string | null;
}): ClienteAtendimento => ({ id: c.id, nome: c.name, telefone: c.phone });
function endereco(
  e: Prisma.CrmEnderecoAtendimentoGetPayload<object>,
): EnderecoClienteAtendimento {
  return {
    id: e.id,
    rotulo: e.rotulo,
    principal: e.principal,
    ativo: e.ativo,
    versao: e.versao,
    endereco: esquemaEnderecoAtendimento.parse(e.endereco),
  };
}
async function contatoAtivo(tx: Tx, storeId: string, id: string) {
  const c = await tx.crmContact.findFirst({
    where: { storeId, id, active: true, mergedIntoId: null },
    select: { id: true, name: true, phone: true, updatedAt: true },
  });
  if (!c)
    throw new ErroAtendimento(
      "NOT_FOUND",
      "Cliente indisponível nesta unidade.",
      404,
    );
  return c;
}
function hash(payload: unknown) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}
async function operacaoAnterior(
  tx: Tx,
  user: CrmUser,
  storeId: string,
  chave: string,
  tipo: string,
  payloadHash: string,
) {
  const anterior = await tx.crmAtendimentoOperacao.findUnique({
    where: { storeId_chave: { storeId, chave } },
  });
  if (
    anterior &&
    (anterior.actorId !== user.userId ||
      anterior.tipo !== tipo ||
      anterior.payloadHash !== payloadHash)
  )
    throw new ErroAtendimento(
      "IDEMPOTENCY_CONFLICT",
      "Esta tentativa já foi usada com outros dados ou por outra pessoa. Atualize a tela.",
    );
  return anterior;
}
async function auditar(
  tx: Tx,
  user: CrmUser,
  storeId: string,
  entidade: string,
  id: string,
  acao: string,
  campos: string[],
  metadados: Prisma.InputJsonObject = {},
) {
  await tx.crmAuditEvent.create({
    data: {
      storeId,
      actorId: user.userId,
      entityType: entidade,
      entityId: id,
      action: acao,
      data: { fields: campos, ...metadados },
    },
  });
}
async function retirarPrincipal(
  tx: Tx,
  user: CrmUser,
  storeId: string,
  contactId: string,
  exceto?: string,
) {
  const anteriores = await tx.crmEnderecoAtendimento.findMany({
    where: {
      storeId,
      contactId,
      ativo: true,
      principal: true,
      ...(exceto ? { id: { not: exceto } } : {}),
    },
    select: { id: true, versao: true },
  });
  for (const e of anteriores) {
    await tx.crmEnderecoAtendimento.update({
      where: { id: e.id },
      data: { principal: false, versao: { increment: 1 } },
    });
    await auditar(
      tx,
      user,
      storeId,
      "CrmEnderecoAtendimento",
      e.id,
      "UPDATE",
      ["principal"],
      { versao: e.versao + 1 },
    );
  }
}
export async function listarClientesAtendimento(
  user: CrmUser,
  entrada: unknown,
): Promise<ListaClientesAtendimento> {
  const dados = esquemaListaClientesAtendimento.parse(entrada);
  await autorizar(user, dados.storeId);
  const where: Prisma.CrmContactWhereInput = {
    storeId: dados.storeId,
    active: true,
    mergedIntoId: null,
  };
  if (dados.busca) {
    const literal = dados.busca.replace(/[\\%_]/g, "\\$&");
    const digitos = dados.busca.replace(/\D/g, "");
    where.OR = [
      { name: { contains: literal, mode: "insensitive" } },
      ...(digitos.length >= 3 ? [{ phone: { contains: digitos } }] : []),
    ];
  }
  return prisma.$transaction(
    async (tx) => {
      const total = await tx.crmContact.count({ where });
      const totalPaginas = Math.max(1, Math.ceil(total / 20));
      const pagina = Math.min(dados.pagina, totalPaginas);
      const contatos = await tx.crmContact.findMany({
        where,
        select: { id: true, name: true, phone: true },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        skip: (pagina - 1) * 20,
        take: 20,
      });
      return { clientes: contatos.map(cliente), total, pagina, totalPaginas };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
export async function consultarClienteAtendimento(
  user: CrmUser,
  entrada: unknown,
): Promise<DetalheClienteAtendimento> {
  const dados = esquemaConsultarClienteAtendimento.parse(entrada);
  await autorizar(user, dados.storeId);
  return prisma.$transaction(
    async (tx) => {
      const c = await contatoAtivo(tx, dados.storeId, dados.clienteId);
      const enderecos = await tx.crmEnderecoAtendimento.findMany({
        where: { storeId: dados.storeId, contactId: c.id, ativo: true },
        orderBy: [{ principal: "desc" }, { criadoEm: "asc" }, { id: "asc" }],
      });
      return { cliente: cliente(c), enderecos: enderecos.map(endereco) };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
export async function criarClienteAtendimento(
  user: CrmUser,
  entrada: unknown,
): Promise<{ cliente: ClienteAtendimento }> {
  const dados = esquemaCriarClienteAtendimento.parse(entrada);
  await autorizar(user, dados.storeId, true);
  const payloadHash = hash({ nome: dados.nome, telefone: dados.telefone });
  return prisma.$transaction(async (tx) => {
    await lockStore(tx, dados.storeId);
    const anterior = await operacaoAnterior(
      tx,
      user,
      dados.storeId,
      dados.chaveUUID,
      "CRIAR_CLIENTE",
      payloadHash,
    );
    if (anterior) {
      const c = await contatoAtivo(tx, dados.storeId, anterior.contactId).catch(
        (erro: unknown) => {
          if (erro instanceof ErroAtendimento) erro.operacaoConfirmada = true;
          throw erro;
        },
      );
      if (anterior.contatoAtualizadoEm?.getTime() !== c.updatedAt.getTime())
        throw new ErroAtendimento(
          "CONTACT_CHANGED",
          "Este cadastro mudou depois da criação. Atualize a busca para selecionar os dados atuais.",
          409,
          undefined,
          true,
        );
      return { cliente: cliente(c) };
    }
    const existente = await tx.crmContact.findUnique({
      where: {
        storeId_phone: { storeId: dados.storeId, phone: dados.telefone },
      },
      select: {
        id: true,
        name: true,
        phone: true,
        active: true,
        mergedIntoId: true,
      },
    });
    if (existente)
      throw new ErroAtendimento(
        "TELEFONE_DUPLICADO",
        "Já existe um cadastro com este telefone nesta unidade. Revise o cliente antes de continuar.",
        409,
        existente.active && !existente.mergedIntoId
          ? cliente(existente)
          : undefined,
      );
    const c = await tx.crmContact.create({
      data: {
        storeId: dados.storeId,
        name: dados.nome,
        phone: dados.telefone,
        marketingOptIn: false,
      },
      select: { id: true, name: true, phone: true, updatedAt: true },
    });
    await tx.crmAtendimentoOperacao.create({
      data: {
        storeId: dados.storeId,
        chave: dados.chaveUUID,
        actorId: user.userId,
        tipo: "CRIAR_CLIENTE",
        payloadHash,
        contactId: c.id,
        contatoAtualizadoEm: c.updatedAt,
      },
    });
    await auditar(
      tx,
      user,
      dados.storeId,
      "CrmContact",
      c.id,
      "CREATE",
      ["name", "phone"],
      { marketingOptIn: false, origem: "ATENDIMENTO" },
    );
    return { cliente: cliente(c) };
  });
}
async function retomarEndereco(
  tx: Tx,
  storeId: string,
  clienteId: string,
  anterior: Prisma.CrmAtendimentoOperacaoGetPayload<object>,
) {
  if (anterior.contactId !== clienteId || !anterior.enderecoId)
    throw new ErroAtendimento(
      "IDEMPOTENCY_CONFLICT",
      "Esta tentativa pertence a outro cadastro.",
    );
  await contatoAtivo(tx, storeId, clienteId).catch((erro: unknown) => {
    if (erro instanceof ErroAtendimento) erro.operacaoConfirmada = true;
    throw erro;
  });
  const e = await tx.crmEnderecoAtendimento.findFirst({
    where: { storeId, contactId: clienteId, id: anterior.enderecoId },
  });
  if (!e || e.versao !== anterior.versaoEndereco)
    throw new ErroAtendimento(
      "ADDRESS_CHANGED",
      "Este endereço mudou depois desta operação. Atualize o cadastro antes de continuar.",
      409,
      undefined,
      true,
    );
  if (!e.ativo && anterior.tipo === "CRIAR_ENDERECO")
    throw new ErroAtendimento(
      "ADDRESS_INACTIVE",
      "Este endereço não está mais ativo. Atualize o cadastro antes de continuar.",
      409,
      undefined,
      true,
    );
  return { endereco: endereco(e) };
}
export async function criarEnderecoAtendimento(
  user: CrmUser,
  clienteId: string,
  entrada: unknown,
): Promise<{ endereco: EnderecoClienteAtendimento }> {
  const dados = esquemaCriarEnderecoAtendimento.parse(entrada);
  esquemaConsultarClienteAtendimento.parse({
    storeId: dados.storeId,
    clienteId,
  });
  await autorizar(user, dados.storeId, true);
  const payloadHash = hash({
    clienteId,
    rotulo: dados.rotulo,
    principal: dados.principal,
    endereco: dados.endereco,
  });
  return prisma.$transaction(async (tx) => {
    await lockStore(tx, dados.storeId);
    const anterior = await operacaoAnterior(
      tx,
      user,
      dados.storeId,
      dados.chaveUUID,
      "CRIAR_ENDERECO",
      payloadHash,
    );
    if (anterior)
      return retomarEndereco(tx, dados.storeId, clienteId, anterior);
    await contatoAtivo(tx, dados.storeId, clienteId);
    if (
      (await tx.crmEnderecoAtendimento.count({
        where: { storeId: dados.storeId, contactId: clienteId, ativo: true },
      })) >= LIMITE_ENDERECOS_ATIVOS
    )
      throw new ErroAtendimento(
        "ADDRESS_LIMIT",
        `Este cliente já possui ${LIMITE_ENDERECOS_ATIVOS} endereços ativos. Inative um endereço antes de cadastrar outro.`,
      );
    if (dados.principal)
      await retirarPrincipal(tx, user, dados.storeId, clienteId);
    const e = await tx.crmEnderecoAtendimento.create({
      data: {
        storeId: dados.storeId,
        contactId: clienteId,
        rotulo: dados.rotulo,
        principal: dados.principal,
        endereco: dados.endereco,
      },
    });
    await tx.crmAtendimentoOperacao.create({
      data: {
        storeId: dados.storeId,
        chave: dados.chaveUUID,
        actorId: user.userId,
        tipo: "CRIAR_ENDERECO",
        payloadHash,
        contactId: clienteId,
        enderecoId: e.id,
        versaoEndereco: e.versao,
      },
    });
    await auditar(
      tx,
      user,
      dados.storeId,
      "CrmEnderecoAtendimento",
      e.id,
      "CREATE",
      ["rotulo", "principal", "endereco"],
      { contactId: clienteId, versao: e.versao },
    );
    return { endereco: endereco(e) };
  });
}
export async function alterarEnderecoAtendimento(
  user: CrmUser,
  clienteId: string,
  enderecoId: string,
  entrada: unknown,
): Promise<{ endereco: EnderecoClienteAtendimento }> {
  const dados = esquemaAlterarEnderecoAtendimento.parse(entrada);
  esquemaConsultarClienteAtendimento.parse({
    storeId: dados.storeId,
    clienteId,
  });
  esquemaConsultarClienteAtendimento.shape.clienteId.parse(enderecoId);
  await autorizar(user, dados.storeId, true);
  const { chaveUUID: chave, ...payload } = dados;
  const payloadHash = hash({ clienteId, enderecoId, ...payload });
  return prisma.$transaction(async (tx) => {
    await lockStore(tx, dados.storeId);
    const anterior = await operacaoAnterior(
      tx,
      user,
      dados.storeId,
      chave,
      "ALTERAR_ENDERECO",
      payloadHash,
    );
    if (anterior)
      return retomarEndereco(tx, dados.storeId, clienteId, anterior);
    await contatoAtivo(tx, dados.storeId, clienteId);
    const antes = await tx.crmEnderecoAtendimento.findFirst({
      where: { storeId: dados.storeId, contactId: clienteId, id: enderecoId },
    });
    if (!antes)
      throw new ErroAtendimento(
        "NOT_FOUND",
        "Endereço indisponível para este cliente.",
        404,
      );
    if (antes.versao !== dados.versao)
      throw new ErroAtendimento(
        "ADDRESS_CHANGED",
        "Este endereço mudou em outra tela. Atualize o cadastro antes de salvar.",
      );
    if (
      !antes.ativo &&
      dados.ativo &&
      (await tx.crmEnderecoAtendimento.count({
        where: { storeId: dados.storeId, contactId: clienteId, ativo: true },
      })) >= LIMITE_ENDERECOS_ATIVOS
    )
      throw new ErroAtendimento(
        "ADDRESS_LIMIT",
        `Este cliente já possui ${LIMITE_ENDERECOS_ATIVOS} endereços ativos.`,
      );
    if (dados.principal)
      await retirarPrincipal(tx, user, dados.storeId, clienteId, enderecoId);
    const e = await tx.crmEnderecoAtendimento.update({
      where: { id: antes.id },
      data: {
        rotulo: dados.rotulo,
        principal: dados.principal,
        ativo: dados.ativo,
        endereco: dados.endereco,
        versao: { increment: 1 },
      },
    });
    await tx.crmAtendimentoOperacao.create({
      data: {
        storeId: dados.storeId,
        chave,
        actorId: user.userId,
        tipo: "ALTERAR_ENDERECO",
        payloadHash,
        contactId: clienteId,
        enderecoId: e.id,
        versaoEndereco: e.versao,
      },
    });
    await auditar(
      tx,
      user,
      dados.storeId,
      "CrmEnderecoAtendimento",
      e.id,
      "UPDATE",
      ["rotulo", "principal", "ativo", "endereco"],
      { contactId: clienteId, versao: e.versao, ativo: e.ativo },
    );
    return { endereco: endereco(e) };
  });
}
