"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";

import {
  aplicarEventosDaConexao,
  estadoAtualDaConexao,
  pedirQrCodeDaConexao,
  type EstadoAtual,
} from "@/app/api/whatsapp/_costura/conexao-tela";
import { entregarAvisos } from "@/app/api/whatsapp/_costura/entrega";
import { obterContexto } from "@/core/sessao/contexto";
import type { EstadoFormulario } from "@/modules/assistente/acoes";
import {
  confirmarAviso,
  reenviarAviso,
} from "@/modules/assistente/services/avisos";

/**
 * AS AÇÕES DO WHATSAPP QUE FALAM COM O PROVEDOR.
 *
 * Moram aqui, e não em `modules/assistente/acoes.ts`, por causa da trava do
 * linter: módulo não importa conector. Esta é a camada `app/`, a única que
 * alcança os dois — e por isso cada ação é uma casca: confere a sessão,
 * chama a costura, e devolve a resposta à tela.
 *
 * O QR Code volta DENTRO da resposta de `reconectarAcao` e vive só na memória
 * da página. Nada aqui o grava ou o imprime.
 */

async function contextoOuLogin() {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");
  return contexto;
}

function motivo(erro: unknown): string {
  return erro instanceof Error
    ? erro.message
    : "Algo deu errado. Tente de novo.";
}

export type RespostaDeReconexao =
  | { ok: true; conectado: true }
  | { ok: true; conectado: false; qr: { imagem: string; expiraEmMs: number } }
  | { ok: false; erro: string };

/**
 * RECONECTAR. Com o número no ar, só confirma — nada derruba. Desconectado,
 * devolve o QR Code para quem pode conectar NA LOJA DA CONEXÃO.
 */
export async function reconectarAcao(
  conexaoId: string,
): Promise<RespostaDeReconexao> {
  const contexto = await contextoOuLogin();
  try {
    const r = await pedirQrCodeDaConexao(contexto, conexaoId);
    revalidatePath("/assistente/whatsapp");
    return r.tipo === "ja-conectado"
      ? { ok: true, conectado: true }
      : {
          ok: true,
          conectado: false,
          qr: { imagem: r.imagem, expiraEmMs: r.expiraEmMs },
        };
  } catch (erro) {
    return { ok: false, erro: motivo(erro) };
  }
}

/** O que a tela consulta a cada 5 s enquanto o QR Code está aberto. */
export async function estadoDaConexaoAcao(
  conexaoId: string,
): Promise<EstadoAtual | null> {
  const contexto = await contextoOuLogin();
  try {
    return await estadoAtualDaConexao(contexto, conexaoId);
  } catch {
    return null;
  }
}

export async function aplicarEventosAcao(
  _anterior: EstadoFormulario,
  dados: FormData,
): Promise<EstadoFormulario> {
  const contexto = await contextoOuLogin();
  try {
    await aplicarEventosDaConexao(contexto, String(dados.get("id") ?? ""));
  } catch (erro) {
    return { erro: motivo(erro) };
  }
  revalidatePath("/assistente/whatsapp");
  return { ok: true };
}

/** Depois da resposta: tenta entregar ESTE aviso já. O relógio é a reserva. */
function entregarDepois(avisoId: string) {
  after(async () => {
    await entregarAvisos({ agora: new Date(), limite: 1, apenasId: avisoId });
  });
}

/**
 * CONFIRMAR O ENVIO. Uma confirmação, uma mensagem: se o aviso já não era
 * rascunho, nada acontece — nem erro, nem mensagem nova.
 */
export async function confirmarAvisoAcao(
  _anterior: EstadoFormulario,
  dados: FormData,
): Promise<EstadoFormulario> {
  const contexto = await contextoOuLogin();
  const id = String(dados.get("id") ?? "");
  const destinatarioRef = String(dados.get("destinatarioRef") ?? "");
  if (!destinatarioRef) {
    return { erros: { destinatarioRef: "Escolha quem vai receber" } };
  }

  try {
    const r = await confirmarAviso(contexto, id, destinatarioRef, new Date());
    if (!r.confirmado) {
      return { erro: "Este aviso já tinha sido confirmado." };
    }
  } catch (erro) {
    return { erro: motivo(erro) };
  }

  entregarDepois(id);
  revalidatePath("/assistente/avisos");
  return { ok: true };
}

/**
 * REENVIAR MESMO ASSIM — só depois de um resultado desconhecido ou de uma
 * falha, e só por decisão de quem confirma. A tela avisa o risco antes.
 */
export async function reenviarAvisoAcao(
  _anterior: EstadoFormulario,
  dados: FormData,
): Promise<EstadoFormulario> {
  const contexto = await contextoOuLogin();
  const id = String(dados.get("id") ?? "");
  try {
    const r = await reenviarAviso(contexto, id, new Date());
    if (!r.reenviado) return { erro: "Este aviso já não pode ser reenviado." };
  } catch (erro) {
    return { erro: motivo(erro) };
  }

  entregarDepois(id);
  revalidatePath("/assistente/avisos");
  return { ok: true };
}
