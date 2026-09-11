"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  obterContexto,
  pode,
  type ContextoSessao,
} from "@/core/sessao/contexto";
import { ExigeUnidade, SemPermissao } from "@/lib/erros";
import type { Unidade } from "@/lib/unidades";

import { NumeroInvalido } from "./schemas/aritmetica";
import { esquemaFornecedor } from "./schemas/entradas";
import { salvarAgenda } from "./services/agenda";
import { salvarAlcada } from "./services/alcadas";
import {
  criarAdendo,
  criarAlteracao,
  registrarConcordancia,
} from "./services/alteracoes";
import { registrar } from "./services/auditoria";
import {
  aplicarSugestao,
  colocarEmDisputa,
  escolher,
} from "./services/comparacao";
import { resolverDivergencia } from "./services/divergencias";
import {
  atualizarDestino,
  corpoParaEnvio,
  definirDestinoDeTeste,
  enviarTeste,
  marcarEnviadaAMao,
  pausarCanal,
  reprocessar,
  resolverIncerta,
} from "./services/fila";
import { alternarFornecedor, salvarFornecedor } from "./services/fornecedores";
import {
  AcimaDaAlcada,
  PedidoMudou,
  ajustarItemPendente,
  aprovarPedido,
  cancelarPedidoPendente,
  gerarPedidos,
  recusarPedido,
  registrarConfirmacao,
} from "./services/pedidos";
import {
  configurarDestino,
  removerProdutoDoFornecedor,
  salvarProdutoDoFornecedor,
} from "./services/produtos-do-fornecedor";
import { registrarPeloComprador } from "./services/propostas";
import { encerrarSaldo } from "./services/recebimentos";
import {
  devolverRequisicao,
  enviarRequisicao,
  removerItem,
  salvarItem,
} from "./services/requisicoes";
import { criarRodada, moverRodada, RodadaMudou } from "./services/rodadas";
import {
  convidar,
  incluirFornecedor,
  linkParaCopiar,
  marcarRecusa,
  reemitirLink,
  revogarLink,
} from "./services/solicitacoes";
import { db } from "@/server/db";

/**
 * AS AÇÕES DE COMPRAS — a ponte entre as telas e os serviços.
 *
 * Cada ação: confere a sessão, lê o formulário, chama o serviço, e devolve UMA
 * frase — o erro que a pessoa consegue corrigir, ou o que foi feito. A regra
 * mora no serviço; aqui não se decide nada. Mensagem técnica do banco vai
 * para o log do servidor, nunca para a tela (ela revela a estrutura do
 * sistema e não ajuda quem está comprando).
 */

export type EstadoCompras = {
  erro?: string;
  erros?: Record<string, string>;
  ok?: string;
};

async function contexto(): Promise<ContextoSessao> {
  const ctx = await obterContexto();
  if (!ctx) redirect("/login");
  return ctx;
}

function falha(erro: unknown, onde: string): EstadoCompras {
  if (
    erro instanceof SemPermissao ||
    erro instanceof ExigeUnidade ||
    erro instanceof NumeroInvalido ||
    erro instanceof RodadaMudou ||
    erro instanceof PedidoMudou ||
    erro instanceof AcimaDaAlcada
  ) {
    return { erro: erro.message };
  }
  if (erro instanceof Error && !erro.name.startsWith("PrismaClient")) {
    return { erro: erro.message };
  }
  console.error(`compras/${onde}:`, erro);
  return {
    erro: "O sistema não conseguiu gravar agora. Nada ficou pela metade — tente de novo.",
  };
}

const texto = (d: FormData, nome: string) => String(d.get(nome) ?? "").trim();
const textoOuNulo = (d: FormData, nome: string) => texto(d, nome) || null;

/**
 * "2026-09-11T10:00" do campo, no horário de Brasília. O Brasil não tem
 * horário de verão desde 2019, então o deslocamento é fixo.
 */
function momento(valor: string): Date | null {
  if (!valor) return null;
  const d = new Date(
    valor.length === 10 ? `${valor}T12:00:00-03:00` : `${valor}:00-03:00`,
  );
  return Number.isNaN(d.getTime()) ? null : d;
}

function lerJson<T>(bruto: string): T | null {
  try {
    return JSON.parse(bruto) as T;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------ FORNECEDORES

function coletarErros(issues: { path: PropertyKey[]; message: string }[]) {
  const erros: Record<string, string> = {};
  for (const p of issues) {
    const campo = String(p.path[0] ?? "");
    if (campo && !erros[campo]) erros[campo] = p.message;
  }
  return erros;
}

export async function salvarFornecedorAcao(
  _anterior: EstadoCompras,
  dados: FormData,
): Promise<EstadoCompras> {
  const ctx = await contexto();
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

  const id = texto(dados, "id");
  let salvoId: string;
  try {
    salvoId = (await salvarFornecedor(ctx, id || null, analise.data)).id;
  } catch (erro) {
    if (erro instanceof Error && erro.message.includes("Unique constraint")) {
      return { erros: { nome: "Já existe um fornecedor com esse nome." } };
    }
    return falha(erro, "salvarFornecedor");
  }
  revalidatePath("/compras/fornecedores");
  redirect(`/compras/fornecedores/${salvoId}`);
}

export async function alternarFornecedorAcao(dados: FormData) {
  const ctx = await contexto();
  const id = texto(dados, "id");
  if (!id) return;
  await alternarFornecedor(ctx, id);
  revalidatePath("/compras/fornecedores");
}

export async function configurarDestinoAcao(
  _a: EstadoCompras,
  dados: FormData,
): Promise<EstadoCompras> {
  const ctx = await contexto();
  const id = texto(dados, "fornecedorId");
  try {
    await configurarDestino(ctx, id, {
      telefonePedidos: texto(dados, "telefonePedidos"),
      autorizado: dados.get("autorizado") === "on",
    });
  } catch (erro) {
    return falha(erro, "configurarDestino");
  }
  revalidatePath(`/compras/fornecedores/${id}`);
  return { ok: "Destino das mensagens salvo." };
}

export async function salvarProdutoAcao(
  _a: EstadoCompras,
  dados: FormData,
): Promise<EstadoCompras> {
  const ctx = await contexto();
  const fornecedorId = texto(dados, "fornecedorId");
  try {
    const r = await salvarProdutoDoFornecedor(ctx, {
      id: textoOuNulo(dados, "id") ?? undefined,
      fornecedorId,
      insumoId: texto(dados, "insumoId"),
      nomeEmbalagem: texto(dados, "nomeEmbalagem"),
      pecas: texto(dados, "pecas"),
      conteudo: texto(dados, "conteudo"),
      unidadeConteudo:
        (textoOuNulo(dados, "unidadeConteudo") as Unidade | null) ?? null,
      fracionavel: dados.get("fracionavel") === "on",
      fixo: dados.get("fixo") === "on",
      precoReferencia: texto(dados, "precoReferencia"),
      precoReferenciaOrigem: textoOuNulo(dados, "precoReferenciaOrigem"),
    });
    revalidatePath(`/compras/fornecedores/${fornecedorId}`);
    return {
      ok: r.avisoDoFator
        ? `Salvo — mas atenção: ${r.avisoDoFator}`
        : "Produto do fornecedor salvo.",
    };
  } catch (erro) {
    return falha(erro, "salvarProduto");
  }
}

export async function removerProdutoAcao(
  _a: EstadoCompras,
  dados: FormData,
): Promise<EstadoCompras> {
  const ctx = await contexto();
  try {
    await removerProdutoDoFornecedor(ctx, texto(dados, "id"));
  } catch (erro) {
    return falha(erro, "removerProduto");
  }
  revalidatePath(`/compras/fornecedores/${texto(dados, "fornecedorId")}`);
  return { ok: "Produto removido." };
}

// ------------------------------------------------------------------ RODADAS

export async function criarRodadaAcao(
  _a: EstadoCompras,
  dados: FormData,
): Promise<EstadoCompras> {
  const ctx = await contexto();
  const descricao = texto(dados, "descricao");
  if (descricao.length < 2)
    return { erros: { descricao: "Dê um nome à rodada." } };

  let id: string;
  try {
    id = (
      await criarRodada(ctx, {
        descricao: descricao.slice(0, 120),
        unidadeIds: dados.getAll("unidadeIds").map(String),
        prazoRequisicao: momento(texto(dados, "prazoRequisicao")),
        prazoCotacao: momento(texto(dados, "prazoCotacao")),
        entregaDe: momento(texto(dados, "entregaDe")),
        entregaAte: momento(texto(dados, "entregaAte")),
        responsavelId: null,
        observacao: textoOuNulo(dados, "observacao"),
      })
    ).id;
  } catch (erro) {
    return falha(erro, "criarRodada");
  }
  revalidatePath("/compras");
  redirect(`/compras/rodadas/${id}`);
}

export async function moverRodadaAcao(
  _a: EstadoCompras,
  dados: FormData,
): Promise<EstadoCompras> {
  const ctx = await contexto();
  const id = texto(dados, "id");
  const para = texto(dados, "para") as Parameters<
    typeof moverRodada
  >[2]["para"];
  try {
    await moverRodada(ctx, id, {
      versao: Number(texto(dados, "versao")),
      para,
      motivo: textoOuNulo(dados, "motivo"),
    });
  } catch (erro) {
    return falha(erro, "moverRodada");
  }
  revalidatePath(`/compras/rodadas/${id}`);
  revalidatePath("/compras");
  return { ok: "Feito." };
}

export async function salvarAgendaAcao(
  _a: EstadoCompras,
  dados: FormData,
): Promise<EstadoCompras> {
  const ctx = await contexto();
  try {
    await salvarAgenda(ctx, {
      id: textoOuNulo(dados, "id") ?? undefined,
      nome: texto(dados, "nome"),
      diaDaSemana: Number(texto(dados, "diaDaSemana")),
      horaAbertura: texto(dados, "horaAbertura"),
      horasParaRequisicao: Number(texto(dados, "horasParaRequisicao")),
      horasParaCotacao: Number(texto(dados, "horasParaCotacao")),
      entregaDeDias: Number(texto(dados, "entregaDeDias")),
      entregaAteDias: Number(texto(dados, "entregaAteDias")),
      unidadeIds: dados.getAll("unidadeIds").map(String),
      ativa: dados.get("ativa") === "on",
    });
  } catch (erro) {
    return falha(erro, "salvarAgenda");
  }
  revalidatePath("/compras/configuracoes");
  return { ok: "Agenda salva. A próxima rodada abre sozinha no horário." };
}

// --------------------------------------------------------------- REQUISIÇÃO

type LinhaDaRequisicao = {
  insumoId: string;
  quantidade: string;
  observacao: string;
};

export async function salvarRequisicaoAcao(
  _a: EstadoCompras,
  dados: FormData,
): Promise<EstadoCompras> {
  const ctx = await contexto();
  const requisicaoId = texto(dados, "requisicaoId");
  const linhas = lerJson<LinhaDaRequisicao[]>(texto(dados, "linhas"));
  const remover = lerJson<string[]>(texto(dados, "remover")) ?? [];
  if (!linhas)
    return { erro: "Não deu para ler a lista. Recarregue a página." };

  const erros: Record<string, string> = {};
  let gravados = 0;
  for (const l of linhas) {
    try {
      await salvarItem(ctx, requisicaoId, {
        insumoId: l.insumoId,
        quantidade: l.quantidade,
        embalagemPreferida: null,
        observacao: l.observacao || null,
      });
      gravados++;
    } catch (erro) {
      erros[l.insumoId] = falha(erro, "salvarItem").erro!;
      // Requisição enviada ou rodada consolidada: não adianta seguir linha a linha.
      if (
        erro instanceof Error &&
        /já foi enviada|já terminou/.test(erro.message)
      )
        break;
    }
  }
  for (const itemId of remover) {
    try {
      await removerItem(ctx, requisicaoId, itemId);
    } catch (erro) {
      return falha(erro, "removerItem");
    }
  }
  revalidatePath("/compras/requisicao");
  if (Object.keys(erros).length > 0) {
    return {
      erro: "Algumas linhas não foram gravadas — veja ao lado de cada uma.",
      erros,
    };
  }
  return {
    ok: `${gravados} ${gravados === 1 ? "linha salva" : "linhas salvas"}. Envie quando terminar.`,
  };
}

export async function enviarRequisicaoAcao(
  _a: EstadoCompras,
  dados: FormData,
): Promise<EstadoCompras> {
  const ctx = await contexto();
  try {
    await enviarRequisicao(
      ctx,
      texto(dados, "requisicaoId"),
      Number(texto(dados, "versao")),
    );
  } catch (erro) {
    return falha(erro, "enviarRequisicao");
  }
  revalidatePath("/compras/requisicao");
  return { ok: "Requisição enviada. O comprador já vê a lista da loja." };
}

export async function devolverRequisicaoAcao(
  _a: EstadoCompras,
  dados: FormData,
): Promise<EstadoCompras> {
  const ctx = await contexto();
  try {
    await devolverRequisicao(
      ctx,
      texto(dados, "requisicaoId"),
      texto(dados, "motivo"),
    );
  } catch (erro) {
    return falha(erro, "devolverRequisicao");
  }
  revalidatePath(`/compras/rodadas/${texto(dados, "rodadaId")}`);
  return { ok: "Devolvida para a loja corrigir." };
}

// ------------------------------------------------------------------ COTAÇÃO

export async function convidarAcao(
  _a: EstadoCompras,
  dados: FormData,
): Promise<EstadoCompras> {
  const ctx = await contexto();
  const reemitir = texto(dados, "reemitir") === "1";
  try {
    const r = reemitir
      ? await reemitirLink(ctx, texto(dados, "solicitacaoId"))
      : await convidar(ctx, texto(dados, "solicitacaoId"));
    revalidatePath(`/compras/rodadas/${texto(dados, "rodadaId")}`);
    if (r.estado === "BLOQUEADA") {
      return {
        erro: `Link criado, mas a mensagem ficou bloqueada: ${r.motivoBloqueio} Copie o link e mande pelo seu WhatsApp.`,
      };
    }
    return {
      ok: reemitir
        ? "Link novo criado; o anterior deixou de valer."
        : "Convite na fila.",
    };
  } catch (erro) {
    return falha(erro, "convidar");
  }
}

export async function revogarLinkAcao(
  _a: EstadoCompras,
  dados: FormData,
): Promise<EstadoCompras> {
  const ctx = await contexto();
  try {
    await revogarLink(
      ctx,
      texto(dados, "solicitacaoId"),
      texto(dados, "motivo"),
    );
  } catch (erro) {
    return falha(erro, "revogarLink");
  }
  revalidatePath(`/compras/rodadas/${texto(dados, "rodadaId")}`);
  return { ok: "Link desativado." };
}

export async function marcarRecusaAcao(
  _a: EstadoCompras,
  dados: FormData,
): Promise<EstadoCompras> {
  const ctx = await contexto();
  try {
    await marcarRecusa(
      ctx,
      texto(dados, "solicitacaoId"),
      texto(dados, "motivo"),
    );
  } catch (erro) {
    return falha(erro, "marcarRecusa");
  }
  revalidatePath(`/compras/rodadas/${texto(dados, "rodadaId")}`);
  return { ok: "Registrado." };
}

/** O link, só no clique. A cópia fica registrada na auditoria. */
export async function buscarLinkAcao(
  solicitacaoId: string,
): Promise<{ texto?: string; erro?: string }> {
  const ctx = await contexto();
  try {
    return { texto: await linkParaCopiar(ctx, solicitacaoId) };
  } catch (erro) {
    return { erro: falha(erro, "buscarLink").erro };
  }
}

/** O texto da mensagem como vai sair — com o link, se for convite. */
export async function buscarMensagemAcao(
  mensagemId: string,
): Promise<{ texto?: string; erro?: string }> {
  const ctx = await contexto();
  const m = await db.mensagemAoFornecedor.findFirst({
    where: {
      id: mensagemId,
      organizacaoId: ctx.organizacao.id,
      OR: [
        { unidadeId: null },
        { unidadeId: { in: ctx.unidadesVisiveis.map((u) => u.id) } },
      ],
    },
    select: { id: true, tipo: true, unidadeId: true },
  });
  if (!m) return { erro: "Mensagem não encontrada." };
  const podeCopiar =
    m.tipo === "CONVITE_COTACAO"
      ? pode(ctx, "compras.cotar")
      : pode(ctx, "compras.enviar") || pode(ctx, "compras.pedir");
  if (!podeCopiar) return { erro: "Seu perfil não pode copiar esta mensagem." };
  try {
    const conteudo = await corpoParaEnvio(m.id);
    await registrar(db, ctx, {
      entidade: "MensagemAoFornecedor",
      entidadeId: m.id,
      acao: "ACESSOU",
      unidadeId: m.unidadeId,
      depois: { mensagemCopiada: true },
    });
    return { texto: conteudo };
  } catch (erro) {
    return { erro: falha(erro, "buscarMensagem").erro };
  }
}

export async function lancarPropostaAcao(
  _a: EstadoCompras,
  dados: FormData,
): Promise<EstadoCompras> {
  const ctx = await contexto();
  const bruto = lerJson<unknown>(texto(dados, "resposta"));
  if (!bruto)
    return { erro: "Não deu para ler a proposta. Recarregue a página." };
  try {
    const r = await registrarPeloComprador(
      ctx,
      texto(dados, "solicitacaoId"),
      bruto,
      {
        origem:
          texto(dados, "origem") === "NEGOCIACAO"
            ? "NEGOCIACAO"
            : "COMPRADOR_DIGITOU",
        motivo: textoOuNulo(dados, "motivo"),
        autorizarZero: dados.get("autorizarZero") === "on",
      },
    );
    if (!r.ok)
      return {
        erro: r.erros.geral ?? "Há campos para corrigir.",
        erros: r.erros,
      };
    // "layout": a rodada E a tela de lançar resposta, que mora embaixo dela.
    revalidatePath(`/compras/rodadas/${texto(dados, "rodadaId")}`, "layout");
    revalidatePath("/compras/comparacao");
    return { ok: `Proposta gravada como versão ${r.versao}.` };
  } catch (erro) {
    return falha(erro, "lancarProposta");
  }
}

export async function incluirFornecedorAcao(
  _a: EstadoCompras,
  dados: FormData,
): Promise<EstadoCompras> {
  const ctx = await contexto();
  const rodadaId = texto(dados, "rodadaId");
  try {
    await incluirFornecedor(
      ctx,
      rodadaId,
      texto(dados, "fornecedorId"),
      dados.getAll("itemIds").map(String),
    );
  } catch (erro) {
    return falha(erro, "incluirFornecedor");
  }
  revalidatePath(`/compras/rodadas/${rodadaId}`);
  return { ok: "Fornecedor incluído. Agora convide." };
}

// ---------------------------------------------------------------- ESCOLHA

export async function escolherAcao(
  _a: EstadoCompras,
  dados: FormData,
): Promise<EstadoCompras> {
  const ctx = await contexto();
  const rodadaId = texto(dados, "rodadaId");
  try {
    await escolher(ctx, rodadaId, {
      itemDaRodadaId: texto(dados, "itemDaRodadaId"),
      fornecedorId: texto(dados, "fornecedorId"),
      // O botão de escolher pede a frase no campo genérico de motivo.
      justificativa:
        textoOuNulo(dados, "justificativa") ?? textoOuNulo(dados, "motivo"),
    });
  } catch (erro) {
    return falha(erro, "escolher");
  }
  revalidatePath("/compras/comparacao");
  return { ok: "Escolha gravada." };
}

export async function aplicarSugestaoAcao(
  _a: EstadoCompras,
  dados: FormData,
): Promise<EstadoCompras> {
  const ctx = await contexto();
  try {
    const n = await aplicarSugestao(ctx, texto(dados, "rodadaId"));
    revalidatePath("/compras/comparacao");
    return {
      ok: `${n} ${n === 1 ? "item escolhido" : "itens escolhidos"} pela sugestão.`,
    };
  } catch (erro) {
    return falha(erro, "aplicarSugestao");
  }
}

export async function colocarEmDisputaAcao(
  _a: EstadoCompras,
  dados: FormData,
): Promise<EstadoCompras> {
  const ctx = await contexto();
  try {
    await colocarEmDisputa(
      ctx,
      texto(dados, "itemDaRodadaId"),
      texto(dados, "motivo"),
    );
  } catch (erro) {
    return falha(erro, "colocarEmDisputa");
  }
  revalidatePath(`/compras/rodadas/${texto(dados, "rodadaId")}`);
  return { ok: "Item colocado em disputa. Convide os fornecedores dele." };
}

export async function gerarPedidosAcao(
  _a: EstadoCompras,
  dados: FormData,
): Promise<EstadoCompras> {
  const ctx = await contexto();
  const rodadaId = texto(dados, "rodadaId");
  try {
    await gerarPedidos(ctx, rodadaId, {
      ignorar: dados.getAll("ignorar").map(String),
    });
  } catch (erro) {
    return falha(erro, "gerarPedidos");
  }
  revalidatePath("/compras/aprovacao");
  redirect(`/compras/aprovacao?rodada=${rodadaId}`);
}

// ---------------------------------------------------------------- PEDIDOS

export async function aprovarPedidoAcao(
  _a: EstadoCompras,
  dados: FormData,
): Promise<EstadoCompras> {
  const ctx = await contexto();
  const id = texto(dados, "pedidoId");
  try {
    const r = await aprovarPedido(ctx, id, Number(texto(dados, "versao")));
    revalidatePath("/compras/aprovacao");
    revalidatePath(`/compras/pedidos/${id}`);
    if (r.estadoDaMensagem === "BLOQUEADA") {
      return {
        ok: `Aprovado. A mensagem ao fornecedor ficou bloqueada: ${r.motivoBloqueio}`,
      };
    }
    return { ok: "Aprovado. A mensagem ao fornecedor está na fila." };
  } catch (erro) {
    return falha(erro, "aprovarPedido");
  }
}

export async function recusarPedidoAcao(
  _a: EstadoCompras,
  dados: FormData,
): Promise<EstadoCompras> {
  const ctx = await contexto();
  const id = texto(dados, "pedidoId");
  try {
    await recusarPedido(
      ctx,
      id,
      Number(texto(dados, "versao")),
      texto(dados, "motivo"),
    );
  } catch (erro) {
    return falha(erro, "recusarPedido");
  }
  revalidatePath("/compras/aprovacao");
  return { ok: "Recusado. O comprador vê o motivo." };
}

export async function ajustarItemAcao(
  _a: EstadoCompras,
  dados: FormData,
): Promise<EstadoCompras> {
  const ctx = await contexto();
  const id = texto(dados, "pedidoId");
  try {
    await ajustarItemPendente(
      ctx,
      id,
      texto(dados, "itemId"),
      texto(dados, "embalagens"),
    );
  } catch (erro) {
    return falha(erro, "ajustarItem");
  }
  revalidatePath(`/compras/pedidos/${id}`);
  revalidatePath("/compras/aprovacao");
  return { ok: "Ajustado. Quem for aprovar vê a versão nova." };
}

export async function cancelarPedidoAcao(
  _a: EstadoCompras,
  dados: FormData,
): Promise<EstadoCompras> {
  const ctx = await contexto();
  const id = texto(dados, "pedidoId");
  try {
    await cancelarPedidoPendente(ctx, id, texto(dados, "motivo"));
  } catch (erro) {
    return falha(erro, "cancelarPedido");
  }
  revalidatePath(`/compras/pedidos/${id}`);
  return { ok: "Pedido cancelado." };
}

export async function registrarConfirmacaoAcao(
  _a: EstadoCompras,
  dados: FormData,
): Promise<EstadoCompras> {
  const ctx = await contexto();
  const id = texto(dados, "pedidoId");
  const confirmacao = texto(dados, "confirmacao") as
    "CONFIRMADO" | "CONFIRMADO_COM_RESSALVA" | "RECUSADO";
  try {
    await registrarConfirmacao(ctx, id, {
      confirmacao,
      texto: texto(dados, "texto"),
    });
  } catch (erro) {
    return falha(erro, "registrarConfirmacao");
  }
  revalidatePath(`/compras/pedidos/${id}`);
  return { ok: "Resposta do fornecedor registrada." };
}

export async function criarAdendoAcao(
  _a: EstadoCompras,
  dados: FormData,
): Promise<EstadoCompras> {
  const ctx = await contexto();
  const id = texto(dados, "pedidoId");
  let adendoId: string;
  try {
    adendoId = await criarAdendo(
      ctx,
      id,
      [
        {
          insumoId: texto(dados, "insumoId"),
          necessario: texto(dados, "necessario"),
        },
      ],
      texto(dados, "motivo"),
    );
  } catch (erro) {
    return falha(erro, "criarAdendo");
  }
  revalidatePath(`/compras/pedidos/${id}`);
  redirect(`/compras/pedidos/${adendoId}`);
}

export async function criarAlteracaoAcao(
  _a: EstadoCompras,
  dados: FormData,
): Promise<EstadoCompras> {
  const ctx = await contexto();
  const id = texto(dados, "pedidoId");
  const tipo =
    texto(dados, "tipo") === "CANCELAMENTO" ? "CANCELAMENTO" : "ALTERACAO";
  const linhas = dados
    .getAll("itemDePedidoId")
    .map(String)
    .map((itemDePedidoId) => ({
      itemDePedidoId,
      embalagensDepois: texto(dados, `depois:${itemDePedidoId}`),
    }))
    .filter((l) => l.embalagensDepois !== "");
  try {
    await criarAlteracao(ctx, id, {
      tipo,
      linhas,
      motivo: texto(dados, "motivo"),
    });
  } catch (erro) {
    return falha(erro, "criarAlteracao");
  }
  revalidatePath(`/compras/pedidos/${id}`);
  return {
    ok:
      tipo === "CANCELAMENTO"
        ? "Cancelamento na fila para o fornecedor."
        : "Alteração na fila para o fornecedor. Registre a resposta dele quando vier.",
  };
}

export async function registrarConcordanciaAcao(
  _a: EstadoCompras,
  dados: FormData,
): Promise<EstadoCompras> {
  const ctx = await contexto();
  try {
    await registrarConcordancia(
      ctx,
      texto(dados, "alteracaoId"),
      texto(dados, "resposta") === "RECUSADA" ? "RECUSADA" : "ACEITA",
      texto(dados, "texto"),
    );
  } catch (erro) {
    return falha(erro, "registrarConcordancia");
  }
  revalidatePath(`/compras/pedidos/${texto(dados, "pedidoId")}`);
  return { ok: "Resposta registrada." };
}

// ------------------------------------------------------------------ ENVIO

async function naMensagem(
  dados: FormData,
  onde: string,
  gesto: (ctx: ContextoSessao, id: string) => Promise<void>,
  ok: string,
): Promise<EstadoCompras> {
  const ctx = await contexto();
  try {
    await gesto(ctx, texto(dados, "mensagemId"));
  } catch (erro) {
    return falha(erro, onde);
  }
  revalidatePath("/compras/pedidos");
  const pedidoId = texto(dados, "pedidoId");
  if (pedidoId) revalidatePath(`/compras/pedidos/${pedidoId}`);
  return { ok };
}

export async function marcarEnviadaAMaoAcao(
  _a: EstadoCompras,
  dados: FormData,
) {
  return naMensagem(
    dados,
    "enviadaAMao",
    marcarEnviadaAMao,
    "Registrado como enviado por você.",
  );
}

export async function reprocessarAcao(_a: EstadoCompras, dados: FormData) {
  return naMensagem(dados, "reprocessar", reprocessar, "De volta à fila.");
}

export async function atualizarDestinoAcao(_a: EstadoCompras, dados: FormData) {
  return naMensagem(
    dados,
    "atualizarDestino",
    atualizarDestino,
    "Destino refeito pelo cadastro atual.",
  );
}

export async function resolverIncertaAcao(_a: EstadoCompras, dados: FormData) {
  const decisao = texto(dados, "decisao") === "reenviar" ? "reenviar" : "saiu";
  return naMensagem(
    dados,
    "resolverIncerta",
    (ctx, id) => resolverIncerta(ctx, id, decisao),
    decisao === "saiu"
      ? "Marcada como enviada."
      : "Vai sair de novo na próxima batida.",
  );
}

export async function pausarCanalAcao(
  _a: EstadoCompras,
  dados: FormData,
): Promise<EstadoCompras> {
  const ctx = await contexto();
  const pausar = texto(dados, "pausar") === "1";
  try {
    await pausarCanal(ctx, pausar, textoOuNulo(dados, "motivo"));
  } catch (erro) {
    return falha(erro, "pausarCanal");
  }
  revalidatePath("/compras/pedidos");
  revalidatePath("/compras/configuracoes");
  return {
    ok: pausar ? "Envio pausado. Nada sai até despausar." : "Envio retomado.",
  };
}

export async function enviarTesteAcao(
  _a: EstadoCompras,
  dados: FormData,
): Promise<EstadoCompras> {
  const ctx = await contexto();
  try {
    await enviarTeste(ctx, texto(dados, "texto"));
  } catch (erro) {
    return falha(erro, "enviarTeste");
  }
  revalidatePath("/compras/pedidos");
  return { ok: "Mensagem de teste na fila — só para o número de teste." };
}

export async function definirDestinoDeTesteAcao(
  _a: EstadoCompras,
  dados: FormData,
): Promise<EstadoCompras> {
  const ctx = await contexto();
  try {
    await definirDestinoDeTeste(ctx, texto(dados, "telefone"));
  } catch (erro) {
    return falha(erro, "destinoDeTeste");
  }
  revalidatePath("/compras/configuracoes");
  return { ok: "Número de teste salvo." };
}

export async function salvarAlcadaAcao(
  _a: EstadoCompras,
  dados: FormData,
): Promise<EstadoCompras> {
  const ctx = await contexto();
  const semLimite = dados.get("semLimite") === "on";
  const remover = texto(dados, "remover") === "1";
  try {
    await salvarAlcada(
      ctx,
      texto(dados, "papelId"),
      semLimite ? null : texto(dados, "limite"),
      remover,
    );
  } catch (erro) {
    return falha(erro, "salvarAlcada");
  }
  revalidatePath("/compras/configuracoes");
  return {
    ok: remover ? "Alçada encerrada." : "Alçada salva como versão nova.",
  };
}

// ------------------------------------------------------------ RECEBIMENTO

export async function encerrarSaldoAcao(
  _a: EstadoCompras,
  dados: FormData,
): Promise<EstadoCompras> {
  const ctx = await contexto();
  const id = texto(dados, "pedidoId");
  try {
    await encerrarSaldo(ctx, id, texto(dados, "motivo"));
  } catch (erro) {
    return falha(erro, "encerrarSaldo");
  }
  revalidatePath(`/compras/recebimento/${id}`);
  return { ok: "Saldo encerrado. O que faltou virou divergência." };
}

export async function resolverDivergenciaAcao(
  _a: EstadoCompras,
  dados: FormData,
): Promise<EstadoCompras> {
  const ctx = await contexto();
  try {
    await resolverDivergencia(
      ctx,
      texto(dados, "divergenciaId"),
      texto(dados, "resolucao") || texto(dados, "motivo"),
    );
  } catch (erro) {
    return falha(erro, "resolverDivergencia");
  }
  revalidatePath(`/compras/recebimento/${texto(dados, "pedidoId")}`);
  return { ok: "Divergência resolvida." };
}
