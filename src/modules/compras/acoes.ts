"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { obterContexto } from "@/core/sessao/contexto";
import { lerDataLocal } from "@/lib/data";
import { ExigeUnidade, SemPermissao } from "@/lib/erros";

import {
  esquemaCotacao,
  esquemaFecharProposta,
  esquemaFornecedor,
  esquemaItemDeCotacao,
  esquemaPreco,
} from "./schemas/entradas";
import {
  adicionarItem,
  adicionarProposta,
  cancelarCotacao,
  criarCotacao,
  fecharCotacao,
  lancarProposta,
  recusarProposta,
  removerItem,
  removerProposta,
  type PrecoRecebido,
} from "./services/cotacoes";
import { alternarFornecedor, salvarFornecedor } from "./services/fornecedores";
import { definirPrevisao, moverPedido } from "./services/pedidos";

export type EstadoCompras = {
  erro?: string;
  erros?: Record<string, string>;
  ok?: string;
};

function coletarErros(issues: { path: PropertyKey[]; message: string }[]) {
  const erros: Record<string, string> = {};
  for (const p of issues) {
    const campo = String(p.path[0] ?? "");
    if (campo && !erros[campo]) erros[campo] = p.message;
  }
  return erros;
}

function comoErro(erro: unknown): EstadoCompras {
  if (erro instanceof SemPermissao || erro instanceof ExigeUnidade) {
    return { erro: erro.message };
  }
  if (erro instanceof Error && erro.message.includes("Unique constraint")) {
    return { erro: "Esse registro já existe." };
  }
  if (erro instanceof Error) return { erro: erro.message };
  throw erro;
}

// --------------------------------------------------------------- FORNECEDORES

export async function salvarFornecedorAcao(
  _anterior: EstadoCompras,
  dados: FormData,
): Promise<EstadoCompras> {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const analise = esquemaFornecedor.safeParse({
    nome: dados.get("nome") ?? "",
    documento: dados.get("documento") ?? "",
    telefone: dados.get("telefone") ?? "",
    email: dados.get("email") ?? "",
    contato: dados.get("contato") ?? "",
    prazoEntregaDias: dados.get("prazoEntregaDias") ?? "",
    condicaoPagamento: dados.get("condicaoPagamento") ?? "",
    observacao: dados.get("observacao") ?? "",
  });
  if (!analise.success) return { erros: coletarErros(analise.error.issues) };

  const id = String(dados.get("id") ?? "");

  try {
    await salvarFornecedor(contexto, id || null, analise.data);
  } catch (erro) {
    if (erro instanceof Error && erro.message.includes("Unique constraint")) {
      return { erros: { nome: "Já existe um fornecedor com esse nome." } };
    }
    return comoErro(erro);
  }

  revalidatePath("/compras/fornecedores");
  redirect("/compras/fornecedores");
}

export async function alternarFornecedorAcao(dados: FormData) {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const id = String(dados.get("id") ?? "");
  if (!id) return;

  await alternarFornecedor(contexto, id);
  revalidatePath("/compras/fornecedores");
}

// ------------------------------------------------------------------ COTAÇÕES

export async function criarCotacaoAcao(
  _anterior: EstadoCompras,
  dados: FormData,
): Promise<EstadoCompras> {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const analise = esquemaCotacao.safeParse({
    descricao: dados.get("descricao") ?? "",
    validaAte: dados.get("validaAte") ?? "",
    observacao: dados.get("observacao") ?? "",
  });
  if (!analise.success) return { erros: coletarErros(analise.error.issues) };

  let id: string;
  try {
    const cotacao = await criarCotacao(contexto, analise.data);
    id = cotacao.id;
  } catch (erro) {
    return comoErro(erro);
  }

  revalidatePath("/compras/cotacoes");
  redirect(`/compras/cotacoes/${id}`);
}

export async function adicionarItemAcao(
  _anterior: EstadoCompras,
  dados: FormData,
): Promise<EstadoCompras> {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const cotacaoId = String(dados.get("cotacaoId") ?? "");
  if (!cotacaoId) return { erro: "Cotação não informada." };

  const analise = esquemaItemDeCotacao.safeParse({
    insumoId: dados.get("insumoId") ?? "",
    quantidade: dados.get("quantidade") ?? "",
    observacao: dados.get("observacao") ?? "",
  });
  if (!analise.success) return { erros: coletarErros(analise.error.issues) };

  try {
    await adicionarItem(contexto, cotacaoId, analise.data);
  } catch (erro) {
    if (erro instanceof Error && erro.message.includes("Unique constraint")) {
      return { erros: { insumoId: "Este insumo já está na cotação." } };
    }
    return comoErro(erro);
  }

  revalidatePath(`/compras/cotacoes/${cotacaoId}`);
  return { ok: "Item adicionado." };
}

export async function removerItemAcao(dados: FormData) {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const cotacaoId = String(dados.get("cotacaoId") ?? "");
  const itemId = String(dados.get("itemId") ?? "");
  if (!cotacaoId || !itemId) return;

  await removerItem(contexto, cotacaoId, itemId);
  revalidatePath(`/compras/cotacoes/${cotacaoId}`);
}

export async function adicionarPropostaAcao(dados: FormData) {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const cotacaoId = String(dados.get("cotacaoId") ?? "");
  const fornecedorId = String(dados.get("fornecedorId") ?? "");
  if (!cotacaoId || !fornecedorId) return;

  await adicionarProposta(contexto, cotacaoId, fornecedorId);
  revalidatePath(`/compras/cotacoes/${cotacaoId}`);
}

export async function removerPropostaAcao(dados: FormData) {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const cotacaoId = String(dados.get("cotacaoId") ?? "");
  const propostaId = String(dados.get("propostaId") ?? "");
  if (!cotacaoId || !propostaId) return;

  await removerProposta(contexto, cotacaoId, propostaId);
  revalidatePath(`/compras/cotacoes/${cotacaoId}`);
}

export async function recusarPropostaAcao(dados: FormData) {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const cotacaoId = String(dados.get("cotacaoId") ?? "");
  const propostaId = String(dados.get("propostaId") ?? "");
  if (!cotacaoId || !propostaId) return;

  await recusarProposta(contexto, cotacaoId, propostaId);
  revalidatePath(`/compras/cotacoes/${cotacaoId}`);
}

/**
 * Lê a resposta inteira do fornecedor de uma vez.
 *
 * Os campos vêm com o id do item no nome (`preco:<id>`), como na folha de
 * contagem e na de checklist. Uma gravação só, quando a pessoa mandar — porque
 * digitar vinte preços do WhatsApp é uma sessão contínua, e salvar linha a
 * linha só criaria vinte oportunidades de falhar.
 */
export async function lancarPropostaAcao(
  _anterior: EstadoCompras,
  dados: FormData,
): Promise<EstadoCompras> {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const cotacaoId = String(dados.get("cotacaoId") ?? "");
  const propostaId = String(dados.get("propostaId") ?? "");
  if (!cotacaoId || !propostaId) return { erro: "Proposta não informada." };

  const cabecalho = esquemaFecharProposta.safeParse({
    frete: dados.get("frete") || "0",
    pedidoMinimo: dados.get("pedidoMinimo") || "0",
    observacao: dados.get("observacao") ?? "",
  });
  if (!cabecalho.success) {
    return { erros: coletarErros(cabecalho.error.issues) };
  }

  const precos: PrecoRecebido[] = [];
  const erros: Record<string, string> = {};

  for (const itemId of dados.getAll("itemId").map(String)) {
    const naoAtende = dados.get(`na:${itemId}`) === "on";
    const bruto = String(dados.get(`preco:${itemId}`) ?? "").trim();

    // Linha em branco é "ainda não perguntei", não "de graça". Só entra o que
    // tem preço ou foi marcado como não atendido.
    if (!naoAtende && bruto === "") continue;

    const analise = esquemaPreco.safeParse({
      itemId,
      embalagem: dados.get(`emb:${itemId}`) ?? "",
      fatorConversao: dados.get(`fator:${itemId}`) || "1",
      precoEmbalagem: bruto || "0",
      naoAtende,
    });

    if (!analise.success) {
      erros[itemId] = analise.error.issues[0]?.message ?? "Valor inválido.";
      continue;
    }
    precos.push(analise.data);
  }

  if (Object.keys(erros).length > 0) {
    return { erro: "Há preços que o sistema não entendeu.", erros };
  }

  try {
    const gravados = await lancarProposta(
      contexto,
      cotacaoId,
      propostaId,
      cabecalho.data,
      precos,
    );
    revalidatePath(`/compras/cotacoes/${cotacaoId}`);
    return {
      ok: `${gravados} ${gravados === 1 ? "preço" : "preços"} gravados.`,
    };
  } catch (erro) {
    return comoErro(erro);
  }
}

export async function fecharCotacaoAcao(
  _anterior: EstadoCompras,
  dados: FormData,
): Promise<EstadoCompras> {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const cotacaoId = String(dados.get("cotacaoId") ?? "");
  if (!cotacaoId) return { erro: "Cotação não informada." };

  const escolhas = new Map<string, string>();
  for (const itemId of dados.getAll("itemId").map(String)) {
    const fornecedorId = String(dados.get(`escolha:${itemId}`) ?? "");
    if (fornecedorId) escolhas.set(itemId, fornecedorId);
  }

  try {
    await fecharCotacao(contexto, cotacaoId, escolhas);
  } catch (erro) {
    return comoErro(erro);
  }

  revalidatePath("/compras");
  revalidatePath(`/compras/cotacoes/${cotacaoId}`);
  redirect("/compras");
}

export async function cancelarCotacaoAcao(dados: FormData) {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const id = String(dados.get("cotacaoId") ?? "");
  if (!id) return;

  await cancelarCotacao(contexto, id);
  revalidatePath("/compras/cotacoes");
  redirect("/compras/cotacoes");
}

// ------------------------------------------------------------------- PEDIDOS

export async function moverPedidoAcao(dados: FormData) {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const id = String(dados.get("pedidoId") ?? "");
  const destino = String(dados.get("destino") ?? "");
  if (!id) return;
  if (
    destino !== "ENVIADO" &&
    destino !== "RECEBIDO" &&
    destino !== "CANCELADO"
  ) {
    return;
  }

  await moverPedido(contexto, id, destino);
  revalidatePath("/compras");
  revalidatePath(`/compras/${id}`);
}

export async function definirPrevisaoAcao(dados: FormData) {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const id = String(dados.get("pedidoId") ?? "");
  if (!id) return;

  const bruto = String(dados.get("previsaoEntrega") ?? "");
  await definirPrevisao(contexto, id, bruto ? lerDataLocal(bruto) : null);
  revalidatePath(`/compras/${id}`);
}
