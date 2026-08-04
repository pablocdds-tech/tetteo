"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { obterContexto } from "@/core/sessao/contexto";
import { lerDataLocal } from "@/lib/data";
import { ExigeUnidade, SemPermissao } from "@/lib/erros";

import {
  esquemaItemModelo,
  esquemaLeituraNumero,
  esquemaModelo,
  esquemaNovaResposta,
  esquemaPendencia,
  esquemaResolucao,
  esquemaRotinaChecklist,
} from "./schemas/modelo";
import {
  adicionarItem,
  atualizarModelo,
  alternarModelo,
  criarModelo,
  moverItem,
  removerItem,
} from "./services/modelos";
import {
  atribuirPendencia,
  criarPendencia,
  reabrirPendencia,
  resolverPendencia,
} from "./services/pendencias";
import {
  abrirResposta,
  cancelarResposta,
  executarRotina,
  fecharResposta,
  salvarRespostas,
  type ValorItem,
} from "./services/respostas";
import { criarRotina, desativarRotina } from "./services/rotinas";

export type EstadoChecklist = {
  erro?: string;
  erros?: Record<string, string>;
  salvos?: number;
  ok?: string;
};

function coletarErros(issues: { path: PropertyKey[]; message: string }[]) {
  const erros: Record<string, string> = {};
  for (const problema of issues) {
    const campo = String(problema.path[0] ?? "");
    if (campo && !erros[campo]) erros[campo] = problema.message;
  }
  return erros;
}

/** Traduz a exceção do serviço em mensagem de tela, sem engolir o resto. */
function comoErro(erro: unknown): EstadoChecklist {
  if (erro instanceof SemPermissao || erro instanceof ExigeUnidade) {
    return { erro: erro.message };
  }
  if (erro instanceof Error) return { erro: erro.message };
  throw erro;
}

// ---------------------------------------------------------------------------
// MODELOS
// ---------------------------------------------------------------------------

export async function salvarModeloAcao(
  _anterior: EstadoChecklist,
  dados: FormData,
): Promise<EstadoChecklist> {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const analise = esquemaModelo.safeParse({
    nome: dados.get("nome") ?? "",
    descricao: dados.get("descricao") ?? "",
  });
  if (!analise.success) return { erros: coletarErros(analise.error.issues) };

  const id = String(dados.get("id") ?? "");

  let destino = id;
  try {
    if (id) {
      await atualizarModelo(contexto, id, analise.data);
    } else {
      const modelo = await criarModelo(contexto, analise.data);
      destino = modelo.id;
    }
  } catch (erro) {
    if (erro instanceof Error && erro.message.includes("Unique constraint")) {
      return { erros: { nome: "Já existe um checklist com esse nome." } };
    }
    return comoErro(erro);
  }

  revalidatePath("/checklists/modelos");
  redirect(`/checklists/modelos/${destino}`);
}

export async function alternarModeloAcao(dados: FormData) {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const id = String(dados.get("id") ?? "");
  if (!id) return;

  await alternarModelo(contexto, id);
  revalidatePath("/checklists/modelos");
}

export async function adicionarItemAcao(
  _anterior: EstadoChecklist,
  dados: FormData,
): Promise<EstadoChecklist> {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const modeloId = String(dados.get("modeloId") ?? "");
  if (!modeloId) return { erro: "Checklist não informado." };

  const analise = esquemaItemModelo.safeParse({
    texto: dados.get("texto") ?? "",
    secao: dados.get("secao") ?? "",
    tipo: dados.get("tipo") ?? "SIM_NAO",
    obrigatorio: dados.get("obrigatorio") === "on",
    exigeObservacaoSeNao: dados.get("exigeObservacaoSeNao") === "on",
    exigeFoto: dados.get("exigeFoto") === "on",
    rotuloUnidade: dados.get("rotuloUnidade") ?? "",
    minimo: dados.get("minimo") ?? "",
    maximo: dados.get("maximo") ?? "",
  });
  if (!analise.success) return { erros: coletarErros(analise.error.issues) };

  try {
    await adicionarItem(contexto, modeloId, analise.data);
  } catch (erro) {
    return comoErro(erro);
  }

  revalidatePath(`/checklists/modelos/${modeloId}`);
  return { ok: "Item adicionado." };
}

export async function removerItemAcao(dados: FormData) {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const modeloId = String(dados.get("modeloId") ?? "");
  const itemId = String(dados.get("itemId") ?? "");
  if (!modeloId || !itemId) return;

  await removerItem(contexto, modeloId, itemId);
  revalidatePath(`/checklists/modelos/${modeloId}`);
}

export async function moverItemAcao(dados: FormData) {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const modeloId = String(dados.get("modeloId") ?? "");
  const itemId = String(dados.get("itemId") ?? "");
  const direcao = dados.get("direcao") === "cima" ? "cima" : "baixo";
  if (!modeloId || !itemId) return;

  await moverItem(contexto, modeloId, itemId, direcao);
  revalidatePath(`/checklists/modelos/${modeloId}`);
}

// ---------------------------------------------------------------------------
// ROTINAS
// ---------------------------------------------------------------------------

export async function criarRotinaAcao(
  _anterior: EstadoChecklist,
  dados: FormData,
): Promise<EstadoChecklist> {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const analise = esquemaRotinaChecklist.safeParse({
    modeloId: dados.get("modeloId") ?? "",
    recorrencia: dados.get("recorrencia") ?? "",
    diaDaSemana: dados.get("diaDaSemana") || null,
    diaDoMes: dados.get("diaDoMes") || null,
    horario: dados.get("horario") ?? "",
    responsavelId: dados.get("responsavelId") ?? "",
  });
  if (!analise.success) return { erros: coletarErros(analise.error.issues) };

  try {
    await criarRotina(contexto, analise.data);
  } catch (erro) {
    if (erro instanceof Error && erro.message.includes("Unique constraint")) {
      return {
        erros: {
          modeloId: "Este checklist já está agendado nesta loja.",
        },
      };
    }
    return comoErro(erro);
  }

  revalidatePath("/checklists");
  redirect("/checklists");
}

export async function desativarRotinaAcao(dados: FormData) {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const id = String(dados.get("rotinaId") ?? "");
  if (!id) return;

  await desativarRotina(contexto, id);
  revalidatePath("/checklists");
}

/** "Responder agora": abre (ou retoma) o checklist da rotina e leva à folha. */
export async function executarRotinaAcao(dados: FormData) {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const id = String(dados.get("rotinaId") ?? "");
  if (!id) return;

  const resposta = await executarRotina(contexto, id);
  revalidatePath("/checklists");
  redirect(`/checklists/${resposta.id}`);
}

// ---------------------------------------------------------------------------
// RESPOSTAS
// ---------------------------------------------------------------------------

export async function abrirRespostaAcao(
  _anterior: EstadoChecklist,
  dados: FormData,
): Promise<EstadoChecklist> {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const analise = esquemaNovaResposta.safeParse({
    modeloId: dados.get("modeloId") ?? "",
    referencia: dados.get("referencia") ?? "",
  });
  if (!analise.success) return { erros: coletarErros(analise.error.issues) };

  let id: string;
  try {
    const resposta = await abrirResposta(contexto, analise.data);
    id = resposta.id;
  } catch (erro) {
    return comoErro(erro);
  }

  revalidatePath("/checklists");
  redirect(`/checklists/${id}`);
}

/**
 * Lê a folha inteira do formulário.
 *
 * Os campos vêm com o id do item no nome: `resp:<id>`, `obs:<id>`, e assim por
 * diante. É o mesmo desenho da folha de contagem — um formulário só, uma
 * gravação só, e nada de salvar item a item enquanto a pessoa digita com o
 * celular na mão e a internet da cozinha oscilando.
 */
function lerFolha(dados: FormData) {
  const valores = new Map<string, ValorItem>();
  const erros: Record<string, string> = {};

  const itens = dados.getAll("itemId").map(String);

  for (const itemId of itens) {
    const marcado = String(dados.get(`resp:${itemId}`) ?? "");
    const numeroBruto = String(dados.get(`num:${itemId}`) ?? "");
    const texto = String(dados.get(`txt:${itemId}`) ?? "").trim();
    const observacao = String(dados.get(`obs:${itemId}`) ?? "").trim();

    const leitura = esquemaLeituraNumero.safeParse(numeroBruto);
    if (!leitura.success) {
      erros[itemId] = leitura.error.issues[0]?.message ?? "Número inválido.";
      continue;
    }

    valores.set(itemId, {
      conforme: marcado === "sim" ? true : marcado === "nao" ? false : null,
      naoSeAplica: marcado === "na",
      valorNumero: leitura.data,
      valorTexto: texto || null,
      observacao: observacao || null,
    });
  }

  return { valores, erros };
}

export async function salvarFolhaAcao(
  _anterior: EstadoChecklist,
  dados: FormData,
): Promise<EstadoChecklist> {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const id = String(dados.get("respostaId") ?? "");
  if (!id) return { erro: "Checklist não informado." };

  const { valores, erros } = lerFolha(dados);
  if (Object.keys(erros).length > 0) {
    return { erro: "Há números que o sistema não entendeu.", erros };
  }

  try {
    await salvarRespostas(contexto, id, valores);
  } catch (erro) {
    return comoErro(erro);
  }

  revalidatePath(`/checklists/${id}`);
  return { salvos: valores.size, ok: "Respostas salvas." };
}

/**
 * Fecha o checklist — mas grava o que está na tela ANTES.
 *
 * Sem isso, quem responde a última pergunta e vai direto em "Fechar" perde
 * justamente ela, e o sistema recusa o fechamento por um item que a pessoa
 * acabou de preencher.
 */
export async function fecharFolhaAcao(
  _anterior: EstadoChecklist,
  dados: FormData,
): Promise<EstadoChecklist> {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const id = String(dados.get("respostaId") ?? "");
  if (!id) return { erro: "Checklist não informado." };

  const { valores, erros } = lerFolha(dados);
  if (Object.keys(erros).length > 0) {
    return {
      erro: "Há números que o sistema não entendeu. Corrija antes de fechar.",
      erros,
    };
  }

  try {
    await salvarRespostas(contexto, id, valores);
    await fecharResposta(contexto, id);
  } catch (erro) {
    return comoErro(erro);
  }

  revalidatePath("/checklists");
  revalidatePath("/checklists/pendencias");
  redirect(`/checklists/${id}`);
}

export async function cancelarRespostaAcao(dados: FormData) {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const id = String(dados.get("respostaId") ?? "");
  if (!id) return;

  await cancelarResposta(contexto, id);
  revalidatePath("/checklists");
  redirect("/checklists");
}

// ---------------------------------------------------------------------------
// PENDÊNCIAS
// ---------------------------------------------------------------------------

export async function criarPendenciaAcao(
  _anterior: EstadoChecklist,
  dados: FormData,
): Promise<EstadoChecklist> {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const analise = esquemaPendencia.safeParse({
    descricao: dados.get("descricao") ?? "",
    responsavelId: dados.get("responsavelId") ?? "",
    prazo: dados.get("prazo") ?? "",
  });
  if (!analise.success) return { erros: coletarErros(analise.error.issues) };

  try {
    await criarPendencia(contexto, analise.data);
  } catch (erro) {
    return comoErro(erro);
  }

  revalidatePath("/checklists/pendencias");
  return { ok: "Pendência aberta." };
}

export async function atribuirPendenciaAcao(dados: FormData) {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const id = String(dados.get("pendenciaId") ?? "");
  if (!id) return;

  const responsavelId = String(dados.get("responsavelId") ?? "") || null;
  const prazoBruto = String(dados.get("prazo") ?? "");

  await atribuirPendencia(contexto, id, {
    responsavelId,
    prazo: prazoBruto ? lerDataLocal(prazoBruto) : null,
  });
  revalidatePath("/checklists/pendencias");
}

export async function resolverPendenciaAcao(
  _anterior: EstadoChecklist,
  dados: FormData,
): Promise<EstadoChecklist> {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const id = String(dados.get("pendenciaId") ?? "");
  if (!id) return { erro: "Pendência não informada." };

  const analise = esquemaResolucao.safeParse({
    resolucao: dados.get("resolucao") ?? "",
  });
  if (!analise.success) return { erros: coletarErros(analise.error.issues) };

  try {
    await resolverPendencia(contexto, id, analise.data.resolucao);
  } catch (erro) {
    return comoErro(erro);
  }

  revalidatePath("/checklists/pendencias");
  return { ok: "Pendência resolvida." };
}

export async function reabrirPendenciaAcao(dados: FormData) {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const id = String(dados.get("pendenciaId") ?? "");
  if (!id) return;

  await reabrirPendencia(contexto, id);
  revalidatePath("/checklists/pendencias");
}
