"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { obterContexto } from "@/core/sessao/contexto";
import {
  criarEmpresaBancaria,
  editarEmpresaBancaria,
  salvarContaBancaria,
  transferirEntreContas,
  estornarTransferencia,
} from "./services/bancos";

export type EstadoBanco = { erro?: string; ok?: string; proximaChave?: string };

function erroBanco(erro: unknown): EstadoBanco {
  if (erro instanceof ZodError)
    return { erro: erro.issues.map((i) => i.message).join(" ") };
  if (erro instanceof Prisma.PrismaClientKnownRequestError) {
    if (erro.code === "P2002")
      return {
        erro: "Já existe um cadastro com esse CNPJ, nome ou identificação bancária. Confira os dados.",
      };
    return {
      erro: "Não foi possível salvar. Atualize a página e confira os dados.",
    };
  }
  if (erro instanceof Prisma.PrismaClientUnknownRequestError)
    return {
      erro: "Não foi possível salvar. Atualize a página e confira os dados.",
    };
  return {
    erro: erro instanceof Error ? erro.message : "Não foi possível salvar.",
  };
}

function atualizarBancos() {
  for (const rota of [
    "/financeiro",
    "/financeiro/contas",
    "/financeiro/pagar",
    "/financeiro/receber",
    "/financeiro/categorias",
    "/financeiro/resultado",
  ])
    revalidatePath(rota);
  revalidatePath("/financeiro/contas/[id]", "page");
}

export async function empresaBancariaAcao(
  _estado: EstadoBanco,
  dados: FormData,
): Promise<EstadoBanco> {
  const ctx = await obterContexto();
  if (!ctx) redirect("/login");
  try {
    const entrada = {
      ...Object.fromEntries(dados),
      emiteNota: dados.get("emiteNota") === "on",
      ativa: dados.get("ativa") === "on",
    };
    const id = String(dados.get("id") || "");
    if (id)
      await editarEmpresaBancaria(
        ctx,
        id,
        entrada,
        String(dados.get("assinatura") || ""),
      );
    else await criarEmpresaBancaria(ctx, entrada);
    atualizarBancos();
    return {
      ok: id
        ? "Empresa atualizada."
        : "Empresa cadastrada. Agora vincule as contas ao CNPJ.",
    };
  } catch (erro) {
    return erroBanco(erro);
  }
}

export async function contaBancariaAcao(
  _estado: EstadoBanco,
  dados: FormData,
): Promise<EstadoBanco> {
  const ctx = await obterContexto();
  if (!ctx) redirect("/login");
  try {
    const id = String(dados.get("id") || "") || null;
    const versao = Number(dados.get("versao") || 0);
    if (!Number.isSafeInteger(versao) || versao < 0)
      return { erro: "Atualize a página antes de editar." };
    await salvarContaBancaria(
      ctx,
      id,
      {
        ...Object.fromEntries(dados),
        ativa: dados.get("ativa") === "on",
        compensacao: dados.get("compensacao") === "on",
      },
      versao,
    );
    atualizarBancos();
    return { ok: "Conta salva." };
  } catch (erro) {
    return erroBanco(erro);
  }
}

export async function transferenciaBancariaAcao(
  _estado: EstadoBanco,
  dados: FormData,
): Promise<EstadoBanco> {
  const ctx = await obterContexto();
  if (!ctx) redirect("/login");
  try {
    await transferirEntreContas(ctx, Object.fromEntries(dados));
    atualizarBancos();
    return {
      ok: "Transferência registrada nos dois extratos.",
      proximaChave: randomUUID(),
    };
  } catch (erro) {
    return erroBanco(erro);
  }
}

export async function estornoBancarioAcao(
  _estado: EstadoBanco,
  dados: FormData,
): Promise<EstadoBanco> {
  const ctx = await obterContexto();
  if (!ctx) redirect("/login");
  try {
    await estornarTransferencia(
      ctx,
      String(dados.get("id") || ""),
      String(dados.get("data") || ""),
      String(dados.get("motivo") || ""),
      String(dados.get("chave") || ""),
    );
    atualizarBancos();
    return {
      ok: "Estorno registrado. A transferência original continua no histórico.",
    };
  } catch (erro) {
    return erroBanco(erro);
  }
}
