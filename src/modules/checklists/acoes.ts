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
  salvarItem,
  salvarRespostas,
  type ValorItem,
} from "./services/respostas";
import {
  alterarResponsavel,
  criarRotina,
  desativarRotina,
  RotinaJaAgendada,
} from "./services/rotinas";

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
    // A segunda condição é a corrida: duas pessoas agendando o mesmo
    // checklist no mesmo segundo passam as duas pela conferência do serviço,
    // e quem barra a segunda é o índice único do banco.
    if (
      erro instanceof RotinaJaAgendada ||
      (erro instanceof Error && erro.message.includes("Unique constraint"))
    ) {
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

/**
 * Troca de quem se cobra a rotina.
 *
 * Vem de um painel lateral, com `useActionState`: o painel precisa mostrar o
 * erro DENTRO dele e não sumir levando junto a escolha da pessoa. Por isso
 * devolve estado em vez de redirecionar.
 *
 * O campo vazio é uma resposta legítima — "de quem estiver de plantão" — e
 * não um formulário incompleto.
 */
export async function alterarResponsavelAcao(
  _anterior: EstadoChecklist,
  dados: FormData,
): Promise<EstadoChecklist> {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const rotinaId = String(dados.get("rotinaId") ?? "");
  if (!rotinaId) return { erro: "Rotina não informada." };

  const responsavelId = String(dados.get("responsavelId") ?? "") || null;

  let nome: string | null;
  try {
    ({ nome } = await alterarResponsavel(contexto, rotinaId, responsavelId));
  } catch (erro) {
    return comoErro(erro);
  }

  revalidatePath("/checklists");
  // A confirmação diz O QUE mudou, e não só que algo mudou: duas trocas
  // seguidas com o mesmo "Responsável alterado." não deixariam saber se a
  // segunda pegou.
  return {
    ok: nome
      ? `Agora a rotina é cobrada de ${nome}.`
      : "Agora a rotina é de quem estiver de plantão.",
  };
}

export async function desativarRotinaAcao(dados: FormData) {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const id = String(dados.get("rotinaId") ?? "");
  if (!id) return;

  await desativarRotina(contexto, id);
  revalidatePath("/checklists");

  // Volta para a lista SEM a rotina selecionada: ela saiu da fila, e manter o
  // endereço apontando para ela mostraria um aviso de "fora do período" que
  // não explica o que aconteceu.
  const consulta = paramsDaLista(dados);
  redirect(consulta ? `/checklists?${consulta}` : "/checklists");
}

/**
 * "Responder agora": abre (ou retoma) o checklist da rotina.
 *
 * Volta para a MESMA tela, com a rotina selecionada — a folha aparece na
 * coluna da direita e a lista continua à esquerda, no mesmo lugar. Antes isto
 * navegava para uma página separada, e voltar dela custava um clique e a
 * perda do contexto.
 */
export async function executarRotinaAcao(dados: FormData) {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const id = String(dados.get("rotinaId") ?? "");
  if (!id) return;

  await executarRotina(contexto, id);
  revalidatePath("/checklists");
  redirect(`/checklists?${paramsDaLista(dados, id)}`);
}

/**
 * Reconstrói o endereço da lista preservando o que a pessoa escolheu.
 *
 * O período vem num campo escondido do formulário porque um `redirect` do
 * servidor não enxerga a URL de onde o clique partiu. Sem ele, quem estava em
 * "Semana" cairia em "Hoje" ao apertar Responder, e teria que se reencontrar
 * na tela.
 */
function paramsDaLista(dados: FormData, rotinaId?: string) {
  const params = new URLSearchParams();
  const periodo = String(dados.get("periodo") ?? "");
  if (periodo === "semana") params.set("periodo", periodo);
  if (rotinaId) params.set("rotina", rotinaId);
  return params.toString();
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

/**
 * O que a tela recebe de volta ao gravar UM item.
 *
 * `quando` vem como texto já formatado no fuso da operação. Mandar um `Date`
 * cru faria o celular formatar com o fuso DELE — e um checklist marcado às
 * 07:12 em São Paulo apareceria como 10:12 para quem viajou.
 */
export type ResultadoDoItem =
  | { ok: true; quando: string; quem: string | null }
  | { ok: false; erro: string };

const HORA_DA_OPERACAO = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

/**
 * GRAVA UM ITEM, no instante em que ele é marcado.
 *
 * Não chama `revalidatePath` de propósito. Revalidar aqui reconsultaria a
 * página inteira — lista, detalhe, histórico — a CADA toque, e uma consulta
 * que falha com a internet oscilando faz a tela recarregar e apagar o aviso de
 * "não gravado". O único número de fora da folha que muda com um item — o
 * "3 de 11" da lista — é avisado pelo próprio navegador. O fechamento, que
 * muda pendências, painel e histórico, revalida por conta própria.
 */
export async function salvarItemAcao(entrada: {
  respostaId: string;
  itemId: string;
  marcada: "sim" | "nao" | "na" | "";
  numero: string;
  texto: string;
  observacao: string;
}): Promise<ResultadoDoItem> {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  if (!entrada.respostaId || !entrada.itemId) {
    return { ok: false, erro: "Item não informado." };
  }

  const leitura = esquemaLeituraNumero.safeParse(entrada.numero);
  if (!leitura.success) {
    return {
      ok: false,
      erro: leitura.error.issues[0]?.message ?? "Número inválido.",
    };
  }

  try {
    const salvo = await salvarItem(
      contexto,
      entrada.respostaId,
      entrada.itemId,
      {
        conforme:
          entrada.marcada === "sim"
            ? true
            : entrada.marcada === "nao"
              ? false
              : null,
        naoSeAplica: entrada.marcada === "na",
        valorNumero: leitura.data,
        valorTexto: entrada.texto.trim() || null,
        observacao: entrada.observacao.trim() || null,
      },
    );

    return {
      ok: true,
      quando: salvo.respondidoEm
        ? HORA_DA_OPERACAO.format(salvo.respondidoEm)
        : "",
      quem: salvo.respondidoPor,
    };
  } catch (erro) {
    const estado = comoErro(erro);
    return { ok: false, erro: estado.erro ?? "Não deu para gravar." };
  }
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
 * Os itens já foram gravados um a um enquanto a pessoa respondia. Este
 * `salvarRespostas` continua aqui como rede de segurança para o campo que
 * ficou com o cursor dentro: a folha esvazia a fila de gravações pendentes
 * antes de enviar, e o que ainda assim escapar entra por aqui.
 *
 * Depois de fechar, volta para a MESMA lista com a rotina selecionada — o
 * checklist agora aparece somado no histórico, logo abaixo. Antes isto levava
 * para uma página separada e o contexto se perdia.
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
    if (valores.size > 0) await salvarRespostas(contexto, id, valores);
    await fecharResposta(contexto, id);
  } catch (erro) {
    return comoErro(erro);
  }

  revalidatePath("/checklists");
  revalidatePath("/checklists/pendencias");

  const rotinaId = String(dados.get("rotinaId") ?? "");
  redirect(
    rotinaId
      ? `/checklists?${paramsDaLista(dados, rotinaId)}`
      : `/checklists/${id}`,
  );
}

export async function cancelarRespostaAcao(dados: FormData) {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const id = String(dados.get("respostaId") ?? "");
  if (!id) return;

  await cancelarResposta(contexto, id);
  revalidatePath("/checklists");

  // Da tela do dia, volta para a MESMA rotina e o mesmo período — agora sem
  // folha aberta, com o convite para começar de novo. Da página avulsa, que
  // não manda esses campos, volta para a lista.
  const rotinaId = String(dados.get("rotinaId") ?? "");
  const consulta = paramsDaLista(dados, rotinaId || undefined);
  redirect(consulta ? `/checklists?${consulta}` : "/checklists");
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
